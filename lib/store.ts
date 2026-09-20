"use client";

import { useMemo } from "react";
import { create } from "zustand";

import { buildSimpleShoppingQuery } from "@/lib/sourcing/roomContext";
import { persist, createJSONStorage } from "zustand/middleware";

import type {
  CartItem,
  FitResult,
  PlacedItem,
  Product,
  Profile,
  ProfileField,
  Room,
  RoomContext,
  Savings,
} from "@/types";

/**
 * The single VISA store. Components read and write this rather than taking deep
 * prop chains, so an overlay can be dropped anywhere on the room screen.
 *
 * THE SHAPE, and it is a contract five other files read:
 *   { roomImage, roomContext, items, activeItemId, budgetCents, savings }
 * plus `profile`, which is the only slice that survives a reload — the user
 * should never re-enter their door and ceiling measurements.
 *
 * WHAT IS SPENT IS A SELECTOR, NEVER A FIELD. `spentCents(items)` below is the
 * only way to get the total. Accumulating it into state drifts the moment two
 * updates race, and a budget that drifts is a budget that lies on stage.
 *
 * `activeItemId` names the item every overlay is about. One field, read by all
 * of them — ambiguity about which item is active is the bug that eats an
 * evening.
 */

/* ----------------------------------------------------------------- defaults */

/**
 * Sensible starting measurements, in millimetres. They are marked "assumed"
 * until the user edits the field, and flip to "you measured this" after.
 * Sources: 762 mm / 2032 mm is the common US interior door (30in x 80in);
 * 914 mm hallway and landing are the minimum in most residential codes.
 */
export const DEFAULT_PROFILE: Profile = {
  doorWidthMm: 762,
  doorHeightMm: 2032,
  hallwayWidthMm: 914,
  landingWidthMm: 914,
  ceilingHeightMm: 2438,
  measured: {},
  budgetCents: 60000,
  units: "mm",
};

/**
 * The search query is the style words joined to the request. Past six the
 * string gets so specific that the shops answer with nothing, so the strip
 * stops accepting new ones there.
 */
const MAX_STYLE_TAGS = 6;

/** Five come off the photo; a couple more by hand is a palette, not a swatch book. */
const MAX_PALETTE = 8;

