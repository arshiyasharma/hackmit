"use client";

/**
 * /room — this screen is the whole product. It is also the second screen of
 * room III on the landing page, which mounts this same component
 * (components/room3/ProductRoom.tsx), so it navigates through lib/nav.
 *
 * A LAPTOP WORKSPACE, NOT A COLUMN (docs/ROOM3_PRODUCT_SPEC.md, section 1b):
 *
 *   1. the room fills the whole window: the photo, or the AR camera, with the
 *      placed things standing in it
 *   2. everything else is glass floating over it — the room context top-left,
 *      THE AGENT PANEL down the right (the budget, the conversation, what is
 *      placed, the ask), and the listing tray docked along the bottom of what
 *      is left
 *
 * THE FREE AREA IS THE CONTRACT. This file says how much of the window the
 * glass takes — `--stage-right` for the panel, `--stage-bottom` for the tray —
 * and the scene fits the photo into what remains, so the thing being talked
 * about is never underneath the thing talking about it. The tray measures from
 * the same two numbers.
 *
 * THE ROOM IS NEVER COVERED. The panel is a side, the tray is a strip, the
 * context is a row of pills.
 *
 * EXACTLY TWO PERSISTENT READOUTS: the dimension label on the active item
 * (drawn by the scene) and the budget (top of the panel). A third readout is
 * what makes an AR app feel like a dashboard. Anything else is said in the
 * conversation or lives in the tray.
 *
 * Every overlay below takes NO PROPS. They all read `activeItemId` from the
 * store, so there is one answer to "which item is this about" and no chance of
 * two overlays disagreeing.
 */

import * as React from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Camera } from "lucide-react";

import AgentThread from "@/components/AgentThread";
import ArScene from "@/components/ArScene";
import AskInput, { useAsking } from "@/components/AskInput";
import BudgetHud, { useRemoveItem } from "@/components/BudgetHud";
import BudgetPrompt from "@/components/BudgetPrompt";
import ItemsStrip from "@/components/ItemsStrip";
import OptionSheet, { openOptionsFor, useOptionsOpen } from "@/components/OptionSheet";
import {
  OPEN_OPTIONS_EVENT,
  REMOVE_ITEM_EVENT,
} from "@/components/PhotoMode";
import { RoomContextStrip } from "@/components/RoomContextStrip";
import { demoHref } from "@/lib/demo";
import { ENTER, EXIT, REDUCED, STAGGER } from "@/lib/motion";
import { AppLink } from "@/lib/nav";
import { itemById, useRoomContext, useStore } from "@/lib/store";
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

/* ---------------------------------------------------------- the free area */

/*
 * THE FOUR LENGTHS this screen sets on <main>, as classes rather than from a
 * hook, so they are right on the first paint and the scene never starts in the
 * wrong place and glides to the right one:
 *
 *   --panel-w        26.5rem; it narrows with a narrow window, never below desk
 *   --tray-h         min(44dvh, 26rem)
 *   --stage-right    the panel plus its two 16px margins at `desk`, else 0
 *   --stage-bottom   at `desk`, the tray plus its margins while it is open and
 *                    0 while it is not; under `desk`, the bottom chrome
 *
 * Under `desk` the panel drops beneath the room instead of standing beside it,
 * so THERE the bottom chrome is the panel, and `--room-bottom-chrome` — "how
 * much of the bottom edge this screen's own chrome owns" — is restated to be
 * its height. Same structure, different measure.
 */
const STAGE_LENGTHS = cn(
  "[--panel-w:min(26.5rem,38vw)] [--tray-h:min(44dvh,26rem)]",
  "[--stage-right:0px] desk:[--stage-right:calc(var(--panel-w)_+_32px)]",
  "[--stage-bottom:var(--room-bottom-chrome)] desk:[--stage-bottom:0px]",
  "desk:data-[tray=open]:[--stage-bottom:calc(var(--tray-h)_+_32px)]",
  "max-desk:[--room-bottom-chrome:calc(min(52dvh,27rem)_+_16px)]"
);

/** The motion sheet's words for beat 02, set as the two lines they break into. */
const OPENING_LINES = ["One thing", "at a time."];

/* ------------------------------------------------------------------- page */

