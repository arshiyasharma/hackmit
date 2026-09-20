import {
  canonicalHost,
  hostBelongsTo,
  retailerName,
} from "@/lib/checkout/retailers";
import type { Retailer } from "@/lib/checkout/types";

import { hasAgentKeys } from "./keys";
import { signRequest, signatureHeaders, type TapSignature, type TapTag } from "./sign";
import { acceptsTag, verifyRequest, type TapFailure, type TapVerdict } from "./verify";

/**
 * Presenting a signed request to a shop, and the shop's side of the desk.
 *
 * NO REAL RETAILER IMPLEMENTS TAP YET. Ours is a stand-in, and the honest
 * description is: the cryptography is real, the merchant is not. Every check
 * in `verify.ts` runs for real against a key resolved from a registry, and a
 * tampered signature really does fail — but Wayfair is not on the other end of
 * it. Say that at the booth before somebody asks.
 *
 * TWO TRANSPORTS, one behaviour. By default the shop is called in-process:
 * the same `verifyRequest` the HTTP endpoint runs, from the same headers, with
 * nothing but the two header strings crossing the boundary. Set
 * `TAP_VERIFY_BASE_URL` and the agent instead POSTs to
 * `/api/retailer/{retailer}/verify` over HTTP, which is the same code one hop
 * further away.
 *
 * WHY IN-PROCESS IS THE DEFAULT, and it is not laziness. The walk has to
 * complete with the wifi off — that is a rehearsal item, not a nice-to-have —
 * and a serverless function calling its own public URL needs a hostname it
 * does not reliably know. An HTTP hop to ourselves is not more truthful than a
 * function call to ourselves; both are our code checking our own signature.
 * What makes it a real check is that the verifier gets the headers and nothing
 * else. The HTTP path exists so you can show the round trip when you want it.
 */

/** Who the shop is, from the shop's point of view. */
export interface MerchantIdentity {
  retailer: Retailer;
  /** the host it answers as */
  authority: string;
  /** the path the request landed on */
  path: string;
  displayName: string;
}

/**
 * Work out the merchant's own identity for an incoming request.
 *
 * The subtle half: when the declared URL belongs to this shop, the shop's
 * authority IS that host — `www.ikea.com` and `ikea.com` are both IKEA. When
 * it does not, the shop stays itself and the mismatch surfaces as
 * `authority-mismatch`, which is the anti-relay case.
 *
 * Null means the declared URL is not a URL at all; that is a 400, not a
 * verdict.
 */
export function merchantIdentity(
  retailer: Retailer,
  declaredUrl: string
): MerchantIdentity | null {
  let parsed: URL;
  try {
    parsed = new URL(declaredUrl);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;

  return {
    retailer,
    authority: hostBelongsTo(retailer, parsed.host)
      ? parsed.host
      : canonicalHost(retailer),
    path: parsed.pathname,
    displayName: retailerName(retailer),
  };
}

export interface MerchantCheck {
  verdict: TapVerdict;
  merchant: MerchantIdentity;
  /** true when the signature verified AND carried the tag this operation needs */
  accepted: boolean;
  requiredTag: TapTag;
}

/**
 * The shop, deciding. Used by the verify route and by the in-process path, so
 * the two can never drift apart.
 */
export function verifyAsMerchant(opts: {
  retailer: Retailer;
  declaredUrl: string;
  signatureInput: string;
  signature: string;
  requiredTag: TapTag;
  now?: number;
}): MerchantCheck | null {
  const merchant = merchantIdentity(opts.retailer, opts.declaredUrl);
  if (!merchant) return null;

  const verdict = verifyRequest({
    signatureInput: opts.signatureInput,
    signature: opts.signature,
    authority: merchant.authority,
    path: merchant.path,
    declaredUrl: opts.declaredUrl,
    now: opts.now,
  });

  return {
    verdict,
    merchant,
    accepted: acceptsTag(verdict, opts.requiredTag),
    requiredTag: opts.requiredTag,
  };
}

export type MerchantTransport = "in-process" | "http";

export interface PresentResult extends MerchantCheck {
  signed: TapSignature;
  via: MerchantTransport;
}

/** Thrown when the HTTP merchant could not be reached. Never swallowed. */
export class MerchantUnreachableError extends Error {
  constructor(retailer: Retailer, cause: unknown) {
    super(`Could not reach the ${retailerName(retailer)} verifier`);
    this.name = "MerchantUnreachableError";
    this.cause = cause;
  }
}

/** True when the agent has an identity to present at all. */
export function tapIsConfigured(): boolean {
  return hasAgentKeys();
}

function verdictFrom(raw: unknown): TapVerdict {
  const r = (raw ?? {}) as Record<string, unknown>;
  if (r.ok === true && typeof r.agentId === "string") {
    return {
      ok: true,
      agentId: r.agentId,
      agentName: typeof r.agentName === "string" ? r.agentName : r.agentId,
      tag: typeof r.tag === "string" ? r.tag : "",
      expiresAt: typeof r.expiresAt === "number" ? r.expiresAt : 0,
    };
  }
  return { ok: false, reason: (r.reason as TapFailure) ?? "malformed" };
}

/**
 * Sign a request for `targetUrl` and put it in front of the shop.
 *
 * `tag` has no default here either — see `sign.ts`. "browsing" reads a page,
 * "payment" checks out, and presenting the wrong one is a thing the merchant
 * should catch rather than a thing we should paper over.
 */
export async function presentToMerchant(opts: {
  retailer: Retailer;
  targetUrl: string;
  tag: TapTag;
}): Promise<PresentResult> {
  const signed = signRequest(opts.targetUrl, opts.tag);

  const base = process.env.TAP_VERIFY_BASE_URL?.trim().replace(/\/+$/, "");
  if (base) {
    let response: Response;
    try {
      response = await fetch(`${base}/api/retailer/${opts.retailer}/verify`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...signatureHeaders(signed),
        },
        body: JSON.stringify({
          targetUrl: opts.targetUrl,
          requiredTag: opts.tag,
        }),
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(5_000),
      });
    } catch (error) {
      throw new MerchantUnreachableError(opts.retailer, error);
    }

    const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    const merchant =
      merchantIdentity(opts.retailer, opts.targetUrl) ??
      ({
        retailer: opts.retailer,
        authority: canonicalHost(opts.retailer),
        path: "/",
        displayName: retailerName(opts.retailer),
      } satisfies MerchantIdentity);
    const verdict = verdictFrom(body);

    return {
      signed,
      verdict,
      merchant,
      accepted: response.ok && body.accepted === true && acceptsTag(verdict, opts.tag),
      requiredTag: opts.tag,
      via: "http",
    };
  }

  const check = verifyAsMerchant({
    retailer: opts.retailer,
    declaredUrl: opts.targetUrl,
    signatureInput: signed.signatureInput,
    signature: signed.signature,
    requiredTag: opts.tag,
  });

  if (!check) {
    // the listing's product URL is not a URL. That is a broken listing, and
    // the line should fail loudly rather than skip its identity check.
    return {
      signed,
      verdict: { ok: false, reason: "malformed" },
      merchant: {
        retailer: opts.retailer,
        authority: canonicalHost(opts.retailer),
        path: "/",
        displayName: retailerName(opts.retailer),
      },
      accepted: false,
      requiredTag: opts.tag,
      via: "in-process",
    };
  }

  return { ...check, signed, via: "in-process" };
}
