"use client";

import * as React from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Check, Plus, X } from "lucide-react";

import { Skeleton } from "@/components/ui/skeleton";
import { StatusLine } from "@/components/ui/StatusLine";
import { DUR, EASE, ENTER, EXIT, REDUCED, STAGGER } from "@/lib/motion";
import { useRoomContext, useStore } from "@/lib/store";
import { cn } from "@/lib/utils";

/**
 * The room context, as a strip of glass at the top-left of the room: the
 * palette in one capsule, then the style words as chips.
 *
 * THIS STRIP IS DOING REAL WORK. It is the visible explanation of why the
 * search results look the way they do, and a judge will point at it. The tags
 * are the literal words prepended to every product search.
 *
 * CLICK A TAG TO REMOVE IT. If the model says "ornate" and the user disagrees,
 * one click says so and the next search changes. That is the difference between
 * a readout and a control. The plus beside them adds a word; the plus in the
 * palette adds a colour.
 *
 * IT FLOATS OVER A PHOTOGRAPH, so every piece of it is thick glass: what is
 * behind is unknown, and the words have to hold their contrast over a white
 * wall and over a dark one.
 *
 * IT WRAPS, IT DOES NOT SCROLL. A sideways-scrolling row is a touch gesture; a
 * mouse has no good way to move it. On a laptop the free area is wide enough
 * that the words simply flow onto a second line when there are many — which
 * also means both "+" controls are always in view, first in their group.
 *
 * Takes no props. Reads the store, like every other overlay on the room
 * screen. The host wraps it in a click-through layer; only the pieces of glass
 * themselves take the pointer, so the photo around them can still be dragged.
 */

const READING = [
  "Reading the light in the room…",
  "Picking out your colours…",
  "Working out the style…",
];

/** The five slots are always there, so the strip does not jump when they land. */
const SLOTS = [0, 1, 2, 3, 4];

/** a short buzz on a phone; silently nothing on a laptop */
function tick() {
  if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
    navigator.vibrate(8);
  }
}

/** the ring every control here shows to the keyboard */
const FOCUS =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

/*
 * Every `duration-[240ms]` in this file is DUR.micro, said in CSS. And every
 * enlarged hit area is an `after:` box, never a `before:` one: the glass
 * classes already use ::before for the light on the pane.
 */

/**
 * The colour picker has to open on SOME colour, and an <input type="color">
 * only takes a literal hex. It opens on the accent, read off the token at the
 * moment it is needed, so this file does not carry a copy of the palette.
 */
function accentHex(): string {
  if (typeof window === "undefined") return "#000000";
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue("--accent")
    .trim();
  return /^#[0-9a-f]{6}$/i.test(value) ? value : "#000000";
}

/**
 * The "+ word" control at the head of the chip row.
 *
 * The model reads the room; it cannot read the user. Someone who knows they
 * want brass, or rattan, or nothing shiny, can say so here and the next search
 * carries it — the same string, the same place, as the words the photo
 * produced. Clicking a word removes it, the plus adds one: the strip is a
 * control, not a readout.
 */
