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
    <section className="room-items flex min-h-0 min-w-0 flex-1 flex-col font-sans" aria-label="Items in your room">
      <header className="room-items-heading">
        <h2 className="text-xs font-medium">In your room</h2>
        <span className="room-items-count text-xs tabular-nums text-muted-foreground">{items.length}</span>
      </header>

      {items.length === 0 ? (
        <div className="room-items-empty">
          <Armchair className="mx-auto mb-3 size-5 text-muted-foreground/70" aria-hidden />
          <p className="text-sm font-medium">Your pieces live here</p>
          <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
            Add a piece from the matches on the left.
          </p>
        </div>
      ) : (
        <ul className="room-items-list no-scrollbar">
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
                    "room-item group transition-colors",
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
                    className="room-item-select focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                  >
                    <span className="room-item-image relative flex shrink-0 items-center justify-center overflow-hidden border border-line/70 bg-white/70">
                      {thumbnail ? (
                        <Image src={thumbnail} alt="" fill sizes="40px" unoptimized className="object-contain p-1" />
                      ) : pending ? (
                        <LoaderCircle className="size-4 animate-spin text-muted-foreground motion-reduce:animate-none" aria-hidden />
                      ) : (
                        <Armchair className="size-4 text-muted-foreground" aria-hidden />
                      )}
                    </span>
                    <span className="room-item-copy min-w-0 flex-1">
                      <span className={cn("room-item-name block truncate font-medium", active && "text-accent")}>{label}</span>
                      <span className={cn("room-item-status mt-0.5 block truncate tabular-nums", isOver ? "text-warn" : "text-muted-foreground")}>
                        {status}{isOver ? " · Over budget" : ""}
                      </span>
                    </span>
                  </button>
                  <RemoveButton
                    itemId={item.id}
                    label={label}
                    className="room-item-remove border-transparent bg-transparent opacity-70 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
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
