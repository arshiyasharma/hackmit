"use client";

import * as React from "react";
import { ArrowRight, X } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";

import { formatCarton } from "@/components/ui/NumberPlate";
import { fits, type FitResult, type Profile as FitProfile } from "@/lib/fit";
import { ENTER, EXIT, REDUCED } from "@/lib/motion";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { profileToFitProfile } from "@/lib/fitProfile";
import { productImage, type CartItem, type Product, type Profile } from "@/types";

/**
 * One line on the checkout review.
 *
 * BOTH IMAGES, ALWAYS. The stand-in sprite that stood in the room, then the
 * real listing photo that is actually being bought. Side by side, with an
 * arrow between them. It is the honest answer to "so what was that cartoon
 * lamp?" and it costs one img tag.
 *
 * A WIDE ROW, read left to right like a line on an invoice: the two pictures,
 * then the words (title, what was asked for, the size and where that size came
 * from, the fit), then the price in its own right-aligned mono column so a
 * basket of prices lines up down the page, then the cross. Every figure is mono
 * and tabular. When the column gets narrow the words simply wrap.
 *
 * The row holds no state. The page owns the store writes, so removing a line
 * and the budget reacting stay one action.
 *
 * components/CheckoutRun.tsx imports `formatMoney` from here and is rendered by
 * a node test with no DOM and no router: nothing at this module's top level may
 * touch `window`, `document` or next/navigation.
 */

/** A keyboard has to be able to see where it is: the accent, two pixels. */
const FOCUS_RING =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

/* ------------------------------------------------------------------- money */

/**
 * Money is integer cents everywhere. This is the only formatter in the
 * checkout, so a price, a group subtotal and the buy button can never
 * disagree. Pattern from ref/commerce components/price.tsx (vercel/commerce,
 * MIT).
 */
