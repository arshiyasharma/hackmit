"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { toast } from "sonner";

import AppShell from "@/components/AppShell";
import CartLine, { fitFor, fitObstacle, formatMoney } from "@/components/CartLine";
import CheckoutRun, {
  DEFAULT_RUN_MODE,
  REAL_ORDERS_ENABLED,
  type RunMode,
  type RunPhase,
  type RunRow,
} from "@/components/CheckoutRun";
import CheckoutSheet from "@/components/CheckoutSheet";
import TestModeChip from "@/components/TestModeChip";
import Confirmation from "@/components/Confirmation";
import { buttonVariants } from "@/components/ui/button";
import NumberPlate, { centsToUnits } from "@/components/ui/NumberPlate";
import { type FitResult } from "@/lib/fit";
import {
  cartByRetailer,
  cartLines,
  cartSubtotalCents,
  useStore,
} from "@/lib/store";
import { cn } from "@/lib/utils";
import type { CartItem, PlacedItem } from "@/types";

/**
 * The review, and the agent run, on one screen.
 *
 * The basket is not a slice of the store — it is every item standing in the
 * room that has a listing linked to it, so this page derives its lines from
 * `items` and writes back through `linkProduct`. Removing a line here unlinks
 * the listing; the sprite keeps standing in the room, and the budget moves.
 *
 * Three shops, one button. The grouping is the argument, so the shop name is
 * the loudest thing in each block and reads from two metres away.
 */

