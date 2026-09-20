"use client";

import * as React from "react";
import { useAnimate, useReducedMotion } from "motion/react";

import NumberPlate, {
  centsToUnits,
  type NumberPlateProps,
} from "@/components/ui/NumberPlate";
import { withDemo } from "@/lib/demo";
import { DUR, EASE } from "@/lib/motion";
import { linkedItems, spentCents, useStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import type { Savings } from "@/types";

/**
 * The savings counters. In v2 these were a rail down the edge of every screen;
 * under the pivot the screen carries ONE readout, so they moved behind a click
 * on the budget number in components/BudgetHud.tsx, which mounts this panel —
 * inline under THE NUMBER in the laptop's agent panel, so it is two counters
 * across rather than four down: the conversation below it keeps its height.
 *
 * Nothing about the counters changed — the two sponsor tracks are unconfirmed,
 * so the work is kept, not deleted, and costs one interaction at rest.
 *
 * THE ONE RULE, unchanged: every number here is either measured or a dash. The
 * budget line is computed from the items in front of the user; minutes and
 * token percent come from /api/savings and the run ledger; fit warnings come
 * from the fit results the fit check wrote onto the items. Nothing in this file
 * may be a literal, and nothing animates up to a constant. No ledger, no
 * number — an honest dash beats an invented one.
 */

/* ------------------------------------------------------------- the fetch */

const EMPTY: Savings = {
  budgetCents: null,
  spentCents: null,
  minutesSaved: null,
  tokenPercentSaved: null,
  fitWarnings: null,
  itemsChecked: null,
};

/** A number, or null. Never a coerced zero — zero is a claim, null is honesty. */
function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function parseSavings(raw: unknown): Savings {
  if (!raw || typeof raw !== "object") return EMPTY;
  const r = raw as Record<string, unknown>;
  return {
    budgetCents: num(r.budgetCents),
    spentCents: num(r.spentCents),
    minutesSaved: num(r.minutesSaved),
    tokenPercentSaved: num(r.tokenPercentSaved),
    fitWarnings: num(r.fitWarnings),
    itemsChecked: num(r.itemsChecked),
  };
}

/**
 * One in-flight request per ledger key, shared, so an edit is one round trip
 * however many panels are asking.
 */
let inFlight: { key: string; promise: Promise<Savings | null> } | null = null;

export function loadSavings(key: string): Promise<Savings | null> {
  if (inFlight && inFlight.key === key) return inFlight.promise;
  const promise = fetch(withDemo("/api/savings"), {
    method: "GET",
    headers: { accept: "application/json" },
    cache: "no-store",
  })
    .then(async (res) => (res.ok ? parseSavings(await res.json()) : null))
    // the route may not exist yet: no counters, no invention, no crash
    .catch(() => null)
    .finally(() => {
      if (inFlight && inFlight.key === key) inFlight = null;
    });
  inFlight = { key, promise };
  return promise;
}

/* ------------------------------------------------------------- one counter */

type CounterProps = {
  label: string;
  value: number | null;
  unit?: string;
  caption: string;
  format?: NumberPlateProps["format"];
  tone?: NumberPlateProps["tone"];
};

/**
 * Pulses the accent behind the number once whenever it changes — the panel
 * should catch the eye at the exact moment something is saved.
 */
function Counter({ label, value, unit, caption, format, tone }: CounterProps) {
  const reduced = useReducedMotion();
  const previous = React.useRef<number | null>(value);
  const [scope, animate] = useAnimate<HTMLSpanElement>();

  React.useEffect(() => {
    if (previous.current === value) return;
    previous.current = value;
    if (value === null || reduced || !scope.current) return;
    // one flash of accent behind the number, exactly when it moves
    animate(
      scope.current,
      { opacity: [0, 0.28, 0] },
      { duration: DUR.scene, ease: EASE.out }
    );
  }, [value, reduced, animate, scope]);

  return (
    <div className="min-w-0 border-t border-line py-3">
      <p className="eyebrow text-muted-foreground">{label}</p>
      <span className="relative mt-2 inline-flex">
        <span
          ref={scope}
          aria-hidden
          style={{ opacity: 0 }}
          className="pointer-events-none absolute -inset-x-2 -inset-y-1.5 rounded-lg bg-accent"
        />
        <NumberPlate
          value={value}
          unit={unit}
          size="md"
          tone={tone}
          format={format}
          label={label}
          className="relative"
        />
      </span>
      <p className="mt-1.5 text-xs leading-snug text-muted-foreground">{caption}</p>
    </div>
  );
}

/* --------------------------------------------------------------- the panel */

/** Money for a caption. Integer cents in, string out. */
function money(cents: number): string {
  const whole = cents % 100 === 0;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    currencyDisplay: "narrowSymbol",
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  }).format(cents / 100);
}

