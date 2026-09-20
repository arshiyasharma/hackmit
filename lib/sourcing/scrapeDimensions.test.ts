import { afterEach, describe, expect, it, vi } from "vitest";

import {
  dimensionsFromHtml,
  dimensionsFromJsonLd,
  dimensionsFromLabeledHtml,
  fetchProductHtml,
  parseFractionalInches,
} from "@/lib/sourcing/scrapeDimensions";

/**
 * The bug these pin: almost every listing came back with no size at all, even
 * though the size was printed on the page a shopper was looking at. Lowe's
 * answered a bare fetch with HTTP 403, and the pages we did get back state
 * their measurements in a dozen shapes the reader did not know — axis letters
 * glued to the number, centimetres, a package row standing in for the item,
 * a size split across two elements.
 *
 * Every fixture below is hand written HTML. Nothing here touches the network,
 * which is deliberate: the shops we scrape are rate limited and a test suite
 * is not a good reason to spend that budget.
 */

afterEach(() => {
  vi.restoreAllMocks();
});

describe("parseFractionalInches", () => {
  it("reads the units and fraction marks a shop actually types", () => {
    expect(parseFractionalInches("81 in")).toBe(81);
    expect(parseFractionalInches("81''")).toBe(81);
    expect(parseFractionalInches("30 ¾\"")).toBe(30.75);
    expect(parseFractionalInches('67 3/8 "')).toBe(67.38);
    expect(parseFractionalInches("200 cm")).toBe(78.74);
    expect(parseFractionalInches("914 mm")).toBe(35.98);
    expect(parseFractionalInches("5' 3\"")).toBe(63);
    expect(parseFractionalInches("6 ft")).toBe(72);
  });

  it("returns null rather than a plausible number when there is none", () => {
    expect(parseFractionalInches("One size fits all")).toBeNull();
    expect(parseFractionalInches("")).toBeNull();
  });
});

describe("dimensionsFromLabeledHtml", () => {
  it("reads a spec table that names each axis in its own row", () => {
    const html = `
      <table class="specs">
        <tr><th>Overall Height - Top to Bottom</th><td>34.5''</td></tr>
        <tr><th>Overall Width - Side to Side</th><td>81''</td></tr>
        <tr><th>Overall Depth - Front to Back</th><td>35''</td></tr>
      </table>`;

    expect(dimensionsFromLabeledHtml(html)).toEqual({
      h_in: 34.5,
      w_in: 81,
      d_in: 35,
      estimated: false,
    });
  });

  it("reads axis letters glued to the numbers, in whatever order", () => {
    const html = `<p>Dimensions: 12"D x 24"W x 30"H</p>`;

    expect(dimensionsFromLabeledHtml(html)).toEqual({
      h_in: 30,
      w_in: 24,
      d_in: 12,
      estimated: false,
    });
  });

  it("converts a bare centimetre triple", () => {
    const html = `<div class="details">Dimensions: 61 x 91 x 76 cm</div>`;

    expect(dimensionsFromLabeledHtml(html)).toEqual({
      h_in: 24.02,
      w_in: 35.83,
      d_in: 29.92,
      estimated: false,
    });
  });

  it("reads a two-number form as width then height", () => {
    const html = `<p>Size: 24" x 36"</p>`;

    expect(dimensionsFromLabeledHtml(html)).toEqual({
      h_in: 36,
      w_in: 24,
      d_in: null,
      estimated: false,
    });
  });

  it("joins a label and a value that sit in separate elements", () => {
    const html = `<li><b>Product Dimensions</b>: <span>24 x 36 x 30 inches</span></li>`;

    expect(dimensionsFromLabeledHtml(html)).toEqual({
      h_in: 24,
      w_in: 36,
      d_in: 30,
      estimated: false,
    });
  });

  it("takes millimetres, feet-and-inches and a vulgar fraction", () => {
    const html = `
      <dl>
        <dt>Overall Height</dt><dd>5' 3"</dd>
        <dt>Overall Width</dt><dd>81 ¾"</dd>
        <dt>Overall Depth</dt><dd>914 mm</dd>
      </dl>`;

    expect(dimensionsFromLabeledHtml(html)).toEqual({
      h_in: 63,
      w_in: 81.75,
      d_in: 35.98,
      estimated: false,
    });
  });

  it("reads meta tags and data attributes, but not pixel counts", () => {
    const html = `
      <meta itemprop="width" content="81 in">
      <meta property="og:image:width" content="1200">
      <meta name="twitter:image:height" content="628">
      <div data-product-depth="35 in" data-height-inches="34.5"></div>`;

    expect(dimensionsFromLabeledHtml(html)).toEqual({
      h_in: 34.5,
      w_in: 81,
      d_in: 35,
      estimated: false,
    });
  });

  it("drops an absurd measurement instead of reporting it", () => {
    const html = `
      <dl>
        <dt>Overall Height</dt><dd>900 in</dd>
        <dt>Overall Width</dt><dd>81 in</dd>
      </dl>`;

    expect(dimensionsFromLabeledHtml(html)).toEqual({
      h_in: null,
      w_in: 81,
      d_in: null,
      estimated: false,
    });
  });

  it("drops only the absurd axis of an otherwise readable blob", () => {
    const html = `<p>Dimensions: 81 x 35 x 9000 inches</p>`;

    expect(dimensionsFromLabeledHtml(html)).toEqual({
      h_in: 81,
      w_in: 35,
      d_in: null,
      estimated: false,
    });
  });
});

