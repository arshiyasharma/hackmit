import { createHash } from "node:crypto";
import {
  parseDimensionsFromFeatures,
  parseDimensionsFromText,
  parseDimensionsFromTexts,
  parseInStockFromOffers,
  unknownDimensions,
  type Dimensions,
} from "@/lib/sourcing/dims";
import type {
  SerpImmersiveFeature,
  SerpImmersiveStore,
  SerpShoppingResult,
  SerpVisualMatch,
} from "@/lib/sourcing/product";
import { fetchImmersiveProduct } from "@/lib/sourcing/serpapi";
import {
  diversifyProductsByQuery,
  filterProductsByDesignQuery,
} from "@/lib/sourcing/roomContext";
import {
  isDirectRetailerUrl,
  isGoogleHostedUrl,
  isWhitelistedHostname,
  resolveRetailer,
  retailerDomainFor,
  retailerFromSourceLabel,
  sameRetailer,
  unwrapProductUrl,
} from "@/lib/sourcing/whitelist";

export type Product = {
  id: string;
  title: string;
  price_cents: number | null;
  currency: "USD";
  image_url: string;
  product_url: string;
  retailer: string;
  dimensions: Dimensions;
  in_stock: boolean | null;
  google_product_url?: string;
};

const MIN_PRODUCTS = 3;
const MAX_PRODUCTS = 10;

type ShoppingCandidate = {
  title: string;
  image_url: string;
  retailer: string;
  price_cents: number | null;
  source: string;
  google_product_url: string;
  immersive_token: string | null;
  existing_direct_url: string | null;
};

function productIdFromUrl(url: string): string {
  return createHash("sha256").update(url).digest("hex").slice(0, 16);
}

function extractRawPrice(price: SerpVisualMatch["price"]): string | null {
  if (price == null) return null;
  if (typeof price === "string") {
    const trimmed = price.trim();
    return trimmed || null;
  }
  if (typeof price === "object") {
    if (typeof price.value === "string" && price.value.trim()) {
      return price.value.trim();
    }
    if (typeof price.extracted_value === "number") {
      return String(price.extracted_value);
    }
  }
  return null;
}

/** Convert price strings like "$1,099" or "1,099.00" into integer cents. */
export function priceToCents(raw: string | null | undefined): number | null {
  if (!raw || typeof raw !== "string") return null;

  // A range, instalment, negative amount, or non-USD quote is not a USD price.
  const match = raw.trim().match(/^(?:from\s+)?(?:US\$|USD\s*|\$)?\s*(\d[\d,.]*)(?:\s*USD)?$/i);
  if (!match) return null;
  const cleaned = match[1];
  let normalized: string;
  if (/^\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?$/.test(cleaned)) {
    normalized = cleaned.replace(/,/g, "");
  } else if (/^\d+(?:\.\d{1,2})?$/.test(cleaned)) {
    normalized = cleaned;
  } else if (/^\d+,\d{2}$/.test(cleaned)) {
    normalized = cleaned.replace(",", ".");
  } else {
    return null;
  }
  const cents = Math.round(Number(normalized) * 100);
  return Number.isSafeInteger(cents) && cents >= 0 ? cents : null;
}

function looksLikeProductPage(url: string, retailer: string): boolean {
  try {
    const { pathname } = new URL(url);
    const path = pathname.toLowerCase();
    if (!path || path === "/") return false;

    switch (retailer) {
      case "amazon.com":
        return /\/(dp|gp\/product)\//.test(path);
      case "etsy.com":
        return path.includes("/listing/");
      case "ikea.com":
        return (
          /\/(p|products)\//.test(path) || /-\d{3}\.\d{3}\.\d{2}/.test(path)
        );
      case "wayfair.com":
        return path.endsWith(".html") || path.includes("/pdp/");
      case "walmart.com":
        return path.includes("/ip/");
      default:
        return path.split("/").filter(Boolean).length >= 2;
    }
  } catch {
    return false;
  }
}

function scoreProduct(product: Product, rawTitle: string): number {
  let score = 0;
  if (looksLikeProductPage(product.product_url, product.retailer)) score += 5;
  if (product.price_cents != null) score += 4;
  if (product.title.trim()) score += 2;
  if (product.image_url) score += 1;
  if (
    product.dimensions.h_in != null ||
    product.dimensions.w_in != null ||
    product.dimensions.d_in != null
  ) {
    score += 3;
  }
  if (rawTitle.length > 20) score += 1;
  // the five known-good shops still lead; the rest are eligible, not equal
  if (isWhitelistedHostname(product.retailer)) score += 2;
  return score;
}

