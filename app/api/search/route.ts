import type { NextRequest } from "next/server";

import { isRequestObject, MAX_QUERY_LENGTH, validRoomContext } from "@/lib/sourcing/request";
import { sourceOptions } from "@/lib/sourcing/adapter";
import { buildSimpleShoppingQuery } from "@/lib/sourcing/roomContext";
import type { Carton, DimsSource, Product, RoomContext } from "@/types";

/**
 * POST /api/search — the styled text search behind the option sheet.
 *
 * In:  { request, category, roomContext, budgetRemainingCents, itemId?, query? }
 * Out: { query, options: Product[], source, note? }
 *
 * The client and this route share the current-context query builder. The
 * request's explicit colour wins; the room contributes its current colour
 * and latest style phrases. Client-supplied query text cannot restore old edits.
 *
 * DIMENSIONS AND PRICE ARE THE ONLY TWO FIELDS THE PRODUCT CONSUMES. Everything
 * else is display. A listing with no dimensions still comes back, with dimsMm
 * absent and dimsSource "missing" — it renders as "no dimensions listed" and a
 * muted fit badge. Dropping results makes the row look broken, and guessing a
 * number would destroy the one rigorous thing in the product.
 */

/*
 * Long enough for the pipeline underneath: two SerpAPI attempts at up to 20s
 * each, plus the dimension scrapes. A search that is cut off halfway reads on
 * screen as "nothing came back", which is the one answer that must never be a
 * lie about the shops.
 */
export const maxDuration = 60;

/** About five, never more than eight. */
const TARGET_OPTIONS = 8;
const MAX_OPTIONS = 8;

/** A shop search that hangs is a sheet full of skeletons. Cut it off. */
const TIMEOUT_MS = 12_000;

/* ------------------------------------------------------------------- query */

/* --------------------------------------------------------------- normalise */

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function num(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const cleaned = value.trim().replace(/^\$\s*/, "").replace(/,/g, "");
    if (!/^-?\d+(?:\.\d+)?$/.test(cleaned)) return undefined;
    const parsed = Number(cleaned);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

/** Integer cents, whatever the scraper called it. Never a float in the store. */
function priceCentsOf(raw: Record<string, unknown>): number | undefined {
  const cents = num(raw.priceCents);
  if (cents !== undefined) return Math.round(cents);
  const dollars = num(raw.price);
  if (dollars !== undefined) return Math.round(dollars * 100);
  return undefined;
}

/** [width, height, depth] in millimetres, or undefined. No guessing. */
function dimsOf(raw: Record<string, unknown>): Carton | undefined {
  const list = raw.dimsMm ?? raw.dimensionsMm ?? raw.dims;
  if (Array.isArray(list) && list.length === 3) {
    const trio = list.map((v) => num(v));
    if (trio.every((v) => v !== undefined && (v as number) > 0)) {
      return [
        Math.round(trio[0] as number),
        Math.round(trio[1] as number),
        Math.round(trio[2] as number),
      ];
    }
  }

  const object = raw.dimensions;
  if (object && typeof object === "object") {
    const o = object as Record<string, unknown>;
    const w = num(o.widthMm ?? o.width);
    const h = num(o.heightMm ?? o.height);
    const d = num(o.depthMm ?? o.depth ?? o.lengthMm ?? o.length);
    if (w && h && d && w > 0 && h > 0 && d > 0) {
      return [Math.round(w), Math.round(h), Math.round(d)];
    }
  }

  return undefined;
}

/** Quoted, guessed or absent — the three are never allowed to blur together. */
function dimsSourceOf(
  raw: Record<string, unknown>,
  dims: Carton | undefined
): DimsSource {
  if (!dims) return "missing";
  const declared = str(raw.dimsSource)?.toLowerCase();
  if (declared === "quoted") return "quoted";
  if (declared === "approx") return "approx";
  return "estimated";
}

function domainOf(url: string): string | undefined {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return undefined;
  }
}

