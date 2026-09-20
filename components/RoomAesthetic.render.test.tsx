import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import RoomAesthetic from "./RoomAesthetic";

const fixture = vi.hoisted(() => ({
  context: null as null | { source: string; palette: string[]; styleTags: string[]; picked?: string[] },
  state: { roomImage: null as null | object, edits: { addedTags: [] as string[], removedTags: [] as string[], addedColors: [] as string[], removedColors: [] as string[] } },
}));
vi.mock("@/lib/store", () => ({
  useRoomContext: () => fixture.context,
  useStore: (select: (state: typeof fixture.state) => unknown) => select(fixture.state),
}));
beforeEach(() => {
  fixture.context = null;
  fixture.state.roomImage = null;
  fixture.state.edits = { addedTags: [], removedTags: [], addedColors: [], removedColors: [] };
});
const render = () => renderToStaticMarkup(<RoomAesthetic onEdit={() => {}} />);

describe("visible room aesthetic", () => {
  it("does not imply analysis is running before a photo exists", () => {
    const html = render();
    expect(html).toContain("Upload your room");
    expect(html).toContain('aria-busy="false"');
  });
  it("shows real pending analysis instead of a hidden style option", () => {
    fixture.state.roomImage = {};
    const html = render();
    expect(html).toContain("Your aesthetic");
    expect(html).toContain("Finding the colours and style in your photo");
    expect(html).toContain('aria-busy="true"');
    expect(html).not.toContain("Extracted from");
  });
  it("shows the current extracted palette and keywords with an edit action", () => {
    fixture.context = { source: "model", palette: ["#aabbcc"], styleTags: ["modern", "warm wood"] };
    const html = render();
    expect(html).toContain("Extracted from your photo");
    expect(html).toContain("#aabbcc");
    expect(html).toContain("modern · warm wood");
    expect(html).toContain('aria-label="Edit your aesthetic"');
  });
  it("shows that changes will be used in the next searches", () => {
    fixture.context = { source: "model", palette: ["#aabbcc"], styleTags: ["rattan"] };
    fixture.state.edits.addedTags = ["rattan"];
    expect(render()).toContain("Your edits are saved for this room");
  });
  it("keeps new preferences visible when the extracted palette already fills the summary", () => {
    fixture.context = { source: "model", palette: ["#111111", "#222222", "#333333", "#444444", "#555555", "#0000ff"], picked: ["#0000ff"], styleTags: ["old one", "old two", "old three", "rattan"] };
    const html = render();
    expect(html).toContain('aria-label="Colour #0000ff"');
    expect(html).toContain("old two · old three · rattan</p>");
  });
  it("does not misrepresent fallback colors as extracted from the photo", () => {
    fixture.context = { source: "fallback", palette: ["#eeeeee"], styleTags: [] };
    const html = render();
    expect(html).toContain("We couldn’t read the photo");
    expect(html).not.toContain("Extracted from your photo");
  });
});
