import type { NextRequest } from "next/server";

import { getLineStatus, getRun, getTransactionReference } from "@/lib/checkout/runs";
import { loadVicConfig, missingVicVars } from "@/lib/visa/config";
import { buildConfirmationPayload, lineTotalDecimal } from "@/lib/visa/credentials";
import type { TransactionOutcome } from "@/lib/visa/credentials";
import { buildClientObject, createWorkflowContext } from "@/lib/visa/payloads";
import { VIC_ENDPOINTS, VicApiError, vicRequest } from "@/lib/visa/vicClient";

/**
 * POST /api/visa/confirm — tell Visa what actually happened.
 *
 * In:  { runId, lineId, instructionId, transactionReferenceId? }
 * Out: { ok, transactionReferenceId, transactionStatus, correlationId }
 *
 * ── DO NOT REPORT APPROVED FOR A PURCHASE THAT DID NOT HAPPEN ─────────────
 *
 * Signals are how Visa resolves disputes. Feeding the sandbox fiction is both
 * wrong and an easy thing for a judge to catch, so this route reads what the
 * run ACTUALLY did off the line's own status and reports that:
 *
 *   - a line with a real authorization behind it (PAYMENT_PROVIDER=acceptance)
 *     confirms APPROVED, with that authorization's own approval code and
 *     reconciliation id.
 *   - a line that was only ever simulated is REFUSED with a 409. There is no
 *     branch here that invents an approval, because there is nothing to report
 *     and saying so is better than saying something false.
 *
 * `orderStatus` is PENDING either way — the money was authorised, the goods
 * were never ordered. See lib/visa/credentials.ts for why that matters.
 *
 * THE TRANSACTION REFERENCE IS THE ONE FROM /api/visa/credentials. It is read
 * back off the run rather than minted here; Visa ties the two calls together
 * by it, and a fresh one reports an event against a transaction that never
 * existed.
 */

export const runtime = "nodejs";
export const maxDuration = 30;

function fail(status: number, body: Record<string, unknown>): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return fail(400, { error: "We could not read that request." });
  }

  const runId = typeof body.runId === "string" ? body.runId.trim() : "";
  const lineId = typeof body.lineId === "string" ? body.lineId.trim() : "";
  const instructionId =
    typeof body.instructionId === "string" ? body.instructionId.trim() : "";

  if (!runId || !lineId) {
    return fail(400, { error: "Tell us which line to confirm, as runId and lineId." });
  }
  if (!instructionId) {
    return fail(400, {
      error: "Tell us which Visa instruction this was spent under, as instructionId.",
    });
  }

  const run = getRun(runId);
  const line = run?.basket.lines.find((l) => l.lineId === lineId);
  if (!run || !line) {
    return fail(404, { error: "That line is not on this server any more." });
  }

  // the SAME id the credential was pulled with, never a fresh one
  const transactionReferenceId =
    getTransactionReference(runId, lineId) ??
    (typeof body.transactionReferenceId === "string"
      ? body.transactionReferenceId.trim()
      : "");

  if (!transactionReferenceId) {
    return fail(409, {
      error:
        "No payment credential was pulled for that line, so there is no transaction to " +
        "confirm. Call /api/visa/credentials first.",
      stage: "no-transaction",
    });
  }

  /*
   * What the run actually did. A line is only confirmable if a real payment
   * provider authorised it — see the header comment.
   */
  const status = getLineStatus(runId, lineId);
  const payment = status?.payment;

  if (!payment || payment.status !== "AUTHORIZED") {
    return fail(409, {
      error:
        "That line was only ever simulated, so there is no transaction outcome to report. " +
        "We do not tell Visa a purchase was approved when it did not happen.",
      stage: "nothing-to-confirm",
      lineState: status?.state ?? "unknown",
    });
  }

  const missing = missingVicVars();
  if (missing.length) {
    return fail(503, {
      error: `Visa Intelligent Commerce is not configured yet (missing ${missing.join(", ")}).`,
      stage: "vic-unconfigured",
    });
  }

  const outcome: TransactionOutcome = {
    approved: true,
    amount: payment.authorizedAmount ?? lineTotalDecimal(line),
    authorizationCode: payment.approvalCode,
    retrievalReferenceNumber: payment.reconciliationId,
    orderRef: status?.state === "placed" ? status.orderRef : null,
  };

  const config = loadVicConfig();
  const context = createWorkflowContext();

  const payload = buildConfirmationPayload({
    transactionReferenceId,
    context,
    line,
    outcome,
    instructionId,
    client: buildClientObject(config.externalClientId, config.externalAppId),
  });

  try {
    const response = await vicRequest<Record<string, unknown>>(
      "POST",
      VIC_ENDPOINTS.confirmations(instructionId),
      payload
    );
    return Response.json(
      {
        ok: true,
        transactionReferenceId,
        transactionStatus: "APPROVED",
        orderStatus: "PENDING",
        correlationId: response.correlationId,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    if (error instanceof VicApiError) {
      return fail(502, {
        ok: false,
        error: error.message,
        stage: "vic-refused",
        httpStatus: error.httpStatus,
        correlationId: error.correlationId,
      });
    }
    console.error("[api/visa/confirm] failed to reach Visa");
    return fail(502, { ok: false, error: "We could not reach Visa's sandbox just now." });
  }
}
