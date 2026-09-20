import { randomUUID } from "node:crypto";

import { loadVicConfig } from "./config";
import { decryptPayload, encryptPayload } from "./mle";
import { createXPayToken } from "./xpay";

/**
 * One request function, used by every VIC call.
 *
 * THE ORDER IS THE WHOLE THING, and it is the order Visa's own client uses:
 *   1. build the URL with `?apikey=`
 *   2. ENCRYPT the body into `{ encData }` and stringify THAT
 *   3. compute the X-Pay token over the encrypted string, not the plaintext
 *   4. send with `x-pay-token`, `x-request-id` and `keyId`
 *   5. keep `x-correlation-id` off the response, whatever happened
 *   6. decrypt the body on success AND on failure — VIC encrypts errors too
 *
 * THE HEADER IS SPELLED `keyId`. Camel-cased, not `key-id`, not `keyid`.
 *
 * NOTHING IN HERE LOGS A BODY. The credentials endpoint returns a PAN or a
 * token and a dynamic CVV, and Visa's own example carries a comment saying so.
 * The correlation id and the status are logged; the payload never is.
 */

/** The six VIC operations, exactly as `@visa/api-client` calls them. */
export const VIC_ENDPOINTS = {
  enrollCard: "/vacp/v1/cards",
  instructions: "/vacp/v1/instructions",
  instruction: (id: string) => `/vacp/v1/instructions/${encodeURIComponent(id)}`,
  cancel: (id: string) => `/vacp/v1/instructions/${encodeURIComponent(id)}/cancel`,
  credentials: (id: string) => `/vacp/v1/instructions/${encodeURIComponent(id)}/credentials`,
  confirmations: (id: string) =>
    `/vacp/v1/instructions/${encodeURIComponent(id)}/confirmations`,
} as const;

export interface VicResponse<T = unknown> {
  data: T;
  /** the only id Visa support can act on. Present on success and on failure. */
  correlationId: string | null;
  httpStatus: number;
}

/**
 * A VIC call that came back non-2xx.
 *
 * Carries the correlation id and the DECRYPTED body, because an error body
 * nobody decrypted is unreadable and sends you after the wrong problem.
 */
export class VicApiError extends Error {
  constructor(
    message: string,
    public readonly httpStatus: number,
    public readonly correlationId: string | null,
    public readonly body: unknown
  ) {
    super(message);
    this.name = "VicApiError";
  }
}

function correlationOf(response: Response): string | null {
  return (
    response.headers.get("x-correlation-id") ??
    response.headers.get("X-CORRELATION-ID") ??
    null
  );
}

/** Visa's error bodies put the readable part under `responseStatus`. */
function describe(body: unknown, httpStatus: number): string {
  const status = (body as { responseStatus?: Record<string, unknown> } | null)
    ?.responseStatus;
  const reason = typeof status?.reason === "string" ? status.reason : null;
  const message = typeof status?.message === "string" ? status.message : null;
  return [reason, message].filter(Boolean).join(" — ") || `VIC returned ${httpStatus}`;
}

export async function vicRequest<T = unknown>(
  method: "GET" | "POST" | "PUT" | "DELETE",
  endpoint: string,
  body?: Record<string, unknown>
): Promise<VicResponse<T>> {
  const config = loadVicConfig();

  const url = `${config.baseUrl}${endpoint}?apikey=${encodeURIComponent(config.apiKey)}`;

  // encrypt, THEN sign. The token covers what goes on the wire.
  let wire = "";
  if (body) {
    const encrypted = await encryptPayload(body, config.mleServerCert, config.keyId);
    wire = JSON.stringify(encrypted);
  }

  const token = createXPayToken({
    sharedSecret: config.sharedSecret,
    requestUrl: url,
    body: wire,
  });

  const response = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      "x-pay-token": token,
      "x-request-id": randomUUID(),
      // camel-cased. Not key-id.
      keyId: config.keyId,
    },
    ...(wire ? { body: wire } : {}),
    cache: "no-store",
  });

  const correlationId = correlationOf(response);
  const raw = (await response.json().catch(() => null)) as unknown;

  // status and correlation id only, on every path. Never the body.
  console.info(
    `[visa] ${method} ${endpoint} ${response.status} correlation=${correlationId ?? "none"}`
  );

  let data: unknown = raw;
  if (raw && typeof raw === "object" && "encData" in (raw as object)) {
    try {
      data = await decryptPayload(raw, config.mlePrivateKey, config.keyId);
    } catch (error) {
      // an undecryptable body is worth saying out loud — but only that it
      // failed, never what was in it
      console.error(
        `[visa] could not decrypt ${response.status} body correlation=${correlationId ?? "none"}`,
        error instanceof Error ? error.message : "unknown"
      );
    }
  }

  if (!response.ok) {
    throw new VicApiError(describe(data, response.status), response.status, correlationId, data);
  }

  return { data: data as T, correlationId, httpStatus: response.status };
}
