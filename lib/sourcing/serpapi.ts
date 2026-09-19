import type {
  SerpImmersiveProduct,
  SerpImmersiveStore,
  SerpShoppingResult,
  SerpVisualMatch,
} from "@/lib/sourcing/product";

export type SerpLensSuccess = {
  ok: true;
  visual_matches: SerpVisualMatch[];
};

export type SerpLensFailure = {
  ok: false;
  error: string;
};

export type SerpLensResult = SerpLensSuccess | SerpLensFailure;

export type SerpShoppingSuccess = {
  ok: true;
  shopping_results: SerpShoppingResult[];
};

export type SerpShoppingFailure = {
  ok: false;
  error: string;
};

export type SerpShoppingSearchResult = SerpShoppingSuccess | SerpShoppingFailure;

async function fetchSerpJson(
  requestUrl: string
): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; error: string }> {
  try {
    const response = await fetch(requestUrl);
    if (!response.ok) {
      return {
        ok: false,
        error: `SerpAPI request failed with status ${response.status}`,
      };
    }
    const data = (await response.json()) as Record<string, unknown>;
    if (typeof data.error === "string" && data.error) {
      return { ok: false, error: data.error };
    }
    return { ok: true, data };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "SerpAPI network error",
    };
  }
}

function buildGoogleLensUrl(imageUrl: string, apiKey: string): string {
  const serpUrl = new URL("https://serpapi.com/search.json");
  serpUrl.searchParams.set("engine", "google_lens");
  serpUrl.searchParams.set("url", imageUrl);
  serpUrl.searchParams.set("api_key", apiKey);
  return serpUrl.toString();
}

function buildGoogleShoppingUrl(q: string, apiKey: string): string {
  const serpUrl = new URL("https://serpapi.com/search.json");
  serpUrl.searchParams.set("engine", "google_shopping");
  serpUrl.searchParams.set("q", q);
  serpUrl.searchParams.set("api_key", apiKey);
  return serpUrl.toString();
}

function parseVisualMatches(raw: unknown): SerpVisualMatch[] {
  if (!Array.isArray(raw)) return [];
  return raw as SerpVisualMatch[];
}

function parseShoppingResults(raw: unknown): SerpShoppingResult[] {
  if (!Array.isArray(raw)) return [];
  return raw as SerpShoppingResult[];
}

/**
 * Call SerpAPI Google Lens and return visual_matches (or a failure reason).
 * Kept for possible reuse; /api/source now uses Google Shopping.
 */
export async function searchGoogleLens(
  imageUrl: string,
  apiKey: string
): Promise<SerpLensResult> {
  const result = await fetchSerpJson(buildGoogleLensUrl(imageUrl, apiKey));
  if (!result.ok) return result;

  return {
    ok: true,
    visual_matches: parseVisualMatches(result.data.visual_matches),
  };
}

/**
 * Call SerpAPI Google Shopping and return shopping_results.
 */
export async function searchGoogleShopping(
  q: string,
  apiKey: string
): Promise<SerpShoppingSearchResult> {
  const result = await fetchSerpJson(buildGoogleShoppingUrl(q, apiKey));
  if (!result.ok) return result;

  return {
    ok: true,
    shopping_results: parseShoppingResults(result.data.shopping_results),
  };
}

function buildImmersiveProductUrl(pageToken: string, apiKey: string): string {
  const serpUrl = new URL("https://serpapi.com/search.json");
  serpUrl.searchParams.set("engine", "google_immersive_product");
  serpUrl.searchParams.set("page_token", pageToken);
  serpUrl.searchParams.set("api_key", apiKey);
  return serpUrl.toString();
}

/**
 * Fetch immersive product details (stores + features) for a shopping token.
 * Same SerpAPI call previously used only for store links — now also surfaces
 * dimension features and stock offer strings.
 */
export async function fetchImmersiveProduct(
  pageToken: string,
  apiKey: string
): Promise<SerpImmersiveProduct> {
  const empty: SerpImmersiveProduct = { stores: [], features: [] };
  const result = await fetchSerpJson(
    buildImmersiveProductUrl(pageToken, apiKey)
  );
  if (!result.ok) {
    console.warn("[serpapi] Immersive product fetch failed:", result.error);
    return empty;
  }

  const productResults = result.data.product_results as
    | {
        title?: string;
        stores?: unknown;
        about_the_product?: { features?: unknown };
      }
    | undefined;

  const stores = Array.isArray(productResults?.stores)
    ? (productResults!.stores as SerpImmersiveStore[])
    : [];
  const features = Array.isArray(productResults?.about_the_product?.features)
    ? (productResults!.about_the_product!.features as SerpImmersiveProduct["features"])
    : [];

  return {
    stores,
    features,
    title:
      typeof productResults?.title === "string" ? productResults.title : null,
  };
}

/** @deprecated Prefer fetchImmersiveProduct — kept for callers that only need stores. */
export async function fetchImmersiveStores(
  pageToken: string,
  apiKey: string
): Promise<SerpImmersiveStore[]> {
  const product = await fetchImmersiveProduct(pageToken, apiKey);
  return product.stores;
}
