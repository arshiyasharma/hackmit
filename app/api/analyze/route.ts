import { GoogleGenAI } from "@google/genai";

import type { NextRequest } from "next/server";

import type { RoomContext } from "@/types";

/**
 * POST /api/analyze — read the room's STYLE and COLOUR PALETTE off one photo.
 *
 * This is the only model call in the product and the photo is read for nothing
 * else: no mask, no region, no geometry. In goes the captured still, out comes
 * a RoomContext whose `styleTags` are pasted straight into the product search.
 *
 * SO THE TAGS MUST BE SHOPPING WORDS. "traditional", "middle eastern",
 * "ornate", "warm wood" — words a person would type into a shop's search box.
 * "biophilic" and "transitional maximalism" are interior-design theory and
 * would return nothing, so they are asked against in the prompt and filtered
 * out here as well.
 *
 * IT NEVER BLOCKS AND IT NEVER 500s. No key, a refusal, a timeout, bad JSON —
 * every one of those answers 200 with a neutral palette, no style words and
 * source "fallback", and the strip on /room says the search will be generic.
 *
 * TWO PROVIDERS, tried in order, because the team has two keys in play:
 *   1. Gemini via @google/genai — the model call Arshiya committed in 52037d4
 *   2. gpt-4o-mini in JSON mode over the plain HTTP API, since the `openai`
 *      package is deliberately not a dependency
 * Whichever key exists wins; with neither, the answer is NEUTRAL.
 *
 * The body may be { dataUrl } (the capture screen) or { imageBase64 } (the
 * /generate page), and the response carries `searchTerms` alongside
 * `suggestions` so both callers read the field they expect.
 */

export const runtime = "nodejs";
export const maxDuration = 30;

const OPENAI_MODEL = "gpt-4o-mini";
const GEMINI_MODEL = "gemini-3.6-flash";
const ENDPOINT = "https://api.openai.com/v1/chat/completions";
const TIMEOUT_MS = 15_000;

/** A 1600px JPEG data URL is ~1 MB. Anything far past that is not our photo. */
const MAX_DATA_URL_CHARS = 12_000_000;

/** Warm neutrals. Used when we have nothing — never invented colours. */
const NEUTRAL_PALETTE = [
  "#FBFAF7",
  "#E6E1D9",
  "#C9C1B4",
  "#8A837A",
  "#2A2724",
];

const NEUTRAL: RoomContext = {
  styleTags: [],
  palette: NEUTRAL_PALETTE,
  lighting: "neutral",
  suggestions: ["a tall lamp", "a floor rug", "a side table", "a framed picture"],
  source: "fallback",
};

/** The frozen answer for ?demo=1 — expo insurance, not a silent mock. */
const FROZEN: RoomContext = {
  styleTags: ["traditional", "middle eastern", "ornate", "warm wood"],
  palette: ["#8C5A3B", "#C9A227", "#7A3B2E", "#E8DCC6", "#2E2A25"],
  lighting: "warm",
  roomType: "living room",
  suggestions: [
    "a tall lamp",
    "a floor rug",
    "a framed picture",
    "a side table",
  ],
  source: "model",
};

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/** Design-theory vocabulary. Useless in a search box, so it never ships. */
const BANNED_TAGS = new Set([
  "biophilic",
  "transitional",
  "maximalism",
  "maximalist",
  "minimalism",
  "eclectic",
  "juxtaposition",
  "curated",
  "layered",
  "aesthetic",
  "vibe",
  "cozy vibes",
  "interior design",
]);

const SYSTEM = [
  "You read one photo of a room and answer with JSON only.",
  "You are feeding a product search on Amazon, Walmart, IKEA and Etsy.",
  "Every style word you return is typed into that search box, so use plain",
  "shopping words: traditional, middle eastern, ornate, classic, warm wood,",
  "rattan, brass, mid century, farmhouse, industrial, scandinavian.",
  "Never use design-theory words such as biophilic, transitional, maximalism,",
  "eclectic or curated. Never describe the layout, the people or the mess.",
].join(" ");

const INSTRUCTION = [
  "Return JSON with exactly these keys:",
  '"styleTags": 3 to 5 lowercase shopping words describing the room\'s style and materials;',
  '"palette": exactly 5 hex colours like "#8C5A3B", ordered by how much of the room they cover;',
  '"lighting": one of "warm", "cool", "neutral";',
  '"roomType": two words at most, e.g. "living room";',
  '"suggestions": 4 short things this room could use, each phrased the way a person would ask,',
  'e.g. "a tall lamp", "a floor rug".',
].join(" ");

/* ------------------------------------------------------------------ parsing */

function strings(source: unknown, key: string, limit: number): string[] {
  if (!source || typeof source !== "object") return [];
  const value = (source as Record<string, unknown>)[key];
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
    .map((v) => v.trim())
    .slice(0, limit);
}

