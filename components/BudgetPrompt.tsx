"use client";

import * as React from "react";
import { motion, useReducedMotion } from "motion/react";

import { money } from "@/components/BudgetHud";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";

/**
 * ONE QUESTION, ONCE, RIGHT AFTER THE PHOTO: what are you spending?
 *
 * The budget is the thing the rest of the screen plays against — every link
 * takes a bite out of it and the bar drains — and a number nobody chose is a
 * number nobody is playing against. So it is asked for while the room context
 * is still being read, which is dead time anyway, and never asked again: the
 * figure stays editable in the HUD for the rest of the session.
 *
 * SKIPPING IS A REAL ANSWER. The default stands, the loop runs, nothing is
 * blocked — the prompt is there to make the number yours, not to gate the demo
 * behind a form.
 *
 * Takes no props. Reads the store, like every other overlay on this screen.
 */

const PRESETS_CENTS = [30000, 60000, 120000];

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
  if (!open) return null;

  const commit = (cents: number) => {
    setBudget(Math.max(1000, Math.round(cents)));
  };

  return (
    <motion.div
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={reduced ? { duration: 0.15 } : { type: "spring", stiffness: 320, damping: 30 }}
      className={cn(
        "pointer-events-auto absolute inset-x-3 top-1/2 z-30 -translate-y-1/2",
        "rounded-3xl border border-line bg-surface/95 p-4 shadow-xl backdrop-blur-md"
      )}
      role="dialog"
      aria-label="Set your budget"
    >
      <h2 className="font-display text-xl">What are you spending?</h2>
      <p className="mt-1 text-[13px] text-muted-foreground">
        Every piece you pick comes out of this. You can change it any time.
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        {PRESETS_CENTS.map((cents) => (
          <button
            key={cents}
            type="button"
            onClick={() => commit(cents)}
            className={cn(
              "tap min-h-11 rounded-full border border-line px-4 text-sm",
              "transition-colors hover:bg-muted active:bg-muted"
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
        className="mt-3 flex items-center gap-2"
      >
        <span className="font-sans text-sm text-muted-foreground">$</span>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value.replace(/[^\d.]/g, ""))}
          inputMode="decimal"
          aria-label="Your budget, in dollars"
          className={cn(
            "min-h-11 w-28 rounded-xl border border-line bg-background px-3",
            "font-display text-lg outline-none focus:border-accent"
          )}
        />
        <button
          type="submit"
          className="tap min-h-11 rounded-full bg-accent px-5 text-sm text-background"
        >
          Set it
        </button>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="tap min-h-11 px-2 text-sm text-muted-foreground underline underline-offset-4"
        >
          Skip
        </button>
      </form>
    </motion.div>
  );
}
