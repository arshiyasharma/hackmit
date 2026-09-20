export type RoomContext = {
  palette?: string[];
  styleTags?: string[];
  lighting?: string;
  searchTerms?: string[];
};

const STOP_WORDS = new Set([
  "a",
  "an",
  "the",
  "with",
  "and",
  "or",
  "for",
  "in",
  "on",
  "to",
  "of",
  "give",
  "me",
  "color",
  "colours",
  "colors",
  "lighting",
  "focusing",
  "looking",
  "want",
  "need",
  "please",
  "this",
  "that",
  "room",
  "nook",
  "space",
  "warm",
  "cool",
  "neutral",
]);

/** Product-ish nouns — used to detect a specific shopping request vs a scene vibe. */
const PRODUCT_NOUNS = new Set([
  "lamp",
  "lamps",
  "chair",
  "chairs",
  "sofa",
  "sofas",
  "couch",
  "table",
  "tables",
  "desk",
  "desks",
  "rug",
  "rugs",
  "mirror",
  "mirrors",
  "chandelier",
  "blanket",
  "blankets",
  "throw",
  "vase",
  "vases",
  "plant",
  "plants",
  "shelf",
  "shelves",
  "bookcase",
  "ottoman",
  "dresser",
  "bed",
  "nightstand",
  "stool",
  "bench",
  "pillow",
  "pillows",
  "curtain",
  "curtains",
  "sconce",
  "frame",
]);

/** Significant words from text (for alignment / relevance checks). */
export function contentWords(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(
      (w) =>
        w.length > 2 && !STOP_WORDS.has(w) && !/^#?[0-9a-f]{3,8}$/i.test(w)
    );
}

/**
 * True when the searchTerm shares at least one content word with the design query.
 */
export function isSearchTermAligned(
  searchTerm: string,
  designQuery: string
): boolean {
  const queryWords = new Set(contentWords(designQuery));
  if (queryWords.size === 0) return true;
  return contentWords(searchTerm).some((w) => queryWords.has(w));
}

/**
 * True when the user typed a specific product request (e.g. "pink lamp")
 * rather than a scene vibe ("warm boho reading nook").
 */
export function isProductFocusedQuery(designQuery: string): boolean {
  const words = contentWords(designQuery);
  if (words.length === 0 || words.length > 5) return false;
  return words.some((w) => PRODUCT_NOUNS.has(w));
}

/**
 * Decide which searchTerms to fan out for.
 * - Specific product query with no overlapping terms → [] (use simple query path)
 * - Otherwise → up to `limit` terms (all of them for scene vibes)
 */
export function resolveSearchTermsForQuery(
  designQuery: string,
  roomContext?: RoomContext | null,
  limit = 3
): string[] {
  const terms = getSearchTerms(roomContext);
  if (terms.length === 0) return [];

  const aligned = terms.filter((t) => isSearchTermAligned(t, designQuery));

  // "pink lamp" + chair/rug/blanket → do NOT invent fake sections; search the lamp once.
  if (isProductFocusedQuery(designQuery) && aligned.length === 0) {
    return [];
  }

  // If the user named a product that overlaps some terms, only keep those.
  if (isProductFocusedQuery(designQuery) && aligned.length > 0) {
    return aligned.slice(0, limit);
  }

  // Scene / vibe query → each Gemini searchTerm is a product to find.
  return terms.slice(0, limit);
}

/**
 * Build a Shopping-oriented query for one furniture searchTerm.
 * Term is primary — avoid lighting/style suffixes that cause empty Google pages.
 */
export function buildContextualShoppingQuery(
  searchTerm: string,
  _roomContext?: RoomContext | null,
  _designQuery?: string | null
): string {
  return searchTerm.trim().replace(/\s+/g, " ");
}

