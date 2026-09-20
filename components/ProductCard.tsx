"use client";

import * as React from "react";
import { Check, ExternalLink, Link2 } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";

import FitBadge, { fitForProduct } from "@/components/FitBadge";
import { Badge } from "@/components/ui/badge";
import { NumberPlate, centsToUnits, formatCarton } from "@/components/ui/NumberPlate";
import { withDemo } from "@/lib/demo";
import type { FitResult } from "@/lib/fit";
import { useStore, itemById } from "@/lib/store";
import { cn } from "@/lib/utils";
import { productImage, type Product, type Profile } from "@/types";

/**
 * One real listing at one real shop.
 *
 * Its props are exactly { product, compact } — everything else comes out of the
 * store — because this card renders in the option sheet, in the fit sheet's
 * alternatives and on the checkout review.
 *
 * LINKING IS THE BEAT THE WHOLE PIVOT TURNS ON. Tapping a card links that
 * listing to the placeholder standing in the room, and three things happen at
 * once: the sprite resizes to the listing's real height, its dimension label
 * updates, and the budget fires a delta — the DIFFERENCE on a relink, never the
 * new price. This file does the linking and the fit check; the sprite and the
 * budget are overlays reading the same store.
 *
 * The honesty rules live here:
 *   - the title links OUT to the page the price was read from;
 *   - a dimension says where it came from, and anything that is not "quoted"
 *     says so in the warn colour;
 *   - no dimensions means "No size on the listing" and a muted fit badge, never
 *     a guessed number.
 */

export type ProductCardProps = {
  product: Product;
  /** the dense row used in the fit sheet's alternatives and the checkout review */
  compact?: boolean;
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
        profile: {
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
 * moves on the tap, not when the network answers. `linkProduct` clears the old
 * verdict, so a stale badge can never survive a relink, and the fresh one is
 * written when the check comes back. A fail warns; it never blocks the link.
 */
export async function linkProductToItem(
  itemId: string,
  product: Product
): Promise<void> {
  const store = useStore.getState();
  const previous = itemById(store.items, itemId)?.linkedProduct ?? null;
  if (previous?.id === product.id) return; // tapping the linked one does nothing

  store.linkProduct(itemId, product);
  // the stand-in belongs to the old choice; drop it before the new photo lands
  store.setListingCutout(itemId, null);
  if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
    navigator.vibrate(8);
  }

  /*
   * Swap the drawing for the thing. The listing's own photo, keyed off its
   * white background, is a better sprite than any stand-in — so it is fetched
   * alongside the fit check rather than after it, and neither waits on the
   * other. A photo that will not key cleanly answers with null and the
   * stand-in simply stays.
   */
  const [fit] = await Promise.all([
    checkFit(product, useStore.getState().profile),
    cutoutFor(itemId, product),
  ]);

  // the user may have relinked while the check was in flight; only write the
  // verdict if it still belongs to what is linked now
  const current = itemById(useStore.getState().items, itemId)?.linkedProduct;
  if (current?.id === product.id) {
    useStore.getState().setFit(itemId, fit);
    if (
      fit?.verdict === "fail" &&
      typeof navigator !== "undefined" &&
      typeof navigator.vibrate === "function"
    ) {
      navigator.vibrate(20);
    }
  }
}

/**
 * Ask the server for a keyed cutout of this listing's photo. Silent on every
 * failure: the room already has something to show.
 */
async function cutoutFor(itemId: string, product: Product): Promise<void> {
  const imageUrl = productImage(product);
  if (!imageUrl) return;

  try {
    const res = await fetch(withDemo("/api/cutout"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imageUrl }),
    });
    if (!res.ok) return;

    const body = (await res.json()) as { url?: string; widthRatio?: number };
    if (!body.url) return;

    // the user may have relinked while this was in flight
    const current = itemById(useStore.getState().items, itemId)?.linkedProduct;
    if (current?.id !== product.id) return;

    useStore.getState().setListingCutout(itemId, {
      url: body.url,
      widthRatio: body.widthRatio && body.widthRatio > 0 ? body.widthRatio : 1,
    });
  } catch {
    /* the stand-in stays */
  }
}

