import { describe, expect, it } from "vitest";

import { filterProductsByDesignQuery } from "@/lib/sourcing/roomContext";
import { titleFamily } from "@/lib/sourcing/sourceProducts";
import { applyMaxPrice } from "@/lib/sourcing/enrich";
import { typicalDimsMm } from "@/lib/sourcing/typical";
import {
  isDirectRetailerUrl,
  resolveRetailer,
  retailerDomainFor,
  retailerFromSourceLabel,
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

describe("shelf hygiene", () => {
  it("reads four sizes of one cushion as one product", () => {
    const sizes = [
      "Hemp Custom made Window Mudroom Floor bench cushion 16x16",
      "Hemp Custom made Window Mudroom Floor bench cushion 20x20",
    ].map(titleFamily);

    expect(sizes[0]).toBe(sizes[1]);
  });

  it("keeps two different pillows apart", () => {
    expect(titleFamily("Safavieh Payton Floor Pillow")).not.toBe(
      titleFamily("Greendale Home Fashions Square Floor Pillow")
    );
  });

  it("calls the shop eBay, not the seller's handle", () => {
    expect(retailerFromSourceLabel("eBay - wealthvis_0")).toBe("ebay");
    expect(retailerFromSourceLabel("Target")).toBe("target");
  });
});

describe("the budget", () => {
  const shelf = [
    { title: "Cheap Pillow", price_cents: 1999 },
    { title: "Mid Table", price_cents: 24900 },
    { title: "Grand Table", price_cents: 252900 },
  ] as Parameters<typeof applyMaxPrice>[0];

  it("never empties the shelf, however little is left", () => {
    // $1 left: every coffee table on earth is over budget
    const ranked = applyMaxPrice(shelf, 1);
    expect(ranked).toHaveLength(3);
  });

  it("puts what fits the budget first", () => {
    const ranked = applyMaxPrice(shelf, 500);
    expect(ranked.map((p) => p.title)).toEqual([
      "Cheap Pillow",
      "Mid Table",
      "Grand Table",
    ]);
  });

  it("leaves the order alone when everything fits", () => {
    expect(applyMaxPrice(shelf, 10_000)).toEqual(shelf);
  });
});

describe("a size for things that quote none", () => {
  it("knows roughly how big a bowl is", () => {
    expect(typicalDimsMm("Handmade Stoneware Bowl")).toEqual([150, 80, 150]);
  });

  it("reads the request when the title says nothing useful", () => {
    expect(typicalDimsMm("Ida & Totem Set, Handmade", "a plushie")).toEqual([
      300, 400, 250,
    ]);
  });

  it("prefers the specific match to the general one", () => {
    expect(typicalDimsMm("Brass Floor Lamp")).toEqual([350, 1500, 350]);
    expect(typicalDimsMm("Oak Coffee Table")).toEqual([1200, 450, 600]);
    expect(typicalDimsMm("Velvet Floor Pillow")).toEqual([650, 200, 650]);
  });

  it("says nothing when it does not know", () => {
    expect(typicalDimsMm("Assorted Curiosity")).toBeNull();
    expect(typicalDimsMm("")).toBeNull();
  });
});
