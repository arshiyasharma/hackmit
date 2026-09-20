import { describe, expect, it } from "vitest";

import {
  addLine,
  formatMoneyMinor,
  lineTotalMinor,
  overBudget,
  relinkLine,
  removeLine,
  remainingMinor,
  subtotalMinor,
} from "./basket";
import { allListings, getListing, listListings } from "./listings";
import type { Basket, BasketLine, Listing } from "./types";

function line(patch: Partial<BasketLine> = {}): BasketLine {
  return {
    lineId: "line-1",
    placementId: "place-1",
    listingId: "listing-1",
    retailer: "ikea",
    title: "A tall lamp",
    productUrl: "https://www.ikea.com/us/en/p/example-00000000/",
    imageUrl: "https://www.ikea.com/example.jpg",
    priceMinor: 12000,
    currency: "USD",
    dimensionsMm: null,
    quantity: 1,
    ...patch,
  };
}

function basket(lines: BasketLine[], budgetMinor = 125000): Basket {
  return { basketId: "basket-1", lines, budgetMinor, budgetSet: true, profileMm: null };
}

describe("subtotal, remaining, over budget", () => {
  it("sums price times quantity", () => {
    const b = basket([
      line({ lineId: "a", placementId: "p-a", priceMinor: 12000 }),
      line({ lineId: "b", placementId: "p-b", priceMinor: 8999, quantity: 2 }),
    ]);
    expect(subtotalMinor(b)).toBe(12000 + 8999 * 2);
  });

  it("an empty basket costs nothing", () => {
    expect(subtotalMinor(basket([]))).toBe(0);
  });

  it("remaining goes negative rather than clamping at zero", () => {
    const b = basket([line({ priceMinor: 140000 })], 125000);
    expect(remainingMinor(b)).toBe(-15000);
    expect(overBudget(b)).toBe(true);
  });

  it("exactly on budget is not over budget", () => {
    const b = basket([line({ priceMinor: 125000 })], 125000);
    expect(remainingMinor(b)).toBe(0);
    expect(overBudget(b)).toBe(false);
  });

  it("counts quantity in the line total", () => {
    expect(lineTotalMinor(line({ priceMinor: 1199, quantity: 3 }))).toBe(3597);
  });
});

describe("relinkLine — the floating +/- number", () => {
  const cheaper: Listing = {
    listingId: "listing-2",
    retailer: "ikea",
    title: "A shorter lamp",
    productUrl: "https://www.ikea.com/us/en/p/other-11111111/",
    imageUrl: "https://www.ikea.com/other.jpg",
    priceMinor: 8999,
    currency: "USD",
    dimensionsMm: null,
  };

  it("returns the DIFFERENCE, not the new price — $120.00 to $89.99 is -3001", () => {
    const b = basket([line({ priceMinor: 12000 })]);
    const { deltaMinor } = relinkLine(b, "place-1", cheaper);
    expect(deltaMinor).toBe(-3001);
    // the bug this guards against: returning 8999
    expect(deltaMinor).not.toBe(cheaper.priceMinor);
  });

  it("is positive when the new listing costs more", () => {
    const b = basket([line({ priceMinor: 8999 })]);
    const dearer: Listing = { ...cheaper, priceMinor: 12000 };
    expect(relinkLine(b, "place-1", dearer).deltaMinor).toBe(3001);
  });

  it("swaps the listing behind the placement and keeps the line's own ids", () => {
    const b = basket([line({ priceMinor: 12000 })]);
    const { basket: next } = relinkLine(b, "place-1", cheaper);
    expect(next.lines[0].lineId).toBe("line-1");
    expect(next.lines[0].placementId).toBe("place-1");
    expect(next.lines[0].listingId).toBe("listing-2");
    expect(next.lines[0].priceMinor).toBe(8999);
    expect(next.lines[0].productUrl).toBe(cheaper.productUrl);
  });

  it("measures the difference on the line, quantity included", () => {
    const b = basket([line({ priceMinor: 12000, quantity: 2 })]);
    expect(relinkLine(b, "place-1", cheaper).deltaMinor).toBe(-6002);
  });

  it("a placement with no line changes nothing", () => {
    const b = basket([line()]);
    const { basket: next, deltaMinor } = relinkLine(b, "place-nowhere", cheaper);
    expect(deltaMinor).toBe(0);
    expect(next).toBe(b);
  });

  it("does not mutate the basket it was given", () => {
    const b = basket([line({ priceMinor: 12000 })]);
    relinkLine(b, "place-1", cheaper);
    expect(b.lines[0].priceMinor).toBe(12000);
  });
});

describe("addLine / removeLine", () => {
  it("appends a line for a new placement", () => {
    const b = basket([line()]);
    const next = addLine(b, line({ lineId: "line-2", placementId: "place-2" }));
    expect(next.lines).toHaveLength(2);
  });

  it("replaces in place when the placement already has a line", () => {
    const b = basket([line(), line({ lineId: "line-2", placementId: "place-2" })]);
    const next = addLine(
      b,
      line({ lineId: "line-3", placementId: "place-1", priceMinor: 500 })
    );
    expect(next.lines).toHaveLength(2);
    expect(next.lines[0].lineId).toBe("line-3");
    expect(next.lines[0].priceMinor).toBe(500);
  });

  it("removes by line id and leaves an unknown id alone", () => {
    const b = basket([line(), line({ lineId: "line-2", placementId: "place-2" })]);
    expect(removeLine(b, "line-1").lines).toHaveLength(1);
    expect(removeLine(b, "nope")).toBe(b);
  });
});

describe("formatMoneyMinor", () => {
  it("reads the way a person says it", () => {
    expect(formatMoneyMinor(125000)).toBe("$1,250.00");
    expect(formatMoneyMinor(8999)).toBe("$89.99");
    expect(formatMoneyMinor(0)).toBe("$0.00");
  });
});

describe("the frozen catalogue", () => {
  it("has eight rows and every one carries a real product URL", () => {
    const all = allListings();
    expect(all).toHaveLength(8);
    for (const listing of all) {
      expect(listing.productUrl).toMatch(/^https:\/\//);
      expect(listing.priceMinor).toBeGreaterThan(0);
      expect(Number.isInteger(listing.priceMinor)).toBe(true);
      expect(listing.currency).toBe("USD");
    }
  });

  it("finds a row by id and answers undefined for one that is not there", () => {
    const first = allListings()[0];
    expect(getListing(first.listingId)).toEqual(first);
    expect(getListing("listing-that-does-not-exist")).toBeUndefined();
  });

  it("filters on title words and on price, cheapest first", () => {
    const cheap = listListings({ maxPriceMinor: 3000 });
    expect(cheap.length).toBeGreaterThan(0);
    for (const listing of cheap) expect(listing.priceMinor).toBeLessThanOrEqual(3000);
    const prices = cheap.map((l) => l.priceMinor);
    expect(prices).toEqual([...prices].sort((a, b) => a - b));

    expect(listListings({ query: "bookcase" }).map((l) => l.listingId)).toEqual([
      "ikea-20522046",
    ]);
    expect(listListings({ query: "nothing matches this" })).toHaveLength(0);
  });
});
