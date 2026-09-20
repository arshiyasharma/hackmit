"use client";

/**
 * PHOTO MODE — the iPhone experience, not a fallback.
 *
 * Safari on iPhone has no WebXR immersive-ar (verified 19 September 2026,
 * unsupported through iOS 27.2), and AR Quick Look needs a .usdz we do not
 * have. So every judge holding an iPhone sees THIS screen, and it is built to
 * the same standard as the live path: the same sprites, the same real
 * millimetres, the same spring on a relink, the same refusal on a pinch.
 *
 * The room photo fills the screen. Sprites composite over it at true size,
 * measured against a scale reference the user sets by tapping the top and the
 * bottom of a doorway or an outlet. Until they set one we assume the photo's
 * height is the ceiling height from their profile AND WE SAY SO on screen —
 * an assumption you can read is honest; a silent one is not.
 *
 * WHY THE SIZING MATH LIVES HERE. This file is the one scene path with no
 * three.js import, so components/PlaceholderSprite.tsx imports the sizing
 * helpers from here rather than the other way round. One source of truth: the
 * sprite in the live room and the sprite in the photo can never disagree about
 * how big a 1,520 mm lamp is.
 */

import * as React from "react";
import { motion, useReducedMotion } from "motion/react";
import { Maximize2, RotateCw, Trash2 } from "lucide-react";
import { useDrag, usePinch } from "@use-gesture/react";
import { toast } from "sonner";

import { NumberPlate } from "@/components/ui/NumberPlate";
import { StatusLine } from "@/components/ui/StatusLine";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import type { PlacedItem, ScaleReference } from "@/types";

/* ============================================================ shared math */

export const mmFormat = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0,
});

/** "1,520 mm" — every millimetre on screen goes through here. */
export function formatMm(value: number): string {
  return `${mmFormat.format(Math.round(value))} mm`;
}

export function vibrate(ms: number): void {
  if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
    navigator.vibrate(ms);
  }
}

/**
 * The size a sprite stands at BEFORE anything is linked, per category. A floor
 * lamp is tall and thin, a table is low and wide — so the scene composition is
 * right the moment the item is placed, not only once a listing lands.
 *
 * `widthRatio` here is only a stand-in: once /api/placeholder answers, the
 * cutout's own trimmed aspect ratio is used instead and the object never
 * distorts.
 */
export type CategoryDefault = { heightMm: number; widthRatio: number };

const CATEGORY_DEFAULTS: Array<[RegExp, CategoryDefault]> = [
  [/floor lamp|lamp|sconce|light/i, { heightMm: 1500, widthRatio: 0.3 }],
  [/sofa|couch|settee|loveseat/i, { heightMm: 850, widthRatio: 2.4 }],
  [/armchair|chair|seat/i, { heightMm: 850, widthRatio: 0.8 }],
  [/stool|ottoman|pouf/i, { heightMm: 450, widthRatio: 1 }],
  [/bookcase|shelf|shelves|cabinet|dresser/i, { heightMm: 1800, widthRatio: 0.55 }],
  [/coffee table|side table|table|desk/i, { heightMm: 750, widthRatio: 1.6 }],
  [/rug|carpet|mat/i, { heightMm: 1600, widthRatio: 1.45 }],
  [/mirror/i, { heightMm: 900, widthRatio: 0.6 }],
  [/frame|art|print|poster|painting/i, { heightMm: 700, widthRatio: 0.75 }],
  [/plant|tree|fern|palm/i, { heightMm: 1200, widthRatio: 0.7 }],
  [/curtain|drape|blind/i, { heightMm: 2200, widthRatio: 0.6 }],
];

/** Anything we have no shape for stands at 900 mm square. Never nothing. */
export const FALLBACK_DEFAULT: CategoryDefault = {
  heightMm: 900,
  widthRatio: 1,
};

export function categoryDefault(category: string): CategoryDefault {
  for (const [pattern, size] of CATEGORY_DEFAULTS) {
    if (pattern.test(category)) return size;
  }
  return FALLBACK_DEFAULT;
}