/* -------------------------------------------------------------- the pieces */

/** A 16px favicon for the shop. Falls back to nothing if the shop has none. */
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
          className="size-3.5 shrink-0 rounded-[3px]"
        />
      ) : null}
      <span className="truncate text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
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

/** "1,900 × 720 × 640 mm — from the IKEA listing" / "… — estimated". */
function Dimensions({ product, compact }: { product: Product; compact: boolean }) {
  const dims = formatCarton(product.dimsMm);
  const quoted = product.dimsSource === "quoted";

  if (!dims) {
    return (
      <p className={cn("font-mono text-[11px] text-muted-foreground", compact && "truncate")}>
        No size on the listing
      </p>
    );
  }

  return (
    <p className={cn("font-mono text-[11px] leading-snug text-foreground/80")}>
      <span className="tabular">{dims}</span>
      <span className="text-muted-foreground">
        {" — "}
        {quoted ? (
          `from the ${product.retailer} listing`
        ) : (
          <span className="font-sans font-medium text-warn">
            {product.dimsSource === "approx" ? "approx" : "estimated"}
          </span>
        )}
      </span>
    </p>
  );
}

/* --------------------------------------------------------------- the card */

export function ProductCard({ product, compact = false }: ProductCardProps) {
  const reduced = useReducedMotion();

  /*
   * Which placeholder is this card an option for? The search stamps every
   * listing with its item id; a card shown out of that context (the fit sheet's
   * alternatives, say) falls back to whatever the chrome is currently about.
   */
  const activeItemId = useStore((s) => s.activeItemId);
  const itemId = product.itemId ?? activeItemId;
  const linkedId = useStore(
    (s) => itemById(s.items, itemId)?.linkedProduct?.id ?? null
  );
  const linked = linkedId === product.id;

  const [linking, setLinking] = React.useState(false);

  const link = React.useCallback(() => {
    if (!itemId || linked) return;
    setLinking(true);
    void linkProductToItem(itemId, product).finally(() => setLinking(false));
  }, [itemId, linked, product]);

  const priceNode = (
    <NumberPlate
      value={centsToUnits(product.priceCents)}
      size={compact ? "sm" : "md"}
      // a fixed locale so the server render and the phone agree on the string
      locales="en-US"
      format={PRICE_FORMAT(product.currency)}
      label={formatPrice(product.priceCents, product.currency)}
      tone={product.inStock ? "default" : "muted"}
    />
  );

  const titleLink = (
    <a
      href={product.url}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "group/title inline-flex items-start gap-1 rounded-sm font-sans text-foreground",
        "underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-ring",
        compact ? "text-sm" : "text-[0.95rem] leading-snug"
      )}
    >
      <span className={compact ? "line-clamp-1" : "line-clamp-2"}>{product.title}</span>
      <ExternalLink
        className="mt-0.5 size-3 shrink-0 text-muted-foreground opacity-70"
        aria-hidden
      />
      <span className="sr-only">(opens the listing in a new tab)</span>
    </a>
  );

  const src = productImage(product);
  const image = src ? (
    // eslint-disable-next-line @next/next/no-img-element -- retailer CDN images from arbitrary hosts; next/image would need each one in next.config.ts
    <img
      src={src}
      alt=""
      loading="lazy"
      className={cn(
        "size-full object-contain",
        compact ? "p-1.5" : "p-3",
        !product.inStock && "opacity-60"
      )}
    />
  ) : (
    <span className="grid size-full place-items-center px-2 text-center text-[11px] text-muted-foreground">
      No photo on the listing
    </span>
  );

  /* ------------------------------------------------------------- compact */

  if (compact) {
    return (
      <div
        className={cn(
          "flex items-center gap-3 rounded-xl border bg-surface p-2",
          linked ? "border-accent" : "border-line",
          !product.inStock && "opacity-75"
        )}
        data-linked={linked || undefined}
      >
        <div className="size-16 shrink-0 overflow-hidden rounded-lg bg-background">
          {image}
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <RetailerMark product={product} />
          {titleLink}
          <div className="flex items-center gap-2">
            {priceNode}
            {!product.inStock ? (
              <Badge variant="secondary" className="shrink-0">
                Out of stock
              </Badge>
            ) : null}
          </div>
          <Dimensions product={product} compact />
          <FitBadge product={product} />
        </div>

        <LinkButton
          compact
          linked={linked}
          busy={linking}
          disabled={!itemId}
          onLink={link}
          reduced={reduced}
        />
      </div>
    );
  }

  /* ---------------------------------------------------------------- full */

  return (
    <motion.article
      layout={reduced ? false : "position"}
      className={cn(
        "flex h-full w-full flex-col gap-2.5 rounded-2xl border bg-surface p-3",
        linked ? "border-accent shadow-[0_0_0_1px_var(--accent)]" : "border-line",
        !product.inStock && "opacity-75"
      )}
      data-linked={linked || undefined}
    >
      <div className="relative aspect-[4/3] w-full overflow-hidden rounded-xl bg-background">
        {image}
        {linked ? (
          <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-full bg-accent px-2 py-0.5 text-[11px] font-medium text-[var(--on-accent)]">
            <Check className="size-3" aria-hidden />
            Linked
          </span>
        ) : null}
      </div>

      <div className="flex items-center justify-between gap-2">
        <RetailerMark product={product} />
        {!product.inStock ? (
          <Badge variant="secondary" className="shrink-0">
            Out of stock
          </Badge>
        ) : null}
      </div>

      {titleLink}

      <div className="mt-auto flex flex-col gap-2">
        {priceNode}
        <Dimensions product={product} compact={false} />
        <FitBadge product={product} />
        <LinkButton
          linked={linked}
          busy={linking}
          disabled={!itemId}
          onLink={link}
          reduced={reduced}
        />
      </div>
    </motion.article>
  );
}

