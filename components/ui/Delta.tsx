"use client";

import * as React from "react";
import type { Format } from "@number-flow/react";
import { motion, useReducedMotion } from "motion/react";

import { NumberPlate } from "@/components/ui/NumberPlate";
import { cn } from "@/lib/utils";

/**
 * EVERY FLOATING +/− AMOUNT IN THE APP.
 *
 * It reads like a hit-point number in a game, because that is exactly what it
 * is: the budget is what you have left, so linking a $49 lamp floats "−$49"
 * off the bar in the warn colour, and removing it floats "+$49" in the ok
 * colour. Cost falls, refund rises — the direction carries the meaning even
 * for someone who never reads the sign.
 *
 * On a relink, pass the DIFFERENCE, not the new price. `deltaCents(prev, next)`
 * in lib/store.ts does that arithmetic. A delta that shows the full price makes
 * the running total impossible to follow.
 *
 * It positions itself absolutely, so the parent needs `relative`. It renders
 * nothing for a zero amount: a relink to the same price is not news.
 */

export type DeltaProps = {
  /** signed against the budget: negative is a cost, positive is a refund. */
  cents: number;
  /** ISO 4217, for the symbol */
  currency?: string;
  /** how long it holds at the top of its travel before fading */
  holdMs?: number;
  /** fired once it has finished fading, so a queue can show the next one */
  onDone?: () => void;
  /** what the amount is about, for the screen reader: "Floor lamp" */
  label?: string;
  className?: string;
};

const TRAVEL_PX = 24;
const EXIT_PX = 40;

function moneyFormat(cents: number, currency: string): Format {
  return {
    style: "currency",
    currency,
    currencyDisplay: "narrowSymbol",
    signDisplay: "exceptZero",
    // whole dollars read faster; cents only when there are cents
    minimumFractionDigits: Math.abs(cents) % 100 === 0 ? 0 : 2,
    maximumFractionDigits: Math.abs(cents) % 100 === 0 ? 0 : 2,
  };
}

export function Delta({
  cents,
  currency = "USD",
  holdMs = 700,
  onDone,
  label,
  className,
}: DeltaProps) {
  const reduced = useReducedMotion();
  const [phase, setPhase] = React.useState<"in" | "out">("in");

  // the callback is read from a ref so a new inline closure on every parent
  // render cannot restart the hold timer
  const done = React.useRef(onDone);
  React.useEffect(() => {
    done.current = onDone;
  }, [onDone]);

  React.useEffect(() => {
    if (cents === 0) {
      done.current?.();
      return;
    }
    const timer = window.setTimeout(() => setPhase("out"), holdMs);
    return () => window.clearTimeout(timer);
  }, [cents, holdMs]);

  if (cents === 0) return null;

  const rising = cents > 0;
  const direction = rising ? -1 : 1;

  const travel = reduced ? 0 : direction * TRAVEL_PX;
  const exit = reduced ? 0 : direction * EXIT_PX;

  const spoken = `${rising ? "Refunded" : "Spent"} ${new Intl.NumberFormat(
    "en-US",
    { ...moneyFormat(cents, currency), signDisplay: "never" }
  ).format(Math.abs(cents) / 100)}${label ? ` — ${label}` : ""}`;

  return (
    <>
      <span role="status" className="sr-only">
        {spoken}
      </span>

      <motion.span
        aria-hidden
        initial={{ opacity: 0, y: 0, scale: reduced ? 1 : 0.9 }}
        animate={
          phase === "in"
            ? { opacity: 1, y: travel, scale: 1 }
            : { opacity: 0, y: exit, scale: reduced ? 1 : 0.96 }
        }
        transition={
          reduced
            ? { duration: 0.15 }
            : phase === "in"
              ? { type: "spring", stiffness: 520, damping: 30 }
              : { duration: 0.25, ease: "easeOut" }
        }
        onAnimationComplete={() => {
          if (phase === "out") done.current?.();
        }}
        className={cn(
          "pointer-events-none absolute right-0 top-full z-20 select-none",
          "rounded-full px-2 py-0.5 backdrop-blur-sm",
          rising
            ? "bg-warn/15 text-warn"
            : "bg-ok/15 text-ok",
          className
        )}
      >
        <NumberPlate
          value={cents / 100}
          size="sm"
          tone={rising ? "warn" : "ok"}
          format={moneyFormat(cents, currency)}
        />
      </motion.span>
    </>
  );
}

/* ------------------------------------------------------------------ queue */

export type QueuedDelta = {
  /** unique per push, so React keeps them apart */
  key: number;
  cents: number;
  label?: string;
};

/**
 * Deltas QUEUE rather than overlap. Two removals in quick succession show two
 * deltas one after the other, not two stacked on top of each other.
 *
 *   const { current, push, done } = useDeltaQueue();
 *   ...
 *   {current ? <Delta key={current.key} cents={current.cents} onDone={done} /> : null}
 */
export function useDeltaQueue(): {
  current: QueuedDelta | null;
  push: (cents: number, label?: string) => void;
  done: () => void;
  clear: () => void;
} {
  const [queue, setQueue] = React.useState<QueuedDelta[]>([]);
  const seq = React.useRef(0);

  const push = React.useCallback((cents: number, label?: string) => {
    if (cents === 0) return;
    seq.current += 1;
    setQueue((q) => [...q, { key: seq.current, cents, label }]);
  }, []);

  const done = React.useCallback(() => setQueue((q) => q.slice(1)), []);
  const clear = React.useCallback(() => setQueue([]), []);

  return { current: queue[0] ?? null, push, done, clear };
}

export default Delta;
