import type { Product } from "@/lib/sourcing/enrich";
import { getElasticClient } from "@/lib/elastic/client";
import { PRODUCTS_INDEX } from "@/lib/elastic/index";

export type ProductSearchParams = {
  q?: string;
  maxPriceCents?: number;
  retailer?: string;
};

type EsProductSource = {
  id?: string;
  title?: string;
  price_cents?: number | null;
  currency?: string;
  image_url?: string;
  product_url?: string;
  retailer?: string;
  in_stock?: boolean | null;
  dimensions?: {
    h_in?: number | null;
    w_in?: number | null;
    d_in?: number | null;
    estimated?: boolean;
  };
  google_product_url?: string;
};

function mapSourceToProduct(
  source: EsProductSource | undefined,
  fallbackId: string
): Product | null {
  if (!source) return null;

  const product: Product = {
    id: typeof source.id === "string" && source.id ? source.id : fallbackId,
    title: typeof source.title === "string" ? source.title : "",
    price_cents:
      typeof source.price_cents === "number" ? source.price_cents : null,
    currency: source.currency === "USD" ? "USD" : "USD",
    image_url: typeof source.image_url === "string" ? source.image_url : "",
    product_url:
      typeof source.product_url === "string" ? source.product_url : "",
    retailer: typeof source.retailer === "string" ? source.retailer : "",
    dimensions: {
      h_in:
        typeof source.dimensions?.h_in === "number"
          ? source.dimensions.h_in
          : null,
      w_in:
        typeof source.dimensions?.w_in === "number"
          ? source.dimensions.w_in
          : null,
      d_in:
        typeof source.dimensions?.d_in === "number"
          ? source.dimensions.d_in
          : null,
      estimated: source.dimensions?.estimated === false ? false : true,
    },
    in_stock: typeof source.in_stock === "boolean" ? source.in_stock : null,
  };

  if (typeof source.google_product_url === "string") {
    product.google_product_url = source.google_product_url;
  }

  return product;
}

export function buildProductSearchQuery(params: ProductSearchParams) {
  const must: object[] = [];
  const filter: object[] = [];

  if (params.q && params.q.trim()) {
    must.push({
      match: {
        title: {
          query: params.q.trim(),
          // Prefer titles that cover most query tokens. Plain OR was matching
          // "table" alone onto "pink table lamp" and short-circuiting SerpAPI.
          minimum_should_match: "75%",
        },
      },
    });
  }

  if (
    typeof params.maxPriceCents === "number" &&
    Number.isFinite(params.maxPriceCents)
  ) {
    filter.push({
      range: {
        price_cents: {
          lte: params.maxPriceCents,
        },
      },
    });
  }

  if (params.retailer && params.retailer.trim()) {
    filter.push({
      term: {
        retailer: params.retailer.trim(),
      },
    });
  }

  if (must.length === 0 && filter.length === 0) {
    return { match_all: {} };
  }

  return {
    bool: {
      ...(must.length ? { must } : {}),
      ...(filter.length ? { filter } : {}),
    },
  };
}

/**
 * Search the Elasticsearch `products` catalog.
 * Throws on Elastic/config failure so the route can return 502.
 */
export async function searchProducts(
  params: ProductSearchParams
): Promise<Product[]> {
  const client = getElasticClient();
  if (!client) {
    throw new Error("ELASTICSEARCH_URL is not configured");
  }

  const result = await client.search({
    index: PRODUCTS_INDEX,
    size: 10,
    query: buildProductSearchQuery(params),
  });

  const products: Product[] = [];
  for (const hit of result.hits.hits) {
    const product = mapSourceToProduct(
      hit._source as EsProductSource | undefined,
      String(hit._id ?? "")
    );
    if (product) products.push(product);
  }

  return products;
}
