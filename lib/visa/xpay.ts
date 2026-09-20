import { createHmac } from "node:crypto";

/**
 * The X-Pay token, VIC's flavour.
 *
 * PORTED FROM VISA'S OWN CLIENT — `packages/api-client/src/x-pay-token.ts` in
 * `github.com/visa/ai` (the repo the "SDK" README calls Visa AI). Every rule
 * below was read out of that file, not remembered.
 *
 * THE ONE THAT COSTS AN HOUR, and Visa's own skill file flags it as the top
 * gotcha: VIC computes the resource path WITHOUT the context prefix. For
 * `https://sandbox.api.visa.com/vacp/v1/instructions` you hash
 * `v1/instructions`, not `/vacp/v1/instructions` and not `vacp/v1/instructions`.
 * Every other Visa API uses the full path. Get it wrong and you get a 401 with
 * nothing in the body to tell you why.
 *
 * ORDER MATTERS WITH MLE: encrypt first, then sign. The `body` passed here is
 * the exact string that goes on the wire — for an encrypted call that is
 * `{"encData":"<jwe>"}`, NOT the plaintext object. Sign the plaintext and the
 * server, which hashes what it received, will disagree.
 *
 * Server only. The shared secret must never reach the browser.
 */

/** The prefixes VIC and VDP put in front of their versioned paths. */
const CONTEXT_PREFIX = /^\/(vacp|vdp|vic)\//;

/**
 * The resource path the token is computed over.
 *
 * Exported so a test can assert the prefix rule directly — it is the single
 * most likely thing for someone to "fix" back to the full path.
 */
export function resourcePathFor(requestUrl: string): string {
  const { pathname } = new URL(requestUrl);
  return pathname.replace(CONTEXT_PREFIX, "").replace(/^\//, "");
}

export interface XPayTokenOptions {
  /** `VISA_VIC_API_KEY_SS`. Used as UTF-8 bytes, not base64-decoded. */
  sharedSecret: string;
  /** the full URL including the `?apikey=` query */
  requestUrl: string;
  /** the exact body string going on the wire. Empty for a body-less call. */
  body?: string;
  /** unix seconds; tests pass a fixed value */
  timestamp?: number;
}

/**
 * `xv2:<unix seconds>:<hmac-sha256 hex>`.
 *
 * The pre-hash string is four parts concatenated with NO separator and no
 * newline: timestamp, resource path, query string (without the leading `?`,
 * and `apikey` stays in), and the body.
 */
export function createXPayToken({
  sharedSecret,
  requestUrl,
  body = "",
  timestamp,
}: XPayTokenOptions): string {
  const url = new URL(requestUrl);
  const resourcePath = resourcePathFor(requestUrl);
  // `search` includes the "?" — the token is computed without it. The apikey
  // parameter is part of the URL and therefore part of what is signed.
  const queryParams = url.search.slice(1);

  const seconds = timestamp ?? Math.floor(Date.now() / 1000);
  const preHash = `${seconds}${resourcePath}${queryParams}${body}`;

  // the secret is UTF-8 bytes. Base64-decoding it here — which is right for
  // Visa Acceptance, a different company — produces a token that never verifies.
  const hash = createHmac("sha256", Buffer.from(sharedSecret, "utf8"))
    .update(preHash)
    .digest("hex");

  return `xv2:${seconds}:${hash}`;
}

/** Exported for the test that pins the concatenation rule. */
export function buildPreHashString(
  timestamp: number,
  resourcePath: string,
  queryParams: string,
  body: string
): string {
  return `${timestamp}${resourcePath}${queryParams}${body}`;
}
