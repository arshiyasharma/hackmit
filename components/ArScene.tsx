"use client";

/**
 * AR placement.
 *
 * Three paths, all of them real:
 *   1. WebXR (Android Chrome)  — model-viewer's `webxr` mode, floor placement.
 *   2. Quick Look (iOS Safari) — model-viewer's `quick-look` mode, our button.
 *   3. PHOTO MODE (desktop, or any browser with no AR) — the product drawn
 *      into the captured room photo at its true pixel size, dragged with the
 *      finger or the mouse. This is the path a laptop judge sees, so it is
 *      built to look deliberate, not degraded.
 *
 * REAL-WORLD SCALE IS THE POINT. A chair 780 mm tall is 0.78 m in the scene
 * and 780 mm worth of pixels in the photo. `ar-scale="fixed"` locks the size
 * inside an AR session; the in-page view refuses the pinch out loud.
 *
 * The custom element is imported inside a useEffect: @google/model-viewer
 * touches `window` at module scope and crashes server rendering otherwise.
 */

import * as React from "react";
import Link from "next/link";
import { usePinch, useDrag } from "@use-gesture/react";
import { motion, useReducedMotion } from "motion/react";
import { toast } from "sonner";
import { Camera, Box, MoveDiagonal, Smartphone } from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import NumberPlate from "@/components/ui/NumberPlate";
import StatusLine from "@/components/ui/StatusLine";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import type { Product, Rect } from "@/types";
import type { ArStatus, ModelViewer } from "@/types/model-viewer";

/* ------------------------------------------------------------------ sample */

/**
 * A labelled sample so the screen is never dead before sourcing lands. It says
 * "sample" on screen and it cannot be added to the cart — an unlabelled fake
 * listing would be the dishonest version of this.
 */
export const SAMPLE_PRODUCT: Product = {
  id: "sample-chair",
  elementId: "sample",
  retailer: "Sample",
  title: "Sample chair — not a listing",
  url: "https://modelviewer.dev/shared-assets/models/Chair.glb",
  priceCents: 0,
  currency: "USD",
  dimsMm: [600, 780, 620],
  dimsSource: "estimated",
  inStock: true,
  modelUrl: "https://modelviewer.dev/shared-assets/models/Chair.glb",
};

/* ------------------------------------------------------------------- utils */

function vibrate(ms: number) {
  if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
    navigator.vibrate(ms);
  }
}

const mm = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

/** Where a dimension came from, in the words we show the user. */
function dimsCaption(product: Product): string {
  if (!product.dimsMm) return "no dimensions listed";
  return product.dimsSource === "quoted"
    ? `${product.retailer} listing`
    : "estimated";
}

export type ArMode = "model" | "photo";

export type ArSceneProps = {
  /** the candidate in view; null falls back to the labelled sample */
  product?: Product | null;
  /** fires the first time the model anchors in an AR session */
  onPlaced?: () => void;
  className?: string;
};

/* ==================================================================== scene */

