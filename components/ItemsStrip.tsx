"use client";

/**
 * The items strip: one chip per placed item along the bottom edge.
 *
 * WHY IT EARNS ITS SPACE. In AR the thing you placed five minutes ago may be
 * behind you, and turning around in front of a judge to find it is not a demo.
 * Tapping a chip makes that item active, which is what every overlay reads, so
 * the options, the budget deltas and the dimension label all follow.
 *
 * It takes no props and reads the store.
 *
 * The chip for an item whose jobs are still in flight is a skeleton, and it
 * appears the instant the user submits — before the placeholder or the search
 * has answered. That is the visible half of the 100ms rule.
 */

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";

import BudgetLeftSheet from "@/components/BudgetLeftSheet";
import { RemoveButton } from "@/components/BudgetHud";
import { openOptionsFor } from "@/components/OptionSheet";
import { NumberPlate } from "@/components/ui/NumberPlate";
import { Skeleton } from "@/components/ui/skeleton";
import { demoHref } from "@/lib/demo";
import { linkedItems, spentCents, useStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import type { PlacedItem } from "@/types";

/* ------------------------------------------------------------------ utils */

/** "floor lamp" -> "Floor lamp". The chip is a label, not a sentence. */
function titleCase(text: string): string {
  const trimmed = text.trim().replace(/^(?:a|an|the)\s+/i, "");
  if (!trimmed) return "Item";
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

function moneyFormat(cents: number, currency: string) {
  const whole = Math.abs(cents) % 100 === 0;
  return {
    style: "currency" as const,
    currency,
    currencyDisplay: "narrowSymbol" as const,
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  };
}

/**
 * Which items are the ones that took the basket past the budget. Running total
 * in the order they were asked for, so the outline lands on the last ones in
 * rather than on all of them. Nothing is auto-removed; this only says which to
 * reconsider.
 */
function overBudgetIds(items: PlacedItem[], budgetCents: number): Set<string> {
  const out = new Set<string>();
  let running = 0;
  for (const item of items) {
    const price = item.linkedProduct?.priceCents ?? 0;
    running += price;
    if (price > 0 && running > budgetCents) out.add(item.id);
  }
  return out;
}

/* -------------------------------------------------------------- component */

export function ItemsStrip() {
  const items = useStore((s) => s.items);
  const activeItemId = useStore((s) => s.activeItemId);
  const budgetCents = useStore((s) => s.budgetCents);
  const setActiveItem = useStore((s) => s.setActiveItem);
  const reduced = useReducedMotion();

  const over = React.useMemo(
    () => overBudgetIds(items, budgetCents),
    [items, budgetCents]
  );

  const linkedCount = linkedItems(items).length;

  /* what is still unspent, and the sheet that offers to spend it */
  const underBy = budgetCents - spentCents(items);
  const router = useRouter();
  const [asking, setAsking] = React.useState(false);

  if (items.length === 0) return null;

  const spring = reduced
    ? ({ duration: 0.15 } as const)
    : ({ type: "spring", stiffness: 460, damping: 34 } as const);

  return (
    <div
      className="pointer-events-auto flex items-center gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      aria-label="What you have placed"
    >
      <AnimatePresence initial={false} mode="popLayout">
        {items.map((item) => {
          const active = item.id === activeItemId;
          const linked = item.linkedProduct;
          const pending =
            item.placeholderStatus === "pending" || item.optionsStatus === "pending";

          return (
            <motion.div
              key={item.id}
              layout
              initial={{ opacity: 0, y: reduced ? 0 : 8, scale: reduced ? 1 : 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: reduced ? 1 : 0.96 }}
              transition={spring}
              className={cn(
                "flex min-h-11 shrink-0 items-center gap-1 rounded-full border py-1 pr-1 pl-3",
                "bg-background/85 backdrop-blur-md transition-colors",
                active ? "border-accent" : "border-line",
                over.has(item.id) && !active ? "border-warn" : null
              )}
            >
              <button
                type="button"
                onClick={() => {
                  // makes it active AND brings its options up — the sheet owns
                  // its own open state, this is its published way in
                  setActiveItem(item.id);
                  openOptionsFor(item.id);
                }}
                aria-current={active ? "true" : undefined}
                className="flex items-center gap-2 text-left"
              >
                <span className="text-[13px] font-medium whitespace-nowrap">
                  {titleCase(item.category)}
                </span>

                <span className="text-muted-foreground" aria-hidden>
                  ·
                </span>

                {linked ? (
                  <NumberPlate
                    value={linked.priceCents / 100}
                    size="sm"
                    tone={over.has(item.id) ? "warn" : "default"}
                    format={moneyFormat(linked.priceCents, linked.currency || "USD")}
                    label={`${titleCase(item.category)} price`}
                  />
                ) : pending ? (
                  <Skeleton className="h-3.5 w-16 rounded-full" />
                ) : (
                  <span className="text-[13px] whitespace-nowrap text-muted-foreground">
                    not linked yet
                  </span>
                )}
              </button>

              {/* the same gesture as the cross on the sprite's label, so the
                  refund delta and the undo toast cannot drift apart */}
              <RemoveButton
                itemId={item.id}
                label={titleCase(item.category)}
                className="mx-1.5"
              />
            </motion.div>
          );
        })}
      </AnimatePresence>

      {linkedCount > 0 ? (
        <motion.div layout transition={spring} className="shrink-0">
          <Link
            href={demoHref("/checkout")}
            onClick={(event) => {
              /*
               * ONE QUESTION BEFORE THE END. Money left on the table at
               * checkout is the only moment this screen has something useful
               * to say, so the button asks once — "you have $272 left, this
               * room could also use a floor rug" — and then gets out of the
               * way. Already at or over budget, it just goes.
               */
              if (underBy > 0) {
                event.preventDefault();
                setAsking(true);
              }
            }}
            className={cn(
              "flex min-h-11 items-center rounded-full px-4",
              "bg-accent text-[13px] font-medium text-[color:var(--on-accent)]",
              "whitespace-nowrap transition-transform active:translate-y-px"
            )}
          >
            Check out
          </Link>
        </motion.div>
      ) : null}

      <BudgetLeftSheet
        open={asking}
        onOpenChange={setAsking}
        onContinue={() => {
          setAsking(false);
          router.push(demoHref("/checkout"));
        }}
      />
    </div>
  );
}

export default ItemsStrip;
