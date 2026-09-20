"use client";

import { useCartStore } from "@/lib/cart-store";

export default function BudgetSidebar({
  timeSavedMin = 47,
  tokensSavedUsd = 0,
}: {
  timeSavedMin?: number;
  tokensSavedUsd?: number;
}) {
  const { items, budget, total, overBudget } = useCartStore();
  const spent = total();
  const over = overBudget();
  const pct = Math.min((spent / budget) * 100, 100);
  const noFitCount = items.filter((i) => i.fitStatus === "no_fit").length;

  return (
    <aside className="w-64 p-4 border-l border-black/10 flex flex-col gap-4">
      <div>
        <div className="flex justify-between text-sm mb-1">
          <span>${spent.toFixed(0)} spent</span>
          <span className="text-black/50">${budget} budget</span>
        </div>
        <div className="h-2 rounded-full bg-black/10 overflow-hidden">
          <div
            className={`h-full ${over ? "bg-red-500" : "bg-[#C97B5F]"}`}
            style={{ width: `${pct}%` }}
          />
        </div>
        {over && (
          <p className="text-red-500 text-xs mt-1">
            over budget by ${(spent - budget).toFixed(0)} — swap an item
          </p>
        )}
      </div>

      <div className="text-sm space-y-1">
        <div className="flex justify-between">
          <span>time saved</span>
          <span>{timeSavedMin} min</span>
        </div>
        <div className="flex justify-between">
          <span>tokens saved</span>
          <span>${tokensSavedUsd.toFixed(2)}</span>
        </div>
        <div className="flex justify-between">
          <span>fit warnings</span>
          <span>{noFitCount}</span>
        </div>
      </div>
    </aside>
  );
}
