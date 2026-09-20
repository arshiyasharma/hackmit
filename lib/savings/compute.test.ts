import { afterEach, describe, expect, it } from "vitest";

import { manualBaseline } from "./assumptions";
import { costSavings, timeSavings, tokenSavings } from "./compute";
import type { AnalyzeRecord } from "./ledger";

/**
 * The savings arithmetic, checked where it can be checked.
 *
 * The counters this feeds are shown to judges next to a claim about saving
 * money, so the failure that matters is not a crash — it is a number that is
 * quietly wrong, or a zero standing where a dash belongs.
 */

function record(patch: Partial<AnalyzeRecord> = {}): AnalyzeRecord {
  return {
    at: Date.now(),
    cached: false,
    model: "gemini-3.1-flash-lite",
    provider: "gemini",
    promptTokens: 900,
    outputTokens: 100,
    totalTokens: 1000,
    avoidedTokens: null,
    imageBytes: 40_000,
    elapsedMs: 1200,
    ...patch,
  };
}

const PRICE_KEYS = [
  "SAVINGS_PRICE_IN_GEMINI_3_1_FLASH_LITE",
  "SAVINGS_PRICE_OUT_GEMINI_3_1_FLASH_LITE",
  "SAVINGS_PRICE_IN_BIG_MODEL",
  "SAVINGS_PRICE_OUT_BIG_MODEL",
] as const;

afterEach(() => {
  for (const key of PRICE_KEYS) delete process.env[key];
});

describe("tokenSavings — measured, never estimated", () => {
  it("is a dash, not a zero, before anything has been measured", () => {
    expect(tokenSavings([]).percentSaved).toBeNull();
  });

  it("is a dash when a model was called but nothing was ever cached", () => {
    // one real call, no repeat: nothing was saved YET, and 0% would be a
    // claim about caching that this run has not earned either way
    const result = tokenSavings([record()]);
    expect(result.spentTokens).toBe(1000);
    expect(result.avoidedTokens).toBe(0);
    expect(result.percentSaved).toBe(0);
    expect(result.billedCalls).toBe(1);
  });

  it("counts a cache hit as the real tokens the first call cost", () => {
    // one billed call at 1000, then the same photo again
    const result = tokenSavings([
      record(),
      record({ cached: true, avoidedTokens: 1000, totalTokens: null, elapsedMs: 0 }),
    ]);

    expect(result.spentTokens).toBe(1000);
    expect(result.avoidedTokens).toBe(1000);
    expect(result.wouldHaveSpentTokens).toBe(2000);
    // half the work this session cost nothing
    expect(result.percentSaved).toBe(50);
    expect(result.billedCalls).toBe(1);
    expect(result.cachedCalls).toBe(1);
  });

  it("reaches the number a rehearsal actually produces", () => {
    // read the room once, then re-capture it nine times while practising
    const records = [
      record(),
      ...Array.from({ length: 9 }, () =>
        record({ cached: true, avoidedTokens: 1000, totalTokens: null, elapsedMs: 0 })
      ),
    ];
    expect(tokenSavings(records).percentSaved).toBe(90);
  });

  it("does not credit a cache hit it cannot price, and says how many", () => {
    // the process restarted: we know the read was free, not what it was worth
    const result = tokenSavings([
      record(),
      record({ cached: true, avoidedTokens: null, totalTokens: null }),
    ]);

    expect(result.avoidedTokens).toBe(0);
    expect(result.unpricedCacheHits).toBe(1);
    // the claim stays at what can be proved, which is nothing saved yet
    expect(result.percentSaved).toBe(0);
  });

  it("counts a failed-but-billed attempt, so the percentage is not flattered", () => {
    // a model answered unparseable JSON (200 tokens, billed), the next one got
    // it right (1000 tokens), then the photo came back from cache
    const result = tokenSavings([
      record({ totalTokens: 200 }),
      record({ totalTokens: 1000 }),
      record({ cached: true, avoidedTokens: 1000, totalTokens: null, elapsedMs: 0 }),
    ]);

    // the wasted 200 is real spend and belongs in the denominator
    expect(result.spentTokens).toBe(1200);
    expect(result.avoidedTokens).toBe(1000);
    // 1000 / 2200, not 1000 / 2000 — dropping the failure would read 50%
    expect(result.percentSaved).toBe(45.5);
    expect(result.billedCalls).toBe(2);
  });

  it("ignores a billed call whose provider reported no usage", () => {
    const result = tokenSavings([record({ totalTokens: null })]);
    expect(result.spentTokens).toBe(0);
    expect(result.billedCalls).toBe(1);
  });
});

describe("costSavings — silent unless priced", () => {
  it("is null, not zero, when no prices are configured", () => {
    const cost = costSavings([record()], null);
    expect(cost.spentUsd).toBeNull();
    expect(cost.avoidedUsd).toBeNull();
    expect(cost.baselineUsd).toBeNull();
  });

  it("prices a real call off the configured per-million rates", () => {
    process.env.SAVINGS_PRICE_IN_GEMINI_3_1_FLASH_LITE = "1";
    process.env.SAVINGS_PRICE_OUT_GEMINI_3_1_FLASH_LITE = "10";

    // 900 in at $1/M = $0.0009, 100 out at $10/M = $0.001
    const cost = costSavings([record()], null);
    expect(cost.spentUsd).toBeCloseTo(0.0019, 6);
  });

  it("compares against a baseline model when one is configured", () => {
    process.env.SAVINGS_PRICE_IN_GEMINI_3_1_FLASH_LITE = "1";
    process.env.SAVINGS_PRICE_OUT_GEMINI_3_1_FLASH_LITE = "10";
    process.env.SAVINGS_PRICE_IN_BIG_MODEL = "10";
    process.env.SAVINGS_PRICE_OUT_BIG_MODEL = "100";

    const cost = costSavings([record()], "big-model");
    expect(cost.spentUsd).toBeCloseTo(0.0019, 6);
    // ten times the rate, so ten times the bill for the identical call
    expect(cost.baselineUsd).toBeCloseTo(0.019, 6);
  });
});

describe("timeSavings — one measured number minus one assumed one", () => {
  const baseline = manualBaseline();

  it("has nothing to say without a run", () => {
    expect(
      timeSavings({
        retailers: 0,
        items: 0,
        dimensionChecks: 0,
        measuredMs: 0,
        baseline,
      })
    ).toBeNull();
  });

  it("adds the manual estimate up per shop and per item", () => {
    const time = timeSavings({
      retailers: 3,
      items: 4,
      dimensionChecks: 4,
      measuredMs: 30_000,
      baseline,
    })!;

    // 3 sites + 4 items + 4 dimension checks + 3 checkouts, at the defaults
    const expected =
      3 * baseline.minutesPerSite +
      4 * baseline.minutesPerItem +
      4 * baseline.minutesPerDimensionCheck +
      3 * baseline.minutesPerCheckout;

    expect(time.manualMinutes).toBe(expected);
    expect(time.actualMinutes).toBe(0.5);
    expect(time.minutesSaved).toBe(Math.round((expected - 0.5) * 10) / 10);
  });

  it("never saves a negative amount of time", () => {
    const time = timeSavings({
      retailers: 1,
      items: 1,
      dimensionChecks: 0,
      // an hour of automation against a few minutes of manual work
      measuredMs: 60 * 60_000,
      baseline,
    })!;

    expect(time.minutesSaved).toBe(0);
  });
});
