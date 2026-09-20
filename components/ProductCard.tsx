"use client";

import * as React from "react";
import { Check, ExternalLink, LoaderCircle, Plus, RotateCw } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";

import FitBadge, { fitForProduct } from "@/components/FitBadge";
import { Badge } from "@/components/ui/badge";
import { NumberPlate, centsToUnits, formatCarton } from "@/components/ui/NumberPlate";
import { withDemo } from "@/lib/demo";
import type { FitResult } from "@/lib/fit";
import { DUR, EASE } from "@/lib/motion";
import { retryListingCutout } from "@/lib/listingCutout";
export { retryListingCutout } from "@/lib/listingCutout";
import { usePreview } from "@/lib/preview";
import { useStore, itemById } from "@/lib/store";
import { cn } from "@/lib/utils";
import { productImage, type Product, type Profile } from "@/types";

/**
 * One real listing at one real shop.
 *
 * Its props are { product, compact } — everything else comes out of the store —
 * because this card renders in the listing tray, in the fit check's
 * alternatives and on the checkout review. `index` is the tray's own addition:
 * the place in the row, printed "01" to "05".
 *
 * LINKING IS THE BEAT THE WHOLE PIVOT TURNS ON. Clicking "Use in room" links that
 * listing to the placeholder standing in the room, and three things happen at
 * once: the sprite resizes to the listing's real height, its dimension label
 * updates, and the budget fires a delta — the DIFFERENCE on a relink, never the
 * new price. This file does the linking and the fit check; the sprite and the
 * budget are overlays reading the same store.
 *
 * In the tray, pointing at a card is already enough to TRY IT ON: the row tells
 * lib/preview.ts which listing is under the pointer (or the keyboard focus) and
 * the thing in the room takes that size, in the pale preview colours, until the
 * pointer leaves. This card only says so — a quiet "trying on" tag and a dashed
 * edge, the same dashed edge the ghost in the room wears.
 *
 * The honesty rules live here:
 *   - the name links OUT to the page the price was read from;
 *   - a dimension says where it came from, and anything that is not "quoted"
 *     says so in the warn colour;
 *   - no dimensions means "No size on the listing" and a muted fit badge, never
 *     a guessed number.
 */

export type ProductCardProps = {
  product: Product;
  /** the dense row used in the fit check's alternatives and the checkout review */
  compact?: boolean;
  /** place in the tray's row, from 0; printed as "01". Absent, no number is shown */
  index?: number;
};

/**
 * Money is integer cents everywhere; this is where it becomes a string.
 * Formatting pattern (narrowSymbol currency through Intl.NumberFormat) taken
 * from ref/commerce/components/price.tsx — vercel/commerce, MIT.
 */
export function formatPrice(cents: number, currency: string, locale = "en-US"): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    currencyDisplay: "narrowSymbol",
  }).format(centsToUnits(cents));
}

const PRICE_FORMAT = (currency: string) =>
  ({
    style: "currency",
    currency,
    currencyDisplay: "narrowSymbol",
    maximumFractionDigits: 2,
  }) as const;

const MM = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

/* ------------------------------------------------------- linking + the fit */

/**
 * The fit check for one listing.
 *
 * /api/fit runs lib/fit.ts server-side; if the route is unreachable we run the
 * SAME kernel in the browser rather than dropping the verdict. Both paths call
 * `fits()`, so the numbers cannot drift — there is only one implementation of
 * this arithmetic in the repo and it is lib/fit.ts.
 */
export async function checkFit(
  product: Product,
  profile: Profile,
  signal?: AbortSignal
): Promise<FitResult | null> {
  // no dimensions, no verdict — "can't check", never a guess
  if (!product.dimsMm) return null;

  try {
    const res = await fetch(withDemo("/api/fit"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        carton: product.dimsMm,
        dimsSource: product.dimsSource,
        profile: {
          measured: profile.measured,
          doorWidthMm: profile.doorWidthMm,
          doorHeightMm: profile.doorHeightMm,
          hallwayWidthMm: profile.hallwayWidthMm,
          landingWidthMm: profile.landingWidthMm,
          ceilingHeightMm: profile.ceilingHeightMm,
        },
      }),
      signal,
    });
    if (res.ok) {
      const data = (await res.json()) as { fit?: FitResult | null };
      if (data?.fit) return data.fit;
    }
  } catch {
    /* fall through to the local kernel — same function, same numbers */
  }

  return fitForProduct(product, profile);
}

/**
 * Link a listing to the placeholder, then check the fit against it.
 *
 * The link lands FIRST and synchronously: the sprite resizes and the budget
 * moves on the click, not when the network answers. `linkProduct` clears the
 * old verdict, so a stale badge can never survive a relink, and the fresh one
 * is written when the check comes back. A fail warns; it never blocks the link.
 */
