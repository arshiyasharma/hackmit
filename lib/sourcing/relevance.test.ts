import { describe, expect, it } from "vitest";

import { filterProductsByDesignQuery } from "@/lib/sourcing/roomContext";
import {
  isDirectRetailerUrl,
  resolveRetailer,
  retailerDomainFor,
  sameRetailer,
} from "@/lib/sourcing/whitelist";

/**
 * The bug these pin: asking for "a plushie" reported an empty shop while
 * Google was returning a page full of them. Two gates did it — a five-shop
 * allowlist, and a relevance filter that demanded the word "plushie" inside a
 * title that says "Plush".
 */

const titled = (...titles: string[]) => titles.map((title) => ({ title }));

describe("filterProductsByDesignQuery", () => {
  it("keeps plush listings when the request is a plushie", () => {
    const kept = filterProductsByDesignQuery(
      titled(
        'Squishmallows 16" Avocado Plush',
        "Jellycat Bashful Bunny Plush Toy",
        "Solid Oak Dining Table"
      ),
      "a plushie"
    );

    expect(kept.map((p) => p.title)).toEqual([
      'Squishmallows 16" Avocado Plush',
      "Jellycat Bashful Bunny Plush Toy",
    ]);
  });

  it("still requires the thing that was asked for", () => {
    const kept = filterProductsByDesignQuery(
      titled("Brass Floor Lamp", "Velvet Sofa"),
      "a floor lamp"
    );

    expect(kept.map((p) => p.title)).toEqual(["Brass Floor Lamp"]);
  });

  it("matches a plural request against a singular title", () => {
    const kept = filterProductsByDesignQuery(
      titled("Ceramic Vase, White", "Wool Rug"),
      "vases"
    );

    expect(kept).toHaveLength(1);
  });

  it("keeps a table query away from table lamps", () => {
    const kept = filterProductsByDesignQuery(
      titled("Oak Side Table", "Brass Table Lamp"),
      "a side table"
    );

    expect(kept.map((p) => p.title)).toEqual(["Oak Side Table"]);
  });
});

describe("retailer eligibility", () => {
  it("lets a shop outside the preferred five through", () => {
    const url = "https://www.target.com/p/squishmallows-plush/-/A-12345678";
    expect(isDirectRetailerUrl(url)).toBe(true);
    expect(resolveRetailer(url, "Target")).toBe("target.com");
  });

  it("still refuses the Google wrapper and hosts that sell nothing", () => {
    expect(isDirectRetailerUrl("https://www.google.com/shopping/product/1")).toBe(
      false
    );
    expect(isDirectRetailerUrl("https://www.pinterest.com/pin/12345")).toBe(false);
    expect(retailerDomainFor("www.youtube.com")).toBeNull();
  });

  it("keeps the preferred five under their canonical domain", () => {
    expect(retailerDomainFor("www.ikea.com")).toBe("ikea.com");
    expect(retailerDomainFor("smile.amazon.com")).toBe("amazon.com");
  });

  it("reads a label and a domain as the same shop", () => {
    expect(sameRetailer("target.com", "target")).toBe(true);
    expect(sameRetailer("target.com", "walmart.com")).toBe(false);
  });
});
