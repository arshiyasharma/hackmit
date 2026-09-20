"use client";

import * as React from "react";
import { ShieldAlert } from "lucide-react";

import { formatMoney } from "@/components/CartLine";
import {
  DEFAULT_RUN_MODE,
  REAL_ORDERS_ENABLED,
  type RunMode,
} from "@/components/CheckoutRun";
import { Button } from "@/components/ui/button";
import NumberPlate, { centsToUnits } from "@/components/ui/NumberPlate";
import { Sheet } from "@/components/ui/Sheet";
import { cartByRetailer, cartSubtotalCents } from "@/lib/store";
import { cn } from "@/lib/utils";
import type { CartItem } from "@/types";

/**
 * The order-mode sheet: what the agent is about to do, shop by shop, and the
 * one switch that decides whether it may touch real baskets.
 *
 * THE BUY BUTTON DOES NOT OPEN THIS. That is the point. The safety rule says
 * the real-order flag must not be reachable by tapping the main button, so the
 * switch lives behind a separate, quieter affordance on the review, and it
 * starts nothing — closing this sheet leaves you exactly where you were.
 *
 * There is no payment here any more. No passkey, no token, no card. One button
 * on the review hands the basket to the agent and the run happens on screen.
 */

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
  const [confirmingLive, setConfirmingLive] = React.useState(false);

  const groups = React.useMemo(() => cartByRetailer(lines), [lines]);
  const totalCents = React.useMemo(() => cartSubtotalCents(lines), [lines]);
  const currency = lines[0]?.product.currency ?? "USD";

  // a closed sheet always reopens with the live confirmation put away
  const close = React.useCallback(
    (next: boolean) => {
      if (!next) setConfirmingLive(false);
      onOpenChange(next);
    },
    [onOpenChange]
  );

  return (
    <Sheet
      open={open}
      onOpenChange={close}
      snapPoints={[0.94, 0.6]}
      initialSnap={0}
      label="Order mode"
    >
      <h2 className="font-display text-2xl font-semibold">What the agent does</h2>
      <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
        It opens each shop&rsquo;s own page, puts the item in that shop&rsquo;s
        basket and fills in the checkout. It stops at the final confirm.
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
          format={{ maximumFractionDigits: 0 }}
          label="Basket total"
        />
      </div>

      {/* the flag. Off by default, and no main-flow button reaches it. */}
      <h3 className="mt-7 text-xs uppercase tracking-[0.14em] text-muted-foreground">
        Order mode
      </h3>

      <div className="mt-2 space-y-2">
        <ModeRow
          selected={mode === "test"}
          title="Test run"
          detail="The agent does every step and stops at the confirm. Nothing is bought. This is the default and it is what runs on stage."
          onSelect={() => {
            setConfirmingLive(false);
            onModeChange("test");
          }}
        />

        <ModeRow
          selected={mode === "live"}
          disabled={!REAL_ORDERS_ENABLED}
          title="Real orders"
          detail={
            REAL_ORDERS_ENABLED
              ? "Lets the agent work against real baskets. Even then, this build stops at the final confirm — no code here completes a purchase."
              : "Off in this build. It takes NEXT_PUBLIC_VISA_REAL_ORDERS=1 and a rebuild; no button in this app can turn it on."
          }
          onSelect={() => {
            if (!REAL_ORDERS_ENABLED) return;
            setConfirmingLive(true);
          }}
        />
      </div>

      {confirmingLive && REAL_ORDERS_ENABLED && mode !== "live" ? (
        <div className="mt-3 rounded-2xl border border-warn/50 bg-warn/10 p-3">
          <p className="flex items-start gap-2 text-sm text-warn">
            <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>
              Real baskets on real shops, with real money behind them. A live
              demo is the wrong place for this.
            </span>
          </p>
          <div className="mt-3 flex gap-2">
            <Button
              variant="outline"
              className="h-11 flex-1 rounded-2xl"
              onClick={() => setConfirmingLive(false)}
            >
              Keep test mode
            </Button>
            <Button
              className="h-11 flex-1 rounded-2xl"
              onClick={() => {
                onModeChange("live");
                setConfirmingLive(false);
              }}
            >
              Use real orders
            </Button>
          </div>
        </div>
      ) : null}

      <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
        Whatever this says, the last click is disabled in this build. Anything
        the screen walked through on its own is marked simulated on its row.
      </p>

      <Button
        variant="outline"
        className="mt-5 h-[52px] w-full rounded-2xl text-base"
        onClick={() => close(false)}
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
