"use client";

import * as React from "react";

import { formatMoney } from "@/components/CartLine";
import {
  DEFAULT_RUN_MODE,
  type RunMode,
} from "@/components/CheckoutRun";
import { Button } from "@/components/ui/button";
import NumberPlate, { centsToUnits } from "@/components/ui/NumberPlate";
import { Sheet } from "@/components/ui/Sheet";
import { cartByRetailer, cartSubtotalCents } from "@/lib/store";
import { cn } from "@/lib/utils";
import type { CartItem } from "@/types";

/** Explains the simulated checkout. Real ordering is unavailable in this build. */

export type CheckoutSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** the basket being reviewed */
  lines: CartItem[];
  mode: RunMode;
  onModeChange: (mode: RunMode) => void;
};

export function CheckoutSheet({
  open,
  onOpenChange,
  lines,
  mode,
  onModeChange,
}: CheckoutSheetProps) {
  const groups = React.useMemo(() => cartByRetailer(lines), [lines]);
  const totalCents = React.useMemo(() => cartSubtotalCents(lines), [lines]);
  const currency = lines[0]?.product.currency ?? "USD";

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      snapPoints={[0.94, 0.6]}
      initialSnap={0}
      label="Order mode"
    >
      <h2 className="font-display text-2xl font-semibold">What the agent does</h2>
      <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
        A test run simulates checkout for supported shops. Nothing is bought,
        and no card is charged. Items that cannot be included are shown before
        you start.
      </p>

      <ul className="mt-4 divide-y divide-line">
        {groups.map((group) => {
          const count = group.items.reduce((n, i) => n + i.quantity, 0);
          return (
            <li
              key={group.retailer}
              className="flex items-baseline justify-between gap-3 py-2.5 text-sm"
            >
              <span className="min-w-0 truncate font-medium">{group.retailer}</span>
              <span className="shrink-0 text-muted-foreground">
                {count} {count === 1 ? "item" : "items"}
              </span>
              <span className="tabular shrink-0 font-medium">
                {formatMoney(group.subtotalCents, currency)}
              </span>
            </li>
          );
        })}
      </ul>

      <div className="mt-4 flex items-end justify-between border-t border-line pt-4">
        <span className="text-sm text-muted-foreground">
          Across {groups.length} {groups.length === 1 ? "shop" : "shops"}
        </span>
        <NumberPlate
          value={centsToUnits(totalCents)}
          unit="$"
          size="lg"
          format={{
            minimumFractionDigits: totalCents % 100 === 0 ? 0 : 2,
            maximumFractionDigits: totalCents % 100 === 0 ? 0 : 2,
          }}
          label="Basket total"
        />
      </div>

      {/* Real ordering has no working server path in this version. */}
      <h3 className="mt-7 text-xs uppercase tracking-[0.14em] text-muted-foreground">
        Order mode
      </h3>

      <div className="mt-2 space-y-2">
        <ModeRow
          selected={mode === "test"}
          title="Test run"
          detail="Simulates checkout without placing a purchase or charging a card."
          onSelect={() => onModeChange("test")}
        />

        <ModeRow
          selected={mode === "live"}
          disabled
          title="Real orders"
          detail="Unavailable in this version."
          onSelect={() => {}}
        />
      </div>

      <Button
        variant="outline"
        className="mt-5 h-[52px] w-full rounded-2xl text-base"
        onClick={() => onOpenChange(false)}
      >
        Back to the order
      </Button>
    </Sheet>
  );
}

/* ----------------------------------------------------------------- a row */

function ModeRow({
  selected,
  disabled = false,
  title,
  detail,
  onSelect,
}: {
  selected: boolean;
  disabled?: boolean;
  title: string;
  detail: string;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-disabled={disabled}
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        "flex w-full items-start gap-3 rounded-2xl border p-3 text-left transition-colors",
        selected ? "border-accent bg-accent/10" : "border-line bg-surface",
        disabled ? "opacity-60" : "hover:bg-muted"
      )}
    >
      <span
        aria-hidden
        className={cn(
          "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border",
          selected ? "border-accent" : "border-line"
        )}
      >
        {selected ? <span className="size-2 rounded-full bg-accent" /> : null}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">
          {title}
          {title === "Test run" && DEFAULT_RUN_MODE === "test" ? (
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              default
            </span>
          ) : null}
        </span>
        <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
          {detail}
        </span>
      </span>
    </button>
  );
}

export default CheckoutSheet;
