import { afterEach, beforeAll, describe, expect, it } from "vitest";

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
  return { basketId: crypto.randomUUID(), lines, budgetMinor: 125000, profileMm: null };
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

const ENV_KEYS = [
  "CHECKOUT_MODE",
  "ENABLE_REAL_ORDERS",
  "TAP_AGENT_ID",
  "TAP_KEY_ID",
  "TAP_ED25519_PRIVATE_KEY",
  "TAP_ED25519_PUBLIC_KEY",
  "TAP_VERIFY_BASE_URL",
] as const;
const originalEnv = new Map(ENV_KEYS.map((key) => [key, process.env[key]]));

/**
 * This file runs the walk with the Trusted Agent Protocol SWITCHED OFF — no
 * keys in the environment — because that is what an operator who has not run
 * `npm run keys:tap` has, and the walk must still complete for them. The
 * identity beat itself is tested in tap-walk.test.ts, which configures keys
 * and mocks the registry.
 */
beforeAll(() => {
  for (const key of ENV_KEYS) {
    if (key.startsWith("TAP_")) delete process.env[key];
  }
});

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

  it("carries no tap verdict when the agent has no keys — off, not failed", async () => {
    delete process.env.CHECKOUT_MODE;
    const run = createRun(fourLinesThreeRetailers());

    await runCheckout(run.runId, { stepMs: 1 });

    for (const l of getRun(run.runId)!.lines) {
      expect(l.status.state).toBe("placed");
      expect(l.status.tap).toBeUndefined();
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

describe("the walk is a swarm — one agent per shop, each taking its lines in turn", () => {
  it("runs the shops together but never two lines of the same shop at once", async () => {
    delete process.env.CHECKOUT_MODE;
    const run = createRun(fourLinesThreeRetailers());

    const retailerOf = new Map(
      getRun(run.runId)!.basket.lines.map((l) => [l.lineId, l.retailer])
    );

    const seen = new Set<string>();
    let maxMovingAnyShop = 0;
    let maxMovingOverall = 0;

    const sampler = setInterval(() => {
      const current = getRun(run.runId);
      if (!current) return;

      const movingPerShop = new Map<string, number>();
      for (const l of current.lines) {
        seen.add(l.status.state);
        if (l.status.state !== "walking" && l.status.state !== "authorizing") continue;
        const retailer = retailerOf.get(l.lineId)!;
        movingPerShop.set(retailer, (movingPerShop.get(retailer) ?? 0) + 1);
      }

      const overall = [...movingPerShop.values()].reduce((n, v) => n + v, 0);
      maxMovingOverall = Math.max(maxMovingOverall, overall);
      for (const count of movingPerShop.values()) {
        maxMovingAnyShop = Math.max(maxMovingAnyShop, count);
      }
    }, 3);

    await runCheckout(run.runId, { stepMs: 30 });
    clearInterval(sampler);

    // each lane is still readable: a shop's own lines go one at a time
    expect(maxMovingAnyShop).toBeLessThanOrEqual(1);
    // and the lanes genuinely overlap — this is the swarm, and the whole point
    expect(maxMovingOverall).toBeGreaterThanOrEqual(2);

    expect(seen.has("walking")).toBe(true);
    expect(seen.has("authorizing")).toBe(true);
    expect(seen.has("placed")).toBe(true);
    // not all at once at the end
    expect(seen.has("pending")).toBe(true);
  });
});

describe("the agent refuses itself", () => {
  /** A standard interior door, and a sofa that will never get through it. */
  const ROOM = {
    doorWidthMm: 762,
    doorHeightMm: 2032,
    hallwayWidthMm: 914,
    landingWidthMm: 914,
    ceilingHeightMm: 2438,
  };
  const TOO_BIG = { w: 2400, h: 900, d: 1100 };

  it("holds the thing that will not fit, places its siblings, and still finishes", async () => {
    delete process.env.CHECKOUT_MODE;
    const run = createRun({
      basketId: crypto.randomUUID(),
      budgetMinor: 125000,
      profileMm: ROOM,
      lines: [
        line("ikea", { dimensionsMm: TOO_BIG }),
        line("ikea", { dimensionsMm: { w: 600, h: 900, d: 400 } }),
        line("wayfair", { dimensionsMm: null }),
      ],
    });

    await runCheckout(run.runId, { stepMs: 1 });

    const [sofa, lamp, frame] = getRun(run.runId)!.lines;

    expect(sofa.status.state).toBe("held");
    if (sofa.status.state === "held") {
      expect(sofa.status.reason).toContain("ikea");
    }

    // a hold is not contagious: the rest of the lane keeps going
    expect(lamp.status.state).toBe("placed");
    expect(frame.status.state).toBe("placed");

    // and a run that held something is still a finished run, or the overlay
    // spins forever waiting for a `done` that never comes
    expect(getRun(run.runId)!.finishedAt).not.toBeNull();
  });

  it("holds nothing when no room was measured", async () => {
    delete process.env.CHECKOUT_MODE;
    const run = createRun({
      basketId: crypto.randomUUID(),
      budgetMinor: 125000,
      profileMm: null,
      lines: [line("ikea", { dimensionsMm: TOO_BIG })],
    });

    await runCheckout(run.runId, { stepMs: 1 });

    expect(getRun(run.runId)!.lines[0].status.state).toBe("placed");
  });

  it("stops spending when the budget runs out, across lanes", async () => {
    delete process.env.CHECKOUT_MODE;
    // four lines at 4200 = 16800, with room for three of them
    const run = createRun({
      basketId: crypto.randomUUID(),
      budgetMinor: 13000,
      profileMm: null,
      lines: [line("ikea"), line("wayfair"), line("ikea"), line("target")],
    });

    await runCheckout(run.runId, { stepMs: 1 });

    const states = getRun(run.runId)!.lines.map((l) => l.status.state);
    const placed = states.filter((s) => s === "placed").length;
    const held = states.filter((s) => s === "held").length;

    // whichever lanes got there first, the cap is the cap: three fit under
    // 13000 and the fourth cannot, however the lanes interleaved
    expect(placed).toBe(3);
    expect(held).toBe(1);
    expect(getRun(run.runId)!.finishedAt).not.toBeNull();
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

      // The walk is as long as its LONGEST LANE, not the sum of every line.
      // Three shops go together; ikea has two lines, so ikea is the long pole:
      // 2 lines x 3 transitions x STEP_MS.
      expect(elapsedMs).toBeGreaterThanOrEqual(2 * 3 * STEP_MS);
      // and it is genuinely shorter than walking all four in turn would be —
      // if this ever creeps back up to 4 x 3 x STEP_MS the fan-out is gone
      expect(elapsedMs).toBeLessThan(4 * 3 * STEP_MS);
      expect(elapsedMs).toBeLessThan(15_000);

      for (const l of getRun(run.runId)!.lines) {
        expect(l.status.state).toBe("placed");
      }
    },
    20_000
  );
});