export default function CheckoutPage() {
  const router = useRouter();
  const reduced = useReducedMotion();

  const items = useStore((s) => s.items);
  const profile = useStore((s) => s.profile);
  const budgetCents = useStore((s) => s.budgetCents);
  const linkProduct = useStore((s) => s.linkProduct);
  const setActiveItem = useStore((s) => s.setActiveItem);

  /* ------------------------------------------------------------- the basket */

  const lines = React.useMemo(() => cartLines(items), [items]);
  const groups = React.useMemo(() => cartByRetailer(lines), [lines]);
  const subtotalCents = React.useMemo(() => cartSubtotalCents(lines), [lines]);
  const currency = lines[0]?.product.currency ?? "USD";
  const count = lines.reduce((n, l) => n + l.quantity, 0);

  /** the sprite and the words behind each line, by item id */
  const byId = React.useMemo(() => {
    const map = new Map<string, PlacedItem>();
    for (const item of items) map.set(item.id, item);
    return map;
  }, [items]);

  const overBudget = budgetCents > 0 && subtotalCents > budgetCents;

  /* ----------------------------------------------------------------- the run */

  const [mode, setMode] = React.useState<RunMode>(DEFAULT_RUN_MODE);
  const [phase, setPhase] = React.useState<RunPhase>("idle");
  const [rows, setRows] = React.useState<RunRow[] | null>(null);
  const [modeOpen, setModeOpen] = React.useState(false);

  // the basket is frozen the moment the agent starts: a line removed mid-run
  // would leave a row on screen with nothing behind it, and a settled run has
  // to keep the numbers it actually ran on
  const [frozenLines, setFrozenLines] = React.useState<CartItem[] | null>(null);
  const editable = phase === "idle";
  const runLines = frozenLines ?? lines;

  const handlePhase = React.useCallback(
    (next: RunPhase) => {
      setPhase(next);
      setFrozenLines((current) => (next === "idle" ? null : (current ?? lines)));
    },
    [lines]
  );

  const remove = React.useCallback(
    (itemId: string) => {
      const item = byId.get(itemId);
      const product = item?.linkedProduct;
      if (!item || !product) return;
      linkProduct(itemId, null);
      setActiveItem(itemId);
      toast(`Not buying ${product.title}`, {
        description: `Your ${item.request || item.category} is still standing in the room.`,
        action: {
          label: "Undo",
          onClick: () => linkProduct(itemId, product),
        },
      });
    },
    [byId, linkProduct, setActiveItem]
  );

  /* --------------------------------------------------------------- the fit */

  const fitFailures = React.useMemo(() => {
    const failures: Array<{ line: CartItem; result: FitResult }> = [];
    for (const line of lines) {
      const result = fitFor(line.product, profile);
      if (result && result.verdict === "fail") failures.push({ line, result });
    }
    return failures;
  }, [lines, profile]);

  /* ------------------------------------------------------------- the screens */

  if (lines.length === 0) {
    return (
      <AppShell title="Your order">
        <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
          <p className="font-display text-3xl font-semibold">Nothing linked yet</p>
          <p className="mt-2 max-w-xs text-sm text-muted-foreground">
            Tap an object standing in your room and pick one of its listings.
            Everything you link lands here, grouped by the shop that sells it.
          </p>
          <Link
            href="/room"
            className={cn(
              buttonVariants(),
              "mt-6 h-12 items-center rounded-2xl px-6 text-base"
            )}
          >
            Back to the room
          </Link>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell title="Your order">
      {/* the money, pinned under the header */}
      <div className="sticky top-[calc(56px+env(safe-area-inset-top))] z-20 -mx-4 border-b border-line bg-background/92 px-4 py-3 backdrop-blur-md">
        {/*
          Pinned for the whole screen, not just before the run. It reports what
          the SERVER does — the walk is test mode unless two server-side flags
          are both set, and the live branch throws rather than buying.
        */}
        <TestModeChip className="mb-3" />

        <div className="flex items-end justify-between gap-3">
          <NumberPlate
            value={centsToUnits(subtotalCents)}
            unit="$"
            size="lg"
            tone={overBudget ? "warn" : "default"}
            format={{ maximumFractionDigits: 0 }}
            label="Basket total"
            source={`${count} ${count === 1 ? "item" : "items"} · ${groups.length} ${
              groups.length === 1 ? "shop" : "shops"
            }`}
          />

          <button
            type="button"
            onClick={() => setModeOpen(true)}
            className="tap rounded-lg px-1 py-1 text-right text-sm text-muted-foreground transition-colors hover:bg-muted"
          >
            <span className="block font-medium text-foreground">
              {mode === "test" ? "Test run" : "Real orders"}
            </span>
            <span className="block text-[11px]">tap to see what the agent does</span>
          </button>
        </div>

        {overBudget ? (
          <p className="mt-2 text-xs text-warn">
            {formatMoney(subtotalCents - budgetCents, currency)} over the{" "}
            {formatMoney(budgetCents, currency)} you set. Nothing is removed for
            you.
          </p>
        ) : null}
      </div>

      {/* the grouping IS the story: one block per shop */}
      <div className="mt-4 space-y-4">
        {groups.map((group, index) => {
          const groupCount = group.items.reduce((n, i) => n + i.quantity, 0);
          return (
            <motion.section
              key={group.retailer}
              layout={!reduced}
              className="overflow-hidden rounded-2xl border border-line bg-surface"
            >
              <header className="flex items-center gap-3 border-b border-line bg-muted/40 px-3 py-3">
                <span
                  aria-hidden
                  className="font-display flex size-9 shrink-0 items-center justify-center rounded-full bg-accent/15 text-base font-semibold text-accent"
                >
                  {group.retailer.slice(0, 1).toUpperCase()}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="font-display block truncate text-xl font-semibold leading-tight">
                    {group.retailer}
                  </span>
                  <span className="block text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                    Shop {index + 1} of {groups.length} · {groupCount}{" "}
                    {groupCount === 1 ? "item" : "items"}
                  </span>
                </span>
                <span className="tabular font-display shrink-0 text-lg font-semibold">
                  {formatMoney(group.subtotalCents, currency)}
                </span>
              </header>

              <ul className="divide-y divide-line px-3">
                <AnimatePresence initial={false}>
                  {group.items.map((line) => {
                    const item = byId.get(line.itemId);
                    return (
                      <CartLine
                        key={line.id}
                        item={line}
                        placeholderUrl={item?.placeholderUrl ?? ""}
                        request={item?.request ?? ""}
                        onRemove={editable ? remove : undefined}
                      />
                    );
                  })}
                </AnimatePresence>
              </ul>
            </motion.section>
          );
        })}
      </div>

      {/* warn, never block */}
      {fitFailures.length > 0 ? (
        <div className="mt-5 rounded-2xl border border-warn/50 bg-warn/10 p-3">
          <p className="text-sm font-medium text-warn">
            {fitFailures.length === 1
              ? `${fitFailures[0].line.product.title} won't clear ${fitObstacle(
                  fitFailures[0].result
                )}.`
              : `${fitFailures.length} items won't clear the way in.`}
          </p>
          <ul className="mt-1 space-y-0.5">
            {fitFailures.map(({ line, result }) => (
              <li
                key={line.id}
                className="text-xs leading-relaxed text-muted-foreground"
              >
                {result.reason}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted-foreground">
            You can still buy it. Measure again in your profile if that looks
            wrong.
          </p>
        </div>
      ) : null}

      {/* one button, then the run, on this same screen */}
      <CheckoutRun
        lines={runLines}
        mode={mode}
        onPhaseChange={handlePhase}
        onFinished={setRows}
      />

      {phase === "finished" && rows ? (
        <Confirmation
          rows={rows}
          lines={runLines}
          onPlaceAnother={() => router.push("/room")}
        />
      ) : null}

      {!REAL_ORDERS_ENABLED ? (
        <p className="mt-6 text-center text-[11px] leading-relaxed text-muted-foreground">
          Real orders are off in this build and no button here can turn them on.
        </p>
      ) : null}

      <CheckoutSheet
        open={modeOpen}
        onOpenChange={setModeOpen}
        lines={runLines}
        mode={mode}
        onModeChange={setMode}
      />
    </AppShell>
  );
}
