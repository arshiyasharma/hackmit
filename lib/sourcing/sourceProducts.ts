import { searchProducts } from "@/lib/elastic/search";
import { upsertProducts } from "@/lib/elastic/index";
import {
  enrichShoppingResults,
  type Product,
} from "@/lib/sourcing/enrich";
import {
  diversifyProductsByQuery,
  filterProductsByDesignQuery,
  isBroadProductQuery,
} from "@/lib/sourcing/roomContext";
import { scrapeRetailerDimensions } from "@/lib/sourcing/scrapeDimensions";
import {
  buildShoppingQueryFallbacks,
  searchGoogleShoppingWithFallbacks,
} from "@/lib/sourcing/serpapi";

const DEFAULT_LIMIT = 8;
const ELASTIC_ENOUGH = 3;
const RESULT_CACHE_TTL_MS = 90_000;
const SCRAPE_BUDGET_MS = 2_500;

const resultCache = new Map<
  string,
  { expires: number; products: Product[] }
>();

export type SourceProductsOptions = {
  /** Final shopping query string (already contextualized if needed). */
  shoppingQuery: string;
  apiKey: string;
  maxPrice?: number | null;
  /** Max products to return (default 4). */
  limit?: number;
  /** Min Elastic hits to skip SerpAPI (default 3). */
  elasticMin?: number;
  /**
   * Original design query used to drop irrelevant Elastic/Serp hits
   * (e.g. sofas when the user asked for "pink lamp").
   */
  designQuery?: string | null;
};

function cacheKey(options: SourceProductsOptions): string {
  return [
    options.shoppingQuery.trim().toLowerCase(),
    (options.designQuery ?? "").trim().toLowerCase(),
    options.maxPrice ?? "",
    options.limit ?? DEFAULT_LIMIT,
  ].join("|");
}

function getCached(options: SourceProductsOptions): Product[] | null {
  const hit = resultCache.get(cacheKey(options));
  if (!hit) return null;
  if (hit.expires <= Date.now()) {
    resultCache.delete(cacheKey(options));
    return null;
  }
  return hit.products;
}

function setCache(options: SourceProductsOptions, products: Product[]): void {
  if (products.length === 0) return;
  resultCache.set(cacheKey(options), {
    expires: Date.now() + RESULT_CACHE_TTL_MS,
    products,
  });
  if (resultCache.size > 40) {
    const oldest = resultCache.keys().next().value;
    if (oldest) resultCache.delete(oldest);
  }
}

function hasAnyDimension(product: Product): boolean {
  const d = product.dimensions;
  return d.h_in != null || d.w_in != null || d.d_in != null;
}

/** Only scrape PDPs with zero dims; abort each scrape after a short budget. */
export async function fillMissingDimensions(
  products: Product[]
): Promise<Product[]> {
  return Promise.all(
    products.map(async (product) => {
      if (hasAnyDimension(product)) return product;
      try {
        const scraped = await Promise.race([
          scrapeRetailerDimensions(
            product.product_url,
            product.retailer,
            product.dimensions
          ),
          new Promise<typeof product.dimensions>((resolve) =>
            setTimeout(() => resolve(product.dimensions), SCRAPE_BUDGET_MS)
          ),
        ]);
        return { ...product, dimensions: scraped };
      } catch (error) {
        console.warn(
          `[source] Dimension scrape failed for ${product.product_url}:`,
          error
        );
        return product;
      }
    })
  );
}

function upsertInBackground(products: Product[]): void {
  if (products.length === 0) return;
  void upsertProducts(products).catch((error) => {
    console.error("Elasticsearch indexing failed:", error);
  });
}

function finalizeProducts(
  products: Product[],
  designQuery: string,
  limit: number
): Product[] {
  return diversifyProductsByQuery(products, designQuery).slice(0, limit);
}

function isColorDominated(products: Product[]): boolean {
  if (products.length === 0) return false;
  const colored = products.filter((p) =>
    /\b(pink|rose|blush)\b/i.test(p.title || "")
  ).length;
  return colored > products.length / 2;
}

/**
 * Source products for one shopping query:
 *   1) Elasticsearch catalog first (relevance-filtered)
 *   2) SerpAPI Google Shopping + enrich if not enough / broad queries
 *   3) Upsert newly discovered products (best-effort, non-blocking)
 */
