"use client";

import * as React from "react";
import { Check, ExternalLink, Link2 } from "lucide-react";
import {
  motion,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
} from "motion/react";

import FitBadge, { fitForProduct } from "@/components/FitBadge";
import { Badge } from "@/components/ui/badge";
import { NumberPlate, centsToUnits, formatCarton } from "@/components/ui/NumberPlate";
import { withDemo } from "@/lib/demo";
import type { FitResult } from "@/lib/fit";
import { DUR, EASE, SCRUB } from "@/lib/motion";
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
 * LINKING IS THE BEAT THE WHOLE PIVOT TURNS ON. Clicking "Link this" links that
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
 * moves on the click, not when the network answers. `linkProduct` clears the
 * old verdict, so a stale badge can never survive a relink, and the fresh one
 * is written when the check comes back. A fail warns; it never blocks the link.
 */
export async function linkProductToItem(
  itemId: string,
  product: Product
): Promise<void> {
  const store = useStore.getState();
  const previous = itemById(store.items, itemId)?.linkedProduct ?? null;
  if (previous?.id === product.id) return; // clicking the linked one does nothing

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

/**
 * Which placeholder is this card an option for, is it the linked one, and the
 * click that links it. The search stamps every listing with its item id; a card
 * shown out of that context (the fit check's alternatives, say) falls back to
 * whatever the chrome is currently about.
 */
function useLinking(product: Product) {
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
    const done = linkProductToItem(itemId, product);
    // the link has landed (that part is synchronous): what was being tried on
    // is now simply what is there, so there is nothing left to preview
    usePreview.getState().clear();
    void done.finally(() => setLinking(false));
  }, [itemId, linked, product]);

  return { itemId, linked, linking, link };
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
          className="size-3.5 shrink-0 rounded-[3px]"
        />
      ) : null}
      <span className="truncate font-mono text-[11px] uppercase leading-none tracking-[0.12em] text-muted-foreground">
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
          "font-mono text-[11px] leading-[1.45] text-muted-foreground",
          compact ? "truncate" : "min-w-0 flex-1"
        )}
      >
        No size on the listing
      </p>
    );
  }

  if (compact) {
    return (
      <p className="font-mono text-[11px] leading-snug text-foreground/80">
        <span className="tabular">{dims}</span>
        <span className="text-muted-foreground">
          {" — "}
          <Provenance product={product} />
        </span>
      </p>
    );
  }

  return (
    <p className="min-w-0 flex-1 font-mono text-[11px] leading-[1.45] text-foreground">
      <span className="tabular block truncate">{MM.format(product.dimsMm[1])} mm tall</span>
      <span className="block truncate text-muted-foreground" title={dims}>
        <Provenance product={product} />
        <span className="tabular"> · {dims}</span>
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
      className="shrink-0"
    />
  );
}

/** The name, in the display face, linking OUT to the page the price came from. */
function NameLink({ product, compact }: { product: Product; compact: boolean }) {
  return (
    <a
      href={product.url}
      target="_blank"
      rel="noopener noreferrer"
      title={product.title}
      className={cn(
        "group/title flex min-w-0 items-start gap-1 rounded-sm font-display text-[20px] font-medium",
        "leading-[1.15] tracking-[0.01em] text-foreground underline-offset-2 transition-colors",
        "hover:text-accent hover:underline",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      )}
    >
      <span
        className={
          compact
            ? "line-clamp-1"
            : // two lines once the window is tall enough for the tray to afford them
              "line-clamp-1 [@media(min-height:54rem)]:line-clamp-2"
        }
      >
        {product.title}
      </span>
      <ExternalLink
        className="mt-1 size-3 shrink-0 text-muted-foreground opacity-70 transition-colors group-hover/title:text-accent"
        aria-hidden
      />
      <span className="sr-only">(opens the listing in a new tab)</span>
    </a>
  );
}

/* --------------------------------------------------------------- the card */

