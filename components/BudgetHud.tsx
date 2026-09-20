"use client";

import * as React from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { X } from "lucide-react";
import { toast } from "sonner";

import SavingsRail from "@/components/SavingsRail";
import { Delta, useDeltaQueue } from "@/components/ui/Delta";
import NumberPlate, { centsToUnits } from "@/components/ui/NumberPlate";
import { spentCents, useStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import type { PlacedItem } from "@/types";

/**
 * THE BUDGET HUD — top-right, always visible, reacting to every pick.
 *
 * One number, "$328 of $600", a thin bar underneath, and floating deltas beside
 * it. This is where the money reaction happens, because it is where the eye
 * already is while the sprite is being placed.
 *
 * THE TOTAL IS DERIVED, NEVER ACCUMULATED. `spentCents(items)` is read fresh on
 * every render, so removing an item drops the total with no bookkeeping and two
 * racing updates cannot drift it over a long demo.
 *
 * THE DELTAS ARE DERIVED TOO, and that is the whole trick of this file. Instead
 * of every call site remembering to announce itself, the HUD diffs the linked
 * price of each item against what it was on the last commit:
 *
 *   link    item had nothing, now has $49      -> +$49
 *   remove  item had $49, now gone             -> −$49
 *   relink  item had $49, now has $79          -> +$30, the DIFFERENCE
 *
 * A relink that flashed the full new price would make the running total
 * impossible to follow, which is exactly the thing a judge catches.
 *
 * Takes no props. Reads the store, like every other overlay on the room screen.
 * It positions itself fixed, at the right-hand edge of the app column, inside
 * the safe area and capped at 40% of the column — the room screen does not need
 * to place it, and should not wrap it in another positioned bar.
 */

/* ------------------------------------------------------------------- money */

function moneyFormat(cents: number) {
  const whole = Math.abs(cents) % 100 === 0;
  return {
    style: "currency" as const,
    currency: "USD",
    currencyDisplay: "narrowSymbol" as const,
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  };
}

/** Plain money for a label or a toast. Integer cents in, string out. */
export function money(cents: number): string {
  return new Intl.NumberFormat("en-US", moneyFormat(cents)).format(cents / 100);
}

/** What to call an item in a toast: "Floor lamp", "a tall lamp". */
export function itemLabel(item: PlacedItem): string {
  const raw = item.category?.trim() || item.request?.trim() || "Item";
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

/* ----------------------------------------------------------- the delta diff */

type Snapshot = Map<string, { cents: number; label: string }>;

function snapshot(items: PlacedItem[]): Snapshot {
  const map: Snapshot = new Map();
  for (const item of items) {
    if (!item.linkedProduct) continue;
    map.set(item.id, {
      cents: item.linkedProduct.priceCents,
      label: itemLabel(item),
    });
  }
  return map;
}

/**
 * Pushes one delta per item whose linked price changed since the last commit.
 * Several at once (a reset, a restored room) collapse into a single delta —
 * four amounts racing each other past the budget is noise, not information.
 */
function useLinkedPriceDeltas(
  items: PlacedItem[],
  push: (cents: number, label?: string) => void
) {
  const previous = React.useRef<Snapshot | null>(null);

  React.useEffect(() => {
    const next = snapshot(items);
    const before = previous.current;
    previous.current = next;

    // the first commit is the starting point, not a change
    if (!before) return;

    const changes: Array<{ cents: number; label: string }> = [];
    const ids = new Set<string>([...before.keys(), ...next.keys()]);
    for (const id of ids) {
      const was = before.get(id)?.cents ?? 0;
      const now = next.get(id)?.cents ?? 0;
      if (now === was) continue;
      changes.push({
        /*
         * SIGNED AGAINST THE BUDGET, not against the spend. Linking a $49 lamp
         * takes $49 out of what is left, so it reads "−$49"; removing it gives
         * the $49 back and reads "+$49". The number on screen and the bar
         * beside it move the same way, which is the whole point of showing it
         * where the money lives.
         */
        cents: was - now,
        label: next.get(id)?.label ?? before.get(id)?.label ?? "",
      });
    }

    if (changes.length === 0) return;

    if (changes.length > 2) {
      push(changes.reduce((sum, c) => sum + c.cents, 0));
      return;
    }
    for (const change of changes) push(change.cents, change.label);
  }, [items, push]);
}

/* ------------------------------------------------------------ remove + undo */

/**
 * The remove gesture, in one place, so the cross on the sprite's label and the
 * cross on a chip in the items strip behave identically.
 *
 * No confirmation dialog — removing is reversible, and the undo toast says so
 * for five seconds. The refund delta fires by itself, off the diff above.
 *
 *   const remove = useRemoveItem();
 *   <button onClick={() => remove(item.id)} />
 */
export function useRemoveItem(): (id: string) => void {
  const removeItem = useStore((s) => s.removeItem);
  const restoreItem = useStore((s) => s.restoreItem);

  return React.useCallback(
    (id: string) => {
      const { items } = useStore.getState();
      const index = items.findIndex((i) => i.id === id);
      if (index === -1) return;
      const item = items[index];

      removeItem(id);

      toast(`${itemLabel(item)} removed`, {
        duration: 5000,
        action: {
          label: "Undo",
          // back in its old slot, with its listing and its position intact
          onClick: () => restoreItem(item, index),
        },
      });
    },
    [removeItem, restoreItem]
  );
}

/**
 * The cross itself. 44px of tap target around a 12px mark, so it is reachable
 * on a sprite label and on a chip without either of them growing.
 */
export function RemoveButton({
  itemId,
  label,
  className,
}: {
  itemId: string;
  label?: string;
  className?: string;
}) {
  const remove = useRemoveItem();
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        remove(itemId);
      }}
      aria-label={label ? `Remove ${label}` : "Remove this item"}
      className={cn(
        "tap inline-flex size-6 shrink-0 items-center justify-center rounded-full",
        "border border-line bg-surface/85 text-muted-foreground backdrop-blur-sm",
        "transition-colors hover:bg-muted active:bg-muted",
        className
      )}
    >
      <X className="size-3" aria-hidden />
    </button>
  );
}