/** "#ABC", "abc123", "#AABBCC" all become "#aabbcc"; anything else is null. */
function normalizeHex(input: string): string | null {
  const raw = input.trim().replace(/^#/, "").toLowerCase();
  const full =
    raw.length === 3
      ? raw
          .split("")
          .map((c) => c + c)
          .join("")
      : raw;
  return /^[0-9a-f]{6}$/.test(full) ? `#${full}` : null;
}

/** $600. The budget is editable, but nobody should have to set one first. */
export const DEFAULT_BUDGET_CENTS = 60000;

export const EMPTY_SAVINGS: Savings = {
  budgetCents: null,
  spentCents: null,
  minutesSaved: null,
  tokenPercentSaved: null,
  fitWarnings: null,
  itemsChecked: null,
};

/** Warm neutrals, used when /api/analyze gives us nothing. No invention. */
export const NEUTRAL_PALETTE = [
  "#FBFAF7",
  "#E6E1D9",
  "#C9C1B4",
  "#8A837A",
  "#2A2724",
];

/** What the room context is when the read failed. Generic, and says so. */
export const NEUTRAL_ROOM_CONTEXT: RoomContext = {
  styleTags: [],
  palette: NEUTRAL_PALETTE,
  lighting: "neutral",
  source: "fallback",
};

/* -------------------------------------------------------------------- shape */

export type VisaState = {
  /* capture */
  roomImage: Room | null;
  /** exactly what /api/analyze answered — never edited in place */
  roomContext: RoomContext | null;
  /**
   * WHAT THE USER CHANGED ABOUT IT, kept apart from the model's answer.
   *
   * The read arrives seconds after the screen does, so edits made while it is
   * in flight used to be wiped the moment it landed: add "brass", watch Gemini
   * answer, watch "brass" vanish. Storing the edits rather than the result
   * means the answer can arrive whenever it likes and the strip still says
   * what the user made it say — and a word they deleted stays deleted even if
   * the model names it.
   */
  edits: {
    addedTags: string[];
    removedTags: string[];
    addedColors: string[];
    removedColors: string[];
  };

  /* the loop */
  items: PlacedItem[];
  /** which item every overlay is about */
  activeItemId: string | null;

  /* money */
  budgetCents: number;
  /**
   * Has the user actually chosen this number, or is it still our $600 guess?
   * The room asks once, right after the photo, because a budget that was never
   * set is a budget nobody is playing against.
   */
  budgetSet: boolean;

  /* the optional sponsor counters, behind a tap on the budget */
  savings: Savings;

  /* persistent */
  profile: Profile;
};

/** What `addItem` needs. Everything else has a sensible starting value. */
export type NewItem = {
  request: string;
  category: string;
  /** metres, AR world space; defaults to the origin until the user places it */
  position?: [number, number, number];
};

export type VisaActions = {
  /* capture */
  setRoomImage: (room: Room | null) => void;
  setRoomContext: (context: RoomContext | null) => void;
  /** the user disagrees with a style tag; the next search changes */
  removeStyleTag: (tag: string) => void;
  /** the user knows something the photo does not say — "brass", "rattan" */
  addStyleTag: (tag: string) => void;
  /** a colour the photo missed, or one the user simply wants */
  addPaletteColor: (hex: string) => void;
  removePaletteColor: (hex: string) => void;

  /* items */
  /** creates the item and makes it active; returns its id for the async jobs */
  addItem: (item: NewItem) => string;
  setPlaceholder: (
    id: string,
    placeholder: { url: string; widthRatio?: number } | null
  ) => void;
  setOptions: (id: string, options: Product[] | null) => void;
  /** pass null to unlink */
  linkProduct: (id: string, product: Product | null) => void;
  setFit: (id: string, fit: FitResult | null) => void;
  moveItem: (
    id: string,
    position: [number, number, number],
    rotationY?: number
  ) => void;
  /** the user's own size for one sprite; 1 puts it back to the listing's */
  resizeItem: (id: string, scale: number) => void;
  /** Refresh may keep the current photo visible until a new one is ready. */
  startListingCutout: (id: string, preserveExisting?: boolean, requestedVersion?: string) => number | null;
  /** Complete only the matching extraction; a failed refresh keeps its previous photo. */
  setListingCutout: (
    id: string,
    cutout: { url: string; widthRatio: number; version?: string | null } | null,
    requestId?: number,
    note?: string
  ) => void;
  removeItem: (id: string) => void;
  /** put a removed item back exactly where it was — the undo toast's action */
  restoreItem: (item: PlacedItem, index?: number) => void;
  setActiveItem: (id: string | null) => void;

  /* money */
  setBudget: (cents: number) => void;
  /** v2 name, same action. ProfileSheet still calls this. */
  setBudgetCents: (cents: number) => void;
  setSavings: (savings: Savings) => void;

  /* profile */
  setProfile: (patch: Partial<Omit<Profile, "measured">>) => void;
  /** edits one measurement and marks it measured, not assumed */
  measure: (field: ProfileField, valueMm: number) => void;

  /* demo */
  reset: () => void;
};

export type VisaStore = VisaState & VisaActions;

const EMPTY_EDITS = {
  addedTags: [] as string[],
  removedTags: [] as string[],
  addedColors: [] as string[],
  removedColors: [] as string[],
};

const initialState: VisaState = {
  roomImage: null,
  roomContext: null,
  edits: EMPTY_EDITS,
  items: [],
  activeItemId: null,
  budgetCents: DEFAULT_BUDGET_CENTS,
  budgetSet: false,
  savings: EMPTY_SAVINGS,
  profile: DEFAULT_PROFILE,
};

/* ------------------------------------------------------------------- store */

let itemSeq = 0;
// Items are not persisted. This counter is never reset with the room, so an
// old async response cannot match a link or retry from a later room/undo.
let listingJobSeq = 0;
function nextItemId() {
  itemSeq += 1;
  return `item-${itemSeq}-${Date.now().toString(36)}`;
}

/** One place that knows how to patch one item, so no action can miss an id. */
function patchItem(
  items: PlacedItem[],
  id: string,
  patch: (item: PlacedItem) => PlacedItem
): PlacedItem[] {
  const i = items.findIndex((item) => item.id === id);
  if (i === -1) return items;
  const next = items.slice();
  next[i] = patch(next[i]);
  return next;
}

export const useStore = create<VisaStore>()(
  persist(
    (set, get) => ({
      ...initialState,

      /* capture */
      setRoomImage: (roomImage) =>
        // a new room invalidates everything standing in the old one, edits too
        set({
          roomImage,
          roomContext: null,
          edits: EMPTY_EDITS,
          items: [],
          activeItemId: null,
        }),
      setRoomContext: (roomContext) => set({ roomContext }),
      removeStyleTag: (tag) =>
        set((s) => ({
          edits: {
            ...s.edits,
            addedTags: s.edits.addedTags.filter((t) => t !== tag),
            // remembered, so a late model answer cannot bring it back
            removedTags: s.edits.removedTags.includes(tag)
              ? s.edits.removedTags
              : [...s.edits.removedTags, tag],
          },
        })),

      /*
       * Every style word is typed straight into a shop's search box, so a word
       * added here is normalised the same way the model's own words are:
       * lowercase, single-spaced, short. Duplicates are ignored rather than
       * stacked, and the list stops at MAX_STYLE_TAGS — past that the query
       * gets so specific that the shops return nothing.
       *
       * It works before the photo has been read, too: with no room context yet
       * the word starts one, so the first search still carries it.
       */
      addStyleTag: (tag) =>
        set((s) => {
          const word = tag.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 24);
          if (!word) return {};
          if (effectiveTags(s).includes(word)) return {};
          if (effectiveTags(s).length >= MAX_STYLE_TAGS) return {};
          return {
            edits: {
              ...s.edits,
              addedTags: [...s.edits.addedTags, word],
              removedTags: s.edits.removedTags.filter((t) => t !== word),
            },
          };
        }),

      /*
       * The palette is not decoration: it goes into the placeholder prompt and
       * into the silhouette tint, so a colour added here changes the next
       * stand-in that gets drawn. Normalised to #rrggbb so the same colour
       * typed two ways cannot appear twice or bust the generation cache key.
       */
      addPaletteColor: (hex) =>
        set((s) => {
          const colour = normalizeHex(hex);
          if (!colour) return {};
          if (effectivePalette(s).includes(colour)) return {};
          if (effectivePalette(s).length >= MAX_PALETTE) return {};
          return {
            edits: {
              ...s.edits,
              addedColors: [...s.edits.addedColors, colour],
              removedColors: s.edits.removedColors.filter((c) => c !== colour),
            },
          };
        }),

      removePaletteColor: (hex) =>
        set((s) => ({
          edits: {
            ...s.edits,
            addedColors: s.edits.addedColors.filter((c) => c !== hex),
            removedColors: s.edits.removedColors.includes(hex)
              ? s.edits.removedColors
              : [...s.edits.removedColors, hex],
          },
        })),

      /* items — the item exists before either async job returns */
      addItem: ({ request, category, position }) => {
        const id = nextItemId();
        set((s) => ({
          items: [
            ...s.items,
            {
              id,
              request,
              category,
              placeholderUrl: "",
              placeholderWidthRatio: 1,
              placeholderStatus: "pending",
              options: [],
              optionsStatus: "pending",
              position: position ?? [0, 0, 0],
              rotationY: 0,
              scale: 1,
              listingCutoutUrl: null,
              listingWidthRatio: null,
              listingCutoutVersion: null,
              listingCutoutRequestedVersion: null,
              listingCutoutStatus: "idle",
              listingCutoutNote: null,
              linkedProductVersion: 0,
              listingCutoutRequestId: null,
              placed: position !== undefined,
              linkedProduct: null,
              fit: null,
              createdAt: Date.now(),
            },
          ],
          activeItemId: id,
        }));
        return id;
      },

      setPlaceholder: (id, placeholder) =>
        set((s) => ({
          items: patchItem(s.items, id, (item) =>
            placeholder
              ? {
                  ...item,
                  placeholderUrl: placeholder.url,
                  placeholderWidthRatio:
                    placeholder.widthRatio && placeholder.widthRatio > 0
                      ? placeholder.widthRatio
                      : item.placeholderWidthRatio,
                  placeholderStatus: "ready",
                }
              : // null means the generator gave up; the silhouette stands in
                { ...item, placeholderStatus: "failed" }
          ),
        })),

      setOptions: (id, options) =>
        set((s) => ({
          items: patchItem(s.items, id, (item) =>
            options
              ? { ...item, options, optionsStatus: "ready" }
              : { ...item, options: [], optionsStatus: "failed" }
          ),
        })),

      /*
       * Linking changes the size of the thing standing in the room and moves
       * the budget. Clear the old photo and verdict atomically, keeping the
       * position and user scale. Each link gets a new generation, including
       * A → B → A, so asynchronous work cannot attach to an older choice.
       */
      linkProduct: (id, product) =>
        set((s) => ({
          items: patchItem(s.items, id, (item) => ({
            ...item,
            linkedProduct: product,
            linkedProductVersion: ++listingJobSeq,
            listingCutoutUrl: null,
            listingWidthRatio: null,
            listingCutoutVersion: null,
            listingCutoutRequestedVersion: null,
            listingCutoutStatus: "idle",
            listingCutoutNote: null,
            listingCutoutRequestId: null,
            fit: null,
          })),
        })),

      setFit: (id, fit) =>
        set((s) => ({
          items: patchItem(s.items, id, (item) => ({ ...item, fit })),
        })),

      moveItem: (id, position, rotationY) =>
        set((s) => ({
          items: patchItem(s.items, id, (item) => ({
            ...item,
            position,
            rotationY: rotationY ?? item.rotationY,
            placed: true,
          })),
        })),

      startListingCutout: (id, preserveExisting = false, requestedVersion) => {
        const current = get().items.find((item) => item.id === id);
        if (!current?.linkedProduct || current.listingCutoutStatus === "pending") return null;
        const requestId = ++listingJobSeq;
        set((s) => ({
          items: patchItem(s.items, id, (item) => ({
            ...item,
            listingCutoutUrl: preserveExisting ? item.listingCutoutUrl : null,
            listingWidthRatio: preserveExisting ? item.listingWidthRatio : null,
            listingCutoutVersion: preserveExisting ? item.listingCutoutVersion ?? null : null,
            listingCutoutRequestedVersion: requestedVersion ?? item.listingCutoutRequestedVersion ?? null,
            listingCutoutStatus: "pending",
            listingCutoutNote: null,
            listingCutoutRequestId: requestId,
          })),
        }));
        return requestId;
      },

      setListingCutout: (id, cutout, requestId, note) =>
        set((s) => ({
          items: patchItem(s.items, id, (item) => {
            if (requestId !== undefined && (
              item.listingCutoutRequestId !== requestId || item.listingCutoutStatus !== "pending"
            )) return item;
            return {
              ...item,
              listingCutoutUrl: cutout?.url ?? (requestId !== undefined ? item.listingCutoutUrl : null),
              listingWidthRatio: cutout?.widthRatio ?? (requestId !== undefined ? item.listingWidthRatio : null),
              listingCutoutVersion: cutout ? cutout.version ?? null : requestId !== undefined ? item.listingCutoutVersion : null,
              listingCutoutStatus: cutout ? "ready" : requestId === undefined ? "idle" : "failed",
              listingCutoutNote: cutout ? null : note ?? null,
              // Legacy direct clears also invalidate any in-flight attempt.
              listingCutoutRequestId: requestId ?? null,
            };
          }),
        })),

      resizeItem: (id, scale) =>
        set((s) => ({
          items: patchItem(s.items, id, (item) => ({
            // a quarter to four times: past that it is not the object any more
            ...item,
            scale: Math.min(Math.max(scale, 0.25), 4),
          })),
        })),

      removeItem: (id) =>
        set((s) => {
          const items = s.items.filter((item) => item.id !== id);
          return {
            items,
            activeItemId:
              s.activeItemId === id
                ? (items[items.length - 1]?.id ?? null)
                : s.activeItemId,
          };
        }),

      restoreItem: (item, index) =>
        set((s) => {
          if (s.items.some((i) => i.id === item.id)) return {};
          const items = s.items.slice();
          const at =
            index === undefined
              ? items.length
              : Math.min(Math.max(index, 0), items.length);
          items.splice(at, 0, {
            ...item,
            linkedProductVersion: ++listingJobSeq,
            listingCutoutRequestId: null,
            listingCutoutStatus: item.listingCutoutStatus === "pending" ? "failed" : item.listingCutoutStatus,
            listingCutoutNote: item.listingCutoutStatus === "pending"
              ? "Product photo was interrupted. Try again."
              : item.listingCutoutNote,
          });
          return { items, activeItemId: item.id };
        }),

      setActiveItem: (activeItemId) => set({ activeItemId }),

      /* money */
      setBudget: (budgetCents) =>
        set((s) => ({
          budgetCents,
          // chosen, so the room stops asking
          budgetSet: true,
          // the persisted profile keeps it for the next session
          profile: { ...s.profile, budgetCents },
        })),
      setBudgetCents: (cents) => get().setBudget(cents),
      setSavings: (savings) => set({ savings }),

      /* profile */
      setProfile: (patch) => set((s) => ({ profile: { ...s.profile, ...patch } })),
      measure: (field, valueMm) =>
        set((s) => ({
          profile: {
            ...s.profile,
            [field]: valueMm,
            measured: { ...s.profile.measured, [field]: true },
          },
        })),

      /* demo: long-press the title at the expo and start clean */
      reset: () =>
        set({
          ...initialState,
          profile: get().profile,
          budgetCents: get().profile.budgetCents,
        }),
    }),
    {
      name: "visa.profile",
      version: 2,
      storage: createJSONStorage(() => localStorage),
      // the measurements and the budget are the only things worth remembering
      partialize: (s) => ({ profile: s.profile }),
      onRehydrateStorage: () => (state) => {
        if (state) state.budgetCents = state.profile.budgetCents;
      },
    }
  )
);

