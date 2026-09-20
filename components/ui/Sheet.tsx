"use client";

import * as React from "react";
import { Sheet as ModalSheet } from "react-modal-sheet";
import { useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";

/**
 * The ONLY bottom sheet in the app.
 *
 * Built on react-modal-sheet (MIT, 5.6.0). Not Vaul, and not shadcn's Drawer,
 * which is built on Vaul — Vaul's author has marked it unmaintained.
 *
 * The handle, the backdrop blur and the rounded-t-3xl live here once so the AR
 * sheet, the fit sheet and the checkout sheet cannot drift apart.
 */

export type SheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** fractions of the viewport, tallest first */
  snapPoints?: number[];
  /** index into snapPoints; 1 means the half-height rest position */
  initialSnap?: number;
  children: React.ReactNode;

  /* optional, additive — the four props above are the contract */
  className?: string;
  /** hide the grab handle for a sheet that should not read as draggable */
  showHandle?: boolean;
  /** stop the user dismissing by drag, e.g. mid-payment */
  disableDrag?: boolean;
  onSnap?: (index: number) => void;
  /** accessible name; a sheet with no visible title needs one */
  label?: string;
};

export function Sheet({
  open,
  onOpenChange,
  snapPoints = [0.9, 0.4],
  initialSnap = 1,
  children,
  className,
  showHandle = true,
  disableDrag = false,
  onSnap,
  label,
}: SheetProps) {
  // prefers-reduced-motion swaps the spring for a plain fade, everywhere
  const reducedMotion = useReducedMotion() ?? false;

  /*
   * react-modal-sheet 5 changed what snapPoints means. It now wants them
   * ASCENDING, starting at 0 (fully closed) and ending at 1 (fully open), and
   * it says so at runtime:
   *   "First snap point should be 0 to ensure the sheet can be fully closed."
   * Handed the old descending [0.9, 0.4] it opened at ~96% of the screen and
   * could not be dragged shut — the options sheet covered the room and had no
   * way out on a desktop.
   *
   * Callers still describe a sheet the way a person would: how much of the
   * screen it covers, biggest first, with initialSnap indexing that list. The
   * translation lives here so no call site has to know the library's rules.
   */
  const { points, snap } = React.useMemo(() => {
    const wanted = snapPoints.filter((p) => p > 0 && p < 1);
    const chosen =
      wanted[Math.min(Math.max(initialSnap, 0), wanted.length - 1)] ??
      wanted[0] ??
      0.9;
    const ascending = [0, ...[...new Set(wanted)].sort((a, b) => a - b), 1];
    return { points: ascending, snap: ascending.indexOf(chosen) };
  }, [snapPoints, initialSnap]);

  /*
   * A sheet you cannot dismiss is a sheet that owns the screen. Dragging it
   * down has always worked; tapping the dimmed room and pressing Escape did
   * not, which on a laptop left the options covering the room with no way out.
   */
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onOpenChange(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  return (
    <ModalSheet
      /*
       * The library defaults its root to z-index 9999, which put the backdrop
       * over the room-context strip: tapping a style chip while the options
       * were open hit the backdrop instead and just closed the sheet, so the
       * one edit the sheet exists to react to could not be made. The sheet
       * sits above the room and below the top chrome now.
       */
      style={{ zIndex: 30 }}
      isOpen={open}
      onClose={() => onOpenChange(false)}
      snapPoints={points}
      initialSnap={snap}
      onSnap={onSnap}
      disableDrag={disableDrag}
      prefersReducedMotion={reducedMotion}
      avoidKeyboard
      aria-label={label}
    >
      <ModalSheet.Container
        className={cn(
          "!rounded-t-3xl !bg-surface !shadow-[0_-8px_40px_rgb(0_0_0/0.18)]",
          "border-t border-line",
          className
        )}
      >
        {showHandle ? (
          <ModalSheet.Header
            className="flex h-8 shrink-0 items-center justify-center"
            disableDrag={disableDrag}
          >
            <div
              aria-hidden
              className="h-1 w-10 rounded-full bg-foreground/15"
            />
          </ModalSheet.Header>
        ) : null}

        <ModalSheet.Content className="min-h-0 flex-1">
          <div className="gutter pb-[max(24px,env(safe-area-inset-bottom))]">
            {children}
          </div>
        </ModalSheet.Content>
      </ModalSheet.Container>

      <ModalSheet.Backdrop
        onTap={() => {
          if (!disableDrag) onOpenChange(false);
        }}
        className="!bg-foreground/25 backdrop-blur-sm"
      />
    </ModalSheet>
  );
}

export default Sheet;
