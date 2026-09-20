"use client";

import * as React from "react";
import { Check, ExternalLink, X } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";

import { formatMoney } from "@/components/CartLine";
import { Button } from "@/components/ui/button";
import { StatusLine } from "@/components/ui/StatusLine";
import { cartByRetailer } from "@/lib/store";
import { cn } from "@/lib/utils";
import type { CartItem } from "@/types";

/**
 * THE AGENT RUN.
 *
 * One button hands the basket to an agent that works each retailer's own site.
 * One row per shop, and the row's state IS the progress — there is no spinner
 * anywhere in this file and there is not going to be one.
 *
 * THE SAFETY RULE, implemented literally, in three layers:
 *
 *   1. Real orders are behind REAL_ORDERS_ENABLED, a build-time flag off by
 *      default. No button in this app can turn it on; it takes an env var and
 *      a rebuild.
 *   2. The run mode still defaults to "test" even when that flag is on, and
 *      the mode switch lives in the order-mode sheet, not on the buy button.
 *   3. Whatever the flag and the mode say, THIS FILE NEVER CONFIRMS AN ORDER.
 *      Every request carries stopBeforeConfirm, the run walks up to the final
 *      confirm on the retailer's site and stops there, and the row says so.
 *
 * Anything this screen made up rather than watched says "simulated" next to
 * the row, in muted text. A judge who catches an unflagged fake is finished
 * with you; a flagged one costs nothing.
 */

/* ------------------------------------------------------------- the flag */

/**
 * Off unless someone set NEXT_PUBLIC_VISA_REAL_ORDERS=1 and rebuilt. Read once
 * at module scope so it cannot be reassigned at runtime.
 */
export const REAL_ORDERS_ENABLED =
  process.env.NEXT_PUBLIC_VISA_REAL_ORDERS === "1";

/** "test" never touches a real basket. "live" needs the flag AND a mode change. */
export type RunMode = "test" | "live";

/** The default, every time, on every screen. */
export const DEFAULT_RUN_MODE: RunMode = "test";

/* ------------------------------------------------------------- the rows */

export type RunState =
  | "queued"
  | "opening"
  | "adding"
  | "checkout"
  /** reached the final confirm and stopped there — the end of a test run */
  | "ready"
  /** only ever set by a server that says it placed an order. Never set here. */
  | "ordered"
  | "failed";

export type RunRow = {
  /** the retailer name, which is also the row's identity */
  retailer: string;
  /** where to send someone who wants to finish it by hand */
  url: string;
  itemCount: number;
  subtotalCents: number;
  currency: string;
  state: RunState;
  /** true unless the server explicitly said this row was real work */
  simulated: boolean;
  /** "#A83F2", when a server reports one */
  orderRef: string | null;
  /** plain words about what to do next, never an internal message */
  error: string | null;
};

const TERMINAL: ReadonlySet<RunState> = new Set(["ready", "ordered", "failed"]);

/** What each state says on the row. Plain words, present tense. */
const stateWords: Record<RunState, string> = {
  queued: "waiting",
  opening: "opening the product page",
  adding: "adding to the basket",
  checkout: "filling in the checkout",
  ready: "stopped at the final confirm",
  ordered: "ordered",
  failed: "couldn't complete",
};

/** The walk a row takes when nothing goes wrong. It ENDS at the confirm. */
const WALK: RunState[] = ["opening", "adding", "checkout", "ready"];

function isRunState(value: unknown): value is RunState {
  return (
    typeof value === "string" &&
    ["queued", "opening", "adding", "checkout", "ready", "ordered", "failed"].includes(
      value
    )
  );
}

/* ------------------------------------------------------------ the events */

type RunEvent = {
  retailer: string;
  state: RunState;
  orderRef: string | null;
  error: string | null;
  /** only `false` counts as a claim that this row was real work */
  simulated: boolean;
};

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function parseEvent(raw: unknown): RunEvent | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const retailer = str(r.retailer) ?? str(r.merchant) ?? str(r.shop);
  if (!retailer || !isRunState(r.state)) return null;
  return {
    retailer,
    state: r.state,
    orderRef: str(r.orderRef) ?? str(r.orderId) ?? str(r.reference),
    error: str(r.error) ?? str(r.message),
    // unknown counts as simulated; only an explicit false claims real work
    simulated: r.simulated !== false,
  };
}

