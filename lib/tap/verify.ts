import { createPublicKey, verify as cryptoVerify } from "node:crypto";

import { lookupKey } from "./registry";
import {
  buildSignatureBase,
  COVERED_COMPONENTS,
  SIGNATURE_LABEL,
  type TapTag,
} from "./sign";

/**
 * The merchant's half of the Trusted Agent Protocol.
 *
 * `sign.ts` is us proving who we are. This is the shop deciding whether to
 * believe it, and it shares exactly one thing with the signer —
 * `buildSignatureBase` — because the two ends have to produce a byte-identical
 * string or the maths cannot work. Everything else here is reconstructed from
 * the headers alone, which is the whole point: a verifier that needed the
 * signer's variables would be verifying nothing.
 *
 * A VERDICT, NEVER A BOOLEAN. `true`/`false` throws away the only interesting
 * part. "Refused because the signature had expired" and "refused because I
 * have never heard of this agent" are different conversations, and the demo is
 * built on being able to show which one happened.
 *
 * WHAT `declaredUrl` IS FOR, because it is not in RFC 9421. In a real
 * deployment the merchant knows the authority and path because the request
 * physically arrived at them, and an agent that signed somebody else's domain
 * simply gets `bad-signature` — the failure is real but the reason is mute.
 * Our stand-in merchant is a separate endpoint, so the agent tells it which
 * URL it signed for, and we can distinguish "signed for another shop" from
 * "signed wrong". Leave `declaredUrl` out and checks 4 and 5 are skipped;
 * a mismatch still fails, as `bad-signature`.
 */

/** Every way a merchant can refuse. The first failure found is the one reported. */
export type TapFailure =
  | "unknown-key"
  | "malformed"
  | "expired"
  | "bad-signature"
  | "authority-mismatch"
  | "path-mismatch";

export type TapVerdict =
  | { ok: true; agentId: string; agentName: string; tag: string; expiresAt: number }
  | { ok: false; reason: TapFailure };

export interface VerifyRequestInput {
  /** the `Signature-Input` header, verbatim */
  signatureInput: string;
  /** the `Signature` header, verbatim */
  signature: string;
  /** the host this request actually arrived at — the merchant's own */
  authority: string;
  /** the path this request actually arrived at */
  path: string;
  /** the URL the agent says it signed. Absent → checks 4 and 5 are skipped. */
  declaredUrl?: string;
  /** unix seconds. Tests and the tamper demo pass this; nothing else should. */
  now?: number;
}

export interface ParsedSignatureInput {
  /** the params string, byte-for-byte as it arrived. Reused, never reformatted. */
  params: string;
  created: number;
  expires: number;
  keyId: string;
  alg: string;
  nonce: string;
  tag: string;
}

function refuse(reason: TapFailure): TapVerdict {
  return { ok: false, reason };
}

/** `created=1758330000` and friends — a bare integer of at most 12 digits. */
function intParam(params: string, name: string): number | null {
  const match = params.match(new RegExp(`(?:^|;)\\s*${name}=(\\d{1,12})(?=\\s*(?:;|$))`));
  return match ? Number(match[1]) : null;
}

/** `keyId="vra-key-1"` — a quoted string. */
function strParam(params: string, name: string): string | null {
  const match = params.match(new RegExp(`(?:^|;)\\s*${name}="([^"]*)"`));
  return match ? match[1] : null;
}

/**
 * Take `Signature-Input` apart. Null means malformed, and malformed covers an
 * algorithm we cannot check as well as a header we cannot read — we are not
 * going to quietly accept an `alg` we never verified.
 */
export function parseSignatureInput(
  signatureInput: string
): ParsedSignatureInput | null {
  const prefix = `${SIGNATURE_LABEL}=`;
  if (typeof signatureInput !== "string" || !signatureInput.startsWith(prefix)) {
    return null;
  }

  const params = signatureInput.slice(prefix.length).trim();

  // we cover exactly these two components; a longer or different list is a
  // signature over something we did not agree to check
  if (!params.startsWith(COVERED_COMPONENTS)) return null;

  const created = intParam(params, "created");
  const expires = intParam(params, "expires");
  const keyId = strParam(params, "keyId");
  const alg = strParam(params, "alg");
  const nonce = strParam(params, "nonce");
  const tag = strParam(params, "tag");

  if (created === null || expires === null) return null;
  if (!keyId || !alg || !nonce || !tag) return null;
  if (alg !== "ed25519") return null;

  return { params, created, expires, keyId, alg, nonce, tag };
}

