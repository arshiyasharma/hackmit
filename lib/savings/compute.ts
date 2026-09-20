/**
 * The arithmetic, pure. No store, no network, no clock.
 *
 * Split out from the route so every number on the savings panel can be checked
 * in a unit test — the same reason lib/checkout/lineView.ts exists. A counter
 * that is wrong on stage is worse than a counter that is absent, and this is
 * the file where "wrong" is catchable.
 */

import type { AnalyzeRecord } from "./ledger";
import { priceFor, type ManualBaseline, type ModelPrice } from "./assumptions";

/* ------------------------------------------------------------------ tokens */

export type TokenSavings = {
  /** real tokens billed, summed off provider responses */
  spentTokens: number;
  /** real tokens NOT billed because the photo cache answered */
  avoidedTokens: number;
  /** what the same work costs with no cache: spent + avoided */
  wouldHaveSpentTokens: number;
  /** 0..100, or null when nothing has been measured yet */
  percentSaved: number | null;
  /** calls that actually reached a model */
  billedCalls: number;
  /** calls the cache answered */
  cachedCalls: number;
  /**
   * Cache hits we could not price, because the call that filled the cache
   * happened in a process we no longer have. Reported so the percentage can be
   * read as the FLOOR it is, rather than the whole story.
   */
  unpricedCacheHits: number;
};

/**
 * What caching actually saved, end to end.
 *
 * FULLY MEASURED — there is no assumption anywhere in this function. Every
 * token in `spentTokens` came back from a provider, and every token in
 * `avoidedTokens` is the recorded cost of the real call that filled that cache
 * entry. This is the number the panel shows, and it is the one that can be
 * defended line by line.
 */
export function tokenSavings(records: readonly AnalyzeRecord[]): TokenSavings {
  let spentTokens = 0;
  let avoidedTokens = 0;
  let billedCalls = 0;
  let cachedCalls = 0;
  let unpricedCacheHits = 0;

  for (const record of records) {
    if (record.cached) {
      cachedCalls += 1;
      if (record.avoidedTokens === null) unpricedCacheHits += 1;
      else avoidedTokens += record.avoidedTokens;
      continue;
    }
    billedCalls += 1;
    if (record.totalTokens !== null) spentTokens += record.totalTokens;
  }

  const wouldHaveSpentTokens = spentTokens + avoidedTokens;

  return {
    spentTokens,
    avoidedTokens,
    wouldHaveSpentTokens,
    // nothing measured yet is a dash, never a zero — zero is a claim
    percentSaved:
      wouldHaveSpentTokens > 0
        ? round1((avoidedTokens / wouldHaveSpentTokens) * 100)
        : null,
    billedCalls,
    cachedCalls,
    unpricedCacheHits,
  };
}

/* ------------------------------------------------------------------- money */

export type CostSavings = {
  spentUsd: number | null;
  avoidedUsd: number | null;
  /** null unless SAVINGS_BASELINE_MODEL and its prices are both configured */
  baselineUsd: number | null;
  currency: "USD";
};

/** Dollars for a split of input and output tokens at a given price. */
function costOf(
  promptTokens: number,
  outputTokens: number,
  price: ModelPrice
): number {
  return (
    (promptTokens / 1_000_000) * price.inPerMillion +
    (outputTokens / 1_000_000) * price.outPerMillion
  );
}

/**
 * The same story in dollars, when — and only when — prices are configured.
 *
 * Returns nulls rather than zeros when a price is missing. A cost of $0.00 and
 * a cost nobody knows are different claims and must not look the same.
 */
export function costSavings(
  records: readonly AnalyzeRecord[],
  baselineModelId: string | null
): CostSavings {
  let spentUsd: number | null = null;
  let avoidedUsd: number | null = null;
  let baselineUsd: number | null = null;

  const baselinePrice = priceFor(baselineModelId);

  for (const record of records) {
    const price = priceFor(record.model);

    if (!record.cached) {
      if (price && record.promptTokens !== null && record.outputTokens !== null) {
        spentUsd = (spentUsd ?? 0) + costOf(record.promptTokens, record.outputTokens, price);
      }
      // what the naive model would have charged for this same call
      if (
        baselinePrice &&
        record.promptTokens !== null &&
        record.outputTokens !== null
      ) {
        baselineUsd =
          (baselineUsd ?? 0) +
          costOf(record.promptTokens, record.outputTokens, baselinePrice);
      }
      continue;
    }

    // a cache hit: the saving is whatever the original call would cost again
    if (price && record.avoidedTokens !== null) {
      // the split is not recorded for an avoided call, so price the whole of it
      // at the input rate — the cheaper of the two, which keeps this a FLOOR
      avoidedUsd =
        (avoidedUsd ?? 0) + (record.avoidedTokens / 1_000_000) * price.inPerMillion;
    }
    if (baselinePrice && record.avoidedTokens !== null) {
      baselineUsd =
        (baselineUsd ?? 0) +
        (record.avoidedTokens / 1_000_000) * baselinePrice.inPerMillion;
    }
  }

  return {
    spentUsd: spentUsd === null ? null : round4(spentUsd),
    avoidedUsd: avoidedUsd === null ? null : round4(avoidedUsd),
    baselineUsd: baselineUsd === null ? null : round4(baselineUsd),
    currency: "USD",
  };
}

/* ------------------------------------------------------------------- time */

export type TimeSavings = {
  /** ASSUMED: what the same shopping is taken to cost by hand */
  manualMinutes: number;
  /** MEASURED: wall clock the app actually spent doing the automated work */
  actualMinutes: number;
  /** manual − actual, floored at zero */
  minutesSaved: number;
  retailers: number;
  items: number;
  dimensionChecks: number;
};

export type TimeInput = {
  /** distinct shops in the basket the run actually walked */
  retailers: number;
  /** lines in that basket */
  items: number;
  /** lines that carried real dimensions and were therefore fit-checked */
  dimensionChecks: number;
  /** every millisecond of automated work we actually timed */
  measuredMs: number;
  baseline: ManualBaseline;
};

/**
 * Time saved, which is one measured number minus one assumed one.
 *
 * `actualMinutes` is real: it is wall clock the app spent. `manualMinutes` is
 * an estimate built from lib/savings/assumptions.ts, and the route labels it
 * as such. Returns null when there is nothing to compare — no run, no claim.
 */
export function timeSavings(input: TimeInput): TimeSavings | null {
  if (input.retailers <= 0 || input.items <= 0) return null;

  const { baseline } = input;
  const manualMinutes =
    input.retailers * baseline.minutesPerSite +
    input.items * baseline.minutesPerItem +
    input.dimensionChecks * baseline.minutesPerDimensionCheck +
    input.retailers * baseline.minutesPerCheckout;

  const actualMinutes = input.measuredMs / 60_000;

  return {
    manualMinutes: round1(manualMinutes),
    actualMinutes: round1(actualMinutes),
    // an automated run slower than doing it by hand saves nothing, it does not
    // save a negative amount
    minutesSaved: round1(Math.max(0, manualMinutes - actualMinutes)),
    retailers: input.retailers,
    items: input.items,
    dimensionChecks: input.dimensionChecks,
  };
}

/* ----------------------------------------------------------------- rounding */

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}