/** Whatever the backend gives back, turned into listings we can print. */
function toOptions(raw: unknown, itemId: string | undefined): Product[] {
  const list = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as { options?: unknown })?.options)
      ? (raw as { options: unknown[] }).options
      : Array.isArray((raw as { products?: unknown })?.products)
        ? (raw as { products: unknown[] }).products
        : Array.isArray((raw as { results?: unknown })?.results)
          ? (raw as { results: unknown[] }).results
          : [];

  const seen = new Set<string>();

  return list
    .flatMap((entry, i): Product[] => {
      if (!entry || typeof entry !== "object") return [];
      const p = entry as Record<string, unknown>;

      // a title, a link and a price, or it is not a listing we can stand behind
      const title = str(p.title) ?? str(p.name);
      const url = str(p.url) ?? str(p.link);
      const priceCents = priceCentsOf(p);
      if (!title || !url || priceCents === undefined || !Number.isSafeInteger(priceCents) || priceCents < 0) return [];
      if (!/^https?:\/\//i.test(url)) return [];
      if (seen.has(url)) return [];
      seen.add(url);

      const dimsMm = dimsOf(p);
      const domain = str(p.retailerDomain) ?? domainOf(url);

      return [
        {
          id: str(p.id) ?? `${itemId ?? "opt"}:${i}`,
          retailer: str(p.retailer) ?? str(p.merchant) ?? domain ?? "Shop",
          retailerDomain: domain,
          title,
          url,
          imageUrl: str(p.imageUrl) ?? str(p.image) ?? str(p.thumbnail),
          priceCents,
          currency: str(p.currency)?.toUpperCase() ?? "USD",
          dimsMm,
          dimsSource: dimsSourceOf(p, dimsMm),
          inStock: p.inStock !== false,
          itemId,
          // v2 keyed options by elementId; the fit sheet still groups on it
          elementId: itemId,
        },
      ];
    })
    .slice(0, MAX_OPTIONS);
}

/* ------------------------------------------------------------ frozen demo */

/**
 * ?demo=1 replays a rehearsal set instead of gambling on conference wifi. The
 * sheet says "frozen demo listings" out loud whenever `source` is "demo" — a
 * judge who catches an unflagged fake is finished with you.
 *
 * The links are the retailer's own search page for the query: a real page that
 * really resolves, rather than a product id invented at a desk.
 */
type FrozenSeed = {
  retailer: string;
  domain: string;
  search: (q: string) => string;
  title: (request: string) => string;
  priceCents: number;
  dimsMm?: Carton;
  dimsSource: DimsSource;
};

const FROZEN_SEEDS: FrozenSeed[] = [
  {
    retailer: "IKEA",
    domain: "ikea.com",
    search: (q) => `https://www.ikea.com/us/en/search/?q=${encodeURIComponent(q)}`,
    title: (r) => `Brass-finish ${r.replace(/^an? /, "")}, tall`,
    priceCents: 4900,
    dimsMm: [320, 1520, 320],
    dimsSource: "quoted",
  },
  {
    retailer: "Wayfair",
    domain: "wayfair.com",
    search: (q) => `https://www.wayfair.com/keyword.php?keyword=${encodeURIComponent(q)}`,
    title: (r) => `Ornate carved ${r.replace(/^an? /, "")}`,
    priceCents: 12900,
    dimsMm: [380, 1780, 380],
    dimsSource: "quoted",
  },
  {
    retailer: "Etsy",
    domain: "etsy.com",
    search: (q) => `https://www.etsy.com/search?q=${encodeURIComponent(q)}`,
    title: (r) => `Handmade ${r.replace(/^an? /, "")}, warm wood`,
    priceCents: 21500,
    // one listing with nothing quoted, on purpose: the "can't check" path is
    // part of the demo, not an edge case
    dimsSource: "missing",
  },
  {
    retailer: "Amazon",
    domain: "amazon.com",
    search: (q) => `https://www.amazon.com/s?k=${encodeURIComponent(q)}`,
    title: (r) => `Classic ${r.replace(/^an? /, "")} with fabric shade`,
    priceCents: 7400,
    dimsMm: [300, 1420, 300],
    dimsSource: "estimated",
  },
  {
    retailer: "Walmart",
    domain: "walmart.com",
    search: (q) => `https://www.walmart.com/search?q=${encodeURIComponent(q)}`,
    title: (r) => `Budget ${r.replace(/^an? /, "")}`,
    priceCents: 3200,
    dimsMm: [280, 1310, 280],
    dimsSource: "quoted",
  },
];

