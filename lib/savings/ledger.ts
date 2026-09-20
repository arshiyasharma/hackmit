/**
 * What the model actually cost us, recorded as it happens.
 *
 * THIS FILE INVENTS NOTHING. Every token count here came back from a provider
 * on a real response — Gemini's `usageMetadata`, OpenAI's `usage` — and a call
 * that did not report its usage records null rather than an estimate. The
 * counters on screen are allowed to show a dash; they are not allowed to show
 * a number nobody measured.
 *
 * WHY A MAP, AND WHAT IT COSTS. Same shape as lib/checkout/runs.ts and the
 * same caveat: it is per process, it does not survive a deploy, and two
 * serverless instances do not share it. For a demo on one warm instance that
 * holds. It is not a production ledger and is not pretending to be one.
 */

const STORE_KEY = Symbol.for("visa.savings.ledger");

/** One call to /api/analyze, cached or not. */
export type AnalyzeRecord = {
  at: number;
  /** true when the photo cache answered and NO model was called */
  cached: boolean;
  /** the model that answered. Null when nothing was asked. */
  model: string | null;
  provider: "gemini" | "openai" | null;
  promptTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  /**
   * Tokens this call did not spend because the cache answered.
   *
   * MEASURED, NOT ESTIMATED: it is the real `totalTokens` of the earlier call
   * that put this exact photo in the cache. If we never saw that call — the
   * process restarted, say — it is null, and the call counts as a cache hit
   * whose saving we cannot prove.
   */
  avoidedTokens: number | null;
  /** bytes of the image actually uploaded, as the request carried it */
  imageBytes: number | null;
  elapsedMs: number;
};

type Ledger = {
  analyze: AnalyzeRecord[];
  /** cacheKey -> the real total token count of the call that filled it */
  tokensByKey: Map<string, number>;
};

/** Enough to cover a whole rehearsal without growing without bound. */
const MAX_RECORDS = 500;

function ledger(): Ledger {
  const globals = globalThis as unknown as Record<symbol, Ledger | undefined>;
  const existing = globals[STORE_KEY];
  if (existing) return existing;
  const created: Ledger = { analyze: [], tokensByKey: new Map() };
  globals[STORE_KEY] = created;
  return created;
}

export type RecordAnalyzeInput = {
  /** the sha-256 of the photo, so a repeat read can be priced against its original */
  cacheKey: string;
  cached: boolean;
  model?: string | null;
  provider?: "gemini" | "openai" | null;
  promptTokens?: number | null;
  outputTokens?: number | null;
  totalTokens?: number | null;
  imageBytes?: number | null;
  elapsedMs: number;
  /**
   * True only for the call whose answer went into the photo cache.
   *
   * A request can bill more than once — a model answers unparseable JSON and
   * the next one in the chain gets it right — and every one of those is real
   * spend that must be counted. But only the call that SUCCEEDED sets the
   * price of a future cache hit, because re-reading the photo would cost one
   * good call, not the failures too. Keeping the failures out of that figure
   * is what stops the saving being overstated.
   */
  fillsCache?: boolean;
};

/** A whole, non-negative number — or nothing. Never a coerced zero. */
function count(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.round(value)
    : null;
}

export function recordAnalyze(input: RecordAnalyzeInput): AnalyzeRecord {
  const store = ledger();

  const totalTokens = count(input.totalTokens);
  const record: AnalyzeRecord = {
    at: Date.now(),
    cached: input.cached,
    model: input.model ?? null,
    provider: input.provider ?? null,
    promptTokens: count(input.promptTokens),
    outputTokens: count(input.outputTokens),
    totalTokens,
    // only a cache hit can avoid anything, and only if we priced the original
    avoidedTokens: input.cached
      ? (store.tokensByKey.get(input.cacheKey) ?? null)
      : null,
    imageBytes: count(input.imageBytes),
    elapsedMs: Math.max(0, Math.round(input.elapsedMs)),
  };

  // the successful read teaches us what this photo costs, so the next hit can
  // be priced — see `fillsCache` above for why the failures are excluded
  if (
    !input.cached &&
    input.fillsCache === true &&
    totalTokens !== null &&
    totalTokens > 0
  ) {
    store.tokensByKey.set(input.cacheKey, totalTokens);
  }

  store.analyze.push(record);
  if (store.analyze.length > MAX_RECORDS) {
    store.analyze.splice(0, store.analyze.length - MAX_RECORDS);
  }
  return record;
}

export function analyzeRecords(): readonly AnalyzeRecord[] {
  return ledger().analyze;
}

/** Test seam. Nothing in the app calls this. */
export function resetLedger(): void {
  const store = ledger();
  store.analyze = [];
  store.tokensByKey = new Map();
}
