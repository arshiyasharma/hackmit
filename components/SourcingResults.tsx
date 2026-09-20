"use client";

import * as React from "react";
import { RefreshCw, Search, TriangleAlert } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";

import { fitForProduct } from "@/components/FitBadge";
import ProductCard, { formatPrice, linkProductToItem } from "@/components/ProductCard";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusLine } from "@/components/ui/StatusLine";
import { ENTER, REDUCED, STAGGER } from "@/lib/motion";
import { usePreview } from "@/lib/preview";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import type { PlacedItem, Product } from "@/types";

/**
 * The body of the listing tray for ONE placed item: the listings, what the fit
 * check said about the one that is linked, and the honest empty state.
 *
 * BEATS 04 AND 05 OF THE MOTION SHEET LIVE IN THIS ROW. Five real things stand
 * side by side under the room, and POINTING AT ONE TRIES IT ON: whichever card
 * is under the pointer — or holds the keyboard focus — is handed to
 * lib/preview.ts, and the thing standing in the room takes that listing's size
 * before anything is committed. Leaving the row puts it back. Clicking "Link
 * this" keeps it.
 *
 * The row is one structure at every width: equal cards that all fit when the
 * window allows it, and a sideways scroll with a soft fade at the cut edge when
 * it does not. The exact query string is printed by the tray's header
 * (components/OptionSheet.tsx); this file still receives it, for the words of
 * the wait and for the way out when nothing comes back.
 */

/** From the bottom-sheet days, when a tall sheet swapped the rail for a list. */
export type SourcingResultsLayout = "rail" | "list";

export type SourcingResultsProps = {
  item: PlacedItem;
  /** the EXACT string that was sent to /api/search */
  query: string;
  /** accepted so an older caller still compiles; there is one layout now */
  layout?: SourcingResultsLayout;
  /** a note from the search route: not connected, nothing found, frozen demo */
  note?: string;
  onRetry?: () => void;
  className?: string;
};

function statusMessages(query: string): string[] {
  const subject = query.trim() || "listings";
  return [
    `Searching for ${subject}…`,
    "Reading dimensions off the listings…",
    "Checking each one against your doorway…",
  ];
}

/** When nothing comes back, hand the query to a shop search rather than a dead end. */
function manualSearchUrl(query: string): string {
  return `https://www.google.com/search?tbm=shop&q=${encodeURIComponent(query)}`;
}

export function SourcingResults({
  item,
  query,
  note,
  onRetry,
  className,
}: SourcingResultsProps) {
  const options = item.options;
  const loading = item.optionsStatus === "pending";
  const failed = item.optionsStatus === "failed";

  return (
    <div className={cn("flex min-h-0 flex-col gap-2.5", className)}>
      {loading ? (
        <>
          <Row label="Looking for listings">
            {[0, 1, 2, 3, 4].map((i) => (
              <Cell key={i}>
                <SkeletonCard />
              </Cell>
            ))}
          </Row>
          <StatusLine
            messages={statusMessages(query)}
            className="min-h-5 shrink-0 text-[13px] leading-5"
          />
        </>
      ) : options.length > 0 ? (
        <>
          <FitLine item={item} />
          <Row label={`Listings for ${item.category || item.request}`} item={item}>
            {options.map((product, i) => (
              <Cell key={product.id} order={i}>
                <ProductCard product={product} index={i} />
              </Cell>
            ))}
          </Row>

          {/* only a tall window has a line to spare under the row */}
          <div className="hidden shrink-0 items-baseline justify-between gap-6 [@media(min-height:60rem)]:flex">
            {/* a note riding on real options means the rehearsal set: the
                frozen listings are not for sale, so the line does not claim it */}
            {note ? (
              <span aria-hidden />
            ) : (
              <p className="font-display text-[22px] font-medium leading-none tracking-[0.01em] text-foreground">
                Everything you see is something you can buy.
              </p>
            )}
            <p className="truncate text-[12px] text-muted-foreground">
              Point at one to try it on · click a name to open it at the shop ·
              arrow keys move along the row
            </p>
          </div>
        </>
      ) : (
        <NoMatch query={query} failed={failed} note={note} onRetry={onRetry} />
      )}
    </div>
  );
}

/* ------------------------------------------------------------- the verdict */

/**
 * What the fit kernel said about the listing that is linked, printed verbatim.
 *
 * A fail warns and never blocks — the shopper decides. And it never refuses
 * without offering: the passing options from this same set are one click away.
 * Both verdicts speak in the warn colour (the accent is a calm blue now, and
 * blue does not say "this will not get up your stairs"); a fail is simply the
 * louder of the two.
 */
