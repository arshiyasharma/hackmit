import { describe, expect, it } from "vitest";
import { buildAsks } from "./AskInput";

describe("room suggestions after aesthetic edits", () => {
  it("suggests objects without restoring stale model colours or styles", () => {
    const asks = buildAsks({ palette: ["#2f6fb5"], styleTags: ["minimalist"], lighting: "warm", suggestions: ["pink ornate floor lamp", "red velvet chair", "green side table"] });
    expect(asks).toEqual(["floor lamp", "chair", "side table"]);
    expect(asks.join(" ")).not.toMatch(/pink|red|green|ornate|velvet/);
  });
  it("keeps usable safe defaults if no model object can be recognized", () => {
    expect(buildAsks({ palette: [], styleTags: [], lighting: "warm", suggestions: ["pink and ornate"] })).toEqual(["a tall lamp", "a floor rug", "a framed picture"]);
  });
});
