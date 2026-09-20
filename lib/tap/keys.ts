/**
 * The agent's own signing keys, read from the environment.
 *
 * NO FALLBACK, EVER. If a variable is missing this throws and names it. The
 * tempting alternative — generate a key pair when none is configured — makes
 * verification silently meaningless: the key changes per process, the
 * registry never matches it, and the demo shows a green tick that proves
 * nothing. A loud error at startup is the only honest behaviour.
 *
 * PEM IN ENV VARS NEEDS UNESCAPING. A PEM is multi-line and `.env` files are
 * not, so the key is stored with literal backslash-n and turned back into real
 * newlines here. Both shapes are accepted, so a key pasted into a Vercel
 * dashboard field (which keeps real newlines) works too.
 *
 * Server only. Nothing in this file may be imported by a client component —
 * `TAP_ED25519_PRIVATE_KEY` must never reach the browser bundle.
 */

export interface AgentKeys {
  /** PKCS#8 PEM. Never logged, never returned to a caller outside the server. */
  privateKeyPem: string;
  /** SPKI PEM. Safe to publish — this is what a merchant verifies against. */
  publicKeyPem: string;
  /** the short label that goes in `keyId="..."` and that the registry is keyed by */
  keyId: string;
}

class MissingTapEnvError extends Error {
  constructor(variable: string) {
    super(
      `${variable} is not set. Run \`npm run keys:tap\` and paste what it prints into .env.local.`
    );
    this.name = "MissingTapEnvError";
  }
}

/** `\n` typed as two characters becomes a real newline; real newlines are left alone. */
function unescapePem(value: string): string {
  return value.replace(/\\n/g, "\n").trim();
}

function required(variable: string): string {
  const value = process.env[variable];
  if (!value || !value.trim()) throw new MissingTapEnvError(variable);
  return value;
}

/**
 * The agent's key pair and key id.
 *
 * Read per call, not at module load, so a key added to the environment takes
 * effect without a rebuild and a key captured at import time cannot go stale.
 */
export function getAgentKeys(): AgentKeys {
  return {
    privateKeyPem: unescapePem(required("TAP_ED25519_PRIVATE_KEY")),
    publicKeyPem: unescapePem(required("TAP_ED25519_PUBLIC_KEY")),
    keyId: required("TAP_KEY_ID").trim(),
  };
}

/**
 * Who this agent says it is. Stable across restarts on purpose — a merchant
 * that saw us yesterday should recognise us today.
 */
export function getAgentId(): string {
  return required("TAP_AGENT_ID").trim();
}

/** True when every TAP variable is present. For health checks, never for control flow. */
export function hasAgentKeys(): boolean {
  try {
    getAgentKeys();
    getAgentId();
    return true;
  } catch {
    return false;
  }
}
