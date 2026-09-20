"use client";

import * as React from "react";
import { ExternalLink } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";

import { fitFor, fitObstacle, formatMoney } from "@/components/CartLine";
import type { RunRow } from "@/components/CheckoutRun";
import { Button } from "@/components/ui/button";
import NumberPlate, { centsToUnits } from "@/components/ui/NumberPlate";
import { useStore } from "@/lib/store";
import type { CartItem } from "@/types";

/**
 * Where the run got to, once every row has settled.
 *
 * There is no "Ordered." headline here, because nothing was ordered: the agent
 * stops at each shop's final confirm and this screen says so in the first
 * line. Partial success is the realistic outcome, so the headline counts and
 * the failures get a link out rather than an apology.
 */

export type ConfirmationProps = {
  /** the settled rows from the run */
  rows: RunRow[];
  /** the basket the run came from, for the fit line */
  lines: CartItem[];
  onPlaceAnother: () => void;
};

export function Confirmation({ rows, lines, onPlaceAnother }: ConfirmationProps) {
  const profile = useStore((s) => s.profile);
  const reduced = useReducedMotion();

  const currency = lines[0]?.product.currency ?? "USD";

  const ready = rows.filter((r) => r.state === "ready" || r.state === "ordered");
  const failed = rows.filter((r) => r.state === "failed");
  const anySimulated = rows.some((r) => r.simulated);
  /**
   * A run the server reported as test mode is not an order, whatever the row
   * state says. "Ordered." over four test references is the one sentence on
   * this screen that could be read as a lie, so it is gated on the server's
   * own word rather than on the row reaching a terminal state.
   */
  const testRun = rows.length > 0 && rows.every((r) => r.mode !== "live");

  const readyCents = ready.reduce((sum, r) => sum + r.subtotalCents, 0);

  const headline =
    rows.length === 0
      ? "Nothing ran."
      : failed.length === 0
        ? testRun
          ? "Test run complete."
          : "Ordered."
        : `${ready.length} of ${rows.length} done.`;

  /* The fit line, measured from the same kernel the review used. */
  const fitLine = React.useMemo(() => {
    let checked = 0;
    const blocked: string[] = [];
    let obstacle = "your stair landing";
    for (const line of lines) {
      const verdict = fitFor(line.product, profile);
      if (!verdict) continue;
      checked += 1;
      if (verdict.verdict === "fail") {
        blocked.push(line.product.title);
        obstacle = fitObstacle(verdict);
      }
    }
    if (checked === 0) return null;
    if (blocked.length === 0) {
      return `All ${checked} ${
        checked === 1 ? "item clears" : "items clear"
      } your door and your stair landing.`;
    }
    return `${checked - blocked.length} of ${checked} items clear the way in — ${
      blocked[0]
    } still has to get past ${obstacle}.`;
  }, [lines, profile]);

  const spring = reduced
    ? { duration: 0.15 }
    : ({ type: "spring", stiffness: 260, damping: 30 } as const);

  return (
    <motion.section
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={spring}
      className="mt-8 border-t border-line pt-6"
    >
      <h2 className="font-display text-4xl font-semibold tracking-tight">
        {headline}
      </h2>

      <div className="mt-2 flex items-baseline gap-2">
        <NumberPlate
          value={centsToUnits(readyCents)}
          unit="$"
          size="md"
          format={{
            minimumFractionDigits: readyCents % 100 === 0 ? 0 : 2,
            maximumFractionDigits: readyCents % 100 === 0 ? 0 : 2,
          }}
          label={testRun ? "Would have cost" : "Ordered"}
          tone="muted"
        />
        <span className="text-sm text-muted-foreground">
          across {ready.length} {ready.length === 1 ? "shop" : "shops"}
          {testRun ? " — no card was charged" : ""}
        </span>
      </div>

      {anySimulated ? (
        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
          These simulated checkout steps ran on the server. They did not change
          retailer baskets or place real orders.
        </p>
      ) : null}

      <h3 className="mt-7 text-xs uppercase tracking-[0.14em] text-muted-foreground">
        Shop by shop
      </h3>
      <ul className="mt-2 divide-y divide-line border-y border-line">
        {rows.map((row) => (
          <li key={row.retailer} className="flex items-baseline gap-3 py-3">
            <span className="min-w-0 flex-1">
              <span className="font-display block truncate text-lg font-semibold">
                {row.retailer}
              </span>
              <span className="block text-xs text-muted-foreground">
                {row.itemCount} {row.itemCount === 1 ? "item" : "items"}
                {" · "}
                {row.state === "failed"
                  ? "needs finishing by hand"
                  : row.state === "ordered"
                    ? (row.orderRef ?? "ordered")
                    : "sitting on the confirm screen"}
                {row.simulated ? " · simulated" : ""}
              </span>
              {row.state === "failed" && row.url ? (
                <a
                  href={row.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="tap mt-1.5 inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-xs font-medium transition-colors hover:bg-muted"
                >
                  Open {row.retailer}
                  <ExternalLink className="size-3.5" aria-hidden />
                </a>
              ) : null}
            </span>
            <span className="tabular shrink-0 text-sm font-medium">
              {formatMoney(row.subtotalCents, currency)}
            </span>
          </li>
        ))}
      </ul>

      {fitLine ? <p className="mt-4 text-sm text-muted-foreground">{fitLine}</p> : null}

      <Button
        variant="outline"
        className="mt-8 h-[52px] w-full rounded-2xl text-base"
        onClick={onPlaceAnother}
      >
        Back to the room
      </Button>
    </motion.section>
  );
}

export default Confirmation;
