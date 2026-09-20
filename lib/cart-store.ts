import { create } from "zustand";

/**
 * Shared cart contract for the whole app.
 *
 * - Jose's AR "confirm placement" button calls `addItem(item)`.
 * - Yutian's product search results map directly into `CartItem`.
 * - Fit-check (lib/fit-check.ts) sets `fitStatus` before/at add time.
 *
 * If either of them changes the shape they produce, change it HERE first —
 * this type is the single source of truth.
 */
export type Retailer = "Etsy" | "IKEA" | "Wayfair" | (string & {});

export type FitStatus = "ok" | "tight" | "no_fit";

export type CartItem = {
  id: string;
  title: string;
  retailer: Retailer;
  price: number;
  imageUrl: string;
  dimensions: { h: number; w: number; d: number; unit: "in" | "cm" };
  fitStatus?: FitStatus;
};

export type Doorway = { width: number; height: number };

type CartState = {
  items: CartItem[];
  budget: number;
  doorway: Doorway | null;
  addItem: (item: CartItem) => void;
  removeItem: (id: string) => void;
  clear: () => void;
  setBudget: (n: number) => void;
  setDoorway: (d: Doorway) => void;
  total: () => number;
  retailers: () => Retailer[];
  overBudget: () => boolean;
};

export const useCartStore = create<CartState>((set, get) => ({
  items: [],
  budget: 1000,
  doorway: null,

  // Dedupe by id — teammates may fire addItem more than once for the same product.
  addItem: (item) =>
    set((s) =>
      s.items.some((i) => i.id === item.id)
        ? s
        : { items: [...s.items, item] }
    ),

  removeItem: (id) =>
    set((s) => ({ items: s.items.filter((i) => i.id !== id) })),

  clear: () => set({ items: [] }),

  setBudget: (n) => set({ budget: n }),

  setDoorway: (d) => set({ doorway: d }),

  total: () => get().items.reduce((sum, i) => sum + i.price, 0),

  retailers: () => [...new Set(get().items.map((i) => i.retailer))],

  overBudget: () => get().total() > get().budget,
}));
