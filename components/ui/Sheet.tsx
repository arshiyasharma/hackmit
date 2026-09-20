"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";

import { ENTER, EXIT, REDUCED } from "@/lib/motion";
import { cn } from "@/lib/utils";

/**
 * The ONLY modal surface in the app — and on a laptop it is a DIALOG, not a
 * bottom sheet (docs/ROOM3_PRODUCT_SPEC.md, 1b: "Dialogs, not bottom sheets").
 *
 * It used to be react-modal-sheet: a panel dragged up from the bottom edge of a
 * phone. PIXX-AR is a website used with a mouse and a keyboard now, so the same
 * props open a centred pane of clear glass over a quiet veil instead. The name
 * and the props stay exactly as they were, because the fit check, the doorway
 * measurements, the order mode, the budget nudge and the account panel all call
 * it — and none of them should have to know what it turned into.
 *
 * What a dialog owes the keyboard lives here once, so those five cannot drift:
 *   - focus moves in when it opens and goes back where it was when it closes;
 *   - Tab stays inside it;
 *   - Escape and a click on the veil close it, unless `disableDrag` says the
 *     shopper must not be able to walk away (mid-payment);
 *   - only the dialog on top answers — the fit check opens the measurements
 *     over itself, and one Escape must close one of them, not both.
 */

export type SheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** from the bottom-sheet days: how tall it rested. A dialog sizes to its content. */
  snapPoints?: number[];
  /** from the bottom-sheet days. Accepted, unused. */
  initialSnap?: number;
  children: React.ReactNode;

  /* optional, additive — the four props above are the contract */
  /** lands on the pane; `max-w-…` here widens it past the 46rem default */
  className?: string;
  /** from the bottom-sheet days: the grab handle. A dialog has none. */
  showHandle?: boolean;
  /** the shopper must not dismiss this: no Escape, no veil click, no close button */
  disableDrag?: boolean;
  /** from the bottom-sheet days. A dialog has no snaps, so this is never called. */
  onSnap?: (index: number) => void;
  /** accessible name; a dialog with no visible title needs one */
  label?: string;
};

/**
 * Which dialogs are open, oldest first. Module state on purpose: two `Sheet`s
 * in different corners of the tree have no other way to know who is on top.
 */
const stack: symbol[] = [];

function isOnTop(id: symbol): boolean {
  return stack[stack.length - 1] === id;
}

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

function focusablesIn(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    // display:none and hidden ancestors have no boxes; they cannot take focus
    (el) => el.getClientRects().length > 0
  );
}

/** False on the server and while hydrating, true after: a portal needs a body. */
function useHasDocument(): boolean {
  return React.useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );
}

