"use client";

import * as React from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";

import { money } from "@/components/BudgetHud";
import { ENTER, EXIT, REDUCED } from "@/lib/motion";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";

/**
 * ONE QUESTION, ONCE, RIGHT AFTER THE PHOTO: what are you spending?
 *
 * The budget is the thing the rest of the screen plays against — every link
 * moves the bar towards it — and a number nobody chose is a number nobody is
 * playing against. So it is asked for while the room context is still being
 * read, which is dead time anyway, and never asked again: the figure stays
 * editable under THE NUMBER for the rest of the session.
 *
 * SKIPPING IS A REAL ANSWER. The default stands, the loop runs, nothing is
 * blocked — the prompt is there to make the number yours, not to gate the demo
 * behind a form. That is also why it is not modal: no scrim, the room stays
 * lit behind it, and the ask in the panel still works.
 *
 * On a laptop it is a glass dialog standing in the middle of the ROOM, not of
 * the window: it centres in the free area the page publishes (`--stage-right`
 * is the agent panel's share), so it never slides under the panel. The field
 * takes the keyboard — type a figure, Enter — and Escape is Skip.
 *
 * Takes no props. Reads the store, like every other overlay on this screen.
 */

const PRESETS_CENTS = [30000, 60000, 120000];

const FOCUS_RING =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

export default function BudgetPrompt() {
  const roomImage = useStore((s) => s.roomImage);
  const budgetSet = useStore((s) => s.budgetSet);
  const budgetCents = useStore((s) => s.budgetCents);
  const setBudget = useStore((s) => s.setBudget);
  const items = useStore((s) => s.items);
  const reduced = useReducedMotion();

  const [draft, setDraft] = React.useState(() =>
    String(Math.round(budgetCents / 100))
  );
  const [dismissed, setDismissed] = React.useState(false);

  // asked once: a photo exists, nothing is placed yet, and nobody has chosen
  const open = !!roomImage && !budgetSet && !dismissed && items.length === 0;

  const commit = (cents: number) => {
    setBudget(Math.max(1000, Math.round(cents)));
  };

  /*
   * Escape is Skip. Listened for on `window` rather than on the dialog, because
   * room III turns the browser's Back into an Escape it dispatches on
   * `document`, above anything React hears. While this is up its
   * `role="dialog"` is also what tells room III that the key is not a request
   * to leave the product.
   */
  React.useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDismissed(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  /* focus goes in when it opens, and back where it was when it goes */
  const field = React.useRef<HTMLInputElement | null>(null);
  React.useEffect(() => {
    if (!open) return;
    const before =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    field.current?.focus({ preventScroll: true });
    field.current?.select();
    return () => {
      if (before && before !== document.body && before.isConnected) {
        before.focus({ preventScroll: true });
      }
    };
  }, [open]);

  return (
    <AnimatePresence>
      {open ? (
        <div
          key="budget-prompt"
          // the glass sets its own `position`, so the placing is this box's job
          className="pointer-events-none absolute inset-y-0 left-0 z-30 grid place-items-center p-4"
          style={{ right: "var(--stage-right, 0px)" }}
        >
          <motion.div
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, transition: reduced ? REDUCED : EXIT }}
            transition={reduced ? REDUCED : ENTER}
            className={cn(
              "glass-thick glass-sheen pointer-events-auto w-full max-w-[34rem]",
              "rounded-[28px]! p-7 desk:p-9"
            )}
            role="dialog"
            aria-label="Set your budget"
          >
            <p className="eyebrow text-accent">The budget</p>
            <h2 className="mt-3 font-display text-[40px] leading-none font-normal tracking-[0.01em] desk:text-[48px]">
              What are you spending?
            </h2>
            <p className="mt-3 max-w-[44ch] text-[15px] leading-relaxed text-muted-foreground">
              Every piece you pick comes out of this. You can change it any time.
            </p>

            <div className="mt-6 flex flex-wrap gap-2.5">
              {PRESETS_CENTS.map((cents) => (
                <button
                  key={cents}
                  type="button"
                  onClick={() => commit(cents)}
                  className={cn(
                    "tap tabular min-h-11 cursor-pointer rounded-full border border-line bg-surface/70 px-5",
                    "font-mono text-[15px] text-foreground",
                    "transition-colors hover:border-accent hover:bg-accent-wash hover:text-accent",
                    "active:bg-accent-wash",
                    FOCUS_RING
                  )}
                >
                  {money(cents)}
                </button>
              ))}
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                const dollars = Number(draft.replace(/[^\d.]/g, ""));
                if (Number.isFinite(dollars) && dollars > 0) commit(dollars * 100);
              }}
              className="mt-4 flex flex-wrap items-center gap-2.5"
            >
              <label className="flex items-center gap-2">
                <span aria-hidden className="font-mono text-[15px] text-muted-foreground">
                  $
                </span>
                <input
                  ref={field}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value.replace(/[^\d.]/g, ""))}
                  inputMode="decimal"
                  aria-label="Your budget, in dollars"
                  className={cn(
                    "tabular min-h-11 w-[12ch] rounded-xl border border-line bg-surface px-3",
                    "font-mono text-lg text-foreground",
                    "outline-none focus:border-accent focus:ring-2 focus:ring-accent/25"
                  )}
                />
              </label>
              <button
                type="submit"
                className={cn(
                  "glass-blue tap min-h-11 cursor-pointer rounded-full! px-6 text-sm font-medium",
                  "transition-transform hover:-translate-y-px active:translate-y-px",
                  FOCUS_RING
                )}
              >
                Set it
              </button>
              <button
                type="button"
                onClick={() => setDismissed(true)}
                className={cn(
                  "tap min-h-11 cursor-pointer rounded-md px-2 text-sm text-muted-foreground",
                  "underline decoration-line underline-offset-4",
                  "transition-colors hover:text-foreground hover:decoration-foreground/40",
                  FOCUS_RING
                )}
              >
                Skip
              </button>
            </form>
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>
  );
}
