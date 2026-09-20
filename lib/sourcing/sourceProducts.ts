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

const DEFAULT_LIMIT = 4;
const ELASTIC_ENOUGH = 3;

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

function dimensionsIncomplete(product: Product): boolean {
  const d = product.dimensions;
  return d.h_in == null || d.w_in == null || d.d_in == null;
}

/** Backfill missing W/H/D from the retailer PDP (best-effort). */
export async function fillMissingDimensions(
  products: Product[]
): Promise<Product[]> {
  return Promise.all(
    products.map(async (product) => {
      if (!dimensionsIncomplete(product)) return product;
      try {
        const scraped = await scrapeRetailerDimensions(
          product.product_url,
          product.retailer,
          product.dimensions
        );
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

/**
 * Source products for one shopping query:
 *   1) Elasticsearch catalog first (relevance-filtered)
 *   2) SerpAPI Google Shopping + enrich if not enough / broad queries
 *   3) Upsert newly discovered products (best-effort, non-blocking)
 */
export async function sourceProductsForQuery(
  options: SourceProductsOptions
): Promise<Product[]> {
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
        q: designQuery,
        maxPriceCents,
      })
    );
    // Broad queries like "lamp" must hit SerpAPI — Elastic is full of prior pink lamps.
    if (elasticProducts.length >= elasticMin && !broad) {
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
      return fillMissingDimensions(
        finalizeProducts(elasticProducts, designQuery, limit)
      );
    }
    throw new Error("SERPAPI_KEY is not configured");
  }

  const result = await searchGoogleShoppingWithFallbacks(
    buildShoppingQueryFallbacks(options.shoppingQuery, designQuery),
    options.apiKey
  );
  if (!result.ok) {
    if (elasticProducts.length > 0) {
      return fillMissingDimensions(
        finalizeProducts(elasticProducts, designQuery, limit)
      );
    }
    console.warn("[source] SerpAPI shopping failed:", result.error);
    return [];
  }

  const enriched = await enrichShoppingResults(result.shopping_results, {
    maxPrice: options.maxPrice,
    apiKey: options.apiKey,
    maxProducts: Math.max(limit + 3, 8),
  });
  const resolved = applyRelevance(enriched);

  // Prefer fresh Serp hits; fill gaps from Elastic without letting cache dominate.
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
    return products;
  }

  if (enriched.length > 0) {
    const fallback = await fillMissingDimensions(
      finalizeProducts(enriched, designQuery, limit)
    );
    upsertInBackground(fallback);
    return fallback;
  }

  return fillMissingDimensions(
    finalizeProducts(elasticProducts, designQuery, limit)
  );
}