function scoreCandidate(candidate: ShoppingCandidate): number {
  let score = 0;
  if (candidate.existing_direct_url) score += 6;
  else if (candidate.immersive_token) score += 3;
  if (candidate.price_cents != null) score += 4;
  if (candidate.title.trim()) score += 2;
  if (candidate.image_url) score += 1;
  if (candidate.title.length > 20) score += 1;
  if (isWhitelistedHostname(candidate.retailer)) score += 2;
  return score;
}

function enrichFromFields(input: {
  link: string;
  title?: string | null;
  thumbnail?: string | null;
  source?: string | null;
  price?: SerpVisualMatch["price"];
  google_product_url?: string;
  dimensions?: Dimensions;
  in_stock?: boolean | null;
}): Product | null {
  const productUrl = unwrapProductUrl(input.link);
  if (!productUrl) return null;

  // Never treat a Google Shopping/wrapper URL as the Buy link.
  if (isGoogleHostedUrl(productUrl) || !isDirectRetailerUrl(productUrl)) {
    return null;
  }

  const retailer = resolveRetailer(productUrl, input.source);
  if (!retailer) return null;

  const title = typeof input.title === "string" ? input.title : "";
  const image_url = typeof input.thumbnail === "string" ? input.thumbnail : "";
  const rawPrice = extractRawPrice(input.price);
  const dimensions = input.dimensions ?? parseDimensionsFromText(title);
  const in_stock = input.in_stock === undefined ? null : input.in_stock;

  const product: Product = {
    id: productIdFromUrl(productUrl),
    title,
    price_cents: priceToCents(rawPrice),
    currency: "USD",
    image_url,
    product_url: productUrl,
    retailer,
    dimensions:
      dimensions.h_in == null &&
      dimensions.w_in == null &&
      dimensions.d_in == null
        ? unknownDimensions()
        : { ...dimensions, estimated: false },
    in_stock,
  };

  if (input.google_product_url) {
    product.google_product_url = input.google_product_url;
  }

  return product;
}

function enrichVisualMatch(match: SerpVisualMatch): Product | null {
  if (!match?.link) return null;
  return enrichFromFields({
    link: match.link,
    title: match.title,
    thumbnail: match.thumbnail,
    source: match.source,
    price: match.price,
  });
}

function storePurchaseUrl(store: SerpImmersiveStore): string | null {
  for (const raw of [store.direct_link, store.link]) {
    if (typeof raw !== "string" || !raw) continue;
    const url = unwrapProductUrl(raw);
    if (url && isDirectRetailerUrl(url)) return url;
  }
  return null;
}

function pickDirectStore(
  stores: SerpImmersiveStore[],
  sourceLabel: string,
  retailer: string
): { url: string; store: SerpImmersiveStore } | null {
  if (!stores.length) return null;

  const sourceLower = sourceLabel.toLowerCase();
  const retailerName = retailer.replace(/\.com$/, "");

  const ranked = [...stores].sort((a, b) => {
    const score = (store: SerpImmersiveStore) => {
      const name = (store.name || "").toLowerCase();
      let s = 0;
      if (name && sourceLower && name.includes(sourceLower.split(" ")[0]!)) {
        s += 5;
      }
      if (name.includes(retailerName)) s += 4;
      const url = storePurchaseUrl(store);
      if (!url) return s;
      try {
        const domain = retailerDomainFor(new URL(url).hostname);
        if (sameRetailer(domain, retailer)) s += 6;
        else if (domain && isWhitelistedHostname(domain)) s += 2;
        else if (domain) s += 1;
      } catch {
        // ignore
      }
      return s;
    };
    return score(b) - score(a);
  });

  for (const store of ranked) {
    const url = storePurchaseUrl(store);
    if (!url || !isDirectRetailerUrl(url)) continue;
    try {
      const domain = retailerDomainFor(new URL(url).hostname);
      if (sameRetailer(domain, retailer)) return { url, store };
    } catch {
      // continue
    }
  }

  // A different seller can quote a different price. Keep the Google offer
  // link instead of attaching the original price to that seller's checkout.
  return null;
}

