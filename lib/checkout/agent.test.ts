import { afterEach, describe, expect, it } from "vitest";

import { groupByRetailer, resolveMode, runCheckout, STEP_MS } from "./agent";
import { createRun, getRun } from "./runs";
import type { Basket, BasketLine, LineStatus, Retailer } from "./types";

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

/** The demo basket: four lines, three shops, one of them twice. */
function fourLinesThreeRetailers(): Basket {
  return basket([
    line("ikea"),
    line("wayfair"),
    line("ikea"),
    line("target"),
  ]);
}

const ENV_KEYS = ["CHECKOUT_MODE", "ENABLE_REAL_ORDERS"] as const;
const originalEnv = new Map(ENV_KEYS.map((key) => [key, process.env[key]]));

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = originalEnv.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("groupByRetailer", () => {
  it("groups lines by shop, shops in the order they first appear", () => {
    const groups = groupByRetailer(fourLinesThreeRetailers().lines);
    expect(groups.map((g) => g.retailer)).toEqual(["ikea", "wayfair", "target"]);
    expect(groups[0].lines).toHaveLength(2);
    expect(groups[1].lines).toHaveLength(1);
  });

  it("an empty basket has no groups", () => {
    expect(groupByRetailer([])).toEqual([]);
  });
});

describe("resolveMode — the safety flag, both halves required", () => {
  it("is test when nothing is set", () => {
    delete process.env.CHECKOUT_MODE;
    delete process.env.ENABLE_REAL_ORDERS;
    expect(resolveMode()).toBe("test");
  });

  it("is test when CHECKOUT_MODE=live but real orders are not enabled", () => {
    process.env.CHECKOUT_MODE = "live";
    delete process.env.ENABLE_REAL_ORDERS;
    expect(resolveMode()).toBe("test");

    process.env.ENABLE_REAL_ORDERS = "false";
    expect(resolveMode()).toBe("test");
  });

  it("is test when real orders are enabled but the mode is not live", () => {
    delete process.env.CHECKOUT_MODE;
    process.env.ENABLE_REAL_ORDERS = "true";
    expect(resolveMode()).toBe("test");
  });

  it("is live only when both are set", () => {
    process.env.CHECKOUT_MODE = "live";
    process.env.ENABLE_REAL_ORDERS = "true";
    expect(resolveMode()).toBe("live");
  });
});

describe("runCheckout in test mode", () => {
  it("walks every line to placed, test mode, TEST- order reference", async () => {
    delete process.env.CHECKOUT_MODE;
    const run = createRun(fourLinesThreeRetailers());

    await runCheckout(run.runId, { stepMs: 1 });

    const after = getRun(run.runId);
    expect(after).toBeDefined();
    expect(after?.finishedAt).not.toBeNull();

    for (const l of after!.lines) {
      expect(l.status.state).toBe("placed");
      const status = l.status as Extract<LineStatus, { state: "placed" }>;
      expect(status.mode).toBe("test");
      expect(status.orderRef).toMatch(/^TEST-(IKEA|WAYFAIR|TARGET)-[0-9A-F]{8}$/);
    }
  });

  it("gives every line its own order reference", async () => {
    delete process.env.CHECKOUT_MODE;
    const run = createRun(fourLinesThreeRetailers());
    await runCheckout(run.runId, { stepMs: 1 });
    const refs = getRun(run.runId)!.lines.map(
      (l) => (l.status as Extract<LineStatus, { state: "placed" }>).orderRef
    );
    expect(new Set(refs).size).toBe(4);
  });

  it("behaves exactly like test mode when only CHECKOUT_MODE=live is set", async () => {
    process.env.CHECKOUT_MODE = "live";
    delete process.env.ENABLE_REAL_ORDERS;

    const run = createRun(fourLinesThreeRetailers());
    await expect(runCheckout(run.runId, { stepMs: 1 })).resolves.toBeUndefined();

    for (const l of getRun(run.runId)!.lines) {
      expect(l.status.state).toBe("placed");
      expect((l.status as Extract<LineStatus, { state: "placed" }>).mode).toBe("test");
    }
  });

  it("does nothing at all for a run id it does not know", async () => {
    delete process.env.CHECKOUT_MODE;
    await expect(runCheckout("not-a-run", { stepMs: 1 })).resolves.toBeUndefined();
  });
});

describe("runCheckout with both live flags set", () => {
  it("throws, and moves nothing", async () => {
    process.env.CHECKOUT_MODE = "live";
    process.env.ENABLE_REAL_ORDERS = "true";

    const run = createRun(fourLinesThreeRetailers());
    await expect(runCheckout(run.runId, { stepMs: 1 })).rejects.toThrow(
      "Live ordering is not implemented"
    );

    // "rather than doing anything": every line is exactly where it started
    for (const l of getRun(run.runId)!.lines) {
      expect(l.status.state).toBe("pending");
    }
    expect(getRun(run.runId)!.finishedAt).toBeNull();
  });
});

describe("the walk is legible — one line moves at a time", () => {
  it("never has two lines mid-walk, and passes through every state", async () => {
    delete process.env.CHECKOUT_MODE;
    const run = createRun(fourLinesThreeRetailers());

    const seen = new Set<string>();
    let maxMoving = 0;

    const sampler = setInterval(() => {
      const current = getRun(run.runId);
      if (!current) return;
      let moving = 0;
      for (const l of current.lines) {
        seen.add(l.status.state);
        if (l.status.state === "walking" || l.status.state === "authorizing") moving += 1;
      }
      maxMoving = Math.max(maxMoving, moving);
    }, 3);

    await runCheckout(run.runId, { stepMs: 30 });
    clearInterval(sampler);

    expect(maxMoving).toBeLessThanOrEqual(1);
    expect(seen.has("walking")).toBe(true);
    expect(seen.has("authorizing")).toBe(true);
    expect(seen.has("placed")).toBe(true);
    // not all at once at the end
    expect(seen.has("pending")).toBe(true);
  });
});

describe("the real pace, at the constant the demo runs", () => {
  it(
    "takes a four-line basket across three shops through in one readable stretch",
    async () => {
      delete process.env.CHECKOUT_MODE;
      const run = createRun(fourLinesThreeRetailers());

      const started = Date.now();
      await runCheckout(run.runId);
      const elapsedMs = Date.now() - started;

      // 4 lines x 3 transitions x STEP_MS, plus scheduler slop
      expect(elapsedMs).toBeGreaterThanOrEqual(4 * 3 * STEP_MS);
      expect(elapsedMs).toBeLessThan(15_000);

      for (const l of getRun(run.runId)!.lines) {
        expect(l.status.state).toBe("placed");
      }
    },
    20_000
  );
});