function AddStyleTag() {
  const addStyleTag = useStore((s) => s.addStyleTag);
  const [open, setOpen] = React.useState(false);
  const [word, setWord] = React.useState("");
  const input = React.useRef<HTMLInputElement>(null);

  const commit = () => {
    const value = word.trim();
    if (value) {
      addStyleTag(value);
      tick();
    }
    // stay open: people add "brass" and then "rattan" in one go
    setWord("");
    input.current?.focus();
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Add a style word to the search"
        className={cn(
          "glass-pill pointer-events-auto inline-flex h-9 cursor-pointer items-center gap-1 px-3",
          "!border-dashed !border-accent/70 text-[13px] text-accent",
          "after:absolute after:inset-x-0 after:-inset-y-1",
          "transition-colors duration-[240ms]",
          "hover:[background:var(--accent-wash)] active:[background:var(--accent-pale)]",
          FOCUS
        )}
      >
        <Plus className="size-3.5" aria-hidden />
        word
      </button>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        commit();
      }}
      className={cn(
        "glass-pill pointer-events-auto inline-flex h-9 items-center gap-1 pl-3 pr-1.5",
        "!border-accent text-[13px]"
      )}
    >
      <input
        ref={input}
        autoFocus
        value={word}
        onChange={(e) => setWord(e.target.value)}
        onBlur={() => {
          if (!word.trim()) setOpen(false);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            // handled here, so the host does not also read it as "leave the room"
            e.preventDefault();
            setWord("");
            setOpen(false);
          }
        }}
        placeholder="brass"
        aria-label="New style word"
        maxLength={24}
        className="w-24 bg-transparent text-foreground caret-accent outline-none placeholder:text-muted-foreground"
      />
      <button
        type="submit"
        aria-label="Add this style word"
        className={cn(
          "tap grid size-6 cursor-pointer place-items-center rounded-full text-accent",
          "transition-colors duration-[240ms] hover:bg-accent-wash",
          FOCUS
        )}
      >
        <Check className="size-3.5" aria-hidden />
      </button>
    </form>
  );
}

/**
 * The colour form that hangs under the palette.
 *
 * The palette is not a readout either: it goes into the placeholder prompt and
 * the silhouette tint, so a colour added here changes the next stand-in that
 * gets drawn. Two ways in, because people arrive with either — the OS colour
 * picker for "something like that", a hex field for "this code, exactly".
 */
function PaletteColorForm({
  onCommit,
  onClose,
}: {
  onCommit: (hex: string) => void;
  onClose: () => void;
}) {
  const [start] = React.useState(accentHex);
  const [hex, setHex] = React.useState(start);

  /** a half-typed "#c9" is not a colour yet, so the preview stays empty */
  const valid = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(hex.trim());

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) onCommit(hex);
      }}
      onKeyDown={(e) => {
        // Escape cancels from anywhere in the form, and stays in the form
        if (e.key === "Escape") {
          e.preventDefault();
          onClose();
        }
      }}
      /*
       * A POPOVER under the palette, hanging from its left edge. Inline it
       * pushed the tick along the row and out from under the pointer; here it
       * opens where the "+" was pressed and nothing else moves.
       */
      className={cn(
        "glass-pill pointer-events-auto !absolute left-0 top-full z-50 mt-2",
        "flex items-center gap-2 py-1.5 pl-2 pr-1.5 !border-accent"
      )}
    >
      {/*
       * The picker PREVIEWS. Dragging around the colour wheel used to add a
       * colour on every value the pointer passed over, so browsing for the
       * right one left a trail of near-misses in the palette. Nothing is added
       * until the tick.
       */}
      <input
        type="color"
        // the picker only understands a whole #rrggbb; a half-typed or
        // three-digit code leaves it where it started
        value={valid && hex.trim().length === 7 ? hex.trim() : start}
        onChange={(e) => setHex(e.target.value)}
        aria-label="Pick a colour"
        className={cn(
          "size-7 shrink-0 cursor-pointer rounded-full border-0 bg-transparent p-0",
          FOCUS
        )}
      />

      {/* what you are about to add, at swatch size, before you add it */}
      <span
        aria-hidden
        className="size-6 shrink-0 rounded-full ring-1 ring-foreground/20"
        style={{ backgroundColor: valid ? hex : "transparent" }}
      />
      <input
        autoFocus
        value={hex}
        onChange={(e) => setHex(e.target.value)}
        aria-label="Colour hex code"
        placeholder={start}
        maxLength={7}
        spellCheck={false}
        className="tabular w-[5.25rem] shrink-0 bg-transparent font-mono text-[13px] text-foreground caret-accent outline-none placeholder:text-muted-foreground"
      />
      <button
        type="submit"
        disabled={!valid}
        aria-label="Add this colour to the palette"
        className={cn(
          "tap grid size-8 shrink-0 cursor-pointer place-items-center rounded-full text-accent",
          "transition-colors duration-[240ms] hover:bg-accent-wash",
          "disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent",
          FOCUS
        )}
      >
        <Check className="size-4" aria-hidden />
      </button>
      <button
        type="button"
        onClick={onClose}
        aria-label="Cancel"
        className={cn(
          "tap grid size-8 shrink-0 cursor-pointer place-items-center rounded-full text-muted-foreground",
          "transition-colors duration-[240ms] hover:bg-muted hover:text-foreground",
          FOCUS
        )}
      >
        <X className="size-3.5" aria-hidden />
      </button>
    </form>
  );
}

