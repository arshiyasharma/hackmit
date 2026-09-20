import { colourNames } from "@/lib/colour";

export type RoomContext = {
  palette?: string[];
  picked?: string[];
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
  "armchair", "loveseat", "cabinet", "cabinets", "light", "lights",
  "plushie", "plushies", "plush", "bookshelf", "picture", "pictures",
  "art", "painting", "paintings", "cushion", "cushions",
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
  if (words.length === 0) return false;
  return words.some((w) => PRODUCT_NOUNS.has(w));
}

/**
 * Model suggestions supply object categories only. Their adjectives describe an
 * earlier photo read and must not bring deleted colours or styles back.
 */
export function productTermFromSuggestion(term: string): string {
  const phrase = cleanPhrase(term).toLowerCase();
  const compound = phrase.match(/\b(?:floor|table|desk|wall|ceiling|pendant) (?:lamps?|lights?)\b|\b(?:coffee|side|end|dining|console|bedside) tables?\b|\b(?:dining|accent|office) chairs?\b|\bbar stools?\b|\bthrow (?:pillows?|blankets?)\b|\b(?:area|runner) rugs?\b|\bwall shel(?:f|ves)\b|\bframed pictures?\b/);
  if (compound) return compound[0];
  return phrase.split(/[^a-z]+/).find((word) => PRODUCT_NOUNS.has(word)) ?? "";
}

/** A specific request always owns its wording; model terms only fan out scenes. */
export function resolveSearchTermsForQuery(
  designQuery: string,
  roomContext?: RoomContext | null,
  limit = 3
): string[] {
  if (isProductFocusedQuery(designQuery)) return [];
  return [...new Set(getSearchTerms(roomContext).map(productTermFromSuggestion).filter(Boolean))]
    .slice(0, limit);
}

const REQUEST_COLOURS = new Set([
  "pink", "rose", "blush", "red", "blue", "navy", "green", "yellow",
  "gold", "brass", "black", "white", "ivory", "cream", "brown", "beige",
  "gray", "grey", "purple", "orange", "teal", "silver", "charcoal", "tan",
  "walnut", "oak", "rust", "terracotta", "sage", "olive", "mustard", "burgundy",
  "maroon", "coral", "turquoise", "lavender", "lilac", "magenta", "cyan",
]);