function FitLine({ item }: { item: PlacedItem }) {
  const profile = useStore((s) => s.profile);
  const linked = item.linkedProduct;
  const fit = item.fit;

  const alternatives = React.useMemo<Product[]>(() => {
    if (!fit || fit.verdict === "pass") return [];
    return item.options
      .filter((p) => p.id !== linked?.id)
      .filter((p) => fitForProduct(p, profile)?.verdict === "pass")
      .slice(0, 2);
  }, [fit, item.options, linked?.id, profile]);

  if (!linked || !fit || fit.verdict === "pass") return null;

  const fail = fit.verdict === "fail";

  return (
    <div
      className={cn(
        "flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1.5 rounded-[14px] border px-3 py-1.5",
        fail ? "border-warn/55 bg-warn/12" : "border-warn/30 bg-warn/6"
      )}
    >
      <p className="flex min-w-0 flex-1 basis-80 items-start gap-2 text-[13px] leading-snug text-foreground">
        <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warn" aria-hidden />
        {/* the kernel's own sentence, not a word of it rewritten */}
        <span>{fit.reason}</span>
      </p>

      {alternatives.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">These get in:</span>
          {alternatives.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => {
                void linkProductToItem(item.id, p);
                usePreview.getState().clear();
              }}
              className={cn(
                "tap inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-full border border-line bg-surface px-3",
                "text-xs font-medium transition-colors hover:border-accent-pale hover:bg-accent-wash",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              )}
            >
              {p.retailer} ·{" "}
              <span className="tabular font-mono font-normal">
                {formatPrice(p.priceCents, p.currency)}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/* ----------------------------------------------------------------- the row */

/**
 * One row, equal cards. It scrolls sideways only when the window is too narrow
 * to hold them, and then the cut edge fades instead of ending in a hard line.
 *
 * It is also where "what is being tried on" is decided, in ONE place rather
 * than in five cards: the pointer wins, then the keyboard focus, then nothing.
 * The fit check opens as a dialog from inside a card, and a dialog's events
 * bubble up here through React even though it lives on <body> — so everything
 * below asks the DOM, not React, whether the event really came from the row.
 */
function Row({
  children,
  label,
  item,
}: {
  children: React.ReactNode;
  label: string;
  /** present when the cards are real listings that can be tried on */
  item?: PlacedItem;
}) {
  const ref = React.useRef<HTMLDivElement | null>(null);
  /** the listing under the pointer, by product id */
  const pointed = React.useRef<string | null>(null);
  const count = React.Children.count(children);

  /* the soft fade at whichever edge has more row beyond it */
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const beyond = el.scrollWidth - el.clientWidth;
      el.style.setProperty("--fade-l", el.scrollLeft > 2 ? "28px" : "0px");
      el.style.setProperty("--fade-r", el.scrollLeft < beyond - 2 ? "28px" : "0px");
    };
    measure();
    el.addEventListener("scroll", measure, { passive: true });
    const watch = new ResizeObserver(measure);
    watch.observe(el);
    for (const child of Array.from(el.children)) watch.observe(child);
    return () => {
      el.removeEventListener("scroll", measure);
      watch.disconnect();
    };
    // a different number of cards is a different row to measure
  }, [count]);

  const cardOf = (node: EventTarget | null): HTMLElement | null => {
    const el = ref.current;
    if (!el || !(node instanceof Element) || !el.contains(node)) return null;
    return node.closest<HTMLElement>("[data-card]");
  };

  /** pointer first, then keyboard focus, else nothing is being tried on */
  const settle = () => {
    if (!item) return;
    const focused = cardOf(document.activeElement)?.dataset.productId ?? null;
    const id = pointed.current ?? focused;
    const product = id ? item.options.find((p) => p.id === id) : undefined;
    if (product) usePreview.getState().focus(item.id, product);
    else usePreview.getState().clear();
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    if (event.altKey || event.metaKey || event.ctrlKey) return;
    const from = cardOf(event.target);
    const el = ref.current;
    if (!from || !el) return;

    const cards = Array.from(el.querySelectorAll<HTMLElement>("[data-card]"));
    const next = cards[cards.indexOf(from) + (event.key === "ArrowRight" ? 1 : -1)];
    if (!next) return;

    // land on the button, so Enter links; a card with nothing to link to still
    // has its name to stand on
    const stop =
      next.querySelector<HTMLElement>("[data-card-link]:not([disabled])") ??
      next.querySelector<HTMLElement>("a[href]");
    if (!stop) return;
    event.preventDefault();
    stop.focus();
  };

  return (
    <div
      ref={ref}
      role="group"
      aria-label={label}
      onKeyDown={onKeyDown}
      onPointerOver={(event) => {
        pointed.current = cardOf(event.target)?.dataset.productId ?? null;
        settle();
      }}
      onPointerLeave={() => {
        pointed.current = null;
        settle();
      }}
      onFocus={settle}
      onBlur={settle}
      onWheel={(event) => {
        // a mouse wheel only speaks in Y; let it walk a row that has more to show
        const el = ref.current;
        if (!el || el.scrollWidth <= el.clientWidth) return;
        if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) el.scrollLeft += event.deltaY;
      }}
      style={{
        maskImage:
          "linear-gradient(to right, transparent, #000 var(--fade-l, 0px), #000 calc(100% - var(--fade-r, 0px)), transparent)",
        WebkitMaskImage:
          "linear-gradient(to right, transparent, #000 var(--fade-l, 0px), #000 calc(100% - var(--fade-r, 0px)), transparent)",
      }}
      className={cn(
        // the padding is room for a focus ring and the linked card's outline,
        // which a scrolling box would otherwise clip; the margin takes it back
        "no-scrollbar -m-1 flex min-h-0 flex-1 gap-3 overflow-x-auto overscroll-x-contain p-1",
        "scroll-px-1"
      )}
    >
      {children}
    </div>
  );
}

