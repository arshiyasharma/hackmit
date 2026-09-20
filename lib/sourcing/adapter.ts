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

/** Their pipeline returns at most five; the sheet shows about that many. */
const LIMIT = 5;

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
export async function sourceOptions({
  query,
  request,
  itemId,
  budgetRemainingCents,
}: SourceOptionsInput): Promise<Product[] | null> {
  const apiKey = process.env.SERPAPI_KEY;
  if (!apiKey) return null;

  const sourced = await sourceProductsForQuery({
    shoppingQuery: query,
    designQuery: request || query,
    apiKey,
    limit: LIMIT,
    maxPrice:
      budgetRemainingCents != null && budgetRemainingCents > 0
        ? budgetRemainingCents / 100
        : null,
  });

  return sourced
    .map((product) => toProduct(product, itemId))
    .filter((product): product is Product => product !== null);
}
