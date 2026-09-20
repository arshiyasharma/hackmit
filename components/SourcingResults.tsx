"use client";

import * as React from "react";
import useEmblaCarousel from "embla-carousel-react";
import { RefreshCw, Search, TriangleAlert } from "lucide-react";

import { fitForProduct } from "@/components/FitBadge";
import ProductCard, { linkProductToItem } from "@/components/ProductCard";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusLine } from "@/components/ui/StatusLine";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import type { PlacedItem, Product } from "@/types";

/**
 * The options for ONE placed item: the query that found them, the listings, and
 * what the fit check said about the one that is linked.
 *
 * In v2 this was a full page with a section per element. Under the pivot there
 * is only ever one item's options open at a time and they live inside the
 * option sheet at the 0.4 snap, so the room stays visible above them. The Embla
 * row, the skeleton cards and the honest empty state are v2's and survive.
 */

export type SourcingResultsLayout = "rail" | "list";

export type SourcingResultsProps = {
  item: PlacedItem;
  /** the EXACT string that was sent to /api/search, shown in mono up top */
  query: string;
  /** "rail" at the phone snap, "list" when the sheet is dragged up to 0.9 */
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
  layout = "rail",
  note,
  onRetry,
  className,
}: SourcingResultsProps) {
  const options = item.options;
  const loading = item.optionsStatus === "pending";
  const failed = item.optionsStatus === "failed";

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {/*
       * THE QUERY, ON SCREEN. This is the string that was sent, character for
       * character — it is how the room context turns into results, and it is
       * what you point at when a judge asks how the search is personalised.
       * Removing a style chip changes it.
       */}
      <p className="font-mono text-[11px] leading-snug text-muted-foreground">
        <span className="text-foreground/70">searching</span>{" "}
        <span className="text-foreground">{query || item.request}</span>
      </p>

      {loading ? (
        <div className="flex flex-col gap-2">
          <Rail>
            {[0, 1, 2, 3, 4].map((i) => (
              <Slide key={i}>
                <SkeletonCard />
              </Slide>
            ))}
          </Rail>
          <StatusLine messages={statusMessages(query)} />
        </div>
      ) : options.length > 0 ? (
        <>
          <FitLine item={item} />
          {layout === "list" ? (
            <div className="flex max-h-[62vh] flex-col gap-3 overflow-y-auto overscroll-contain pb-2">
              {options.map((product) => (
                <ProductCard key={product.id} product={product} />
              ))}
            </div>
          ) : (
            <Rail>
              {options.map((product) => (
                <Slide key={product.id}>
                  <ProductCard product={product} />
                </Slide>
              ))}
            </Rail>
          )}
          <p className="text-[11px] text-muted-foreground">
            {options.length} listing{options.length === 1 ? "" : "s"} · from{" "}
            {new Set(options.map((p) => p.retailer)).size} shop
            {new Set(options.map((p) => p.retailer)).size === 1 ? "" : "s"} · tap a
            title to open it at the shop
          </p>
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
 * A fail warns and never blocks — the user decides. And it never refuses
 * without offering: the passing options from this same set are one tap away.
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

  const warn = fit.verdict === "fail";

  return (
    <div
      className={cn(
        "flex flex-col gap-2 rounded-xl border p-3",
        warn ? "border-accent/40 bg-accent/10" : "border-warn/35 bg-warn/10"
      )}
    >
      <p className="flex items-start gap-2 text-sm leading-snug">
        <TriangleAlert
          className={cn("mt-0.5 size-4 shrink-0", warn ? "text-accent" : "text-warn")}
          aria-hidden
        />
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
              onClick={() => void linkProductToItem(item.id, p)}
              className="tap inline-flex h-9 items-center gap-1.5 rounded-full border border-line bg-background px-3 text-xs font-medium hover:bg-muted"
            >
              {p.retailer} · ${Math.round(p.priceCents / 100)}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------- carousels */

/**
 * Embla owns the horizontal gesture. A raw overflow-x container is what makes
 * a horizontal row fight the page's vertical scroll on iOS Safari; `touch-pan-y`
 * on the container hands vertical drags straight back to the page.
 */
function Rail({ children }: { children: React.ReactNode }) {
  const [emblaRef, emblaApi] = useEmblaCarousel({
    align: "start",
    containScroll: "trimSnaps",
    dragFree: false,
  });

  const count = React.Children.count(children);

  React.useEffect(() => {
    if (!emblaApi) return;
    // a rail that mounted inside a closed sheet never got a ResizeObserver
    // callback; measure once on attach rather than trusting the first one
    emblaApi.reInit();
  }, [emblaApi, count]);

  return (
    <div ref={emblaRef} className="-mx-4 overflow-hidden px-4">
      <div className="flex touch-pan-y gap-3">{children}</div>
    </div>
  );
}

function Slide({ children }: { children: React.ReactNode }) {
  return <div className="min-w-0 flex-[0_0_72%] sm:flex-[0_0_48%]">{children}</div>;
}

function SkeletonCard() {
  return (
    <div className="flex h-full flex-col gap-2.5 rounded-2xl border border-line bg-surface p-3">
      <Skeleton className="aspect-[4/3] w-full rounded-xl" />
      <Skeleton className="h-3 w-20" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-2/3" />
      <Skeleton className="h-6 w-24" />
      <Skeleton className="h-3 w-3/4" />
      <Skeleton className="h-11 w-full rounded-full" />
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
    <div className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4">
      <p className="font-display text-lg font-semibold">
        {failed ? "The shops didn't answer" : "Nothing came back for that"}
      </p>
      <p className="text-sm text-muted-foreground">
        {note ??
          (failed
            ? "Try the search again, or take the words straight to a shop."
            : "Try it again, or drop a style word from the strip at the top to widen the search.")}
      </p>

      <div className="flex flex-wrap gap-2">
        <a
          href={manualSearchUrl(query)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-11 items-center gap-2 rounded-full bg-accent px-4 text-sm font-medium text-[var(--on-accent)]"
        >
          <Search className="size-4" aria-hidden />
          Search the shops yourself
        </a>

        {onRetry ? (
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex h-11 items-center gap-2 rounded-full border border-line px-4 text-sm font-medium hover:bg-muted"
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
