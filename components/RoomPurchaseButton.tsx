"use client";

import * as React from "react";
import { ShoppingBag } from "lucide-react";

import BudgetLeftSheet from "@/components/BudgetLeftSheet";
import { formatMoney } from "@/components/CartLine";
import { demoHref } from "@/lib/demo";
import { useAppNav } from "@/lib/nav";
import { linkedItems, spentCents, useStore } from "@/lib/store";
import { cn } from "@/lib/utils";

/** Opens the existing checkout review; this button never submits a purchase. */
export function RoomPurchaseButton({ className }: { className?: string }) {
  const items = useStore((s) => s.items);
  const budgetCents = useStore((s) => s.budgetCents);
  const nav = useAppNav();
  const [asking, setAsking] = React.useState(false);
  const disabledReasonId = React.useId();
  const linkedCount = linkedItems(items).length;
  const overCents = spentCents(items) - budgetCents;
  const overBudget = overCents > 0;
  const invalidBudget = !Number.isSafeInteger(budgetCents) || budgetCents < 0;
  const disabled = linkedCount === 0 || overBudget || invalidBudget;
  const disabledReason = invalidBudget
    ? "Set a valid budget before checking out."
    : overBudget
      ? `Your selected products are ${formatMoney(overCents)} over your ${formatMoney(budgetCents)} budget. Remove an item or choose a cheaper option to continue.`
      : "Choose a product for an item to review your purchase.";

  function continueToReview() {
    setAsking(false);
    // A budget or linked price can change while the budget-left dialog is open.
    // Read the current store at the navigation boundary, not a render snapshot.
    const latest = useStore.getState();
    if (!Number.isSafeInteger(latest.budgetCents) || latest.budgetCents < 0 ||
        linkedItems(latest.items).length === 0 || spentCents(latest.items) > latest.budgetCents) return;
    nav.push(demoHref("/checkout"));
  }

  return (
    <>
      <button
        type="button"
        disabled={disabled}
        aria-describedby={disabled ? disabledReasonId : undefined}
        title={disabled ? disabledReason : `Review ${linkedCount} selected product${linkedCount === 1 ? "" : "s"}`}
        onClick={() => {
          const latest = useStore.getState();
          const total = spentCents(latest.items);
          if (!Number.isSafeInteger(latest.budgetCents) || latest.budgetCents < 0 ||
              linkedItems(latest.items).length === 0 || total > latest.budgetCents) return;
          if (latest.budgetCents > total) setAsking(true);
          else continueToReview();
        }}
        className={cn(
          "inline-flex min-h-10 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-full bg-accent px-4 font-sans text-[13px] font-medium whitespace-nowrap text-white",
          "transition-colors hover:bg-accent-bright disabled:cursor-not-allowed disabled:opacity-45",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
          className
        )}
      >
        <ShoppingBag className="size-4" aria-hidden />
        {overBudget ? "Over budget" : "Review & buy"}
        {linkedCount > 0 ? (
          <span className="flex min-w-5 items-center justify-center rounded-full bg-white/20 px-1.5 text-[11px] leading-5 tabular-nums">{linkedCount}</span>
        ) : null}
      </button>
      <span id={disabledReasonId} className="sr-only">{disabledReason}</span>
      <BudgetLeftSheet open={asking} onOpenChange={setAsking} onContinue={continueToReview} />
    </>
  );
}

export default RoomPurchaseButton;