function resolveProductDimensions(input: {
  title: string;
  immersiveTitle?: string | null;
  features?: SerpImmersiveFeature[] | null;
}): Dimensions {
  const featureDims = parseDimensionsFromFeatures(input.features);
  const featureLines = (input.features || []).map(
    (f) => `${f.title ?? ""}: ${f.value ?? ""}`
  );
  const textDims = parseDimensionsFromTexts([
    input.title,
    input.immersiveTitle,
    ...featureLines,
  ]);

  const merged: Dimensions = unknownDimensions();
  for (const source of [featureDims, textDims]) {
    if (merged.h_in == null && source.h_in != null) merged.h_in = source.h_in;
    if (merged.w_in == null && source.w_in != null) merged.w_in = source.w_in;
    if (merged.d_in == null && source.d_in != null) merged.d_in = source.d_in;
  }

  if (merged.h_in == null && merged.w_in == null && merged.d_in == null) {
    return unknownDimensions();
  }

  merged.estimated = false;
  return merged;
}

function toShoppingCandidate(
  item: SerpShoppingResult
): ShoppingCandidate | null {
  const googleLink = item.product_link || item.link;
  if (!googleLink || typeof googleLink !== "string") return null;

  const unwrapped = unwrapProductUrl(googleLink);
  if (!unwrapped) return null;

  const sourceRetailer = retailerFromSourceLabel(item.source);
  let existing_direct_url = isDirectRetailerUrl(unwrapped) ? unwrapped : null;
  if (!existing_direct_url && typeof item.link === "string") {
    const alternative = unwrapProductUrl(item.link);
    // Shopping can provide both a Google product_link and a merchant link.
    // Use that free direct link only for the seller whose price we received.
    if (alternative && isDirectRetailerUrl(alternative) &&
        (!sourceRetailer || sameRetailer(resolveRetailer(alternative), sourceRetailer))) {
      existing_direct_url = alternative;
    }
  }
  const retailer =
    (existing_direct_url && resolveRetailer(existing_direct_url, item.source)) ||
    (!isGoogleHostedUrl(unwrapped) && resolveRetailer(unwrapped, item.source)) ||
    sourceRetailer;
  if (!retailer) return null;

  const price: SerpVisualMatch["price"] =
    typeof item.price === "string"
      ? item.price
      : item.extracted_price != null
        ? { extracted_value: item.extracted_price }
        : null;

  const priceCents = priceToCents(extractRawPrice(price));
  if (priceCents == null || typeof item.title !== "string" || !item.title.trim()) return null;
  return {
    title: typeof item.title === "string" ? item.title : "",
    image_url: typeof item.thumbnail === "string" ? item.thumbnail : "",
    retailer,
    price_cents: priceCents,
    source: typeof item.source === "string" ? item.source : "",
    google_product_url: unwrapped,
    immersive_token:
      typeof item.immersive_product_page_token === "string"
        ? item.immersive_product_page_token
        : null,
    existing_direct_url,
  };
}

function buildProductFromCandidate(
  candidate: ShoppingCandidate,
  directUrl: string,
  extras?: {
    immersiveTitle?: string | null;
    features?: SerpImmersiveFeature[] | null;
    in_stock?: boolean | null;
  }
): Product | null {
  const dimensions = resolveProductDimensions({
    title: candidate.title,
    immersiveTitle: extras?.immersiveTitle,
    features: extras?.features,
  });

  return enrichFromFields({
    link: directUrl,
    title: candidate.title,
    thumbnail: candidate.image_url,
    source: candidate.source,
    price:
      candidate.price_cents != null
        ? { extracted_value: candidate.price_cents / 100 }
        : null,
    google_product_url: candidate.google_product_url,
    dimensions,
    in_stock: extras?.in_stock ?? null,
  });
}

/**
 * The listing as Google has it: its own product page, which lists the sellers.
 * Used only to fill a shelf that would otherwise be nearly empty.
 */
function buildProductFromGoogleLink(candidate: ShoppingCandidate): Product | null {
  const url = candidate.google_product_url;
  if (!url || !candidate.title) return null;

  const dimensions = parseDimensionsFromText(candidate.title);
  return {
    id: productIdFromUrl(url),
    title: candidate.title,
    price_cents: candidate.price_cents ?? null,
    currency: "USD",
    image_url: candidate.image_url,
    product_url: url,
    retailer: candidate.retailer,
    dimensions:
      dimensions.h_in == null &&
      dimensions.w_in == null &&
      dimensions.d_in == null
        ? unknownDimensions()
        : { ...dimensions, estimated: false },
    in_stock: null,
    google_product_url: url,
  };
}

function rankAndCap(products: Product[], maxProducts = MAX_PRODUCTS): Product[] {
  const scored = products.map((product) => ({
    product,
    score: scoreProduct(product, product.title),
  }));

  scored.sort((a, b) => b.score - a.score);

  const limit =
    scored.length <= MIN_PRODUCTS
      ? scored.length
      : Math.min(maxProducts, scored.length);

  return scored.slice(0, limit).map((s) => s.product);
}

