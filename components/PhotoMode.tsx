"use client";

/**
 * PHOTO MODE — the room on a laptop, and on every iPhone. Not a fallback.
 *
 * Safari on iPhone has no WebXR immersive-ar (verified 19 September 2026,
 * unsupported through iOS 27.2), AR Quick Look needs a .usdz we do not have,
 * and no laptop has either. So almost everyone sees THIS screen, and it is
 * built to the same standard as the live path: the same sprites, the same real
 * millimetres, the same spring on a relink, the same refusal on a pinch.
 *
 * THE PHOTO IS A PRINT STANDING IN LIGHT. The page gives the scene the whole
 * window and floats its glass over it — the agent panel down the right, the
 * listing tray along the bottom — and says how much each one covers in two CSS
 * variables, `--stage-right` and `--stage-bottom`. The photo is fitted and
 * centred in what is left, whole (the floor is never cropped away), and glides
 * there when either variable changes. Behind it the window is filled with a
 * soft, blurred, lightened copy of the same photo, so the glass has the room's
 * own colours to frost rather than a blank.
 *
 * Sprites composite over the photo at true size, measured against a scale
 * reference the user sets by tapping the top and the bottom of a wall, a
 * doorway or an outlet. Until they set one we assume the photo's height is the
 * ceiling height from their profile AND WE SAY SO on screen — an assumption
 * you can read is honest; a silent one is not.
 *
 * EVERYTHING IN PHOTO PIXELS IS MEASURED OFF THE PHOTO. Sprite positions are
 * fractions of the fitted photo box and their sizes come from a ResizeObserver
 * on that box — never from the window — so a tray opening, a panel narrowing
 * or a window resize moves the room and everything standing in it together.
 *
 * WHY THE SIZING MATH LIVES HERE. This file is the one scene path with no
 * three.js import, so components/PlaceholderSprite.tsx imports the sizing
 * helpers from here rather than the other way round. One source of truth: the
 * sprite in the live room and the sprite in the photo can never disagree about
 * how big a 1,520 mm lamp is.
 */

import * as React from "react";
import {
  motion,
  useReducedMotion,
  useSpring,
  useTransform,
  type MotionValue,
} from "motion/react";
import { Check, Maximize2, RotateCw, Trash2, X } from "lucide-react";
import { useDrag, usePinch } from "@use-gesture/react";
import { toast } from "sonner";

import { StatusLine } from "@/components/ui/StatusLine";
import { cssEase, DUR, ENTER, REDUCED, SPRING } from "@/lib/motion";
import { usePreviewFor } from "@/lib/preview";
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
  if (product.dimsSource === "quoted") return `${product.retailer} listing`;
  return product.dimsSource === "approx" ? "approx" : "estimated";
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

/**
 * ~400 ms to settle, with the one overshoot that makes a resize readable. The
 * numbers live in lib/motion.ts with every other animation number; the name is
 * kept because it is what this file has always exported.
 */
export const RESIZE_SPRING = SPRING;

/**
 * A design token's value, for the things CSS cannot reach — a three.js material
 * wants a colour string, not a class name. Read off :root so the reticle and
 * the 3D skeleton are the same accent and the same warn as everything else, and
 * null on the server or when the token is missing (the caller then leaves the
 * material alone rather than inventing a colour).
 */
export function tokenColor(name: `--${string}`): string | null {
  if (typeof window === "undefined") return null;
  const value = window
    .getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return value === "" ? null : value;
}

/* ------------------------------------------------------- scale reference */

