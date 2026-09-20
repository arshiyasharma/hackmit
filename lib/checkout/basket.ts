/**
 * The basket arithmetic. Pure functions, no I/O, no imports outside this
 * folder — every one of them is callable from a unit test with no server, no
 * network and no store.
 *
 * THE NUMBERS ARE DERIVED, NEVER ACCUMULATED. `subtotalMinor` reads the lines
 * every time it is called. A running total kept in a field drifts the moment
 * two updates race, and a budget that drifts is a budget that lies on stage.
 *
 * OVER BUDGET IS REPORTED, NEVER CLAMPED. `remainingMinor` goes negative and
 * says so; what to do about it is the caller's decision, not this file's.
 */

import type { Basket, BasketLine, Listing } from "./types";

/** What one line costs: unit price times how many. */
export function lineTotalMinor(line: BasketLine): number {
  return line.priceMinor * line.quantity;
}

/** Everything in the basket, integer cents. */
export function subtotalMinor(basket: Basket): number {
  return basket.lines.reduce((sum, line) => sum + lineTotalMinor(line), 0);
}

/**
 * Budget minus subtotal. MAY GO NEGATIVE — that is the point. The HUD shows
 * the negative number in the warn colour rather than hiding it at zero.
 */
export function remainingMinor(basket: Basket): number {
  return basket.budgetMinor - subtotalMinor(basket);
}

export function overBudget(basket: Basket): boolean {
  return remainingMinor(basket) < 0;
}

/**
 * Put a line in the basket.
 *
 * One placement holds ONE line, so adding a line for a placement that already
 * has one replaces it in place and keeps its position in the list. That is
 * what linking a different listing to the same sprite means, and it is the
 * invariant `relinkLine` depends on.
 */
export function addLine(basket: Basket, line: BasketLine): Basket {
  const at = basket.lines.findIndex((l) => l.placementId === line.placementId);
  const lines = basket.lines.slice();
  if (at === -1) lines.push(line);
  else lines[at] = line;
  return { ...basket, lines };
}

/** Drop a line by its id. A line id that is not in the basket changes nothing. */
export function removeLine(basket: Basket, lineId: string): Basket {
  const lines = basket.lines.filter((line) => line.lineId !== lineId);
  return lines.length === basket.lines.length ? basket : { ...basket, lines };
}

/**
 * Swap the listing behind a placement and say what that did to the total.
 *
 * `deltaMinor` IS THE DIFFERENCE, NOT THE NEW PRICE. Relinking a $120.00 lamp
 * to an $89.99 one returns -3001, and that signed number is the figure that
 * floats up next to the budget HUD. Returning the new price here is the single
 * most visible bug in the demo, so it has its own test.
 *
 * The difference is measured on the LINE, quantity included, because that is
 * what the budget actually moves by. At quantity 1 — every line in the demo —
 * it is exactly the difference in unit price.
 *
 * A placement with no line in this basket is not an error: the basket comes
 * back untouched with a delta of 0.
 */
export function relinkLine(
  basket: Basket,
  placementId: string,
  newListing: Listing
): { basket: Basket; deltaMinor: number } {
  const at = basket.lines.findIndex((line) => line.placementId === placementId);
  if (at === -1) return { basket, deltaMinor: 0 };

  const previous = basket.lines[at];
  const next: BasketLine = {
    ...previous,
    listingId: newListing.listingId,
    retailer: newListing.retailer,
    title: newListing.title,
    productUrl: newListing.productUrl,
    imageUrl: newListing.imageUrl,
    priceMinor: newListing.priceMinor,
    currency: newListing.currency,
    dimensionsMm: newListing.dimensionsMm,
  };

  const lines = basket.lines.slice();
  lines[at] = next;

  return {
    basket: { ...basket, lines },
    deltaMinor: lineTotalMinor(next) - lineTotalMinor(previous),
  };
}

/**
 * Cents as something a person reads out loud: 125000 -> "$1,250.00".
 *
 * FOR HUMANS ONLY — error sentences and log lines. It is NOT the Visa
 * converter. Prompt 7's `minorToDecimalString` produces "1250.00", with no
 * currency symbol and no thousands separator, and that one is the only thing
 * allowed near a payload. Keeping them apart stops a "$" reaching Visa.
 */
export function formatMoneyMinor(minor: number, currency: string = "USD"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
  }).format(minor / 100);
}
