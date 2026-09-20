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
    expect(resolveRetailer(product({ url: "https://www.target.com/p/rug/-/A-1" }))).toBe(
      "target"
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
      resolveRetailer(product({ url: "not-a-url", retailerDomain: "cb2.com", retailer: "" }))
    ).toBe("cb2");
    expect(resolveRetailer(product({ url: "not-a-url", retailer: "West Elm" }))).toBe(
      "westelm"
    );
    expect(resolveRetailer(product({ url: "not-a-url", retailer: "west-elm" }))).toBe(
      "westelm"
    );
  });

  it("is null for a shop we cannot check out at", () => {
    expect(resolveRetailer(product({ url: "https://www.costco.com/p/1", retailer: "Costco" }))).toBeNull();
  });

  it("keeps an unsupported URL unsupported even with a known name and domain", () => {
    expect(resolveRetailer(product({
      url: "https://www.costco.com/p/toy/1",
      retailer: "IKEA",
      retailerDomain: "ikea.com",
    }))).toBeNull();
    expect(resolveRetailer(product({
      url: "https://ikea.com.evil.example/p/1",
      retailer: "IKEA",
      retailerDomain: "ikea.com",
    }))).toBeNull();
  });

  it.each(["ftp://www.ikea.com/p/1", "javascript:alert(1)"])(
    "refuses a non-web product URL: %s",
    (url) => {
      expect(resolveRetailer(product({ url, retailerDomain: "ikea.com" }))).toBeNull();
    }
  );

  it("accepts supported domain labels from sourcing", () => {
    expect(resolveRetailer(product({ retailer: "etsy.com", url: "https://www.etsy.com/listing/1" }))).toBe("etsy");
    expect(resolveRetailer(product({ retailer: "walmart.com", url: "https://www.walmart.com/ip/toy/1" }))).toBe("walmart");
  });

  it("is not fooled by a lookalike domain", () => {
    expect(
      resolveRetailer(product({ url: "https://ikea.com.evil.example/p/1", retailer: "" }))
    ).toBeNull();
  });
});

describe("toBasket", () => {
  it.each([
    ["Wayfair", "https://www.wayfair.com/furniture/pdp/lamp-1", "wayfair"],
    ["walmart.com", "https://www.walmart.com/ip/lamp/1", "walmart"],
    ["Macy’s", "https://www.macys.com/shop/product/lamp?ID=1", "macys"],
  ])("includes %s when the listing has a direct merchant link", (retailer, url, expected) => {
    const result = toBasket([cartItem({ retailer, url })], 125000);
    expect(result.unsupported).toEqual([]);
    expect(result.basket.lines[0]).toMatchObject({ retailer: expected, productUrl: url });
  });

  it.each(["Wayfair", "Walmart", "Macy's"])("explains an unresolved Google link for %s without blaming the store", (retailer) => {
    const result = toBasket([cartItem({ retailer, url: "https://www.google.com/search?ibp=oshop&q=lamp" })], 125000);
    expect(result.basket.lines).toEqual([]);
    expect(result.unsupported[0].reason).toContain("Direct store link needed");
    expect(result.unsupported[0].reason).not.toContain("not supported");
  });

  it("explains Google redirect wrappers even when they contain a merchant destination", () => {
    const result = toBasket([cartItem({ retailer: "Walmart", url: "https://www.google.com/url?q=https%3A%2F%2Fwww.walmart.com%2Fip%2Flamp%2F1" })], 125000);
    expect(result.basket.lines).toEqual([]);
    expect(result.unsupported[0].reason).toContain("Direct store link needed");
  });

  it.each(["http://www.wayfair.com/p/1", "https://user:pass@www.walmart.com/ip/1", "https://www.macys.com:8443/shop/1", "not-a-url"])("excludes invalid checkout links before offering the buy button: %s", (url) => {
    const result = toBasket([cartItem({ retailer: "Wayfair", url })], 125000);
    expect(result.basket.lines).toEqual([]);
    expect(result.unsupported[0].reason).toMatch(/store link/);
  });

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

  it("reports a shop it cannot check out at rather than dropping it silently", () => {
    const bad = cartItem({ url: "https://www.costco.com/p/1", retailer: "Costco" });
    const { basket, unsupported } = toBasket([cartItem(), bad], 125000);

    expect(basket.lines).toHaveLength(1);
    expect(unsupported).toHaveLength(1);
    expect(unsupported[0].line).toBe(bad);
    expect(unsupported[0].reason).toContain("Costco");
  });

  it("reports a line with no link and a line with no price", () => {
    const noUrl = cartItem({ url: "", retailer: "IKEA" });
    const noPrice = cartItem({ priceCents: 0 });
    const { basket, unsupported } = toBasket([noUrl, noPrice], 125000);

    expect(basket.lines).toHaveLength(0);
    expect(unsupported).toHaveLength(2);
    expect(unsupported.map((u) => u.reason).join(" ")).toMatch(/no link|no price/);
  });

  it("excludes non-USD prices rather than relabeling their amount as dollars", () => {
    const euro = cartItem({ id: "euro-lamp", currency: "EUR", priceCents: 16450 });
    const usd = cartItem({ currency: " usd ", priceCents: 12050 });
    const { basket, unsupported } = toBasket([euro, usd], 125000);

    expect(basket.lines).toHaveLength(1);
    expect(basket.lines[0]).toMatchObject({
      lineId: usd.id,
      priceMinor: 12050,
      currency: "USD",
    });
    expect(unsupported).toEqual([{
      line: euro,
      reason: "A tall lamp is priced in EUR. Checkout currently supports USD only.",
    }]);
    expect(euro.product.currency).toBe("EUR");
    expect(euro.product.priceCents).toBe(16450);
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
