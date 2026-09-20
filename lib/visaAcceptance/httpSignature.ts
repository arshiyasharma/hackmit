import { createHash, createHmac } from "node:crypto";

/**
 * HTTP Signature authentication for the Visa Acceptance REST API.
 *
 * PORTED FROM VISA'S OWN NODE CLIENT, not from memory and not from the prose
 * docs. The two files that define this are
 * `src/authentication/http/SignatureParameterGenerator.js` and
 * `src/authentication/http/HTTPSigToken.js` in
 * `github.com/CyberSource/cybersource-rest-client-node` (the package predates
 * the Visa Acceptance rename). Every rule below was read out of that source.
 *
 * THE ONE THAT COSTS AN HOUR: the request-target line is spelled
 * `request-target`, with NO PARENTHESES, in both the signing string and the
 * `headers="..."` list. Draft-Cavage HTTP Signatures — and most write-ups of
 * this API, including the build document this file was written from — say
 * `(request-target)`. Visa's own client does not use the parentheses, and the
 * server agrees with the client. Add them and every call is a 401 with nothing
 * useful in the body.
 *
 * THE ORDER IS THE CONTRACT. The lines are signed in exactly the order named
 * in `headers=`, and the server rebuilds the string from that list. Change one
 * and you must change the other. They are built from one array below so they
 * cannot drift.
 *
 * Server only. The shared secret must never reach the browser bundle.
 */

/** Always this, for HTTP Signature. Not the JWS name, not "hmac-sha256". */
const ALGORITHM = "HmacSHA256";

/** `digest: SHA-256=<base64>` — the prefix is part of the signed value. */
const DIGEST_PREFIX = "SHA-256=";

export interface MerchantCredentials {
  /** the merchant id from the portal, or the shared sandbox one from Visa's samples */
  merchantId: string;
  /** the uuid shown beside the key in the portal */
  merchantKeyId: string;
  /** base64. Decoded to bytes before it is used as the HMAC key. */
  merchantSecretKey: string;
  /** e.g. `apitest.visaacceptance.com` — host only, no scheme */
  host: string;
}

export interface SignedRequest {
  /** every header to send, ready to spread into a fetch */
  headers: Record<string, string>;
  /** the exact string that was signed. Returned so a test can prove it. */
  signatureString: string;
  /** `SHA-256=<base64>`, or undefined for a body-less method */
  digest?: string;
  /** the RFC 7231 date that was signed; the header must carry this same value */
  date: string;
}

/** base64( SHA-256( body ) ). Not an HMAC — the SDK's comment says HMAC and its code does not. */
export function bodyDigest(body: string): string {
  return createHash("sha256").update(Buffer.from(body, "utf8")).digest("base64");
}

/**
 * The signed lines, in order, joined by `\n` — and with NO trailing newline
 * after the last one. A stray `\n` at the end is the second most common way to
 * get an unexplained 401.
 *
 * POST/PUT/PATCH sign five lines; GET and DELETE sign four and omit `digest`,
 * because there is no body to digest.
 */
export function buildSignatureString(opts: {
  method: string;
  /** path including any query string, e.g. `/pts/v2/payments` */
  resourcePath: string;
  host: string;
  date: string;
  merchantId: string;
  digest?: string;
}): { signatureString: string; headerList: string } {
  const method = opts.method.toLowerCase();

  const lines: Array<[name: string, value: string]> = [
    ["host", opts.host],
    ["date", opts.date],
    ["request-target", `${method} ${opts.resourcePath}`],
  ];

  if (opts.digest) lines.push(["digest", opts.digest]);
  lines.push(["v-c-merchant-id", opts.merchantId]);

  return {
    signatureString: lines.map(([name, value]) => `${name}: ${value}`).join("\n"),
    // the same array, so the list and the string can never disagree
    headerList: lines.map(([name]) => name).join(" "),
  };
}

/** RFC 7231 HTTP-date, which is what `toUTCString()` produces. */
export function httpDate(at: Date = new Date()): string {
  return at.toUTCString();
}

/**
 * Sign one request.
 *
 * The returned `headers` include `Date` and `Digest` because the server
 * recomputes the signature from the headers it received — send a different
 * date, or a body that does not match the digest, and it will not match what
 * we signed. That is the point, and it is what the tamper test proves.
 */
export function signRequest(opts: {
  method: string;
  resourcePath: string;
  body?: string;
  credentials: MerchantCredentials;
  /** tests pass a fixed date so the signature is reproducible */
  date?: string;
}): SignedRequest {
  const { credentials } = opts;
  const method = opts.method.toUpperCase();
  const date = opts.date ?? httpDate();

  const hasBody = method === "POST" || method === "PUT" || method === "PATCH";
  const digest = hasBody ? `${DIGEST_PREFIX}${bodyDigest(opts.body ?? "")}` : undefined;

  const { signatureString, headerList } = buildSignatureString({
    method,
    resourcePath: opts.resourcePath,
    host: credentials.host,
    date,
    merchantId: credentials.merchantId,
    digest,
  });

  // the secret arrives base64 and is used as RAW BYTES. HMAC-ing the base64
  // text itself is a signature the server will never reproduce.
  const key = Buffer.from(credentials.merchantSecretKey, "base64");
  const signature = createHmac("sha256", key)
    .update(Buffer.from(signatureString, "utf8"))
    .digest("base64");

  const headers: Record<string, string> = {
    "v-c-merchant-id": credentials.merchantId,
    Date: date,
    Host: credentials.host,
    Signature:
      `keyid="${credentials.merchantKeyId}", algorithm="${ALGORITHM}", ` +
      `headers="${headerList}", signature="${signature}"`,
  };

  if (hasBody) {
    headers["Content-Type"] = "application/json";
    headers.Digest = digest as string;
  }

  return { headers, signatureString, digest, date };
}
