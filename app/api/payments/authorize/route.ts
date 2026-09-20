import { readObject, rejectCrossOrigin } from "@/lib/checkout/request";
import type { NextRequest } from "next/server";

import {
  authorize,
  MissingAcceptanceCredentialsError,
} from "@/lib/visaAcceptance/payments";

/**
 * POST /api/payments/authorize — a real authorization from a Visa sandbox.
 *
 * In:  { amountMinor, currency?, lineId? }
 * Out: { status, reconciliationId, authorizedAmount, currency, approvalCode,
 *        correlationId, merchant: "sandbox", captured: false }
 *
 * Uses the configured Visa Acceptance sandbox merchant credentials. These
 * may belong to our sandbox account or to Visa's published shared test merchant.
 * This authorization does not depend on Visa Intelligent Commerce onboarding.
 *
 * The request is signed and sent to Visa's sandbox using published test-card
 * data. `capture: false` prevents capture; no real money moves. A successful
 * response proves sandbox authorization, not VIC enrollment or a retailer order.
 *
 * 503 when the credentials are not configured — with the sentence that says
 * where to get them. 502 when Visa answered something we could not use, with
 * the correlation id, because that id is the only thing Visa support can act
 * on.
 */

export const runtime = "nodejs";
export const maxDuration = 30;

function bad(error: string): Response {
  return Response.json({ error }, { status: 400, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
  const forbidden = rejectCrossOrigin(request);
  if (forbidden) return forbidden;
  const body = await readObject(request);
  if (!body) return Response.json({ error: "We could not read that request." },
    { status: 400, headers: { "Cache-Control": "no-store" } });

  const amountMinor = body.amountMinor;
  if (
    typeof amountMinor !== "number" ||
    !Number.isSafeInteger(amountMinor) ||
    amountMinor <= 0
  ) {
    return bad("Tell us the amount as a whole number of cents, as amountMinor.");
  }
  if (amountMinor > 100_000_000) {
    return bad("That amount is too large to authorize.");
  }

  if (body.currency !== undefined && body.currency !== "USD") {
    return bad("The demo sandbox supports USD only.");
  }
  const currency = "USD";

  const lineId = typeof body.lineId === "string" ? body.lineId.trim() : "";
  // Visa's clientReferenceInformation.code is short; a uuid line id does not
  // fit, so the tail of it is enough to tie a response back to a line
  const clientReferenceCode = lineId ? `VRA-${lineId.slice(-12)}` : `VRA-${Date.now()}`;

  try {
    const result = await authorize({ amountMinor, currency, clientReferenceCode });

    if (!result.reconciliationId && result.httpStatus >= 400) {
      return Response.json(
        {
          error: result.message ?? "Visa could not authorize that.",
          status: result.status,
          correlationId: result.correlationId,
        },
        { status: 502, headers: { "Cache-Control": "no-store" } }
      );
    }

    return Response.json(
      {
        status: result.status,
        reconciliationId: result.reconciliationId,
        authorizedAmount: result.authorizedAmount,
        currency: result.currency ?? currency,
        approvalCode: result.approvalCode,
        correlationId: result.correlationId,
        clientReferenceCode,
        // said in the payload as well as in the pitch
        merchant: "sandbox",
        captured: false,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    if (error instanceof MissingAcceptanceCredentialsError) {
      return Response.json(
        { error: error.message, stage: "acceptance-unconfigured" },
        { status: 503, headers: { "Cache-Control": "no-store" } }
      );
    }
    console.error("[api/payments/authorize] upstream failed");
    return Response.json(
      { error: "We could not reach Visa's sandbox just now." },
      { status: 502, headers: { "Cache-Control": "no-store" } }
    );
  }
}