function cleanPhrase(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

/** Explicit object colour/finish takes priority over inferred or picked colours. */
export function explicitColourNames(request: string): string[] {
  const words = request.toLowerCase().match(/[a-z]+/g) ?? [];
  const hexes = request.match(/#[a-f0-9]{6}\b|#[a-f0-9]{3}\b/gi) ?? [];
  return [...new Set([...words.filter((word) => REQUEST_COLOURS.has(word)), ...colourNames(hexes)])];
}

/** Current styles, without colour words that contradict an explicit request. */
export function stylesForRequest(roomContext: RoomContext | null | undefined, request: string): string[] {
  const explicit = explicitColourNames(request);
  return [...new Set((roomContext?.styleTags ?? []).map((tag) => {
    if (explicit.length === 0) return cleanPhrase(tag);
    return cleanPhrase(tag.replace(/\b[a-z]+\b/gi, (word) =>
      REQUEST_COLOURS.has(word.toLowerCase()) && !explicit.includes(word.toLowerCase()) ? "" : word));
  }).filter(Boolean))];
}

/**
 * Shared by the client and API: preserve complete style phrases, use the newest
 * two, and send one current picked colour (or the current dominant palette colour).
 * Empty edits stay empty. The person's explicit colour wins over room colours.
 */
export function buildSimpleShoppingQuery(
  designQuery: string,
  roomContext?: RoomContext | null
): string {
  const request = cleanPhrase(designQuery).replace(/^(?:a|an|the)\s+/i, "");
  if (!request) return "";
  const explicit = explicitColourNames(request);
  const scene = request.replace(/#[a-f0-9]{6}\b|#[a-f0-9]{3}\b/gi, (hex) => colourNames([hex])[0] ?? hex);
  const palette = roomContext?.palette ?? [];
  const picked = (roomContext?.picked ?? []).filter((hex) =>
    roomContext?.palette === undefined || palette.some((current) => current.toLowerCase() === hex.toLowerCase()));
  const colours = explicit.length ? [] : colourNames(picked.length ? picked : palette.slice(0, 1)).slice(-1);
  const tags = stylesForRequest(roomContext, request).slice(-2);
  const existing = ` ${scene.toLowerCase()} `;
  const hints = [...colours, ...tags].filter((hint, index, all) =>
    !existing.includes(` ${hint.toLowerCase()} `) && all.findIndex((other) => other.toLowerCase() === hint.toLowerCase()) === index);
  return [...hints, scene].join(" ");
}

/** A model suggestion names the object; only current context supplies its look. */
export function buildContextualShoppingQuery(
  searchTerm: string,
  roomContext?: RoomContext | null,
  designQuery?: string | null
): string {
  const object = productTermFromSuggestion(searchTerm);
  if (!object) return "";
  const explicit = explicitColourNames(designQuery ?? "");
  return buildSimpleShoppingQuery([...explicit, object].join(" "), roomContext);
}

/**
 * Reduce a word to something a retailer title will actually contain.
 * plushie -> plush, vases -> vas(e), bunnies -> bunn(y), lamps -> lamp.
 */
function stem(word: string): string {
  if (word.length > 5 && word.endsWith("ies")) return word.slice(0, -3);
  if (word.length > 4 && (word.endsWith("es") || word.endsWith("ie"))) {
    return word.slice(0, -2);
  }
  if (word.length > 3 && word.endsWith("s")) return word.slice(0, -1);
  return word;
}

function titleHas(title: string, word: string): boolean {
  return title.includes(word) || title.includes(stem(word));
}


const EXPLICIT_DESCRIPTORS = new Set([...REQUEST_COLOURS, "leather", "velvet"]);

/**
 * Keep products whose titles match the design query (e.g. pink + lamp).
 *
 * WHAT YOU ASKED FOR IS NOT ALWAYS IN THE FURNITURE LIST. "plushie" is not in
 * PRODUCT_NOUNS, so it was treated as a modifier, and a modifier had to appear
 * in the title verbatim. Google answers a plushie search with "Squishmallows
 * 16in Plush" and "Jellycat Bashful Bunny" — not one of them says plushie — so
 * every listing was dropped and the room reported an empty shop about a page
 * full of plushies.
 *
 * So when the list recognises nothing, the LAST content word is taken as the
 * thing being asked for, because an English noun phrase puts its head at the
 * end: "a tall plushie" is a plushie. And matching runs on a stem, so plushie
 * finds plush and vases finds vase.
 */
export function filterProductsByDesignQuery<
  T extends { title: string },
>(products: T[], designQuery: string): T[] {
  const words = contentWords(designQuery);
  if (words.length === 0) return products;

  const known = words.filter((w) => PRODUCT_NOUNS.has(w));
  const nouns = known.length > 0 ? known : [words[words.length - 1]!];
  const modifiers = words.filter((w) => !nouns.includes(w));

  return products.filter((p) => {
    const title = (p.title || "").toLowerCase();

    // Every product noun in the query must appear ("table" query ≠ only "lamp").
    if (!nouns.every((w) => titleHas(title, w))) {
      return false;
    }

    // Explicit colors/materials and lamp form factors belong to the request,
    // not to optional room styling. Do not silently trade brass for green.
    if (!words.filter((word) => EXPLICIT_DESCRIPTORS.has(word)).every((word) => titleHas(title, word))) return false;
    if (nouns.some((word) => word === "lamp" || word === "lamps")) {
      if (words.includes("floor") && !/\bfloor[\s/-]+(?:standing[\s/-]+)?(?:reading[\s/-]+)?lamps?\b|\bstanding\s+(?:tall\s+)?lamps?\b/.test(title)) return false;
      if (!words.some((word) => /^(?:shade|lampshade|bulb)s?$/.test(word)) &&
          /\b(?:floor|table)\s+lamp\s*shades?\b|\b(?:replacement|shade[- ]only|lampshade[- ]only)\b|\blamp\s*shades?\b.*\bfor\b.*\blamps?\b|\blight\s+bulbs?\b/.test(title)) return false;
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

    // Noun-only query (e.g. "sofa") — the noun check above is enough.
    if (modifiers.length === 0) return true;

    // Require a fair share of color/material modifiers ("pink", "oak", …).
    const modHits = modifiers.filter((w) => titleHas(title, w)).length;
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
