export type ShoppingIntent = {
  /** Cleaned text to send to Google Shopping. */
  searchQuery: string;
  /** Max price in whole dollars, if the user stated a budget. */
  maxPrice: number | null;
};

const PRICE_PATTERNS: RegExp[] = [
  /\b(?:under|below|less\s+than|at\s+most|no\s+more\s+than|up\s+to|upto|max(?:imum)?)\s*\$?\s*([\d,]+(?:\.\d+)?)/i,
  /\$\s*([\d,]+(?:\.\d+)?)\s*(?:or\s+less|max(?:imum)?|ceiling)?/i,
];

const FILLER_RE =
  /\b(i\s+want|i\s+need|i'?m\s+looking\s+for|looking\s+for|find\s+me|show\s+me|get\s+me|please|that'?s|that\s+is|with|a|an|the)\b/gi;

/**
 * Deterministic MVP parser for natural-language shopping requests.
 * Example: "I want a green couch that's under $500"
 * → { searchQuery: "green couch", maxPrice: 500 }
 */
export function parseShoppingQuery(query: string): ShoppingIntent {
  let text = query.trim();
  let maxPrice: number | null = null;

  for (const pattern of PRICE_PATTERNS) {
    const match = text.match(pattern);
    if (!match) continue;
    const amount = Number.parseFloat(match[1].replace(/,/g, ""));
    if (Number.isFinite(amount)) {
      maxPrice = amount;
      text = `${text.slice(0, match.index ?? 0)} ${text.slice(
        (match.index ?? 0) + match[0].length
      )}`;
      break;
    }
  }

  let searchQuery = text
    .replace(FILLER_RE, " ")
    .replace(/[?!.,]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!searchQuery) {
    searchQuery = query.trim();
  }

  return { searchQuery, maxPrice };
}