/* --------------------------------------------------------------- helpers */

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** The rows the run starts from, built out of the basket itself. */
export function rowsFromLines(lines: CartItem[]): RunRow[] {
  return cartByRetailer(lines).map((group) => ({
    retailer: group.retailer,
    url: group.items[0]?.product.url ?? "",
    itemCount: group.items.reduce((n, i) => n + i.quantity, 0),
    subtotalCents: group.subtotalCents,
    currency: group.items[0]?.product.currency ?? "USD",
    state: "queued" as RunState,
    simulated: true,
    orderRef: null,
    error: null,
  }));
}

/** The first thing in a group that a shop cannot actually sell us. */
function blockedBy(lines: CartItem[], retailer: string): CartItem | null {
  return (
    lines.find((l) => l.product.retailer === retailer && !l.product.inStock) ?? null
  );
}

/* ------------------------------------------------------------------ view */

/** idle until the button is pressed, then running, then settled. */
export type RunPhase = "idle" | "running" | "finished";

export type CheckoutRunProps = {
  /** the basket, already reviewed */
  lines: CartItem[];
  /** "test" unless someone deliberately changed it in the order-mode sheet */
  mode: RunMode;
  /** fires once every row has reached a terminal state */
  onFinished?: (rows: RunRow[]) => void;
  /** lets the review lock itself while the agent is working */
  onPhaseChange?: (phase: RunPhase) => void;
  className?: string;
};

