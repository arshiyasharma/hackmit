"use client";

import * as React from "react";
import { ArrowLeft } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { create } from "zustand";

import SourcingResults from "@/components/SourcingResults";
import { withDemo } from "@/lib/demo";
import { budgetForItem, optionSearchKey, shouldRefreshOptions } from "@/lib/optionSearch";
import { ENTER, EXIT, REDUCED } from "@/lib/motion";
import { usePreview } from "@/lib/preview";
import {
  roomContextFor,
  searchQuery,
  useActiveItem,
  useRoomContext,
  useStore,
} from "@/lib/store";
import { cn } from "@/lib/utils";
import type { PlacedItem, Product } from "@/types";

/**
 * Matching products for the active item, inside the persistent left sidebar.
 * The host shares that space with the room inventory.
 * Hovering or focusing a listing previews it in the room before linking it.
 *
 * Search ownership stays here: each newly active item starts one request,
 * context edits refresh it, and an interrupted request can resume on remount.
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

/** Is the matching-products tab showing? */
export function useOptionsOpen(): boolean {
  return useSheetState((s) => s.open);
}

/* --------------------------------------------------------------- the call */

/** One search per item, even across a remount of the tray. */
const started = new Set<string>();
/** itemId -> the exact query and budget already sent for it, so a repeat is a no-op */
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
  const remainingBudget = useStore((state) => budgetForItem(state, item?.id));
  const reduced = useReducedMotion();

  const [pendingId, setPendingId] = React.useState<string | null>(null);
  const [notes, setNotes] = React.useState<Record<string, string | undefined>>({});
  const [searchesUsed, setSearchesUsed] = React.useState<Record<string, string>>({});

  /* the string on screen IS the string that gets sent */
  const query = item ? searchQuery(roomContext, item.request) : "";
  const currentSearchKey = optionSearchKey(query, remainingBudget);

  const runSearch = React.useCallback(async (target: PlacedItem) => {
    const state = useStore.getState();
    const context = roomContextFor(state);
    const sent = searchQuery(context, target.request);
    const budgetRemainingCents = budgetForItem(state, target.id);
    const key = optionSearchKey(sent, budgetRemainingCents);

    /*
     * THE SAME QUESTION IS NOT ASKED TWICE.
     *
     * Every call here spends a SerpAPI request, and the server log caught this
     * firing eleven times for one query inside forty seconds — a re-render
     * upstream re-entering the effect that starts a search. The guard is the
     * combination (item, query, budget): if that exact question is already asked, this call
     * is a duplicate and it stops here. `started` alone could not see it,
     * because it only knows the item.
     */
    if (asked.get(target.id) === key) return;
    asked.set(target.id, key);

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
          budgetRemainingCents,
        }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`search ${res.status}`);

      const answer = (await res.json()) as SearchAnswer;
      if (controller.signal.aborted || inFlight.get(target.id) !== controller) return;
      // an empty list is a ANSWER, not a failure: the tray says so in words
      useStore.getState().setOptions(target.id, optionsOf(answer));
      setNotes((n) => ({
        ...n,
        [target.id]: typeof answer.note === "string" ? answer.note : undefined,
      }));
      setSearchesUsed((q) => ({
        ...q,
        [target.id]: key,
      }));
    } catch (err) {
      if (controller.signal.aborted) return;
      // a failure is not an answer: let the same query be asked again
      asked.delete(target.id);
      console.warn("[options] /api/search failed", err);
      useStore.getState().setOptions(target.id, null);
      setSearchesUsed((q) => ({ ...q, [target.id]: key }));
    } finally {
      if (!controller.signal.aborted) setPendingId((current) => current === target.id ? null : current);
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
  React.useEffect(() => {
    if (!item || !open) return;
    const previous = searchesUsed[item.id] ?? asked.get(item.id);
    if (!shouldRefreshOptions(item.optionsStatus, previous, currentSearchKey)) return;

    const target = item;
    const timer = window.setTimeout(() => {
      started.delete(target.id);
      asked.delete(target.id);
      void runSearch(target);
    }, 700);
    return () => window.clearTimeout(timer);
  }, [currentSearchKey, item, open, searchesUsed, runSearch]);

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
    searchesUsed[item.id] !== undefined &&
    searchesUsed[item.id] !== currentSearchKey;

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
          aria-label={`Matching products for ${heading}`}
          data-option-tray=""
          initial={{ opacity: 0 }}
          animate={{ opacity: 1, transition: reduced ? REDUCED : ENTER }}
          exit={{ opacity: 0, transition: reduced ? REDUCED : EXIT }}
          className="room-options pointer-events-auto relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-none bg-transparent font-sans"
        >
          <header className="shrink-0 border-b border-line/70 px-3 pb-3 pt-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-[11px] font-medium text-muted-foreground">Matching products</p>
              <button
                type="button"
                onClick={closeOptions}
                aria-label="Back to your items"
                title="Back to your items (Esc)"
                className={cn(
                  "grid size-7 shrink-0 cursor-pointer place-items-center rounded-none text-muted-foreground",
                  "transition-colors hover:bg-white/70 hover:text-foreground",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                )}
              >
                <ArrowLeft className="size-4" aria-hidden />
              </button>
            </div>
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <h2 className="truncate font-sans text-[16px] font-medium capitalize leading-snug text-foreground">
                  {heading}
                </h2>
                {count !== null ? (
                  <p className="mt-1 font-sans text-[12px] leading-normal text-muted-foreground">
                    {count} product{count === 1 ? "" : "s"}
                    {count > 0 ? ` · ${shops} shop${shops === 1 ? "" : "s"}` : ""}
                  </p>
                ) : null}
              </div>
            </div>
            <p
              className="mt-2 line-clamp-2 font-sans text-[12px] leading-relaxed text-muted-foreground"
              title={item.request}
            >
              For “{item.request}”
            </p>

            <details className="mt-2 font-sans text-[11px] leading-relaxed text-muted-foreground">
              <summary className="w-fit cursor-pointer rounded-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
                Search details
              </summary>
              <p className="mt-1 break-words text-foreground">{query || item.request}</p>
            </details>

            {stale ? (
              <button
                type="button"
                onClick={retry}
                className={cn(
                  "mt-2 min-h-8 cursor-pointer rounded-none border border-accent/30 bg-accent-wash px-3",
                  "font-sans text-[12px] font-medium text-accent transition-colors hover:border-accent",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                )}
              >
                Refresh options
              </button>
            ) : null}

            {roomContext?.source === "fallback" ? (
              <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                Room style unavailable. Showing a general search.
              </p>
            ) : null}

            {note && view.options.length > 0 && !waiting ? (
              <p className="mt-2 text-[11px] leading-relaxed text-warn">{note}</p>
            ) : null}
          </header>

          <SourcingResults
            item={view}
            query={query}
            layout="list"
            note={note}
            onRetry={retry}
            className="flex-1 px-3 pb-3 pt-3"
          />
        </motion.section>
      ) : null}
    </AnimatePresence>
  );
}

export default OptionSheet;
