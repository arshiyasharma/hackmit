import { checkoutOwner, rejectCrossOrigin } from "@/lib/checkout/request";
import { findRunByInstructionId, runOnce } from "@/lib/checkout/runs";
import type { NextRequest } from "next/server";

import { loadVicConfig, missingVicVars } from "@/lib/visa/config";
import {
  buildCancelPurchaseInstructionPayload,
  buildClientObject,
  createWorkflowContext,
} from "@/lib/visa/payloads";
import { VIC_ENDPOINTS, VicApiError, vicRequest } from "@/lib/visa/vicClient";

/**
 * PUT /api/visa/mandate/{instructionId}/cancel — stand the authorisation down.
 *
 * WHEN A BASKET IS ABANDONED WE CANCEL THE MANDATE rather than letting it
 * stand until it expires. Small endpoint, and "we clean up the authorisation
 * when you walk away" is a good answer to a question a Visa rep will
 * absolutely ask — a spend cap nobody revokes is a spend cap still live.
 *
 * Cancelling is a terminal state. There is no un-cancel.
 *
 * `params` is a Promise in this version of Next; `RouteContext` is generated
 * during `next build` and needs no import. See
 * node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md.
 */

export const runtime = "nodejs";
export const maxDuration = 30;

function fail(status: number, body: Record<string, unknown>): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function PUT(
  request: NextRequest,
  context: RouteContext<"/api/visa/mandate/[instructionId]/cancel">
) {
  const forbidden = rejectCrossOrigin(request);
  if (forbidden) return forbidden;
  const { instructionId } = await context.params;
  if (!instructionId.trim()) {
    return fail(400, { error: "Tell us which instruction to cancel." });
  }

  const run = findRunByInstructionId(instructionId, checkoutOwner(request) ?? "");
  if (!run) return fail(404, { error: "That instruction is not in your checkout session." });
  return runOnce(run, `cancel:${instructionId}`, async () => {
    const missing = missingVicVars();
    if (missing.length) {
      return fail(503, {
        error: `Visa Intelligent Commerce is not configured yet (missing ${missing.join(", ")}).`,
        stage: "vic-unconfigured",
      });
    }

    const config = loadVicConfig();
    const workflow = createWorkflowContext();
    const payload = buildCancelPurchaseInstructionPayload(
      workflow,
      instructionId,
      buildClientObject(config.externalClientId, config.externalAppId)
    );

    try {
      const response = await vicRequest<Record<string, unknown>>(
        "PUT",
        VIC_ENDPOINTS.cancel(instructionId),
        payload
      );
      const data = response.data ?? {};
      run.instructionCancelled = true;
      return Response.json(
        {
          instructionId,
          status: typeof data.status === "string" ? data.status : "CANCELLED",
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
      console.error("[api/visa/mandate/cancel] failed");
      return fail(502, { error: "We could not reach Visa's sandbox just now." });
    }
  });
}
