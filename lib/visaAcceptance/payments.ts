import { randomUUID } from "node:crypto";

import { minorToDecimalString } from "@/lib/money";

import { signRequest, type MerchantCredentials } from "./httpSignature";

/**
 * A real card authorization against a Visa-operated sandbox.
 *
 * Sends a signed authorization request to the configured, allowlisted Visa
 * Acceptance test endpoint and reports Visa's response and reconciliation id.
 * Credentials may belong to our own sandbox merchant or to Visa's published
 * shared test merchant; this module does not infer account ownership.
 *
 * The card and billing data are Visa's published test fixtures. Nothing is
 * captured: `capture: false` prevents capture, and no real money moves.
 * A successful response proves sandbox authorization, not VIC enrollment or
 * a retailer order.
 *
 * Server only. The shared secret must never reach the browser.
 */

/** Visa's published test PAN. Not a card, not anybody's, and widely documented. */
const TEST_CARD = {
  number: "4111111111111111",
  expirationMonth: "12",
  expirationYear: "2031",
} as const;

/** The sample billing address from Visa's own examples. Required by the API. */
const TEST_BILL_TO = {
  firstName: "John",
  lastName: "Doe",
  address1: "1 Market St",
  locality: "san francisco",
  administrativeArea: "CA",
  postalCode: "94105",
  country: "US",
  email: "test@cybs.com",
  phoneNumber: "4158880000",
} as const;

const PAYMENTS_PATH = "/pts/v2/payments";

export class MissingAcceptanceCredentialsError extends Error {
  constructor(public readonly missing: string[]) {
    super(
      `Visa Acceptance is not configured. Missing: ${missing.join(", ")}. ` +
        `Visa publishes shared sandbox values in Data/Configuration.js of ` +
        `github.com/CyberSource/cybersource-rest-samples-node — put them in .env.local.`
    );
    this.name = "MissingAcceptanceCredentialsError";
  }
}

/**
 * Credentials from the environment, read per call rather than at module load.
 *
 * `VA_RUN_ENVIRONMENT` may be written as a bare host or with a scheme; both
 * are accepted and reduced to a host, because the signature covers the host
 * and a stray `https://` in there signs a string the server will not rebuild.
 */
export function getCredentials(): MerchantCredentials {
  const env = process.env;
  const missing = (
    ["VA_MERCHANT_ID", "VA_MERCHANT_KEY_ID", "VA_MERCHANT_SECRET_KEY"] as const
  ).filter((name) => !env[name]?.trim());
  if (missing.length) throw new MissingAcceptanceCredentialsError(missing);

  const raw = env.VA_RUN_ENVIRONMENT?.trim() || "apitest.visaacceptance.com";
  const host = raw.replace(/^https?:\/\//, "").replace(/\/.*$/, "");

  if (!["apitest.visaacceptance.com", "apitest.cybersource.com"].includes(host.toLowerCase())) {
    throw new Error("Only the Visa Acceptance test sandbox is enabled in this demo.");
  }
  return {
    merchantId: env.VA_MERCHANT_ID!.trim(),
    merchantKeyId: env.VA_MERCHANT_KEY_ID!.trim(),
    merchantSecretKey: env.VA_MERCHANT_SECRET_KEY!.trim(),
    host,
  };
}

export function hasCredentials(): boolean {
  try {
    getCredentials();
    return true;
  } catch {
    return false;
  }
}

export interface AuthorizationRequest {
  amountMinor: number;
  currency: string;
  /** our own reference — the checkout line this is for */
  clientReferenceCode: string;
}

/**
 * The request body.
 *
 * `capture: false` IS NOT A DETAIL. Authorization places a hold and nothing
 * more; capture is what moves money. This never captures, there is no code
 * path in this repo that captures, and that is the honest answer to "are you
 * charging anything".
 */
export function buildAuthorizationPayload(request: AuthorizationRequest) {
  return {
    clientReferenceInformation: { code: request.clientReferenceCode },
    processingInformation: { capture: false },
    paymentInformation: { card: { ...TEST_CARD } },
    orderInformation: {
      amountDetails: {
        totalAmount: minorToDecimalString(request.amountMinor),
        currency: request.currency,
      },
      billTo: { ...TEST_BILL_TO },
    },
  };
}

export interface AuthorizationResult {
  /** `AUTHORIZED`, `DECLINED`, `INVALID_REQUEST`, … straight from Visa */
  status: string;
  /** Visa's own id for the transaction */
  id: string | null;
  reconciliationId: string | null;
  authorizedAmount: string | null;
  currency: string | null;
  approvalCode: string | null;
  /** the id Visa support asks for. Logged on every outcome. */
  correlationId: string | null;
  httpStatus: number;
  /** present only when Visa refused the request */
  message: string | null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

/**
 * Authorize, and hand back the parts worth showing.
 *
 * THE RESPONSE IS NEVER LOGGED WHOLE. It echoes a masked PAN and transaction
 * detail, and a log line is the easiest way to leak something you did not mean
 * to. The correlation id and the status are logged; the body is not.
 */
export async function authorize(
  request: AuthorizationRequest
): Promise<AuthorizationResult> {
  if (!Number.isSafeInteger(request.amountMinor) || request.amountMinor <= 0 || request.amountMinor > 100_000_000 || request.currency !== "USD") {
    throw new Error("Invalid sandbox authorization amount or currency.");
  }
  const credentials = getCredentials();
  const body = JSON.stringify(buildAuthorizationPayload(request));

  const signed = signRequest({
    method: "POST",
    resourcePath: PAYMENTS_PATH,
    body,
    credentials,
  });

  const response = await fetch(`https://${credentials.host}${PAYMENTS_PATH}`, {
    method: "POST",
    headers: { ...signed.headers, "v-c-correlation-id": randomUUID() },
    body,
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(8_000),
  });

  const correlationId =
    response.headers.get("v-c-correlation-id") ??
    response.headers.get("v-c-response-id");

  const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;

  const order = (json.orderInformation ?? {}) as Record<string, unknown>;
  const amountDetails = (order.amountDetails ?? {}) as Record<string, unknown>;
  const processor = (json.processorInformation ?? {}) as Record<string, unknown>;

  const result: AuthorizationResult = {
    status: str(json.status) ?? `HTTP_${response.status}`,
    id: str(json.id),
    reconciliationId: str(json.reconciliationId),
    authorizedAmount: str(amountDetails.authorizedAmount) ?? str(amountDetails.totalAmount),
    currency: str(amountDetails.currency),
    approvalCode: str(processor.approvalCode),
    correlationId,
    httpStatus: response.status,
    message: response.ok ? null : str(json.message) ?? str(json.reason),
  };

  // status and correlation id only. Never the body.
  console.info(
    `[visaAcceptance] ${PAYMENTS_PATH} ${response.status} ${result.status} ` +
      `correlation=${correlationId ?? "none"}`
  );

  return result;
}
