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
 * Listings for one placed item, shown in the left sidebar or a horizontal
 * rail. Hovering or focusing a card previews that listing in the room;
 * linking and fit checks continue to be owned by ProductCard.
 */
export type SourcingResultsLayout = "rail" | "list";

export type SourcingResultsProps = {
  item: PlacedItem;
  /** the EXACT string that was sent to /api/search */
  query: string;
  /** A vertical options drawer or a horizontal listing rail. */
  layout?: SourcingResultsLayout;
  /** a note from the search route: not connected, nothing found, frozen demo */
  note?: string;
  onRetry?: () => void;
  className?: string;
};

function statusMessages(query: string): string[] {
  const subject = query.trim() || "listings";
  return [`Searching for ${subject}…`];
}

/** When nothing comes back, hand the query to a shop search rather than a dead end. */
function manualSearchUrl(query: string): string {
  return `https://www.google.com/search?tbm=shop&q=${encodeURIComponent(query)}`;
}

export function SourcingResults({
  item,
  query,
  layout = "rail",
  note,
  onRetry,
  className,
}: SourcingResultsProps) {
  const options = item.options;
  const loading = item.optionsStatus === "pending";
  const failed = item.optionsStatus === "failed";

  return (
    <div
      data-layout={layout}
      className={cn(
        "sourcing-results flex min-h-0 flex-col gap-2.5 overflow-hidden",
        layout === "list" && "[&_[data-card]]:rounded-none [&_.font-mono]:font-sans",
        className
      )}
    >
      {loading ? (
        <>
          <Row label="Looking for listings" layout={layout}>
            {[0, 1, 2, 3, 4].map((i) => (
              <Cell key={i} layout={layout}>
                <SkeletonCard />
              </Cell>
            ))}
          </Row>
          <StatusLine
            messages={statusMessages(query)}
            className="min-h-5 shrink-0 font-sans text-[12px] leading-5"
          />
        </>
      ) : options.length > 0 ? (
        <>
          <FitLine item={item} />
          <Row label={`Listings for ${item.category || item.request}`} item={item} layout={layout}>
            {options.map((product, i) => (
              <Cell key={product.id} order={i} layout={layout}>
                <ProductCard product={product} index={i} />
              </Cell>
            ))}
          </Row>
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
        "flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1.5 rounded-none border px-3 py-2",
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
                "tap inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-none border border-line bg-white/55 px-3",
                "text-xs font-medium transition-colors hover:border-accent-pale hover:bg-accent-wash",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              )}
            >
              {p.retailer} ·{" "}
              <span className="tabular-nums font-sans font-normal">
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
 * A vertical list scrolls within its drawer. A rail scrolls sideways when
 * its cards exceed the available width, with a fade at the cut edge.
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
  layout,
}: {
  children: React.ReactNode;
  label: string;
  layout: SourcingResultsLayout;
  /** present when the cards are real listings that can be tried on */
  item?: PlacedItem;
}) {
  const ref = React.useRef<HTMLDivElement | null>(null);
  /** the listing under the pointer, by product id */
  const pointed = React.useRef<string | null>(null);
  const count = React.Children.count(children);

  /* the rail fades at an edge when more listings sit beyond it */
  React.useEffect(() => {
    const el = ref.current;
    if (!el || layout === "list") return;
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
  }, [count, layout]);

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
    const forward = event.key === "ArrowRight" || (layout === "list" && event.key === "ArrowDown");
    const backward = event.key === "ArrowLeft" || (layout === "list" && event.key === "ArrowUp");
    if (!forward && !backward) return;
    if (event.altKey || event.metaKey || event.ctrlKey) return;
    const from = cardOf(event.target);
    const el = ref.current;
    if (!from || !el) return;

    const cards = Array.from(el.querySelectorAll<HTMLElement>("[data-card]"));
    const next = cards[cards.indexOf(from) + (forward ? 1 : -1)];
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
      data-layout={layout}
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
        if (!el || layout === "list" || el.scrollWidth <= el.clientWidth) return;
        if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) el.scrollLeft += event.deltaY;
      }}
      style={layout === "list" ? undefined : {
        maskImage:
          "linear-gradient(to right, transparent, #000 var(--fade-l, 0px), #000 calc(100% - var(--fade-r, 0px)), transparent)",
        WebkitMaskImage:
          "linear-gradient(to right, transparent, #000 var(--fade-l, 0px), #000 calc(100% - var(--fade-r, 0px)), transparent)",
      }}
      className={cn(
        // the padding is room for a focus ring and the linked card's outline,
        // which a scrolling box would otherwise clip; the margin takes it back
        "sourcing-results-group -m-1 flex min-h-0 flex-1 gap-3 p-1",
        layout === "list"
          ? "flex-col overflow-x-hidden overflow-y-auto overscroll-y-contain scroll-py-1"
          : "no-scrollbar overflow-x-auto overscroll-x-contain scroll-px-1"
      )}
    >
      {children}
    </div>
  );
}

/** Sidebar cards grow when dimensions are expanded; rail cards share available width. */
function Cell({ children, order, layout }: {
  children: React.ReactNode;
  order?: number;
  layout: SourcingResultsLayout;
}) {
  const reduced = useReducedMotion();
  const className = layout === "list"
    ? "min-h-[282px] min-w-0 shrink-0"
    : "min-w-[10.5rem] flex-1 basis-0";

  // the wait's blocks simply stand there; real listings arrive one after another
  if (order === undefined) {
    return <div className={className}>{children}</div>;
  }

  return (
    <motion.div
      className={className}
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
    <div className="flex h-full min-h-[282px] flex-col rounded-none border border-line/70 bg-white/50 p-2.5">
      <Skeleton className="min-h-[98px] w-full flex-1 rounded-none" />
      <Skeleton className="mt-2 h-[18px] w-4/5 shrink-0 rounded-none" />
      <div className="mt-2 flex shrink-0 items-center justify-between gap-2">
        <Skeleton className="h-3 w-20 rounded-none" />
        <Skeleton className="h-4 w-12 rounded-none" />
      </div>
      <Skeleton className="mt-2.5 h-9 w-full shrink-0 rounded-none" />
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
    <div className="flex min-h-0 flex-1 flex-col items-start gap-4 overflow-y-auto rounded-none border border-line/70 bg-white/45 px-4 py-5">
      <div className="min-w-0">
        <p className="font-sans text-[18px] font-medium leading-tight text-foreground">
          {failed ? "Search unavailable" : "No matches yet"}
        </p>
        <p className="mt-2 max-w-[62ch] text-[13px] leading-relaxed text-muted-foreground">
          {note ??
            (failed
              ? "Try again or search the shops directly."
              : "Try again or remove a style filter to widen your search.")}
        </p>
      </div>

      <div className="flex w-full flex-wrap gap-2">
        <a
          href={manualSearchUrl(query)}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(
            "inline-flex min-h-9 cursor-pointer items-center justify-center gap-2 rounded-none bg-accent px-3 py-2 text-[13px] font-medium text-[var(--on-accent)]",
            "transition-opacity hover:opacity-90",
            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          )}
        >
          <Search className="size-4" aria-hidden />
          Search shops
          <span className="sr-only">(opens in a new tab)</span>
        </a>

        {onRetry ? (
          <button
            type="button"
            onClick={onRetry}
            className={cn(
              "inline-flex min-h-9 cursor-pointer items-center justify-center gap-2 rounded-none border border-line bg-white/60 px-3 py-2 text-[13px] font-medium",
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