/** What the user can point at to give the photo a real-world scale. */
export const SCALE_CHOICES: Array<{
  kind: ScaleReference["kind"];
  label: string;
  realMm: number;
  hint: string;
}> = [
  {
    /*
     * THE WALL FIRST, because every room has one and it is the easiest thing
     * in the photo to point at: ceiling, then floor. 2,438 mm is the standard
     * US ceiling (eight feet), offered as the suggestion rather than assumed
     * silently — the number is editable the moment the two taps land, because
     * a nine or ten foot room is common enough to get wrong.
     */
    kind: "wall",
    label: "the wall, ceiling to floor",
    realMm: 2438,
    hint: "Tap where the wall meets the ceiling, then where it meets the floor.",
  },
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

/* =================================================================== stage */

/** breathing room between the print and the window, the panel and the tray */
const STAGE_MARGIN = 24;
/** the account chip, the palette and the style words own the top of the window */
const STAGE_TOP = 76;

/**
 * WHERE THE ROOM MAY STAND. The page says how much of the window its glass
 * covers — `--stage-right` for the agent panel, `--stage-bottom` for the
 * listing tray — and everything the scene draws lives in what those leave.
 *
 * The box itself carries the transition, so when the tray opens the free area
 * shrinks over DUR.element and the photo, which is fitted to it in CSS, is
 * pushed up smoothly instead of jumping. A window resize changes neither
 * variable, so it is followed at once rather than chased.
 *
 * On a page that sets no `--stage-bottom` the older bottom chrome is assumed,
 * which is what that variable was before the tray existed.
 */
const FREE_AREA: React.CSSProperties = {
  top: STAGE_TOP,
  left: STAGE_MARGIN,
  right: `calc(var(--stage-right, 0px) + ${STAGE_MARGIN}px)`,
  bottom: `calc(var(--stage-bottom, var(--room-bottom-chrome, 0px)) + ${STAGE_MARGIN}px)`,
  transitionProperty: "right, bottom",
  transitionDuration: `${DUR.element}s`,
  transitionTimingFunction: cssEase("inOut"),
};

/** the one shadow colour: ink cooled with the accent, never a hard black */
const SHADE = "color-mix(in srgb, var(--foreground) 45%, var(--accent))";
const shade = (percent: number) =>
  `color-mix(in srgb, ${SHADE} ${percent}%, transparent)`;

/** what makes the photo read as a print standing in light */
const PRINT_SHADOW = `0 2px 6px ${shade(10)}, 0 30px 70px -24px ${shade(42)}`;
/** the same light, falling off a cutout */
const CUTOUT_SHADOW = `drop-shadow(0 18px 24px ${shade(30)})`;

/** a visible accent ring for anything the keyboard can reach */
const FOCUS_RING =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

/** a glass capsule you can press; 240ms is DUR.micro, the hover speed */
const PILL_BUTTON = cn(
  "glass-pill tap pointer-events-auto inline-flex min-h-11 cursor-pointer items-center",
  "whitespace-nowrap px-4 text-[13px] text-foreground",
  "transition-[transform,color] duration-[240ms] hover:-translate-y-px hover:text-accent",
  "active:translate-y-0",
  FOCUS_RING
);

/* ==================================================================== mode */

export type PhotoModeProps = {
  /**
   * One more thing for the row under the photo. ArScene knows what this browser
   * can do live and PhotoMode knows where things may stand, so the note is
   * handed down once rather than positioned twice against the same edge.
   */
  footnote?: React.ReactNode;
};

export function PhotoMode({ footnote }: PhotoModeProps = {}) {
  const roomImage = useStore((s) => s.roomImage);
  const items = useStore((s) => s.items);
  const activeItemId = useStore((s) => s.activeItemId);
  const setActiveItem = useStore((s) => s.setActiveItem);
  const moveItem = useStore((s) => s.moveItem);
  const resizeItem = useStore((s) => s.resizeItem);
  const measure = useStore((s) => s.measure);

  /*
   * THE BIN. Removal by drag is a destination, not a gesture: it only exists
   * while a sprite is being dragged, it sits in the photo's top corner, and a
   * drop anywhere else in the picture is just a placement.
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
  const photoRef = React.useRef<HTMLDivElement | null>(null);
  /** the fitted photo's real size on screen, straight off the element */
  const [box, setBox] = React.useState<{ width: number; height: number } | null>(
    null
  );

  const [scale, setScale] = React.useState<PhotoScale | null>(null);
  /**
   * The in-progress measurement: which object, and the first tap if taken. The
   * tap is kept as a FRACTION of the photo's height, so the photo gliding or
   * the window resizing between the two taps cannot skew the scale.
   */
  const [measuring, setMeasuring] = React.useState<{
    index: number;
    firstY: number | null;
  } | null>(null);

  /** where each sprite stands, as a fraction of the photo box. Bottom-centred. */
  const [spots, setSpots] = React.useState<
    Record<string, { x: number; y: number }>
  >({});

  const activeItem = items.find((i) => i.id === activeItemId) ?? null;

  /*
   * Measure the PHOTO, not the window: once on attach, then on every resize —
   * which includes every frame of the glide when the tray opens, so the things
   * standing in the room shrink with it rather than catching up afterwards.
   */
  const attachPhoto = React.useCallback((node: HTMLDivElement | null) => {
    photoRef.current = node;
    if (!node) return;
    const keep = (width: number, height: number) =>
      setBox((was) =>
        was &&
        Math.abs(was.width - width) < 0.25 &&
        Math.abs(was.height - height) < 0.25
          ? was
          : { width, height }
      );
    const rect = node.getBoundingClientRect();
    keep(rect.width, rect.height);
    const observer = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (r) keep(r.width, r.height);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  /**
   * Displayed pixels per millimetre. From the scale reference when the user set
   * one; otherwise from the assumption that the photo's height is their ceiling
   * height, which the caption says out loud.
   */
  const pxPerMm = React.useMemo(() => {
    if (!box || box.width === 0 || box.height === 0) return null;
    if (scale) return (box.height * scale.heightFraction) / scale.realMm;
    if (ceilingHeightMm > 0) return box.height / ceilingHeightMm;
    return null;
  }, [box, scale, ceilingHeightMm]);

  /* the pinch refusal, on the whole stage — a trackpad pinch included */
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
      if (!measuring) return;
      const rect = photoRef.current?.getBoundingClientRect();
      if (!rect || rect.height === 0) return;
      // a wall often meets the ceiling right at the photo's edge, so a tap just
      // outside the print counts as the edge rather than as a miss
      const y = Math.min(Math.max((event.clientY - rect.top) / rect.height, 0), 1);
      const choice = SCALE_CHOICES[measuring.index];

      if (measuring.firstY === null) {
        setMeasuring({ ...measuring, firstY: y });
        vibrate(8);
        return;
      }

      const heightFraction = Math.abs(y - measuring.firstY);
      if (heightFraction * rect.height < 8) {
        toast("That's the same spot — tap the other end of it.");
        return;
      }
      setScale({
        kind: choice.kind,
        label: choice.label,
        realMm: choice.realMm,
        heightFraction,
      });
      setMeasuring(null);
      vibrate(12);
      toast(`Scale set from ${choice.label}.`);
    },
    [measuring]
  );

  /* Escape backs out of a measurement, the way it backs out of everything */
  const isMeasuring = measuring !== null;
  React.useEffect(() => {
    if (!isMeasuring) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMeasuring(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isMeasuring]);

  /* ------------------------------------------------------------- empty */

  if (!roomImage) {
    return (
      <div className="relative h-full w-full overflow-hidden bg-background">
        {/* no photo to frost, so the paper gets the cool light instead */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(90% 70% at 28% 0%, var(--accent-wash), transparent 62%)",
          }}
        />
        <div className="absolute grid place-items-center" style={FREE_AREA}>
          <div className="glass flex max-w-[34rem] flex-col items-center gap-4 px-8 py-10 text-center desk:px-12 desk:py-14">
            <p className="font-display text-[32px] font-light leading-none tracking-[0.01em] desk:text-[48px]">
              No room photo yet.
            </p>
            <p className="max-w-[44ch] text-[15px] leading-relaxed text-muted-foreground">
              Photograph the room first and everything you ask for stands in it at
              its real size.
            </p>
            {footnote}
          </div>
        </div>
      </div>
    );
  }

  const placeableCount = items.length;
  const photoRatio = roomImage.width / roomImage.height;

  return (
    <div
      ref={stageRef}
      onClick={onStageClick}
      className={cn(
        "relative h-full w-full touch-none select-none overflow-hidden bg-background",
        measuring ? "cursor-crosshair" : undefined
      )}
    >
      {/*
       * THE ROOM'S OWN LIGHT. The same photo, blurred until it is only colour,
       * drained and lifted towards the paper, filling the window. It is what
       * the agent panel and the tray frost, so the glass is tinted by the room
       * the shopper is standing in. The blur is static; nothing here animates.
       */}
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={roomImage.dataUrl}
          alt=""
          draggable={false}
          className="h-full w-full scale-125 object-cover"
          style={{ filter: "blur(48px) saturate(0.45) brightness(1.12)" }}
        />
        <div className="absolute inset-0 bg-background/50" />
      </div>

      <div className="absolute flex flex-col gap-3" style={FREE_AREA}>
        {/*
         * THE FIT IS CSS. The photo takes the largest size of its own shape
         * that the free area allows — `contain`, written in container units —
         * so it follows the glide frame for frame with no script in the loop.
         * Script only READS the result, below, to size what stands in it.
         */}
        <div
          className="relative z-10 grid min-h-0 flex-1 place-items-center"
          style={{ containerType: "size" }}
        >
          <div
            ref={attachPhoto}
            className="relative"
            style={{
              aspectRatio: `${roomImage.width} / ${roomImage.height}`,
              width: `min(100cqw, calc(100cqh * ${photoRatio}))`,
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={roomImage.dataUrl}
              alt="The room you photographed"
              draggable={false}
              className="pointer-events-none absolute inset-0 h-full w-full select-none rounded-[20px]"
              style={{ boxShadow: PRINT_SHADOW }}
            />

            {/* the sprites */}
            {box && pxPerMm
              ? items.map((item, index) => (
                  <PhotoSprite
                    key={item.id}
                    item={item}
                    index={index}
                    count={placeableCount}
                    active={item.id === activeItemId}
                    box={box}
                    pxPerMm={pxPerMm}
                    spot={spots[item.id] ?? null}
                    // a lamp standing in front of the doorway must not eat the
                    // tap that measures the doorway
                    inert={isMeasuring}
                    onSpot={(next) =>
                      setSpots((s) => ({ ...s, [item.id]: next }))
                    }
                    onActivate={() => {
                      setActiveItem(item.id);
                      emitItemEvent(OPEN_OPTIONS_EVENT, item.id);
                    }}
                    onRemove={() => emitItemEvent(REMOVE_ITEM_EVENT, item.id)}
                    onPlaced={() => moveItem(item.id, item.position, item.rotationY)}
                    onResize={(next) => resizeItem(item.id, next)}
                    onRotate={(degrees) => moveItem(item.id, item.position, degrees)}
                    onDragPoint={onDragPoint}
                    overBin={overBin}
                  />
                ))
              : null}

            {/* the bin, only while something is in the air */}
            <div
              ref={binRef}
              aria-hidden={!dragging}
              className={cn(
                "pointer-events-none absolute right-3 top-3 z-30",
                "transition-[opacity,transform] duration-[240ms]",
                dragging ? "opacity-100" : "opacity-0",
                binHot ? "scale-110" : "scale-100"
              )}
            >
              <div
                className={cn(
                  "glass-thick grid h-16 w-28 place-items-center content-center gap-1",
                  "border-dashed",
                  binHot ? "!border-warn text-warn" : "text-muted-foreground"
                )}
              >
                <Trash2 className="size-5" aria-hidden />
                <span className="eyebrow">{binHot ? "release" : "drag here"}</span>
              </div>
            </div>
          </div>
        </div>

        {/*
         * THE ROW UNDER THE PRINT: the honest caption, the scale controls and
         * whatever ArScene has to say about live AR. It sits under the photo
         * rather than on it, so nothing here ever covers the floor line where
         * the things stand — and it rides the same free area, so it clears the
         * panel and lifts with the tray.
         */}
        <div className="pointer-events-none flex flex-none flex-wrap items-center justify-center gap-2">
          {measuring ? (
            <div className="glass-thick pointer-events-auto flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-2.5">
              <StatusLine
                paused
                messages={[SCALE_CHOICES[measuring.index].hint]}
                className="text-foreground"
              />
              <p className="text-xs text-muted-foreground">
                {measuring.firstY === null
                  ? "First tap sets the top."
                  : "Now tap the other end."}
              </p>
              <button
                type="button"
                className={cn(
                  "tap cursor-pointer rounded-sm text-xs text-accent underline underline-offset-2",
                  "hover:no-underline",
                  FOCUS_RING
                )}
                onClick={(e) => {
                  e.stopPropagation();
                  setMeasuring(null);
                }}
              >
                Cancel
              </button>
            </div>
          ) : (
            <>
              {/*
               * The honest label and the scale it is honest about, in one
               * line: "Placed to scale in your photo — scale assumed from a
               * 2,438 mm ceiling". The figure is set in mono like every other.
               */}
              <p className="glass-pill pointer-events-auto px-4 py-2 text-[12px] text-muted-foreground">
                {scale ? (
                  <>Placed to scale in your photo — scale from {scale.label}</>
                ) : (
                  <>
                    Placed to scale in your photo — scale assumed from a{" "}
                    <span className="tabular font-mono text-foreground">
                      {formatMm(ceilingHeightMm)}
                    </span>{" "}
                    ceiling
                  </>
                )}
              </p>
              <button
                type="button"
                className={PILL_BUTTON}
                onClick={(e) => {
                  e.stopPropagation();
                  setMeasuring({ index: 0, firstY: null });
                }}
              >
                {scale ? "Measure again" : "Set the scale"}
              </button>

              {/* the measured thing's real size, which is the part we guessed */}
              {scale ? (
                <WallHeightField
                  scale={scale}
                  onHeight={(realMm) => {
                    setScale({ ...scale, realMm });
                    // a wall IS the ceiling, so the fit check gets it too
                    if (scale.kind === "wall") measure("ceilingHeightMm", realMm);
                    vibrate(8);
                  }}
                />
              ) : (
                <button
                  type="button"
                  className={cn(PILL_BUTTON, "text-muted-foreground")}
                  onClick={(e) => {
                    e.stopPropagation();
                    setMeasuring({ index: 1, firstY: null });
                  }}
                >
                  Use a door
                </button>
              )}
            </>
          )}

          {footnote}
        </div>
      </div>
    </div>
  );
}

export default PhotoMode;

/* ============================================================ one sprite */

type Box = { width: number; height: number };

/**
 * THE RESIZE RUNS IN MILLIMETRES, and the pixels follow.
 *
 * The thing that changes when a different listing is linked — or tried on from
 * the tray — is a real size, so that is what is sprung: lib/motion's SPRING,
 * one overshoot, no bounce train. The sprite's pixels are those millimetres
 * times the photo's scale, applied without easing, so the photo gliding under
 * the tray or a handle being dragged never sets the spring off; and the label
 * reads the very same motion values, so the figure counts up exactly as the
 * object grows and lands when it lands.
 */
const MM_SPRING = {
  stiffness: SPRING.stiffness,
  damping: SPRING.damping,
  mass: SPRING.mass,
  // a millimetre label has no use for a thousandth of one: rest as soon as
  // the figure on screen has stopped changing
  restDelta: 0.5,
  restSpeed: 0.5,
} as const;

function useMmSpring(target: number, reduced: boolean): MotionValue<number> {
  // starts ON target, so a thing appears at its size and only a change animates
  const value = useSpring(target, MM_SPRING);
  React.useEffect(() => {
    if (reduced) value.jump(target);
    else value.set(target);
  }, [value, target, reduced]);
  return value;
}

/** A millimetre figure that counts: motion value -> whole number -> mono text. */
function MmCount({ value }: { value: MotionValue<number> }) {
  const text = useTransform(value, (mm) => formatMm(mm));
  return <motion.span>{text}</motion.span>;
}

/** One number on a leader line. Glass, mono, tabular — it never reflows. */
function MmChip({
  value,
  known,
  warn,
  prefix,
}: {
  value: MotionValue<number>;
  /** false prints a dash: a size nobody gave is not a size */
  known: boolean;
  warn: boolean;
  prefix?: string;
}) {
  return (
    <span
      className={cn(
        "glass-pill tabular block whitespace-nowrap px-2 py-0.5 font-mono text-[11px] leading-4",
        warn ? "text-warn" : "text-foreground"
      )}
    >
      {prefix ? <span className="text-accent">{prefix} · </span> : null}
      {known ? <MmCount value={value} /> : "— mm"}
    </span>
  );
}

type PhotoSpriteProps = {
  item: PlacedItem;
  index: number;
  count: number;
  active: boolean;
  /** the fitted photo's size on screen — the sprite is a child of that box */
  box: Box;
  pxPerMm: number;
  spot: { x: number; y: number } | null;
  /** true while the scale is being measured: taps belong to the photo */
  inert: boolean;
  onSpot: (next: { x: number; y: number }) => void;
  onActivate: () => void;
  onRemove: () => void;
  onPlaced: () => void;
  onResize: (scale: number) => void;
  onRotate: (degrees: number) => void;
  /** where the pointer is during a drag, so the bin can light up; null on drop */
  onDragPoint: (point: { x: number; y: number } | null) => void;
  /** is this viewport point inside the bin? */
  overBin: (x: number, y: number) => boolean;
};

const clamp = (value: number, low: number, high: number) =>
  Math.min(Math.max(value, low), high);

function PhotoSprite({
  item,
  index,
  count,
  active,
  box,
  pxPerMm,
  spot,
  inert,
  onSpot,
  onActivate,
  onRemove,
  onPlaced,
  onResize,
  onRotate,
  onDragPoint,
  overBin,
}: PhotoSpriteProps) {
  const reduced = useReducedMotion() ?? false;
  const ref = React.useRef<HTMLDivElement | null>(null);
  const removeRef = React.useRef<HTMLButtonElement | null>(null);
  /** true once a press has travelled far enough to be a drag, not a tap */
  const draggedFar = React.useRef(false);

  /*
   * THE HANDLES ARE NOT ALWAYS THERE.
   *
   * They are 44px each and they sit on the object's corners, so on a small
   * sprite — a stool, a framed print, anything a metre or less — they covered
   * the thing they were meant to be adjusting. The active item carries a thin
   * outline instead, which says "this one, and you can touch it", and a click
   * on it brings the handles out.
   */
  const [handles, setHandles] = React.useState(false);

  /* handing focus to another item puts them away */
  const [hadFocus, setHadFocus] = React.useState(active);
  if (hadFocus !== active) {
    setHadFocus(active);
    if (!active) setHandles(false);
  }

  /*
   * TRYING ONE ON. The listing under the pointer in the tray, if it is not the
   * linked one and it states a height. It is read from lib/preview and nothing
   * here writes it anywhere: the sprite borrows its size, says so, and gives it
   * back the moment the pointer leaves. A listing with no size cannot be tried
   * on — the sprite stays as it is and the caption says why.
   */
  const preview = usePreviewFor(item);
  const trying =
    preview?.dimsMm && preview.dimsMm[1] > 0 ? preview : null;
  const shown: PlacedItem = trying ? { ...item, linkedProduct: trying } : item;

  /* the product itself once one is linked, the drawing of it until then */
  const spriteSrc =
    item.listingCutoutUrl ??
    (item.placeholderStatus === "ready" && item.placeholderUrl
      ? item.placeholderUrl
      : null);

  /*
   * The picture on screen is the last one that finished loading, so a swap from
   * the stand-in to the shop's own photo never flashes the dashed box between
   * the two, and a picture that fails to load leaves what was there standing.
   */
  const [loadedSrc, setLoadedSrc] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (!spriteSrc) return;
    let live = true;
    const probe = new window.Image();
    probe.onload = () => {
      if (live) setLoadedSrc(spriteSrc);
    };
    probe.src = spriteSrc;
    return () => {
      live = false;
    };
  }, [spriteSrc]);
  const pictureSrc = spriteSrc === null ? null : loadedSrc;
  const isShopPhoto = pictureSrc !== null && pictureSrc === item.listingCutoutUrl;

  /* only the FIRST picture arrives; a later swap is a quiet change of image */
  const [arrivedOnce, setArrivedOnce] = React.useState(false);

  const size = spriteSizeMm(shown);
  const label = labelDimsMm(shown);

  const drawnHeightMm = useMmSpring(size.heightMm, reduced);
  const drawnWidthMm = useMmSpring(size.widthMm, reduced);
  /* before anything is linked the label is a dash, but its spring rides along
     at the drawn size, so the first link counts from what was standing there */
  const labelHeightMm = useMmSpring(label?.heightMm ?? size.heightMm, reduced);
  const labelWidthMm = useMmSpring(label?.widthMm ?? size.widthMm, reduced);

  /* photo scale and the user's own resize apply at once — see MM_SPRING */
  const pxPerDrawnMm = pxPerMm * item.scale;
  const width = useTransform(drawnWidthMm, (mm) => Math.max(mm * pxPerDrawnMm, 1));
  const height = useTransform(drawnHeightMm, (mm) => Math.max(mm * pxPerDrawnMm, 1));
  const groundWidth = useTransform(width, (px) => px * 0.92);
  const groundHeight = useTransform(width, (px) => Math.max(px * 0.14, 10));

  /* evenly along the floor line until the user drags it somewhere */
  const home = React.useMemo(
    () => ({ x: (index + 1) / (count + 1), y: 0.94 }),
    [index, count]
  );
  const place = spot ?? home;

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
        x: clamp(x / box.width, 0.02, 0.98),
        y: clamp(y / box.height, 0.05, 1),
      });
      onDragPoint(last ? null : { x: px, y: py });

      if (last) {
        // dropped on the bin? that is the only DRAG that removes anything
        if (overBin(px, py)) onRemove();
        else onPlaced();
      }
    },
    {
      target: ref,
      eventOptions: { passive: false },
      // measured against the photo as it is NOW, so a drag that starts after
      // the room has glided or the window has resized still lands under the
      // pointer
      from: () => [
        placeRef.current.x * box.width,
        placeRef.current.y * box.height,
      ],
      filterTaps: true,
    }
  );

  /*
   * A LONG PRESS USED TO DELETE, and dragging a sprite slowly is a long press.
   * People lost objects while placing them. Removal is a deliberate act now:
   * the bin you drag to, the cross on the item's chip, and — on a laptop — the
   * small cross that shows on hover or focus and the Delete key. Nothing
   * vanishes from a gesture meant to move it.
   *
   * The cross swallows its own pointerdown natively: the drag listener above
   * is a native one on the sprite, and React's stopPropagation is too late to
   * keep a press on the cross from also counting as a press on the sprite.
   */
  React.useEffect(() => {
    const node = removeRef.current;
    if (!node) return;
    const stop = (event: PointerEvent) => event.stopPropagation();
    node.addEventListener("pointerdown", stop);
    return () => node.removeEventListener("pointerdown", stop);
  }, []);

  /*
   * Two honest tones, because they can differ. The caption speaks for the
   * listing under the pointer — including one with no size, which is tried on
   * in name only. The figures speak for the listing whose millimetres they
   * actually are.
   */
  const spokenFor: PlacedItem = preview ? { ...item, linkedProduct: preview } : item;
  const caption = dimsCaption(spokenFor);
  const tone = dimsTone(spokenFor);
  const figuresWarn = dimsTone(shown) === "warn";
  const arrive = reduced ? REDUCED : ENTER;
  const counter = { rotate: `${-item.rotationY}deg` };

  return (
    /* the point on the floor where it stands; the sprite grows up from it */
    <div
      className={cn("absolute size-0", inert ? "pointer-events-none" : undefined)}
      style={{
        left: `${place.x * 100}%`,
        top: `${place.y * 100}%`,
        zIndex: active ? 20 : 10,
      }}
    >
      {/*
       * THE SHADOW IS WHAT MAKES IT READ AS IN THE ROOM. A blurred ellipse on
       * the floor, arriving on the same range as the object. Only its opacity
       * moves; the blur is fixed.
       */}
      <motion.div
        aria-hidden
        className="pointer-events-none absolute left-0 top-0 rounded-[50%]"
        style={{
          width: groundWidth,
          height: groundHeight,
          x: "-50%",
          y: "-50%",
          background: SHADE,
          filter: "blur(7px)",
        }}
        initial={{ opacity: 0 }}
        animate={{ opacity: pictureSrc && !trying ? 0.45 : 0 }}
        transition={arrive}
      />
      {/* trying one on: the ground says so — pale, dashed, not a shadow */}
      <motion.div
        aria-hidden
        className="pointer-events-none absolute left-0 top-0 rounded-[50%] border-2 border-dashed border-accent-pale bg-accent-pale/35"
        style={{ width: groundWidth, height: groundHeight, x: "-50%", y: "-50%" }}
        initial={{ opacity: 0 }}
        animate={{ opacity: trying ? 1 : 0 }}
        transition={reduced ? REDUCED : { duration: DUR.micro, ease: ENTER.ease }}
      />

      <motion.div
        ref={ref}
        role="button"
        tabIndex={0}
        aria-label={`${item.category}${
          item.linkedProduct ? `, ${item.linkedProduct.title}` : ", nothing linked yet"
        }`}
        className={cn(
          "group absolute bottom-0 left-0 cursor-grab touch-none rounded-lg active:cursor-grabbing",
          "focus-visible:outline-[3px] focus-visible:outline-offset-4 focus-visible:outline-solid focus-visible:outline-accent",
          // the outline IS the affordance while the handles are away
          trying
            ? "outline-2 outline-offset-4 outline-dashed outline-accent-pale"
            : active && handles
              ? "outline-2 outline-offset-4 outline-accent"
              : active
                ? "outline-2 outline-offset-4 outline-dashed outline-accent/70"
                : "hover:outline-2 hover:outline-offset-4 hover:outline-accent/50"
        )}
        // rotation rides with motion's own transform; a `rotate` in style is
        // discarded by it, which is why the handle turned nothing
        style={{ width, height, x: "-50%" }}
        animate={{ rotate: item.rotationY }}
        initial={false}
        transition={reduced ? REDUCED : { duration: DUR.micro, ease: ENTER.ease }}
        onClick={(e) => {
          e.stopPropagation();
          if (draggedFar.current) return;
          /*
           * TWO DIFFERENT CLICKS. On an item that is not the active one, a
           * click selects it and brings its listings up — that is how you get
           * back to something you placed. On the item that is ALREADY active,
           * a click is about the object itself, so it shows the handles.
           */
          if (!active) {
            setHandles(false);
            onActivate();
            return;
          }
          setHandles((was) => !was);
        }}
        // the two clicks of a double click put the handles back where they
        // were, so it is free to mean "show me its listings again"
        onDoubleClick={(e) => {
          e.stopPropagation();
          onActivate();
        }}
        onKeyDown={(e) => {
          // keys pressed on a handle or the cross belong to that control
          if (e.target !== e.currentTarget) return;
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onActivate();
            return;
          }
          if (e.key === "Delete" || e.key === "Backspace") {
            e.preventDefault();
            onRemove();
            return;
          }
          if (e.key === "Escape" && handles) {
            // the first Escape puts the handles away; the next one is the tray's
            e.stopPropagation();
            setHandles(false);
            return;
          }
          const step = e.shiftKey ? 0.05 : 0.01;
          const dx =
            e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
          const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
          if (dx === 0 && dy === 0) return;
          e.preventDefault();
          onSpot({
            x: clamp(place.x + dx, 0.02, 0.98),
            y: clamp(place.y + dy, 0.05, 1),
          });
          onPlaced();
        }}
      >
        {/*
         * DIMENSION LINES, and they never move.
         *
         * We do not know how big the room is. The photo has no scale until the
         * user taps a wall, so how large the sprite LOOKS is a guess and the
         * millimetres are not: they came off the listing. So the numbers are
         * pinned to the object as measurements — a 1px leader up the height
         * and one across the width, each ending in a mono chip — and dragging
         * the sprite bigger or smaller does not change a digit of them. They
         * change when the LISTING does, and then they count there on the same
         * spring that resizes the object. They arrive a beat after it.
         */}
        {active ? (
          <motion.div
            className="pointer-events-none absolute inset-0"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={reduced ? REDUCED : { ...ENTER, delay: DUR.micro }}
          >
            {/* height, up the left edge */}
            <div className="absolute -left-3 bottom-0 top-0 flex w-0 items-center">
              <div className="h-full w-px bg-accent ring-1 ring-surface/60" />
              <span className="absolute left-0 top-0 h-px w-2 -translate-x-1/2 bg-accent" />
              <span className="absolute bottom-0 left-0 h-px w-2 -translate-x-1/2 bg-accent" />
              <span className="absolute right-1.5" style={counter}>
                <MmChip
                  value={labelHeightMm}
                  known={label !== null}
                  warn={figuresWarn}
                  prefix={trying ? "trying on" : undefined}
                />
              </span>
            </div>

            {/* width, across the bottom edge */}
            <div className="absolute -bottom-3 left-0 right-0 flex h-0 justify-center">
              <div className="h-px w-full bg-accent ring-1 ring-surface/60" />
              <span className="absolute left-0 top-0 h-2 w-px -translate-y-1/2 bg-accent" />
              <span className="absolute right-0 top-0 h-2 w-px -translate-y-1/2 bg-accent" />
              <span className="absolute top-1.5" style={counter}>
                <MmChip
                  value={labelWidthMm}
                  known={label !== null}
                  warn={figuresWarn}
                />
              </span>
            </div>

            {/* where those numbers came from, what the picture is, and the
                kernel's verdict if it refused */}
            <div
              style={counter}
              className={cn(
                "absolute bottom-full left-1/2 -translate-x-1/2",
                handles ? "mb-9" : "mb-3"
              )}
            >
              <div className="glass-thick flex flex-col items-center gap-0.5 px-3.5 py-2 text-center text-[11px] leading-4">
                <span
                  className={cn(
                    "whitespace-nowrap",
                    tone === "warn" ? "text-warn" : "text-muted-foreground"
                  )}
                >
                  {preview ? <span className="text-accent">trying on · </span> : null}
                  {caption}
                </span>

                {/* the kernel's verdict, printed exactly as lib/fit.ts returned
                    it — and only for the listing it was run on, never for one
                    that is merely being tried on */}
                {!preview && item.fit && item.fit.verdict !== "pass" ? (
                  <span
                    className={cn(
                      "max-w-[15rem] whitespace-normal",
                      item.fit.verdict === "fail" ? "text-warn" : "text-muted-foreground"
                    )}
                  >
                    {item.fit.reason}
                  </span>
                ) : null}

                <span className="max-w-[15rem] whitespace-normal text-muted-foreground">
                  {isShopPhoto
                    ? `${item.linkedProduct?.retailer ?? "the shop"}'s own photo`
                    : "Stand-in image — the product you pick is linked."}
                </span>
              </div>
            </div>
          </motion.div>
        ) : null}

        {pictureSrc ? (
          /*
           * IT APPEARS: up 26px and out of nothing, over DUR.element. A later
           * picture (the shop's own photo landing on a link) only fades, so
           * the beat that reads on a relink is the resize and not a second
           * entrance.
           */
          <motion.img
            key={pictureSrc}
            src={pictureSrc}
            alt={
              isShopPhoto && item.linkedProduct
                ? item.linkedProduct.title
                : `Stand-in ${item.category}`
            }
            draggable={false}
            className="h-full w-full select-none object-contain"
            style={{ filter: CUTOUT_SHADOW }}
            initial={{ opacity: 0, y: reduced || arrivedOnce ? 0 : 26 }}
            animate={{ opacity: 1, y: 0 }}
            transition={arrive}
            onAnimationComplete={() => setArrivedOnce(true)}
          />
        ) : (
          <div
            className={cn(
              "h-full w-full rounded-[14px] border-2 border-dashed",
              item.placeholderStatus === "failed"
                ? "border-warn/60 bg-warn/10"
                : "animate-pulse border-accent/60 bg-accent-wash/70"
            )}
          />
        )}

        {/*
         * HANDLES, on the active sprite only. Explicit rather than pinch: a pinch
         * is still refused out loud, because "locked to real size" is the point of
         * the screen. Dragging a handle is a deliberate "I know" — so it is
         * allowed.
         */}
        {active && handles ? (
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

        {/*
         * The cross: there on hover or focus, gone otherwise. It is 32px and
         * carries NO enlarged hit area on purpose — it overlaps the corner of
         * the thing you drag, and a generous invisible target there is how
         * objects get deleted by accident. Touch has the bin.
         */}
        <button
          ref={removeRef}
          type="button"
          aria-label={`Remove ${item.category} from the room`}
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          onDoubleClick={(e) => e.stopPropagation()}
          className={cn(
            "pointer-events-none absolute -bottom-5 -right-5 grid size-8 cursor-pointer place-items-center rounded-full opacity-0",
            "transition-opacity duration-[240ms]",
            "group-hover:pointer-events-auto group-hover:opacity-100",
            "group-focus-within:pointer-events-auto group-focus-within:opacity-100",
            FOCUS_RING
          )}
        >
          <span className="glass-pill grid size-8 place-items-center text-muted-foreground transition-colors duration-[240ms] hover:text-warn">
            <X className="size-3.5" aria-hidden />
          </span>
        </button>
      </motion.div>
    </div>
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

const clampAngle = (degrees: number) => Math.round(clamp(degrees, -75, 75));

/**
 * A 44px grab target on the corner of the active sprite, drawn as a 36px glass
 * bead so it hides as little of a small object as it can. Resize on the top
 * right, rotate on the top left — far enough from the body that a drag of the
 * sprite itself is never ambiguous.
 *
 * `movement` rather than `offset`: each drag starts from wherever the sprite
 * is now, so repeated adjustments compose instead of snapping back.
 *
 * With the keyboard the arrows do the same job in steps: 5% of its size, or
 * five degrees.
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
        onAngle(clampAngle(start.current.rotation + degrees));
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
      onDoubleClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        const more = e.key === "ArrowRight" || e.key === "ArrowUp";
        const less = e.key === "ArrowLeft" || e.key === "ArrowDown";
        if (!more && !less) return;
        e.preventDefault();
        if (resize) onScale(scale * (more ? 1.05 : 1 / 1.05));
        else onAngle(clampAngle(rotation + (more ? 5 : -5)));
        onDone();
      }}
      className={cn(
        "group/handle absolute grid size-11 touch-none place-items-center rounded-full",
        "cursor-grab active:cursor-grabbing",
        FOCUS_RING,
        /*
         * Both handles ride the TOP corners: a sprite stands on the floor line
         * and its width figure hangs under it, so the bottom edge is taken.
         */
        resize ? "-right-5 -top-5" : "-left-5 -top-5"
      )}
    >
      <span className="glass-pill grid size-9 place-items-center text-accent transition-transform duration-[240ms] group-hover/handle:scale-110">
        {resize ? (
          <Maximize2 className="size-4" aria-hidden />
        ) : (
          <RotateCw className="size-4" aria-hidden />
        )}
      </span>
    </button>
  );
}