export async function linkProductToItem(
  itemId: string,
  product: Product
): Promise<void> {
  const store = useStore.getState();
  const previous = itemById(store.items, itemId);
  if (!previous) return;
  if (previous.linkedProduct?.id === product.id) {
    await retryListingCutout(itemId);
    return;
  }

  store.linkProduct(itemId, product);
  const version = itemById(useStore.getState().items, itemId)?.linkedProductVersion;
  if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
    navigator.vibrate(8);
  }

  /*
   * Swap the drawing for the thing. The listing's own extracted photo is
   * a better sprite than any stand-in — so it is fetched
   * alongside the fit check rather than after it, and neither waits on the
   * other. A failed extraction keeps the illustration and offers a retry.
   */
  const fitWork = checkFit(product, useStore.getState().profile).then((fit) => {
    // Publish independently of background removal. Matching the link version
    // also rejects an old A result after the user chooses A → B → A.
    const current = itemById(useStore.getState().items, itemId);
    if (current?.linkedProduct?.id !== product.id || current.linkedProductVersion !== version) return;
    useStore.getState().setFit(itemId, fit);
    if (
      fit?.verdict === "fail" &&
      typeof navigator !== "undefined" &&
      typeof navigator.vibrate === "function"
    ) {
      navigator.vibrate(20);
    }
  });
  await Promise.all([fitWork, retryListingCutout(itemId)]);
}

/**
 * Which placeholder is this card an option for, is it the linked one, and the
 * click that links it. The search stamps every listing with its item id; a card
 * shown out of that context (the fit check's alternatives, say) falls back to
 * whatever the chrome is currently about.
 */
function useLinking(product: Product) {
  const activeItemId = useStore((s) => s.activeItemId);
  const itemId = product.itemId ?? activeItemId;
  const item = useStore((s) => itemById(s.items, itemId));
  const linked = item?.linkedProduct?.id === product.id;
  const linking = linked && item?.listingCutoutStatus === "pending";
  const failed = linked && item?.listingCutoutStatus === "failed";
  const needsPhoto = linked && item?.listingCutoutStatus === "idle";

  const link = React.useCallback(() => {
    if (!itemId || (linked && !failed && !needsPhoto)) return;
    if (linked) {
      void retryListingCutout(itemId);
      return;
    }
    void linkProductToItem(itemId, product);
    // The synchronous link becomes the committed selection immediately.
    usePreview.getState().clear();
  }, [itemId, linked, failed, needsPhoto, product]);

  return { itemId, linked, linking, failed, needsPhoto, link };
}

/* -------------------------------------------------------------- the pieces */

