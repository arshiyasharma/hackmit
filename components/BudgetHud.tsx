"use client";

import * as React from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ChevronDown, Pencil, X } from "lucide-react";
import { toast } from "sonner";

import SavingsRail from "@/components/SavingsRail";
import { Delta, useDeltaQueue } from "@/components/ui/Delta";
import NumberPlate, { centsToUnits } from "@/components/ui/NumberPlate";
import { COUNT, DUR, EASE, ENTER, EXIT, REDUCED, SCRUB } from "@/lib/motion";
import { previewDeltaCents, usePreview } from "@/lib/preview";
import { spentCents, useStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import type { PlacedItem } from "@/types";

/**
 * THE NUMBER — beat 06 of the motion sheet, and the game the room is played
 * against.
 *
 * One figure, "$328 of $600", a bar filling towards the mark underneath, and
 * floating deltas beside it. On a laptop it is the head of the agent panel
 * (`docked`): the figure large, in mono, with everything it can do one click
 * away. This is where the money reaction happens, because the panel is where
 * the eye already is while a listing is being chosen.
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
 * A PREVIEW IS NEVER A FACT. While a listing in the tray is being looked at
 * (lib/preview.ts) the bar grows a pale ghost and a quiet "+$214?" stands
 * beside the figure. Neither touches the figure itself, and both are gone the
 * instant the preview clears.
 *
 * It reads the store, like every other overlay on the room screen, and it never
 * positions itself: `docked` it is a full-width block in the panel's flow;
 * without it, a glass pill that sits wherever the page's top row puts it.
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

/** The ghost beside the figure: "+$214?", "-$19?". Signed, and asking. */
function ghostMoney(cents: number): string {
  return `${new Intl.NumberFormat("en-US", {
    ...moneyFormat(cents),
    signDisplay: "exceptZero",
  }).format(cents / 100)}?`;
}

/** A keyboard has to be able to see where it is: the accent, two pixels. */
const FOCUS_RING =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

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
         * SIGNED AS PROGRESS. Linking a $49 lamp moves the bar $49 closer to
         * the mark, so it reads "+$49"; removing it gives that progress back
         * and reads "−$49". The floating number and the bar beneath it move
         * the same way, which is the whole point of putting them together.
         */
        cents: now - was,
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
 * The cross itself. 44px of hit area around a 12px mark, so it is reachable on
 * a sprite label and on a chip without either of them growing.
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
        "tap inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-full",
        "border border-line bg-surface/85 text-muted-foreground",
        "transition-colors hover:border-foreground/25 hover:bg-surface hover:text-foreground",
        "active:bg-muted",
        FOCUS_RING,
        className
      )}
    >
      <X className="size-3" aria-hidden />
    </button>
  );
}

/* ---------------------------------------------------------------- the budget */

/** Click "of $600" and it becomes this. Dollars in, integer cents out. */
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
      <span className="font-mono text-[13px] text-muted-foreground">of $</span>
      <input
        // the click that opened this field asked for the keyboard
        autoFocus
        type="text"
        inputMode="decimal"
        value={draft}
        aria-label="Budget, in dollars"
        // typing replaces the old figure, the way a laptop field is expected to
        onFocus={(e) => e.currentTarget.select()}
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
            /*
             * This Escape belongs to the field. Blurring moves focus off the
             * input before the key reaches `window`, where room III reads a
             * bare Escape as "leave the product" — so it stops here.
             */
            e.preventDefault();
            e.stopPropagation();
            cancelled.current = true;
            e.currentTarget.blur();
          }
        }}
        className={cn(
          "tabular h-9 w-[9ch] rounded-lg border border-line bg-surface px-2",
          "font-mono text-[15px] text-foreground",
          "outline-none focus:border-accent focus:ring-2 focus:ring-accent/25"
        )}
      />
    </span>
  );
}

/* -------------------------------------------------------------------- the bar */

