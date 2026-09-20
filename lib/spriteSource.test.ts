import { beforeEach, describe, expect, it } from "vitest";

import {
  canChooseSpriteSource,
  itemById,
  spriteSourceFor,
  spriteUrlFor,
  useStore,
} from "@/lib/store";
import type { PlacedItem, Product } from "@/types";

/**
 * WHICH PICTURE STANDS IN THE ROOM, AND WHO DECIDED.
 *
 * /api/cutout stopped refusing photos it could not key and started handing them
 * back untouched instead, because a refusal left a drawing standing where the
 * user had just chosen a real product. The cost is that an un-keyed photo is a
 * whole rectangular picture — background, corners and all — planted in the
 * middle of somebody's living room, which is precisely the complaint this was
 * written against.
 *
 * So the room guesses from whether the key worked, and the user overrules the
 * guess. These pin both halves of that: the guess has to go the right way for
 * each of the three shapes an item can be in, and the overrule has to outlive a
 * relink, including the seconds in the middle of one where the old photo has
 * been dropped and the new one has not arrived.
 */

const DRAWING = "/placeholder/drawing.png";
const PHOTO = "/placeholder/photo.png";
const OTHER_PHOTO = "/placeholder/other-photo.png";

const LAMP: Product = {
  id: "p-1",
  retailer: "IKEA",
  title: "A tall lamp",
  url: "https://example.invalid/lamp",
  priceCents: 12900,
  currency: "USD",
  dimsMm: [300, 1500, 300],
  dimsSource: "quoted",
  inStock: true,
};

const OTHER_LAMP: Product = { ...LAMP, id: "p-2", title: "Another tall lamp" };

/** The item as the store holds it now, never a copy taken earlier. */
function current(id: string): PlacedItem {
  const item = itemById(useStore.getState().items, id);
  if (!item) throw new Error(`no item ${id}`);
  return item;
}

/** An item with its drawing already standing in the room, as one always is. */
function itemWithDrawing(): string {
  const id = useStore.getState().addItem({
    request: "a tall lamp",
    category: "floor lamp",
  });
  useStore.getState().setPlaceholder(id, { url: DRAWING, widthRatio: 0.4 });
  return id;
}

beforeEach(() => {
  useStore.setState({ items: [], activeItemId: null });
});

describe("which picture a sprite wears", () => {
  it("wears the listing photo when the background came off it", () => {
    const id = itemWithDrawing();
    useStore.getState().linkProduct(id, LAMP);
    useStore
      .getState()
      .setListingCutout(id, { url: PHOTO, widthRatio: 0.3, keyed: true });

    expect(spriteSourceFor(current(id))).toBe("photo");
    expect(spriteUrlFor(current(id))).toBe(PHOTO);
  });

  it("wears the drawing when the photo would not key", () => {
    const id = itemWithDrawing();
    useStore.getState().linkProduct(id, LAMP);
    useStore
      .getState()
      .setListingCutout(id, { url: PHOTO, widthRatio: 0.3, keyed: false });

    // the photo is there and one tap away; it is simply not what is showing
    expect(spriteSourceFor(current(id))).toBe("drawing");
    expect(spriteUrlFor(current(id))).toBe(DRAWING);
    expect(canChooseSpriteSource(current(id))).toBe(true);
  });

  it("wears the drawing, and offers no choice, when there is no photo", () => {
    const id = itemWithDrawing();

    expect(spriteSourceFor(current(id))).toBe("drawing");
    expect(spriteUrlFor(current(id))).toBe(DRAWING);
    expect(canChooseSpriteSource(current(id))).toBe(false);
  });

  it("wears the photo when the drawing never arrived, keyed or not", () => {
    const id = useStore.getState().addItem({
      request: "a tall lamp",
      category: "floor lamp",
    });
    useStore.getState().setPlaceholder(id, null); // the generator gave up
    useStore.getState().linkProduct(id, LAMP);
    useStore
      .getState()
      .setListingCutout(id, { url: PHOTO, widthRatio: 0.3, keyed: false });

    expect(spriteSourceFor(current(id))).toBe("photo");
    expect(canChooseSpriteSource(current(id))).toBe(false);
  });

  it("treats a cutout that says nothing about keying as keyed", () => {
    const id = itemWithDrawing();
    useStore.getState().linkProduct(id, LAMP);
    useStore.getState().setListingCutout(id, { url: PHOTO, widthRatio: 0.3 });

    expect(spriteSourceFor(current(id))).toBe("photo");
  });

  it("flips on the first tap whichever way the default went", () => {
    const keyed = itemWithDrawing();
    useStore
      .getState()
      .setListingCutout(keyed, { url: PHOTO, widthRatio: 0.3, keyed: true });
    useStore.getState().toggleSpriteSource(keyed);
    expect(spriteSourceFor(current(keyed))).toBe("drawing");

    const unkeyed = itemWithDrawing();
    useStore
      .getState()
      .setListingCutout(unkeyed, { url: PHOTO, widthRatio: 0.3, keyed: false });
    useStore.getState().toggleSpriteSource(unkeyed);
    expect(spriteSourceFor(current(unkeyed))).toBe("photo");
  });
});

