import type { NextRequest } from "next/server";

import { isRetailer } from "@/lib/checkout/retailers";
import { verifyAsMerchant } from "@/lib/tap/merchant";
import type { TapTag } from "@/lib/tap/sign";

/**
 * POST /api/retailer/{retailer}/verify — a shop checking the agent's badge.
 *
 * THIS SIMULATES A TAP-AWARE MERCHANT. No real retailer implements the Trusted
 * Agent Protocol yet — not Wayfair, not IKEA, not Amazon — so the shop on the
 * other end of this is ours. The cryptography is not simulated: the key is
 * resolved from a registry, the signature base is rebuilt from the headers
 * alone, and a tampered request really is refused. Being straight about which
 * half is real is better than a judge working it out.
 *
 * In:  headers `Signature-Input` and `Signature`, body { targetUrl, requiredTag? }
 * Out: 200 { ok: true, agentId, agentName, tag, expiresAt, accepted, merchant }
 *      401 { ok: false, reason, merchant }
 *
 * WHY THE BODY CARRIES THE URL. A real merchant knows its own authority and
 * path because the request physically arrived there. This endpoint is a stand
 * -in sitting on our own domain, so the agent declares which URL it signed for
 * and the merchant checks that declaration against itself. Declare somebody
 * else's shop and you get `authority-mismatch` — which is the replay case, and
 * the one worth putting on a screen.
 *
 * `params` is a Promise in this version of Next; `RouteContext` is generated
 * during `next build` and needs no import. See
 * node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md.
 */

export const runtime = "nodejs";
export const maxDuration = 10;

const TAGS: ReadonlySet<string> = new Set<TapTag>(["browsing", "payment"]);

export async function POST(
  request: NextRequest,
  context: RouteContext<"/api/retailer/[retailer]/verify">
) {
  const { retailer } = await context.params;
  if (!isRetailer(retailer)) {
    return Response.json(
      { error: `We do not run a shop called ${retailer}.` },
      { status: 404, headers: { "Cache-Control": "no-store" } }
    );
  }

  const signatureInput = request.headers.get("Signature-Input") ?? "";
  const signature = request.headers.get("Signature") ?? "";
  if (!signatureInput || !signature) {
    // a merchant does not owe an unsigned request an explanation of the spec
    return Response.json(
      { ok: false, reason: "malformed" },
      { status: 401, headers: { "Cache-Control": "no-store" } }
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json(
      { error: "We could not read that request." },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }

  const targetUrl = typeof body.targetUrl === "string" ? body.targetUrl.trim() : "";
  if (!targetUrl) {
    return Response.json(
      { error: "Tell us which page the signature was made for, as targetUrl." },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }

  const requiredTag: TapTag =
    typeof body.requiredTag === "string" && TAGS.has(body.requiredTag)
      ? (body.requiredTag as TapTag)
      : "payment";

  const check = verifyAsMerchant({
    retailer,
    declaredUrl: targetUrl,
    signatureInput,
    signature,
    requiredTag,
  });

  if (!check) {
    return Response.json(
      { error: "That targetUrl is not a web address we can check a signature against." },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }

  const merchant = {
    retailer: check.merchant.retailer,
    name: check.merchant.displayName,
    authority: check.merchant.authority,
    path: check.merchant.path,
  };

  if (!check.verdict.ok) {
    return Response.json(
      { ok: false, reason: check.verdict.reason, merchant },
      { status: 401, headers: { "Cache-Control": "no-store" } }
    );
  }

  // A valid signature for the wrong operation is still a refusal. 403, not
  // 401: we know who you are, you are just not cleared for this.
  if (!check.accepted) {
    return Response.json(
      {
        ok: false,
        reason: "wrong-operation",
        agentId: check.verdict.agentId,
        agentName: check.verdict.agentName,
        tag: check.verdict.tag,
        requiredTag,
        merchant,
      },
      { status: 403, headers: { "Cache-Control": "no-store" } }
    );
  }

  return Response.json(
    {
      ok: true,
      accepted: true,
      agentId: check.verdict.agentId,
      agentName: check.verdict.agentName,
      tag: check.verdict.tag,
      expiresAt: check.verdict.expiresAt,
      requiredTag,
      merchant,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