export function SavingsRail({ className }: { className?: string }) {
  const items = useStore((s) => s.items);
  const budgetCents = useStore((s) => s.budgetCents);
  const savings = useStore((s) => s.savings);
  const setSavings = useStore((s) => s.setSavings);

  /* Derived from the items the user is looking at, never accumulated. */
  const spent = spentCents(items);
  const linked = React.useMemo(() => linkedItems(items), [items]);

  /*
   * Fit warnings come off the fit results the fit check wrote onto the items.
   * An item with no fit result has not been checked, and is not counted as a
   * pass — "checked 2 items" must mean two items were actually measured.
   */
  const fit = React.useMemo(() => {
    let checked = 0;
    let warnings = 0;
    for (const item of items) {
      if (!item.fit) continue;
      checked += 1;
      if (item.fit.verdict !== "pass") warnings += 1;
    }
    return { checked, warnings };
  }, [items]);

  /* Re-ask the ledger whenever the linked set changes, after the paint. */
  const ledgerKey = React.useMemo(
    () => linked.map((i) => i.linkedProduct?.id ?? i.id).join("|"),
    [linked]
  );

  React.useEffect(() => {
    let alive = true;
    const id = window.setTimeout(() => {
      loadSavings(ledgerKey).then((next) => {
        if (alive && next) setSavings(next);
      });
    }, 250);
    return () => {
      alive = false;
      window.clearTimeout(id);
    };
  }, [ledgerKey, setSavings]);

  /* The ledger wins where it has an answer; the items cover what they can. */
  const ledgerBudget = savings.budgetCents ?? budgetCents;
  const ledgerSpent = savings.spentCents ?? (linked.length > 0 ? spent : null);
  const itemsChecked =
    savings.itemsChecked ?? (fit.checked > 0 ? fit.checked : null);
  const fitWarnings =
    savings.fitWarnings ?? (fit.checked > 0 ? fit.warnings : null);

  const overBudget = ledgerSpent !== null && ledgerSpent > ledgerBudget;

  const unmeasured =
    savings.minutesSaved === null || savings.tokenPercentSaved === null;

  return (
    <div className={cn("text-foreground", className)}>
      {/* Cormorant is slight: never under 20px, and 500 while it is this small */}
      <p className="font-display text-[22px] leading-none font-medium tracking-[0.01em]">
        What you&rsquo;re saving
      </p>

      <div className="mt-3 grid grid-cols-2 gap-x-5">
        <Counter
          label="Budget"
          value={ledgerSpent === null ? null : centsToUnits(ledgerSpent)}
          unit="$"
          tone={overBudget ? "warn" : "default"}
          format={{ maximumFractionDigits: 0 }}
          caption={`of ${money(ledgerBudget)} you set`}
        />
        <Counter
          label="Time saved"
          value={savings.minutesSaved}
          unit="minutes"
          caption="versus shopping five sites"
        />
        <Counter
          label="Tokens saved"
          value={savings.tokenPercentSaved}
          unit="%"
          caption="cached instead of regenerated"
        />
        <Counter
          label="Fit warnings"
          value={fitWarnings}
          tone={fitWarnings !== null && fitWarnings > 0 ? "warn" : "default"}
          caption={
            itemsChecked === null
              ? "nothing measured yet"
              : `checked ${itemsChecked} ${itemsChecked === 1 ? "item" : "items"}`
          }
        />
      </div>

      {unmeasured ? (
        <p className="border-t border-line pt-3 text-[11px] leading-relaxed text-muted-foreground">
          A dash means we haven&rsquo;t measured it yet. These counters come from
          the run ledger, never from a guess.
        </p>
      ) : null}
    </div>
  );
}

export default SavingsRail;