/* ------------------------------------------------------- the room context */

function effectiveTags(state: {
  roomContext: RoomContext | null;
  edits: VisaState["edits"];
}): string[] {
  const fromModel = state.roomContext?.styleTags ?? [];
  const kept = fromModel.filter((t) => !state.edits.removedTags.includes(t));
  const added = state.edits.addedTags.filter((t) => !kept.includes(t));
  return [...kept, ...added].slice(0, MAX_STYLE_TAGS);
}

function effectivePalette(state: {
  roomContext: RoomContext | null;
  edits: VisaState["edits"];
}): string[] {
  const fromModel = state.roomContext?.palette ?? [];
  const kept = fromModel.filter((c) => !state.edits.removedColors.includes(c));
  const added = state.edits.addedColors.filter((c) => !kept.includes(c));
  return [...kept, ...added].slice(0, MAX_PALETTE);
}

/**
 * THE ROOM CONTEXT EVERYTHING ELSE SHOULD READ.
 *
 * The model's answer with the user's edits applied: their words added, the
 * ones they deleted gone for good, their colours in `picked` so the search and
 * the image prompt can treat them as intent. Nothing reads `roomContext`
 * directly any more except this function — that is what stops a late answer
 * from undoing an edit, and an edit from being forgotten by the next search.
 */
