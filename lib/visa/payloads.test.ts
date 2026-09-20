import { describe, expect, it } from "vitest";

import type { Basket, BasketLine, Retailer } from "@/lib/checkout/types";

import {
  ASSURANCE_DATA_BASE,
  buildCancelPurchaseInstructionPayload,
  buildClientObject,
  buildEnrollCardPayload,
  buildInitiatePurchaseInstructionPayload,
  buildMandates,
  createWorkflowContext,
  describeLines,
  generateEffectiveUntil,
  generateTimestamp,
  MANDATE_TTL_SECONDS,
} from "./payloads";

function line(retailer: Retailer, patch: Partial<BasketLine> = {}): BasketLine {
  return {
    lineId: crypto.randomUUID(),
    placementId: "place-1",
    listingId: "listing-1",
    retailer,
    title: "a tall lamp",
    productUrl: `https://www.${retailer}.com/p/x`,
    imageUrl: "",
    priceMinor: 12000,
    currency: "USD",
    dimensionsMm: null,
    quantity: 1,
    ...patch,
  };
}

function basket(lines: BasketLine[], budgetMinor = 125000): Basket {
  return { basketId: "b1", lines, budgetMinor };
}

const CONTEXT = { clientReferenceId: "ref-1", clientDeviceId: "dev-1" };

/** Every timestamp Visa accepts: unix seconds, as a string, at most 12 chars. */
function expectVisaTimestamp(value: unknown) {
  expect(typeof value).toBe("string");
  const text = value as string;
  expect(text.length).toBeLessThanOrEqual(12);
  expect(text).toMatch(/^\d+$/);
  const seconds = Number(text);
  // somewhere between 2020 and 2050
  expect(seconds).toBeGreaterThan(1_577_836_800);
  expect(seconds).toBeLessThan(2_524_608_000);
}

describe("timestamps", () => {
  it("are unix SECONDS as a string, not milliseconds and not ISO 8601", () => {
    const now = Date.UTC(2026, 8, 19, 22, 0, 0);
    expect(generateTimestamp(now)).toBe("1789855200");
    expectVisaTimestamp(generateTimestamp(now));
    expect(generateTimestamp(now)).not.toContain("T");
  });

  it("never exceed twelve characters", () => {
    expect(generateTimestamp().length).toBeLessThanOrEqual(12);
    expect(generateEffectiveUntil(365 * 24 * 60 * 60).length).toBeLessThanOrEqual(12);
  });

  it("generateEffectiveUntil is that many seconds into the future", () => {
    const now = Date.UTC(2026, 8, 19, 22, 0, 0);
    expect(Number(generateEffectiveUntil(3600, now)) - Number(generateTimestamp(now))).toBe(
      3600
    );
  });
});

describe("createWorkflowContext", () => {
  it("is two distinct uuids", () => {
    const context = createWorkflowContext();
    expect(context.clientReferenceId).toMatch(/^[0-9a-f-]{36}$/);
    expect(context.clientDeviceId).toMatch(/^[0-9a-f-]{36}$/);
    expect(context.clientReferenceId).not.toBe(context.clientDeviceId);
  });

  it("is different every call — one per RUN, reused within it", () => {
    expect(createWorkflowContext().clientReferenceId).not.toBe(
      createWorkflowContext().clientReferenceId
    );
  });
});

