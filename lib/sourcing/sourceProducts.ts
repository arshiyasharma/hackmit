import { searchProducts } from "@/lib/elastic/search";
import { upsertProducts } from "@/lib/elastic/index";
import {
  enrichShoppingResults,
  type Product,
} from "@/lib/sourcing/enrich";
import { filterProductsByDesignQuery } from "@/lib/sourcing/roomContext";
import { scrapeRetailerDimensions } from "@/lib/sourcing/scrapeDimensions";
import { searchGoogleShopping } from "@/lib/sourcing/serpapi";

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
async function fillMissingDimensions(
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

/**
 * Source products for one shopping query:
 *   1) Elasticsearch catalog first (relevance-filtered)
 *   2) SerpAPI Google Shopping + enrich if not enough
 *   3) Upsert newly discovered products (best-effort)
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

  const applyRelevance = (products: Product[]) =>
    filterProductsByDesignQuery(products, designQuery);

  let elasticProducts: Product[] = [];
  try {
    elasticProducts = applyRelevance(
      await searchProducts({
        q: options.shoppingQuery,
        maxPriceCents,
      })
    );
    if (elasticProducts.length >= elasticMin) {
      const filled = await fillMissingDimensions(
        elasticProducts.slice(0, limit)
      );
      // Refresh Elastic with any newly scraped dims (best-effort).
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
      if (improved) {
        try {
          await upsertProducts(filled);
        } catch (error) {
          console.error("Elasticsearch indexing failed:", error);
        }
      }
      return filled;
    }
  } catch (error) {
    console.warn(
      "[source] Elasticsearch lookup failed; falling back to SerpAPI:",
      error
    );
  }

  const result = await searchGoogleShopping(
    options.shoppingQuery,
    options.apiKey
  );
  if (!result.ok) {
    if (elasticProducts.length > 0) {
      return fillMissingDimensions(elasticProducts.slice(0, limit));
    }
    throw new Error(result.error);
  }

  const products = applyRelevance(
    await enrichShoppingResults(result.shopping_results, {
      maxPrice: options.maxPrice,
      apiKey: options.apiKey,
      // Fetch extra candidates so relevance filtering still leaves enough.
      maxProducts: Math.max(limit * 2, 6),
    })
  ).slice(0, limit);

  if (products.length > 0) {
    try {
      await upsertProducts(products);
    } catch (error) {
      console.error("Elasticsearch indexing failed:", error);
    }
    return products;
  }

  return fillMissingDimensions(elasticProducts.slice(0, limit));
}
