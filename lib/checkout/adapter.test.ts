import { describe, expect, it } from "vitest";

import { displayRetailer, resolveRetailer, toBasket } from "./adapter";
import type { CartItem, Product } from "@/types";

/**
 * The adapter is the only place the room screen's vocabulary meets the
 * server's, so a mistake here is invisible on both sides and shows up as a
 * 400 mid-demo. It is tested harder than its size suggests.
 */

function product(patch: Partial<Product> = {}): Product {
  return {
    id: "ikea-70437814",
    retailer: "IKEA",
    title: "A tall lamp",
    url: "https://www.ikea.com/us/en/p/lamp-70437814/",
    imageUrl: "https://example.com/lamp.jpg",
    priceCents: 12000,
    currency: "USD",
    dimsMm: [300, 1500, 300],
    dimsSource: "quoted",
    inStock: true,
    ...patch,
  };
}

function cartItem(patch: Partial<Product> = {}, quantity = 1): CartItem {
  const p = product(patch);
  return {
    id: `line-${p.id}`,
    product: p,
    quantity,
    itemId: `item-${p.id}`,
    addedAt: Date.now(),
  };
}

describe("resolveRetailer — the URL wins", () => {
  it("reads the shop off the product URL", () => {
    expect(resolveRetailer(product())).toBe("ikea");
    expect(
      resolveRetailer(product({ url: "https://www.wayfair.com/furniture/pdp/lamp-1" }))
    ).toBe("wayfair");
    expect(resolveRetailer(product({ url: "https://www.walmart.com/ip/rug/1" }))).toBe(
      "walmart"
    );
  });

  it("trusts the URL over a display name that disagrees", () => {
    // a scraper wrote the wrong name. The signature will be made for the URL's
    // host, so the URL is the only answer that cannot mislead the merchant.
    expect(
      resolveRetailer(product({ retailer: "Wayfair", url: "https://www.ikea.com/p/x" }))
    ).toBe("ikea");
  });

  it("handles a shop's own subdomains", () => {
    expect(resolveRetailer(product({ url: "https://smile.amazon.com/dp/B0" }))).toBe(
      "amazon"
    );
  });

  it("falls back to the domain field, then the display name", () => {
    expect(
      resolveRetailer(
        product({ url: "not-a-url", retailerDomain: "walmart.com", retailer: "" })
      )
    ).toBe("walmart");
    expect(resolveRetailer(product({ url: "not-a-url", retailer: "Walmart" }))).toBe(
      "walmart"
    );
    expect(resolveRetailer(product({ url: "not-a-url", retailer: "wal-mart" }))).toBe(
      "walmart"
    );
  });

  it("is null for a shop we cannot check out at", () => {
    expect(resolveRetailer(product({ url: "https://www.costco.com/p/1", retailer: "Costco" }))).toBeNull();
  });

  it("is not fooled by a lookalike domain", () => {
    expect(
      resolveRetailer(product({ url: "https://ikea.com.evil.example/p/1", retailer: "" }))
    ).toBeNull();
  });
});

describe("toBasket", () => {
  it("converts cents to minor units and [w,h,d] to the server's object", () => {
    const { basket, unsupported } = toBasket([cartItem()], 125000);

    expect(unsupported).toEqual([]);
    expect(basket.budgetMinor).toBe(125000);
    expect(basket.lines).toHaveLength(1);
    expect(basket.lines[0]).toMatchObject({
      retailer: "ikea",
      title: "A tall lamp",
      productUrl: "https://www.ikea.com/us/en/p/lamp-70437814/",
      priceMinor: 12000,
      currency: "USD",
      dimensionsMm: { w: 300, h: 1500, d: 300 },
      quantity: 1,
    });
  });

  it("keeps the line id and the placement id, so a status maps back to a sprite", () => {
    const line = cartItem();
    const { basket } = toBasket([line], 125000);
    expect(basket.lines[0].lineId).toBe(line.id);
    expect(basket.lines[0].placementId).toBe(line.itemId);
  });

  it("passes the budget through untouched — this layer reports it, never computes it", () => {
    expect(toBasket([cartItem()], 60000).basket.budgetMinor).toBe(60000);
    expect(toBasket([cartItem()], 0).basket.budgetMinor).toBe(0);
  });

  it("carries the quantity", () => {
    const { basket } = toBasket([cartItem({}, 3)], 125000);
    expect(basket.lines[0].quantity).toBe(3);
  });

  it("is null dimensions when the listing quoted none — never guessed", () => {
    const { basket } = toBasket([cartItem({ dimsMm: undefined })], 125000);
    expect(basket.lines[0].dimensionsMm).toBeNull();
  });

  it("drops a shop it cannot check out at, silently — not the person's mistake to read about", () => {
    // sourcing's own whitelist never returns a shop like this, so a real
    // basket cannot contain one. If stale or hand-edited data ever does, the
    // line disappears the same way it never appeared in a search result —
    // no message, because a shop the person never chose is not theirs to
    // explain away.
    const bad = cartItem({ url: "https://www.costco.com/p/1", retailer: "Costco" });
    const { basket, unsupported } = toBasket([cartItem(), bad], 125000);

    expect(basket.lines).toHaveLength(1);
    expect(unsupported).toHaveLength(0);
  });

  it("reports a line with no link and a line with no price", () => {
    const noUrl = cartItem({ url: "", retailer: "IKEA" });
    const noPrice = cartItem({ priceCents: 0 });
    const { basket, unsupported } = toBasket([noUrl, noPrice], 125000);

    expect(basket.lines).toHaveLength(0);
    expect(unsupported).toHaveLength(2);
    expect(unsupported.map((u) => u.reason).join(" ")).toMatch(/no link|no price/);
  });

  it("an empty basket converts to an empty basket, not a throw", () => {
    const { basket, unsupported } = toBasket([], 125000);
    expect(basket.lines).toEqual([]);
    expect(unsupported).toEqual([]);
  });

  it("every line it produces is one POST /api/checkout will accept", () => {
    const { basket } = toBasket(
      [cartItem(), cartItem({ url: "https://www.wayfair.com/p/frame", retailer: "Wayfair" }, 2)],
      125000
    );
    for (const line of basket.lines) {
      // exactly the route handler's own checks
      expect(line.productUrl).toBeTruthy();
      expect(line.lineId).toBeTruthy();
      expect(line.placementId).toBeTruthy();
      expect(Number.isInteger(line.priceMinor) && line.priceMinor > 0).toBe(true);
      expect(line.currency).toBe("USD");
      expect(Number.isInteger(line.quantity) && line.quantity > 0).toBe(true);
    }
  });
});

describe("displayRetailer", () => {
  it("prefers the listing's own spelling", () => {
    expect(displayRetailer(product({ retailer: "IKEA" }))).toBe("IKEA");
  });

  it("falls back to the resolved shop, then to plain words", () => {
    expect(displayRetailer(product({ retailer: "" }))).toBe("ikea");
    expect(displayRetailer(product({ retailer: "", url: "not-a-url" }))).toBe("the shop");
  });
});
