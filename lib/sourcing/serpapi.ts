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
  const controller = new AbortController();
  /*
   * 10s was not enough. Google Shopping through SerpAPI regularly takes twelve
   * to eighteen seconds, and every one of those came back to the room screen
   * as "nothing came back from that" — a timeout wearing an empty result's
   * clothes. The ladder tries at most three queries, so this is bounded by the
   * deadline the caller passes rather than by this number alone.
   */
  const timer = setTimeout(() => controller.abort(), SERP_TIMEOUT_MS);
  const startedAt = Date.now();
  /** the query without the key, so a log line is safe to paste anywhere */
  const label = (() => {
    try {
      const u = new URL(requestUrl);
      return `${u.searchParams.get("engine")} "${u.searchParams.get("q") ?? u.searchParams.get("url") ?? ""}"`;
    } catch {
      return "serpapi";
    }
  })();
  try {
    const response = await fetch(requestUrl, { signal: controller.signal });
    console.info(`[serpapi] ${label} -> ${response.status} in ${Date.now() - startedAt}ms`);
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
    console.warn(
      `[serpapi] ${label} -> ${err instanceof Error ? err.message : "error"} after ${
        Date.now() - startedAt
      }ms`
    );
    return {
      ok: false,
      error: err instanceof Error ? err.message : "SerpAPI network error",
    };
  } finally {
    clearTimeout(timer);
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
  serpUrl.searchParams.set("hl", "en");
  serpUrl.searchParams.set("gl", "us");
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

/** SerpAPI often reports empty Shopping pages as this error string. */
export function isGoogleNoResultsError(message: string): boolean {
  return /hasn't returned any results|no results for this query|zero results/i.test(
    message
  );
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
 * Short in-memory cache avoids repeat Serp round-trips within a demo session.
 */
const SHOPPING_CACHE_TTL_MS = 5 * 60_000;
const shoppingCache = new Map<
  string,
  { expires: number; shopping_results: SerpShoppingResult[] }
>();

export async function searchGoogleShopping(
  q: string,
  apiKey: string
): Promise<SerpShoppingSearchResult> {
  const cacheKey = q.trim().toLowerCase();
  const cached = shoppingCache.get(cacheKey);
  if (cached && cached.expires > Date.now()) {
    return { ok: true, shopping_results: cached.shopping_results };
  }

  const result = await fetchSerpJson(buildGoogleShoppingUrl(q, apiKey));
  if (!result.ok) {
    // Empty Google pages are not hard failures — treat as zero hits.
    if (isGoogleNoResultsError(result.error)) {
      return { ok: true, shopping_results: [] };
    }
    return result;
  }

  const shopping_results = parseShoppingResults(result.data.shopping_results);
  shoppingCache.set(cacheKey, {
    expires: Date.now() + SHOPPING_CACHE_TTL_MS,
    shopping_results,
  });

  // Bound memory in long-running dev servers.
  if (shoppingCache.size > 50) {
    const oldest = shoppingCache.keys().next().value;
    if (oldest) shoppingCache.delete(oldest);
  }

  return { ok: true, shopping_results };
}

/**
 * Try the primary Shopping query, then at most one parallel fallback batch.
 * Caps Serp round-trips so empty Google pages don't cascade into 5 sequential waits.
 */
/** Per request. The ladder below stops as soon as one answers. */
const SERP_TIMEOUT_MS = Number(process.env.SERPAPI_TIMEOUT_MS ?? 20_000);

export async function searchGoogleShoppingWithFallbacks(
  queries: string[],
  apiKey: string
): Promise<SerpShoppingSearchResult> {
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const raw of queries) {
    const q = raw.trim().replace(/\s+/g, " ");
    if (!q) continue;
    const key = q.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(q);
    if (unique.length >= 2) break;
  }

  if (unique.length === 0) {
    return { ok: true, shopping_results: [] };
  }

  // Primary first — usually hits and avoids burning extra Serp calls.
  const primary = await searchGoogleShopping(unique[0]!, apiKey);
  if (primary.ok && primary.shopping_results.length > 0) {
    return primary;
  }

  const rest = unique.slice(1);
  if (rest.length === 0) {
    return primary.ok
      ? primary
      : isGoogleNoResultsError(primary.error)
        ? { ok: true, shopping_results: [] }
        : primary;
  }

  // Remaining fallbacks in parallel (max 2).
  const results = await Promise.all(
    rest.map((q) => searchGoogleShopping(q, apiKey))
  );
  for (const result of results) {
    if (result.ok && result.shopping_results.length > 0) return result;
  }

  const hard = results.find(
    (r) => !r.ok && !isGoogleNoResultsError(r.error)
  );
  if (hard && !hard.ok) return hard;
  if (!primary.ok && !isGoogleNoResultsError(primary.error)) return primary;

  return { ok: true, shopping_results: [] };
}

/** Build progressively simpler Shopping strings from a rich query. */
export function buildShoppingQueryFallbacks(
  shoppingQuery: string,
  designQuery?: string | null
): string[] {
  const STYLE_WORDS =
    /\b(warm|cool|neutral|eclectic|boho|vintage|romantic|french|cottage|modern|minimal|organic|natural|wood|chic|bedroom)\b/gi;

  const out: string[] = [];
  const seen = new Set<string>();
  const add = (value: string) => {
    const q = value.trim().replace(/\s+/g, " ");
    if (!q) return;
    const key = q.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(q);
  };

  add(shoppingQuery);
  if (designQuery) add(designQuery);
  add(shoppingQuery.replace(STYLE_WORDS, " "));
  if (designQuery) add(designQuery.replace(STYLE_WORDS, " "));

  return out;
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