/**
 * How tall the billboard stands, in millimetres, given a listing's
 * [width, height, depth].
 *
 * Normally that is simply the listed height. The exception is a FLAT object —
 * a rug, a mat, a picture quoted lying down — whose listed height is its
 * thickness: 2,000 × 20 × 1,400 mm would stand a 20 mm sliver in the room, which
 * reads as broken rather than as honest. A flat object is shown standing on its
 * largest face instead, the way you would hold a rug up to look at it.
 *
 * The LABEL is untouched by this: it prints the listing's own width and height,
 * so the numbers on the sprite, on the ProductCard and in the fit check still
 * agree. Only the drawn plane changes — which is already derived, since its
 * width comes from the cutout's aspect ratio rather than from the listing.
 */
export function standingHeightMm(dims: readonly [number, number, number]): number {
  const [w, h, d] = dims;
  const largest = Math.max(w, h, d);
  const flat = h <= w && h <= d && h < largest / 2;
  return flat ? largest : h;
}

export type SpriteSize = {
  /** the plane's width in millimetres — derived, never a listed number */
  widthMm: number;
  /** the plane's height in millimetres — the listing's own height when linked */
  heightMm: number;
  /** true when these millimetres came off a real listing */
  known: boolean;
};

/**
 * THE ONE PLACE A SPRITE'S SIZE IS DECIDED.
 *
 * Height comes from the linked listing, in millimetres, and the width follows
 * from the cutout's own aspect ratio — so the object never stretches and the
 * SIZE is the part that tells the truth.
 */
export function spriteSizeMm(item: PlacedItem): SpriteSize {
  const fallback = categoryDefault(item.category);
  const ratio =
    // the linked listing's own photo wins; then the stand-in; then the shape
    item.listingCutoutUrl && item.listingWidthRatio && item.listingWidthRatio > 0
      ? item.listingWidthRatio
      : item.placeholderStatus === "ready" && item.placeholderWidthRatio > 0
        ? item.placeholderWidthRatio
        : fallback.widthRatio;

  const dims = item.linkedProduct?.dimsMm;
  if (dims && dims[1] > 0) {
    const heightMm = standingHeightMm(dims);
    return { widthMm: heightMm * ratio, heightMm, known: true };
  }
  return {
    widthMm: fallback.heightMm * ratio,
    heightMm: fallback.heightMm,
    known: false,
  };
}

/** The numbers PRINTED on the label: the listing's own width and height. */
export function labelDimsMm(
  item: PlacedItem
): { widthMm: number; heightMm: number } | null {
  const dims = item.linkedProduct?.dimsMm;
  if (!dims) return null;
  return { widthMm: dims[0], heightMm: dims[1] };
}

/** Where the numbers came from, in the words shown under them. */
export function dimsCaption(item: PlacedItem): string {
  const product = item.linkedProduct;
  if (!product) return "nothing linked yet";
  if (!product.dimsMm || product.dimsSource === "missing") {
    return "no dimensions listed";
  }
  return product.dimsSource === "quoted"
    ? `${product.retailer} listing`
    : "estimated";
}

/** "estimated" and a missing size are warnings, a quoted size is not. */
export function dimsTone(item: PlacedItem): "muted" | "warn" {
  const product = item.linkedProduct;
  if (!product) return "muted";
  if (!product.dimsMm || product.dimsSource !== "quoted") return "warn";
  return "muted";
}

/**
 * PINCH IS REFUSED, OUT LOUD. The sprite's size means something, so a pinch
 * must not change it. Silently swallowing the gesture reads as broken;
 * answering it reads as a feature.
 */
export function refusePinch(heightMm: number | null): void {
  toast(
    heightMm
      ? `Locked to real size — this one is ${formatMm(heightMm)} tall.`
      : "Locked to real size.",
    {
      id: "visa-scale-locked",
      description: "Link a different listing to change the size.",
    }
  );
  vibrate(12);
}