export function ProductCard({ product, compact = false, index }: ProductCardProps) {
  return compact ? (
    <CompactCard product={product} />
  ) : (
    <TrayCard product={product} index={index} />
  );
}

/* ---------------------------------------------------------------- compact */

function CompactCard({ product }: { product: Product }) {
  const reduced = useReducedMotion();
  const { itemId, linked, linking, link } = useLinking(product);

  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-[18px] border bg-surface p-2.5 transition-colors",
        linked ? "border-accent" : "border-line hover:border-accent-pale",
        !product.inStock && "opacity-75"
      )}
      data-linked={linked || undefined}
    >
      <div className="size-[4.5rem] shrink-0 overflow-hidden rounded-[12px] bg-muted">
        <Photo product={product} className="p-1.5" />
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <RetailerMark product={product} />
        <NameLink product={product} compact />
        <div className="flex items-center gap-2">
          <Price product={product} />
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

/* ------------------------------------------------------------------- tray */

/**
 * The card in the listing tray. The tray is short and wide — five of these in
 * one row under the room — so the card spends its height carefully: the photo
 * well takes whatever is left after the words, and the index, the shop, the
 * state tags and the fit verdict all ride ON the well rather than under it.
 */
function TrayCard({ product, index }: { product: Product; index?: number }) {
  const reduced = useReducedMotion();
  const { itemId, linked, linking, link } = useLinking(product);

  // being tried on in the room right now — and not already the linked one,
  // because a linked listing is not a preview of anything
  const trying =
    usePreview((s) => s.product?.id === product.id && s.itemId === itemId) && !linked;

  /*
   * THE PHOTO FLOATS. Under the pointer it lifts a few pixels and leans two or
   * three degrees toward it, so the row feels like objects on a shelf rather
   * than a table of thumbnails. Transform only, on the listing rail's own
   * spring; a touch has no "toward", and reduced motion gets none of it.
   */
  const px = useMotionValue(0);
  const py = useMotionValue(0);
  const near = useMotionValue(0);
  const sx = useSpring(px, SCRUB);
  const sy = useSpring(py, SCRUB);
  const lift = useSpring(near, SCRUB);
  const rotateY = useTransform(sx, [-1, 1], [-3, 3]);
  const rotateX = useTransform(sy, [-1, 1], [3, -3]);
  const y = useTransform(lift, [0, 1], [0, -4]);
  const scale = useTransform(lift, [0, 1], [1, 1.04]);

  const onPointerMove = (event: React.PointerEvent<HTMLElement>) => {
    if (reduced || event.pointerType === "touch") return;
    const box = event.currentTarget.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) return;
    px.set(((event.clientX - box.left) / box.width) * 2 - 1);
    py.set(((event.clientY - box.top) / box.height) * 2 - 1);
    near.set(1);
  };
  const onPointerLeave = () => {
    px.set(0);
    py.set(0);
    near.set(0);
  };

  const src = productImage(product);

  return (
    <article
      data-card=""
      data-product-id={product.id}
      data-linked={linked || undefined}
      data-trying={trying || undefined}
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
      className={cn(
        "group/card flex h-full w-full min-w-0 flex-col rounded-[22px] border bg-surface p-2.5",
        "transition-colors duration-[240ms]",
        linked
          ? "border-accent shadow-[0_0_0_1px_var(--accent)]"
          : trying
            ? "border-dashed border-accent"
            : "border-line hover:border-accent-pale",
        !product.inStock && "opacity-75"
      )}
    >
      {/* ------------------------------------------------ the photo well */}
      <div className="relative min-h-0 flex-1 overflow-hidden rounded-[14px] bg-muted">
        {/* a soft light from above, inside the well — what the photo floats in */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_85%_at_28%_-10%,rgb(255_255_255/0.9),transparent_62%)]"
        />

        {src ? (
          <motion.div
            className="absolute inset-0"
            style={
              reduced ? undefined : { rotateX, rotateY, y, scale, transformPerspective: 700 }
            }
          >
            <Photo product={product} className="p-3" />
          </motion.div>
        ) : (
          <div className="absolute inset-0">
            <Photo product={product} />
          </div>
        )}

        {/* the place in the row and the shop, top left; what state it is in, top right */}
        <div className="absolute inset-x-1.5 top-1.5 flex flex-wrap items-start justify-between gap-1">
          <span className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-full border border-line bg-surface/90 py-1 pl-2 pr-2.5">
            {typeof index === "number" ? (
              <span className="tabular font-mono text-[11px] font-bold leading-none text-accent">
                {String(index + 1).padStart(2, "0")}
              </span>
            ) : null}
            <RetailerMark product={product} />
          </span>

          <span className="ml-auto flex flex-col items-end gap-1">
            {linked ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-accent px-2 py-1 text-[11px] font-medium leading-none text-[var(--on-accent)]">
                <Check className="size-3" aria-hidden />
                Linked
              </span>
            ) : trying ? (
              <span className="eyebrow rounded-full bg-accent-pale px-2 py-1 text-foreground">
                Trying on
              </span>
            ) : null}
            {!product.inStock ? (
              <Badge variant="secondary" className="shrink-0">
                Out of stock
              </Badge>
            ) : null}
          </span>
        </div>

        {/* the verdict rides on the well; its own white ground keeps it legible
            whatever the photo behind it is */}
        <div className="absolute inset-x-1.5 bottom-1.5 flex">
          <span className="inline-flex max-w-full rounded-full bg-surface">
            <FitBadge product={product} />
          </span>
        </div>
      </div>

      {/* ------------------------------------------------------ the words */}
      <div className="mt-2 h-[23px] [@media(min-height:54rem)]:h-[46px]">
        <NameLink product={product} compact={false} />
      </div>

      <div className="mt-1.5 flex min-h-8 items-start justify-between gap-2">
        <Dimensions product={product} compact={false} />
        <Price product={product} />
      </div>

      <div className="mt-2">
        <LinkButton
          linked={linked}
          busy={linking}
          disabled={!itemId}
          onLink={link}
          reduced={reduced}
        />
      </div>
    </article>
  );
}