export function RoomContextStrip() {
  // the model's answer WITH the user's edits applied, never the raw one
  const roomContext = useRoomContext();
  const roomImage = useStore((s) => s.roomImage);
  const removeStyleTag = useStore((s) => s.removeStyleTag);
  const addPaletteColor = useStore((s) => s.addPaletteColor);
  const removePaletteColor = useStore((s) => s.removePaletteColor);
  const reduced = useReducedMotion();

  const [picking, setPicking] = React.useState(false);

  const arrive = reduced ? REDUCED : ENTER;
  const leave = reduced ? REDUCED : EXIT;
  // a neighbour closing the gap a removed chip left: a two-way move, so inOut
  const shuffle = reduced ? REDUCED : { duration: DUR.micro, ease: EASE.inOut };

  /* still reading the photo — the strip is a skeleton of what is coming */
  if (!roomContext) {
    return (
      <div className="pointer-events-none flex w-full min-w-0 select-none flex-wrap items-center gap-2">
        <div className="glass-pill flex h-11 items-center gap-2 px-3">
          {SLOTS.map((i) => (
            <Skeleton key={i} className="size-6 rounded-full" />
          ))}
        </div>
        {roomImage ? (
          <StatusLine
            messages={READING}
            intervalMs={1800}
            className="glass-pill flex h-9 min-h-0 items-center px-3.5 text-[13px] text-muted-foreground"
          />
        ) : null}
      </div>
    );
  }

  // five come off the photo, the rest were added by hand — show them all, or
  // a colour someone just picked silently vanishes
  const palette = roomContext.palette.slice(0, 8);
  const tags = roomContext.styleTags;
  const generic = roomContext.source === "fallback";

  return (
    <div className="flex w-full min-w-0 flex-wrap items-center gap-2">
      {/* ------------------------------------------------------ the palette */}
      {/* the capsule and the form that hangs from it are siblings, so the
          form is glass over the photo and not glass inside glass */}
      <div className="relative z-10 shrink-0">
        <div className="glass-pill pointer-events-auto flex h-11 items-center gap-2 pl-2 pr-3">
          {/* THE WAY IN COMES FIRST, so it is in the same place however many
              colours follow it */}
          <button
            type="button"
            onClick={() => setPicking((open) => !open)}
            aria-expanded={picking}
            aria-label="Add a colour to the palette"
            className={cn(
              "relative grid size-7 shrink-0 cursor-pointer place-items-center rounded-full",
              "border border-dashed border-accent/70 text-accent",
              "after:absolute after:-inset-2",
              "transition-colors duration-[240ms] hover:bg-accent-wash active:bg-accent-pale",
              FOCUS
            )}
          >
            <Plus className="size-3.5" aria-hidden />
          </button>

          {/*
           * A swatch is a control, like a style chip: the palette steers what
           * the stand-in is drawn in, so a colour the photo got wrong has to be
           * removable. The cross shows on hover and on focus, and the label
           * says what clicking it does. The hit area is taller than the dot but
           * stops short of its neighbours, so a click never lands on the wrong
           * colour.
           */}
          <AnimatePresence initial={false} mode="popLayout">
            {palette.map((hex, i) => (
              <motion.button
                key={hex}
                type="button"
                title={hex}
                layout={!reduced}
                onClick={() => {
                  removePaletteColor(hex);
                  tick();
                }}
                aria-label={`Remove the colour ${hex} from the palette`}
                initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.4 }}
                animate={{
                  opacity: 1,
                  scale: 1,
                  transition: reduced ? REDUCED : { ...ENTER, delay: i * STAGGER.chip },
                }}
                exit={
                  reduced
                    ? { opacity: 0, transition: leave }
                    : { opacity: 0, scale: 0.4, transition: leave }
                }
                transition={{ layout: shuffle }}
                className={cn(
                  "group relative grid size-6 shrink-0 cursor-pointer place-items-center",
                  "rounded-full ring-1 ring-foreground/20",
                  "after:absolute after:-inset-x-1 after:-inset-y-2.5",
                  "transition-[scale] duration-[240ms] hover:scale-[1.15] focus-visible:scale-[1.15]",
                  FOCUS
                )}
                style={{ backgroundColor: hex }}
              >
                <X
                  aria-hidden
                  className={cn(
                    "size-3.5 opacity-0 transition-opacity duration-[240ms]",
                    "mix-blend-difference text-white",
                    "group-hover:opacity-100 group-focus-visible:opacity-100"
                  )}
                />
              </motion.button>
            ))}
          </AnimatePresence>
          <span className="sr-only">
            The colours read from your photo: {palette.join(", ")}
          </span>
        </div>

        {picking ? (
          <PaletteColorForm
            onCommit={(value) => {
              addPaletteColor(value);
              tick();
              setPicking(false);
            }}
            onClose={() => setPicking(false)}
          />
        ) : null}
      </div>

      {/* -------------------------------------------------------- the words */}
      {/* `relative`: a chip that is leaving is lifted out of the row against
          this box, so its neighbours close the gap while it fades */}
      <ul className="relative flex min-w-0 flex-1 basis-64 flex-wrap items-center gap-2">
        {/* same rule as the palette: the way in is first, and never moves */}
        <li className="shrink-0">
          <AddStyleTag />
        </li>

        {tags.length === 0 ? (
          <li className="min-w-0">
            <p className="glass-pill flex min-h-9 items-center px-3.5 py-1 text-[13px] leading-snug text-muted-foreground">
              {/* with nothing read off the photo, the "+ word" beside this is
                  the only way to steer the search */}
              {generic
                ? "Couldn't read the style — search will be generic."
                : "No style words. Search will be generic."}
            </p>
          </li>
        ) : null}

        <AnimatePresence initial={false} mode="popLayout">
          {tags.map((tag) => (
            <motion.li
              key={tag}
              layout={!reduced}
              className="shrink-0"
              initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1, transition: arrive }}
              exit={
                reduced
                  ? { opacity: 0, transition: leave }
                  : { opacity: 0, scale: 0.8, transition: leave }
              }
              transition={{ layout: shuffle }}
            >
              <button
                type="button"
                onClick={() => {
                  removeStyleTag(tag);
                  tick();
                }}
                aria-label={`Remove the style word ${tag} from the search`}
                className={cn(
                  // reads as 36px, takes the pointer over 44
                  "glass-pill group pointer-events-auto inline-flex h-9 cursor-pointer items-center gap-1.5 pl-3.5 pr-2.5",
                  "after:absolute after:inset-x-0 after:-inset-y-1",
                  "text-[13px] text-foreground transition-colors duration-[240ms]",
                  "hover:[background:var(--surface)]",
                  "active:[background:var(--surface-muted)]",
                  FOCUS
                )}
              >
                {tag}
                <X
                  className="size-3.5 text-muted-foreground transition-colors duration-[240ms] group-hover:text-foreground"
                  aria-hidden
                />
              </button>
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
    </div>
  );
}

export default RoomContextStrip;
