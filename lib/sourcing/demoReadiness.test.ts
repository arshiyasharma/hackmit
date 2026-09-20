import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  source: vi.fn(), search: vi.fn(), upsert: vi.fn(), immersive: vi.fn(),
}));
vi.mock("@/lib/elastic/search", () => ({ searchProducts: mocks.search }));
vi.mock("@/lib/elastic/index", () => ({ upsertProducts: mocks.upsert }));
vi.mock("@/lib/sourcing/serpapi", async (original) => ({
  ...await original<typeof import("@/lib/sourcing/serpapi")>(),
  fetchImmersiveProduct: mocks.immersive,
}));

import { POST as searchRoute } from "@/app/api/search/route";
import { POST as sourceRoute } from "@/app/api/source/route";
import { GET as catalogRoute } from "@/app/api/products/search/route";
import { enrichShoppingResults, priceToCents } from "./enrich";
import { fetchProductHtml } from "./scrapeDimensions";
import { fillMissingDimensions, sourceProductsForQuery } from "./sourceProducts";
import { filterProductsByDesignQuery } from "./roomContext";
import { isDirectRetailerUrl } from "./whitelist";

const request = (path: string, body: unknown) => new NextRequest(`http://localhost${path}`, {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.search.mockResolvedValue([]);
  mocks.upsert.mockResolvedValue(undefined);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe("invalid input is rejected before paid search", () => {
  it.each([null, [], {}, { request: "   " }, { request: "lamp", roomContext: { styleTags: "wrong" } },
    { request: "lamp", budgetRemainingCents: "free" }, { request: "x".repeat(501) }])("validates search payload %j", async (body) => {
    const response = await searchRoute(request("/api/search", body));
    expect(response.status).toBe(400);
    expect(mocks.search).not.toHaveBeenCalled();
  });
  it.each([null, [], { query: " " }, { query: "lamp", roomContext: { styleTags: "wrong" } },
    { query: "lamp", roomContext: { searchTerms: [17] } }])("validates source payload %j", async (body) => {
    expect((await sourceRoute(request("/api/source", body))).status).toBe(400);
    expect(mocks.search).not.toHaveBeenCalled();
  });
  it.each(["20junk", "-1", "1.5", "Infinity"])("rejects invalid catalog price %s", async (price) => {
    const response = await catalogRoute(new NextRequest(`http://localhost/api/products/search?max_price=${price}`));
    expect(response.status).toBe(400);
    expect(mocks.search).not.toHaveBeenCalled();
  });
});

describe("prices are purchase amounts", () => {
  it.each([["$1,099.00", 109900], ["USD 25.99", 2599], ["$0.00", 0],
    ["$10 - $20", null], ["-$5", null], ["€25", null], ["$12/mo", null], ["not listed", null]])("parses %s", (raw, cents) => {
    expect(priceToCents(raw as string)).toBe(cents);
  });
  it("does not attach a source seller price to a different retailer", async () => {
    mocks.immersive.mockResolvedValue({ stores: [{ name: "Wayfair", direct_link: "https://www.wayfair.com/furniture/pdp/lamp.html" }], features: [] });
    const products = await enrichShoppingResults([{ title: "Brass Floor Lamp", source: "Target", price: "$25", product_link: "https://www.google.com/shopping/product/1", immersive_product_page_token: "token" }], { apiKey: "test", designQuery: "floor lamp" });
    expect(products).toHaveLength(1);
    expect(products[0].product_url).toBe("https://www.google.com/shopping/product/1");
    expect(products[0].retailer).toBe("target");
  });
});

describe("merchant Buy-link resolution", () => {
  const googleUrl = "https://www.google.com/shopping/product/merchant-lamp";
  const title = "Warm Brass Floor Lamp";

  it.each(["Macy's", "Macy’s", "macys.com"])("resolves a %s offer to its actual product page", async (source) => {
    const directUrl = "https://www.macys.com/shop/product/brass-floor-lamp?ID=123";
    mocks.immersive.mockResolvedValue({ stores: [
      { name: source, direct_link: "https://macys.com.other-shop.com/lamp" },
      { name: source, direct_link: directUrl },
    ], features: [] });
    const products = await enrichShoppingResults([{ title, source, price: "$139.95", product_link: googleUrl, immersive_product_page_token: "token" }], { apiKey: "test", designQuery: "floor lamp" });
    expect(products).toHaveLength(1);
    expect(products[0]).toMatchObject({ product_url: directUrl, retailer: "macys.com", price_cents: 13995 });
  });

  it.each([
    ["Wayfair", "https://www.wayfair.com/lighting/pdp/brass-floor-lamp.html", "wayfair.com"],
    ["Walmart", "https://www.walmart.com/ip/brass-floor-lamp/123", "walmart.com"],
  ])("uses %s's existing merchant link without a paid lookup", async (source, directUrl, retailer) => {
    const products = await enrichShoppingResults([{ title, source, price: "$99.99", product_link: googleUrl, link: directUrl, immersive_product_page_token: "token" }], { apiKey: "test", designQuery: "floor lamp" });
    expect(products).toHaveLength(1);
    expect(products[0]).toMatchObject({ product_url: directUrl, retailer, price_cents: 9999 });
    expect(mocks.immersive).not.toHaveBeenCalled();
  });

  it.each([
    ["Wayfair", "https://www.wayfair.com/lighting/pdp/brass-floor-lamp.html"],
    ["Walmart", "https://www.walmart.com/ip/brass-floor-lamp/123"],
  ])("resolves %s when an immersive direct_link is still a Google wrapper", async (source, directUrl) => {
    mocks.immersive.mockResolvedValue({ stores: [{ name: source, direct_link: googleUrl, link: directUrl }], features: [] });
    const products = await enrichShoppingResults([{ title, source, price: "$99.99", product_link: googleUrl, immersive_product_page_token: "token" }], { apiKey: "test", designQuery: "floor lamp" });
    expect(products[0].product_url).toBe(directUrl);
  });

  it("retries Buy-link resolution when the indexed shelf only contains Google wrappers", async () => {
    mocks.search.mockResolvedValue(Array.from({ length: 6 }, (_, i) => ({
      id: `indexed-wrapper-${i}`, title: `Brass Floor Lamp catalog offer ${i}`,
      product_url: `${googleUrl}-${i}`, retailer: "macy's", image_url: "",
      price_cents: 13995, currency: "USD", in_stock: null,
      dimensions: { h_in: 60, w_in: 12, d_in: 12, estimated: false },
    })));
    const directUrl = "https://www.macys.com/shop/product/brass-floor-lamp?ID=123";
    mocks.immersive.mockResolvedValue({ stores: [{ name: "Macy's", direct_link: directUrl }], features: [] });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ shopping_results: [
      { title, source: "Macy's", price: "$139.95", product_link: googleUrl, immersive_product_page_token: "token" },
    ] }));
    const products = await sourceProductsForQuery({ shoppingQuery: "indexed-brass-lamp-retry", designQuery: "brass floor lamp", apiKey: "test", fallbacks: false });
    expect(fetchSpy).toHaveBeenCalled();
    expect(mocks.immersive).toHaveBeenCalled();
    expect(products[0]).toMatchObject({ product_url: directUrl, retailer: "macys.com" });
  });

  it("keeps a Google offer unresolved when only a different seller's URL exists", async () => {
    mocks.immersive.mockResolvedValue({ stores: [{ name: "Macy's", direct_link: "https://macys.com.other-shop.com/lamp" }], features: [] });
    const products = await enrichShoppingResults([{ title, source: "Macy’s", price: "$99.99", product_link: googleUrl, link: "https://www.walmart.com/ip/another-offer/123", immersive_product_page_token: "token" }], { apiKey: "test", designQuery: "floor lamp" });
    expect(products).toHaveLength(1);
    expect(products[0]).toMatchObject({ product_url: googleUrl, retailer: "macys.com", price_cents: 9999 });
  });
});

