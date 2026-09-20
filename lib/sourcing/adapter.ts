import { sourceProductsForQuery } from "@/lib/sourcing/sourceProducts";
import type { Product as SourcedProduct } from "@/lib/sourcing/enrich";
import type { Carton, DimsSource, Product } from "@/types";

/**
 * The seam between Yutian's sourcing pipeline and the room UI.
 *
 * THE TWO SIDES DISAGREE ABOUT UNITS AND THAT IS THE WHOLE POINT OF THIS FILE.
 * The scraper reads retailer listings, which quote INCHES as { h_in, w_in,
 * d_in }. Everything downstream of here — the sprite's real-world size, the
 * dimension label, and lib/fit.ts, whose numbers get said out loud on stage —
 * is integer MILLIMETRES as [width, height, depth]. Converting in one place
 * means a mixed unit can only ever be wrong here, not in five components.
 *
 * It also carries the honesty rule across: `estimated` on their side becomes
 * dimsSource "estimated", a listing with no numbers becomes "missing", and
 * neither is ever filled in with a guess.
 */

const MM_PER_INCH = 25.4;

/*
 * ONE CALL PER QUESTION, NOT ELEVEN.
 *
 * The server log caught the same query going out eleven times in forty
 * seconds — a re-render storm upstream, each repeat spending a SerpAPI request
 * and each fanning out again over the query ladder. That is how a key hits its
 * rate limit inside a minute, and a rate-limited key is what "nothing came
 * back from that" actually is most of the time.
 *
 * So identical questions share one answer: a query already in flight is
 * awaited rather than asked again, and a query that just answered — including
 * one that answered with nothing — is replayed from memory for a short while.
 * Whatever is re-rendering upstream can no longer cost credits.
 */
const inFlight = new Map<string, Promise<Product[] | null>>();
const recent = new Map<string, { options: Product[]; at: number; ttl: number }>();
const RECENT_TTL_MS = 60_000;
/*
 * An empty answer is remembered for long enough to absorb a re-render storm
 * and no longer. Holding "nothing" for a full minute turned one bad search
 * into a minute of a broken-looking room, because the retry the user reached
 * for was answered from memory without ever asking the shops again.
 */
const EMPTY_TTL_MS = 10_000;

function now(): number {
  return Date.now();
}

function sweep(): void {
  for (const [key, value] of recent) {
    if (now() - value.at > value.ttl) recent.delete(key);
  }
}

/**
 * Eight. The sheet is a swipeable row, so more listings cost a scroll rather
 * than a screen, and with most listings carrying no dimensions a wider set is
 * what gives the fit check something to judge.
 */
const LIMIT = 8;

function toMm(inches: number | null | undefined): number | null {
  if (inches == null || !Number.isFinite(inches) || inches <= 0) return null;
  return Math.round(inches * MM_PER_INCH);
}

function toCarton(dimensions: SourcedProduct["dimensions"]): {
  dimsMm?: Carton;
  dimsSource: DimsSource;
} {
  const width = toMm(dimensions.w_in);
  const height = toMm(dimensions.h_in);
  const depth = toMm(dimensions.d_in);

  // the fit kernel needs all three; a partial listing is treated as missing
  if (width == null || height == null || depth == null) {
    return { dimsSource: "missing" };
  }

  return {
    dimsMm: [width, height, depth],
    dimsSource: dimensions.estimated ? "estimated" : "quoted",
  };
}

/**
 * The styled query, then a loosened one, then the bare request. Duplicates and
 * empties are dropped, so an unstyled ask is a single rung and a single call.
 */
function ladder(query: string, request: string): string[] {
  const bare = request.trim();
  const words = query.trim().split(/\s+/).filter(Boolean);
  const bareWords = bare.split(/\s+/).filter(Boolean).length;
  const styleWords = Math.max(0, words.length - bareWords);

  const rungs = [query.trim()];
  // one style word plus the request, when there was more than one to begin with
  if (styleWords > 1) rungs.push([words[0], bare].join(" "));
  if (bare) rungs.push(bare);

  return rungs.filter((rung, i, all) => rung && all.indexOf(rung) === i);
}

function retailerDomain(url: string): string | undefined {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return undefined;
  }
}