describe("a choice survives a relink", () => {
  it("keeps the drawing when a second keyed photo arrives", () => {
    const id = itemWithDrawing();
    useStore.getState().linkProduct(id, LAMP);
    useStore
      .getState()
      .setListingCutout(id, { url: PHOTO, widthRatio: 0.3, keyed: true });
    useStore.getState().toggleSpriteSource(id);
    expect(spriteSourceFor(current(id))).toBe("drawing");

    // the relink, exactly as the product card runs it: the old photo is
    // dropped on the tap and the new one lands whenever the server answers
    useStore.getState().linkProduct(id, OTHER_LAMP);
    useStore.getState().setListingCutout(id, null);
    expect(spriteSourceFor(current(id))).toBe("drawing");
    expect(spriteUrlFor(current(id))).toBe(DRAWING);

    useStore
      .getState()
      .setListingCutout(id, { url: OTHER_PHOTO, widthRatio: 0.5, keyed: true });

    expect(spriteSourceFor(current(id))).toBe("drawing");
    expect(spriteUrlFor(current(id))).toBe(DRAWING);
  });

  it("keeps the photo when a second un-keyed photo arrives", () => {
    const id = itemWithDrawing();
    useStore.getState().linkProduct(id, LAMP);
    useStore
      .getState()
      .setListingCutout(id, { url: PHOTO, widthRatio: 0.3, keyed: false });
    useStore.getState().toggleSpriteSource(id);
    expect(spriteSourceFor(current(id))).toBe("photo");

    useStore.getState().linkProduct(id, OTHER_LAMP);
    useStore.getState().setListingCutout(id, null);
    // with no photo in the room there is nothing to show but the drawing, and
    // that gap must not be mistaken for the user changing their mind
    expect(spriteSourceFor(current(id))).toBe("drawing");

    useStore
      .getState()
      .setListingCutout(id, { url: OTHER_PHOTO, widthRatio: 0.5, keyed: false });

    expect(spriteSourceFor(current(id))).toBe("photo");
    expect(spriteUrlFor(current(id))).toBe(OTHER_PHOTO);
  });

  it("starts a brand new item from the guess, not from the last item's choice", () => {
    const first = itemWithDrawing();
    useStore
      .getState()
      .setListingCutout(first, { url: PHOTO, widthRatio: 0.3, keyed: true });
    useStore.getState().toggleSpriteSource(first);

    const second = itemWithDrawing();
    useStore
      .getState()
      .setListingCutout(second, { url: PHOTO, widthRatio: 0.3, keyed: true });

    expect(spriteSourceFor(current(second))).toBe("photo");
  });
});