export function roomContextFor(state: {
  roomContext: RoomContext | null;
  edits: VisaState["edits"];
}): RoomContext | null {
  const base = state.roomContext;
  const tags = effectiveTags(state);
  const palette = effectivePalette(state);
  const picked = state.edits.addedColors.filter((c) => palette.includes(c));

  if (!base) {
    if (tags.length === 0 && palette.length === 0) return null;
    // edits made before the read landed still steer the search
    return {
      styleTags: tags,
      palette,
      picked,
      lighting: "neutral",
      source: "fallback",
    };
  }

  return { ...base, styleTags: tags, palette, picked };
}

/**
 * The same thing as a hook, for a component that just wants to render it.
 *
 * It selects the two STABLE references and merges them in a memo, rather than
 * merging inside the selector. zustand reads a selector through
 * useSyncExternalStore, which compares the result by identity — and
 * roomContextFor builds a fresh object every call, so selecting it directly
 * meant every render produced a new snapshot and React refused to settle:
 * "The result of getSnapshot should be cached to avoid an infinite loop."
 * `roomContext` and `edits` only change when they actually change, so the memo
 * recomputes exactly when it should.
 */
export function useRoomContext(): RoomContext | null {
  const roomContext = useStore((s) => s.roomContext);
  const edits = useStore((s) => s.edits);
  return useMemo(
    () => roomContextFor({ roomContext, edits }),
    [roomContext, edits]
  );
}

