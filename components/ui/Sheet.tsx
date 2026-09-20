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

  // initialSnap must stay inside snapPoints or the sheet opens off screen
  const snap = Math.min(Math.max(initialSnap, 0), snapPoints.length - 1);

  return (
    <ModalSheet
      isOpen={open}
      onClose={() => onOpenChange(false)}
      snapPoints={snapPoints}
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
