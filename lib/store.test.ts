import { beforeEach, describe, expect, it } from "vitest";

import { roomContextFor, searchQuery, useStore } from "@/lib/store";
import type { RoomContext } from "@/types";

/**
 * THE EDITS MUST OUTLIVE THE READ.
 *
 * /api/analyze answers seconds after the room screen appears, and the user is
 * already editing the strip while it is in flight. Before this, the answer
 * replaced the whole context: a word typed at second three vanished at second
 * six, and a word deleted at second three came back. Both looked like the
 * strip was decorative, and the next search proved it — it went out with the
 * model's words rather than the user's.
 */

const MODEL_ANSWER: RoomContext = {
  styleTags: ["traditional", "ornate", "warm wood"],
  palette: ["#8c5a3b", "#c9a227", "#e8dcc6"],
  lighting: "warm",
  source: "model",
};

const reset = () =>
  useStore.setState({
    roomContext: null,
    edits: {
      addedTags: [],
      removedTags: [],
      addedColors: [],
      removedColors: [],
    },
  });

describe("room context edits", () => {
  beforeEach(reset);

  it("keeps a word added before the read lands", () => {
    useStore.getState().addStyleTag("brass");
    useStore.getState().setRoomContext(MODEL_ANSWER);

    expect(roomContextFor(useStore.getState())?.styleTags).toContain("brass");
  });

  it("keeps a deleted word deleted when the model names it again", () => {
    useStore.getState().setRoomContext(MODEL_ANSWER);
    useStore.getState().removeStyleTag("ornate");
    // a second read of the same room, naming "ornate" once more
    useStore.getState().setRoomContext({ ...MODEL_ANSWER });

    expect(roomContextFor(useStore.getState())?.styleTags).not.toContain("ornate");
  });

  it("keeps a picked colour, and marks it as intent rather than room colour", () => {
    useStore.getState().setRoomContext(MODEL_ANSWER);
    useStore.getState().addPaletteColor("#7B8B6F");

    const context = roomContextFor(useStore.getState());
    expect(context?.palette).toContain("#7b8b6f");
    expect(context?.picked).toEqual(["#7b8b6f"]);
  });

  it("drops a removed colour from the palette and from intent", () => {
    useStore.getState().setRoomContext(MODEL_ANSWER);
    useStore.getState().addPaletteColor("#7b8b6f");
    useStore.getState().removePaletteColor("#7b8b6f");
    useStore.getState().removePaletteColor("#c9a227");

    const context = roomContextFor(useStore.getState());
    expect(context?.palette).not.toContain("#7b8b6f");
    expect(context?.palette).not.toContain("#c9a227");
    expect(context?.picked ?? []).toHaveLength(0);
  });

  it("puts every edit into the query the search actually runs", () => {
    useStore.getState().setRoomContext(MODEL_ANSWER);
    useStore.getState().removeStyleTag("ornate");
    useStore.getState().addStyleTag("brass");
    useStore.getState().addPaletteColor("#7b8b6f"); // sage

    const query = searchQuery(roomContextFor(useStore.getState()), "a tall lamp");

    expect(query).toBe("sage warm wood brass tall lamp");
    expect(query).not.toContain("ornate");
  });

  it("still steers the search when the read never arrives", () => {
    useStore.getState().addStyleTag("rattan");
    useStore.getState().addPaletteColor("#2e7d32"); // green

    const query = searchQuery(roomContextFor(useStore.getState()), "a side table");
    expect(query).toBe("green rattan side table");
  });

  it("forgets the edits when a new room is photographed", () => {
    useStore.getState().setRoomContext(MODEL_ANSWER);
    useStore.getState().addStyleTag("brass");
    useStore.getState().setRoomImage(null);

    expect(roomContextFor(useStore.getState())).toBeNull();
  });
});