describe("dimensionsFromJsonLd", () => {
  it("honours the unit a QuantitativeValue declares", () => {
    const html = `
      <script type="application/ld+json">
      {
        "@context": "https://schema.org",
        "@type": "Product",
        "name": "Linen Sofa",
        "width": { "@type": "QuantitativeValue", "value": 200, "unitCode": "CMT" },
        "height": { "@type": "QuantitativeValue", "value": 85, "unitCode": "CMT" },
        "depth": { "@type": "QuantitativeValue", "value": 90, "unitCode": "CMT" }
      }
      </script>`;

    expect(dimensionsFromJsonLd(html)).toEqual({
      h_in: 33.46,
      w_in: 78.74,
      d_in: 35.43,
      estimated: false,
    });
  });
});

describe("dimensionsFromHtml, per retailer", () => {
  it("reads Amazon's product details table and its stated axis order", () => {
    const html = `
      <table id="productDetails_techSpec_section_1">
        <tr>
          <th class="prodDetSectionEntry">Item Dimensions  LxWxH</th>
          <td class="prodDetAttrValue">81 x 35 x 34.5 inches</td>
        </tr>
      </table>`;

    expect(dimensionsFromHtml(html, "amazon.com")).toEqual({
      h_in: 34.5,
      w_in: 81,
      d_in: 35,
      estimated: false,
    });
  });

  it("reads Amazon's detail bullets", () => {
    const html = `
      <ul>
        <li><span class="a-list-item">
          <span class="a-text-bold">Product Dimensions&nbsp;:&nbsp;</span>
          <span>24.8 x 31.5 x 40.6 inches</span>
        </span></li>
      </ul>`;

    expect(dimensionsFromHtml(html, "amazon.com")).toEqual({
      h_in: 40.6,
      w_in: 24.8,
      d_in: 31.5,
      estimated: false,
    });
  });

  it("refuses to report a package as the item", () => {
    const html = `
      <table id="productDetails_detailBullets_sections1">
        <tr><th>Package Dimensions</th><td>26 x 20 x 10 inches</td></tr>
      </table>
      <ul>
        <li><span class="a-text-bold">Package Dimensions&nbsp;:&nbsp;</span>
        <span>26 x 20 x 10 inches</span></li>
      </ul>`;

    expect(dimensionsFromHtml(html, "amazon.com")).toEqual({
      h_in: null,
      w_in: null,
      d_in: null,
      estimated: true,
    });
  });

  it("prefers the item row over the package row on the same page", () => {
    const html = `
      <table id="productDetails_detailBullets_sections1">
        <tr><th>Package Dimensions</th><td>26 x 20 x 10 inches</td></tr>
        <tr><th>Item Dimensions  LxWxH</th><td>81 x 35 x 34.5 inches</td></tr>
      </table>`;

    expect(dimensionsFromHtml(html, "amazon.com")).toEqual({
      h_in: 34.5,
      w_in: 81,
      d_in: 35,
      estimated: false,
    });
  });

  it("reads Walmart's __NEXT_DATA__ payload", () => {
    const payload = {
      props: {
        pageProps: {
          initialData: {
            data: {
              product: {
                specifications: [
                  { name: "Brand", value: "Mainstays" },
                  {
                    name: "Assembled Product Dimensions (L x W x H)",
                    value: "81.00 x 35.00 x 34.50 Inches",
                  },
                ],
              },
            },
          },
        },
      },
    };
    const html = `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify(
      payload
    )}</script>`;

    expect(dimensionsFromHtml(html, "walmart.com")).toEqual({
      h_in: 34.5,
      w_in: 81,
      d_in: 35,
      estimated: false,
    });
  });

  it("reads Wayfair's single Overall spec row", () => {
    const html = `
      <table class="Specifications">
        <tr><th>Overall</th><td>34.5'' H x 81'' W x 35'' D</td></tr>
      </table>`;

    expect(dimensionsFromHtml(html, "wayfair.com")).toEqual({
      h_in: 34.5,
      w_in: 81,
      d_in: 35,
      estimated: false,
    });
  });

  it("reads an Etsy measurement written into the description", () => {
    const html = `
      <div id="wt-content-toggle-product-details-read-more">
        <p>Handmade white oak shelf, finished with hardwax oil.</p>
        <p>Measurements: 24&quot; x 36&quot;</p>
      </div>`;

    expect(dimensionsFromHtml(html, "etsy.com")).toEqual({
      h_in: 36,
      w_in: 24,
      d_in: null,
      estimated: false,
    });
  });

  it("says it does not know when the page never states a size", () => {
    const html = `<html><body><h1>Brass Floor Lamp</h1><p>Free shipping.</p></body></html>`;

    expect(dimensionsFromHtml(html, "etsy.com")).toEqual({
      h_in: null,
      w_in: null,
      d_in: null,
      estimated: true,
    });
  });
});

describe("fetchProductHtml", () => {
  it("sends browser headers and checks redirects explicitly", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("<html>ok</html>", { status: 200 }));

    await expect(fetchProductHtml("https://example.com/pd/1")).resolves.toBe(
      "<html>ok</html>"
    );

    const init = fetchSpy.mock.calls[0]?.[1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers["User-Agent"]).toMatch(/Mozilla\/5\.0 .*Chrome\/\d+/);
    expect(headers["Accept-Language"]).toBe("en-US,en;q=0.9");
    expect(headers.Accept).toContain("text/html");
    expect(init.redirect).toBe("manual");
  });

  it("gives up quietly on a 403, logging one line", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("", { status: 403 })
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const url = "https://www.lowes.com/pd/thing/1000123";
    await expect(fetchProductHtml(url)).resolves.toBeNull();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      `[scrape] HTTP 403 fetching dimensions from ${url}`
    );
  });

  it("gives up quietly on a 429 too", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("", { status: 429 })
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(
      fetchProductHtml("https://www.wayfair.com/p/1")
    ).resolves.toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