/** Style-aware single-product shopping string (no searchTerm fanout). */
export function buildSimpleShoppingQuery(
  designQuery: string,
  roomContext?: RoomContext | null
): string {
  const scene = designQuery.trim().replace(/\s+/g, " ");
  if (!scene) return "";

  // One short style hint helps "lamp" escape a pink-only Elastic cache via Serp,
  // without the long suffixes that previously caused empty Google pages.
  const tag = (roomContext?.styleTags || [])
    .map((t) => (typeof t === "string" ? t.trim() : ""))
    .find((t) => t.length > 0 && t.split(/\s+/).length <= 3);

  if (!tag) return scene;

  // Use the last style token ("french romantic" → "romantic") when the tag is long.
  const hint = tag.split(/\s+/).slice(-1)[0]!;
  if (scene.toLowerCase().includes(hint.toLowerCase())) return scene;
  return `${scene} ${hint}`;
}

/** Keep products whose titles match the design query (e.g. pink + lamp). */
export function filterProductsByDesignQuery<
  T extends { title: string },
>(products: T[], designQuery: string): T[] {
  const words = contentWords(designQuery);
  if (words.length === 0) return products;

  const nouns = words.filter((w) => PRODUCT_NOUNS.has(w));
  const modifiers = words.filter((w) => !PRODUCT_NOUNS.has(w));

  return products.filter((p) => {
    const title = (p.title || "").toLowerCase();

    // Every product noun in the query must appear ("table" query ≠ only "lamp").
    if (nouns.length > 0 && !nouns.every((w) => title.includes(w))) {
      return false;
    }

    // Block cross-category collisions: "side table" must not match "table lamp"
    // when the query did not ask for a lamp (and vice versa).
    if (
      nouns.includes("table") &&
      !nouns.includes("lamp") &&
      !nouns.includes("lamps") &&
      /\blamps?\b/.test(title)
    ) {
      return false;
    }
    if (
      (nouns.includes("lamp") || nouns.includes("lamps")) &&
      !nouns.includes("table") &&
      /\btables?\b/.test(title) &&
      !/\btable\s+lamps?\b/.test(title)
    ) {
      // Allow "table lamp" titles for lamp queries; reject unrelated tables.
      if (!/\blamps?\b/.test(title)) return false;
    }

    if (modifiers.length === 0) {
      // Noun-only query (e.g. "sofa") — noun check above is enough.
      return nouns.length > 0
        ? true
        : words.some((w) => title.includes(w));
    }

    // Require a fair share of color/material modifiers ("pink", "oak", …).
    const modHits = modifiers.filter((w) => title.includes(w)).length;
    const needMods = Math.max(1, Math.ceil(modifiers.length * 0.5));
    return modHits >= needMods;
  });
}

const COLOR_WORDS = new Set([
  "pink",
  "rose",
  "blush",
  "red",
  "blue",
  "navy",
  "green",
  "yellow",
  "gold",
  "brass",
  "black",
  "white",
  "ivory",
  "cream",
  "brown",
  "beige",
  "gray",
  "grey",
  "purple",
  "orange",
  "teal",
  "silver",
]);

const COLOR_IN_TITLE_RE =
  /\b(pink|rose|blush|red|blue|navy|green|yellow|gold|brass|black|white|ivory|cream|brown|beige|gray|grey|purple|orange|teal|silver)\b/i;

/**
 * Prefer titles that don't force a color the user never asked for.
 * Stops a pink-lamp-heavy Elastic catalog from dominating plain "lamp" searches.
 */
export function diversifyProductsByQuery<T extends { title: string }>(
  products: T[],
  designQuery: string
): T[] {
  const askedColors = contentWords(designQuery).filter((w) =>
    COLOR_WORDS.has(w)
  );
  if (askedColors.length > 0) return products;

  const neutral = products.filter((p) => !COLOR_IN_TITLE_RE.test(p.title || ""));
  const colored = products.filter((p) => COLOR_IN_TITLE_RE.test(p.title || ""));
  return [...neutral, ...colored];
}

/** Broad one/two-word product queries should not trust Elastic cache alone. */
export function isBroadProductQuery(designQuery: string): boolean {
  const words = contentWords(designQuery);
  return words.length > 0 && words.length <= 2;
}

export function getSearchTerms(
  roomContext?: RoomContext | null
): string[] {
  if (!roomContext?.searchTerms || !Array.isArray(roomContext.searchTerms)) {
    return [];
  }
  return roomContext.searchTerms
    .filter((t): t is string => typeof t === "string")
    .map((t) => t.trim())
    .filter(Boolean);
}
