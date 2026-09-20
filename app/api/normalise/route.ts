/**
 * /api/normalise — "a tall lamp" and "tall floor lamp" become the same string.
 *
 * POST { request, category?, roomType? } -> { request, category, silhouette, matched }
 * GET  ?q=a+tall+lamp                    -> the same body, for checking by hand
 *
 * WHY THIS EXISTS. Three things key off the category: the stand-in sprite's
 * cache (`sha256(category + palette + styleTags)`), the styled product search,
 * and the chip in the items strip. Free text gives you five spellings of the
 * same object across one demo, five cache misses, and five different chips.
 *
 * WHY IT IS A TABLE AND NOT A MODEL CALL. It is on the critical path of the
 * ask, it has to be right in front of a judge, and a lookup over the ten
 * silhouette categories answers in under a millisecond with the same answer
 * every time. A model call here would add a second of latency and a chance of
 * embarrassment, and buy nothing.
 *
 * It never fails. A body it cannot read still answers 200 with a sensible
 * category, because the demo must never dead-end on an ask.
 */

import type { NextRequest } from "next/server";

/** Shape of the answer, which components/AskInput.tsx reads directly. */
export type NormaliseResult = {
  /** the user's words, tidied for display: "a tall lamp" */
  request: string;
  /** the normalised category: "floor lamp" */
  category: string;
  /** which of the ten curated shapes backs it, or null */
  silhouette: Silhouette | null;
  /** false when nothing matched and we fell back */
  matched: boolean;
  /** true when the ask was empty and the room type chose for us */
  defaulted: boolean;
};

/** The ten shapes in public/silhouettes/. Same set lib/placeholder.ts draws. */
export type Silhouette =
  | "lamp"
  | "chair"
  | "table"
  | "rug"
  | "frame"
  | "plant"
  | "shelf"
  | "sofa"
  | "mirror"
  | "stool";

/* ------------------------------------------------------------------ table */

type Rule = {
  /** phrases that mean this category; matched whole-word, plural tolerated */
  phrases: string[];
  category: string;
  silhouette: Silhouette;
};

/**
 * Ordered most specific first. "coffee table" must be seen before "table", and
 * "desk lamp" before "desk", or the specific words are eaten by the general
 * ones. Within a family the general phrase is last and carries the family's
 * canonical name.
 */
const RULES: Rule[] = [
  /* lamps — every lighting word lands here */
  {
    phrases: [
      "floor lamp",
      "standing lamp",
      "tall lamp",
      "corner lamp",
      "torchiere",
      "uplighter",
      "arc lamp",
    ],
    category: "floor lamp",
    silhouette: "lamp",
  },
  {
    phrases: [
      "table lamp",
      "desk lamp",
      "bedside lamp",
      "nightstand lamp",
      "reading lamp",
      "small lamp",
    ],
    category: "table lamp",
    silhouette: "lamp",
  },
  {
    phrases: ["pendant", "ceiling light", "chandelier", "hanging light"],
    category: "pendant light",
    silhouette: "lamp",
  },
  {
    phrases: ["lamp", "light", "lighting", "lampshade"],
    category: "floor lamp",
    silhouette: "lamp",
  },

  /* mirrors — before frames, because "mirror" is often called wall art */
  {
    phrases: ["floor mirror", "full length mirror", "leaning mirror"],
    category: "floor mirror",
    silhouette: "mirror",
  },
  { phrases: ["mirror"], category: "mirror", silhouette: "mirror" },

  /* seating */
  { phrases: ["bar stool", "counter stool"], category: "bar stool", silhouette: "stool" },
  { phrases: ["ottoman", "footstool", "pouffe", "pouf"], category: "ottoman", silhouette: "stool" },
  { phrases: ["stool"], category: "stool", silhouette: "stool" },
  {
    phrases: ["sofa", "couch", "settee", "loveseat", "sectional"],
    category: "sofa",
    silhouette: "sofa",
  },
  {
    phrases: ["armchair", "arm chair", "accent chair", "reading chair", "lounge chair", "recliner"],
    category: "armchair",
    silhouette: "chair",
  },
  { phrases: ["dining chair"], category: "dining chair", silhouette: "chair" },
  { phrases: ["desk chair", "office chair"], category: "desk chair", silhouette: "chair" },
  { phrases: ["chair", "seat"], category: "armchair", silhouette: "chair" },

  /* tables and desks */
  { phrases: ["coffee table"], category: "coffee table", silhouette: "table" },
  {
    phrases: ["side table", "end table", "nightstand", "bedside table", "console table"],
    category: "side table",
    silhouette: "table",
  },
  { phrases: ["dining table"], category: "dining table", silhouette: "table" },
  { phrases: ["desk", "writing table"], category: "desk", silhouette: "table" },
  { phrases: ["table"], category: "side table", silhouette: "table" },

  /* soft furnishing */
  { phrases: ["runner"], category: "runner rug", silhouette: "rug" },
  { phrases: ["rug", "carpet", "mat", "kilim"], category: "area rug", silhouette: "rug" },

  /* walls */
  {
    phrases: [
      "framed picture",
      "framed print",
      "picture frame",
      "wall art",
      "artwork",
      "painting",
      "poster",
      "print",
      "frame",
      "photo",
    ],
    category: "framed picture",
    silhouette: "frame",
  },

  /* green things */
  {
    phrases: ["floor plant", "potted plant", "plant", "tree", "fern", "palm", "planter", "pot"],
    category: "potted plant",
    silhouette: "plant",
  },

  /* storage */
  {
    phrases: ["bookshelf", "bookcase", "book shelf"],
    category: "bookshelf",
    silhouette: "shelf",
  },
  {
    phrases: ["wall shelf", "floating shelf", "shelving", "shelf", "cabinet", "sideboard", "dresser"],
    category: "shelf",
    silhouette: "shelf",
  },
];

