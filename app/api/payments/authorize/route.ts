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
 *        correlationId, merchant: "shared-test", captured: false }
 *
 * THIS IS THE INSURANCE POLICY. It needs no Visa onboarding of any kind, so it
 * works tonight whatever the VIC dashboard does, and it is the difference
 * between "we would have called Visa" and "here is Visa's answer".
 *
 * BE EXACT ABOUT WHAT IT PROVES. The request is genuinely signed and the
 * endpoint is genuinely Visa's. The merchant is the SHARED TEST MERCHANT that
 * Visa publishes in its own public samples, not ours; the card is Visa's
 * published test PAN, not anybody's; and `capture: false` means the hold is
 * never turned into a charge. Nothing is captured anywhere in this repo.
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
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return bad("We could not read that payment request.");
  }

  const amountMinor = body.amountMinor;
  if (
    typeof amountMinor !== "number" ||
    !Number.isInteger(amountMinor) ||
    amountMinor <= 0
  ) {
    return bad("Tell us the amount as a whole number of cents, as amountMinor.");
  }
  if (amountMinor > 100_000_000) {
    return bad("That amount is too large to authorize.");
  }

  const currency =
    typeof body.currency === "string" && /^[A-Za-z]{3}$/.test(body.currency)
      ? body.currency.toUpperCase()
      : "USD";

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
        merchant: "shared-test",
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
    console.error("[api/payments/authorize] upstream failed", error);
    return Response.json(
      { error: "We could not reach Visa's sandbox just now." },
      { status: 502, headers: { "Cache-Control": "no-store" } }
    );
  }
}
