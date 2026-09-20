import { readObject, rejectCrossOrigin } from "@/lib/checkout/request";
import type { NextRequest } from "next/server";

import { enrollmentReferenceId, loadVicConfig, missingVicVars } from "@/lib/visa/config";
import {
  buildClientObject,
  buildEnrollCardPayload,
  createWorkflowContext,
} from "@/lib/visa/payloads";
import { VIC_ENDPOINTS, VicApiError, vicRequest } from "@/lib/visa/vicClient";

/**
 * POST /api/visa/enroll — register the tokenized card with VIC.
 *
 * In:  { email? }
 * Out: { clientReferenceId, status, correlationId }
 *
 * Step 1 of the purchase-instruction lifecycle, and it needs the VTS
 * enrolment reference — a card tokenization from Visa Token Service, which is
 * a SEPARATE ONBOARDING with its own approval. Without it this answers
 * 503 `{ stage: "vts-pending" }`, exactly like the mandate endpoint, and
 * nothing else in the app changes.
 *
 * NOTHING HERE TOUCHES A REAL CARD. The enrolment reference is a token
 * reference id; no PAN is sent, stored or logged anywhere in this repo.
 */

export const runtime = "nodejs";
export const maxDuration = 30;

function fail(status: number, body: Record<string, unknown>): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
  const forbidden = rejectCrossOrigin(request);
  if (forbidden) return forbidden;
  const body = await readObject(request);
  if (!body) return fail(400, { error: "We could not read that request." });

  const missing = missingVicVars();
  if (missing.length) {
    return fail(503, {
      error: `Visa Intelligent Commerce is not configured yet (missing ${missing.join(", ")}).`,
      stage: "vic-unconfigured",
    });
  }

  const enrolmentRef = enrollmentReferenceId();
  if (!enrolmentRef) {
    return fail(503, {
      error:
        "Visa Token Service onboarding has not landed, so there is no card token to enrol.",
      stage: "vts-pending",
    });
  }

  const config = loadVicConfig();
  const context = createWorkflowContext();

  const payload = buildEnrollCardPayload({
    consumerId: config.consumerId,
    enrollmentReferenceId: enrolmentRef,
    context,
    email: typeof body.email === "string" && body.email.trim() ? body.email.trim() : undefined,
    client: buildClientObject(config.externalClientId, config.externalAppId),
  });

  try {
    const response = await vicRequest<Record<string, unknown>>(
      "POST",
      VIC_ENDPOINTS.enrollCard,
      payload
    );
    const data = response.data ?? {};
    return Response.json(
      {
        clientReferenceId: context.clientReferenceId,
        consumerId: config.consumerId,
        status: typeof data.status === "string" ? data.status : "ENROLLED",
        correlationId: response.correlationId,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    if (error instanceof VicApiError) {
      return fail(502, {
        error: "Visa could not complete this sandbox request.",
        stage: "vic-refused",
        httpStatus: error.httpStatus,
        correlationId: error.correlationId,
      });
    }
    console.error("[api/visa/enroll] failed");
    return fail(502, { error: "We could not reach Visa's sandbox just now." });
  }
}