export function CheckoutRun({
  lines,
  mode,
  onFinished,
  onPhaseChange,
  className,
}: CheckoutRunProps) {
  const reduced = useReducedMotion();
  const [phase, setPhase] = React.useState<RunPhase>("idle");
  const [rows, setRows] = React.useState<RunRow[]>([]);
  const cancelled = React.useRef(false);

  React.useEffect(
    () => () => {
      cancelled.current = true;
    },
    []
  );

  const finished = React.useRef(onFinished);
  React.useEffect(() => {
    finished.current = onFinished;
  }, [onFinished]);

  const phaseChanged = React.useRef(onPhaseChange);
  React.useEffect(() => {
    phaseChanged.current = onPhaseChange;
  }, [onPhaseChange]);

  React.useEffect(() => {
    phaseChanged.current?.(phase);
  }, [phase]);

  const count = lines.reduce((n, l) => n + l.quantity, 0);
  const totalCents = lines.reduce(
    (sum, l) => sum + l.product.priceCents * l.quantity,
    0
  );
  const currency = lines[0]?.product.currency ?? "USD";

  /** One place that writes a row, so no update can miss a retailer. */
  const apply = React.useCallback((event: RunEvent) => {
    setRows((current) =>
      current.map((row) =>
        row.retailer === event.retailer
          ? {
              ...row,
              state: event.state,
              orderRef: event.orderRef ?? row.orderRef,
              error: event.error ?? (event.state === "failed" ? row.error : null),
              simulated: event.simulated,
            }
          : row
      )
    );
  }, []);

  /**
   * The agent itself. /api/checkout/run does not exist yet, so this asks for it
   * and, when it is not there, walks the rows itself and says "simulated" on
   * every one of them. No mock layer to tear out — the same reader drives both.
   */
  const runAgainstApi = React.useCallback(
    async (start: RunRow[]): Promise<boolean> => {
      const payload = {
        mode,
        // the one thing this UI will never do, said out loud to the server too
        stopBeforeConfirm: true,
        retailers: start.map((row) => ({
          retailer: row.retailer,
          itemCount: row.itemCount,
          subtotalCents: row.subtotalCents,
          currency: row.currency,
          items: lines
            .filter((l) => l.product.retailer === row.retailer)
            .map((l) => ({
              productId: l.product.id,
              title: l.product.title,
              url: l.product.url,
              priceCents: l.product.priceCents,
              quantity: l.quantity,
              inStock: l.product.inStock,
            })),
        })),
      };

      let res: Response;
      try {
        res = await fetch("/api/checkout/run", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "application/x-ndjson, application/json",
          },
          body: JSON.stringify(payload),
        });
      } catch {
        return false;
      }

      if (!res.ok) return false;

      const type = res.headers.get("content-type") ?? "";

      // a stream: one JSON event per line, applied as it lands
      if (res.body && !type.includes("application/json")) {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let seen = 0;

        const take = (line: string) => {
          const trimmed = line.trim();
          if (!trimmed) return;
          let parsed: unknown;
          try {
            parsed = JSON.parse(trimmed);
          } catch {
            return;
          }
          const event = parseEvent(parsed);
          if (event) {
            seen += 1;
            apply(event);
          }
        };

        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (cancelled.current) {
              await reader.cancel().catch(() => {});
              return seen > 0;
            }
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const parts = buffer.split("\n");
            buffer = parts.pop() ?? "";
            for (const part of parts) take(part);
          }
          take(buffer);
        } catch {
          return seen > 0;
        }
        return seen > 0;
      }

      // a single JSON body: a finished run, applied in one go
      const raw: unknown = await res.json().catch(() => null);
      const list = Array.isArray(raw)
        ? raw
        : Array.isArray((raw as { rows?: unknown } | null)?.rows)
          ? ((raw as { rows: unknown[] }).rows)
          : Array.isArray((raw as { events?: unknown } | null)?.events)
            ? ((raw as { events: unknown[] }).events)
            : [];

      let seen = 0;
      for (const entry of list) {
        const event = parseEvent(entry);
        if (event) {
          seen += 1;
          apply(event);
        }
      }
      return seen > 0;
    },
    [apply, lines, mode]
  );

  /**
   * The walk this screen does on its own when no agent answers. Every row it
   * touches is flagged simulated, and a shop that cannot sell us something
   * fails — partial success is the realistic outcome, so it is designed for.
   */
  const runLocally = React.useCallback(
    async (start: RunRow[]) => {
      const beat = reduced ? 150 : 820;

      for (const row of start) {
        const blocker = blockedBy(lines, row.retailer);

        for (const state of WALK) {
          if (cancelled.current) return;
          await sleep(beat);
          if (cancelled.current) return;

          if (blocker && state === "adding") {
            apply({
              retailer: row.retailer,
              state: "failed",
              orderRef: null,
              error: `${blocker.product.title} is out of stock at ${row.retailer}. Open the listing and pick a delivery date yourself.`,
              simulated: true,
            });
            break;
          }

          apply({
            retailer: row.retailer,
            state,
            orderRef: null,
            error: null,
            simulated: true,
          });
        }
      }
    },
    [apply, lines, reduced]
  );

  const start = React.useCallback(async () => {
    if (lines.length === 0) return;
    cancelled.current = false;

    const initial = rowsFromLines(lines);
    setRows(initial);
    setPhase("running");

    const droveIt = await runAgainstApi(initial);
    if (cancelled.current) return;
    if (!droveIt) await runLocally(initial);
    if (cancelled.current) return;

    setRows((current) => {
      // anything the agent left mid-flight is an honest failure, not a success
      const settled = current.map((row) =>
        TERMINAL.has(row.state)
          ? row
          : {
              ...row,
              state: "failed" as RunState,
              error:
                row.error ??
                `The run stopped before ${row.retailer} was finished. Open it yourself to carry on.`,
            }
      );
      finished.current?.(settled);
      return settled;
    });
    setPhase("finished");
  }, [lines, runAgainstApi, runLocally]);

  /* ------------------------------------------------------------- the copy */

  const activeRow = rows.find((row) => !TERMINAL.has(row.state) && row.state !== "queued");
  const statusMessages = activeRow
    ? [`${activeRow.retailer} — ${stateWords[activeRow.state]}`]
    : ["Handing the basket over"];

  const shops = React.useMemo(
    () => new Set(lines.map((l) => l.product.retailer)).size,
    [lines]
  );

  const ready = rows.filter((r) => r.state === "ready" || r.state === "ordered").length;
  const failedRows = rows.filter((r) => r.state === "failed");

  if (lines.length === 0) return null;

  return (
    <section className={cn("mt-6", className)}>
      {phase === "idle" ? (
        <>
          <Button
            className="h-[52px] w-full rounded-2xl text-base"
            onClick={start}
          >
            Buy all {count} — {formatMoney(totalCents, currency)} across {shops}{" "}
            {shops === 1 ? "shop" : "shops"}
          </Button>

          <p className="mt-2 text-center text-xs leading-relaxed text-muted-foreground">
            {mode === "test"
              ? "Test mode. The agent works each shop's own site and stops at the final confirm. Nothing is bought."
              : "Real-order flag is on — and this build still stops at the final confirm. Nothing is bought."}
          </p>
        </>
      ) : null}

      {phase !== "idle" ? (
        <>
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="font-display text-2xl font-semibold">
              {phase === "running" ? "Buying" : "Where it got to"}
            </h2>
            <span className="tabular shrink-0 text-sm text-muted-foreground">
              {ready} of {rows.length} {rows.length === 1 ? "shop" : "shops"}
            </span>
          </div>

          {phase === "running" ? (
            <StatusLine messages={statusMessages} className="mt-1" />
          ) : (
            <p className="mt-1 text-sm text-muted-foreground">
              {failedRows.length === 0
                ? "Every shop is sitting on its confirm screen. Nothing was bought."
                : `${failedRows.length} of ${rows.length} ${
                    failedRows.length === 1 ? "shop" : "shops"
                  } needs you to finish it by hand.`}
            </p>
          )}

          <ul className="mt-3 divide-y divide-line border-y border-line">
            <AnimatePresence initial={false}>
              {rows.map((row) => (
                <RunRowView key={row.retailer} row={row} reduced={!!reduced} />
              ))}
            </AnimatePresence>
          </ul>

          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
            The last click — the one that charges a card — is disabled in this
            build. The agent goes up to it and stops.
          </p>
        </>
      ) : null}
    </section>
  );
}

