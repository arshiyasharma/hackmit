/**
 * The agent registry — a local stand-in for Visa's.
 *
 * WHAT REAL TAP DOES: a merchant takes the `keyId` off the `Signature-Input`
 * header and resolves it against Visa's registry over the network, which
 * answers with the agent's identity and its public key. An agent nobody has
 * registered gets refused before any signature maths happens.
 *
 * WHAT WE DO: the same lookup against `data/tap-registry.json`, committed. We
 * are not building the network half, and the file says so out loud rather than
 * implying we resolved something we did not.
 *
 * THIS FILE IS THE ONLY SOURCE OF TRUTH FOR A KEY, on purpose. It would be
 * convenient to fall back to `TAP_ED25519_PUBLIC_KEY` when the registry has no
 * entry, and it would also mean the merchant side verifies against a key the
 * agent handed it — which proves nothing at all. Delete the entry and every
 * signature fails as `unknown-key`. That is the correct behaviour and it is
 * worth being able to demonstrate.
 *
 * Public keys only. A private key in here would be a committed secret.
 */

import registry from "@/data/tap-registry.json";

export interface RegisteredAgent {
  agentId: string;
  agentName: string;
  /** SPKI PEM. May carry escaped `\n`, exactly like the environment variables. */
  publicKeyPem: string;
  /** ISO 8601 */
  registeredAt: string;
}

/** `\n` typed as two characters becomes a real newline; real newlines are left alone. */
function unescapePem(value: string): string {
  return value.replace(/\\n/g, "\n").trim();
}

function toAgent(raw: unknown): RegisteredAgent | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const agentId = typeof r.agentId === "string" ? r.agentId.trim() : "";
  const agentName = typeof r.agentName === "string" ? r.agentName.trim() : "";
  const publicKeyPem =
    typeof r.publicKeyPem === "string" ? unescapePem(r.publicKeyPem) : "";
  const registeredAt =
    typeof r.registeredAt === "string" ? r.registeredAt.trim() : "";

  if (!agentId || !publicKeyPem) return null;
  // a private key here would be a committed secret; refuse the entry outright
  if (publicKeyPem.includes("PRIVATE KEY")) return null;

  return { agentId, agentName: agentName || agentId, publicKeyPem, registeredAt };
}

/** Built once at module load, frozen, keyed by keyId. */
const KEYS: ReadonlyMap<string, RegisteredAgent> = new Map(
  Object.entries(
    (registry.keys ?? {}) as Record<string, unknown>
  ).flatMap(([keyId, raw]) => {
    const agent = toAgent(raw);
    return agent ? [[keyId, agent] as const] : [];
  })
);

/**
 * Who owns this key, or undefined.
 *
 * Undefined is a verdict, not an error: the verifier turns it into
 * `unknown-key`, which is the reason a merchant would give.
 */
export function lookupKey(keyId: string): RegisteredAgent | undefined {
  return KEYS.get(keyId);
}

/** Every registered keyId. For the health check and the demo endpoint. */
export function registeredKeyIds(): string[] {
  return [...KEYS.keys()];
}
