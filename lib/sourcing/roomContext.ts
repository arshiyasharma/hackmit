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
]);

/** Significant words from text (for alignment / relevance checks). */
export function contentWords(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w) && !/^#?[0-9a-f]{3,8}$/i.test(w));
}

/**
 * True when the searchTerm shares at least one content word with the design query.
 * Prevents "pink lamp" + "woven accent chair" from searching chairs.
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
 * Build a Shopping-oriented query.
 * Design `query` is the product intent. searchTerm is appended only when
 * it aligns with the query (shared words). Hex palette is omitted (hurts Shopping).
 *
 * Example:
 *   query "pink lamp", term "woven accent chair"
 *   → "pink lamp warm"
 *
 *   query "boho reading nook", term "leafy floor plant"
 *   → "boho reading nook warm leafy floor plant" (if plant/leafy overlap… else just scene)
 *   (plant doesn't overlap "boho reading nook" — so only scene + lighting)
 */
export function buildContextualShoppingQuery(
  searchTerm: string,
  roomContext?: RoomContext | null,
  designQuery?: string | null
): string {
  const term = searchTerm.trim().replace(/\s+/g, " ");
  const scene = (designQuery ?? "").trim().replace(/\s+/g, " ");
  const lighting = roomContext?.lighting?.trim().replace(/\s+/g, " ") || "";

  if (!scene) {
    return term;
  }

  const parts: string[] = [scene];

  if (lighting) {
    parts.push(lighting);
  }

  // Only add the furniture term when it doesn't fight the design query.
  if (term && isSearchTermAligned(term, scene)) {
    parts.push(term);
  }

  return parts.join(" ").replace(/\s+/g, " ").trim();
}

/** Keep products whose titles match the design query (e.g. pink + lamp). */
export function filterProductsByDesignQuery<
  T extends { title: string },
>(products: T[], designQuery: string): T[] {
  const words = contentWords(designQuery);
  if (words.length === 0) return products;

  return products.filter((p) => {
    const title = (p.title || "").toLowerCase();
    // Prefer all query words present; require at least the majority.
    const hits = words.filter((w) => title.includes(w)).length;
    return hits >= Math.max(1, Math.ceil(words.length * 0.6));
  });
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