function text(source: unknown, key: string): string | undefined {
  if (!source || typeof source !== "object") return undefined;
  const value = (source as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** Everything the model sent that we can actually use; nothing else. */
function toRoomContext(raw: unknown): RoomContext | null {
  const palette = strings(raw, "palette", 5)
    .map((hex) => hex.toLowerCase())
    .filter((hex) => HEX.test(hex));
  if (palette.length < 3) return null;
  while (palette.length < 5) palette.push(NEUTRAL_PALETTE[palette.length]);

  const styleTags = strings(raw, "styleTags", 6)
    .map((tag) => tag.toLowerCase().replace(/[^a-z0-9 -]/g, "").trim())
    .filter((tag) => tag.length > 2 && tag.length < 24)
    .filter((tag) => !BANNED_TAGS.has(tag))
    .filter((tag, i, all) => all.indexOf(tag) === i)
    .slice(0, 5);

  const lighting = text(raw, "lighting")?.toLowerCase();

  // Gemini answers with searchTerms; the OpenAI prompt asks for suggestions
  const suggestions = [
    ...strings(raw, "suggestions", 4),
    ...strings(raw, "searchTerms", 5),
  ]
    .map((s) => s.toLowerCase())
    .filter((s, i, all) => all.indexOf(s) === i)
    .slice(0, 4);

  return {
    styleTags,
    palette,
    lighting:
      lighting === "warm" || lighting === "cool" ? lighting : "neutral",
    roomType: text(raw, "roomType")?.toLowerCase(),
    suggestions,
    source: "model",
  };
}

/* ------------------------------------------------------------------- calls */

/** Arshiya's call from 52037d4, mapped onto the RoomContext contract. */
async function readRoomGemini(
  dataUrl: string,
  key: string,
): Promise<RoomContext | null> {
  const [header, data] = dataUrl.split(",", 2);
  const mimeType = header.match(/^data:(image\/[a-zA-Z+.-]+);base64$/)?.[1];
  if (!mimeType || !data) return null;

  const ai = new GoogleGenAI({ apiKey: key });
  const response = await ai.models.generateContent({
    model: GEMINI_MODEL,
    contents: [
      {
        role: "user",
        parts: [
          { text: `${SYSTEM} ${INSTRUCTION}` },
          { inlineData: { mimeType, data } },
        ],
      },
    ],
    config: { responseMimeType: "application/json" },
  });

  try {
    return toRoomContext(JSON.parse(response.text ?? ""));
  } catch {
    return null;
  }
}

async function readRoomOpenAI(
  dataUrl: string,
  key: string,
): Promise<RoomContext | null> {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      // JSON mode: the answer is always parseable, so there is no regex here
      response_format: { type: "json_object" },
      temperature: 0.2,
      max_tokens: 300,
      messages: [
        { role: "system", content: SYSTEM },
        {
          role: "user",
          content: [
            { type: "text", text: INSTRUCTION },
            // "low" detail is one tile: enough for palette and style, cents a call
            { type: "image_url", image_url: { url: dataUrl, detail: "low" } },
          ],
        },
      ],
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!res.ok) return null;

  const payload: unknown = await res.json();
  const content =
    typeof payload === "object" && payload !== null
      ? (payload as { choices?: Array<{ message?: { content?: unknown } }> })
          .choices?.[0]?.message?.content
      : undefined;
  if (typeof content !== "string") return null;

  try {
    return toRoomContext(JSON.parse(content));
  } catch {
    return null;
  }
}

/** `searchTerms` keeps the /generate page reading the field it expects. */
function answer(context: RoomContext) {
  return Response.json({ ...context, searchTerms: context.suggestions ?? [] });
}

/* ------------------------------------------------------------------- route */

export async function POST(request: NextRequest) {
  if (request.nextUrl.searchParams.get("demo") === "1") {
    return answer(FROZEN);
  }

  let dataUrl: string | undefined;
  try {
    const body: unknown = await request.json();
    const candidate = text(body, "dataUrl") ?? text(body, "imageBase64");
    if (
      candidate &&
      candidate.startsWith("data:image/") &&
      candidate.length < MAX_DATA_URL_CHARS
    ) {
      dataUrl = candidate;
    }
  } catch {
    /* unreadable body — answer neutral, same as any other failure */
  }

  const gemini = process.env.GEMINI_API_KEY;
  const openai = process.env.OPENAI_API_KEY;
  if (!dataUrl || (!gemini && !openai)) return answer(NEUTRAL);

  try {
    const context = gemini
      ? ((await readRoomGemini(dataUrl, gemini)) ??
        (openai ? await readRoomOpenAI(dataUrl, openai) : null))
      : await readRoomOpenAI(dataUrl, openai as string);
    return answer(context ?? NEUTRAL);
  } catch {
    // timeout, network, refusal — the capture screen is already on /room
    return answer(NEUTRAL);
  }
}
