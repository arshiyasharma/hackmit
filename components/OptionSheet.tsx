"use client";

import * as React from "react";
import { create } from "zustand";

import SourcingResults from "@/components/SourcingResults";
import { Sheet } from "@/components/ui/Sheet";
import { withDemo } from "@/lib/demo";
import { searchQuery, spentCents, useActiveItem, useStore } from "@/lib/store";
import type { PlacedItem, Product } from "@/types";

/**
 * The options for the active placeholder, in a bottom sheet over the room.
 *
 * It takes NO PROPS and reads the store, like every other overlay on the room
 * screen, and it is always about `activeItemId` — the one field the whole
 * chrome agrees on.
 *
 * IT OPENS AT THE 0.4 SNAP so the placeholder stays visible above it. That is
 * the answer to the phone-crowding problem: the room is never covered, the
 * options scroll underneath it. Dragging to 0.9 swaps the Embla row for the
 * full list with bigger images — two snaps, phone and desk, one component.
 *
 * It also owns the search. The item exists before either async job returns, so
 * this fires /api/search for the active item the moment it appears and the
 * sheet shows five skeletons in the meantime. Never a spinner.
 */

/* --------------------------------------------------------- open / closed */

/**
 * Whether the sheet is open is NOT in lib/store.ts — the store's shape is a
 * contract five other files read, and this is local chrome state. It lives in
 * its own tiny store so the sprite tap, the items strip and the ask input can
 * all reach it without a prop chain:
 *
 *   import { openOptionsFor } from "@/components/OptionSheet";
 *   openOptionsFor(item.id);
 *
 * If a `optionSheetItemId` field ever lands in lib/store.ts, delete this.
 */
type SheetState = { open: boolean };

const useSheetState = create<SheetState>(() => ({ open: false }));

/** Make that item active and show its options. The sprite tap calls this. */
export function openOptionsFor(itemId: string): void {
  useStore.getState().setActiveItem(itemId);
  useSheetState.setState({ open: true });
}

export function closeOptions(): void {
  useSheetState.setState({ open: false });
}

/** Is the option sheet showing? The ask input hides itself while it is. */
export function useOptionsOpen(): boolean {
  return useSheetState((s) => s.open);
}

/* --------------------------------------------------------------- the call */

/** One search per item, even across a remount of the sheet. */
const started = new Set<string>();
const inFlight = new Map<string, AbortController>();

type SearchAnswer = {
  query?: unknown;
  options?: unknown;
  source?: unknown;
  note?: unknown;
};

function optionsOf(answer: SearchAnswer): Product[] {
  return Array.isArray(answer.options) ? (answer.options as Product[]) : [];
}

/* ------------------------------------------------------------------ sheet */

