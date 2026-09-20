"use client";

/**
 * IN THE ROOM — one chip per thing standing in it.
 *
 * On a laptop this is a section of the agent panel, under the conversation:
 * the chips WRAP, because a list you have to scroll sideways with a mouse is a
 * list you stop reading, and the way to the checkout is one wide button at its
 * foot. In a narrow window the same markup falls back to a single row that
 * scrolls, by CSS alone.
 *
 * WHY IT EARNS ITS SPACE. In AR the thing you placed five minutes ago may be
 * behind you, and turning around in front of a judge to find it is not a demo.
 * Clicking a chip makes that item active, which is what every overlay reads, so
 * the options, the budget deltas and the dimension label all follow.
 *
 * It takes no props and reads the store.
 *
 * The chip for an item whose jobs are still in flight is a skeleton, and it
 * appears the instant the user submits — before the placeholder or the search
 * has answered. That is the visible half of the 100ms rule.
 */

import * as React from "react";
import { AppLink, useAppNav } from "@/lib/nav";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowRight } from "lucide-react";

import BudgetLeftSheet from "@/components/BudgetLeftSheet";
import { RemoveButton, money } from "@/components/BudgetHud";
import { openOptionsFor } from "@/components/OptionSheet";
import { NumberPlate } from "@/components/ui/NumberPlate";
import { Skeleton } from "@/components/ui/skeleton";
import { demoHref } from "@/lib/demo";
import { DUR, EASE, EXIT, REDUCED } from "@/lib/motion";
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

const FOCUS_RING =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

/** A chip's time, on the entrance curve; its neighbours close the gap on it too. */
const CHIP = { duration: DUR.micro, ease: EASE.out } as const;

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

  /* what is still unspent, and the dialog that offers to spend it */
  const spent = spentCents(items);
  const underBy = budgetCents - spent;
  // a URL on its own, a screen swap inside the landing's room III
  const nav = useAppNav();
  const [asking, setAsking] = React.useState(false);

  if (items.length === 0) return null;

  const move = reduced ? REDUCED : CHIP;
  const leave = reduced ? REDUCED : EXIT;

  return (
    <section
      // a hairline over it: the conversation above scrolls, and this does not
      className="pointer-events-auto flex min-w-0 shrink-0 flex-col gap-2.5 border-t border-line pt-3"
      aria-label="What you have placed"
    >
      {/* the heading belongs to the panel; a narrow window has no room for it */}
      <header className="hidden items-baseline justify-between gap-3 desk:flex">
        <h2 className="eyebrow text-muted-foreground">In the room</h2>
        <p className="tabular font-mono text-[11px] text-muted-foreground">
          {linkedCount} of {items.length} linked
        </p>
      </header>

      <div className="flex min-w-0 items-center gap-1.5 desk:flex-col desk:items-stretch desk:gap-3">
        {/*
          One row that scrolls below `desk`; from `desk` up the chips wrap, and
          only a long list scrolls — downwards, so the conversation above keeps
          its height. The padding is room for a chip's focus ring, which the
          scroll box would otherwise clip.
        */}
        <ul
          className={cn(
            "no-scrollbar relative -m-1 flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto p-1",
            "desk:max-h-[9.5rem] desk:flex-none desk:flex-wrap desk:overflow-y-auto"
          )}
        >
          <AnimatePresence initial={false} mode="popLayout">
            {items.map((item) => {
              const active = item.id === activeItemId;
              const linked = item.linkedProduct;
              const isOver = over.has(item.id);
              const pending =
                item.placeholderStatus === "pending" ||
                item.optionsStatus === "pending";

              return (
                <motion.li
                  key={item.id}
                  layout
                  initial={{ opacity: 0, y: reduced ? 0 : 8, scale: reduced ? 1 : 0.96 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, scale: reduced ? 1 : 0.96, transition: leave }}
                  transition={move}
                  className={cn(
                    "group flex min-h-11 shrink-0 items-center rounded-full border py-1 pr-1.5 pl-3.5 desk:min-h-10",
                    // nearly solid: the same chip has to read over a photograph
                    "bg-surface/90 transition-colors",
                    active
                      ? "border-accent bg-accent-wash"
                      : isOver
                        ? "border-warn hover:bg-surface"
                        : "border-line hover:border-accent-pale hover:bg-surface"
                  )}
                >
                  <button
                    type="button"
                    onClick={() => {
                      // makes it active AND brings its options up — the tray owns
                      // its own open state, this is its published way in
                      setActiveItem(item.id);
                      openOptionsFor(item.id);
                    }}
                    aria-current={active ? "true" : undefined}
                    className={cn(
                      "flex min-h-8 cursor-pointer items-center gap-2 rounded-full text-left",
                      FOCUS_RING
                    )}
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
                        size="xs"
                        tone={isOver ? "warn" : "default"}
                        format={moneyFormat(linked.priceCents, linked.currency || "USD")}
                        label={`${titleCase(item.category)} price`}
                      />
                    ) : pending ? (
                      // pale blue: the colour of a thing that is not a fact yet
                      <Skeleton className="h-3 w-14 rounded-full bg-accent-pale/70" />
                    ) : (
                      <span className="text-[13px] whitespace-nowrap text-muted-foreground">
                        not linked yet
                      </span>
                    )}
                  </button>

                  {/* the same gesture as the cross on the sprite's label, so the
                      refund delta and the undo toast cannot drift apart. With a
                      mouse it waits for the pointer (or the keyboard) to arrive;
                      on a touch screen, which cannot hover, it is always there. */}
                  <RemoveButton
                    itemId={item.id}
                    label={titleCase(item.category)}
                    className={cn(
                      "ml-2 transition-[opacity,color,background-color,border-color]",
                      active ? null : "[@media(hover:hover)]:opacity-0",
                      "group-focus-within:opacity-100 group-hover:opacity-100 focus-visible:opacity-100"
                    )}
                  />
                </motion.li>
              );
            })}
          </AnimatePresence>
        </ul>

        {linkedCount > 0 ? (
          <motion.div layout transition={move} className="shrink-0">
            <AppLink
              href={demoHref("/checkout")}
              onClick={(event) => {
                /*
                 * ONE QUESTION BEFORE THE END. Money still to go at checkout is
                 * the only moment this screen has something useful to say, so
                 * the button asks once — "$272 to go, this room could also use
                 * a floor rug" — and then gets out of the way. Already at or
                 * over budget, it just goes.
                 */
                if (underBy > 0) {
                  event.preventDefault();
                  setAsking(true);
                }
              }}
              className={cn(
                "glass-blue group/out flex min-h-11 cursor-pointer items-center justify-between gap-3",
                "rounded-full! px-5 text-sm font-medium whitespace-nowrap desk:min-h-12 desk:w-full",
                "transition-transform hover:-translate-y-px active:translate-y-px",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              )}
            >
              Check out
              <span className="flex items-center gap-2.5">
                {/* what is being checked out, the same figure THE NUMBER shows */}
                <span className="tabular hidden font-mono text-[13px] desk:inline">
                  {money(spent)}
                </span>
                <ArrowRight
                  aria-hidden
                  className="size-4 transition-transform group-hover/out:translate-x-0.5"
                />
              </span>
            </AppLink>
          </motion.div>
        ) : null}
      </div>

      <BudgetLeftSheet
        open={asking}
        onOpenChange={setAsking}
        onContinue={() => {
          setAsking(false);
          nav.push(demoHref("/checkout"));
        }}
      />
    </section>
  );
}

export default ItemsStrip;
