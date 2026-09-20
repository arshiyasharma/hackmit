"use client";

import * as React from "react";
import { X } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { create } from "zustand";

import SourcingResults from "@/components/SourcingResults";
import { withDemo } from "@/lib/demo";
import { ENTER, EXIT, REDUCED } from "@/lib/motion";
import { usePreview } from "@/lib/preview";
import {
  roomContextFor,
  searchQuery,
  spentCents,
  useActiveItem,
  useRoomContext,
  useStore,
} from "@/lib/store";
import { cn } from "@/lib/utils";
import type { PlacedItem, Product } from "@/types";

/**
 * The options for the active placeholder: THE LISTING TRAY, docked under the
 * room (docs/ROOM3_PRODUCT_SPEC.md 1b, beats 04 and 05).
 *
 * The file is still called OptionSheet because five other files import it by
 * that name, but it is not a sheet any more. A bottom sheet is a phone's answer
 * to "where do five listings go"; on a laptop it is a modal curtain over the
 * very room the listings are for. So this is a non-modal pane of thick glass
 * standing in the stage — the room stays live above it, the style strip stays
 * editable beside it, and pointing at a listing tries it on in the room.
 *
 * It renders INLINE, with no portal, on purpose: its right edge and its height
 * are the room page's own CSS variables (`--stage-right`, `--tray-h`, set on
 * <main>), the same two the scene reads to keep the object clear of it. A
 * portal to <body> would sit outside them.
 *
 * It takes NO PROPS and reads the store, like every other overlay on the room
 * screen, and it is always about `activeItemId` — the one field the whole
 * chrome agrees on.
 *
 * It also owns the search. The item exists before either async job returns, so
 * this fires /api/search for the active item the moment it appears and the
 * tray shows five skeletons in the meantime. Never a spinner.
 */

/* --------------------------------------------------------- open / closed */

/**
 * Whether the tray is open is NOT in lib/store.ts — the store's shape is a
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

/** Is the tray showing? The room page sizes the stage's free area from this. */
export function useOptionsOpen(): boolean {
  return useSheetState((s) => s.open);
}

/* --------------------------------------------------------------- the call */

/** One search per item, even across a remount of the tray. */
const started = new Set<string>();
/** itemId -> the exact query already sent for it, so a repeat is a no-op */
const asked = new Map<string, string>();
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

/**
 * Is a modal dialog up — the fit check, the measurements, the account panel?
 * Then Escape belongs to it, not to the tray underneath. The landing keeps its
 * own hidden `role="dialog"` pages inside `.sense`; those are not ours.
 */
function modalOpen(): boolean {
  const found = document.querySelectorAll("[role='dialog'][aria-modal='true']");
  return Array.from(found).some((el) => !el.closest(".sense"));
}

/* ------------------------------------------------------------------- tray */

