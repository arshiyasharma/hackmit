/**
 * EVERY NUMBER IN THIS FILE IS AN ASSUMPTION, AND THAT IS WHY THEY ARE ALL IN
 * ONE FILE.
 *
 * The rest of lib/savings is measurement: real token counts off real provider
 * responses, real wall-clock milliseconds. This file is the other kind of
 * number — the ones nobody measured, the ones a judge is entitled to argue
 * with. Keeping them apart is the whole point: `/api/savings` reports which of
 * its figures came from which, so a counter that leans on an assumption says
 * so instead of wearing the same clothes as a measured one.
 *
 * All of them are environment-overridable. Change your mind about what manual
 * shopping costs and you change a variable, not the arithmetic.
 */

/** A positive number from the environment, or the documented default. */
function tunable(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

/**
 * What doing this by hand is taken to cost, per unit of work.
 *
 * NOT MEASURED. Nobody sat with a stopwatch; these are estimates of a person
 * opening shops, searching, reading a spec table and checking out. They are
 * the honest weak point of the "time saved" counter and the route says so.
 * The counter's own caption is "versus shopping five sites", so the model is
 * per-shop and per-item rather than one flat number.
 */
export type ManualBaseline = {
  /** find the shop, load it, search, wade through the results */
  minutesPerSite: number;
  /** compare the options for ONE thing until you pick one */
  minutesPerItem: number;
  /** find W×D×H on the page, measure your door, decide it fits */
  minutesPerDimensionCheck: number;
  /** cart, address, card, confirm — once per shop */
  minutesPerCheckout: number;
};

export function manualBaseline(): ManualBaseline {
  return {
    minutesPerSite: tunable("SAVINGS_MINUTES_PER_SITE", 4),
    minutesPerItem: tunable("SAVINGS_MINUTES_PER_ITEM", 3),
    minutesPerDimensionCheck: tunable("SAVINGS_MINUTES_PER_DIMENSION_CHECK", 2),
    minutesPerCheckout: tunable("SAVINGS_MINUTES_PER_CHECKOUT", 3),
  };
}

/**
 * Dollars per million tokens, by model.
 *
 * DELIBERATELY EMPTY BY DEFAULT. Publishing a price we have not checked is
 * exactly the kind of invented number this project refuses elsewhere, and a
 * wrong price is worse than no price because it looks authoritative. Set
 * these and the dollar figures appear; leave them and `/api/savings` reports
 * token counts and percentages — which are fully measured — and null for cost.
 *
 *   SAVINGS_PRICE_IN_<MODEL>   dollars per 1M input tokens
 *   SAVINGS_PRICE_OUT_<MODEL>  dollars per 1M output tokens
 *
 * where <MODEL> is the model id upper-cased with every non-alphanumeric
 * character turned into an underscore:
 *
 *   gemini-3.1-flash-lite  ->  SAVINGS_PRICE_IN_GEMINI_3_1_FLASH_LITE
 */
export type ModelPrice = {
  /** USD per 1,000,000 input tokens */
  inPerMillion: number;
  /** USD per 1,000,000 output tokens */
  outPerMillion: number;
};

function envKey(model: string): string {
  return model.toUpperCase().replace(/[^A-Z0-9]/g, "_");
}

export function priceFor(model: string | null): ModelPrice | null {
  if (!model) return null;
  const key = envKey(model);
  const input = process.env[`SAVINGS_PRICE_IN_${key}`];
  const output = process.env[`SAVINGS_PRICE_OUT_${key}`];
  if (input === undefined || output === undefined) return null;

  const inPerMillion = Number(input);
  const outPerMillion = Number(output);
  if (!Number.isFinite(inPerMillion) || !Number.isFinite(outPerMillion)) return null;
  if (inPerMillion < 0 || outPerMillion < 0) return null;

  return { inPerMillion, outPerMillion };
}

/**
 * The model a naive build would have reached for, for the "what it would have
 * cost" side of the comparison. Unset by default, for the same reason the
 * prices are: we are not going to guess what the big model charges.
 */
export function baselineModel(): string | null {
  const value = process.env.SAVINGS_BASELINE_MODEL;
  return value && value.trim() ? value.trim() : null;
}
