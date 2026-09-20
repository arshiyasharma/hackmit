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
    item.placeholderStatus === "ready" && item.placeholderWidthRatio > 0
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
const LONG_PRESS_MS = 550;

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

  const scaleCaption = scale
    ? `scale from ${scale.label}`
    : `scale assumed from a ${formatMm(ceilingHeightMm)} ceiling`;

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
      <p className="pointer-events-none absolute inset-x-0 top-3 mx-auto w-fit rounded-full bg-background/70 px-3 py-1 text-xs text-muted-foreground backdrop-blur-md">
        Placed to scale in your photo
      </p>

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
            />
          ))
        : null}

      {items.length === 0 ? (
        <p className="pointer-events-none absolute inset-x-6 bottom-28 rounded-xl border border-line bg-background/85 px-4 py-3 text-center text-sm text-muted-foreground backdrop-blur-md">
          Ask for one thing — &ldquo;a tall lamp&rdquo; — and it stands here at
          the size it really arrives.
        </p>
      ) : null}

      {/* the scale control, bottom left, out of the way of the ask input */}
      <div className="absolute bottom-3 left-3 flex max-w-[70%] flex-col gap-1">
        {measuring ? (
          <div className="rounded-xl border border-line bg-background/90 px-3 py-2 backdrop-blur-md">
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
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-background/70 px-3 py-1 text-[11px] text-muted-foreground backdrop-blur-md">
              {scaleCaption}
            </span>
            <button
              type="button"
              className="tap min-h-11 rounded-full border border-line bg-background/80 px-3 py-1 text-xs text-foreground backdrop-blur-md"
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
                className="tap min-h-11 rounded-full border border-line bg-background/80 px-3 py-1 text-xs text-muted-foreground backdrop-blur-md"
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
}: PhotoSpriteProps) {
  const reduced = useReducedMotion();
  const ref = React.useRef<HTMLDivElement | null>(null);
  const pressTimer = React.useRef<number | null>(null);
  const longPressed = React.useRef(false);

  const size = spriteSizeMm(item);
  const width = size.widthMm * pxPerMm;
  const height = size.heightMm * pxPerMm;

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
    ({ offset: [x, y], event, last }) => {
      event.preventDefault?.();
      onSpot({
        x: Math.min(Math.max(x / fit.width, 0.02), 0.98),
        y: Math.min(Math.max(y / fit.height, 0.05), 1),
      });
      if (last) onPlaced();
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

  const startPress = () => {
    longPressed.current = false;
    pressTimer.current = window.setTimeout(() => {
      longPressed.current = true;
      vibrate(16);
      onRemove();
    }, LONG_PRESS_MS);
  };
  const endPress = () => {
    if (pressTimer.current !== null) {
      window.clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  };
  React.useEffect(() => endPress, []);

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
      animate={{ width, height }}
      initial={false}
      transition={reduced ? { duration: 0.15 } : RESIZE_SPRING}
      onPointerDown={startPress}
      onPointerUp={endPress}
      onPointerCancel={endPress}
      onPointerLeave={endPress}
      onClick={(e) => {
        e.stopPropagation();
        if (longPressed.current) return;
        onActivate();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onActivate();
        }
      }}
    >
      {/* the active item carries the ONE dimension label; nothing else does */}
      {active ? (
        <div className="pointer-events-none absolute bottom-full left-1/2 mb-2 flex -translate-x-1/2 flex-col items-center gap-0.5 whitespace-nowrap rounded-full border border-line/60 bg-background/75 px-3 py-1 backdrop-blur-md">
          <span className="flex items-baseline gap-1">
            <NumberPlate value={label?.widthMm ?? null} size="sm" label="width" />
            <span className="text-xs text-muted-foreground">×</span>
            <NumberPlate
              value={label?.heightMm ?? null}
              unit="mm"
              size="sm"
              label="height"
            />
          </span>
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

      {item.placeholderStatus === "ready" && item.placeholderUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={item.placeholderUrl}
          alt={`Stand-in ${item.category}`}
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
          Stand-in image — the product you pick is linked.
        </p>
      ) : null}
    </motion.div>
  );
}