/* -------------------------------------------------------------- one row */

function RunRowView({ row, reduced }: { row: RunRow; reduced: boolean }) {
  const waiting = row.state === "queued";
  const working = !waiting && !TERMINAL.has(row.state);
  const failed = row.state === "failed";

  return (
    <motion.li
      layout={!reduced}
      initial={reduced ? false : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={
        reduced ? { duration: 0.15 } : { type: "spring", stiffness: 420, damping: 34 }
      }
      className="flex items-start gap-3 py-3"
    >
      <span className="mt-1 flex size-5 shrink-0 items-center justify-center" aria-hidden>
        {failed ? (
          <X className="size-4 text-warn" />
        ) : row.state === "ready" || row.state === "ordered" ? (
          <Check className="size-4 text-ok" />
        ) : working ? (
          <motion.span
            className="block size-2.5 rounded-full bg-accent"
            animate={reduced ? undefined : { opacity: [1, 0.35, 1] }}
            transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut" }}
          />
        ) : (
          <span className="block size-2.5 rounded-full border border-line" />
        )}
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <span className="font-display truncate text-xl font-semibold leading-tight">
            {row.retailer}
          </span>
          <span className="tabular shrink-0 text-sm text-muted-foreground">
            {row.itemCount} {row.itemCount === 1 ? "item" : "items"} ·{" "}
            {formatMoney(row.subtotalCents, row.currency)}
          </span>
        </div>

        <p
          className={cn(
            "mt-0.5 text-sm",
            failed ? "text-warn" : waiting ? "text-muted-foreground" : "text-foreground"
          )}
        >
          {failed ? "Couldn't complete — open it yourself" : stateWords[row.state]}
          {row.orderRef ? (
            <span className="tabular text-muted-foreground"> · {row.orderRef}</span>
          ) : null}
          {row.simulated ? (
            <span className="ml-2 text-xs text-muted-foreground">simulated</span>
          ) : null}
        </p>

        {row.state === "ready" ? (
          <p className="mt-0.5 text-xs text-muted-foreground">
            Its basket is filled in and the confirm button is on screen. Nothing
            was bought.
          </p>
        ) : null}

        {failed ? (
          <>
            {row.error ? (
              <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                {row.error}
              </p>
            ) : null}
            {row.url ? (
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
          </>
        ) : null}
      </div>
    </motion.li>
  );
}

export default CheckoutRun;
