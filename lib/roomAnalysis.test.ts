import { describe, expect, it } from "vitest";
import { readRoomContext } from "./roomAnalysis";

const payload = { palette: ["#aabbcc"], styleTags: ["Modern"], lighting: "warm" };
describe("room analysis provenance", () => {
  it("preserves successful model results", () => {
    expect(readRoomContext({ ...payload, source: "model" })).toMatchObject({ source: "model", styleTags: ["modern"] });
  });
  it("preserves HTTP-200 fallback responses without claiming extraction", () => {
    expect(readRoomContext({ ...payload, source: "fallback" })?.source).toBe("fallback");
  });
  it("does not assume a model extracted data when its source is absent", () => {
    expect(readRoomContext(payload)?.source).toBe("fallback");
  });
  it("rejects missing or invalid palettes", () => {
    expect(readRoomContext(null)).toBeNull();
    expect(readRoomContext({ ...payload, palette: ["not a color"] })).toBeNull();
  });
});