/** Older files imported the store under this name. Same store. */
export const useVisaStore = useStore;

/* --------------------------------------------------------------- selectors */

/**
 * THE running total. Derived from the items every time it is read, so removing
 * an item drops the total with no extra action dispatched and two racing
 * updates cannot drift it.
 */
export function spentCents(items: PlacedItem[]): number {
  return items.reduce(
    (sum, item) => sum + (item.linkedProduct?.priceCents ?? 0),
    0
  );
}

/** The same number, as a hook, for any component that just wants to render it. */
export function useSpentCents(): number {
  return useStore((s) => spentCents(s.items));
}

/** What a link, relink or unlink would do to the total. Cents, signed. */
export function deltaCents(
  previous: Product | null,
  next: Product | null
): number {
  return (next?.priceCents ?? 0) - (previous?.priceCents ?? 0);
}

/** Items with a listing linked, in the order they were asked for. */
export function linkedItems(items: PlacedItem[]): PlacedItem[] {
  return items.filter((item) => item.linkedProduct !== null);
}

export function itemById(
  items: PlacedItem[],
  id: string | null
): PlacedItem | null {
  if (!id) return null;
  return items.find((item) => item.id === id) ?? null;
}

/** The active item, or null. Every overlay reads this. */
export function useActiveItem(): PlacedItem | null {
  return useStore((s) => itemById(s.items, s.activeItemId));
}

