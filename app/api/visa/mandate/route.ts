import { runOnce } from "@/lib/checkout/runs";
import { checkoutOwner, readObject, rejectCrossOrigin } from "@/lib/checkout/request";
import type { NextRequest } from "next/server";

import { findRunByBasketId, getRun, setInstructionId } from "@/lib/checkout/runs";
import type { Basket } from "@/lib/checkout/types";
import { enrollmentReferenceId, loadVicConfig, missingVicVars } from "@/lib/visa/config";
import {
  buildClientObject,
  buildInitiatePurchaseInstructionPayload,
  buildMandates,
  createWorkflowContext,
} from "@/lib/visa/payloads";
import { VIC_ENDPOINTS, VicApiError, vicRequest } from "@/lib/visa/vicClient";

/**
 * POST /api/visa/mandate — create the purchase instruction this run spends under.
 *
 * In:  { basketId } or { runId }
 * Out: { instructionId, status, pendingEvents, mandates, correlationId }
 *
 * THIS IS THE ENDPOINT THAT CARRIES THE PITCH. The mandate's
 * `declineThreshold.amount` is the budget HUD's cap — the number in the corner
 * of the room view is how much this agent is authorised to spend, on a real
 * Visa purchase mandate.
 *
 * DEGRADE HONESTLY, AND NEVER FAKE AN INSTRUCTION ID. Creating a mandate needs
 * a `tokenId`, which is a VTS enrolment reference, and VTS IS A SECOND
 * ONBOARDING that may never arrive. When it has not, this returns
 * 503 `{ stage: "vts-pending" }` and the checkout run carries on through the
 * test-mode walk completely unaffected. The Visa layer is additive: with it
 * the run carries a real instructionId, without it the run still completes.
 *
 * A made-up Visa identifier shown to a Visa judge is the one mistake you
 * cannot recover from in the booth. There is no branch in this file that
 * invents one.
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
  if (!body) return Response.json({ error: "We could not read that request." },
    { status: 400, headers: { "Cache-Control": "no-store" } });

  const runId = typeof body.runId === "string" ? body.runId.trim() : "";
  const basketId = typeof body.basketId === "string" ? body.basketId.trim() : "";
  if (!runId && !basketId) {
    return fail(400, { error: "Tell us which basket to authorise, as basketId." });
  }

  const run = runId ? getRun(runId) : findRunByBasketId(basketId, checkoutOwner(request) ?? "");
  if (!run || !run.ownerId || run.ownerId !== checkoutOwner(request)) {
    return fail(404, {
      error: "That basket is not on this server any more. Press checkout again.",
    });
  }
  if (run.instructionCancelled) return fail(409, { error: "This checkout mandate was cancelled. Start a new checkout." });
  return runOnce(run, "mandate", async () => {
    const basket: Basket = run.basket;
    if (run.instructionId) return Response.json({ instructionId: run.instructionId, status: "EXISTS" },
      { headers: { "Cache-Control": "no-store" } });

    const missing = missingVicVars();
    if (missing.length) {
      return fail(503, {
        error:
          `Visa Intelligent Commerce is not configured yet (missing ${missing.join(", ")}). ` +
          `The checkout run is unaffected and will still complete in test mode.`,
        stage: "vic-unconfigured",
      });
    }

    const tokenId = enrollmentReferenceId();
    if (!tokenId) {
      // The wall. Card tokenization is a separate Visa product with its own
      // approval, and without it there is no tokenId to mandate against.
      return fail(503, {
        error:
          "Visa Token Service onboarding has not landed, so there is no card token to " +
          "authorise against yet. The checkout run is unaffected and will still complete " +
          "in test mode.",
        stage: "vts-pending",
      });
    }

    const config = loadVicConfig();
    const context = createWorkflowContext();
    const client = buildClientObject(config.externalClientId, config.externalAppId);

    const payload = buildInitiatePurchaseInstructionPayload({
      consumerId: config.consumerId,
      tokenId,
      context,
      basket,
      client,
    });

    try {
      const response = await vicRequest<Record<string, unknown>>(
        "POST",
        VIC_ENDPOINTS.instructions,
        payload
      );

      const data = response.data ?? {};
      const instructionId =
        typeof data.instructionId === "string" ? data.instructionId : null;

      if (!instructionId) {
        // Visa answered 2xx without an id. Say so rather than inventing one.
        return fail(502, {
          error: "Visa accepted the mandate but did not return an instruction id.",
          correlationId: response.correlationId,
        });
      }

      setInstructionId(run.runId, instructionId);

      return Response.json(
        {
          instructionId,
          status: typeof data.status === "string" ? data.status : null,
          pendingEvents: Array.isArray(data.pendingEvents) ? data.pendingEvents : [],
          // what we asked for, so the screen can show the cap without guessing
          mandates: buildMandates(basket).map((mandate) => ({
            preferredMerchantName: mandate.preferredMerchantName,
            declineThreshold: mandate.declineThreshold,
            effectiveUntilTime: mandate.effectiveUntilTime,
            quantity: mandate.quantity,
            description: mandate.description,
          })),
          budgetMinor: basket.budgetMinor,
          clientReferenceId: context.clientReferenceId,
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
          // the only id Visa support can act on
          correlationId: error.correlationId,
        });
      }
      console.error("[api/visa/mandate] failed");
      return fail(502, { error: "We could not reach Visa's sandbox just now." });
    }
  });
}