/**
 * Tap to link it to the placeholder. Spring bounce, 8 ms of haptic, 44 px of
 * target. The linked card does NOT unlink on a second tap — removing is a
 * separate gesture, and an accidental double tap must not empty the room.
 */
function LinkButton({
  linked,
  busy,
  disabled,
  onLink,
  reduced,
  compact = false,
}: {
  linked: boolean;
  busy: boolean;
  disabled: boolean;
  onLink: () => void;
  reduced: boolean | null;
  compact?: boolean;
}) {
  const label = linked ? "Linked" : busy ? "Linking" : "Link this";

  return (
    <motion.button
      type="button"
      onClick={onLink}
      aria-pressed={linked}
      disabled={disabled || linked}
      title={disabled ? "Ask for an object first, then link a listing to it" : undefined}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-full font-sans text-sm font-medium",
        "transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        compact ? "tap size-11 shrink-0" : "h-11 w-full",
        linked
          ? "bg-accent text-[var(--on-accent)]"
          : "border border-line bg-background text-foreground hover:bg-muted",
        disabled && "opacity-50"
      )}
      whileTap={reduced || disabled || linked ? undefined : { scale: 0.94 }}
      animate={reduced ? undefined : { scale: linked ? [1, 1.06, 1] : 1 }}
      /*
       * The bounce is three keyframes, and motion 13 throws on a spring with
       * more than two ("Only two keyframes currently supported with spring and
       * inertia animations") — which fired on every single link. Keyframes get
       * a tween; everything else keeps the spring.
       */
      transition={
        linked && !reduced
          ? { duration: 0.28, times: [0, 0.4, 1], ease: "easeOut" }
          : { type: "spring", stiffness: 520, damping: 18 }
      }
    >
      {linked ? (
        <Check className={compact ? "size-5" : "size-4"} aria-hidden />
      ) : (
        <Link2 className={compact ? "size-5" : "size-4"} aria-hidden />
      )}
      {compact ? <span className="sr-only">{label}</span> : <span>{label}</span>}
    </motion.button>
  );
}

export default ProductCard;