export function Sheet({
  open,
  onOpenChange,
  children,
  className,
  disableDrag = false,
  label,
}: SheetProps) {
  const reduced = useReducedMotion() ?? false;
  const hasDocument = useHasDocument();

  const paneRef = React.useRef<HTMLDivElement | null>(null);
  // one identity per mounted dialog, for the "who is on top" stack
  const [id] = React.useState(() => Symbol("sheet"));

  // the caller's handler is usually an inline arrow; the listeners below must
  // not be torn down and re-added every time the parent renders
  const change = React.useRef(onOpenChange);
  React.useEffect(() => {
    change.current = onOpenChange;
  });

  /* focus in on open, back where it was on close */
  React.useEffect(() => {
    if (!open) return;
    const before =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    stack.push(id);
    // the pane itself, not its first button: opening a dialog should not light
    // a focus ring on "close" before the shopper has pressed a key
    const frame = window.requestAnimationFrame(() => {
      const pane = paneRef.current;
      if (pane && !pane.contains(document.activeElement)) {
        pane.focus({ preventScroll: true });
      }
    });

    return () => {
      window.cancelAnimationFrame(frame);
      const at = stack.indexOf(id);
      if (at !== -1) stack.splice(at, 1);
      if (before && before.isConnected) before.focus({ preventScroll: true });
    };
  }, [open, id]);

  /*
   * Escape, heard on `document` rather than on the pane: room III answers the
   * browser's Back button by dispatching an Escape there ("a dialog is up: Back
   * closes that first"), and that event never passes through the pane. Marking
   * it handled is what tells the room, and the listing tray under this dialog,
   * that this Escape has been spent.
   */
  React.useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (!isOnTop(id)) return;
      event.preventDefault();
      if (!disableDrag) change.current(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, id, disableDrag]);

  /*
   * Focus that lands behind the dialog comes back. Tab from the pane's edges is
   * caught below, but a click on the veil drops focus on <body>, and the next
   * Tab from there would walk the page underneath. Toasts are left alone: an
   * undo that appears while a dialog is up must still be reachable.
   */
  React.useEffect(() => {
    if (!open) return;
    const onFocusIn = (event: FocusEvent) => {
      if (!isOnTop(id)) return;
      const pane = paneRef.current;
      const target = event.target;
      if (!pane || !(target instanceof Element) || pane.contains(target)) return;
      if (target.closest("[data-sonner-toaster]")) return;
      pane.focus({ preventScroll: true });
    };
    document.addEventListener("focusin", onFocusIn);
    return () => document.removeEventListener("focusin", onFocusIn);
  }, [open, id]);

  /* Tab walks the dialog and nothing behind it */
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Tab") return;
    const pane = paneRef.current;
    // a dialog opened from inside this one is a React child through its portal,
    // so its keys bubble up to here; it keeps its own Tab
    if (!pane || !pane.contains(event.target as Node)) return;

    const stops = focusablesIn(pane);
    if (stops.length === 0) {
      event.preventDefault();
      pane.focus({ preventScroll: true });
      return;
    }
    const first = stops[0];
    const last = stops[stops.length - 1];
    const at = document.activeElement;

    if (event.shiftKey && (at === first || at === pane)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && at === last) {
      event.preventDefault();
      first.focus();
    }
  };

  if (!hasDocument) return null;

  const fade = reduced ? REDUCED : ENTER;
  const leave = reduced ? REDUCED : EXIT;

  return createPortal(
    <AnimatePresence>
      {open ? (
        <div
          key="dialog"
          data-pixx-dialog=""
          /*
           * 9999 is where react-modal-sheet used to put itself, and it is above
           * room III (z-index 200), whose body this is portalled beside. A
           * dialog is modal, so covering the top chrome is right; the listing
           * tray is the surface that must leave the style strip reachable, and
           * it is not a dialog.
           */
          className="fixed inset-0 z-[9999] grid place-items-center p-4 desk:p-8"
        >
          {/* a pale, cool veil — the room stays a room behind it, never a dark scrim */}
          <motion.div
            aria-hidden
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, transition: fade }}
            exit={{ opacity: 0, transition: leave }}
            onClick={() => {
              if (!disableDrag) onOpenChange(false);
            }}
            className={cn(
              "absolute inset-0 bg-slate-950/12 backdrop-blur-[4px]",
              !disableDrag && "cursor-pointer"
            )}
          />

          <motion.div
            ref={paneRef}
            role="dialog"
            aria-modal="true"
            aria-label={label}
            tabIndex={-1}
            onKeyDown={onKeyDown}
            initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1, transition: fade }}
            exit={
              reduced
                ? { opacity: 0, transition: leave }
                : { opacity: 0, scale: 0.98, transition: leave }
            }
            className={cn(
              "pixx-dialog-pane relative flex max-h-[86dvh] w-full max-w-[46rem] flex-col overflow-hidden rounded-none! font-sans outline-none",
              className
            )}
          >
            {disableDrag ? null : (
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                aria-label="Close"
                className={cn(
                  "absolute right-3 top-3 z-10 grid size-9 cursor-pointer place-items-center rounded-none",
                  "border border-line/80 bg-white/65 text-foreground transition-colors",
                  "hover:border-accent-pale hover:bg-accent-wash",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                )}
              >
                <X className="size-4" aria-hidden />
              </button>
            )}

            {/* Reserve the close-control row so every caller keeps a clear title. */}
            <div
              className={cn(
                "pixx-dialog-content min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-6 desk:px-7 desk:pb-7",
                disableDrag ? "pt-6 desk:pt-7" : "pt-14"
              )}
            >
              {children}
            </div>
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>,
    document.body
  );
}

export default Sheet;
