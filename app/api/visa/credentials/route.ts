import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";

import { getRun, setTransactionReference } from "@/lib/checkout/runs";
import { enrollmentReferenceId, loadVicConfig, missingVicVars } from "@/lib/visa/config";
import {
  buildRetrievePaymentCredentialsPayload,
  last4Of,
} from "@/lib/visa/credentials";
import { buildClientObject, createWorkflowContext } from "@/lib/visa/payloads";
import { VIC_ENDPOINTS, VicApiError, vicRequest } from "@/lib/visa/vicClient";

/**
 * POST /api/visa/credentials — pull the payment credential for one line.
 *
 * In:  { runId, lineId, instructionId }
 * Out: { ok: true, transactionReferenceId, last4 }   ← and NOTHING else
 *
 * ── THE RESPONSE CONTAINS REAL PAYMENT CREDENTIALS ────────────────────────
 *
 * A PAN or network token, an expiry, and a dynamic CVV. The rules, no
 * exceptions:
 *
 *   - it is never logged, at any level
 *   - it is never returned to the browser
 *   - it is never stored — not in the run, not anywhere
 *   - it is never put in an error message
 *
 * `last4Of` is the only thing in this process that reads it, and the most it
 * can return is four characters. The credential is held in request scope and
 * allowed to go out of scope the moment this function returns. Nothing caches
 * it. If you are about to add a `console.log` below this line, do not.
 *
 * THE TRANSACTION REFERENCE IS MINTED HERE and stored on the run, because
 * `/api/visa/confirm` must use the SAME one — Visa ties the credential and the
 * confirmation together by it.
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
    return fail(400, { error: "Tell us which line to pay for, as runId and lineId." });
  }
  if (!instructionId) {
    return fail(400, {
      error: "Tell us which Visa instruction to spend under, as instructionId.",
    });
  }

  const run = getRun(runId);
  const line = run?.basket.lines.find((l) => l.lineId === lineId);
  if (!run || !line) {
    return fail(404, { error: "That line is not on this server any more." });
  }

  const missing = missingVicVars();
  if (missing.length) {
    return fail(503, {
      error: `Visa Intelligent Commerce is not configured yet (missing ${missing.join(", ")}).`,
      stage: "vic-unconfigured",
    });
  }

  const tokenId = enrollmentReferenceId();
  if (!tokenId) {
    return fail(503, {
      error:
        "Visa Token Service onboarding has not landed, so there is no card token to pull " +
        "a credential from.",
      stage: "vts-pending",
    });
  }

  const config = loadVicConfig();
  const context = createWorkflowContext();
  const transactionReferenceId = randomUUID();

  const payload = buildRetrievePaymentCredentialsPayload({
    tokenId,
    transactionReferenceId,
    context,
    line,
    instructionId,
    client: buildClientObject(config.externalClientId, config.externalAppId),
  });

  try {
    /*
     * Everything from here to the return is the sensitive window. `response`
     * holds the decrypted credential. It is read exactly once, by `last4Of`,
     * and is never assigned anywhere that outlives this scope.
     */
    const response = await vicRequest<Record<string, unknown>>(
      "POST",
      VIC_ENDPOINTS.credentials(instructionId),
      payload
    );

    const last4 = last4Of(response.data);

    // the reference, not the credential. This is the only thing kept.
    setTransactionReference(runId, lineId, transactionReferenceId);

    return Response.json(
      { ok: true, transactionReferenceId, last4 },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    if (error instanceof VicApiError) {
      /*
       * `error.body` is a DECRYPTED VIC body and is not returned. Only the
       * correlation id and the status go back — an error message is one of the
       * four places a credential must never appear.
       */
      return fail(502, {
        ok: false,
        error: "Visa would not release a payment credential for that line.",
        stage: "vic-refused",
        httpStatus: error.httpStatus,
        correlationId: error.correlationId,
      });
    }
    // deliberately not `console.error(error)` — the thrown value could carry a body
    console.error("[api/visa/credentials] failed to reach Visa");
    return fail(502, { ok: false, error: "We could not reach Visa's sandbox just now." });
  }
}