/** One equal share of the row, never narrower than a card can be read at. */
function Cell({ children, order }: { children: React.ReactNode; order?: number }) {
  const reduced = useReducedMotion();

  // the wait's blocks simply stand there; real listings arrive one after another
  if (order === undefined) {
    return <div className="min-w-[10.5rem] flex-1 basis-0">{children}</div>;
  }

  return (
    <motion.div
      className="min-w-[10.5rem] flex-1 basis-0"
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={
        reduced ? REDUCED : { ...ENTER, delay: Math.min(order, 6) * STAGGER.chip }
      }
    >
      {children}
    </motion.div>
  );
}

/** Shaped like the real card, so the row does not jump when the answer lands. */
function SkeletonCard() {
  return (
    <div className="flex h-full flex-col rounded-[22px] border border-line bg-surface p-2.5">
      <Skeleton className="min-h-0 w-full flex-1 rounded-[14px]" />
      <Skeleton className="mt-2 h-[18px] w-4/5 shrink-0 rounded-full" />
      <div className="mt-2 flex shrink-0 items-center justify-between gap-2">
        <Skeleton className="h-3 w-20 rounded-full" />
        <Skeleton className="h-4 w-12 rounded-full" />
      </div>
      <Skeleton className="mt-2.5 h-11 w-full shrink-0 rounded-full" />
    </div>
  );
}

/* --------------------------------------------------------------- no match */

function NoMatch({
  query,
  failed,
  note,
  onRetry,
}: {
  query: string;
  failed: boolean;
  note?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-wrap items-center gap-x-10 gap-y-4 overflow-y-auto rounded-[22px] border border-line bg-surface/80 px-6 py-5">
      <div className="min-w-0 flex-1 basis-80">
        <p className="font-display text-[30px] font-normal leading-[1.02] tracking-[0.01em]">
          {failed ? "The shops didn't answer" : "Nothing came back for that"}
        </p>
        <p className="mt-2 max-w-[62ch] text-sm leading-relaxed text-muted-foreground">
          {note ??
            (failed
              ? "Try the search again, or take the words straight to a shop."
              : "Try it again, or drop a style word from the strip at the top to widen the search.")}
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <a
          href={manualSearchUrl(query)}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(
            "glass-blue inline-flex h-11 cursor-pointer items-center gap-2 rounded-full! px-5 text-sm font-medium",
            "transition-[filter] duration-[240ms] hover:brightness-110",
            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          )}
        >
          <Search className="size-4" aria-hidden />
          Search the shops yourself
          <span className="sr-only">(opens in a new tab)</span>
        </a>

        {onRetry ? (
          <button
            type="button"
            onClick={onRetry}
            className={cn(
              "inline-flex h-11 cursor-pointer items-center gap-2 rounded-full border border-line bg-surface px-5 text-sm font-medium",
              "transition-colors hover:border-accent-pale hover:bg-accent-wash",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            )}
          >
            <RefreshCw className="size-4" aria-hidden />
            Try again
          </button>
        ) : null}
      </div>
    </div>
  );
}

export default SourcingResults;
