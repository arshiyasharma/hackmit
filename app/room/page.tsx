"use client";

/**
 * /room — this screen is the whole product.
 *
 * THREE LAYERS, OVERLAID, NEVER STACKED:
 *   1. the room: the AR camera, or the captured photo in photo mode
 *   2. the placed items, as sprites standing in that room
 *   3. the chrome: room context top-left, budget top-right, the ask at the
 *      bottom, the items strip above it, the option sheet when it is open
 *
 * THE ROOM IS NEVER FULLY COVERED. Every overlay here is a strip or a pill,
 * and the option sheet rests at 40%.
 *
 * EXACTLY TWO PERSISTENT READOUTS: the dimension label on the active item
 * (drawn by the scene) and the budget (top right). A third readout is what
 * makes an AR app feel like a dashboard. Anything else goes in the sheet.
 *
 * Every overlay below takes NO PROPS. They all read `activeItemId` from the
 * store, so there is one answer to "which item is this about" and no chance of
 * two overlays disagreeing.
 */

import * as React from "react";
import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Camera } from "lucide-react";

import ArScene from "@/components/ArScene";
import AskInput, { useAsking } from "@/components/AskInput";
import BudgetHud, { useRemoveItem } from "@/components/BudgetHud";
import ItemsStrip from "@/components/ItemsStrip";
import OptionSheet, { openOptionsFor, useOptionsOpen } from "@/components/OptionSheet";
import {
  OPEN_OPTIONS_EVENT,
  REMOVE_ITEM_EVENT,
} from "@/components/PhotoMode";
import { RoomContextStrip } from "@/components/RoomContextStrip";
import { StatusLine } from "@/components/ui/StatusLine";
import { demoHref } from "@/lib/demo";
import { itemById, searchQuery, useStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import type { PlacedItem, RoomPhase } from "@/types";

/* ---------------------------------------------------------- state machine */

/**
 * empty -> asking -> generating -> placing -> linked -> (asking again)
 *
 * Written out rather than left to emerge, because "which item is the chrome
 * about, and what is it doing" is the ambiguity that eats an evening. The
 * subject is always `activeItemId`; this names what that subject is doing.
 *
 *   empty       nothing has been asked for yet
 *   asking      the ask field is open and waiting for words
 *   generating  the item exists; its stand-in or its options are still in flight
 *   placing     both jobs have landed; it is not standing anywhere yet, or it
 *               is standing there with nothing linked to it
 *   linked      a real listing is attached, and the sprite is its real size
 */
export function derivePhase(
  items: PlacedItem[],
  active: PlacedItem | null,
  asking: boolean
): RoomPhase {
  // the open field wins: the user is typing, whatever else is on screen
  if (asking) return "asking";
  if (items.length === 0) return "empty";
  if (!active) return "placing";
  if (
    active.placeholderStatus === "pending" ||
    active.optionsStatus === "pending"
  ) {
    return "generating";
  }
  if (active.linkedProduct) return "linked";
  return "placing";
}

/* ------------------------------------------------------------------- page */

export default function RoomPage() {
  const items = useStore((s) => s.items);
  const activeItemId = useStore((s) => s.activeItemId);
  const roomImage = useStore((s) => s.roomImage);
  const roomContext = useStore((s) => s.roomContext);
  const asking = useAsking();
  // the sheet rests at 40% and the bottom chrome lives in that same 40%, so
  // while it is up the strip and the ask step out of the way rather than
  // sitting behind it
  const optionsOpen = useOptionsOpen();
  const reduced = useReducedMotion();

  const active = React.useMemo(
    () => itemById(items, activeItemId),
    [items, activeItemId]
  );

  const phase = derivePhase(items, active, asking);

  /*
   * THE SPRITE'S OWN GESTURES LAND HERE.
   *
   * Both scenes — the WebXR one and the photo one — say what the user did to a
   * sprite on `window` rather than taking a callback prop, because neither
   * takes props and in a live session the canvas is not even in the same DOM
   * tree as this chrome. This screen owns the option sheet and the remove
   * gesture, so this is where those two announcements are answered.
   *
   * Without this, tapping a sprite does nothing and the relink loop dead-ends
   * at the first tap — the item is reachable only from the bottom strip.
   */
  const removeItem = useRemoveItem();
  React.useEffect(() => {
    const itemIdOf = (event: Event): string | null => {
      const detail = (event as CustomEvent<{ itemId?: unknown }>).detail;
      return typeof detail?.itemId === "string" ? detail.itemId : null;
    };
    const onOpen = (event: Event) => {
      const id = itemIdOf(event);
      if (id) openOptionsFor(id);
    };
    const onRemove = (event: Event) => {
      const id = itemIdOf(event);
      if (id) removeItem(id);
    };
    window.addEventListener(OPEN_OPTIONS_EVENT, onOpen);
    window.addEventListener(REMOVE_ITEM_EVENT, onRemove);
    return () => {
      window.removeEventListener(OPEN_OPTIONS_EVENT, onOpen);
      window.removeEventListener(REMOVE_ITEM_EVENT, onRemove);
    };
  }, [removeItem]);

  /* what the wait is called, in the user's own words rather than a spinner */
  const waitMessages = React.useMemo(() => {
    if (!active) return [];
    const out: string[] = [];
    if (active.placeholderStatus === "pending") {
      out.push(`Sketching ${article(active.category)} in your room's colours…`);
    }
    if (active.optionsStatus === "pending") {
      const query = searchQuery(roomContext, active.request);
      out.push(`Searching for ${query || active.request}…`);
      out.push("Reading dimensions off the listings…");
    }
    return out;
  }, [active, roomContext]);

  const fade = reduced ? { duration: 0.15 } : { duration: 0.3 };

  return (
    <main
      data-phase={phase}
      className="relative flex h-dvh w-full justify-center overflow-hidden bg-background"
    >
      {/*
       * ONE STAGE. The room and every piece of chrome share this box, so the
       * photo, the strip, the budget and the ask are all measured against the
       * same edges. Before this the scene filled the window while the chrome
       * sat in a centred max-w-md column, and on a desktop they simply could
       * not line up: the "Placed to scale" pill, the scale controls and the AR
       * notice landed against the window while the strip and the ask landed
       * against the column, and the two collided on top of each other.
       */}
      <div className="relative h-full w-full max-w-md overflow-hidden">
        {/* ------------------------------------------------ 1 + 2. the room */}
        <div className="absolute inset-0">
          <ArScene />
        </div>

      {/* --------------------------------------------------- 3. the chrome */}

      {/* top: the room context that explains the results, and the budget */}
      {/* BudgetHud positions ITSELF: fixed, top-right of this same max-w-md
          column, inside the safe area, capped at 40% of it, with its own
          `relative` box for the floating deltas. Wrapping it in another
          positioned bar does nothing to a fixed element except steal width
          from the strip beside it, so it is rendered as a sibling and the
          strip gets the whole column to cap itself against. */}
      <BudgetHud />

      <div className="pointer-events-none absolute inset-x-0 top-0 z-20">
        <div className="gutter mx-auto flex w-full max-w-md items-start pt-[max(12px,env(safe-area-inset-top))]">
          {/* the strip caps itself at 58% so the budget keeps the top-right
              corner; do not add padding here or the chips stack vertically */}
          <div className="pointer-events-auto min-w-0 flex-1">
            <RoomContextStrip />
          </div>
        </div>

        {/* the photo is where the palette comes from; say so if there isn't one */}
        {roomImage === null ? (
          <div className="gutter mx-auto mt-2 w-full max-w-md">
            <Link
              href={demoHref("/")}
              className={cn(
                "pointer-events-auto inline-flex min-h-11 items-center gap-2 rounded-full",
                "border border-line bg-background/85 px-3 text-[13px] backdrop-blur-md"
              )}
            >
              <Camera className="size-4 text-accent" aria-hidden />
              Photograph the room so the colours match
            </Link>
          </div>
        ) : null}
      </div>

      {/* the middle, before anything has been asked for */}
      <AnimatePresence>
        {phase === "empty" || (phase === "asking" && items.length === 0) ? (
          <motion.p
            key="opening-line"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={fade}
            className={cn(
              "pointer-events-none absolute inset-x-0 top-1/2 z-10 -translate-y-1/2",
              "gutter font-display mx-auto w-full max-w-md text-center text-2xl",
              "text-foreground drop-shadow-[0_1px_12px_rgb(0_0_0/0.45)]"
            )}
          >
            What does this room need?
          </motion.p>
        ) : null}
      </AnimatePresence>

      {/* bottom: the wait, what is placed, and the ask */}
      <AnimatePresence>
        {optionsOpen ? null : (
          <motion.div
            key="bottom-chrome"
            initial={{ opacity: 0, y: reduced ? 0 : 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: reduced ? 0 : 16 }}
            transition={fade}
            className="pointer-events-none absolute inset-x-0 bottom-0 z-20"
          >
            <div className="gutter mx-auto flex w-full max-w-md flex-col gap-2 pb-[max(12px,env(safe-area-inset-bottom))]">
              <AnimatePresence>
                {phase === "generating" && waitMessages.length > 0 ? (
                  <motion.div
                    key="wait"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={fade}
                    className="pointer-events-none"
                  >
                    <StatusLine
                      messages={waitMessages}
                      intervalMs={2400}
                      className={cn(
                        "w-fit rounded-full bg-background/80 px-3 py-1",
                        "text-[12px] text-muted-foreground backdrop-blur-md"
                      )}
                    />
                  </motion.div>
                ) : null}
              </AnimatePresence>

              <ItemsStrip />
              <AskInput />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

        {/* the options for the active item, resting at 40% so the sprite shows */}
        <OptionSheet />
      </div>
    </main>
  );
}

/* ------------------------------------------------------------------ words */

/** "floor lamp" -> "a floor lamp"; "armchair" -> "an armchair". */
function article(category: string): string {
  const word = category.trim();
  if (!word) return "a stand-in";
  if (/^(?:a|an|the)\s/i.test(word)) return word;
  return `${/^[aeiou]/i.test(word) ? "an" : "a"} ${word}`;
}
