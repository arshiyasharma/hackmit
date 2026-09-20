import { describe, expect, it } from "vitest";

import type { BasketLine, Retailer } from "@/lib/checkout/types";

import {
  buildConfirmationPayload,
  buildRetrievePaymentCredentialsPayload,
  last4Of,
  lineTotalDecimal,
  merchantUrlFor,
  type TransactionOutcome,
} from "./credentials";

const CONTEXT = { clientReferenceId: "ref-1", clientDeviceId: "dev-1" };

function line(patch: Partial<BasketLine> = {}, retailer: Retailer = "ikea"): BasketLine {
  return {
    lineId: "line-1",
    placementId: "place-1",
    listingId: "listing-1",
    retailer,
    title: "a tall lamp",
    productUrl: "https://www.ikea.com/us/en/p/lamp-70437814/",
    imageUrl: "",
    priceMinor: 12000,
    currency: "USD",
    dimensionsMm: null,
    quantity: 1,
    ...patch,
  };
}

/** What Visa actually sends back. Never let this shape out of a route. */
const CREDENTIAL_RESPONSE = {
  data: {
    clientReferenceId: "ref-1",
    instructionId: "instr-1",
    transactionCredentials: {
      cardNumber: "4514170000000001",
      expirationDate: "2030-12",
      securityCode: "123",
    },
    status: "SUCCESS",
  },
};

describe("last4Of — the only function allowed to read a credential", () => {
  it("returns four characters and not one more", () => {
    const last4 = last4Of(CREDENTIAL_RESPONSE);
    expect(last4).toBe("0001");
    expect(last4).toHaveLength(4);
  });

  it("reads a network token as well as a PAN", () => {
    expect(last4Of({ data: { transactionCredentials: { token: "9900000000004242" } } })).toBe(
      "4242"
    );
  });

  it("works whether or not the response is wrapped in data", () => {
    expect(last4Of(CREDENTIAL_RESPONSE.data)).toBe("0001");
  });

  it("is null rather than a guess when there is no credential", () => {
    expect(last4Of(null)).toBeNull();
    expect(last4Of({})).toBeNull();
    expect(last4Of({ data: {} })).toBeNull();
    expect(last4Of({ data: { transactionCredentials: {} } })).toBeNull();
    expect(last4Of({ data: { transactionCredentials: { cardNumber: "12" } } })).toBeNull();
  });

  it("never returns the expiry or the security code", () => {
    const last4 = last4Of(CREDENTIAL_RESPONSE) ?? "";
    expect(last4).not.toContain("2030");
    expect(last4).not.toBe("123");
    expect(CREDENTIAL_RESPONSE.data.transactionCredentials.cardNumber).not.toBe(last4);
  });
});

describe("the route's response body can carry nothing card-shaped", () => {
  /** Exactly what POST /api/visa/credentials returns, and all it returns. */
  const responseBody = {
    ok: true,
    transactionReferenceId: "8f14e45f-ceea-467a-9575-1c1f9f7f9a11",
    last4: last4Of(CREDENTIAL_RESPONSE),
  };

  it("has exactly three fields", () => {
    expect(Object.keys(responseBody).sort()).toEqual(["last4", "ok", "transactionReferenceId"]);
  });

  it("contains no run of digits that could be a card number", () => {
    const flat = JSON.stringify(responseBody);
    // a PAN is 13-19 digits; the reference is a uuid, whose digit runs are short
    expect(flat).not.toMatch(/\d{13,19}/);
  });

  it("contains no field longer than four characters that looks like a number", () => {
    for (const value of Object.values(responseBody)) {
      if (typeof value !== "string") continue;
      const digitsOnly = value.replace(/\D/g, "");
      if (digitsOnly.length > 4) {
        // the only long field is the uuid, which is not all digits
        expect(value).toMatch(/[a-f-]/);
      }
    }
  });

  it("carries none of the credential's own fields", () => {
    const flat = JSON.stringify(responseBody).toLowerCase();
    expect(flat).not.toContain("cardnumber");
    expect(flat).not.toContain("securitycode");
    expect(flat).not.toContain("expirationdate");
    expect(flat).not.toContain("transactioncredentials");
    expect(flat).not.toContain(CREDENTIAL_RESPONSE.data.transactionCredentials.cardNumber);
  });
});