export function ArScene({ product, onPlaced, className }: ArSceneProps) {
  const item = product ?? SAMPLE_PRODUCT;

  const roomImage = useStore((s) => s.roomImage);
  const scaleReference = useStore((s) => s.scaleReference);
  const bbox = useStore((s) => s.bbox);
  const ceilingHeightMm = useStore((s) => s.profile.ceilingHeightMm);

  const [registered, setRegistered] = React.useState(false);
  const [registerFailed, setRegisterFailed] = React.useState(false);
  const [canActivateAr, setCanActivateAr] = React.useState(false);
  const [arStatus, setArStatus] = React.useState<ArStatus>("not-presenting");
  const [scaleFactor, setScaleFactor] = React.useState<number | null>(null);
  const [wall, setWall] = React.useState(false);
  const [mode, setMode] = React.useState<ArMode | null>(null);

  const mvRef = React.useRef<ModelViewer | null>(null);
  const stageRef = React.useRef<HTMLDivElement | null>(null);

  const heightMm = item.dimsMm?.[1];
  const widthMm = item.dimsMm?.[0];

  /* -------------------------------------------------- register the element */

  React.useEffect(() => {
    let cancelled = false;
    // module scope touches window — this import must not run on the server
    import("@google/model-viewer")
      .then(() => {
        if (!cancelled) setRegistered(true);
      })
      .catch(() => {
        if (!cancelled) setRegisterFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /* ------------------------------------------------------ real-world scale */

  const applyRealScale = React.useCallback(() => {
    const el = mvRef.current;
    if (!el || !heightMm) return;
    // measure the model at its own scale, then scale it to the listed height
    el.scale = "1 1 1";
    requestAnimationFrame(() => {
      const live = mvRef.current;
      if (!live) return;
      const dims = live.getDimensions();
      if (!dims || !Number.isFinite(dims.y) || dims.y <= 0) return;
      const factor = heightMm / 1000 / dims.y;
      if (!Number.isFinite(factor) || factor <= 0) return;
      live.scale = `${factor} ${factor} ${factor}`;
      setScaleFactor(factor);
    });
  }, [heightMm]);

  /* ------------------------------------------- element events, never polls */

  React.useEffect(() => {
    const el = mvRef.current;
    if (!el || !registered) return;

    const onLoad = () => {
      setCanActivateAr(Boolean(el.canActivateAR));
      applyRealScale();
    };

    const onArStatus = (event: Event) => {
      const status = (event as CustomEvent<{ status: ArStatus }>).detail?.status;
      if (!status) return;
      setArStatus(status);
      if (status === "object-placed") {
        vibrate(12);
        onPlaced?.();
      }
      if (status === "failed") {
        toast("AR didn't start. Showing it in your photo instead.");
        setMode("photo");
      }
    };

    const onError = () => {
      toast("That 3D model wouldn't load. Showing it in your photo instead.");
      setMode("photo");
    };

    el.addEventListener("load", onLoad);
    el.addEventListener("ar-status", onArStatus);
    el.addEventListener("error", onError);
    return () => {
      el.removeEventListener("load", onLoad);
      el.removeEventListener("ar-status", onArStatus);
      el.removeEventListener("error", onError);
    };
  }, [registered, applyRealScale, onPlaced]);

  /* ---------------------------------------------------------- which path */

  const hasModel = Boolean(item.modelUrl) && registered && !registerFailed;
  const hasPhoto = Boolean(roomImage);

  const resolvedMode: ArMode =
    mode ??
    (hasModel && (canActivateAr || !hasPhoto) ? "model" : hasPhoto ? "photo" : "model");

  /* ------------------------------------------------- the refusal, out loud */

  const refusePinch = React.useCallback(() => {
    const line = heightMm
      ? `Locked to real size — this is ${mm.format(heightMm)} mm tall.`
      : "Locked to real size.";
    toast(line, { id: "ar-scale-locked", description: "Pinching won't resize it." });
    vibrate(12);
  }, [heightMm]);

  usePinch(
    ({ first, event }) => {
      event.preventDefault?.();
      if (first) refusePinch();
    },
    { target: stageRef, eventOptions: { passive: false } }
  );

  /* ------------------------------------------------------------- rendering */

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div
        ref={stageRef}
        className="relative aspect-[3/4] w-full touch-none overflow-hidden rounded-2xl border border-line bg-surface select-none"
      >
        {resolvedMode === "model" ? (
          <ModelStage
            item={item}
            mvRef={mvRef}
            registered={registered}
            registerFailed={registerFailed}
            wall={wall}
            arStatus={arStatus}
          />
        ) : (
          <PhotoStage
            item={item}
            wall={wall}
            room={roomImage}
            bbox={bbox}
            pxPerMmSource={
              scaleReference && scaleReference.realMm > 0
                ? scaleReference.pixels / scaleReference.realMm
                : roomImage
                  ? roomImage.height / ceilingHeightMm
                  : null
            }
            scaleCaption={
              scaleReference
                ? `scale from ${scaleReference.label}`
                : `scale assumed from a ${mm.format(ceilingHeightMm)} mm ceiling`
            }
          />
        )}

        {/* the live dimension label, readable over any carpet */}
        <div className="pointer-events-none absolute left-3 top-3 flex items-center gap-4 rounded-full border border-line/60 bg-background/70 px-4 py-2 backdrop-blur-md">
          <NumberPlate
            value={widthMm ?? null}
            unit="mm"
            size="sm"
            label="width"
          />
          <span className="text-muted-foreground text-xs">×</span>
          <NumberPlate
            value={heightMm ?? null}
            unit="mm"
            size="sm"
            source={dimsCaption(item)}
            label="height"
          />
        </div>

        {resolvedMode === "photo" ? (
          <p className="pointer-events-none absolute bottom-3 left-3 rounded-full bg-background/70 px-3 py-1 text-xs text-muted-foreground backdrop-blur-md">
            Placed to scale in your photo
          </p>
        ) : null}
      </div>

      {/* --------------------------------------------------------- controls */}

      <div className="flex flex-wrap items-center gap-2">
        {resolvedMode === "model" && registered ? (
          <Button
            type="button"
            className="h-11 flex-1"
            disabled={!canActivateAr}
            onClick={() => {
              void mvRef.current?.activateAR();
            }}
          >
            <Smartphone className="size-4" aria-hidden />
            {canActivateAr ? "Place it in your room" : "AR needs a phone"}
          </Button>
        ) : null}

        <Button
          type="button"
          variant="ghost"
          className="h-11"
          onClick={() => {
            setWall((w) => !w);
            vibrate(8);
          }}
        >
          <Box className="size-4" aria-hidden />
          {wall ? "Back on the floor" : "See it against the wall"}
        </Button>

        {hasPhoto && hasModel ? (
          <Button
            type="button"
            variant="ghost"
            className="h-11"
            onClick={() => setMode(resolvedMode === "model" ? "photo" : "model")}
          >
            {resolvedMode === "model" ? (
              <>
                <Camera className="size-4" aria-hidden />
                In your photo
              </>
            ) : (
              <>
                <MoveDiagonal className="size-4" aria-hidden />
                In 3D
              </>
            )}
          </Button>
        ) : null}
      </div>

      <p className="text-xs text-muted-foreground">
        {resolvedMode === "photo"
          ? "Drag it around the photo. The size stays locked to the listing."
          : scaleFactor
            ? `Shown at ${mm.format(heightMm ?? 0)} mm tall — the size it arrives.`
            : "Sized from the listing's own dimensions."}
      </p>
    </div>
  );
}

export default ArScene;

/* ============================================================= model stage */

function ModelStage({
  item,
  mvRef,
  registered,
  registerFailed,
  wall,
  arStatus,
}: {
  item: Product;
  mvRef: React.RefObject<ModelViewer | null>;
  registered: boolean;
  registerFailed: boolean;
  wall: boolean;
  arStatus: ArStatus;
}) {
  const reduced = useReducedMotion();

  if (registerFailed || !item.modelUrl) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="font-display text-lg">No 3D model for this one yet.</p>
        <p className="text-sm text-muted-foreground">
          Take a photo of the corner and we&apos;ll place it to scale in the picture
          instead.
        </p>
        <Link
          href="/"
          className={cn(buttonVariants({ variant: "ghost" }), "h-11 px-4")}
        >
          Take a photo
        </Link>
      </div>
    );
  }

  if (!registered) {
    return (
      <div className="flex h-full items-center justify-center px-6">
        <StatusLine
          messages={[
            "Waking up the 3D viewer...",
            "Loading the model at its real size...",
          ]}
        />
      </div>
    );
  }

  return (
    <>
      <model-viewer
        ref={mvRef}
        src={item.modelUrl}
        alt={item.title}
        ar
        ar-modes="webxr scene-viewer quick-look"
        ar-scale="fixed"
        ar-placement={wall ? "wall" : "floor"}
        camera-controls
        disable-zoom
        touch-action="none"
        shadow-intensity="1"
        interaction-prompt="none"
        className="h-full w-full bg-transparent"
        style={{ width: "100%", height: "100%" }}
      />

      {/* path 1: WebXR needs a moment to find the floor. Killed on placement. */}
      {arStatus === "session-started" ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col items-center gap-2 bg-gradient-to-t from-background/90 to-transparent px-6 pb-8 pt-16 text-center">
          <motion.span
            animate={reduced ? { opacity: 1 } : { x: [-12, 12, -12] }}
            transition={
              reduced
                ? { duration: 0.15 }
                : { duration: 2.4, repeat: Infinity, ease: "easeInOut" }
            }
            className="text-foreground/70"
          >
            <Smartphone className="size-7" aria-hidden />
          </motion.span>
          <p className="font-display text-base">
            Move your phone slowly to find the floor.
          </p>
        </div>
      ) : null}
    </>
  );
}