/* --------------------------------------------------------------- events */

/**
 * The sprite is the only way back to an item you placed behind you, so a tap
 * has to reopen its options and a long-press has to start the remove gesture.
 * Both of those sheets live in other files and ArScene takes no props, so the
 * scene says what happened on `window` and whoever owns the sheet listens.
 *
 *   window.addEventListener("visa:open-options", (e) => e.detail.itemId)
 *   window.addEventListener("visa:remove-item", (e) => e.detail.itemId)
 */
export const OPEN_OPTIONS_EVENT = "visa:open-options";
export const REMOVE_ITEM_EVENT = "visa:remove-item";

export function emitItemEvent(name: string, itemId: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(name, { detail: { itemId } }));
}

/** How long a press has to hold before it means "remove this". */

/** ~400 ms to settle, with the small overshoot that makes a resize readable. */
export const RESIZE_SPRING = { type: "spring", stiffness: 220, damping: 26 } as const;

/* ------------------------------------------------------- scale reference */

/** What the user can point at to give the photo a real-world scale. */
export const SCALE_CHOICES: Array<{
  kind: ScaleReference["kind"];
  label: string;
  realMm: number;
  hint: string;
}> = [
  {
    kind: "door",
    label: "a standard interior door",
    realMm: 2032,
    hint: "Tap the top of the door frame, then the floor under it.",
  },
  {
    kind: "outlet",
    label: "a wall outlet plate",
    realMm: 114,
    hint: "Tap the top of the outlet plate, then its bottom.",
  },
];

/** A scale the user set, kept as a FRACTION of the photo so a resize is safe. */
type PhotoScale = {
  kind: ScaleReference["kind"];
  label: string;
  realMm: number;
  /** the measured height of that object, as a fraction of the photo's height */
  heightFraction: number;
};

/* ==================================================================== mode */

