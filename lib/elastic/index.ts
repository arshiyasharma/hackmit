import type { Product } from "@/lib/sourcing/enrich";
import { getElasticClient } from "@/lib/elastic/client";

export const PRODUCTS_INDEX = "products";

const PRODUCTS_MAPPINGS = {
  properties: {
    id: { type: "keyword" as const },
    title: { type: "text" as const },
    retailer: { type: "keyword" as const },
    product_url: { type: "keyword" as const },
    image_url: { type: "keyword" as const },
    price_cents: { type: "integer" as const },
    in_stock: { type: "boolean" as const },
    currency: { type: "keyword" as const },
    dimensions: {
      properties: {
        h_in: { type: "float" as const },
        w_in: { type: "float" as const },
        d_in: { type: "float" as const },
        estimated: { type: "boolean" as const },
      },
    },
  },
};

let ensureIndexPromise: Promise<void> | null = null;

async function ensureProductsIndex(): Promise<void> {
  const client = getElasticClient();
  if (!client) return;

  const exists = await client.indices.exists({ index: PRODUCTS_INDEX });
  if (exists) return;

  await client.indices.create({
    index: PRODUCTS_INDEX,
    mappings: PRODUCTS_MAPPINGS,
  });
}

function toDocument(product: Product) {
  return {
    id: product.id,
    title: product.title,
    retailer: product.retailer,
    product_url: product.product_url,
    image_url: product.image_url,
    price_cents: product.price_cents,
    in_stock: product.in_stock,
    currency: product.currency,
    dimensions: {
      h_in: product.dimensions.h_in,
      w_in: product.dimensions.w_in,
      d_in: product.dimensions.d_in,
      estimated: product.dimensions.estimated,
    },
  };
}

/**
 * Upsert enriched products into the `products` index using Product.id as _id.
 * Swallows Elasticsearch failures so sourcing can still succeed.
 */
export async function upsertProducts(products: Product[]): Promise<void> {
  if (!products.length) return;

  const client = getElasticClient();
  if (!client) {
    console.warn(
      "[elastic] Skipping upsert: ELASTICSEARCH_URL is not configured"
    );
    return;
  }

  try {
    if (!ensureIndexPromise) {
      ensureIndexPromise = ensureProductsIndex().catch((err) => {
        ensureIndexPromise = null;
        throw err;
      });
    }
    await ensureIndexPromise;

    const operations = products.flatMap((product) => [
      { index: { _index: PRODUCTS_INDEX, _id: product.id } },
      toDocument(product),
    ]);

    const result = await client.bulk({ operations, refresh: false });

    if (result.errors) {
      const failed = result.items.filter(
        (item) => item.index?.error || item.create?.error || item.update?.error
      );
      console.error(
        "[elastic] Bulk upsert completed with errors:",
        JSON.stringify(failed.slice(0, 3))
      );
    }
  } catch (err) {
    console.error("[elastic] Failed to upsert products:", err);
  }
}