export function OptionSheet() {
  const open = useSheetState((s) => s.open);
  const item = useActiveItem();
  const roomContext = useStore((s) => s.roomContext);

  const [snap, setSnap] = React.useState(1);
  const [pendingId, setPendingId] = React.useState<string | null>(null);
  const [notes, setNotes] = React.useState<Record<string, string | undefined>>({});
  const [queriesUsed, setQueriesUsed] = React.useState<Record<string, string>>({});

  /* the string on screen IS the string that gets sent */
  const query = item ? searchQuery(roomContext, item.request) : "";

  const runSearch = React.useCallback(async (target: PlacedItem) => {
    const state = useStore.getState();
    const sent = searchQuery(state.roomContext, target.request);

    inFlight.get(target.id)?.abort();
    const controller = new AbortController();
    inFlight.set(target.id, controller);
    started.add(target.id);
    setPendingId(target.id);

    try {
      const res = await fetch(withDemo("/api/search"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          itemId: target.id,
          request: target.request,
          category: target.category,
          query: sent,
          roomContext: state.roomContext,
          budgetRemainingCents: state.budgetCents - spentCents(state.items),
        }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`search ${res.status}`);

      const answer = (await res.json()) as SearchAnswer;
      // an empty list is a ANSWER, not a failure: the sheet says so in words
      useStore.getState().setOptions(target.id, optionsOf(answer));
      setNotes((n) => ({
        ...n,
        [target.id]: typeof answer.note === "string" ? answer.note : undefined,
      }));
      setQueriesUsed((q) => ({
        ...q,
        [target.id]: typeof answer.query === "string" ? answer.query : sent,
      }));
    } catch (err) {
      if (controller.signal.aborted) return;
      console.warn("[options] /api/search failed", err);
      useStore.getState().setOptions(target.id, null);
      setQueriesUsed((q) => ({ ...q, [target.id]: sent }));
    } finally {
      if (!controller.signal.aborted) setPendingId(null);
      if (inFlight.get(target.id) === controller) inFlight.delete(target.id);
    }
  }, []);

  /* a new item searches once, whether or not the sheet is open yet */
  React.useEffect(() => {
    if (!item || item.optionsStatus !== "pending") return;
    if (started.has(item.id)) return;
    const target = item;
    // the fetch is an external system; start it off the render pass
    queueMicrotask(() => void runSearch(target));
  }, [item, runSearch]);

  /*
   * EDITING THE STRIP RE-RUNS THE SEARCH. Removing "ornate", adding "brass",
   * picking sage — each changes the query string this sheet is showing, and a
   * query on screen that does not match the results under it is the thing a
   * judge notices. So when the query moves and the sheet is open, the search
   * runs again on its own; a short delay keeps three quick edits to one fetch.
   */
  const queryRef = React.useRef(query);
  React.useEffect(() => {
    const previous = queryRef.current;
    queryRef.current = query;
    if (!item || !open) return;
    if (previous === query) return;
    if (queriesUsed[item.id] === undefined) return; // nothing searched yet
    if (queriesUsed[item.id] === query) return;

    const target = item;
    const timer = window.setTimeout(() => {
      started.delete(target.id);
      void runSearch(target);
    }, 700);
    return () => window.clearTimeout(timer);
  }, [query, item, open, queriesUsed, runSearch]);

  /* a new active item brings its options up with it */
  const lastOpened = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!item) return;
    if (lastOpened.current === item.id) return;
    lastOpened.current = item.id;
    useSheetState.setState({ open: true });
  }, [item]);

  React.useEffect(
    () => () => {
      for (const controller of inFlight.values()) controller.abort();
      inFlight.clear();
    },
    []
  );

  if (!item) return null;

  const retry = () => {
    started.delete(item.id);
    void runSearch(item);
  };

  const searching = pendingId === item.id;
  const view: PlacedItem = searching
    ? { ...item, optionsStatus: "pending" }
    : item;

  // removing a style chip changes the query; the results on screen are older
  const stale =
    !searching &&
    queriesUsed[item.id] !== undefined &&
    queriesUsed[item.id] !== query;

  const heading = item.category || item.request;

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => useSheetState.setState({ open: next })}
      snapPoints={[0.9, 0.4]}
      initialSnap={1}
      onSnap={setSnap}
      label={`Options for ${heading}`}
    >
      <div className="flex flex-col gap-3">
        <header className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate font-display text-xl font-semibold capitalize">
              {heading}
            </h2>
            <p className="truncate text-xs text-muted-foreground">
              you asked for “{item.request}”
            </p>
          </div>

          {stale ? (
            <button
              type="button"
              onClick={retry}
              className="tap h-11 shrink-0 rounded-full border border-accent px-3 text-xs font-medium text-accent"
            >
              Search again
            </button>
          ) : null}
        </header>

        {roomContext?.source === "fallback" ? (
          <p className="text-[11px] text-muted-foreground">
            Couldn&rsquo;t read the style — this search is generic.
          </p>
        ) : null}

        <SourcingResults
          item={view}
          query={query}
          layout={snap === 0 ? "list" : "rail"}
          note={notes[item.id]}
          onRetry={retry}
        />
      </div>
    </Sheet>
  );
}

export default OptionSheet;