function frozenOptions(
  query: string,
  request: string,
  itemId: string | undefined
): Product[] {
  const subject = request.trim() || query || "piece";
  return FROZEN_SEEDS.map((seed, i) => ({
    id: `${itemId ?? "demo"}:frozen:${i}`,
    retailer: seed.retailer,
    retailerDomain: seed.domain,
    title: seed.title(subject),
    url: seed.search(query || subject),
    priceCents: seed.priceCents,
    currency: "USD",
    dimsMm: seed.dimsMm,
    dimsSource: seed.dimsSource,
    inStock: true,
    itemId,
    elementId: itemId,
  }));
}

/* ------------------------------------------------------------------- route */

type Body = {
  request?: unknown;
  category?: unknown;
  query?: unknown;
  itemId?: unknown;
  roomContext?: unknown;
  budgetRemainingCents?: unknown;
};

/** The scraper, when there is one. Unset is a normal state, not an error. */
function backendUrl(): string | null {
  return (
    process.env.SEARCH_API_URL ??
    process.env.NEXT_PUBLIC_SEARCH_API_URL ??
    null
  );
}

export async function POST(request: NextRequest) {
  const parsed: unknown = await request.json().catch(() => null);
  if (!isRequestObject(parsed)) {
    return Response.json({ error: "A JSON object is required", options: [] }, { status: 400 });
  }
  const body = parsed as Body;
  if (!validRoomContext(body.roomContext) ||
      [body.request, body.query, body.category, body.itemId].some((value) =>
        value !== undefined && (typeof value !== "string" || value.length > MAX_QUERY_LENGTH))) {
    return Response.json({ error: "Invalid search request", options: [] }, { status: 400 });
  }
  if (body.budgetRemainingCents !== undefined &&
      (typeof body.budgetRemainingCents !== "number" || !Number.isSafeInteger(body.budgetRemainingCents))) {
    return Response.json({ error: "budgetRemainingCents must be integer cents", options: [] }, { status: 400 });
  }

  const ask = str(body.request) ?? "";
  const category = str(body.category) ?? ask;
  const itemId = str(body.itemId);
  const roomContext =
    body.roomContext && typeof body.roomContext === "object"
      ? (body.roomContext as RoomContext)
      : null;

  // Rebuild from the current request/context; stale client query text must not undo edits.
  const query = buildSimpleShoppingQuery(ask || str(body.query) || "", roomContext);
  const budgetRemainingCents = num(body.budgetRemainingCents);
  if (!query || query.length > MAX_QUERY_LENGTH) {
    return Response.json({ error: "query or request must contain 1–500 characters", options: [] }, { status: 400 });
  }

  if (request.nextUrl.searchParams.get("demo") === "1") {
    return Response.json({
      query,
      options: frozenOptions(query, ask, itemId),
      source: "demo",
      note: "Frozen demo listings — prices and sizes are from the rehearsal set.",
    });
  }

  // In-process first: Yutian's Elastic + SerpAPI pipeline lives in this app,
  // so there is no second service to deploy and no HTTP hop to time out.
  try {
    const sourced = await sourceOptions({
      query,
      request: ask,
      itemId,
      budgetRemainingCents: budgetRemainingCents ?? undefined,
    });
    if (sourced && sourced.length > 0) {
      return Response.json({ query, options: sourced, source: "live" });
    }
    if (sourced) {
      return Response.json({
        query,
        options: [],
        source: "live",
        note: `No listings came back for “${query}”. Try fewer style words.`,
      });
    }
  } catch {
    // fall through to the external backend, then to the honest empty answer
  }

  const endpoint = backendUrl();
  if (!endpoint) {
    return Response.json({
      query,
      options: [],
      source: "none",
      note: "The shop search isn't connected yet. Add SERPAPI_KEY, or set SEARCH_API_URL.",
    });
  }

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query,
        request: ask,
        category,
        styleTags: roomContext?.styleTags ?? [],
        roomContext,
        budgetRemainingCents,
        limit: TARGET_OPTIONS,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });

    if (!res.ok) {
      return Response.json({
        query,
        options: [],
        source: "none",
        note: "The shops didn't answer. Try the search again.",
      });
    }

    const options = toOptions(await res.json(), itemId);
    return Response.json({
      query,
      options,
      source: options.length > 0 ? "live" : "none",
      note:
        options.length > 0
          ? undefined
          : "Nothing came back for that. Try different words.",
    });
  } catch (err) {
    console.warn("[api/search]", err);
    return Response.json({
      query,
      options: [],
      source: "none",
      note: "The shops didn't answer in time. Try the search again.",
    });
  }
}
