import { describe, expect, it } from "vitest";
import {
  buildContextualShoppingQuery, buildSimpleShoppingQuery, filterProductsByDesignQuery,
  resolveSearchTermsForQuery,
} from "./roomContext";

const context = { palette: ["#b32324", "#2e7d32"], picked: ["#2e7d32"], styleTags: ["traditional", "mid-century modern", "rattan"] };

describe("current room aesthetics in new shopping queries", () => {
  it("uses current picked colour and complete recent style phrases", () => {
    expect(buildSimpleShoppingQuery("a side table", context)).toBe("green mid-century modern rattan side table");
    expect(buildSimpleShoppingQuery("a side table", { ...context, palette: ["#2f6fb5"], picked: [], styleTags: ["minimalist"] })).toBe("blue minimalist side table");
  });
  it("does not restore removed colours or tags when the edited context is empty", () => {
    expect(buildSimpleShoppingQuery("a chair", { palette: [], picked: ["#b32324"], styleTags: [], searchTerms: ["red ornate chair"] })).toBe("chair");
  });
  it("keeps explicit object colours ahead of inferred and picked colours", () => {
    expect(buildSimpleShoppingQuery("a blue sofa", { ...context, styleTags: ["red velvet", "minimalist"] })).toBe("velvet minimalist blue sofa");
    expect(buildSimpleShoppingQuery("a #2f6fb5 sofa", context)).toBe("mid-century modern rattan blue sofa");
  });
  it("does not repeat a style the request already names", () => {
    expect(buildSimpleShoppingQuery("a minimalist blue sofa", { ...context, styleTags: ["minimalist"] })).toBe("minimalist blue sofa");
  });
  it("applies edits to stale model categories without reviving their old modifiers", () => {
    const edited = { palette: ["#2e7d32"], styleTags: ["minimalist"], searchTerms: ["pink ornate floor lamp", "pink velvet chair", "pink ornate floor lamp"] };
    expect(resolveSearchTermsForQuery("refresh this space", edited)).toEqual(["floor lamp", "chair"]);
    expect(buildContextualShoppingQuery("pink ornate floor lamp", edited)).toBe("green minimalist floor lamp");
    expect(buildContextualShoppingQuery("pink ornate floor lamp", edited, "a blue reading nook")).toBe("minimalist blue floor lamp");
  });
  it("lets long specific requests bypass model fanout", () => {
    expect(resolveSearchTermsForQuery("a blue floor lamp with an adjustable reading arm", { ...context, searchTerms: ["pink floor lamp", "red chair"] })).toEqual([]);
  });
  it("preserves explicit colour relevance when retailers answer with a different colour", () => {
    const products = [{ title: "Sage Floor Lamp" }, { title: "Red Floor Lamp" }];
    expect(filterProductsByDesignQuery(products, "sage floor lamp")).toEqual([products[0]]);
  });
});


describe("explicit retailer intent", () => {
  it.each(["Walmart desk", "a desk from Walmart", "desk at walmart.com", "desk at walmart com"])(
    "matches %s against seller metadata without requiring Walmart in the title", (query) => {
      const walmart = { title: "Mainstays Writing Desk", retailer: "walmart.com" };
      const products = [walmart, { title: "Writing Desk", retailer: "wayfair.com" }, { title: "Mainstays Desk Lamp", retailer: "walmart.com" }, { title: "Walmart Writing Desk" }];
      expect(filterProductsByDesignQuery(products, query)).toEqual([walmart]);
    }
  );
  it("still allows a desk lamp when the shopper specifically asks for one", () => {
    const lamp = { title: "Mainstays LED Desk Lamp", retailer: "walmart.com" };
    expect(filterProductsByDesignQuery([lamp, { title: "Writing Desk", retailer: "walmart.com" }], "Walmart desk lamp")).toEqual([lamp]);
  });
  it("keeps Walmart table lamps and still rejects a different product category", () => {
    const lamp = { title: "Mainstays Ceramic Table Lamp", retailer: "Walmart" };
    expect(filterProductsByDesignQuery([
      lamp,
      { title: "Mainstays Side Table", retailer: "walmart.com" },
      { title: "Ceramic Table Lamp", retailer: "target.com" },
    ], "Walmart table lamp")).toEqual([lamp]);
  });
  it("keeps Wayfair floor lamps without accepting other sellers or table lamps", () => {
    const floor = { title: "Adjustable Floor Lamp", retailer: "www.wayfair.com" };
    expect(filterProductsByDesignQuery([
      floor,
      { title: "Adjustable Floor Lamp", retailer: "walmart.com" },
      { title: "Wayfair Table Lamp", retailer: "wayfair.com" },
    ], "Wayfair floor lamp")).toEqual([floor]);
  });
  it.each(["West Elm chair", "chair from westelm.com"])("recognizes the multiword shop in %s", (query) => {
    const chair = { title: "Mid-Century Lounge Chair", retailer: "West Elm" };
    const domain = { ...chair, retailer: "westelm.com" };
    expect(filterProductsByDesignQuery([chair, domain, { ...chair, retailer: "wayfair.com" }], query)).toEqual([chair, domain]);
  });
  it.each(["Macy's vase", "Macy’s vase", "macys.com vase"])("normalizes the retailer spelling in %s", (query) => {
    const vase = { title: "Ceramic Vase", retailer: "macys.com" };
    expect(filterProductsByDesignQuery([vase, { ...vase, retailer: "Macy’s" }, { ...vase, retailer: "etsy.com" }], query)).toEqual([vase, { ...vase, retailer: "Macy’s" }]);
  });
  it("preserves explicit colour and material constraints after removing the shop name", () => {
    const requested = { title: "Blue Velvet Chair", retailer: "walmart.com" };
    expect(filterProductsByDesignQuery([
      requested,
      { title: "Red Velvet Chair", retailer: "walmart.com" },
      { title: "Blue Leather Chair", retailer: "walmart.com" },
      { ...requested, retailer: "wayfair.com" },
    ], "blue velvet chair from Walmart")).toEqual([requested]);
  });
  it("does not mistake lookalike seller domains or a shop name in the title for metadata", () => {
    const title = "Walmart Floor Lamp";
    expect(filterProductsByDesignQuery([
      { title, retailer: "walmart.com.other-shop.com" },
      { title, retailer: "notwalmart.com" },
      { title },
    ], "Walmart floor lamp")).toEqual([]);
  });
  it("retains the requested sellers when no product phrase remains", () => {
    const walmart = { title: "Writing Desk", retailer: "walmart.com" };
    expect(filterProductsByDesignQuery([walmart, { ...walmart, retailer: "wayfair.com" }], "Walmart")).toEqual([walmart]);
  });
  it("leaves ordinary product requests independent of seller metadata", () => {
    const products = [{ title: "Floor Lamp" }, { title: "Floor Lamp", retailer: "other-shop.com" }];
    expect(filterProductsByDesignQuery(products, "floor lamp")).toEqual(products);
  });
});
