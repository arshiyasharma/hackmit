import { sourceProductsForQuery } from "@/lib/sourcing/sourceProducts";
import { typicalDimsMm } from "@/lib/sourcing/typical";
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

/*
 * A SEARCH IS ALLOWED TWENTY SECONDS, NOT A MINUTE.
 *
 * Measured on the dev log: one Shopping call took 15.1s, another three were
 * aborted at 20s each, and because the ladder simply carried on the whole
 * question ran for over a minute before the room said "nothing came back".
 * Nobody is watching a lamp search for a minute — by then the answer is worth
 * less than the admission that there isn't one.
 *
 * So the whole question gets one budget. Each rung is capped below it, so a
 * single slow rung cannot eat the lot and leave nothing for the simpler
 * question that was likelier to answer anyway, and when the budget is gone
 * the ladder stops climbing and reports what it has.
 */
const SEARCH_BUDGET_MS = Number(process.env.SEARCH_BUDGET_MS ?? 22_000);
/** How long the styled query may take before the plain answer wins. */
const STYLED_WAIT_MS = Number(process.env.SEARCH_STYLED_WAIT_MS ?? 9_000);
/** Each of the two opening queries. The rest of the budget is the bare one's. */
const PARALLEL_CAP_MS = 8_000;
const MIN_RUNG_MS = 4_000;

function toMm(inches: number | null | undefined): number | null {
  if (inches == null || !Number.isFinite(inches) || inches <= 0) return null;
  return Math.round(inches * MM_PER_INCH);
}