/* ---------------------------------------------------------------- the budget */

/** Tap "of $600" and it becomes this. Dollars in, integer cents out. */
function BudgetField({
  budgetCents,
  onCommit,
  onClose,
}: {
  budgetCents: number;
  onCommit: (cents: number) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = React.useState(() =>
    String(Math.round(budgetCents / 100))
  );
  const cancelled = React.useRef(false);

  return (
    <span className="inline-flex items-baseline gap-1">
      <span className="font-sans text-[11px] text-muted-foreground">of $</span>
      <input
        // the tap that opened this field asked for the keyboard
        autoFocus
        type="text"
        inputMode="decimal"
        value={draft}
        aria-label="Budget, in dollars"
        onChange={(e) => setDraft(e.target.value.replace(/[^\d.]/g, ""))}
        onBlur={() => {
          if (cancelled.current) {
            cancelled.current = false;
            onClose();
            return;
          }
          const dollars = Number.parseFloat(draft);
          if (Number.isFinite(dollars) && dollars >= 0) {
            onCommit(Math.round(dollars * 100));
          }
          onClose();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            cancelled.current = true;
            e.currentTarget.blur();
          }
        }}
        className={cn(
          "tabular h-9 w-16 rounded-lg border border-line bg-background px-1.5",
          "font-display text-sm font-semibold text-foreground",
          "outline-none focus:border-accent"
        )}
      />
    </span>
  );
}

/* ------------------------------------------------------------------ the HUD */

