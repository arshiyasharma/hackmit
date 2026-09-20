"use client";

import * as React from "react";
import { ImageIcon, PenLine } from "lucide-react";

import {
  canChooseSpriteSource,
  itemById,
  spriteSourceFor,
  useStore,
} from "@/lib/store";
import { cn } from "@/lib/utils";

/**
 * Which picture this sprite wears: the shop's photograph, or the drawing.
 *
 * Linking a listing swaps the generated stand-in for the listing's own photo,
 * because a real product beats a drawing of one. That holds right up until the
 * photo will not key — and then what stands in the room is a whole rectangular
 * picture, white corners, watermark and all, rather than the object. The room
 * guesses well enough from whether the background actually came off, but it is
 * a guess about taste, and the person looking at their own living room is
 * better placed to make it than we are. So the guess is a default and this is
 * the way to overrule it.
 *
 * NOTHING RENDERS UNLESS BOTH PICTURES EXIST. For most of an item's life only
 * one does — the drawing arrives seconds after the ask, the photo only once a
 * listing has been linked and keyed — and a toggle with one option is
 * furniture, sitting on a sprite small enough that every pixel beside it is
 * doing real work.
 *
 * Takes the item's id and nothing else, and reads the rest from the store, so
 * it can be dropped beside a sprite in photo mode or anywhere else without a
 * prop chain following it in.
 */

export type SpriteSourceToggleProps = {
  itemId: string;
};

export function SpriteSourceToggle({ itemId }: SpriteSourceToggleProps) {
  const item = useStore((s) => itemById(s.items, itemId));
  const toggleSpriteSource = useStore((s) => s.toggleSpriteSource);

  if (!item || !canChooseSpriteSource(item)) return null;

  const source = spriteSourceFor(item);
  const shop = item.linkedProduct?.retailer ?? "the shop";

  const choose = (wanted: "photo" | "drawing") => {
    if (wanted === source) return;
    toggleSpriteSource(itemId);
    if (
      typeof navigator !== "undefined" &&
      typeof navigator.vibrate === "function"
    ) {
      navigator.vibrate(8);
    }
  };

  /*
   * Both options on screen at once rather than one button that swaps what it
   * shows. On a touch screen there is no hover to explain a lone icon, and the
   * question being asked here — which of these two am I looking at — is
   * answered by seeing them side by side and by which one is lit.
   */
  const segment = (kind: "photo" | "drawing") =>
    cn(
      "tap grid size-7 shrink-0 place-items-center rounded-full",
      "transition-colors",
      source === kind
        ? "bg-accent/15 text-accent"
        : "text-muted-foreground hover:bg-muted active:bg-muted"
    );

  return (
    <div
      className={cn(
        "pointer-events-auto inline-flex h-8 items-center gap-0.5 rounded-full",
        "border border-line bg-surface/85 px-0.5 backdrop-blur-sm"
      )}
    >
      <button
        type="button"
        onClick={() => choose("photo")}
        aria-pressed={source === "photo"}
        aria-label={`Show ${shop}'s own photo`}
        title={`${shop}'s own photo`}
        className={segment("photo")}
      >
        <ImageIcon className="size-3.5" aria-hidden />
      </button>
      <button
        type="button"
        onClick={() => choose("drawing")}
        aria-pressed={source === "drawing"}
        aria-label="Show the drawing instead of the photo"
        title="The drawing"
        className={segment("drawing")}
      >
        <PenLine className="size-3.5" aria-hidden />
      </button>

      {/*
       * The lit segment is a colour difference, and a colour difference is not
       * a thing a screen reader can read out. This says the same in words.
       */}
      <span className="sr-only">
        {source === "photo"
          ? `Showing ${shop}'s own photo of this.`
          : "Showing the drawing of this."}
      </span>
    </div>
  );
}

export default SpriteSourceToggle;
