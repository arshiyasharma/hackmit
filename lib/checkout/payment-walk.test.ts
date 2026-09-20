import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resolvePaymentProvider, runCheckout } from "./agent";
import { createRun, getRun } from "./runs";
import type { Basket, BasketLine, LineStatus, Retailer } from "./types";

/**
 * The payment beat inside the walk, with Visa's sandbox mocked.
 *
 * The real thing is proved in lib/visaAcceptance/live.test.ts, which is
 * opt-in and hits `apitest.visaacceptance.com`. This file proves the WIRING:
 * that the flag is off by default, that a decline fails the line rather than
 * quietly placing it, and that nothing is ever captured.
 */

const authorizeMock = vi.fn();

vi.mock("@/lib/visaAcceptance/payments", async () => {
  const actual = await vi.importActual<typeof import("@/lib/visaAcceptance/payments")>(
    "@/lib/visaAcceptance/payments"
  );
  return { ...actual, authorize: (...args: unknown[]) => authorizeMock(...args) };
});

function line(retailer: Retailer, patch: Partial<BasketLine> = {}): BasketLine {
  const id = crypto.randomUUID();
  return {
    lineId: id,
    placementId: `place-${id.slice(0, 8)}`,
    listingId: "ikea-70437814",
    retailer,
    title: `A thing from ${retailer}`,
    productUrl: `https://www.${retailer}.com/p/example`,
    imageUrl: "https://example.com/image.jpg",
    priceMinor: 4200,
    currency: "USD",
    dimensionsMm: null,
    quantity: 1,
    ...patch,
  };
}

function basket(lines: BasketLine[]): Basket {
  return { basketId: crypto.randomUUID(), lines, budgetMinor: 125000 };
}

function authorized(amount: string) {
  return {
    status: "AUTHORIZED",
    id: "7288000000000000000",
    reconciliationId: "7898716909956640004807",
    authorizedAmount: amount,
    currency: "USD",
    approvalCode: "299502",
    correlationId: "corr-1",
    httpStatus: 201,
    message: null,
  };
}

const ENV_KEYS = ["PAYMENT_PROVIDER", "CHECKOUT_MODE", "TAP_KEY_ID", "TAP_ED25519_PRIVATE_KEY"] as const;
const originalEnv = new Map(ENV_KEYS.map((key) => [key, process.env[key]]));

beforeEach(() => {
  authorizeMock.mockReset();
  for (const key of ENV_KEYS) delete process.env[key];
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = originalEnv.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("resolvePaymentProvider — simulated unless asked", () => {
  it("is simulated when nothing is set", () => {
    expect(resolvePaymentProvider()).toBe("simulated");
  });

  it("is simulated for anything that is not exactly 'acceptance'", () => {
    for (const value of ["", "Acceptance", "visa", "true", "vic"]) {
      process.env.PAYMENT_PROVIDER = value;
      expect(resolvePaymentProvider()).toBe("simulated");
    }
  });

  it("is acceptance when asked for by name", () => {
    process.env.PAYMENT_PROVIDER = "acceptance";
    expect(resolvePaymentProvider()).toBe("acceptance");
  });
});

describe("the walk with no payment provider", () => {
  it("never asks Visa anything and carries no payment field", async () => {
    const run = createRun(basket([line("ikea"), line("wayfair")]));
    await runCheckout(run.runId, { stepMs: 1 });

    expect(authorizeMock).not.toHaveBeenCalled();
    for (const l of getRun(run.runId)!.lines) {
      expect(l.status.state).toBe("placed");
      expect(l.status.payment).toBeUndefined();
    }
  });
});

describe("the walk with PAYMENT_PROVIDER=acceptance", () => {
  beforeEach(() => {
    process.env.PAYMENT_PROVIDER = "acceptance";
  });

  it("authorizes each line for its own total and records what Visa said", async () => {
    authorizeMock.mockResolvedValue(authorized("84.00"));

    const run = createRun(
      basket([line("walmart", { priceMinor: 4200, quantity: 2 }), line("wayfair", { priceMinor: 1999 }), line("macys", { priceMinor: 9999 })])
    );
    await runCheckout(run.runId, { stepMs: 1 });

    expect(authorizeMock).toHaveBeenCalledTimes(3);
    // quantity counts: 4200 x 2
    expect(authorizeMock.mock.calls[0][0]).toMatchObject({ amountMinor: 8400, currency: "USD" });
    expect(authorizeMock.mock.calls[1][0]).toMatchObject({ amountMinor: 1999 });
    expect(authorizeMock.mock.calls[2][0]).toMatchObject({ amountMinor: 9999 });

    for (const l of getRun(run.runId)!.lines) {
      expect(l.status.state).toBe("placed");
      expect(l.status.payment).toMatchObject({
        provider: "acceptance",
        status: "AUTHORIZED",
        reconciliationId: "7898716909956640004807",
        approvalCode: "299502",
        merchant: "sandbox",
        captured: false,
      });
    }
  });

  it("nothing is ever captured", async () => {
    authorizeMock.mockResolvedValue(authorized("42.00"));
    const run = createRun(basket([line("ikea")]));
    await runCheckout(run.runId, { stepMs: 1 });
    expect(getRun(run.runId)!.lines[0].status.payment!.captured).toBe(false);
  });

  it("keeps the order reference TEST- prefixed — the authorization is real, the order is not", async () => {
    authorizeMock.mockResolvedValue(authorized("42.00"));
    const run = createRun(basket([line("ikea")]));
    await runCheckout(run.runId, { stepMs: 1 });

    const status = getRun(run.runId)!.lines[0].status as Extract<LineStatus, { state: "placed" }>;
    expect(status.orderRef).toMatch(/^TEST-IKEA-/);
    expect(status.mode).toBe("test");
  });

  it("a decline fails the line rather than quietly placing it", async () => {
    authorizeMock.mockResolvedValue({ ...authorized("42.00"), status: "DECLINED" });

    const run = createRun(basket([line("ikea")]));
    await runCheckout(run.runId, { stepMs: 1 });

    const status = getRun(run.runId)!.lines[0].status;
    expect(status.state).toBe("failed");
    expect((status as Extract<LineStatus, { state: "failed" }>).reason).toContain("DECLINED");
    expect(status.payment).toBeUndefined();
  });

  it("a sandbox we cannot reach fails the line, and the rest of the walk carries on", async () => {
    authorizeMock
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValue(authorized("42.00"));

    const run = createRun(basket([line("ikea"), line("wayfair")]));
    await runCheckout(run.runId, { stepMs: 1 });

    const [first, second] = getRun(run.runId)!.lines;
    expect(first.status.state).toBe("failed");
    expect((first.status as Extract<LineStatus, { state: "failed" }>).reason).toContain("Visa");
    expect(second.status.state).toBe("placed");
    expect(getRun(run.runId)!.finishedAt).not.toBeNull();
  });
});

describe("retry safety", () => {
  it("concurrent and later starts authorize a run only once", async () => {
    process.env.PAYMENT_PROVIDER = "acceptance";
    authorizeMock.mockResolvedValue(authorized("42.00"));
    const run = createRun(basket([line("ikea")]));
    await Promise.all([runCheckout(run.runId, { stepMs: 1 }), runCheckout(run.runId, { stepMs: 1 })]);
    await runCheckout(run.runId, { stepMs: 1 });
    expect(authorizeMock).toHaveBeenCalledTimes(1);
    expect(getRun(run.runId)!.lines[0].status.state).toBe("placed");
  });
});