function toProduct(sourced: SourcedProduct, itemId?: string): Product | null {
  // no link means a judge cannot check it, so it is not an option
  if (!sourced.product_url || !sourced.title) return null;

  return {
    id: sourced.id,
    retailer: sourced.retailer,
    retailerDomain: retailerDomain(sourced.product_url),
    title: sourced.title,
    url: sourced.product_url,
    imageUrl: sourced.image_url || undefined,
    priceCents: sourced.price_cents ?? 0,
    currency: sourced.currency ?? "USD",
    ...toCarton(sourced.dimensions),
    inStock: sourced.in_stock ?? true,
    itemId,
  };
}

export type SourceOptionsInput = {
  /** the styled query the sheet is already showing the user */
  query: string;
  /** what the user actually asked for, used to drop irrelevant hits */
  request: string;
  itemId?: string;
  budgetRemainingCents?: number;
};

/**
 * Returns null when SERPAPI_KEY is unset, so the caller can fall through to
 * its own "not connected yet" answer rather than reporting an empty shop.
 */
export async function sourceOptions(
  input: SourceOptionsInput
): Promise<Product[] | null> {
  const apiKey = process.env.SERPAPI_KEY;
  if (!apiKey) return null;

  const key = `${input.query}|${input.request}`.toLowerCase();

  sweep();
  const cached = recent.get(key);
  if (cached) {
    console.info(
      `[search] "${input.query}" — answered from the last minute (${cached.options.length})`
    );
    return cached.options.map((option) => ({ ...option, itemId: input.itemId }));
  }

  const running = inFlight.get(key);
  if (running) {
    console.info(`[search] "${input.query}" — already in flight, sharing it`);
    const shared = await running;
    return shared?.map((option) => ({ ...option, itemId: input.itemId })) ?? null;
  }

  const job = fetchOptions(input, apiKey).finally(() => inFlight.delete(key));
  inFlight.set(key, job);

  const options = await job;
  if (options) {
    recent.set(key, {
      options,
      at: now(),
      ttl: options.length > 0 ? RECENT_TTL_MS : EMPTY_TTL_MS,
    });
  }
  return options;
}

async function fetchOptions(
  { query, request, itemId, budgetRemainingCents }: SourceOptionsInput,
  apiKey: string
): Promise<Product[] | null> {

  /*
   * The query on screen IS the query that runs. Logged because the strip is
   * the one part of this product a judge will poke at: "it says it is
   * searching for pink — is it?" is answerable from the server log.
   */
  console.info(`[search] "${query}" (relevance: "${request || query}")`);

  const maxPrice =
    budgetRemainingCents != null && budgetRemainingCents > 0
      ? budgetRemainingCents / 100
      : null;

  /*
   * A LADDER, BECAUSE GOOGLE ANSWERS PLAIN QUESTIONS.
   *
   * Measured against the live API: "floor lamp" returns 40 results in 2.8s,
   * "scandinavian a floor lamp" returns listings in 3.2s, and "warm wood
   * scandinavian floor lamp" returns
   *     "Google hasn't returned any results for this query."
   * Three adjectives is the cliff. So the styled query is asked first — it is
   * the one the user is watching and the one that personalises the results —
   * and if the shops have nothing for it, the same question is asked with one
   * style word, then with none. The first rung that answers wins.
   *
   * It stops at the first non-empty result, so the usual case is still one
   * call. Only a query the shops cannot answer costs a second.
   */
  const rungs = ladder(query, request);
  let sourced: SourcedProduct[] = [];

  for (const rung of rungs) {
    sourced = await sourceProductsForQuery({
      shoppingQuery: rung,
      designQuery: request || rung,
      apiKey,
      limit: LIMIT,
      maxPrice,
    });
    if (sourced.length > 0) {
      if (rung !== query) {
        console.info(`[search] "${query}" found nothing; "${rung}" answered`);
      }
      break;
    }
  }

  const options = sourced
    .map((product) => toProduct(product, itemId))
    .filter((product): product is Product => product !== null);

  /*
   * A listing whose dimensions the retailer published comes first.
   *
   * Nothing is dropped — a listing with no size still shows, still says "no
   * dimensions listed", and is still buyable. But most Etsy pages quote no
   * size at all, so a live search regularly puts three unmeasurable lamps
   * ahead of the one the fit check can actually judge. The sprite can only
   * stand at its true height, and the fit check can only fire, on a listing
   * that carries millimetres — so those lead.
   */
  const rank: Record<DimsSource, number> = {
    quoted: 0,
    estimated: 1,
    missing: 2,
  };

  return options
    .map((option, index) => ({ option, index }))
    .sort(
      (a, b) =>
        rank[a.option.dimsSource] - rank[b.option.dimsSource] ||
        a.index - b.index,
    )
    .map(({ option }) => option);
}
