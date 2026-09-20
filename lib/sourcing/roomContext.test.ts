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
