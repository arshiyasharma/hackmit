import { describe, expect, it } from "vitest";

import { signRequest } from "./httpSignature";
import { buildAuthorizationPayload, getCredentials, hasCredentials } from "./payments";

/**
 * Live tests against `apitest.visaacceptance.com`. OPT-IN, and off by default.
 *
 *   VA_LIVE_TEST=1 npx vitest run lib/visaAcceptance/live.test.ts
 *
 * `npm test` must pass with the wifi off — that is a rehearsal item — so these
 * skip unless the flag is set AND credentials are configured. They exist
 * because two of Prompt 9's claims cannot be proved offline: that the endpoint
 * really authorizes, and that the signature is really doing work.
 *
 * The credentials are Visa's published SHARED TEST MERCHANT, the card is
 * Visa's published test PAN, and nothing is captured.
 */

const live = process.env.VA_LIVE_TEST === "1" && hasCredentials();
const describeLive = live ? describe : describe.skip;

describeLive("the Visa Acceptance sandbox, for real", () => {
  const path = "/pts/v2/payments";

  async function post(body: string, headers: Record<string, string>) {
    const credentials = getCredentials();
    return fetch(`https://${credentials.host}${path}`, { method: "POST", headers, body });
  }

  it("authorizes 12000 cents and answers AUTHORIZED with a reconciliation id", async () => {
    const credentials = getCredentials();
    const body = JSON.stringify(
      buildAuthorizationPayload({
        amountMinor: 12000,
        currency: "USD",
        clientReferenceCode: "VRA-live-test",
      })
    );
    const signed = signRequest({ method: "POST", resourcePath: path, body, credentials });

    const response = await post(body, signed.headers);
    const json = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(201);
    expect(json.status).toBe("AUTHORIZED");
    expect(typeof json.reconciliationId).toBe("string");
    expect(
      (json.orderInformation as { amountDetails: { authorizedAmount: string } }).amountDetails
        .authorizedAmount
    ).toBe("120.00");
  }, 30_000);

  it("refuses the same request when one byte of the body changed after signing", async () => {
    const credentials = getCredentials();
    const body = JSON.stringify(
      buildAuthorizationPayload({
        amountMinor: 12000,
        currency: "USD",
        clientReferenceCode: "VRA-live-test",
      })
    );
    // signed over $120.00...
    const signed = signRequest({ method: "POST", resourcePath: path, body, credentials });
    // ...and $1200.00 is what gets sent. The digest no longer matches.
    const tampered = body.replace('"totalAmount":"120.00"', '"totalAmount":"1200.00"');
    expect(tampered).not.toBe(body);

    const response = await post(tampered, signed.headers);
    expect(response.status).toBe(401);
  }, 30_000);

  it("refuses a signature made with the wrong secret", async () => {
    const credentials = getCredentials();
    const body = JSON.stringify(
      buildAuthorizationPayload({
        amountMinor: 12000,
        currency: "USD",
        clientReferenceCode: "VRA-live-test",
      })
    );
    const signed = signRequest({
      method: "POST",
      resourcePath: path,
      body,
      credentials: { ...credentials, merchantSecretKey: Buffer.from("x".repeat(32)).toString("base64") },
    });

    const response = await post(body, signed.headers);
    expect(response.status).toBe(401);
  }, 30_000);
});
