/**
 * The frozen catalogue.
 *
 * NOTHING HERE TOUCHES THE NETWORK, and that is the whole point. The demo runs
 * with the wifi off; a listing fetched on stage is a listing that can fail on
 * stage. `data/listings.json` is committed, imported at build time, and read
 * from memory.
 *
 * The file's own `_readme` documents its shape, its units and where its rows
 * came from. Tian's scraper overwrites it — same shape, same units, more
 * retailers — and no caller here changes when it does.
 *
 * ROWS ARE VALIDATED ON THE WAY IN, ONCE. A row the scraper writes badly is
 * dropped rather than trusted, because a `priceMinor` that arrived as a float
 * or a `productUrl` that arrived empty would be a wrong number on a price tag
 * or a dead link under a judge's thumb.
 */

import catalogue from "@/data/listings.json";

import type { Listing, Retailer } from "./types";

const RETAILERS: ReadonlySet<string> = new Set<Retailer>([
  "amazon",
  "wayfair",
  "ikea",
  "target",
  "westelm",
  "cb2",
  "etsy",
]);

function isRetailer(value: unknown): value is Retailer {
  return typeof value === "string" && RETAILERS.has(value);
}

/** Millimetres, all three, all positive integers — or nothing at all. */
function toDimensions(value: unknown): Listing["dimensionsMm"] {
  if (!value || typeof value !== "object") return null;
  const d = value as Record<string, unknown>;
  const trio = [d.w, d.h, d.d];
  if (!trio.every((n) => typeof n === "number" && Number.isInteger(n) && n > 0)) {
    return null;
  }
  return { w: d.w as number, h: d.h as number, d: d.d as number };
}

/** A row we are willing to put in front of a person, or null. */
function toListing(raw: unknown): Listing | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;

  const listingId = typeof r.listingId === "string" ? r.listingId.trim() : "";
  const title = typeof r.title === "string" ? r.title.trim() : "";
  const productUrl = typeof r.productUrl === "string" ? r.productUrl.trim() : "";
  const imageUrl = typeof r.imageUrl === "string" ? r.imageUrl.trim() : "";
  const priceMinor = r.priceMinor;

  if (!listingId || !title || !productUrl) return null;
  if (!isRetailer(r.retailer)) return null;
  // cents, never a float, never free
  if (typeof priceMinor !== "number" || !Number.isInteger(priceMinor) || priceMinor <= 0) {
    return null;
  }
  if (r.currency !== "USD") return null;

  return {
    listingId,
    retailer: r.retailer,
    title,
    productUrl,
    imageUrl,
    priceMinor,
    currency: "USD",
    dimensionsMm: toDimensions(r.dimensionsMm),
  };
}

/** Built once, at module load. The array is frozen so no caller can edit it. */
const LISTINGS: readonly Listing[] = Object.freeze(
  (Array.isArray(catalogue.listings) ? catalogue.listings : [])
    .map(toListing)
    .filter((listing): listing is Listing => listing !== null)
);

const BY_ID: ReadonlyMap<string, Listing> = new Map(
  LISTINGS.map((listing) => [listing.listingId, listing])
);

/** Every row, in catalogue order. */
export function allListings(): readonly Listing[] {
  return LISTINGS;
}

/** One row by its id, or undefined. Never throws — a missing id is a 404, not a crash. */
export function getListing(id: string): Listing | undefined {
  return BY_ID.get(id);
}

export interface ListListingsOptions {
  /** matched against the title, case-insensitively, word by word */
  query?: string;
  /** inclusive ceiling in integer cents */
  maxPriceMinor?: number;
  retailer?: Retailer;
}

/**
 * The catalogue, filtered. Cheapest first, so a budget-constrained caller sees
 * what it can afford at the top.
 *
 * The query match is deliberately dumb — every word has to appear somewhere in
 * the title. This is a frozen file of a few rows, not a search engine, and the
 * real ranking is `app/api/search/route.ts`'s problem.
 */
export function listListings(options: ListListingsOptions = {}): Listing[] {
  const words = (options.query ?? "")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);

  return LISTINGS.filter((listing) => {
    if (options.retailer && listing.retailer !== options.retailer) return false;
    if (
      options.maxPriceMinor !== undefined &&
      listing.priceMinor > options.maxPriceMinor
    ) {
      return false;
    }
    if (words.length === 0) return true;
    const haystack = listing.title.toLowerCase();
    return words.every((word) => haystack.includes(word));
  }).sort((a, b) => a.priceMinor - b.priceMinor);
}
