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
  const fieldId = React.useId();
  const titleId = React.useId();
  const helpId = React.useId();
  const dollars = Number(draft.replace(/[^\d.]/g, ""));
  const validAmount = Number.isFinite(dollars) && dollars > 0;

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
            data-pixx-budget-prompt=""
            className="pixx-dialog-pane pointer-events-auto w-full max-w-[26rem] rounded-none! p-6 font-sans"
            role="dialog"
            aria-labelledby={titleId}
          >
            <h2 id={titleId} className="text-[24px] font-medium leading-tight tracking-[-0.03em]">
              Set budget
            </h2>
            <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
              Choose a total for this room. You can change it any time.
            </p>

            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (validAmount) commit(dollars * 100);
              }}
              className="mt-5"
            >
              <label htmlFor={fieldId} className="mb-2 block text-[12px] font-medium">Total budget</label>
              <div className="relative">
                <span aria-hidden className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-[18px] text-muted-foreground">$</span>
                <input
                  id={fieldId}
                  ref={field}
                  value={draft}
                  onChange={(event) => setDraft(event.target.value.replace(/[^\d.]/g, ""))}
                  inputMode="decimal"
                  aria-label="Your budget, in dollars"
                  aria-describedby={helpId}
                  aria-invalid={draft.length > 0 && !validAmount ? true : undefined}
                  className="min-h-12 w-full rounded-none border border-line bg-white/75 py-2 pl-7 pr-14 font-sans text-[20px] tabular-nums text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/15"
                />
                <span aria-hidden className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-[11px] text-muted-foreground">USD</span>
              </div>
              <p id={helpId} className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
                {draft.length > 0 && !validAmount ? "Enter an amount greater than zero." : "$10 minimum."}
              </p>

              <div className="mt-3 grid grid-cols-3 gap-2" aria-label="Quick budgets">
                {PRESETS_CENTS.map((cents) => (
                  <button
                    key={cents}
                    type="button"
                    onClick={() => commit(cents)}
                    aria-label={`Set budget to ${money(cents)}`}
                    className={cn(
                      "min-h-9 cursor-pointer rounded-none border border-line bg-white/50 px-3 text-[13px] tabular-nums",
                      "transition-colors hover:border-accent hover:bg-accent/5 hover:text-accent",
                      FOCUS_RING
                    )}
                  >
                    {money(cents)}
                  </button>
                ))}
              </div>

              <div className="mt-5 flex items-center gap-2">
                <button
                  type="submit"
                  disabled={!validAmount}
                  className={cn(
                    "min-h-11 flex-1 cursor-pointer rounded-none border border-accent bg-accent px-4 text-[13px] font-medium text-white",
                    "transition-colors hover:bg-accent-bright disabled:cursor-not-allowed disabled:opacity-45",
                    FOCUS_RING
                  )}
                >
                  Set budget
                </button>
                <button
                  type="button"
                  onClick={() => setDismissed(true)}
                  className={cn(
                    "min-h-11 cursor-pointer rounded-none border border-line bg-white/40 px-4 text-[13px] text-muted-foreground",
                    "transition-colors hover:bg-white/80 hover:text-foreground",
                    FOCUS_RING
                  )}
                >
                  Skip
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>
  );
}