/**
 * Click to link it to the placeholder. A short press, 8 ms of haptic, 44 px of
 * target. The linked card does NOT unlink on a second click — removing is a
 * separate gesture, and an accidental double click must not empty the room.
 *
 * The linked button is `aria-disabled`, not `disabled`: a disabled button drops
 * keyboard focus on the floor, and the arrow keys that walk the row start from
 * wherever focus is. It still does nothing when pressed.
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
      data-card-link=""
      onClick={onLink}
      aria-pressed={linked}
      aria-disabled={linked || undefined}
      disabled={disabled}
      title={disabled ? "Ask for an object first, then link a listing to it" : undefined}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 font-sans text-sm font-medium",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
        compact ? "tap size-11 shrink-0" : "h-11 w-full",
        linked
          ? "cursor-default rounded-full border border-accent/40 bg-accent-wash text-accent"
          : // the glass classes carry their own radius and win a tie with a
            // utility, hence the `!`; brightness is the hover, never the blur
            "glass-blue cursor-pointer rounded-full! transition-[filter] duration-[240ms] hover:brightness-110",
        disabled && "cursor-not-allowed opacity-50 hover:brightness-100"
      )}
      whileTap={reduced || disabled || linked ? undefined : { scale: 0.94 }}
      animate={reduced ? undefined : { scale: linked ? [1, 1.06, 1] : 1 }}
      /*
       * The bounce is three keyframes, and motion 13 throws on a spring with
       * more than two ("Only two keyframes currently supported with spring and
       * inertia animations") — which fired on every single link. So it is a
       * tween, on the motion sheet's micro duration and entrance curve, and the
       * press uses the same pair.
       */
      transition={
        linked && !reduced
          ? { duration: DUR.micro, times: [0, 0.4, 1], ease: EASE.out }
          : { duration: DUR.micro, ease: EASE.out }
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
