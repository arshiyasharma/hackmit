"use client";

import * as React from "react";
import Image from "next/image";
import { Armchair, LoaderCircle } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";

import { RemoveButton } from "@/components/BudgetHud";
import { openOptionsFor } from "@/components/OptionSheet";
import { DUR, EASE, EXIT, REDUCED } from "@/lib/motion";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { productImage, type PlacedItem } from "@/types";

function titleCase(text: string): string {
  const trimmed = text.trim().replace(/^(?:a|an|the)\s+/i, "");
  return trimmed ? trimmed.charAt(0).toUpperCase() + trimmed.slice(1) : "Item";
}

function itemStatus(item: PlacedItem): string {
  if (item.linkedProduct) {
    const { priceCents, currency } = item.linkedProduct;
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency || "USD",
      minimumFractionDigits: priceCents % 100 === 0 ? 0 : 2,
      maximumFractionDigits: 2,
    }).format(priceCents / 100);
  }
  if (item.optionsStatus === "pending") return "Finding options…";
  if (item.options.length > 0) {
    return `${item.options.length} option${item.options.length === 1 ? "" : "s"} to explore`;
  }
  if (item.optionsStatus === "failed") return "Search unavailable";
  if (item.placeholderStatus === "pending") return "Creating preview…";
  return "No matches yet";
}

/** The last items added are the first to cross the budget, as in the room HUD. */
function overBudgetIds(items: PlacedItem[], budgetCents: number): Set<string> {
  const ids = new Set<string>();
  let running = 0;
  for (const item of items) {
    const price = item.linkedProduct?.priceCents ?? 0;
    running += price;
    if (price > 0 && running > budgetCents) ids.add(item.id);
  }
  return ids;
}

/** A persistent room inventory. Selecting a row opens its existing product options. */
export function ItemsStrip() {
  const items = useStore((s) => s.items);
  const activeItemId = useStore((s) => s.activeItemId);
  const budgetCents = useStore((s) => s.budgetCents);
  const setActiveItem = useStore((s) => s.setActiveItem);
  const reduced = useReducedMotion();
  const over = React.useMemo(() => overBudgetIds(items, budgetCents), [items, budgetCents]);
  const move = reduced ? REDUCED : { duration: DUR.micro, ease: EASE.out };

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col font-sans" aria-label="Items in your room">
      <header className="mb-3 flex items-center justify-between gap-2 px-2">
        <h2 className="text-xs font-medium text-muted-foreground">Your items</h2>
        <span className="text-xs tabular-nums text-muted-foreground">{items.length}</span>
      </header>

      {items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line px-4 py-6 text-center">
          <Armchair className="mx-auto mb-3 size-6 text-muted-foreground/70" aria-hidden />
          <p className="text-sm font-medium">A little room to imagine</p>
          <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
            Ask for a piece you love. Everything you add will live here.
          </p>
        </div>
      ) : (
        <ul className="no-scrollbar -m-1 flex min-h-0 flex-col gap-1 overflow-y-auto p-1">
          <AnimatePresence initial={false} mode="popLayout">
            {items.map((item) => {
              const active = item.id === activeItemId;
              const linked = item.linkedProduct;
              const thumbnail = linked
                ? item.listingCutoutUrl || productImage(linked) || item.placeholderUrl
                : item.placeholderUrl;
              const pending = !linked && item.optionsStatus === "pending";
              const label = titleCase(item.category);
              const status = itemStatus(item);
              const isOver = over.has(item.id);

              return (
                <motion.li
                  key={item.id}
                  layout
                  initial={{ opacity: 0, y: reduced ? 0 : 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, transition: reduced ? REDUCED : EXIT }}
                  transition={move}
                  className={cn(
                    "group flex min-w-0 items-center gap-1 rounded-xl p-1.5 transition-colors",
                    active ? "bg-accent-wash" : "hover:bg-muted/70"
                  )}
                >
                  <button
                    type="button"
                    onClick={() => {
                      setActiveItem(item.id);
                      openOptionsFor(item.id);
                    }}
                    data-item-select=""
                    aria-current={active ? "true" : undefined}
                    aria-label={`${label}, ${status}. View options`}
                    className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 rounded-lg text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                  >
                    <span className="relative flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-line/70 bg-white/70">
                      {thumbnail ? (
                        <Image src={thumbnail} alt="" fill sizes="40px" unoptimized className="object-contain p-1" />
                      ) : pending ? (
                        <LoaderCircle className="size-4 animate-spin text-muted-foreground motion-reduce:animate-none" aria-hidden />
                      ) : (
                        <Armchair className="size-4 text-muted-foreground" aria-hidden />
                      )}
                    </span>
                    <span className="min-w-0 flex-1 py-1">
                      <span className={cn("block truncate text-[13px] font-medium", active && "text-accent")}>{label}</span>
                      <span className={cn("mt-0.5 block truncate text-xs tabular-nums", isOver ? "text-warn" : "text-muted-foreground")}>
                        {status}{isOver ? " · Over budget" : ""}
                      </span>
                    </span>
                  </button>
                  <RemoveButton
                    itemId={item.id}
                    label={label}
                    className="border-transparent bg-transparent opacity-70 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                  />
                </motion.li>
              );
            })}
          </AnimatePresence>
        </ul>
      )}
    </section>
  );
}

export default ItemsStrip;