/* --------------------------------------------------------- the wall height */

/** 8, 9 and 10 feet in millimetres — what US rooms actually are. */
const WALL_PRESETS: Array<{ label: string; mm: number }> = [
  { label: "8 ft", mm: 2438 },
  { label: "9 ft", mm: 2743 },
  { label: "10 ft", mm: 3048 },
];

/**
 * How tall the thing they just measured really is.
 *
 * Everything in the photo is sized against this one number, so it is the one
 * number worth being right — and it is the one we were guessing. Two taps set
 * WHERE the wall is; this sets HOW TALL it is, offering the standard 8-foot US
 * ceiling as the answer most rooms want and making the other two a click away.
 *
 * It says what it is assuming until the user says otherwise, which is the same
 * rule the dimension labels follow.
 */
function WallHeightField({
  scale,
  onHeight,
}: {
  scale: { kind: ScaleReference["kind"]; label: string; realMm: number };
  onHeight: (realMm: number) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [draft, setDraft] = React.useState("");

  const feet = scale.realMm / 304.8;
  const asLabel =
    WALL_PRESETS.find((p) => p.mm === scale.realMm)?.label ??
    `${feet.toFixed(1)} ft`;

  if (!open) {
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        className={PILL_BUTTON}
      >
        {scale.kind === "wall" ? "Ceiling" : "Size"}:{" "}
        <span className="tabular ml-1 font-mono">{asLabel}</span>
      </button>
    );
  }

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key !== "Escape") return;
        // this Escape closes the field, not the tray behind it
        e.stopPropagation();
        setOpen(false);
      }}
      className="glass-thick pointer-events-auto flex flex-wrap items-center gap-1.5 px-2 py-1.5"
    >
      {WALL_PRESETS.map((preset) => (
        <button
          key={preset.mm}
          type="button"
          onClick={() => {
            onHeight(preset.mm);
            setOpen(false);
          }}
          className={cn(
            "tap tabular min-h-9 cursor-pointer rounded-full border px-3 font-mono text-xs",
            "transition-colors duration-[240ms] hover:border-accent hover:text-accent",
            FOCUS_RING,
            preset.mm === scale.realMm
              ? "border-accent bg-accent-wash text-accent"
              : "border-line text-foreground"
          )}
        >
          {preset.label}
        </button>
      ))}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const value = Number(draft.replace(/[^\d.]/g, ""));
          // typed in feet if it is small, in millimetres if it is not
          const mm = value > 0 && value < 30 ? Math.round(value * 304.8) : Math.round(value);
          if (mm >= 500 && mm <= 6000) {
            onHeight(mm);
            setOpen(false);
          }
        }}
        className="flex items-center gap-1 pl-1"
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          inputMode="decimal"
          placeholder="ft or mm"
          aria-label="How tall it really is, in feet or millimetres"
          autoFocus
          className={cn(
            "tabular w-24 rounded-full border border-line bg-surface/70 px-3 py-1.5 font-mono text-xs text-foreground",
            "placeholder:text-muted-foreground focus-visible:border-accent",
            FOCUS_RING
          )}
        />
        <button
          type="submit"
          aria-label="Use this height"
          className={cn(
            "tap grid size-8 cursor-pointer place-items-center rounded-full text-accent",
            "transition-colors duration-[240ms] hover:bg-accent-wash",
            FOCUS_RING
          )}
        >
          <Check className="size-3.5" aria-hidden />
        </button>
      </form>
    </div>
  );
}