export default function RoomPage() {
  const items = useStore((s) => s.items);
  const activeItemId = useStore((s) => s.activeItemId);
  const roomImage = useStore((s) => s.roomImage);
  // the model's read of the room, edits included; the panel names the room
  const roomContext = useRoomContext();
  const asking = useAsking();
  // the tray takes the bottom of the free area while it is open, and the scene
  // has to know: that is the whole reason this screen listens to it
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
   * tree as this chrome. This screen owns the listing tray and the remove
   * gesture, so this is where those two announcements are answered.
   *
   * Without this, clicking a sprite does nothing and the relink loop dead-ends
   * at the first click — the item is reachable only from the panel.
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

  // "living room" -> "Living room". Only ever the model's own words.
  const roomType = roomContext?.roomType?.trim() ?? "";
  const roomName = roomType
    ? roomType.charAt(0).toUpperCase() + roomType.slice(1)
    : "";

  const opening = phase === "empty" || (phase === "asking" && items.length === 0);

  return (
    <main
      data-phase={phase}
      data-tray={optionsOpen ? "open" : "closed"}
      className={cn(
        "group/room relative h-dvh w-full overflow-hidden bg-background",
        STAGE_LENGTHS
      )}
    >
      {/* ---------------------------------------------------- 1. the room */}
      {/*
       * ACROSS THE WHOLE WINDOW, under the glass. The scene reads
       * --stage-right / --stage-bottom off <main> and keeps the photo, and the
       * things standing in it, inside what the panel and the tray leave free.
       */}
      <div className="absolute inset-0">
        <ArScene />
      </div>

      {/* --------------------------------------------------- 2. the glass */}

      {/*
       * THE MIDDLE OF THE FREE AREA: the opening line, and the one question
       * asked right after the photo. The outer box is the free area; the inner
       * one restates --stage-right as 0, because inside it the panel is already
       * accounted for and nothing in here should step aside for it twice.
       */}
      <div className="pointer-events-none absolute top-0 left-0 right-[var(--stage-right)] bottom-[var(--stage-bottom)] z-20">
        <div className="group/free relative h-full w-full [--stage-right:0px]">
          {/* the question has the floor while it is up (CSS, because whether it
              is up is the prompt's own business and not in the store) */}
          <div className="absolute inset-0 grid place-items-center px-8 transition-opacity duration-[240ms] group-has-[[role=dialog]]/free:opacity-0">
            <AnimatePresence>
              {opening ? (
                <motion.p
                  key="opening-line"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1, transition: reduced ? REDUCED : ENTER }}
                  exit={{ opacity: 0, transition: reduced ? REDUCED : EXIT }}
                  className={cn(
                    "relative isolate text-center font-display font-light text-foreground",
                    "text-[clamp(2.5rem,5.2vw,4.5rem)] leading-[0.98] tracking-[0.01em]",
                    // A SOFT PAPER HALO, so ink holds over any photograph: a
                    // wide pool of the page's own colour behind the words,
                    // fading out well past them. Light, never a dark scrim.
                    "before:absolute before:-inset-x-[45%] before:-inset-y-[70%] before:-z-10 before:rounded-[50%]",
                    "before:bg-[radial-gradient(closest-side,color-mix(in_srgb,var(--background)_94%,transparent),color-mix(in_srgb,var(--background)_86%,transparent)_58%,transparent)]"
                  )}
                >
                  {/* the motion sheet's headline arrival: each line rises out
                      of its own clip, 80ms apart. The clip has a little room
                      in it, or it would shave Cormorant's descenders. The fade
                      is on the unclipped parent; the lines only travel. */}
                  {OPENING_LINES.map((line, i) => (
                    <span key={line} className="block overflow-hidden py-[0.08em]">
                      <motion.span
                        className="block"
                        initial={reduced ? false : { y: "110%" }}
                        animate={{
                          y: 0,
                          transition: reduced
                            ? REDUCED
                            : { ...ENTER, delay: i * STAGGER.line },
                        }}
                      >
                        {line}
                        {i < OPENING_LINES.length - 1 ? " " : null}
                      </motion.span>
                    </span>
                  ))}
                </motion.p>
              ) : null}
            </AnimatePresence>
          </div>

          {/* asked once, right after the photo: what are you spending? */}
          <BudgetPrompt />
        </div>
      </div>

      {/* top-left of the stage: the room context that explains the results */}
      <div className="pointer-events-none absolute top-0 left-0 right-[var(--stage-right)] z-30">
        {/* inside the landing's room III the account chip stands in this
            corner, and the row steps aside for it; on its own URL the
            variable is unset. Click-through: only the pills take the pointer,
            so the photo around them can still be dragged. */}
        <div
          className="flex w-full max-w-[52rem] flex-col items-start gap-2 pr-4 pt-[max(16px,env(safe-area-inset-top))]"
          style={{ paddingLeft: "calc(16px + var(--room-chip, 0px))" }}
        >
          <RoomContextStrip />

          {/* the photo is where the palette comes from; say so if there isn't one */}
          {roomImage === null ? (
            <AppLink
              href={demoHref("/")}
              className={cn(
                "glass-pill pointer-events-auto inline-flex min-h-11 cursor-pointer items-center gap-2 px-4",
                "text-[14px] text-foreground transition-colors duration-[240ms]",
                "hover:text-accent hover:[background:var(--accent-wash)]",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              )}
            >
              <Camera className="size-4 text-accent" aria-hidden />
              Photograph the room so the colours match
            </AppLink>
          ) : null}
        </div>
      </div>

      {/*
       * THE AGENT PANEL. One pane of thick glass down the right-hand side:
       * who is speaking, the number, the conversation, what is in the room, and
       * the ask pinned to the foot. IT NEVER HIDES at `desk` — not while the
       * tray is open, not while asking — because the tray sits beside it, not
       * under it.
       *
       * In a window too narrow for a side (under `desk`) the same panel lies
       * along the bottom instead, and there it does step out while the tray is
       * open, because there the two want the same strip of screen.
       *
       * Not clipped: the budget's floating "+$49" and its counters hang outside
       * their own box, and a clip here would swallow them. The one part that
       * scrolls clips itself, and the arriving sheen has its own clipped layer.
       */}
      <motion.aside
        aria-label="PIXX-AR"
        initial={reduced ? { opacity: 0 } : { opacity: 0, x: 24 }}
        animate={{ opacity: 1, x: 0, transition: reduced ? REDUCED : ENTER }}
        className={cn(
          // `!`: the glass classes set their own position and radius, later in
          // the same layer, so these two have to insist
          "glass-thick !absolute !rounded-[28px] z-40 flex flex-col",
          "inset-x-2 bottom-2 h-[min(52dvh,27rem)]",
          "desk:inset-x-auto desk:top-4 desk:right-4 desk:bottom-4 desk:h-auto desk:w-[var(--panel-w)]",
          "max-desk:group-data-[tray=open]/room:invisible"
        )}
      >
        {/* one sweep of light across the pane as it arrives */}
        <div
          aria-hidden
          className="glass-sheen pointer-events-none absolute inset-0 rounded-[28px]"
        />

        <header className="shrink-0 px-5 pt-5 pb-3">
          <p className="eyebrow text-accent">PIXX-AR</p>
          {roomName ? (
            <p className="mt-1.5 font-display text-[30px] leading-none font-light tracking-[0.01em] text-foreground max-desk:hidden">
              {roomName}
            </p>
          ) : null}
        </header>

        {/* THE NUMBER: in the flow of the panel, the full width of it. It
            draws the hairline under itself. */}
        <div className="shrink-0 px-5">
          <BudgetHud docked />
        </div>

        {/* the conversation: the part that grows, and the only part that scrolls */}
        <div className="flex min-h-0 flex-1 flex-col">
          <AgentThread />
        </div>

        {/* in the room: one chip per thing placed, and the way to the checkout.
            Nothing placed, nothing rendered, and the box folds away with it. */}
        <div className="shrink-0 border-t border-line px-5 py-3 empty:hidden">
          <ItemsStrip />
        </div>

        {/* the ask, pinned to the foot, under a hairline */}
        <div className="shrink-0 border-t border-line px-5 pt-3.5 pb-5">
          <AskInput />
        </div>
      </motion.aside>

      {/* the listings for the active item: a tray docked under the room, from
          the left edge to --stage-right, so it never runs under the panel */}
      <OptionSheet />
    </main>
  );
}