describe("relevance and dimensions survive the whole pipeline", () => {
  it("keeps brass floor lamps while rejecting table lamps and replacement shades", () => {
    const kept = filterProductsByDesignQuery([
      { title: "Antique Brass Floor Lamp with Fabric Shade" },
      { title: "Brass Floor Lamp with Linen Lampshade" },
      { title: "Green Floor Lamp" },
      { title: "Zebra table lamp Animal floor lampshade Modern lampshade" },
      { title: "Brass floor lamp shade replacement" },
    ], "warm brass floor lamp");
    expect(kept.map((product) => product.title)).toEqual(["Antique Brass Floor Lamp with Fabric Shade", "Brass Floor Lamp with Linen Lampshade"]);
  });
  it("does not revive unrelated results when all titles are rejected", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ shopping_results: [{ title: "Brass Floor Lamp", source: "Target", price: "$20", product_link: "https://www.target.com/p/lamp/1" }] }));
    const products = await sourceProductsForQuery({ shoppingQuery: "regression unique sofa", designQuery: "sofa", apiKey: "test", fallbacks: false });
    expect(products).toEqual([]);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
  it("scrapes the missing axes even when the title already quotes a height", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response('<p>Dimensions: 10"D x 12"W x 60"H</p>'));
    const products = await fillMissingDimensions([{ id: "partial", title: "60 inch floor lamp", product_url: "https://www.target.com/p/lamp/1", retailer: "target.com", image_url: "", currency: "USD", price_cents: 2000, in_stock: null, dimensions: { h_in: 60, w_in: null, d_in: null, estimated: false } }]);
    expect(products[0].dimensions).toEqual({ h_in: 60, w_in: 12, d_in: 10, estimated: false });
  });
});

describe("retailer fetch destinations", () => {
  it.each(["http://127.0.0.1/product", "http://2130706433/product", "http://[::1]/product", "http://api.internal/product", "https://user:password@target.com/product", "http://example.com:8080/product"])("refuses non-retailer destination %s", (url) => {
    expect(isDirectRetailerUrl(url)).toBe(false);
  });
  it("does not follow a retailer redirect to a local service", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 302, headers: { location: "http://127.0.0.1:3000/api/checkout" } }));
    expect(await fetchProductHtml("https://www.target.com/p/item/1")).toBeNull();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