/** Over budget is shown, never clamped and never hidden. */
export function overBudgetCents(
  items: PlacedItem[],
  budgetCents: number
): number {
  return Math.max(0, spentCents(items) - budgetCents);
}

/** The checkout review's lines: one per linked item. */
export function cartLines(items: PlacedItem[]): CartItem[] {
  return linkedItems(items).map((item) => ({
    id: item.id,
    product: item.linkedProduct as Product,
    quantity: 1,
    itemId: item.id,
    addedAt: item.createdAt,
  }));
}

export function cartSubtotalCents(lines: CartItem[]): number {
  return lines.reduce((sum, l) => sum + l.product.priceCents * l.quantity, 0);
}

export function cartCount(lines: CartItem[]): number {
  return lines.reduce((sum, l) => sum + l.quantity, 0);
}

/** Grouped by retailer — three shops, one button, and the review must show it. */
export function cartByRetailer(lines: CartItem[]): Array<{
  retailer: string;
  items: CartItem[];
  subtotalCents: number;
}> {
  const groups = new Map<string, CartItem[]>();
  for (const line of lines) {
    const key = line.product.retailer;
    const list = groups.get(key);
    if (list) list.push(line);
    else groups.set(key, [line]);
  }
  return [...groups.entries()].map(([retailer, items]) => ({
    retailer,
    items,
    subtotalCents: cartSubtotalCents(items),
  }));
}

/** Shared with the server so current edits and explicit object colours agree. */
export function searchQuery(context: RoomContext | null, request: string): string {
  return buildSimpleShoppingQuery(request, context);
}