/** An empty ask still has to place something. The room chooses. */
const ROOM_DEFAULTS: Array<readonly [string, string, Silhouette]> = [
  ["bedroom", "table lamp", "lamp"],
  ["bed", "table lamp", "lamp"],
  ["dining", "dining chair", "chair"],
  ["kitchen", "bar stool", "stool"],
  ["office", "desk chair", "chair"],
  ["study", "bookshelf", "shelf"],
  ["hall", "mirror", "mirror"],
  ["entry", "mirror", "mirror"],
  ["bathroom", "mirror", "mirror"],
  ["nursery", "area rug", "rug"],
];

const FALLBACK_CATEGORY = "floor lamp";
const FALLBACK_SILHOUETTE: Silhouette = "lamp";

/* ------------------------------------------------------------------ match */

/**
 * Words that carry no category. Stripped before matching so "can I get a big
 * tall lamp please" and "lamp" take the same path.
 */
const FILLER =
  /\b(?:i|we|id|i'd|we'd|would|like|want|need|please|can|could|you|get|give|me|us|add|put|some|a|an|the|my|our|this|that|for|in|room|here|there|something|anything|maybe|really|very|nice|new)\b/g;

/** Turns whatever arrived into plain lowercase words. */
function tidy(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9' ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

/** Whole-word match, tolerating a trailing plural "s". */
function hasPhrase(text: string, phrase: string): boolean {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|\\s)${escaped}(?:s|es)?(?:\\s|$)`).test(text);
}

function matchRules(text: string): Rule | null {
  if (!text) return null;
  for (const rule of RULES) {
    for (const phrase of rule.phrases) {
      if (hasPhrase(text, phrase)) return rule;
    }
  }
  return null;
}

function defaultFor(roomType: string): { category: string; silhouette: Silhouette } {
  for (const [fragment, category, silhouette] of ROOM_DEFAULTS) {
    if (roomType.includes(fragment)) return { category, silhouette };
  }
  return { category: FALLBACK_CATEGORY, silhouette: FALLBACK_SILHOUETTE };
}

/**
 * The whole job, exported so a test or another route can call it without HTTP.
 * Pure, synchronous, and the same answer every time.
 */
export function normalise(
  request: unknown,
  category?: unknown,
  roomType?: unknown
): NormaliseResult {
  const spoken = typeof request === "string" ? request.trim().slice(0, 120) : "";
  // the category a caller already has is a hint, not an answer — a second ask
  // for the same object must land on the same string as the first
  const text = tidy(`${spoken} ${typeof category === "string" ? category : ""}`);
  const stripped = text.replace(FILLER, " ").replace(/\s+/g, " ").trim();

  if (!stripped) {
    const fallback = defaultFor(tidy(roomType));
    return {
      request: spoken || `a ${fallback.category}`,
      category: fallback.category,
      silhouette: fallback.silhouette,
      matched: false,
      defaulted: true,
    };
  }

  // the filler-stripped text first, then the raw text, so "a floor lamp" and
  // "floorlamp for the corner" cannot disagree
  const rule = matchRules(stripped) ?? matchRules(text);

  if (!rule) {
    // Unknown, but still worth naming on screen: the stand-in becomes a
    // rectangle carrying these words rather than nothing at all.
    return {
      request: spoken,
      category: stripped.slice(0, 40),
      silhouette: null,
      matched: false,
      defaulted: false,
    };
  }

  return {
    request: spoken || `a ${rule.category}`,
    category: rule.category,
    silhouette: rule.silhouette,
    matched: true,
    defaulted: false,
  };
}

/* ----------------------------------------------------------------- handlers */

const HEADERS = { "Cache-Control": "no-store" } as const;

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  return Response.json(
    normalise(params.get("q") ?? params.get("request"), params.get("category"), params.get("roomType")),
    { status: 200, headers: HEADERS }
  );
}

type Body = {
  request?: unknown;
  category?: unknown;
  roomType?: unknown;
};

export async function POST(request: Request) {
  let body: Body = {};
  try {
    body = (await request.json()) as Body;
  } catch {
    // an unreadable body is not a reason to stop the demo; it is a reason to
    // place the room's default object and let the user retype
    body = {};
  }

  return Response.json(normalise(body.request, body.category, body.roomType), {
    status: 200,
    headers: HEADERS,
  });
}
