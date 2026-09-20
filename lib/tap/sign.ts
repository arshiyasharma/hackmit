import { randomUUID, sign as cryptoSign, createPrivateKey } from "node:crypto";

import { getAgentKeys } from "./keys";

/**
 * RFC 9421 HTTP Message Signatures, the Trusted Agent Protocol flavour.
 *
 * WHAT THIS PROVES, and it is three things in one signature: that a registered
 * agent made the request, that it is acting for an authenticated human, and
 * that it is authorised for THIS operation on THIS domain. The signature is
 * bound to the merchant's authority and path and carries `created`, `expires`
 * and a `nonce`, so it cannot be replayed against another merchant or reused
 * later.
 *
 * PORTED, NOT COPIED, from Visa's own sample at
 * github.com/visa/trusted-agent-protocol, `tap-agent/agent_app.py`. Its
 * `create_http_message_signature` (line 60) builds the same three-line base;
 * `create_ed25519_signature` (line 1321) is the Ed25519 variant and is what
 * this matches. That repo is Python — FastAPI, Streamlit and Playwright — and
 * none of it is in ours.
 *
 * ED25519, NOT RSA-PSS. The sample's default path declares
 * `alg="rsa-pss-sha256"` under the label `sig2`, and its own README calls
 * Ed25519 the recommended algorithm. Ed25519 is one `crypto.sign` call against
 * a page of PSS padding configuration, so that is what we use, under `sig1`.
 *
 * THE ONE BUG THIS FILE EXISTS TO AVOID: the `@signature-params` value inside
 * the signature base must be BYTE-IDENTICAL to what follows the label in the
 * `Signature-Input` header. Format it twice and you get a signature that fails
 * verification with no clue why. It is built once below, into `params`, and
 * every other use reads that variable.
 */

export type TapTag = "browsing" | "payment";

/** One label, both headers. The sample uses `sig2` for its RSA path; we do not. */
export const SIGNATURE_LABEL = "sig1";

/** Five minutes. Long enough for a slow page, short enough to make replay concrete. */
export const SIGNATURE_WINDOW_SECONDS = 300;

/** The covered components, in order. Also the literal text inside the params string. */
export const COVERED_COMPONENTS = '("@authority" "@path")';

export interface TapSignature {
  /** `sig1=("@authority" "@path"); created=...; ...` — the Signature-Input header value */
  signatureInput: string;
  /** `sig1=:<base64>:` — the Signature header value */
  signature: string;
  nonce: string;
  /** unix seconds */
  expiresAt: number;
  /** unix seconds */
  createdAt: number;
  keyId: string;
  /**
   * The exact three lines that were signed. Not in the prompt's return type,
   * added because the tamper demo has to SHOW them — a signature nobody can
   * read is a claim, and the whole point is to make it checkable on stage.
   */
  signatureBase: string;
}

/**
 * Host and path, the way the sample's `parse_url_components` does it — with
 * one deliberate difference.
 *
 * `authority` is the host including a non-default port, which is Python's
 * `netloc`. Identical.
 *
 * `path` is the PATHNAME ONLY. Visa's sample appends `?<query>` to the path
 * when the URL has one (agent_app.py line 124). Our build document specifies
 * the pathname, and both sides of our own protocol — this signer and the
 * verifier beside it — use this one function, so they cannot disagree. If you
 * want the query covered as well, change it here and nowhere else.
 */
export function toAuthorityAndPath(targetUrl: string): {
  authority: string;
  path: string;
} {
  const url = new URL(targetUrl);
  return { authority: url.host, path: url.pathname };
}

/**
 * The three lines, joined by `\n`. The verifier rebuilds the base with this
 * same function from the params it parsed off the header, which is the only
 * way the two ends can be guaranteed byte-identical.
 */
export function buildSignatureBase(
  authority: string,
  path: string,
  params: string
): string {
  return [
    `"@authority": ${authority}`,
    `"@path": ${path}`,
    `"@signature-params": ${params}`,
  ].join("\n");
}

export interface SignatureParams {
  created: number;
  expires: number;
  keyId: string;
  nonce: string;
  tag: string;
}

/** The params string. Built here, once, and never formatted a second time. */
export function buildSignatureParams({
  created,
  expires,
  keyId,
  nonce,
  tag,
}: SignatureParams): string {
  return (
    `${COVERED_COMPONENTS}; created=${created}; expires=${expires}; ` +
    `keyId="${keyId}"; alg="ed25519"; nonce="${nonce}"; tag="${tag}"`
  );
}

export interface SignRequestOptions {
  /** unix seconds; defaults to now. Only the tamper demo and tests pass this. */
  created?: number;
  nonce?: string;
}

/**
 * Sign a request this agent is about to make to `targetUrl`.
 *
 * `tag` has no default and never will. "browsing" is reading a product page,
 * "payment" is checking out, and sending the wrong one is exactly what the
 * merchant's verifier should catch — a default would hide that.
 */
export function signRequest(
  targetUrl: string,
  tag: TapTag,
  options: SignRequestOptions = {}
): TapSignature {
  const { privateKeyPem, keyId } = getAgentKeys();
  const { authority, path } = toAuthorityAndPath(targetUrl);

  const created = options.created ?? Math.floor(Date.now() / 1000);
  const expires = created + SIGNATURE_WINDOW_SECONDS;
  const nonce = options.nonce ?? randomUUID();

  const params = buildSignatureParams({ created, expires, keyId, nonce, tag });
  const signatureBase = buildSignatureBase(authority, path, params);

  // Ed25519 takes a null digest algorithm — it hashes internally, and passing
  // "sha256" here throws rather than doing anything useful.
  const raw = cryptoSign(
    null,
    Buffer.from(signatureBase, "utf8"),
    createPrivateKey(privateKeyPem)
  );

  return {
    signatureInput: `${SIGNATURE_LABEL}=${params}`,
    signature: `${SIGNATURE_LABEL}=:${raw.toString("base64")}:`,
    nonce,
    expiresAt: expires,
    createdAt: created,
    keyId,
    signatureBase,
  };
}

/** The two headers, ready to spread into a fetch's `headers`. */
export function signatureHeaders(signed: TapSignature): Record<string, string> {
  return {
    "Signature-Input": signed.signatureInput,
    Signature: signed.signature,
  };
}