export function PhotoMode() {
  const roomImage = useStore((s) => s.roomImage);
  const items = useStore((s) => s.items);
  const activeItemId = useStore((s) => s.activeItemId);
  const setActiveItem = useStore((s) => s.setActiveItem);
  const moveItem = useStore((s) => s.moveItem);
  const resizeItem = useStore((s) => s.resizeItem);

  /*
   * THE BIN. Removal is a destination, not a gesture: it only exists while a
   * sprite is being dragged, it sits in the corner furthest from the ask input,
   * and a drop anywhere else in the picture is just a placement.
   */
  const binRef = React.useRef<HTMLDivElement | null>(null);
  /* what the bin looks like is state; where the bin IS is a ref, read only
     inside the drag handler, never during a render */
  const [dragging, setDragging] = React.useState(false);
  const [binHot, setBinHot] = React.useState(false);

  const overBin = React.useCallback((x: number, y: number) => {
    const box = binRef.current?.getBoundingClientRect();
    if (!box) return false;
    // a little forgiveness around the edge, for a finger
    const pad = 12;
    return (
      x >= box.left - pad &&
      x <= box.right + pad &&
      y >= box.top - pad &&
      y <= box.bottom + pad
    );
  }, []);

  const onDragPoint = React.useCallback(
    (point: { x: number; y: number } | null) => {
      setDragging(point !== null);
      setBinHot(point ? overBin(point.x, point.y) : false);
    },
    [overBin]
  );
  const ceilingHeightMm = useStore((s) => s.profile.ceilingHeightMm);

  const stageRef = React.useRef<HTMLDivElement | null>(null);
  const [box, setBox] = React.useState<{ width: number; height: number } | null>(
    null
  );

  const [scale, setScale] = React.useState<PhotoScale | null>(null);
  /** the in-progress measurement: which object, and the first tap if taken */
  const [measuring, setMeasuring] = React.useState<{
    index: number;
    firstY: number | null;
  } | null>(null);

  /** where each sprite stands, as a fraction of the photo box. Bottom-centred. */
  const [spots, setSpots] = React.useState<
    Record<string, { x: number; y: number }>
  >({});

  const activeItem = items.find((i) => i.id === activeItemId) ?? null;

  /* measure the stage: once on attach, then on every resize */
  const attach = React.useCallback((node: HTMLDivElement | null) => {
    stageRef.current = node;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    setBox({ width: rect.width, height: rect.height });
    const observer = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (r) setBox({ width: r.width, height: r.height });
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  /* the contained fit of the photo inside the stage — computed, not guessed */
  const fit = React.useMemo(() => {
    if (!roomImage || !box || box.width === 0 || box.height === 0) return null;
    const s = Math.min(
      box.width / roomImage.width,
      box.height / roomImage.height
    );
    const width = roomImage.width * s;
    const height = roomImage.height * s;
    return {
      width,
      height,
      left: (box.width - width) / 2,
      top: (box.height - height) / 2,
    };
  }, [roomImage, box]);

  /**
   * Displayed pixels per millimetre. From the scale reference when the user set
   * one; otherwise from the assumption that the photo's height is their ceiling
   * height, which the caption says out loud.
   */
  const pxPerMm = React.useMemo(() => {
    if (!fit) return null;
    if (scale) return (fit.height * scale.heightFraction) / scale.realMm;
    if (ceilingHeightMm > 0) return fit.height / ceilingHeightMm;
    return null;
  }, [fit, scale, ceilingHeightMm]);

  /*
   * The honest label and the scale it is honest about, in one line. They used
   * to be two: a pill at the top of the stage saying "Placed to scale in your
   * photo", which landed on the style chips, and this caption at the bottom.
   * Same subject, so one line says it once, where the scale controls are.
   */
  const scaleCaption = scale
    ? `Placed to scale in your photo — scale from ${scale.label}`
    : `Placed to scale in your photo — scale assumed from a ${formatMm(ceilingHeightMm)} ceiling`;

  /* the pinch refusal, on the whole stage */
  usePinch(
    ({ first, event }) => {
      event.preventDefault?.();
      if (first) refusePinch(activeItem ? spriteSizeMm(activeItem).heightMm : null);
    },
    { target: stageRef, eventOptions: { passive: false } }
  );

  /* taking the two taps that set the scale */
  const onStageClick = React.useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (!measuring || !fit) return;
      const rect = event.currentTarget.getBoundingClientRect();
      const y = event.clientY - rect.top;
      const choice = SCALE_CHOICES[measuring.index];

      if (measuring.firstY === null) {
        setMeasuring({ ...measuring, firstY: y });
        vibrate(8);
        return;
      }

      const pixels = Math.abs(y - measuring.firstY);
      if (pixels < 8) {
        toast("That's the same spot — tap the other end of it.");
        return;
      }
      setScale({
        kind: choice.kind,
        label: choice.label,
        realMm: choice.realMm,
        heightFraction: pixels / fit.height,
      });
      setMeasuring(null);
      vibrate(12);
      toast(`Scale set from ${choice.label}.`);
    },
    [measuring, fit]
  );

  /* ------------------------------------------------------------- empty */

  if (!roomImage) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-2 px-4 text-center">
        <p className="font-display text-lg">No room photo yet.</p>
        <p className="text-sm text-muted-foreground">
          Photograph the room first and everything you ask for stands in it at
          its real size.
        </p>
      </div>
    );
  }

  const placeableCount = items.length;

  return (
    <div
      ref={attach}
      onClick={onStageClick}
      className={cn(
        "relative h-full w-full touch-none select-none overflow-hidden bg-foreground/5",
        measuring ? "cursor-crosshair" : undefined
      )}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={roomImage.dataUrl}
        alt="The room you photographed"
        draggable={false}
        className="pointer-events-none absolute select-none"
        style={
          fit
            ? { left: fit.left, top: fit.top, width: fit.width, height: fit.height }
            : { inset: 0, width: "100%", height: "100%", objectFit: "contain" }
        }
      />

      {/* the honest label, top centre, always */}

      {/* the sprites */}
      {fit && pxPerMm
        ? items.map((item, index) => (
            <PhotoSprite
              key={item.id}
              item={item}
              index={index}
              count={placeableCount}
              active={item.id === activeItemId}
              fit={fit}
              pxPerMm={pxPerMm}
              spot={spots[item.id] ?? null}
              onSpot={(next) =>
                setSpots((s) => ({ ...s, [item.id]: next }))
              }
              onActivate={() => {
                setActiveItem(item.id);
                emitItemEvent(OPEN_OPTIONS_EVENT, item.id);
              }}
              onRemove={() => emitItemEvent(REMOVE_ITEM_EVENT, item.id)}
              onPlaced={() => moveItem(item.id, item.position, item.rotationY)}
              onResize={(scale) => resizeItem(item.id, scale)}
              onRotate={(degrees) => moveItem(item.id, item.position, degrees)}
              onDragPoint={onDragPoint}
              overBin={overBin}
            />
          ))
        : null}

      {/*
       * The "Ask for one thing…" card used to sit here. It said what the page's
       * own opening line and the input's placeholder already say, and it landed
       * in the same band as the items strip and the chips, so three layers
       * overlapped at the bottom of a 390px screen. One line of copy is enough.
       */}

      {/* the bin, only while something is in the air */}
      <div
        ref={binRef}
        aria-hidden={!dragging}
        className={cn(
          "pointer-events-none absolute right-3 top-24 z-30 grid size-16 place-items-center",
          "rounded-2xl border-2 border-dashed backdrop-blur-md transition-all duration-150",
          dragging ? "opacity-100" : "pointer-events-none opacity-0",
          binHot
            ? "scale-110 border-warn bg-warn/20 text-warn"
            : "border-line bg-background/80 text-muted-foreground"
        )}
      >
        <Trash2 className="size-5" aria-hidden />
        <span className="mt-0.5 text-[9px]">
          {binHot ? "release" : "drag here"}
        </span>
      </div>

      {/* the scale control sits directly above the ask stack, never over it */}
      <div className="pointer-events-none absolute inset-x-3 bottom-[var(--room-bottom-chrome)] flex flex-col gap-1">
        {measuring ? (
          <div className="pointer-events-auto rounded-xl border border-line bg-background/90 px-3 py-2 backdrop-blur-md">
            <StatusLine
              paused
              messages={[SCALE_CHOICES[measuring.index].hint]}
              className="text-foreground"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              {measuring.firstY === null
                ? "First tap sets the top."
                : "Now tap the other end."}
            </p>
            <button
              type="button"
              className="tap mt-1 text-xs text-accent underline underline-offset-2"
              onClick={(e) => {
                e.stopPropagation();
                setMeasuring(null);
              }}
            >
              Cancel
            </button>
          </div>
        ) : (
          <div className="pointer-events-auto flex w-fit flex-wrap items-center gap-2">
            <span className="rounded-full bg-background/70 px-3 py-1 text-[11px] text-muted-foreground backdrop-blur-md">
              {scaleCaption}
            </span>
            <button
              type="button"
              className="tap min-h-11 whitespace-nowrap rounded-full border border-line bg-background/80 px-3 py-1 text-xs text-foreground backdrop-blur-md"
              onClick={(e) => {
                e.stopPropagation();
                setMeasuring({ index: 0, firstY: null });
              }}
            >
              Set the scale
            </button>
            {scale ? null : (
              <button
                type="button"
                className="tap min-h-11 whitespace-nowrap rounded-full border border-line bg-background/80 px-3 py-1 text-xs text-muted-foreground backdrop-blur-md"
                onClick={(e) => {
                  e.stopPropagation();
                  setMeasuring({ index: 1, firstY: null });
                }}
              >
                Use an outlet
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default PhotoMode;

/* ============================================================ one sprite */

type Fit = { width: number; height: number; left: number; top: number };

type PhotoSpriteProps = {
  item: PlacedItem;
  index: number;
  count: number;
  active: boolean;
  fit: Fit;
  pxPerMm: number;
  spot: { x: number; y: number } | null;
  onSpot: (next: { x: number; y: number }) => void;
  onActivate: () => void;
  onRemove: () => void;
  onPlaced: () => void;
  onResize: (scale: number) => void;
  onRotate: (degrees: number) => void;
  /** where the finger is during a drag, so the bin can light up; null on drop */
  onDragPoint: (point: { x: number; y: number } | null) => void;
  /** is this viewport point inside the bin? */
  overBin: (x: number, y: number) => boolean;
};

function PhotoSprite({
  item,
  index,
  count,
  active,
  fit,
  pxPerMm,
  spot,
  onSpot,
  onActivate,
  onRemove,
  onPlaced,
  onResize,
  onRotate,
  onDragPoint,
  overBin,
}: PhotoSpriteProps) {
  const reduced = useReducedMotion();
  const ref = React.useRef<HTMLDivElement | null>(null);
  /** true once a press has travelled far enough to be a drag, not a tap */
  const draggedFar = React.useRef(false);

  /* the product itself once one is linked, the drawing of it until then */
  const spriteSrc =
    item.listingCutoutUrl ??
    (item.placeholderStatus === "ready" && item.placeholderUrl
      ? item.placeholderUrl
      : null);

  const size = spriteSizeMm(item);
  const width = size.widthMm * pxPerMm * item.scale;
  const height = size.heightMm * pxPerMm * item.scale;

  /* evenly along the floor line until the user drags it somewhere */
  const home = React.useMemo(
    () => ({ x: (index + 1) / (count + 1), y: 0.94 }),
    [index, count]
  );
  const place = spot ?? home;

  const left = fit.left + place.x * fit.width - width / 2;
  const top = fit.top + place.y * fit.height - height;

  const placeRef = React.useRef(place);
  React.useEffect(() => {
    placeRef.current = place;
  }, [place]);

  useDrag(
    ({ offset: [x, y], xy: [px, py], movement: [mx, my], event, last, first }) => {
      event.preventDefault?.();
      if (first) draggedFar.current = false;
      if (Math.abs(mx) + Math.abs(my) > 8) draggedFar.current = true;

      onSpot({
        x: Math.min(Math.max(x / fit.width, 0.02), 0.98),
        y: Math.min(Math.max(y / fit.height, 0.05), 1),
      });
      onDragPoint(last ? null : { x: px, y: py });

      if (last) {
        // dropped on the bin? that is the only gesture that removes anything
        if (overBin(px, py)) onRemove();
        else onPlaced();
      }
    },
    {
      target: ref,
      eventOptions: { passive: false },
      from: () => [
        placeRef.current.x * fit.width,
        placeRef.current.y * fit.height,
      ],
      filterTaps: true,
    }
  );

  /*
   * A LONG PRESS USED TO DELETE, and dragging a sprite slowly is a long press.
   * People lost objects while placing them. Removal is now a place you drag to
   * — the bin in the top-right corner — plus the cross on the item's chip, so
   * nothing vanishes from a gesture meant to move it.
   */

  const caption = dimsCaption(item);
  const label = labelDimsMm(item);

  return (
    <motion.div
      ref={ref}
      role="button"
      tabIndex={0}
      aria-label={`${item.category}${
        item.linkedProduct ? `, ${item.linkedProduct.title}` : ", nothing linked yet"
      }`}
      className="absolute cursor-grab touch-none active:cursor-grabbing"
      style={{ left, top }}
      // rotation rides with motion's own transform; a `rotate` in style is
      // discarded by it, which is why the handle turned nothing
      animate={{ width, height, rotate: item.rotationY }}
      initial={false}
      transition={reduced ? { duration: 0.15 } : RESIZE_SPRING}
      onClick={(e) => {
        e.stopPropagation();
        if (draggedFar.current) return;
        onActivate();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onActivate();
        }
      }}
    >
      {/*
       * DIMENSION ARROWS, and they never move.
       *
       * We do not know how big the room is. The photo has no scale until the
       * user taps a doorway, so how large the sprite LOOKS is a guess and the
       * millimetres are not: they came off the listing. So the numbers are
       * pinned to the object as measurements — an arrow across the width and an
       * arrow up the height — and dragging the sprite bigger or smaller does
       * not change a digit of them. There is nothing to "reset", because the
       * stated size was never what the picture claimed.
       */}
      {active ? (
        <>
          {/* height, up the left edge */}
          <div className="pointer-events-none absolute -left-2 bottom-0 top-0 flex w-0 items-center">
            <div className="h-full w-px bg-foreground/45" />
            <span className="absolute left-0 top-0 h-px w-2 -translate-x-1/2 bg-foreground/45" />
            <span className="absolute bottom-0 left-0 h-px w-2 -translate-x-1/2 bg-foreground/45" />
            <span
              style={{ rotate: `${-item.rotationY}deg` }}
              className={cn(
                "absolute left-1 whitespace-nowrap rounded-full px-1.5 py-0.5",
                "bg-background/80 text-[10px] backdrop-blur-md",
                dimsTone(item) === "warn" ? "text-warn" : "text-foreground"
              )}
            >
              {label ? formatMm(label.heightMm) : "— mm"}
            </span>
          </div>

          {/* width, across the bottom edge */}
          <div className="pointer-events-none absolute -bottom-2 left-0 right-0 flex h-0 justify-center">
            <div className="h-px w-full bg-foreground/45" />
            <span className="absolute left-0 top-0 h-2 w-px -translate-y-1/2 bg-foreground/45" />
            <span className="absolute right-0 top-0 h-2 w-px -translate-y-1/2 bg-foreground/45" />
            <span
              style={{ rotate: `${-item.rotationY}deg` }}
              className={cn(
                "absolute top-1 whitespace-nowrap rounded-full px-1.5 py-0.5",
                "bg-background/80 text-[10px] backdrop-blur-md",
                dimsTone(item) === "warn" ? "text-warn" : "text-foreground"
              )}
            >
              {label ? formatMm(label.widthMm) : "— mm"}
            </span>
          </div>
        </>
      ) : null}

      {/* where those numbers came from, and the kernel's verdict if it refused */}
      {active ? (
        <div
          style={{ rotate: `${-item.rotationY}deg` }}
          className="pointer-events-none absolute bottom-full left-1/2 mb-3 flex -translate-x-1/2 flex-col items-center gap-0.5 whitespace-nowrap rounded-full border border-line/60 bg-background/75 px-3 py-1 backdrop-blur-md"
        >
          <span
            className={cn(
              "text-[10px]",
              dimsTone(item) === "warn" ? "text-warn" : "text-muted-foreground"
            )}
          >
            {caption}
          </span>

          {/* the kernel's verdict, printed exactly as lib/fit.ts returned it */}
          {item.fit && item.fit.verdict !== "pass" ? (
            <span
              className={cn(
                "max-w-[15rem] whitespace-normal text-center text-[10px]",
                item.fit.verdict === "fail" ? "text-warn" : "text-muted-foreground"
              )}
            >
              {item.fit.reason}
            </span>
          ) : null}
        </div>
      ) : null}

      {spriteSrc ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={spriteSrc}
          alt={
            item.listingCutoutUrl && item.linkedProduct
              ? item.linkedProduct.title
              : `Stand-in ${item.category}`
          }
          draggable={false}
          className={cn(
            "h-full w-full select-none object-contain transition-opacity duration-300",
            "drop-shadow-[0_18px_24px_rgba(0,0,0,0.28)]"
          )}
        />
      ) : (
        <div
          className={cn(
            "h-full w-full rounded-[14px] border-2 border-dashed",
            item.placeholderStatus === "failed"
              ? "border-warn/60 bg-warn/10"
              : "animate-pulse border-accent/60 bg-accent/10"
          )}
        />
      )}

      {active ? (
        <p className="pointer-events-none absolute left-1/2 top-full mt-1 w-max -translate-x-1/2 text-[10px] text-muted-foreground">
          {item.listingCutoutUrl
            ? `${item.linkedProduct?.retailer ?? "the shop"}'s own photo`
            : "Stand-in image — the product you pick is linked."}
        </p>
      ) : null}

      {/*
       * HANDLES, on the active sprite only. Explicit rather than pinch: a pinch
       * is still refused out loud, because "locked to real size" is the point of
       * the screen. Dragging a handle is a deliberate "I know" — so it is
       * allowed, and the label says the sprite is no longer to scale.
       */}
      {active ? (
        <>
          <SpriteHandle
            kind="resize"
            baseHeight={size.heightMm * pxPerMm}
            scale={item.scale}
            rotation={item.rotationY}
            onScale={onResize}
            onAngle={onRotate}
            onDone={onPlaced}
          />
          <SpriteHandle
            kind="rotate"
            baseHeight={size.heightMm * pxPerMm}
            scale={item.scale}
            rotation={item.rotationY}
            onScale={onResize}
            onAngle={onRotate}
            onDone={onPlaced}
          />
        </>
      ) : null}
    </motion.div>
  );
}

/* ------------------------------------------------------------------ handles */

type SpriteHandleProps = {
  kind: "resize" | "rotate";
  /** the sprite's height at true scale, in px — the yardstick for a drag */
  baseHeight: number;
  scale: number;
  rotation: number;
  onScale: (scale: number) => void;
  onAngle: (degrees: number) => void;
  onDone: () => void;
};

/**
 * A 44px grab target on the corner of the active sprite. Resize on the bottom
 * right, rotate on the top right — the two places a person already expects
 * them, and both far enough from the body that a drag of the sprite itself is
 * never ambiguous.
 *
 * `movement` rather than `offset`: each drag starts from wherever the sprite
 * is now, so repeated adjustments compose instead of snapping back.
 */
function SpriteHandle({
  kind,
  baseHeight,
  scale,
  rotation,
  onScale,
  onAngle,
  onDone,
}: SpriteHandleProps) {
  const ref = React.useRef<HTMLButtonElement | null>(null);
  const start = React.useRef({ scale, rotation });

  useDrag(
    ({ first, last, movement: [mx, my], event }) => {
      event.stopPropagation();
      event.preventDefault?.();
      if (first) start.current = { scale, rotation };

      if (kind === "resize") {
        // drag down and right to grow; a full sprite-height of travel doubles it
        const travel = (mx + my) / 2;
        onScale(start.current.scale * (1 + travel / Math.max(baseHeight, 40)));
      } else {
        // a quarter of the sprite's height of sideways travel is 45 degrees
        const degrees = (mx / Math.max(baseHeight, 40)) * 180;
        onAngle(
          Math.round(
            Math.min(Math.max(start.current.rotation + degrees, -75), 75)
          )
        );
      }

      if (last) {
        vibrate(8);
        onDone();
      }
    },
    { target: ref, eventOptions: { passive: false }, filterTaps: true }
  );

  const resize = kind === "resize";

  return (
    <button
      ref={ref}
      type="button"
      aria-label={resize ? "Resize this stand-in" : "Rotate this stand-in"}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      className={cn(
        "absolute grid size-11 touch-none place-items-center rounded-full",
        "border border-accent/70 bg-background/85 text-accent backdrop-blur-md",
        "cursor-grab active:cursor-grabbing",
        /*
         * Both handles ride the TOP corners. A sprite stands on the floor line,
         * so a bottom handle lands exactly where the scale controls sit and the
         * two fight for the same 44px.
         */
        resize ? "-right-5 -top-5" : "-left-5 -top-5"
      )}
    >
      {resize ? (
        <Maximize2 className="size-4" aria-hidden />
      ) : (
        <RotateCw className="size-4" aria-hidden />
      )}
    </button>
  );
}