export function BudgetHud() {
  const items = useStore((s) => s.items);
  const budgetCents = useStore((s) => s.budgetCents);
  const setBudget = useStore((s) => s.setBudget);
  const reduced = useReducedMotion();

  /* derived every render — the only way this number is ever produced */
  const spent = spentCents(items);
  const overCents = Math.max(0, spent - budgetCents);
  /*
   * WHAT IS LEFT, not what is gone. The budget reads like a health bar: it
   * starts full, every link takes a bite out of it, and removing something
   * gives it back. "$272 left" is the number a person acts on; "$328 spent"
   * is the number an accountant does.
   */
  const leftCents = budgetCents - spent;
  const ratio = budgetCents > 0 ? spent / budgetCents : spent > 0 ? 1 : 0;
  const warn = ratio >= 0.9;
  // the bar DRAINS: full budget is a full bar, and spending empties it
  const fillPercent = Math.max(0, Math.min(100, (1 - ratio) * 100));

  const { current, push, done } = useDeltaQueue();
  useLinkedPriceDeltas(items, push);

  const [editing, setEditing] = React.useState(false);
  const [counters, setCounters] = React.useState(false);

  const spring = reduced
    ? ({ duration: 0.15 } as const)
    : ({ type: "spring", stiffness: 420, damping: 34 } as const);

  /*
   * NO LONGER POSITIONED HERE. The budget used to float absolutely in the
   * top-right while the room-context strip was capped at 58% beside it, which
   * left a 2% gutter between them — so a wide total ("$1,240 of $1,500") sat on
   * top of the strip's pinned "+". Both now live in one flex row owned by
   * app/room/page.tsx, where they cannot overlap by construction: the strip
   * takes the space that is left and scrolls its own contents.
   */
  return (
    <div className="pointer-events-none flex shrink-0 justify-end">
      <div className="contents">
        {/* the deltas and the counters panel hang off this box */}
        <div className="pointer-events-auto relative flex max-w-[60vw] flex-col items-end">
          <div
            className={cn(
              "w-full min-w-[8rem] rounded-2xl border border-line",
              "bg-surface/85 px-3 py-2 text-right shadow-sm backdrop-blur-md"
            )}
          >
            <div className="flex flex-wrap items-baseline justify-end gap-x-1.5">
              <button
                type="button"
                onClick={() => setCounters((open) => !open)}
                aria-expanded={counters}
                aria-label={
                  overCents > 0
                    ? `Over budget by ${money(overCents)}. Show what you're saving.`
                    : `${money(leftCents)} left of ${money(
                        budgetCents
                      )}. Show what you're saving.`
                }
                className="tap -my-1 py-1 leading-none"
              >
                <NumberPlate
                  value={centsToUnits(Math.abs(leftCents))}
                  size="md"
                  tone={overCents > 0 ? "warn" : "default"}
                  format={moneyFormat(leftCents)}
                />
              </button>

              {editing ? (
                <BudgetField
                  budgetCents={budgetCents}
                  onCommit={setBudget}
                  onClose={() => setEditing(false)}
                />
              ) : (
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  aria-label={`Budget ${money(budgetCents)}. Tap to change it.`}
                  className={cn(
                    "tap -my-1 rounded-md py-1 font-sans text-[11px]",
                    "text-muted-foreground underline decoration-line underline-offset-4",
                    "transition-colors hover:text-foreground"
                  )}
                >
                  {overCents > 0 ? "over" : "left"} of {money(budgetCents)}
                </button>
              )}
            </div>

            {/* the bar: accent while there is room, warn once it runs out */}
            <div
              className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-foreground/10"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={Math.round(budgetCents / 100)}
              aria-valuenow={Math.round(Math.max(0, leftCents) / 100)}
              aria-label="Budget left"
            >
              <motion.div
                className={cn(
                  "h-full rounded-full",
                  warn ? "bg-warn" : "bg-accent"
                )}
                initial={false}
                animate={{ width: `${fillPercent}%` }}
                transition={spring}
              />
            </div>
          </div>

          {/* the truth, not a clamp: one line, no modal, no suggestions panel */}
          <AnimatePresence initial={false}>
            {overCents > 0 ? (
              <motion.p
                key="over"
                initial={reduced ? { opacity: 0 } : { opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={spring}
                className="mt-1 pr-1 text-right text-[11px] font-medium text-warn"
              >
                Over by {money(overCents)}
              </motion.p>
            ) : null}
          </AnimatePresence>

          {/* +$49 springs up beside the HUD; −$49 falls. One at a time. */}
          {current ? (
            <Delta
              key={current.key}
              cents={current.cents}
              label={current.label}
              onDone={done}
              className="right-full top-full mr-2 -mt-12 whitespace-nowrap"
            />
          ) : null}

          {/* OPTIONAL KEEP: the sponsor counters, one tap behind the number */}
          <AnimatePresence initial={false}>
            {counters ? (
              <motion.div
                key="counters"
                initial={
                  reduced
                    ? { opacity: 0 }
                    : { opacity: 0, y: -8, scale: 0.98 }
                }
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={reduced ? { opacity: 0 } : { opacity: 0, y: -8 }}
                transition={spring}
                className={cn(
                  "absolute right-0 top-full z-10 mt-2 w-64",
                  "max-w-[calc(100vw-2rem)] rounded-2xl border border-line",
                  "bg-surface/95 p-3 text-left shadow-lg backdrop-blur-md"
                )}
              >
                <SavingsRail />
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

export default BudgetHud;