function toCarton(
  dimensions: SourcedProduct["dimensions"],
  title?: string,
  request?: string
): {
  dimsMm?: Carton;
  dimsSource: DimsSource;
} {
  const width = toMm(dimensions.w_in);
  const height = toMm(dimensions.h_in);
  const depth = toMm(dimensions.d_in);

  /*
   * The fit kernel needs all three. A listing that quotes one or two numbers
   * is not half-measured, it is unmeasured — but it is still a bowl, and a
   * bowl-sized bowl standing in the room beats an object with no size at all.
   * Marked "approx" everywhere it is shown, so nobody mistakes it for the
   * retailer's own figure.
   */
  if (width == null || height == null || depth == null) {
    const typical = typicalDimsMm(title, request);
    if (typical) return { dimsMm: typical, dimsSource: "approx" };
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
  // "a plushie" asks a shop about the word "a"; "plushie" asks about plushies
  const bare = request.trim().replace(/^(?:a|an|the)\s+/i, "");
  const words = query.trim().split(/\s+/).filter(Boolean);
  const bareWords = bare.split(/\s+/).filter(Boolean).length;
  const extras = words.slice(0, Math.max(0, words.length - bareWords));

  /*
   * The middle rung DROPS ONE WORD, it does not drop the aesthetic.
   *
   * It used to fall back to the first word plus the object — which, now that
   * colours lead the query, meant "cream coffee table" and no style at all. A
   * room described as stone and travertine searched as though the only thing
   * known about it was that something in it was cream. So the shortest step
   * down is taken instead: lose the last style word, keep the colour and the
   * one before it.
   */
  const rungs = [query.trim()];
  if (extras.length > 1) rungs.push([...extras.slice(0, -1), bare].join(" "));
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

function toProduct(
  sourced: SourcedProduct,
  itemId?: string,
  request?: string
): Product | null {
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
    ...toCarton(sourced.dimensions, sourced.title, request),
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
  const startedAt = now();
  const deadline = startedAt + SEARCH_BUDGET_MS;

  const ask = (rung: string, budgetMs?: number) =>
    sourceProductsForQuery({
      shoppingQuery: rung,
      designQuery: request || rung,
      apiKey,
      limit: LIMIT,
      maxPrice,
      // the rungs ARE the fallbacks; a second ladder underneath this one is
      // how a single question turned into six SerpAPI calls
      fallbacks: false,
      deadline: budgetMs != null ? Math.min(deadline, now() + budgetMs) : deadline,
    }).catch((error) => {
      console.warn(`[search] "${rung}" failed:`, error);
      return [] as SourcedProduct[];
    });

  /*
   * THE PLAIN QUESTION IS ASKED AT THE SAME TIME AS THE STYLED ONE.
   *
   * Sequentially, a styled query that Google answers with an empty page cost
   * its own wait before the simpler one even started — and with SerpAPI
   * taking ten to twenty seconds a call, three rungs in a row ran past the
   * budget and the room reported nothing for a question the shops could
   * answer. The log has exactly that: "warm wood modern minimalist decorative
   * floor pillows" came back empty in 9.7s and "decorative floor pillows" was
   * never reached.
   *
   * So the styled query and the bare object go out together. The styled one
   * still wins when it answers — it is the personalised result and the one on
   * screen — and when it doesn't, the answer is already here rather than
   * twenty seconds away. Two calls, one wait.
   */
  /*
   * THE PARTNER QUERY KEEPS THE COLOUR.
   *
   * Colours lead the query now, so the middle rung is "sage floor pillows" —
   * the colour and the object, without the style word that makes Google give
   * up. That is the one asked alongside the full query, because falling
   * straight to the bare object would mean the colour never reached a shop
   * that answered. The bare object is still there, last, if both come back
   * empty.
   */
  const bare = rungs.length > 1 ? rungs[rungs.length - 1]! : null;
  const partner = rungs.length > 2 ? rungs[1]! : bare;
  /*
   * NEITHER OF THE FIRST TWO MAY SPEND THE WHOLE BUDGET.
   *
   * SerpAPI does not always answer a hopeless query with an empty page; it
   * hangs. "sage decorative floor pillows" was aborted at 20.0s having
   * consumed every second the search had, so "decorative floor pillows" —
   * which answers in under a second — was never asked, and the room showed
   * nothing. Eight seconds each, and what is left belongs to the question
   * that always works.
   */
  const styledJob = ask(rungs[0]!, PARALLEL_CAP_MS);
  const plainJob = partner
    ? ask(partner, PARALLEL_CAP_MS)
    : Promise.resolve([] as SourcedProduct[]);

  /*
   * A HANGING QUERY IS NOT WORTH WAITING OUT.
   *
   * SerpAPI does not answer a long query with an empty page — it stops
   * answering. From the log, "decorative floor pillows" came back in 90ms
   * while "brown minimalist decorative floor pillows" was aborted at 20.0s,
   * and because both were awaited together the room still waited the full
   * twenty seconds for listings it already had.
   *
   * So the styled query gets a window to be better, not a blank cheque. Past
   * it, whatever the plain question found is the answer.
   */
  const styled = await Promise.race([
    styledJob,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), STYLED_WAIT_MS)),
  ]);

  let sourced: SourcedProduct[] = styled ?? [];
  if (sourced.length === 0) {
    if (styled === null) {
      console.info(
        `[search] "${query}" was still thinking after ${STYLED_WAIT_MS}ms; taking "${partner}"`
      );
    } else if (partner) {
      console.info(`[search] "${query}" found nothing; trying "${partner}"`);
    }
    sourced = await plainJob;
  }

  // the bare object, last, only if colour and style both came back empty
  if (
    sourced.length === 0 &&
    bare &&
    bare !== partner &&
    deadline - now() > MIN_RUNG_MS
  ) {
    sourced = await ask(bare);
    if (sourced.length > 0) {
      console.info(`[search] "${query}" found nothing; "${bare}" answered`);
    }
  }

  const options = sourced
    .map((product) => toProduct(product, itemId, request))
    .filter((product): product is Product => product !== null);

  /* one line that answers "was it slow, or was it empty?" */
  console.info(
    `[search] "${query}" -> ${options.length} listing${
      options.length === 1 ? "" : "s"
    } in ${now() - startedAt}ms`
  );

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
    approx: 2,
    missing: 3,
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
