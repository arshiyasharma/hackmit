"use client";

/**
 * THE LISTING BEING LOOKED AT — not the one that is linked.
 *
 * Beat 05 of the motion sheet is the demo: "Pick another one. The room changes."
 * Linking already resizes the thing standing in the room. This makes the rail
 * itself do it: whichever listing is centred in the rail is *previewed* — the
 * stand-in takes its size, the label counts to its millimetres, and the budget
 * shows what it would do to the total — before anything is committed.
 *
 * A PREVIEW IS NEVER A FACT. It is not in the main store, it never reaches the
 * basket, the fit check or the checkout, and everything that draws it must draw
 * it as a preview (the pale accent, a dashed edge, the word "previewing") so the
 * shopper can always tell the size they are trying on from the size they chose.
 * `spentCents` does not know this file exists, on purpose.
 *
 * One listing at a time, for one item. It is cleared when the rail closes, when
 * a listing is linked, and when the item it belongs to goes away.
 */

import { create } from "zustand";

import type { PlacedItem, Product } from "@/types";

type PreviewState = {
  /** the item whose options are being browsed */
  itemId: string | null;
  /** the listing in focus; null when nothing is being tried on */
  product: Product | null;
};

type PreviewActions = {
  focus: (itemId: string, product: Product) => void;
  clear: () => void;
};

export const usePreview = create<PreviewState & PreviewActions>()((set, get) => ({
  itemId: null,
  product: null,
  focus: (itemId, product) => {
    const now = get();
    if (now.itemId === itemId && now.product?.id === product.id) return;
    set({ itemId, product });
  },
  clear: () => {
    if (get().itemId === null && get().product === null) return;
    set({ itemId: null, product: null });
  },
}));

/**
 * The listing being tried on for this item, or null. A listing that is already
 * the linked one is not a preview of anything, so it reads as null too.
 */
export function usePreviewFor(item: Pick<PlacedItem, "id" | "linkedProduct"> | null): Product | null {
  return usePreview((s) => {
    if (!item || s.itemId !== item.id || !s.product) return null;
    if (item.linkedProduct?.id === s.product.id) return null;
    return s.product;
  });
}

/**
 * What linking the previewed listing would do to the total, in signed cents —
 * the difference against whatever that item has linked now. Null when nothing
 * is being previewed or the item is gone.
 */
export function previewDeltaCents(
  items: PlacedItem[],
  preview: Pick<PreviewState, "itemId" | "product">
): number | null {
  if (!preview.itemId || !preview.product) return null;
  const item = items.find((i) => i.id === preview.itemId);
  if (!item) return null;
  if (item.linkedProduct?.id === preview.product.id) return null;
  return preview.product.priceCents - (item.linkedProduct?.priceCents ?? 0);
}
