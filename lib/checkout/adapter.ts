import type { CartItem, Product } from "@/types";

import { RETAILER_DOMAINS, RETAILERS, hostBelongsTo } from "./retailers";
import type { Basket, BasketLine, Retailer } from "./types";

/**
 * Where the room screen's vocabulary meets the server's. The ONLY place.
 *
 * `types/index.ts` speaks `Product.priceCents` / `Product.url` / a free-text
 * `retailer`, and groups a basket into `CartItem[]`. `lib/checkout/types.ts`
 * speaks `BasketLine.priceMinor` / `productUrl` / a closed `Retailer` union,
 * and tracks state per LINE because a TAP signature is bound to one line's
 * product URL. Both files say the other must not import it. This adapter is
 * the sanctioned exception, and keeping it to one file is what stops the two
 * vocabularies drifting into each other.
 *
 * PURE, AND SAFE IN THE BROWSER. No `node:` imports, no network, no store. The
 * checkout screen calls it on the way into `POST /api/checkout`.
 */

/** "West Elm" and "west-elm" and "WestElm" all reduce to "westelm". */
function normaliseName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

const BY_NAME: ReadonlyMap<string, Retailer> = new Map(
  RETAILERS.map((retailer) => [normaliseName(retailer), retailer])
);

/** A few spellings the shops themselves use that do not reduce to the key. */
const ALIASES: Readonly<Record<string, Retailer>> = {
  westelmcom: "westelm",
  ikeaus: "ikea",
  amazoncom: "amazon",
  targetcom: "target",
  cb2com: "cb2",
  etsycom: "etsy",
  wayfaircom: "wayfair",
};

/**
 * Which shop a listing belongs to, or null.
 *
 * THE URL WINS. A listing's display name is whatever a scraper wrote down, but
 * its URL is the thing the agent will sign a request for, and the merchant
 * checks the signature against its own host. Resolving by anything other than
 * the URL first would let a line be signed for one shop and presented to
 * another, which the verifier would then — correctly — refuse.
 */
export function resolveRetailer(product: Product): Retailer | null {
  try {
    const host = new URL(product.url).host;
    for (const retailer of RETAILERS) {
      if (hostBelongsTo(retailer, host)) return retailer;
    }
  } catch {
    // not a URL. Fall through to the name; the server will refuse a line with
    // no usable product URL anyway.
  }

  if (product.retailerDomain) {
    for (const retailer of RETAILERS) {
      if (hostBelongsTo(retailer, product.retailerDomain)) return retailer;
    }
  }

  const key = normaliseName(product.retailer ?? "");
  return BY_NAME.get(key) ?? ALIASES[key] ?? null;
}

/** [w, h, d] millimetres → the server's object, or null when any of it is missing. */
function dimensions(product: Product): BasketLine["dimensionsMm"] {
  const dims = product.dimsMm;
  if (!dims || dims.length !== 3) return null;
  const [w, h, d] = dims;
  const whole = [w, h, d].every((n) => Number.isInteger(n) && n > 0);
  return whole ? { w, h, d } : null;
}

export interface BasketConversion {
  basket: Basket;
  /**
   * Lines we could not hand to the agent, each with the sentence to show.
   *
   * NEVER SILENTLY DROPPED. A line that vanishes between the review and the
   * run is the kind of bug nobody notices until the total is wrong, so the
   * caller gets them back and has to decide what to say.
   */
  unsupported: Array<{ line: CartItem; reason: string }>;
}

/**
 * Freeze the reviewed basket into the shape `POST /api/checkout` wants.
 *
 * `budgetCents` comes from the store, which is the same number the budget HUD
 * shows. It is passed through untouched — this layer reports the budget, it
 * does not compute it, and when Prompt 7's mandate lands it is this number
 * that becomes the mandate's decline threshold.
 */
export function toBasket(
  lines: readonly CartItem[],
  budgetCents: number,
  basketId?: string
): BasketConversion {
  const unsupported: BasketConversion["unsupported"] = [];
  const basketLines: BasketLine[] = [];

  for (const line of lines) {
    const product = line.product;
    const retailer = resolveRetailer(product);

    if (!retailer) {
      unsupported.push({
        line,
        reason: `We cannot check out at ${product.retailer || "that shop"} yet.`,
      });
      continue;
    }
    if (!product.url) {
      unsupported.push({
        line,
        reason: `${product.title} has no link to the shop that sells it.`,
      });
      continue;
    }
    if (!Number.isInteger(product.priceCents) || product.priceCents <= 0) {
      unsupported.push({ line, reason: `${product.title} has no price on it.` });
      continue;
    }

    basketLines.push({
      lineId: line.id,
      placementId: line.itemId,
      listingId: product.id,
      retailer,
      title: product.title,
      productUrl: product.url,
      imageUrl: product.imageUrl ?? product.image ?? "",
      priceMinor: product.priceCents,
      currency: "USD",
      dimensionsMm: dimensions(product),
      quantity: Number.isInteger(line.quantity) && line.quantity > 0 ? line.quantity : 1,
    });
  }

  return {
    basket: {
      basketId: basketId ?? `basket-${Date.now()}`,
      lines: basketLines,
      budgetMinor: Number.isInteger(budgetCents) && budgetCents > 0 ? budgetCents : 0,
    },
    unsupported,
  };
}

/** The shop's display name, for a heading. Falls back to the listing's own spelling. */
export function displayRetailer(product: Product): string {
  return product.retailer || resolveRetailer(product) || "the shop";
}

/** Exported for the adapter's tests and for anyone checking coverage of the union. */
export const SUPPORTED_DOMAINS = RETAILER_DOMAINS;