/**
 * THE BUDGET RANKS THE SHELF. IT DOES NOT EMPTY IT.
 *
 * What is left of the budget was a hard filter, at both the candidate stage
 * and the end — so once a couple of things were placed, every search answered
 * "40 from Google, 0 with a Buy link" and the room said nothing came back. A
 * coffee table costs more than $60 whatever the budget says; hiding all of
 * them does not make one affordable, it just breaks the search.
 *
 * So affordable listings come first and the rest follow. The HUD already says
 * what is left, each card shows its price, and the fit check still speaks for
 * itself.
 */
export function applyMaxPrice(
  products: Product[],
  maxPriceDollars: number | null | undefined
): Product[] {
  if (maxPriceDollars == null || !Number.isFinite(maxPriceDollars)) {
    return products;
  }
  const maxCents = Math.round(maxPriceDollars * 100);
  const affordable = products.filter(
    (p) => p.price_cents == null || p.price_cents <= maxCents
  );
  if (affordable.length === products.length) return products;

  const rest = products.filter(
    (p) => p.price_cents != null && p.price_cents > maxCents
  );
  console.info(
    `[source] ${affordable.length} of ${products.length} listings fit what is left of the budget; showing the rest behind them`
  );
  return [...affordable, ...rest];
}

/** Affordable candidates are looked up first; none are thrown away. */
function applyMaxPriceToCandidates(
  candidates: ShoppingCandidate[],
  maxPriceDollars: number | null | undefined
): ShoppingCandidate[] {
  if (maxPriceDollars == null || !Number.isFinite(maxPriceDollars)) {
    return candidates;
  }
  const maxCents = Math.round(maxPriceDollars * 100);
  const within = (c: ShoppingCandidate) =>
    c.price_cents == null || c.price_cents <= maxCents;
  return [...candidates.filter(within), ...candidates.filter((c) => !within(c))];
}

/**
 * Enrich SerpAPI Lens visual_matches into the clean Product schema,
 * ranked and capped to the best 3–5 results.
 */
export function enrichVisualMatches(
  matches: SerpVisualMatch[] | null | undefined
): Product[] {
  if (!Array.isArray(matches)) return [];

  const seen = new Set<string>();
  const products: Product[] = [];

  for (const match of matches) {
    const product = enrichVisualMatch(match);
    if (!product) continue;
    if (seen.has(product.id)) continue;
    seen.add(product.id);
    products.push(product);
  }

  return rankAndCap(products);
}

/**
 * Enrich SerpAPI Google Shopping results into the existing Product schema.
 * Resolves direct retailer Buy URLs via immersive product (top candidates only).
 *
 * Dimension scraping is deferred to the caller (`fillMissingDimensions`) so we
 * only hit retailer PDPs for products we actually return.
 */
/**
 * How many Buy-link lookups one search may spend. Each is a SerpAPI credit.
 */
const MAX_IMMERSIVE_LOOKUPS = Number(process.env.SERPAPI_MAX_IMMERSIVE ?? 4);