/**
 * The bar FILLS towards the mark. Nothing here animates a width: the fill is a
 * full-length capsule slid in from the left, and the ghosts are full-length
 * layers cut to their span with a clip path, so every change is a transform or
 * a clip and the track never re-lays itself out.
 *
 * Bottom to top: the ghost of what a listing would add, the part of that ghost
 * that would go past the mark, the real fill, the ghost of what a cheaper
 * listing would give back (it has to sit ON the fill to be seen), and the one
 * flash of `ok` for getting back under.
 */
function BudgetBar({
  spent,
  budgetCents,
  ghostCents,
  tone,
  flashKey,
  className,
}: {
  spent: number;
  budgetCents: number;
  /** signed; null when nothing is being previewed */
  ghostCents: number | null;
  tone: "accent" | "ok" | "warn";
  /** changes once per earned "back under"; null when there is none */
  flashKey: number | null;
  className?: string;
}) {
  const reduced = useReducedMotion();

  const percent = (cents: number) =>
    budgetCents > 0
      ? Math.max(0, Math.min(100, (cents / budgetCents) * 100))
      : cents > 0
        ? 100
        : 0;

  const fill = percent(spent);
  const would = ghostCents === null ? spent : spent + ghostCents;
  const wouldFill = percent(would);

  /* what linking it would ADD: from the end of the fill to where it would end */
  const adds = ghostCents !== null && ghostCents > 0 && wouldFill > fill;
  /* and how much of that span is money past the mark, drawn from the far end */
  const overShare =
    adds && would > budgetCents && ghostCents
      ? Math.min(1, (would - budgetCents) / ghostCents)
      : 0;
  const overStart = 100 - overShare * (100 - fill);
  /* what a cheaper listing would GIVE BACK: the tail of the fill */
  const returns = ghostCents !== null && ghostCents < 0 && wouldFill < fill;

  const span = (from: number, to: number) =>
    `inset(0% ${100 - to}% 0% ${from}%)`;
  const ghostMotion = reduced ? REDUCED : { ...SCRUB, opacity: { duration: DUR.micro } };

  return (
    <div
      className={cn(
        "relative h-1.5 w-full overflow-hidden rounded-full bg-foreground/10",
        className
      )}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={Math.round(budgetCents / 100)}
      aria-valuenow={Math.round(spent / 100)}
      aria-label="Budget used"
    >
      {/* no exit on any ghost: a preview that lingers would read as a fact */}
      {adds ? (
        <motion.div
          key="ghost-adds"
          aria-hidden
          className="absolute inset-0 bg-accent-pale"
          initial={{ opacity: 0, clipPath: reduced ? span(fill, wouldFill) : span(fill, fill) }}
          animate={{ opacity: 1, clipPath: span(fill, wouldFill) }}
          transition={ghostMotion}
        />
      ) : null}
      {adds && overShare > 0 ? (
        <motion.div
          key="ghost-over"
          aria-hidden
          className="absolute inset-0 bg-warn/40"
          initial={{ opacity: 0, clipPath: reduced ? span(overStart, 100) : span(100, 100) }}
          animate={{ opacity: 1, clipPath: span(overStart, 100) }}
          transition={ghostMotion}
        />
      ) : null}

      <motion.div
        className={cn(
          "absolute inset-0 rounded-full",
          // accent on the way there, ok at the mark, warn past it
          tone === "warn" ? "bg-warn" : tone === "ok" ? "bg-ok" : "bg-accent"
        )}
        initial={false}
        animate={{ x: `${fill - 100}%` }}
        transition={reduced ? REDUCED : COUNT}
      />

      {returns ? (
        <motion.div
          key="ghost-returns"
          aria-hidden
          className="absolute inset-0 bg-accent-pale"
          initial={{ opacity: 0, clipPath: reduced ? span(wouldFill, fill) : span(fill, fill) }}
          animate={{ opacity: 1, clipPath: span(wouldFill, fill) }}
          transition={ghostMotion}
        />
      ) : null}

      {flashKey !== null && !reduced ? (
        <motion.div
          key={`flash-${flashKey}`}
          aria-hidden
          className="absolute inset-0 bg-ok"
          initial={{ opacity: 0 }}
          animate={{ opacity: [0, 0.75, 0] }}
          transition={{ duration: DUR.element, ease: EASE.out }}
        />
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------- back under it */

/**
 * THE ONE EARNED MOMENT. Going past the mark is said plainly and stays said;
 * bringing the room back under it — by unlinking something, or by choosing a
 * cheaper one — is the only thing on this screen that is rewarded, and it is
 * rewarded once: this chip rises, holds for a beat and leaves, while the bar
 * flashes `ok` under it. No confetti and no sound. Moving the mark itself does
 * not earn it.
 */
function BackUnderChip({
  toGoCents,
  onDone,
}: {
  toGoCents: number;
  onDone: () => void;
}) {
  const reduced = useReducedMotion();
  const [phase, setPhase] = React.useState<"in" | "out">("in");

  // read from a ref so a new closure on a parent render cannot restart the hold
  const done = React.useRef(onDone);
  React.useEffect(() => {
    done.current = onDone;
  }, [onDone]);

  React.useEffect(() => {
    const timer = window.setTimeout(() => setPhase("out"), DUR.scene * 1000);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <>
      <span role="status" className="sr-only">
        Back under budget. {money(toGoCents)} to go.
      </span>
      <motion.span
        aria-hidden
        initial={{ opacity: 0, y: reduced ? 0 : 8 }}
        animate={
          phase === "in"
            ? { opacity: 1, y: 0 }
            : { opacity: 0, y: reduced ? 0 : -8 }
        }
        transition={reduced ? REDUCED : phase === "in" ? ENTER : EXIT}
        onAnimationComplete={() => {
          if (phase === "out") done.current();
        }}
        className={cn(
          "glass-pill pointer-events-none inline-flex items-center px-2.5 py-1 select-none",
          "tabular font-mono text-[11px] whitespace-nowrap text-ok"
        )}
      >
        back under · {money(toGoCents)} to go
      </motion.span>
    </>
  );
}

/* ------------------------------------------------------------------ the HUD */

export type BudgetHudProps = {
  /**
   * The laptop's agent panel mounts it in normal flow, at the head of a glass
   * column: a full-width block with no glass of its own, the figure large.
   * Without it, it is a glass pill for a row across the top of the room.
   */
  docked?: boolean;
};

export function BudgetHud({ docked = false }: BudgetHudProps) {
  const items = useStore((s) => s.items);
  const budgetCents = useStore((s) => s.budgetCents);
  const setBudget = useStore((s) => s.setBudget);
  const reduced = useReducedMotion();
  const panelId = React.useId();

  /* derived every render — the only way this number is ever produced */
  const spent = spentCents(items);
  const overCents = Math.max(0, spent - budgetCents);
  /*
   * A TARGET TO REACH, not a tank to drain.
   *
   * "$251 left" made every pick feel like losing something. The same two
   * numbers read the other way round — "$49 of $300", a bar filling towards
   * the mark — make furnishing the room the thing you are progressing at, and
   * the budget the finish line rather than the fuel. Going past it is still
   * said plainly, because that part is not a game.
   */

  const ratio = budgetCents > 0 ? spent / budgetCents : spent > 0 ? 1 : 0;
  /** within a tenth of the target, or past it: the room is furnished */
  const met = ratio >= 0.9;
  const tone = overCents > 0 ? "warn" : met ? "ok" : "accent";

  /*
   * THE MARK IS A MOMENT, and it happens once. Crossing 90% of the budget is
   * the closest this screen gets to finishing something, so it says so — once,
   * in a toast that goes away — rather than adding a third permanent readout
   * to a screen that is allowed two. Dropping back under arms it again.
   */
  const announced = React.useRef(false);
  React.useEffect(() => {
    if (met && !announced.current) {
      announced.current = true;
      toast(overCents > 0 ? "Budget met — and then some" : "Budget met", {
        id: "visa-budget-met",
        description:
          overCents > 0
            ? `${money(spent)} against ${money(budgetCents)}`
            : `${money(spent)} of ${money(budgetCents)} — the room is furnished`,
      });
      if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
        navigator.vibrate([8, 40, 12]);
      }
    }
    if (!met) announced.current = false;
  }, [met, overCents, spent, budgetCents]);

  const { current, push, done } = useDeltaQueue();
  useLinkedPriceDeltas(items, push);

  const [editing, setEditing] = React.useState(false);
  const [counters, setCounters] = React.useState(false);

  /*
   * BACK UNDER, noticed while rendering rather than in an effect: the total is
   * derived, so "it was over and now it is not" is a comparison with the last
   * figures this component drew, and React's own pattern for that is to keep
   * them in state and adjust during render.
   */
  const [seen, setSeen] = React.useState({ spent, budgetCents });
  /** counts the rewards, so each one is its own chip and its own flash */
  const [reward, setReward] = React.useState<number | null>(null);
  if (seen.spent !== spent || seen.budgetCents !== budgetCents) {
    setSeen({ spent, budgetCents });
    const wasOver = seen.spent > seen.budgetCents;
    if (spent > budgetCents) {
      // over again: a chip still saying "back under" would be a lie
      if (reward !== null) setReward(null);
    } else if (wasOver && seen.budgetCents === budgetCents && budgetCents > 0) {
      // earned by a removal or a cheaper listing, not by moving the mark
      setReward((count) => (count ?? 0) + 1);
    }
  }
  const clearReward = React.useCallback(() => setReward(null), []);

  /* the listing being looked at in the tray, and what it would do to the total */
  const previewItemId = usePreview((s) => s.itemId);
  const previewProduct = usePreview((s) => s.product);
  const ghostRaw = previewDeltaCents(items, {
    itemId: previewItemId,
    product: previewProduct,
  });
  // the same price is not news, and a ghost of nothing is noise
  const ghostCents = ghostRaw === 0 ? null : ghostRaw;
  const ghostOver = ghostCents !== null && spent + ghostCents > budgetCents;

  /*
   * Escape closes the counters, and only the counters. Inside room III a bare
   * Escape on `window` means "leave the product"; the capture phase gets there
   * first and marks the key as spent. A dialog, or a field being typed in,
   * keeps its own Escape.
   */
  React.useEffect(() => {
    if (!counters) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
      if (document.querySelector("[role='dialog'], .react-modal-sheet-container")) return;
      event.preventDefault();
      setCounters(false);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [counters]);

  const enter = reduced ? REDUCED : ENTER;
  const leave = reduced ? REDUCED : EXIT;

  /* ---- the pieces both arrangements are made of ---- */

  const figure = (
    <button
      type="button"
      onClick={() => setCounters((open) => !open)}
      aria-expanded={counters}
      aria-controls={panelId}
      title="What you're saving"
      aria-label={
        overCents > 0
          ? `${money(spent)} of ${money(budgetCents)}, over by ${money(
              overCents
            )}. Show what you're saving.`
          : `${money(spent)} of ${money(budgetCents)}. Show what you're saving.`
      }
      className={cn(
        "tap -mx-1.5 -my-1 cursor-pointer rounded-xl px-1.5 py-1 text-left leading-none",
        "transition-colors hover:bg-accent-wash",
        // the figure keeps its place while the digits come and go
        docked ? "min-w-[4ch]" : "min-w-[3ch]",
        FOCUS_RING
      )}
    >
      <NumberPlate
        value={centsToUnits(spent)}
        size={docked ? "xl" : "md"}
        tone={overCents > 0 ? "warn" : met ? "ok" : "default"}
        format={moneyFormat(spent)}
      />
    </button>
  );

  const budgetControl = editing ? (
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
      title="Change the budget"
      className={cn(
        "group tap -my-1 inline-flex cursor-pointer items-baseline gap-1.5 rounded-md py-1",
        "tabular font-mono text-muted-foreground",
        docked ? "text-[13px]" : "text-[11px]",
        "underline decoration-accent-pale decoration-dotted underline-offset-4",
        "transition-colors hover:text-foreground hover:decoration-accent",
        FOCUS_RING
      )}
    >
      of {money(budgetCents)}
      {docked ? (
        <Pencil
          aria-hidden
          className={cn(
            "size-3 self-center text-accent opacity-0 transition-opacity",
            "group-hover:opacity-100 group-focus-visible:opacity-100"
          )}
        />
      ) : null}
    </button>
  );

  /* never in the figure's way: it has its own seat, and the figure does not move */
  const ghost =
    ghostCents !== null ? (
      <motion.span
        key="ghost"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={reduced ? REDUCED : { duration: DUR.micro }}
        className={cn(
          "tabular font-mono whitespace-nowrap",
          docked ? "text-[13px]" : "text-[11px]",
          ghostOver
            ? "text-warn"
            : ghostCents > 0
              ? "text-accent"
              : "text-muted-foreground"
        )}
      >
        <span className="sr-only">Looking at a listing. It would change the total by </span>
        {ghostMoney(ghostCents)}
      </motion.span>
    ) : null;

  const bar = (
    <BudgetBar
      spent={spent}
      budgetCents={budgetCents}
      ghostCents={ghostCents}
      tone={tone}
      flashKey={reward}
      className={docked ? "mt-3" : "mt-1.5 h-1"}
    />
  );

  /* ------------------------------------------------ docked: THE NUMBER */

  if (docked) {
    return (
      /*
       * No padding, no hairline, no glass: the panel pads its children and rules
       * a line over the conversation below, and this block is already standing
       * on the panel's glass.
       */
      <section
        aria-label="Budget"
        className="pointer-events-auto relative w-full shrink-0"
      >
        <div className="flex items-center justify-between gap-3">
          <p className="eyebrow text-muted-foreground">The number</p>
          <button
            type="button"
            onClick={() => setCounters((open) => !open)}
            aria-expanded={counters}
            aria-controls={panelId}
            aria-label={
              counters ? "Hide what you're saving" : "Show what you're saving"
            }
            className={cn(
              "eyebrow -my-1 inline-flex cursor-pointer items-center gap-1 rounded-md py-1",
              "text-muted-foreground transition-colors hover:text-accent",
              FOCUS_RING
            )}
          >
            Savings
            <motion.span
              aria-hidden
              className="inline-flex"
              initial={false}
              animate={{ rotate: counters ? 180 : 0 }}
              transition={reduced ? REDUCED : { duration: DUR.micro, ease: EASE.out }}
            >
              <ChevronDown className="size-3" />
            </motion.span>
          </button>
        </div>

        <div className="mt-2.5 flex flex-wrap items-baseline gap-x-3 gap-y-1.5">
          {figure}

          {/*
            THE GHOST'S SEAT, and where the deltas lift off from: "+$214?" while
            a listing is being looked at, then "+$214" rising from the same spot
            once it is linked. It is always here, empty or not, so nothing on
            this row shifts when the ghost comes and goes.
          */}
          <span className="relative inline-flex min-w-[7ch] items-baseline font-mono text-[13px]">
            {ghost ?? <span aria-hidden>&#8203;</span>}
            {current ? (
              <Delta
                key={current.key}
                cents={current.cents}
                label={current.label}
                onDone={done}
                className="top-auto right-auto bottom-full left-0 mb-1 whitespace-nowrap"
              />
            ) : null}
          </span>

          <span className="ml-auto inline-flex items-baseline">{budgetControl}</span>
        </div>

        {bar}

        <div className="relative mt-2.5 flex min-h-5 items-center">
          {/* the truth, not a clamp: one line, no modal, nothing removed */}
          <AnimatePresence initial={false} mode="wait">
            {overCents > 0 ? (
              <motion.p
                key="over"
                initial={reduced ? { opacity: 0 } : { opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, transition: leave }}
                transition={enter}
                className="flex items-baseline gap-1.5 font-mono text-[12px] text-warn"
              >
                Over by
                <NumberPlate
                  value={centsToUnits(overCents)}
                  size="xs"
                  tone="warn"
                  format={moneyFormat(overCents)}
                />
              </motion.p>
            ) : (
              <motion.p
                key="to-go"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0, transition: leave }}
                transition={enter}
                className="flex items-baseline gap-1.5 font-mono text-[12px] text-muted-foreground"
              >
                <NumberPlate
                  value={centsToUnits(budgetCents - spent)}
                  size="xs"
                  tone="muted"
                  format={moneyFormat(budgetCents - spent)}
                />
                to go
              </motion.p>
            )}
          </AnimatePresence>

          {reward !== null ? (
            <span className="absolute top-1/2 right-0 -translate-y-1/2">
              <BackUnderChip
                key={reward}
                toGoCents={budgetCents - spent}
                onDone={clearReward}
              />
            </span>
          ) : null}
        </div>

        {/* OPTIONAL KEEP: the sponsor counters, one click behind the number */}
        <AnimatePresence initial={false}>
          {counters ? (
            <motion.div
              key="counters"
              id={panelId}
              initial={reduced ? { opacity: 0 } : { opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={
                reduced
                  ? { opacity: 0, transition: leave }
                  : { opacity: 0, height: 0, transition: leave }
              }
              transition={enter}
              className="overflow-hidden"
            >
              <div className="no-scrollbar max-h-[38dvh] overflow-y-auto pt-5">
                <SavingsRail />
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </section>
    );
  }

  /* --------------------------- not docked: a glass pill in the page's top row */

  /*
   * NOT POSITIONED HERE. The budget used to float absolutely in the top-right
   * while the room-context strip was capped at 58% beside it, which left a 2%
   * gutter between them — so a wide total ("$1,240 of $1,500") sat on top of
   * the strip's pinned "+". Both live in one flex row owned by the page, where
   * they cannot overlap by construction: the strip takes the space that is
   * left and scrolls its own contents.
   */
  return (
    <div className="pointer-events-none flex shrink-0 justify-end">
      {/* the deltas and the counters panel hang off this box */}
      <div className="pointer-events-auto relative flex max-w-[60vw] flex-col items-end">
        {/* over a photograph: thick glass, so ink holds on a dark room too */}
        <div className="glass-pill w-full min-w-[9rem] px-4 py-2 text-right">
          <div className="flex flex-wrap items-baseline justify-end gap-x-2">
            {/* the pill grows to the LEFT for the ghost, so the figure stays put */}
            {ghost}
            {figure}
            {budgetControl}
          </div>
          {bar}
        </div>

        {/* the truth, not a clamp: one line, no modal, no suggestions panel */}
        <AnimatePresence initial={false}>
          {overCents > 0 ? (
            <motion.p
              key="over"
              initial={reduced ? { opacity: 0 } : { opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, transition: leave }}
              transition={enter}
              className="glass-pill tabular mt-1.5 px-2.5 py-1 font-mono text-[11px] text-warn"
            >
              Over by {money(overCents)}
            </motion.p>
          ) : null}
        </AnimatePresence>

        {reward !== null ? (
          <span className="mt-1.5">
            <BackUnderChip
              key={reward}
              toGoCents={budgetCents - spent}
              onDone={clearReward}
            />
          </span>
        ) : null}

        {/* +$49 rises beside the pill; −$49 falls. One at a time. */}
        {current ? (
          <Delta
            key={current.key}
            cents={current.cents}
            label={current.label}
            onDone={done}
            className="right-full top-full mr-2 -mt-12 whitespace-nowrap"
          />
        ) : null}

        {/* OPTIONAL KEEP: the sponsor counters, one click behind the number */}
        <AnimatePresence initial={false}>
          {counters ? (
            <motion.div
              key="counters"
              id={panelId}
              initial={reduced ? { opacity: 0 } : { opacity: 0, y: -8, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={
                reduced
                  ? { opacity: 0, transition: leave }
                  : { opacity: 0, y: -8, transition: leave }
              }
              transition={enter}
              /*
               * `.glass-thick` declares `position: relative` after Tailwind's
               * utilities, so `absolute` as a class would lose to it; and the
               * glass has to be on the element that fades, or the blur has
               * nothing behind it until the fade ends.
               */
              style={{ position: "absolute" }}
              className="glass-thick top-full right-0 z-10 mt-2 w-72 max-w-[calc(100vw-2rem)] p-4 text-left"
            >
              <SavingsRail />
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
    </div>
  );
}

export default BudgetHud;