export async function sourceProductsForQuery(
  options: SourceProductsOptions
): Promise<Product[]> {
  const cached = getCached(options);
  if (cached) return cached;

  const limit = options.limit ?? DEFAULT_LIMIT;
  const elasticMin = options.elasticMin ?? ELASTIC_ENOUGH;
  const designQuery = options.designQuery ?? options.shoppingQuery;
  const maxPriceCents =
    options.maxPrice != null && Number.isFinite(options.maxPrice)
      ? Math.round(options.maxPrice * 100)
      : undefined;
  const broad = isBroadProductQuery(designQuery);

  const applyRelevance = (products: Product[]) =>
    diversifyProductsByQuery(
      filterProductsByDesignQuery(products, designQuery),
      designQuery
    );

  let elasticProducts: Product[] = [];
  try {
    elasticProducts = applyRelevance(
      await searchProducts({
        /*
         * THE STYLED QUERY, not the bare request.
         *
         * `designQuery` is "a tall lamp" — what the user asked for, used below
         * to drop irrelevant hits. `shoppingQuery` is what the room screen is
         * actually showing above the results: the style words and the picked
         * colours joined to that request. Searching the bare request here made
         * the whole strip decorative — add "brass", remove "ornate", pick sage,
         * and Elastic returned the same lamps either way, because none of those
         * words ever reached it. Retrieval uses the full query; relevance
         * filtering still uses the request.
         */
        q: options.shoppingQuery || designQuery,
        maxPriceCents,
      })
    );
    // Broad queries skip Elastic-only unless the catalog isn't color-dominated.
    const trustElastic =
      elasticProducts.length >= elasticMin &&
      (!broad || !isColorDominated(elasticProducts));

    if (trustElastic) {
      const filled = await fillMissingDimensions(
        finalizeProducts(elasticProducts, designQuery, limit)
      );
      const improved = filled.some((p, i) => {
        const before = elasticProducts[i]?.dimensions;
        const after = p.dimensions;
        if (!before) return true;
        return (
          (before.h_in == null && after.h_in != null) ||
          (before.w_in == null && after.w_in != null) ||
          (before.d_in == null && after.d_in != null)
        );
      });
      if (improved) upsertInBackground(filled);
      setCache(options, filled);
      return filled;
    }
  } catch (error) {
    console.warn(
      "[source] Elasticsearch lookup failed; falling back to SerpAPI:",
      error
    );
  }

  if (!options.apiKey) {
    if (elasticProducts.length > 0) {
      const filled = await fillMissingDimensions(
        finalizeProducts(elasticProducts, designQuery, limit)
      );
      setCache(options, filled);
      return filled;
    }
    throw new Error("SERPAPI_KEY is not configured");
  }

  const result = await searchGoogleShoppingWithFallbacks(
    buildShoppingQueryFallbacks(options.shoppingQuery, designQuery),
    options.apiKey
  );
  if (!result.ok) {
    if (elasticProducts.length > 0) {
      const filled = await fillMissingDimensions(
        finalizeProducts(elasticProducts, designQuery, limit)
      );
      setCache(options, filled);
      return filled;
    }
    console.warn("[source] SerpAPI shopping failed:", result.error);
    return [];
  }

  const enriched = await enrichShoppingResults(result.shopping_results, {
    maxPrice: options.maxPrice,
    apiKey: options.apiKey,
    maxProducts: limit + 1,
    designQuery,
  });
  const resolved = applyRelevance(enriched);

  const seen = new Set(resolved.map((p) => p.id));
  const merged = [
    ...resolved,
    ...elasticProducts.filter((p) => !seen.has(p.id)),
  ];
  const products = await fillMissingDimensions(
    finalizeProducts(merged, designQuery, limit)
  );

  if (products.length > 0) {
    upsertInBackground(products);
    setCache(options, products);
    return products;
  }

  if (enriched.length > 0) {
    const fallback = await fillMissingDimensions(
      finalizeProducts(enriched, designQuery, limit)
    );
    upsertInBackground(fallback);
    setCache(options, fallback);
    return fallback;
  }

  const elasticFallback = await fillMissingDimensions(
    finalizeProducts(elasticProducts, designQuery, limit)
  );
  setCache(options, elasticFallback);
  return elasticFallback;
}