export async function enrichShoppingResults(
  results: SerpShoppingResult[] | null | undefined,
  options?: {
    maxPrice?: number | null;
    apiKey?: string;
    maxProducts?: number;
    /** Filter candidates by title before expensive immersive fetches. */
    designQuery?: string | null;
    /** What is left of the caller's deadline, for the Buy-link fetches. */
    timeoutMs?: number;
  }
): Promise<Product[]> {
  if (!Array.isArray(results)) return [];

  const maxProducts = options?.maxProducts ?? MAX_PRODUCTS;
  const seenGoogle = new Set<string>();
  let candidates: ShoppingCandidate[] = [];

  for (const item of results) {
    const candidate = toShoppingCandidate(item);
    if (!candidate) continue;
    if (seenGoogle.has(candidate.google_product_url)) continue;
    seenGoogle.add(candidate.google_product_url);
    candidates.push(candidate);
  }

  // Drop irrelevant titles before any immersive Serp calls.
  if (options?.designQuery) {
    const filtered = diversifyProductsByQuery(
      filterProductsByDesignQuery(candidates, options.designQuery),
      options.designQuery
    );
    candidates = filtered;
  }

  // stable sort: candidates arrive affordable-first, and equal scores keep it
  candidates.sort((a, b) => scoreCandidate(b) - scoreCandidate(a));
  candidates = applyMaxPriceToCandidates(candidates, options?.maxPrice);

  /*
   * NINE IMMERSIVE LOOKUPS IS NINE SERPAPI CREDITS FOR ONE QUESTION.
   *
   * Every candidate without a direct Buy link used to get its own immersive
   * fetch, so a single search cost 2 Shopping calls and 9 immersive ones —
   * eleven credits, on a key a whole team shares for a weekend. The immersive
   * call buys one listing's Buy link and its dimension features: worth having,
   * not worth eleven of.
   *
   * So direct PDP links are taken first — they cost nothing extra — and only
   * a few of the rest are looked up. A search is a handful of credits now,
   * and a listing that would have needed the tenth lookup simply doesn't
   * appear.
   */
  const withDirect = candidates.filter((c) => c.existing_direct_url);
  const needImmersive = candidates.filter((c) => !c.existing_direct_url);
  const shortfall = Math.max(
    0,
    maxProducts - Math.min(withDirect.length, maxProducts)
  );
  const lookups = Math.min(shortfall, MAX_IMMERSIVE_LOOKUPS);
  if (needImmersive.length > lookups) {
    console.info(
      `[serpapi] ${lookups} immersive lookup${lookups === 1 ? "" : "s"}, ` +
        `${needImmersive.length - lookups} listing${
          needImmersive.length - lookups === 1 ? "" : "s"
        } left unresolved to save credits`
    );
  }
  const top = [
    ...withDirect.slice(0, maxProducts),
    ...needImmersive.slice(0, lookups),
  ].slice(0, maxProducts);

  const apiKey = options?.apiKey;
  const resolved = await Promise.all(
    top.map(async (candidate) => {
      let directUrl = candidate.existing_direct_url;
      let features: SerpImmersiveFeature[] = [];
      let immersiveTitle: string | null = null;
      let in_stock: boolean | null = null;

      if (!directUrl && candidate.immersive_token && apiKey) {
        const immersive = await fetchImmersiveProduct(
          candidate.immersive_token,
          apiKey,
          options?.timeoutMs
        );
        features = immersive.features;
        immersiveTitle = immersive.title ?? null;

        const picked = pickDirectStore(
          immersive.stores,
          candidate.source,
          candidate.retailer
        );
        if (picked) {
          directUrl = picked.url;
          in_stock = parseInStockFromOffers(picked.store.details_and_offers);
        }
      }

      if (!directUrl) return null;

      return buildProductFromCandidate(candidate, directUrl, {
        immersiveTitle,
        features,
        in_stock,
      });
    })
  );

  const products: Product[] = [];
  const seenIds = new Set<string>();
  /*
   * The same listing reaches us twice — once resolved to its retailer page and
   * once as the Google wrapper it arrived on — and those are different URLs,
   * so an id is not enough to tell them apart. The title is.
   */
  const seenTitles = new Set<string>();
  const seenGoogleUrls = new Set<string>();
  const titleKey = (title: string) =>
    title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

  for (const product of resolved) {
    if (!product) continue;
    if (seenIds.has(product.id)) continue;
    if (seenTitles.has(titleKey(product.title))) continue;
    seenIds.add(product.id);
    seenTitles.add(titleKey(product.title));
    if (product.google_product_url) seenGoogleUrls.add(product.google_product_url);
    products.push(product);
  }

  /*
   * A SHOPPING PAGE BEATS AN EMPTY SHELF.
   *
   * Google answered with forty listings and three of them survived, because
   * the other thirty-seven arrived as Google wrapper links and resolving each
   * one into a retailer Buy link costs a SerpAPI credit we are no longer
   * spending forty of. Those listings are real: title, price, image, seller,
   * and a link that opens the product with its sellers on it.
   *
   * So they top up the shelf, after every properly resolved listing, and only
   * when there would otherwise be too few to choose between. The card still
   * shows the seller's name; what it cannot promise is a one-click PDP.
   */
  if (products.length < maxProducts) {
    for (const candidate of candidates) {
      if (products.length >= maxProducts) break;
      if (!candidate.google_product_url || candidate.existing_direct_url) continue;
      if (seenGoogleUrls.has(candidate.google_product_url)) continue;
      if (seenTitles.has(titleKey(candidate.title))) continue;
      const product = buildProductFromGoogleLink(candidate);
      if (!product || seenIds.has(product.id)) continue;
      seenIds.add(product.id);
      seenTitles.add(titleKey(product.title));
      seenGoogleUrls.add(candidate.google_product_url);
      products.push(product);
    }
  }

  // Rank quality first, then affordability, and only then cap the shelf.
  // Capping before the budget pass could throw away the only affordable item.
  return applyMaxPrice(rankAndCap(products, products.length), options?.maxPrice).slice(0, maxProducts);
}