describe("buildMandates — the pitch", () => {
  it("declineThreshold.amount IS the budget, formatted for Visa", () => {
    const [mandate] = buildMandates(basket([line("ikea")], 125000));
    expect(mandate.declineThreshold).toEqual({ amount: "1250.00", currencyCode: "USD" });
  });

  it("formats 12000 minor units as 120.00", () => {
    const [mandate] = buildMandates(basket([line("ikea")], 12000));
    expect(mandate.declineThreshold.amount).toBe("120.00");
  });

  it("is the BUDGET, not the basket subtotal — the cap is what the agent may spend", () => {
    const b = basket([line("ikea", { priceMinor: 9900 }), line("ikea", { priceMinor: 8800 })], 125000);
    const [mandate] = buildMandates(b);
    expect(mandate.declineThreshold.amount).toBe("1250.00");
    expect(mandate.declineThreshold.amount).not.toBe("187.00");
  });

  it("is one mandate per shop, named the way the shop spells itself", () => {
    const mandates = buildMandates(
      basket([line("ikea"), line("wayfair"), line("ikea"), line("target")])
    );
    expect(mandates).toHaveLength(3);
    expect(mandates.map((m) => m.preferredMerchantName)).toEqual([
      "IKEA",
      "Wayfair",
      "Target",
    ]);
  });

  it("counts the quantity in each shop's group, as a string", () => {
    const mandates = buildMandates(
      basket([line("ikea", { quantity: 2 }), line("ikea", { quantity: 1 }), line("target")])
    );
    expect(mandates[0].quantity).toBe("3");
    expect(mandates[1].quantity).toBe("1");
  });

  it("carries the furniture merchant category", () => {
    const [mandate] = buildMandates(basket([line("ikea")]));
    expect(mandate.merchantCategory).toBe("Home Furnishings");
    expect(mandate.merchantCategoryCode).toBe("5712");
  });

  it("expires an hour out, as a unix-second string", () => {
    const now = Date.UTC(2026, 8, 19, 22, 0, 0);
    const [mandate] = buildMandates(basket([line("ikea")]), now);
    expectVisaTimestamp(mandate.effectiveUntilTime);
    expect(Number(mandate.effectiveUntilTime) - Math.floor(now / 1000)).toBe(
      MANDATE_TTL_SECONDS
    );
  });

  it("gives every mandate its own id", () => {
    const mandates = buildMandates(basket([line("ikea"), line("target")]));
    expect(mandates[0].mandateId).not.toBe(mandates[1].mandateId);
    expect(mandates[0].mandateId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("an empty basket produces no mandates rather than an empty one", () => {
    expect(buildMandates(basket([]))).toEqual([]);
  });
});

describe("describeLines", () => {
  it("names one thing plainly", () => {
    expect(describeLines([line("ikea", { title: "a tall lamp" })])).toBe("a tall lamp");
  });

  it("joins two with and", () => {
    expect(
      describeLines([
        line("ikea", { title: "a tall lamp" }),
        line("ikea", { title: "a photo frame" }),
      ])
    ).toBe("a tall lamp and a photo frame");
  });

  it("uses a list for three or more", () => {
    expect(
      describeLines([
        line("ikea", { title: "a lamp" }),
        line("ikea", { title: "a frame" }),
        line("ikea", { title: "a rug" }),
      ])
    ).toBe("a lamp, a frame and a rug");
  });

  it("says how many when there is more than one of something", () => {
    expect(describeLines([line("ikea", { title: "a photo frame", quantity: 2 })])).toBe(
      "2 × a photo frame"
    );
  });
});

describe("buildInitiatePurchaseInstructionPayload", () => {
  const payload = buildInitiatePurchaseInstructionPayload({
    consumerId: "consumer-1",
    tokenId: "token-1",
    context: CONTEXT,
    basket: basket([line("ikea"), line("wayfair")]),
  });

  it("carries the workflow context, not a fresh pair", () => {
    expect(payload.clientReferenceId).toBe("ref-1");
    expect((payload.appInstance as Record<string, unknown>).clientDeviceId).toBe("dev-1");
  });

  it("carries the consumer and the VTS token", () => {
    expect(payload.consumerId).toBe("consumer-1");
    expect(payload.tokenId).toBe("token-1");
  });

  it("carries assurance data with a timestamp", () => {
    const assurance = (payload.assuranceData as Array<Record<string, unknown>>)[0];
    expect(assurance).toMatchObject(ASSURANCE_DATA_BASE);
    expectVisaTimestamp(assurance.verificationTimestamp);
  });

  it("carries one mandate per shop and the consumer prompt", () => {
    expect(payload.mandates).toHaveLength(2);
    expect(payload.consumerPrompt).toBe("Purchase authorization mandate");
  });

  it("omits the client object entirely when the external ids are absent", () => {
    expect(payload.client).toBeUndefined();
  });

  it("includes it when they are present", () => {
    const withClient = buildInitiatePurchaseInstructionPayload({
      consumerId: "consumer-1",
      tokenId: "token-1",
      context: CONTEXT,
      basket: basket([line("ikea")]),
      client: buildClientObject("client-1", "app-1"),
    });
    expect(withClient.client).toEqual({ externalClientId: "client-1", externalAppId: "app-1" });
  });

  it("never carries an instructionId — that only comes back from Visa", () => {
    expect(JSON.stringify(payload)).not.toContain("instructionId");
  });
});

describe("buildEnrollCardPayload", () => {
  const payload = buildEnrollCardPayload({
    consumerId: "consumer-1",
    enrollmentReferenceId: "vts-token-ref",
    context: CONTEXT,
  });

  it("carries the VTS reference under the shape Visa expects", () => {
    expect(payload.enrollmentReferenceData).toEqual({
      enrollmentReferenceId: "vts-token-ref",
      enrollmentReferenceType: "TOKEN_REFERENCE_ID",
      enrollmentReferenceProvider: "VTS",
    });
  });

  it("carries consent with both timestamps in Visa's format", () => {
    const consent = (payload.consentData as Array<Record<string, unknown>>)[0];
    expect(consent.type).toBe("PERSONALIZATION");
    expect(consent.source).toBe("CLIENT");
    expectVisaTimestamp(consent.acceptedTime);
    expectVisaTimestamp(consent.effectiveUntil);
  });

  it("sends no card number anywhere", () => {
    const flat = JSON.stringify(payload);
    expect(flat).not.toMatch(/\d{13,19}/);
    expect(flat.toLowerCase()).not.toContain("pan");
    expect(flat.toLowerCase()).not.toContain("cvv");
  });
});

describe("buildCancelPurchaseInstructionPayload", () => {
  it("carries the instruction and the workflow context", () => {
    const payload = buildCancelPurchaseInstructionPayload(CONTEXT, "instruction-9");
    expect(payload.instructionId).toBe("instruction-9");
    expect(payload.clientReferenceId).toBe("ref-1");
    expectVisaTimestamp(
      (payload.assuranceData as Array<Record<string, unknown>>)[0].verificationTimestamp
    );
  });

  it("omits the instruction id when there is not one", () => {
    expect(buildCancelPurchaseInstructionPayload(CONTEXT)).not.toHaveProperty("instructionId");
  });
});

describe("buildClientObject", () => {
  it("is undefined unless BOTH ids are configured — an empty object is worse than none", () => {
    expect(buildClientObject(null, null)).toBeUndefined();
    expect(buildClientObject("client-1", null)).toBeUndefined();
    expect(buildClientObject(null, "app-1")).toBeUndefined();
    expect(buildClientObject("client-1", "app-1")).toEqual({
      externalClientId: "client-1",
      externalAppId: "app-1",
    });
  });
});