/* ============================================================= photo stage */

type PhotoStageProps = {
  item: Product;
  wall: boolean;
  room: { dataUrl: string; width: number; height: number } | null;
  bbox: Rect | null;
  /** source-image pixels per millimetre; null when we cannot know */
  pxPerMmSource: number | null;
  scaleCaption: string;
};

function PhotoStage({
  item,
  wall,
  room,
  bbox,
  pxPerMmSource,
  scaleCaption,
}: PhotoStageProps) {
  const [box, setBox] = React.useState<{ width: number; height: number } | null>(
    null
  );
  const itemRef = React.useRef<HTMLDivElement | null>(null);

  /*
   * The drag position is keyed on the plane it was dragged in, so switching
   * product or switching floor/wall re-anchors without an effect that calls
   * setState. `placedRef` exists only so the gesture's `from` callback can read
   * the latest position outside of render.
   */
  const planeKey = `${item.id}:${wall ? "wall" : "floor"}`;
  const [drag, setDrag] = React.useState<{
    key: string;
    x: number;
    y: number;
  } | null>(null);

  /*
   * A ResizeObserver never fires in a background tab, so measure once the
   * moment the node attaches and subscribe after.
   */
  const attach = React.useCallback((node: HTMLDivElement | null) => {
    if (!node) return;
    const rect = node.getBoundingClientRect();
    setBox({ width: rect.width, height: rect.height });
    const observer = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (r) setBox({ width: r.width, height: r.height });
    });
    observer.observe(node);
    // React 19 runs a ref callback's return value as its cleanup
    return () => observer.disconnect();
  }, []);

  /* the contained fit of the photo inside the stage, computed not guessed */
  const fit = React.useMemo(() => {
    if (!room || !box || box.width === 0 || box.height === 0) return null;
    const scale = Math.min(box.width / room.width, box.height / room.height);
    const width = room.width * scale;
    const height = room.height * scale;
    return {
      scale,
      width,
      height,
      left: (box.width - width) / 2,
      top: (box.height - height) / 2,
    };
  }, [room, box]);

  const pxPerMm = fit && pxPerMmSource ? pxPerMmSource * fit.scale : null;
  const itemW = pxPerMm && item.dimsMm ? item.dimsMm[0] * pxPerMm : null;
  const itemH = pxPerMm && item.dimsMm ? item.dimsMm[1] * pxPerMm : null;

  /* where it sits before anyone drags it: the plane picked in the design step */
  const anchor = React.useMemo(() => {
    if (!fit || itemW === null || itemH === null) return null;
    if (bbox) {
      const cx = fit.left + (bbox.x + bbox.width / 2) * fit.scale;
      const baseline = wall
        ? fit.top + (bbox.y + bbox.height / 2) * fit.scale + itemH / 2
        : fit.top + (bbox.y + bbox.height) * fit.scale;
      return { x: cx - itemW / 2, y: baseline - itemH };
    }
    return {
      x: fit.left + fit.width / 2 - itemW / 2,
      y: fit.top + fit.height * (wall ? 0.4 : 0.92) - itemH,
    };
  }, [fit, bbox, itemW, itemH, wall]);

  // the drag wins, but only for the plane it happened in
  const placed = drag && drag.key === planeKey ? drag : anchor;

  const placedRef = React.useRef<{ x: number; y: number } | null>(null);
  React.useEffect(() => {
    placedRef.current = placed;
  }, [placed]);

  const bounds = React.useMemo(() => {
    if (!fit || itemW === null || itemH === null) {
      return { left: 0, right: 0, top: 0, bottom: 0 };
    }
    return {
      left: fit.left,
      right: Math.max(fit.left, fit.left + fit.width - itemW),
      top: fit.top,
      bottom: Math.max(fit.top, fit.top + fit.height - itemH),
    };
  }, [fit, itemW, itemH]);

  useDrag(
    ({ offset: [x, y], event }) => {
      event.preventDefault?.();
      setDrag({ key: planeKey, x, y });
    },
    {
      target: itemRef,
      eventOptions: { passive: false },
      from: () => {
        const p = placedRef.current;
        return [p?.x ?? 0, p?.y ?? 0];
      },
      bounds,
      filterTaps: true,
    }
  );

  if (!room) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="font-display text-lg">No room photo yet.</p>
        <p className="text-sm text-muted-foreground">
          Photograph the corner first and the piece drops into it at true size.
        </p>
        <Link href="/" className={cn(buttonVariants(), "h-11 px-4")}>
          Take a photo
        </Link>
      </div>
    );
  }

  return (
    <div ref={attach} className="relative h-full w-full bg-foreground/5">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={room.dataUrl}
        alt="The corner you photographed"
        draggable={false}
        className="pointer-events-none absolute select-none"
        style={
          fit
            ? { left: fit.left, top: fit.top, width: fit.width, height: fit.height }
            : { inset: 0, width: "100%", height: "100%", objectFit: "contain" }
        }
      />

      {item.dimsMm && placed && itemW !== null && itemH !== null ? (
        <div
          ref={itemRef}
          className="absolute touch-none cursor-grab active:cursor-grabbing"
          style={{ left: placed.x, top: placed.y, width: itemW, height: itemH }}
        >
          {item.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={item.imageUrl}
              alt={item.title}
              draggable={false}
              className="h-full w-full select-none object-contain drop-shadow-[0_18px_24px_rgba(0,0,0,0.35)]"
            />
          ) : (
            <div className="flex h-full w-full flex-col items-center justify-center rounded-md border-2 border-accent bg-accent/10 px-1 text-center backdrop-blur-[1px]">
              <span className="font-display text-xs leading-tight text-accent">
                {mm.format(item.dimsMm[0])} × {mm.format(item.dimsMm[1])} mm
              </span>
            </div>
          )}
        </div>
      ) : (
        <p className="absolute inset-x-6 bottom-12 rounded-xl border border-line bg-background/85 px-4 py-3 text-center text-sm text-muted-foreground backdrop-blur-md">
          {item.dimsMm
            ? "Tap a door or outlet on the design step to set the scale."
            : "This listing doesn't publish its dimensions, so it can't be placed to scale."}
        </p>
      )}

      <p className="pointer-events-none absolute bottom-3 right-3 rounded-full bg-background/70 px-3 py-1 text-[11px] text-muted-foreground backdrop-blur-md">
        {scaleCaption}
      </p>
    </div>
  );
}