export function formatMoney(
  cents: number | null | undefined,
  currency = "USD",
  locales: Intl.LocalesArgument = "en-US"
): string {
  if (typeof cents !== "number" || !Number.isFinite(cents)) return "—";
  return new Intl.NumberFormat(locales, {
    style: "currency",
    currency,
    currencyDisplay: "narrowSymbol",
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
}

/* --------------------------------------------------------------------- fit */

/**
 * lib/fit.ts names its own Profile fields (doorW, stairW, ...) while the store
 * carries the millimetre-suffixed names from types/index.ts. One adapter, here,
 * so the mismatch lives in exactly one place until the two agree.
 */
export function toFitProfile(profile: Profile): FitProfile {
  return profileToFitProfile(profile);
}

/** null means the listing never published a size — a UI state, not a verdict. */
export function fitFor(product: Product, profile: Profile): FitResult | null {
  if (!product.dimsMm) return null;
  return fits(product.dimsMm, { ...toFitProfile(profile), dimensionsSource: product.dimsSource });
}

/** Plain words for what the item would hit on the way in. */
export function fitObstacle(result: FitResult): string {
  if (result.binding === "door") return "your door";
  if (result.binding === "headroom") return "the ceiling at your landing";
  return "your stair landing";
}

const verdictLabel: Record<FitResult["verdict"], string> = {
  pass: "Model clearance",
  tight: "Tight",
  fail: "Clearance risk",
  unknown: "Measurements needed",
};

const verdictClass: Record<FitResult["verdict"], string> = {
  pass: "border-ok/35 text-ok",
  tight: "border-warn/45 text-warn",
  fail: "border-warn/70 text-warn",
  unknown: "border-line text-muted-foreground",
};

const verdictDot: Record<FitResult["verdict"], string> = {
  pass: "bg-ok",
  tight: "bg-warn/60",
  fail: "bg-warn",
  unknown: "bg-muted-foreground",
};

/**
 * The review's own fit chip. It reads the same store profile and calls the
 * same kernel as components/FitBadge.tsx, but it opens no sheet — a checkout
 * line is not the place to start browsing alternatives.
 */
export function LineFit({ product }: { product: Product }) {
  const profile = useStore((s) => s.profile);
  const result = React.useMemo(() => fitFor(product, profile), [product, profile]);

  if (!result) {
    return (
      <span className="inline-flex min-h-6 items-center rounded-full border border-line bg-surface/70 px-2.5 text-[12px] text-muted-foreground">
        No dimensions listed
      </span>
    );
  }

  const margin =
    typeof result.marginMm === "number"
      ? `${new Intl.NumberFormat("en-US").format(Math.abs(result.marginMm))} mm ${
          result.marginMm < 0 ? "short" : "to spare"
        }`
      : null;

  return (
    <span
      title={result.reason}
      className={cn(
        "inline-flex min-h-6 max-w-full flex-wrap items-center gap-x-1.5 gap-y-0.5 rounded-full border bg-surface/70 px-2.5 py-0.5 text-[12px]",
        verdictClass[result.verdict]
      )}
    >
      <span
        aria-hidden
        className={cn("size-1.5 shrink-0 rounded-full", verdictDot[result.verdict])}
      />
      <span className="whitespace-nowrap font-medium">{result.confidence === "estimated" ? "Estimated · " : ""}{verdictLabel[result.verdict]}</span>
      {/* a measurement, so it is set like one */}
      {margin ? (
        <span className="tabular whitespace-nowrap font-mono text-[11px]">· {margin}</span>
      ) : null}
    </span>
  );
}

/* ------------------------------------------------------------ the two shots */

/**
 * The stand-in and the real thing, side by side. The sprite sits on the muted
 * surface with `object-contain` because it is a cutout with its own alpha; the
 * listing photo is a photograph and crops.
 */
function BothImages({
  placeholderUrl,
  product,
  request,
}: {
  placeholderUrl: string;
  product: Product;
  request: string;
}) {
  const shot = productImage(product);

  const frame =
    "size-14 overflow-hidden rounded-2xl border border-line desk:size-[4.5rem]";
  const caption =
    "mt-1.5 text-center font-mono text-[11px] leading-none tracking-[0.1em] whitespace-nowrap text-muted-foreground uppercase";

  return (
    <div className="flex shrink-0 items-start gap-2 desk:gap-3">
      <figure className="flex w-14 flex-col items-center desk:w-[4.5rem]">
        {/* the blueprint wash: this one is a drawing of a thing, not the thing */}
        <div className={cn(frame, "flex items-center justify-center bg-accent-wash")}>
          {placeholderUrl ? (
            // The sprite is written to disk by /api/placeholder and served back
            // from there; next/image would only add a second encode.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={placeholderUrl}
              alt={`The stand-in sprite for ${request || product.title}`}
              loading="lazy"
              decoding="async"
              className="size-full object-contain p-1.5"
            />
          ) : (
            <span className="px-1 text-center text-[11px] leading-tight text-muted-foreground">
              no sprite
            </span>
          )}
        </div>
        <figcaption className={caption}>stood in</figcaption>
      </figure>

      <ArrowRight
        className="mt-5 size-4 shrink-0 text-accent desk:mt-7"
        aria-hidden
      />

      <figure className="flex w-14 flex-col items-center desk:w-[4.5rem]">
        <div className={cn(frame, "bg-muted")}>
          {shot ? (
            // Listing images come from whichever retailer sourced them, and
            // next.config.ts has no remotePatterns for them.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={shot}
              alt={product.title}
              loading="lazy"
              decoding="async"
              className="size-full object-cover"
            />
          ) : (
            <span className="flex size-full items-center justify-center font-display text-[26px] font-medium text-muted-foreground">
              {product.title.slice(0, 1).toUpperCase()}
            </span>
          )}
        </div>
        <figcaption className={caption}>buying</figcaption>
      </figure>
    </div>
  );
}

/* -------------------------------------------------------------------- line */

export type CartLineProps = {
  item: CartItem;
  /** the sprite that stood in the room for this line; "" while it is missing */
  placeholderUrl?: string;
  /** what the user asked for, in their words: "a tall lamp" */
  request?: string;
  /** over budget: the line dims but is never removed for the user */
  dimmed?: boolean;
  /** unlinks the listing; the sprite stays standing in the room */
  onRemove?: (itemId: string) => void;
  className?: string;
};

export function CartLine({
  item,
  placeholderUrl = "",
  request = "",
  dimmed = false,
  onRemove,
  className,
}: CartLineProps) {
  const reduced = useReducedMotion();
  const { product, quantity } = item;
  const lineCents = product.priceCents * quantity;
  const dims = formatCarton(product.dimsMm);

  return (
    <motion.li
      layout={!reduced}
      initial={reduced ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: dimmed ? 0.55 : 1, y: 0 }}
      exit={
        reduced
          ? { opacity: 0, transition: REDUCED }
          : { opacity: 0, x: -24, transition: EXIT }
      }
      transition={reduced ? REDUCED : ENTER}
      className={cn("grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4 py-4 sm:grid-cols-[auto_minmax(0,1fr)_auto] desk:gap-6 desk:py-5", className)}
    >
      <BothImages
        placeholderUrl={placeholderUrl}
        product={product}
        request={request}
      />

      <div className="col-span-2 row-start-2 min-w-0 sm:col-span-1 sm:col-start-2 sm:row-start-1">
        <a
          href={product.url}
          target="_blank"
          rel="noreferrer noopener"
          className={cn(
            "line-clamp-2 max-w-[60ch] rounded-sm text-[15px] leading-snug font-medium",
            "underline-offset-4 transition-colors hover:text-accent hover:underline",
            FOCUS_RING
          )}
        >
          {product.title}
        </a>

        {request ? (
          <p className="mt-1 text-[13px] text-muted-foreground">
            you asked for {request}
          </p>
        ) : null}

        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12px] text-muted-foreground">
          {dims ? (
            <span className="inline-flex flex-wrap items-baseline gap-x-1.5">
              <span className="tabular font-mono">{dims}</span>
              {product.dimsSource === "quoted" ? (
                <span>{product.retailer} listing</span>
              ) : (
                <span className="text-warn">
                  {product.dimsSource === "approx" ? "approx" : "estimated"}
                </span>
              )}
            </span>
          ) : (
            <span className="text-warn">no dimensions listed</span>
          )}
          {!product.inStock ? (
            <span className="text-warn">Out of stock at {product.retailer}</span>
          ) : null}
        </div>

        <div className="mt-2.5">
          <LineFit product={product} />
        </div>
      </div>

      {/* Keep price and removal together so narrow screens have room for the title. */}
      <div className="col-start-2 row-start-1 flex flex-col items-end gap-1 pt-0.5 text-right sm:col-start-3">
        <span className="tabular min-w-[7ch] font-mono text-[15px] text-foreground desk:text-[17px]">
          {formatMoney(lineCents, product.currency)}
        </span>
        {quantity > 1 ? (
          <span className="tabular font-mono text-[12px] text-muted-foreground">
            {formatMoney(product.priceCents, product.currency)} each
          </span>
        ) : null}
        {onRemove ? (
          <button
            type="button"
            onClick={() => onRemove(item.id)}
            aria-label={`Don't buy ${product.title}`}
            title="Don't buy this one"
            className={cn(
              "tap -mr-1.5 flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-full",
              "text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:bg-muted",
              FOCUS_RING
            )}
          >
            <X className="size-4" aria-hidden />
          </button>
        ) : null}
      </div>
    </motion.li>
  );
}

export default CartLine;