/** `sig1=:<base64>:` → the raw bytes, or null. */
export function parseSignature(signature: string): Buffer | null {
  if (typeof signature !== "string") return null;
  const match = signature.match(
    new RegExp(`^${SIGNATURE_LABEL}=:([A-Za-z0-9+/=]+):$`)
  );
  if (!match) return null;
  const raw = Buffer.from(match[1], "base64");
  // Ed25519 signatures are 64 bytes. Anything else never came from our signer.
  return raw.length === 64 ? raw : null;
}

function hostOf(url: string): { authority: string; path: string } | null {
  try {
    const parsed = new URL(url);
    return { authority: parsed.host, path: parsed.pathname };
  } catch {
    return null;
  }
}

function sameHost(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * Decide whether to serve this agent.
 *
 * The order of the checks is the contract, because the FIRST failure is the
 * one reported and a merchant should answer with the cheapest true reason:
 *   1. can I read the header at all?          → malformed
 *   2. do I know this key?                    → unknown-key
 *   3. is it still in date?                   → expired
 *   4. was it made for me?                    → authority-mismatch   (anti-relay)
 *   5. was it made for this page?             → path-mismatch
 *   6. does the signature check out?          → bad-signature
 *
 * 4 before 6 on purpose. A signature captured at one shop and replayed at
 * another fails either way, but "that was made for somebody else" is the
 * answer that explains what happened, and it is the one worth showing.
 */
export function verifyRequest(input: VerifyRequestInput): TapVerdict {
  const parsed = parseSignatureInput(input.signatureInput);
  if (!parsed) return refuse("malformed");

  const raw = parseSignature(input.signature);
  if (!raw) return refuse("malformed");

  const agent = lookupKey(parsed.keyId);
  if (!agent) return refuse("unknown-key");

  const now = input.now ?? Math.floor(Date.now() / 1000);
  if (parsed.expires < now) return refuse("expired");

  if (input.declaredUrl !== undefined) {
    const declared = hostOf(input.declaredUrl);
    if (!declared) return refuse("malformed");
    if (!sameHost(declared.authority, input.authority)) {
      return refuse("authority-mismatch");
    }
    if (declared.path !== input.path) return refuse("path-mismatch");
  }

  // rebuilt from the params EXACTLY as they arrived, against the authority and
  // path this request really landed on. Reformatting the params here is the
  // classic RFC 9421 bug; `parsed.params` is the untouched substring.
  const base = buildSignatureBase(input.authority, input.path, parsed.params);

  let verified = false;
  try {
    verified = cryptoVerify(
      null,
      Buffer.from(base, "utf8"),
      createPublicKey(agent.publicKeyPem),
      raw
    );
  } catch {
    // an unusable public key in the registry is our problem, not the agent's,
    // but the honest answer to the request is still "this did not verify"
    verified = false;
  }
  if (!verified) return refuse("bad-signature");

  return {
    ok: true,
    agentId: agent.agentId,
    agentName: agent.agentName,
    tag: parsed.tag,
    expiresAt: parsed.expires,
  };
}

/**
 * Was this signature made for the operation being attempted?
 *
 * Separate from `verifyRequest` because it is policy, not cryptography. The
 * signature over `tag="browsing"` is perfectly valid — it just does not
 * authorise a purchase, and the merchant is the one who decides that. A
 * browsing signature presented at checkout is exactly the case worth catching.
 */
export function acceptsTag(verdict: TapVerdict, requiredTag: TapTag): boolean {
  return verdict.ok && verdict.tag === requiredTag;
}

/** One sentence a person could read aloud. Used on a failed checkout line. */
export function failureSentence(reason: TapFailure): string {
  switch (reason) {
    case "unknown-key":
      return "the shop does not recognise this agent";
    case "malformed":
      return "the shop could not read the agent's signature";
    case "expired":
      return "the agent's signature had already expired";
    case "authority-mismatch":
      return "that signature was made for a different shop";
    case "path-mismatch":
      return "that signature was made for a different page";
    case "bad-signature":
      return "the agent's signature did not check out";
  }
}