export function OptionSheet() {
  const open = useSheetState((s) => s.open);
  const item = useActiveItem();
  const roomContext = useRoomContext();
  const reduced = useReducedMotion();

  const [pendingId, setPendingId] = React.useState<string | null>(null);
  const [notes, setNotes] = React.useState<Record<string, string | undefined>>({});
  const [queriesUsed, setQueriesUsed] = React.useState<Record<string, string>>({});

  /* the string on screen IS the string that gets sent */
  const query = item ? searchQuery(roomContext, item.request) : "";

  const runSearch = React.useCallback(async (target: PlacedItem) => {
    const state = useStore.getState();
    const context = roomContextFor(state);
    const sent = searchQuery(context, target.request);

    /*
     * THE SAME QUESTION IS NOT ASKED TWICE.
     *
     * Every call here spends a SerpAPI request, and the server log caught this
     * firing eleven times for one query inside forty seconds — a re-render
     * upstream re-entering the effect that starts a search. The guard is the
     * pair (item, query): if that exact question is already asked, this call
     * is a duplicate and it stops here. `started` alone could not see it,
     * because it only knows the item.
     */
    if (asked.get(target.id) === sent) return;
    asked.set(target.id, sent);

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
          roomContext: context,
          budgetRemainingCents: state.budgetCents - spentCents(state.items),
        }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`search ${res.status}`);

      const answer = (await res.json()) as SearchAnswer;
      // an empty list is a ANSWER, not a failure: the tray says so in words
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
      // a failure is not an answer: let the same query be asked again
      asked.delete(target.id);
      console.warn("[options] /api/search failed", err);
      useStore.getState().setOptions(target.id, null);
      setQueriesUsed((q) => ({ ...q, [target.id]: sent }));
    } finally {
      if (!controller.signal.aborted) setPendingId(null);
      if (inFlight.get(target.id) === controller) inFlight.delete(target.id);
    }
  }, []);

  /* a new item searches once, whether or not the tray is open yet */
  React.useEffect(() => {
    if (!item || item.optionsStatus !== "pending") return;
    if (started.has(item.id)) return;
    const target = item;
    // the fetch is an external system; start it off the render pass
    queueMicrotask(() => void runSearch(target));
  }, [item, runSearch]);

  /*
   * EDITING THE STRIP RE-RUNS THE SEARCH. Removing "ornate", adding "brass",
   * picking sage — each changes the query string this tray is showing, and a
   * query on screen that does not match the results under it is the thing a
   * judge notices. So when the query moves and the tray is open, the search
   * runs again on its own; a short delay keeps three quick edits to one fetch.
   * (The tray is not modal, so the strip stays reachable while it is up.)
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
      // the query itself changed, so this is a new question, not a repeat
      asked.delete(target.id);
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

  /*
   * LEAVING MID-SEARCH MUST NOT STRAND THE ITEM. Room III unmounts this screen
   * whenever the shopper steps out, and an aborted run returns before it
   * writes an answer — so an id left behind in `started` (or its question left
   * in `asked`) meant the remounted tray would never search for it again: five
   * skeletons, forever. A run that is cut off here is forgotten, and the next
   * mount asks again.
   */
  React.useEffect(
    () => () => {
      for (const [id, controller] of inFlight) {
        controller.abort();
        started.delete(id);
        asked.delete(id);
      }
      inFlight.clear();
      usePreview.getState().clear();
    },
    []
  );

  /*
   * A PREVIEW BELONGS TO AN OPEN TRAY AND TO ONE ITEM. The row clears it when
   * the pointer leaves; these two cover the ways a row can vanish from under
   * the pointer instead — the tray closing, and the chrome turning to a
   * different item.
   */
  const itemId = item?.id ?? null;
  React.useEffect(() => {
    if (!open) usePreview.getState().clear();
  }, [open]);
  React.useEffect(() => {
    usePreview.getState().clear();
  }, [itemId]);

  /*
   * ESCAPE CLOSES THE TRAY, wherever focus is — it is the successor of a sheet,
   * and "a sheet takes the first Escape". Heard on `document`, which the event
   * reaches before room III's own listener on `window`; marking it handled and
   * stopping it there is what keeps one key press from also walking the shopper
   * out of the product. A field keeps its own Escape, and so does a dialog.
   */
  const showing = open && item !== null;
  React.useEffect(() => {
    if (!showing) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      const at = document.activeElement;
      if (at instanceof HTMLInputElement || at instanceof HTMLTextAreaElement) return;
      if (modalOpen()) return;
      event.preventDefault();
      event.stopPropagation();
      closeOptions();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [showing]);

  if (!item) return null;

  const retry = () => {
    started.delete(item.id);
    asked.delete(item.id); // a deliberate re-ask, so the guard steps aside
    void runSearch(item);
  };

  const searching = pendingId === item.id;
  const view: PlacedItem = searching
    ? { ...item, optionsStatus: "pending" }
    : item;
  const waiting = view.optionsStatus === "pending";

  // removing a style chip changes the query; the results on screen are older
  const stale =
    !searching &&
    queriesUsed[item.id] !== undefined &&
    queriesUsed[item.id] !== query;

  const heading = item.category || item.request;
  const note = notes[item.id];

  // real counts only: nothing while the shops are still being asked, and
  // nothing when they did not answer at all
  const count = view.optionsStatus === "ready" ? view.options.length : null;
  const shops = new Set(view.options.map((p) => p.retailer)).size;

  return (
    <AnimatePresence>
      {open ? (
        <motion.section
          key="tray"
          role="region"
          aria-label={`Options for ${heading}`}
          data-option-tray=""
          initial={reduced ? { opacity: 0 } : { opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0, transition: reduced ? REDUCED : ENTER }}
          exit={
            reduced
              ? { opacity: 0, transition: REDUCED }
              : { opacity: 0, y: 16, transition: EXIT }
          }
          style={{
            // 16px clear of the agent panel, and never flush against the window
            // when there is no panel beside the stage
            right: "max(var(--stage-right, 0px), 16px)",
            height: "var(--tray-h, min(44dvh, 26rem))",
          }}
          className={cn(
            // the glass classes set their own position and radius and, being
            // declared after the utilities in the same layer, win a tie
            "glass-thick glass-sheen absolute! rounded-[28px]!",
            "pointer-events-auto bottom-4 left-4 z-30 flex flex-col gap-2.5 px-4 pb-3.5 pt-3"
          )}
        >
          <header className="flex h-11 shrink-0 items-center gap-4">
            <div className="min-w-0 flex-1">
              <p className="eyebrow text-accent">Real things</p>
              <div className="mt-1 flex min-w-0 items-baseline gap-3">
                <h2 className="min-w-0 shrink truncate font-display text-[26px] font-medium capitalize leading-none tracking-[0.01em]">
                  {heading}
                </h2>
                <p className="min-w-0 flex-1 truncate text-[13px] leading-none text-muted-foreground">
                  you asked for “{item.request}”
                </p>
              </div>
            </div>

            <div className="flex min-w-0 max-w-[46%] flex-col items-end gap-1.5 text-right">
              {count !== null ? (
                <p className="eyebrow tabular text-foreground">
                  {count} listing{count === 1 ? "" : "s"}
                  {count > 0 ? (
                    <span className="text-muted-foreground">
                      {" "}
                      · from {shops} shop{shops === 1 ? "" : "s"}
                    </span>
                  ) : null}
                </p>
              ) : null}
              {/*
               * THE QUERY, ON SCREEN. This is the string that was sent,
               * character for character — it is how the room context turns
               * into results, and it is what you point at when a judge asks
               * how the search is personalised. Editing the strip changes it.
               */}
              <p
                className="max-w-full truncate font-mono text-[11px] leading-none text-muted-foreground"
                title={query || item.request}
              >
                searching{" "}
                <span className="text-foreground">{query || item.request}</span>
              </p>
            </div>

            {stale ? (
              <button
                type="button"
                onClick={retry}
                className={cn(
                  "h-11 shrink-0 cursor-pointer rounded-full border border-accent bg-surface/70 px-4",
                  "text-[13px] font-medium text-accent transition-colors hover:bg-accent-wash",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                )}
              >
                Search again
              </button>
            ) : null}

            <button
              type="button"
              onClick={closeOptions}
              aria-label="Close the listings"
              title="Close (Esc)"
              className={cn(
                "grid size-11 shrink-0 cursor-pointer place-items-center rounded-full",
                "border border-line bg-surface/80 text-foreground transition-colors",
                "hover:border-accent-pale hover:bg-accent-wash",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              )}
            >
              <X className="size-4" aria-hidden />
            </button>
          </header>

          {roomContext?.source === "fallback" ? (
            <p className="shrink-0 text-[11px] leading-none text-muted-foreground">
              Couldn&rsquo;t read the style — this search is generic.
            </p>
          ) : null}

          {/* the route's own words when it sends them WITH listings: today that
              is only the rehearsal set saying it is frozen, and it must be said */}
          {note && view.options.length > 0 && !waiting ? (
            <p className="shrink-0 font-mono text-[11px] leading-none text-warn">{note}</p>
          ) : null}

          <SourcingResults
            item={view}
            query={query}
            note={note}
            onRetry={retry}
            className="flex-1"
          />
        </motion.section>
      ) : null}
    </AnimatePresence>
  );
}

export default OptionSheet;