/** A 14px favicon for the shop, and its name. Falls back to the name alone. */
function RetailerMark({ product }: { product: Product }) {
  const [failed, setFailed] = React.useState(false);
  const domain = product.retailerDomain ?? domainOf(product.url);

  return (
    <span className="flex min-w-0 items-center gap-1.5">
      {domain && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element -- a shop favicon from an arbitrary domain; next/image would need every retailer in next.config.ts
        <img
          src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=32`}
          alt=""
          width={14}
          height={14}
          loading="lazy"
          onError={() => setFailed(true)}
          className="size-3.5 shrink-0"
        />
      ) : null}
      <span className="truncate font-sans text-[11px] leading-normal text-muted-foreground">
        {product.retailer}
      </span>
    </span>
  );
}

function domainOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** Where the size came from, in the words this card has always used. */
function Provenance({ product }: { product: Product }) {
  if (product.dimsSource === "quoted") return <>from the {product.retailer} listing</>;
  return (
    <span className="font-sans font-medium text-warn">
      {product.dimsSource === "approx" ? "approx" : "estimated"}
    </span>
  );
}

/**
 * The size, and where it came from.
 *
 * Compact: "1,900 × 720 × 640 mm — from the IKEA listing" / "… — estimated".
 *
 * In the tray the first line is the one number the room is about to act on —
 * "1,520 mm tall", the listing's own height, the same figure the label on the
 * sprite counts to. Under it, the provenance FIRST and the full carton after
 * it, so when a narrow card has to cut the line short it is the carton that
 * loses its tail and never the word "estimated".
 */
function Dimensions({ product, compact }: { product: Product; compact: boolean }) {
  const dims = formatCarton(product.dimsMm);

  if (!dims || !product.dimsMm) {
    return (
      <p
        className={cn(
          "font-sans text-[11px] leading-[1.45] text-muted-foreground",
          compact ? "truncate" : "min-w-0 flex-1"
        )}
      >
        No size on the listing
      </p>
    );
  }

  if (compact) {
    return (
      <p className="font-sans text-[11px] leading-snug text-foreground/80">
        <span className="tabular-nums">{dims}</span>
        <span className="text-muted-foreground">
          {" — "}
          <Provenance product={product} />
        </span>
      </p>
    );
  }

  return (
    <p className="min-w-0 flex-1 font-sans text-[11px] leading-[1.45] text-foreground">
      <span className="tabular-nums block truncate">{MM.format(product.dimsMm[1])} mm tall</span>
      <span className="block truncate text-muted-foreground" title={dims}>
        <Provenance product={product} />
        <span className="tabular-nums"> · {dims}</span>
      </span>
    </p>
  );
}

/** The listing's own photo, or the plain fact that it has none. */
function Photo({
  product,
  className,
}: {
  product: Product;
  className?: string;
}) {
  const src = productImage(product);
  if (!src) {
    return (
      <span className="grid size-full place-items-center px-2 text-center text-[11px] text-muted-foreground">
        No photo on the listing
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- retailer CDN images from arbitrary hosts; next/image would need each one in next.config.ts
    <img
      src={src}
      alt=""
      loading="lazy"
      draggable={false}
      className={cn("size-full object-contain", !product.inStock && "opacity-60", className)}
    />
  );
}

function Price({ product }: { product: Product }) {
  return (
    <NumberPlate
      value={centsToUnits(product.priceCents)}
      size="sm"
      // a fixed locale so the server render and the browser agree on the string
      locales="en-US"
      format={PRICE_FORMAT(product.currency)}
      label={formatPrice(product.priceCents, product.currency)}
      tone={product.inStock ? "default" : "muted"}
      className="shrink-0 [&>span]:font-sans [&>span]:text-[14px] [&>span]:font-medium"
    />
  );
}

/** The product name links to the listing that supplied its price and details. */
function NameLink({ product, compact }: { product: Product; compact: boolean }) {
  return (
    <a
      href={product.url}
      target="_blank"
      rel="noopener noreferrer"
      title={product.title}
      className={cn(
        "group/title flex min-w-0 items-start gap-1 rounded-none font-sans text-[13px] font-medium",
        "leading-[1.4] text-foreground underline-offset-2 transition-colors",
        "hover:text-accent hover:underline",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      )}
    >
      <span className={compact ? "line-clamp-1" : "line-clamp-2"}>{product.title}</span>
      <ExternalLink className="mt-0.5 size-3 shrink-0 text-muted-foreground/70" aria-hidden />
      <span className="sr-only">(opens the listing in a new tab)</span>
    </a>
  );
}

/* --------------------------------------------------------------- the card */

export function ProductCard({ product, compact = false, index }: ProductCardProps) {
  return compact ? <CompactCard product={product} /> : <TrayCard product={product} index={index} />;
}

const FIT_STYLING =
  "min-w-0 [&_button]:rounded-none [&_button]:font-sans [&_button]:text-[10px] [&_button]:px-1.5 [&_button]:py-1 [&_.font-mono]:font-sans [&>span]:rounded-none";

function CompactCard({ product }: { product: Product }) {
  const reduced = useReducedMotion();
  const { itemId, linked, linking, failed, needsPhoto, link } = useLinking(product);

  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-none border bg-white/55 p-2.5 font-sans transition-colors",
        linked ? "border-accent" : "border-line/70 hover:border-accent/40",
        !product.inStock && "opacity-75"
      )}
      data-linked={linked || undefined}
    >
      <div className="size-[4.5rem] shrink-0 overflow-hidden rounded-none bg-white/60">
        <Photo product={product} className="p-1.5" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <NameLink product={product} compact />
        <RetailerMark product={product} />
        <div className="flex items-center gap-2">
          <Price product={product} />
          {!product.inStock ? <Badge variant="secondary" className="shrink-0 rounded-none">Out of stock</Badge> : null}
        </div>
        <Dimensions product={product} compact />
        <div className={FIT_STYLING}><FitBadge product={product} /></div>
      </div>
      <LinkButton compact linked={linked} busy={linking} failed={failed} needsPhoto={needsPhoto} disabled={!itemId} onLink={link} reduced={reduced} />
    </div>
  );
}

/** One quiet, compact match. Hover preview is owned by the surrounding result list. */
function TrayCard({ product, index }: { product: Product; index?: number }) {
  const reduced = useReducedMotion();
  const { itemId, linked, linking, failed, needsPhoto, link } = useLinking(product);
  const trying = usePreview((s) => s.product?.id === product.id && s.itemId === itemId) && !linked;

  return (
    <article
      data-card=""
      data-product-id={product.id}
      data-linked={linked || undefined}
      data-trying={trying || undefined}
      className={cn(
        "group/card flex min-h-[282px] w-full min-w-0 flex-col gap-1.5 rounded-none border bg-white/55 p-2.5 font-sans transition-colors",
        linked ? "border-accent" : trying ? "border-accent/65 bg-white/75" : "border-line/70 hover:border-accent/40",
        !product.inStock && "opacity-75"
      )}
    >
      <div className="relative h-[98px] shrink-0 overflow-hidden rounded-none bg-white/65">
        <Photo product={product} className="p-2" />
        {typeof index === "number" ? (
          <span className="absolute left-1.5 top-1.5 text-[10px] tabular-nums text-muted-foreground">
            {String(index + 1).padStart(2, "0")}
          </span>
        ) : null}
        <div className="absolute right-1.5 top-1.5 flex flex-col items-end gap-1">
          {linked ? (
            <span className="inline-flex items-center gap-1 border border-accent/20 bg-white/90 px-1.5 py-1 text-[10px] leading-none text-accent">
              <Check className="size-3" aria-hidden />In your room
            </span>
          ) : trying ? (
            <span className="border border-accent/20 bg-white/90 px-1.5 py-1 text-[10px] leading-none text-accent">Previewing</span>
          ) : null}
          {!product.inStock ? <Badge variant="secondary" className="rounded-none text-[10px]">Out of stock</Badge> : null}
        </div>
      </div>

      <div className="min-h-[36px]"><NameLink product={product} compact={false} /></div>
      <div className="flex min-h-5 items-center justify-between gap-3">
        <RetailerMark product={product} />
        <Price product={product} />
      </div>
      <div className="flex flex-wrap items-start justify-between gap-1.5">
        <div className={FIT_STYLING}><FitBadge product={product} /></div>
        <details className="min-w-0 basis-full text-[11px] leading-relaxed text-muted-foreground">
          <summary className="w-fit cursor-pointer text-[11px] hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
            {product.dimsMm && product.dimsSource !== "quoted" ? (
              <><span className="font-medium text-warn">{product.dimsSource === "approx" ? "Approximate size" : "Estimated size"}</span>{" · Details"}</>
            ) : product.dimsMm ? "Dimensions & source" : "No listed size · Details"}
          </summary>
          <div className="mt-1.5 border-l border-line pl-2"><Dimensions product={product} compact /></div>
        </details>
      </div>
      <div className="mt-auto">
        <LinkButton linked={linked} busy={linking} failed={failed} needsPhoto={needsPhoto} disabled={!itemId} onLink={link} reduced={reduced} />
      </div>
    </article>
  );
}

/** Selection keeps keyboard focus and never removes a product on a second click. */
function LinkButton({
  linked,
  busy,
  failed,
  needsPhoto,
  disabled,
  onLink,
  reduced,
  compact = false,
}: {
  linked: boolean;
  busy: boolean;
  failed: boolean;
  needsPhoto: boolean;
  disabled: boolean;
  onLink: () => void;
  reduced: boolean | null;
  compact?: boolean;
}) {
  const label = busy ? "Removing background…" : failed ? "Retry product photo" : needsPhoto ? "Use product photo" : linked ? "In your room" : "Use in room";
  return (
    <motion.button
      type="button"
      data-card-link=""
      onClick={onLink}
      aria-pressed={linked}
      aria-disabled={(linked && !failed && !needsPhoto) || undefined}
      aria-busy={busy || undefined}
      disabled={disabled || busy}
      title={disabled ? "Ask for an item first, then choose a product for it" : failed ? "Background removal failed. The illustration is still shown; retry the product photo." : compact ? label : undefined}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-none border font-sans text-[12px] font-medium",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
        compact ? "tap size-10 shrink-0" : "h-9 w-full",
        linked && !failed && !needsPhoto
          ? "cursor-default border-accent/30 bg-accent/5 text-accent"
          : "cursor-pointer border-accent bg-accent text-white transition-colors hover:bg-accent-bright",
        disabled && "cursor-not-allowed opacity-50"
      )}
      whileTap={reduced || disabled || busy || (linked && !failed && !needsPhoto) ? undefined : { y: 1 }}
      transition={{ duration: DUR.micro, ease: EASE.out }}
    >
      {busy ? <LoaderCircle className={cn("size-4", !reduced && "animate-spin")} aria-hidden /> : failed ? <RotateCw className="size-4" aria-hidden /> : linked ? <Check className="size-4" aria-hidden /> : <Plus className="size-4" aria-hidden />}
      {compact ? <span className="sr-only">{label}</span> : <span>{label}</span>}
    </motion.button>
  );
}

export default ProductCard;
