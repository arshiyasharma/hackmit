"use client";

import { ShieldCheck } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * TEST MODE — no money moves.
 *
 * NOT SUBTLE, ON PURPOSE. A judge who is not sure whether you are charging
 * cards is a judge who has stopped listening to the rest of the pitch, and the
 * cheapest way to keep their attention is to answer the question before they
 * ask it. This sits pinned at the top of the checkout screen the whole time —
 * before the run, during it, and after — and it is meant to be readable from
 * three metres.
 *
 * IT IS NOT A SWITCH. Nothing here can be tapped, because the thing it reports
 * is decided on the server: the walk is test mode unless BOTH `CHECKOUT_MODE`
 * and `ENABLE_REAL_ORDERS` are set, and the live branch throws rather than
 * buying. This label describes that, it does not control it.
 */

export type TestModeChipProps = {
  /**
   * Set only when a server response has said the run was live. Left alone,
   * the chip says test — which is what the server does by default.
   */
  live?: boolean;
  className?: string;
};

export function TestModeChip({ live = false, className }: TestModeChipProps) {
  if (live) {
    return (
      <div
        role="status"
        className={cn(
          "flex items-center justify-center gap-2 rounded-xl border border-warn bg-warn/15 px-3 py-2",
          className
        )}
      >
        <ShieldCheck className="size-4 shrink-0 text-warn" aria-hidden />
        <span className="text-xs font-semibold uppercase tracking-[0.16em] text-warn">
          Live mode — real orders enabled
        </span>
      </div>
    );
  }

  return (
    <div
      role="status"
      className={cn(
        "flex items-center justify-center gap-2 rounded-xl border border-ok/50 bg-ok/12 px-3 py-2",
        className
      )}
    >
      <ShieldCheck className="size-4 shrink-0 text-ok" aria-hidden />
      <span className="text-xs font-semibold uppercase tracking-[0.16em] text-ok">
        Test mode — no money moves
      </span>
    </div>
  );
}

export default TestModeChip;
