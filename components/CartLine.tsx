"use client";

import * as React from "react";
import { ArrowRight, X } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";

import { formatCarton } from "@/components/ui/NumberPlate";
import { fits, profileFromMm, type FitResult, type Profile as FitProfile } from "@/lib/fit";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { productImage, type CartItem, type Product, type Profile } from "@/types";

/**
 * One line on the checkout review.
 *
 * BOTH IMAGES, ALWAYS. The stand-in sprite that stood in the room, then the
 * real listing photo that is actually being bought. Side by side, small, with
 * an arrow between them. It is the honest answer to "so what was that cartoon
 * lamp?" and it costs one img tag.
 *
 * The row holds no state. The page owns the store writes, so removing a line
 * and the budget reacting stay one action.
 */

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
  return profileFromMm(profile);
}

/** null means the listing never published a size — a UI state, not a verdict. */
export function fitFor(product: Product, profile: Profile): FitResult | null {
  if (!product.dimsMm) return null;
  return fits(product.dimsMm, toFitProfile(profile));
}

/** Plain words for what the item would hit on the way in. */
export function fitObstacle(result: FitResult): string {
  if (result.binding === "door") return "your door";
  if (result.binding === "headroom") return "the ceiling at your landing";
  return "your stair landing";
}

const verdictLabel: Record<FitResult["verdict"], string> = {
  pass: "Fits",
  tight: "Tight",
  fail: "Won't fit",
};

const verdictClass: Record<FitResult["verdict"], string> = {
  pass: "border-ok/35 text-ok",
  tight: "border-warn/45 text-warn",
  fail: "border-warn/70 text-warn",
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
      <span className="inline-flex items-center rounded-full border border-line px-2 py-0.5 text-[11px] text-muted-foreground">
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
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]",
        verdictClass[result.verdict]
      )}
    >
      <span className="font-medium">{verdictLabel[result.verdict]}</span>
      {margin ? <span className="opacity-80">· {margin}</span> : null}
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

  return (
    <div className="flex shrink-0 items-center gap-1">
      <figure className="w-14">
        <div className="flex size-14 items-center justify-center overflow-hidden rounded-xl border border-line bg-muted">
          {placeholderUrl ? (
            // The sprite is written to disk by /api/placeholder and served back
            // from there; next/image would only add a second encode.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={placeholderUrl}
              alt={`The stand-in sprite for ${request || product.title}`}
              loading="lazy"
              decoding="async"
              className="size-full object-contain p-1"
            />
          ) : (
            <span className="text-[10px] leading-tight text-muted-foreground">
              no sprite
            </span>
          )}
        </div>
        <figcaption className="mt-1 text-center text-[10px] leading-tight text-muted-foreground">
          stood in
        </figcaption>
      </figure>

      <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />

      <figure className="w-14">
        <div className="size-14 overflow-hidden rounded-xl border border-line bg-muted">
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
            <span className="flex size-full items-center justify-center font-display text-lg text-muted-foreground">
              {product.title.slice(0, 1).toUpperCase()}
            </span>
          )}
        </div>
        <figcaption className="mt-1 text-center text-[10px] leading-tight text-muted-foreground">
          buying
        </figcaption>
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
      exit={reduced ? { opacity: 0 } : { opacity: 0, x: -24 }}
      transition={
        reduced ? { duration: 0.15 } : { type: "spring", stiffness: 420, damping: 36 }
      }
      className={cn("flex gap-3 py-3", className)}
    >
      <BothImages
        placeholderUrl={placeholderUrl}
        product={product}
        request={request}
      />

      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2">
          <a
            href={product.url}
            target="_blank"
            rel="noreferrer noopener"
            className="line-clamp-2 min-w-0 flex-1 text-sm font-medium underline-offset-2 hover:underline"
          >
            {product.title}
          </a>

          <span className="tabular shrink-0 text-sm font-medium">
            {formatMoney(lineCents, product.currency)}
          </span>

          {onRemove ? (
            <button
              type="button"
              onClick={() => onRemove(item.id)}
              aria-label={`Don't buy ${product.title}`}
              className="tap -mr-1 -mt-1 flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <X className="size-4" aria-hidden />
            </button>
          ) : null}
        </div>

        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
          {request ? <span>you asked for {request}</span> : null}
          {quantity > 1 ? (
            <span className="tabular">
              {formatMoney(product.priceCents, product.currency)} each
            </span>
          ) : null}
          {dims ? (
            <span className="tabular">
              {dims}
              {product.dimsSource === "quoted" ? (
                <span className="ml-1">{product.retailer} listing</span>
              ) : (
                <span className="ml-1 text-warn">
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

        <div className="mt-2">
          <LineFit product={product} />
        </div>
      </div>
    </motion.li>
  );
}

export default CartLine;
