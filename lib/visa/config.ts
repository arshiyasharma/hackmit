import { unescapePem } from "./mle";

/**
 * VIC credentials, read from the environment per call.
 *
 * TWO ONBOARDINGS, NOT ONE, and the split matters because it decides how far
 * the demo goes:
 *   - VIC onboarding gives `VISA_VIC_API_KEY`, `VISA_VIC_API_KEY_SS`,
 *     `VISA_EXTERNAL_CLIENT_ID`, `VISA_EXTERNAL_APP_ID`.
 *   - The MLE certificate and key come from a CSR you generate in the
 *     dashboard. `VISA_KEY_ID` is shown beside the certificate, and the CSR
 *     must carry it in the UID field.
 *   - `VISA_ENROLLMENT_REFERENCE_ID` comes out of a VTS card tokenization,
 *     and VTS IS A SEPARATE PRODUCT WITH ITS OWN APPROVAL. Without it you can
 *     still create a mandate; you cannot pull a payment credential.
 *
 * Read per call, never at module load, so a variable added to the environment
 * takes effect without a rebuild.
 */

/** The five things every encrypted VIC call needs. */
export const REQUIRED_VARS = [
  "VISA_VIC_API_KEY",
  "VISA_VIC_API_KEY_SS",
  "VISA_MLE_SERVER_CERT",
  "VISA_MLE_PRIVATE_KEY",
  "VISA_KEY_ID",
] as const;

/** Present in the dashboard, carried on some payloads, not needed to authenticate. */
export const OPTIONAL_VARS = [
  "VISA_EXTERNAL_CLIENT_ID",
  "VISA_EXTERNAL_APP_ID",
  "VISA_CONSUMER_ID",
] as const;

/** The one that comes from the OTHER onboarding. */
export const VTS_VAR = "VISA_ENROLLMENT_REFERENCE_ID" as const;

export interface VicConfig {
  baseUrl: string;
  apiKey: string;
  sharedSecret: string;
  mleServerCert: string;
  mlePrivateKey: string;
  keyId: string;
  /** any stable UUID we choose; kept constant across runs */
  consumerId: string;
  externalClientId: string | null;
  externalAppId: string | null;
}

export class MissingVicCredentialsError extends Error {
  constructor(public readonly missing: string[]) {
    super(
      `Visa Intelligent Commerce is not configured. Missing: ${missing.join(", ")}. ` +
        `These come from your project at developer.visa.com — the API key and shared ` +
        `secret from VIC onboarding, the certificate and key id from the MLE section.`
    );
    this.name = "MissingVicCredentialsError";
  }
}

/** Which required variables are absent. Empty means configured. */
export function missingVicVars(): string[] {
  return REQUIRED_VARS.filter((name) => !process.env[name]?.trim());
}

export function hasVicConfig(): boolean {
  return missingVicVars().length === 0;
}

/** The VTS half. Absent is the expected case, not an error. */
export function enrollmentReferenceId(): string | null {
  return process.env[VTS_VAR]?.trim() || null;
}

export function loadVicConfig(): VicConfig {
  const missing = missingVicVars();
  if (missing.length) throw new MissingVicCredentialsError(missing);

  const env = process.env;
  const baseUrl = (env.VISA_API_BASE_URL?.trim() || "https://sandbox.api.visa.com").replace(
    /\/+$/,
    ""
  );

  return {
    baseUrl,
    apiKey: env.VISA_VIC_API_KEY!.trim(),
    sharedSecret: env.VISA_VIC_API_KEY_SS!.trim(),
    mleServerCert: unescapePem(env.VISA_MLE_SERVER_CERT!),
    mlePrivateKey: unescapePem(env.VISA_MLE_PRIVATE_KEY!),
    keyId: env.VISA_KEY_ID!.trim(),
    // stable across runs on purpose: Visa correlates a consumer by this
    consumerId: env.VISA_CONSUMER_ID?.trim() || "4a1b1c22-5f3a-4a3a-9f1a-0d1e2f3a4b5c",
    externalClientId: env.VISA_EXTERNAL_CLIENT_ID?.trim() || null,
    externalAppId: env.VISA_EXTERNAL_APP_ID?.trim() || null,
  };
}