describe("buildRetrievePaymentCredentialsPayload", () => {
  const payload = buildRetrievePaymentCredentialsPayload({
    tokenId: "token-1",
    transactionReferenceId: "txn-1",
    context: CONTEXT,
    line: line({ priceMinor: 3500, quantity: 2 }, "wayfair"),
    instructionId: "instr-1",
  });
  const transaction = (payload.transactionData as Array<Record<string, unknown>>)[0];

  it("carries the token, the instruction and the transaction reference", () => {
    expect(payload.tokenId).toBe("token-1");
    expect(payload.instructionId).toBe("instr-1");
    expect(transaction.transactionReferenceId).toBe("txn-1");
    expect(transaction.transactionType).toBe("PURCHASE");
  });

  it("asks for the LINE's total, quantity included", () => {
    expect(transaction.transactionAmount).toEqual({
      transactionCurrencyCode: "USD",
      transactionAmount: "70.00",
    });
  });

  it("names the real shop, not Visa's sample Best Buy", () => {
    expect(transaction.merchantName).toBe("Wayfair");
    expect(transaction.merchantName).not.toBe("Best Buy");
  });

  it("sends the listing's own origin as the merchant url", () => {
    const ikeaPayload = buildRetrievePaymentCredentialsPayload({
      tokenId: "t",
      transactionReferenceId: "r",
      context: CONTEXT,
      line: line(),
    });
    const ikeaTransaction = (
      ikeaPayload.transactionData as Array<Record<string, unknown>>
    )[0];
    expect(ikeaTransaction.merchantUrl).toBe("https://www.ikea.com");
    expect(ikeaTransaction.merchantName).toBe("IKEA");
  });

  it("omits the instruction id when there is not one", () => {
    expect(
      buildRetrievePaymentCredentialsPayload({
        tokenId: "t",
        transactionReferenceId: "r",
        context: CONTEXT,
        line: line(),
      })
    ).not.toHaveProperty("instructionId");
  });
});

describe("buildConfirmationPayload — what actually happened", () => {
  const outcome: TransactionOutcome = {
    approved: true,
    amount: "120.00",
    authorizationCode: "660490",
    retrievalReferenceNumber: "7898719049626280604805",
    orderRef: "TEST-IKEA-6F3DC970",
  };

  const payload = buildConfirmationPayload({
    transactionReferenceId: "8f14e45f-ceea-467a-9575-1c1f9f7f9a11",
    context: CONTEXT,
    line: line(),
    outcome,
    instructionId: "instr-1",
  });
  const confirmation = (payload.confirmationData as Array<Record<string, unknown>>)[0];
  const payment = confirmation.paymentConfirmationData as Record<string, unknown>;
  const order = confirmation.orderData as Record<string, unknown>;

  it("reports the real authorization's own codes, not invented ones", () => {
    expect(payment.transactionStatus).toBe("APPROVED");
    expect(payment.responseCode).toBe("00");
    expect(payment.authorizationCode).toBe("660490");
    expect(payment.retrievalReferenceNumber).toBe("7898719049626280604805");
    expect(payment.cardEntryMode).toBe("ECOMMERCE");
  });

  it("does NOT say the order completed — no goods were ever ordered", () => {
    expect(order.orderStatus).toBe("PENDING");
    expect(order.orderStatus).not.toBe("COMPLETED");
  });

  it("carries our own TEST- order reference, which says what it is out loud", () => {
    expect(order.orderId).toBe("TEST-IKEA-6F3DC970");
  });

  it("reports DECLINED when the authorization was not approved", () => {
    const declined = buildConfirmationPayload({
      transactionReferenceId: "txn-1",
      context: CONTEXT,
      line: line(),
      outcome: { ...outcome, approved: false, authorizationCode: null },
    });
    const data = (declined.confirmationData as Array<Record<string, unknown>>)[0];
    const paymentData = data.paymentConfirmationData as Record<string, unknown>;
    expect(paymentData.transactionStatus).toBe("DECLINED");
    expect(paymentData.responseCode).toBe("05");
  });

  it("uses the SAME transaction reference it was given", () => {
    expect(confirmation.transactionReferenceId).toBe(
      "8f14e45f-ceea-467a-9575-1c1f9f7f9a11"
    );
  });

  it("claims no carrier and no tracking, because nothing was shipped", () => {
    const shipping = confirmation.shippingData as Record<string, unknown>;
    expect(shipping).not.toHaveProperty("trackingId");
    expect(shipping).not.toHaveProperty("carrier");
  });

  it("timestamps in unix seconds, at most twelve characters", () => {
    for (const value of [payment.transactionTimestamp, order.orderDate, order.expectedDeliveryDate]) {
      expect(typeof value).toBe("string");
      expect((value as string).length).toBeLessThanOrEqual(12);
      expect(value).toMatch(/^\d+$/);
    }
    expect(Number(order.expectedDeliveryDate) - Number(order.orderDate)).toBe(86_400 * 7);
  });

  it("carries no card data of any kind", () => {
    const flat = JSON.stringify(payload).toLowerCase();
    expect(flat).not.toContain("cardnumber");
    expect(flat).not.toContain("securitycode");
    expect(flat).not.toContain("pan");
    expect(JSON.stringify(payload)).not.toMatch(/\b\d{13,19}\b/);
  });
});

describe("helpers", () => {
  it("lineTotalDecimal multiplies by quantity", () => {
    expect(lineTotalDecimal(line({ priceMinor: 3500, quantity: 2 }))).toBe("70.00");
    expect(lineTotalDecimal(line({ priceMinor: 12000 }))).toBe("120.00");
  });

  it("merchantUrlFor is the origin, and null for an unparseable url", () => {
    expect(merchantUrlFor(line())).toBe("https://www.ikea.com");
    expect(merchantUrlFor(line({ productUrl: "nope" }))).toBeNull();
  });
});
