/**
 * The placeholder sprite pipeline.
 *
 * Room context plus a category in; ONE cutout PNG out, on a genuinely
 * transparent background, trimmed so its bounding box IS the object.
 *
 * THE TRIM IS NOT COSMETIC. components/PlaceholderSprite.tsx scales the plane
 * from the linked listing's real height in millimetres and derives the width
 * from `widthRatio`. Padding left inside the PNG becomes invisible padding
 * around the sprite, which makes a 1,500 mm lamp stand 1,800 mm tall in the
 * room. Every exit from this module returns a trimmed image or nothing.
 *
 * Three paths, in order of preference:
 *   1. GENERATED  — the Higgsfield CLI draws the object in the room's palette.
 *   2. SILHOUETTE — one of the ten curated flat SVGs in public/silhouettes/,
 *                   tinted from the palette. Used when generation fails, the
 *                   credits run out, or generation is switched off.
 *   3. UNKNOWN    — a neutral rounded rectangle at 1:1 carrying the category
 *                   name. Used when the category matches no silhouette.
 * There is no fourth path where we return nothing.
 *
 * SERVER ONLY. The Higgsfield CLI is authenticated on this machine and is
 * spawned as a child process; nothing here may be imported into a client
 * component.
 */

import { createHash } from "node:crypto";

import { colourNames } from "@/lib/colour";
import { fetchPublicImage } from "@/lib/remoteImage";
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import sharp from "sharp";

/* --------------------------------------------------------------- contract */

/**
 * LOCAL COPY. Prompt 0 is adding this to types/index.ts in another agent's
 * run. When it lands, delete this and `import type { RoomContext } from
 * "@/types"` instead — the shape is identical on purpose.
 */
export type RoomContext = {
  /** the vocabulary a shopping search would use: "traditional", "ornate" */
  styleTags: string[];
  /** up to five hex strings, ordered by dominance */
  palette: string[];
  lighting: "warm" | "cool" | "neutral";
  /** the colours the USER chose: an instruction about the object itself */
  picked?: string[];
};

/** Where the returned image came from. Drives nothing but honesty copy. */
export type PlaceholderSource = "generated" | "silhouette" | "unknown";

export type PlaceholderResult = {
  /** fetchable by the browser and by three.js TextureLoader */
  url: string;
  /** natural width over height AFTER the trim */
  widthRatio: number;
  /** the normalised category this image was drawn for */
  category: string;
  source: PlaceholderSource;
  /** true when this answer came off disk without generating anything */
  cached: boolean;
};

export type PlaceholderInput = {
  /** normalised where possible, e.g. "floor lamp" */
  category: string;
  roomContext?: Partial<RoomContext> | null;
  /** what the user actually typed, used only to sharpen normalisation */
  request?: string | null;
};

/* ------------------------------------------------------------ silhouettes */

/** The ten curated shapes in public/silhouettes/. */
export const SILHOUETTE_KEYS = [
  "lamp",
  "chair",
  "table",
  "rug",
  "frame",
  "plant",
  "shelf",
  "sofa",
  "mirror",
  "stool",
] as const;

export type SilhouetteKey = (typeof SILHOUETTE_KEYS)[number];

/**
 * The aspect ratio we ask the generator for. A floor lamp wants a tall frame
 * and a rug wants a wide one, so the object fills the pixels we pay for.
 * The trim decides the final ratio regardless; this only buys resolution.
 */
/** Anything we have no shape for is drawn square; it could be any proportion. */
const UNKNOWN_ASPECT = "1:1";

const GENERATION_ASPECT: Record<SilhouetteKey, string> = {
  lamp: "2:3",
  chair: "1:1",
  table: "3:2",
  rug: "3:2",
  frame: "3:4",
  plant: "2:3",
  shelf: "3:4",
  sofa: "3:2",
  mirror: "2:3",
  stool: "1:1",
};

/**
 * Word fragments that resolve a free-text request to one of the ten shapes.
 * Longer, more specific fragments are matched first so "coffee table" does not
 * get caught by "table" before "side table" has had a look at it — in practice
 * both land on `table`, but the ordering matters for "floor lamp" vs "floor".
 */
const CATEGORY_ALIASES: ReadonlyArray<readonly [string, SilhouetteKey]> = [
  ["floor lamp", "lamp"],
  ["table lamp", "lamp"],
  ["standing lamp", "lamp"],
  ["pendant", "lamp"],
  ["sconce", "lamp"],
  ["lantern", "lamp"],
  ["lighting", "lamp"],
  ["light", "lamp"],
  ["lamp", "lamp"],
  ["armchair", "chair"],
  ["accent chair", "chair"],
  ["dining chair", "chair"],
  ["seat", "chair"],
  ["chair", "chair"],
  ["coffee table", "table"],
  ["side table", "table"],
  ["end table", "table"],
  ["console", "table"],
  ["desk", "table"],
  ["nightstand", "table"],
  ["table", "table"],
  ["carpet", "rug"],
  ["runner", "rug"],
  ["mat", "rug"],
  ["kilim", "rug"],
  ["rug", "rug"],
  ["framed picture", "frame"],
  ["framed print", "frame"],
  ["wall art", "frame"],
  ["painting", "frame"],
  ["poster", "frame"],
  ["artwork", "frame"],
  ["picture", "frame"],
  ["frame", "frame"],
  ["houseplant", "plant"],
  ["potted plant", "plant"],
  ["planter", "plant"],
  ["fern", "plant"],
  ["palm", "plant"],
  ["tree", "plant"],
  ["plant", "plant"],
  ["bookshelf", "shelf"],
  ["bookcase", "shelf"],
  ["shelving", "shelf"],
  ["cabinet", "shelf"],
  ["sideboard", "shelf"],
  ["dresser", "shelf"],
  ["shelf", "shelf"],
  ["sectional", "sofa"],
  ["loveseat", "sofa"],
  ["couch", "sofa"],
  ["settee", "sofa"],
  ["sofa", "sofa"],
  ["mirror", "mirror"],
  ["ottoman", "stool"],
  ["pouf", "stool"],
  ["footstool", "stool"],
  ["bench", "stool"],
  ["stool", "stool"],
];

/** Fallback silhouette when the user submits nothing at all. */
const DEFAULT_CATEGORY = "floor lamp";

/**
 * Normalise "a tall lamp" and "tall floor lamp" to the same strings, so the
 * cache key, the generation prompt and the search query all agree.
 *
 * Returns the tidy category text plus the silhouette that backs it, or null
 * when nothing matches — the caller then draws the neutral rectangle.
 */
export function normalizeCategory(
  raw: string | null | undefined,
  request?: string | null,
): { category: string; silhouette: SilhouetteKey | null } {
  const text = `${(raw ?? "").slice(0, 120)} ${(request ?? "").slice(0, 120)}`
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!text) {
    return { category: DEFAULT_CATEGORY, silhouette: "lamp" };
  }

  for (const [fragment, key] of CATEGORY_ALIASES) {
    if (text.includes(fragment)) {
      // "a tall lamp" -> "floor lamp"; "coffee table" keeps its own words.
      const category = fragment === key ? canonicalName(key) : fragment;
      return { category, silhouette: key };
    }
  }

  // Unknown, but still worth naming on screen. Trim it to something printable.
  const cleaned = (raw ?? request ?? "").trim().replace(/\s+/g, " ").slice(0, 40);
  return { category: cleaned || DEFAULT_CATEGORY, silhouette: null };
}

function canonicalName(key: SilhouetteKey): string {
  switch (key) {
    case "lamp":
      return "floor lamp";
    case "table":
      return "side table";
    case "frame":
      return "framed picture";
    case "plant":
      return "potted plant";
    case "shelf":
      return "bookshelf";
    default:
      return key;
  }
}

/* ------------------------------------------------------------ sanitisation */

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/** Five hex strings at most, anything else dropped rather than repaired. */
export function cleanPalette(palette: unknown): string[] {
  if (!Array.isArray(palette)) return [];
  return palette
    .filter((c): c is string => typeof c === "string")
    .map((c) => c.trim().toLowerCase())
    .filter((c) => HEX.test(c))
    .slice(0, 5);
}

/**
 * Style tags go straight into a prompt sent to a generation service, so they
 * are stripped to plain words. Nothing here should ever be able to carry an
 * instruction.
 */
export function cleanStyleTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [];
  return tags
    .filter((t): t is string => typeof t === "string")
    .map((t) =>
      t
        .toLowerCase()
        .replace(/[^a-z0-9 -]+/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 28),
    )
    .filter(Boolean)
    .slice(0, 6);
}

/** Same treatment for the category, which also reaches the prompt. */
function cleanCategoryForPrompt(category: string): string {
  return category
    .toLowerCase()
    .replace(/[^a-z0-9 -]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 48);
}

/* --------------------------------------------------------------- the prompt */

/**
 * Built from the room context, never from a fixed string.
 *
 * "plain white background, no shadow" is load-bearing: the background is about
 * to be keyed out, and a generated drop shadow survives the key-out as a grey
 * smear that reads as broken against a camera feed.
 */
export function buildPrompt(category: string, ctx: RoomContext): string {
  const cat = cleanCategoryForPrompt(category) || DEFAULT_CATEGORY;
  const style = ctx.styleTags.length ? ctx.styleTags.join(", ") : "plain modern";

  /*
   * A PICKED COLOUR IS AN INSTRUCTION, NOT CONTEXT.
   *
   * Someone who opens the picker and chooses sage is saying "make it sage" —
   * so those colours describe THE OBJECT, first, by name and by hex, and they
   * are repeated at the end because an image model weights the start and the
   * end of a prompt hardest. The colours merely read off the photo stay what
   * they always were: the room around it, mentioned once, so the object sits
   * in the room without being painted in all five of them.
   */
  /*
   * WITH NOTHING PICKED, THE ROOM STILL CHOOSES.
   *
   * Only hand-picked colours reached this prompt, and most people never open
   * the picker — so the drawing came back in whatever colours the model felt
   * like, in a room whose own palette we had just read off the photo. The
   * dominant colour now stands in for a pick, so the object always belongs to
   * the room it is standing in. A real pick still overrides it.
   */
  const picked = (ctx.picked ?? []).filter(Boolean);
  const chosen = picked.length > 0 ? picked : ctx.palette.slice(0, 1);
  const names = colourNames(chosen);
  const object = names.length
    ? `${names.join(" and ")} (${chosen.join(", ")}) ${cat}`
    : cat;

  const room = ctx.palette.length
    ? ctx.palette.filter((hex) => !chosen.includes(hex)).join(", ")
    : "";

  return [
    `A single ${object}, centred, full object in frame, front three-quarter view,`,
    `simple illustrative style with soft flat shading,`,
    names.length
      ? `the ${cat} itself is ${names.join(" and ")};`
      : "",
    room ? `it sits in a room whose colours are ${room};` : "",
    `${style} character, on a plain white background, no room, no floor,`,
    `no shadow, no text, no people.`,
    names.length ? `The ${cat} must be ${names.join(" and ")}.` : "",
  ]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ");
}

/**
 * The cache key. Same category in the same room must never regenerate — you
 * will ask for "a tall lamp" a dozen times while rehearsing and every one of
 * them costs real credits.
 */
export function cacheKeyFor(
  category: string,
  palette: string[],
  styleTags: string[],
): string {
  return createHash("sha256")
    .update(`${category}|${palette.join()}|${styleTags.join()}`)
    .digest("hex");
}

/* ------------------------------------------------------------------- cache */

const CACHE_DIR =
  process.env.PLACEHOLDER_CACHE_DIR ??
  path.join(process.cwd(), ".placeholder-cache");

export type CacheEntry = {
  widthRatio: number;
  category: string;
  source: PlaceholderSource;
  width: number;
  height: number;
  createdAt: number;
};

const KEY_RE = /^[0-9a-f]{64}$/;

function pngPath(key: string) {
  return path.join(CACHE_DIR, `${key}.png`);
}

function metaPath(key: string) {
  return path.join(CACHE_DIR, `${key}.json`);
}

/** Content-addressed, so the URL never needs busting. */
export function urlForKey(key: string): string {
  return `/api/placeholder?key=${key}`;
}

async function readCacheEntry(key: string): Promise<CacheEntry | null> {
  if (!KEY_RE.test(key)) return null;
  try {
    const raw = await readFile(metaPath(key), "utf8");
    const parsed = JSON.parse(raw) as CacheEntry;
    if (typeof parsed?.widthRatio !== "number" || !(parsed.widthRatio > 0)) {
      return null;
    }
    if (!existsSync(pngPath(key))) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function writeCacheEntry(key: string, png: Buffer, entry: CacheEntry) {
  await mkdir(CACHE_DIR, { recursive: true });
  // The PNG lands before the manifest, so a half-written pair never reads as a
  // hit: readCacheEntry needs the manifest, and the manifest is written last.
  await writeFile(pngPath(key), png);
  await writeFile(metaPath(key), JSON.stringify(entry));
}

/** Used by the route's GET to serve a cached sprite. */
export async function readCachedPng(
  key: string,
): Promise<{ png: Buffer; entry: CacheEntry } | null> {
  const entry = await readCacheEntry(key);
  if (!entry) return null;
  try {
    return { png: await readFile(pngPath(key)), entry };
  } catch {
    return null;
  }
}

/* ------------------------------------------------------- the sharp pipeline */

/** Anything at least this bright in every channel is candidate background. */
const KEY_SOFT = 200;
/** Anything at least this bright is background outright, alpha 0. */
const KEY_HARD = 236;
/** Below this alpha a pixel does not count towards the bounding box. */
const ALPHA_FLOOR = 8;

type Cutout = { png: Buffer; width: number; height: number; keyedRatio: number };

/**
 * Key a flat white background out to transparent, then trim.
 *
 * FLOOD FILL FROM THE BORDER, not a global threshold. A global threshold eats
 * the white inlay panels inside an ornate lamp and leaves it full of holes.
 * Only white that is reachable from the edge of the frame is background.
 *
 * Edge pixels get partial alpha and are un-premultiplied against white, which
 * is what stops the white fringe you otherwise see against a dark room.
 */
export async function keyOutAndTrim(input: Buffer): Promise<Cutout | null> {
  const { data, info } = await sharp(input, { limitInputPixels: 16_000_000 })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const W = info.width;
  const H = info.height;
  const C = info.channels;
  if (!W || !H || C < 4) return null;

  const N = W * H;
  const outside = new Uint8Array(N);
  const stack: number[] = [];

  const visit = (i: number) => {
    if (outside[i]) return;
    const p = i * C;
    if (data[p + 3] < ALPHA_FLOOR) {
      // already transparent; still background, but nothing to spread from
      outside[i] = 1;
      return;
    }
    if (Math.min(data[p], data[p + 1], data[p + 2]) < KEY_SOFT) return;
    outside[i] = 1;
    stack.push(i);
  };

  for (let x = 0; x < W; x++) {
    visit(x);
    visit((H - 1) * W + x);
  }
  for (let y = 0; y < H; y++) {
    visit(y * W);
    visit(y * W + W - 1);
  }
  while (stack.length) {
    const i = stack.pop() as number;
    const x = i % W;
    const y = (i - x) / W;
    if (x > 0) visit(i - 1);
    if (x < W - 1) visit(i + 1);
    if (y > 0) visit(i - W);
    if (y < H - 1) visit(i + W);
  }

  let minX = W;
  let minY = H;
  let maxX = -1;
  let maxY = -1;
  let keyed = 0;

  const ramp = KEY_HARD - KEY_SOFT + 1;

  for (let i = 0; i < N; i++) {
    const p = i * C;
    if (outside[i]) {
      keyed++;
      const m = Math.min(data[p], data[p + 1], data[p + 2]);
      let a = m >= KEY_HARD ? 0 : (KEY_HARD - m) / ramp;
      if (a < 0) a = 0;
      if (a > 1) a = 1;
      if (a <= 0.02) {
        data[p] = 0;
        data[p + 1] = 0;
        data[p + 2] = 0;
        data[p + 3] = 0;
      } else {
        for (let c = 0; c < 3; c++) {
          const v = (data[p + c] - 255 * (1 - a)) / a;
          data[p + c] = v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
        }
        data[p + 3] = Math.round(a * 255);
      }
    }
    if (data[p + 3] > ALPHA_FLOOR) {
      const x = i % W;
      const y = (i - x) / W;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }

  if (maxX < minX || maxY < minY) return null;

  const width = maxX - minX + 1;
  const height = maxY - minY + 1;

  const png = await sharp(data, { raw: { width: W, height: H, channels: C } })
    .extract({ left: minX, top: minY, width, height })
    .png({ compressionLevel: 9 })
    .toBuffer();

  return { png, width, height, keyedRatio: keyed / N };
}

/* ----------------------------------------------------------------- tinting */

function hexToRgb(hex: string): [number, number, number] | null {
  let h = hex.replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (h.length === 8) h = h.slice(0, 6);
  if (h.length !== 6) return null;
  const n = Number.parseInt(h, 16);
  if (Number.isNaN(n)) return null;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex([r, g, b]: [number, number, number]): string {
  const c = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

function luminance(rgb: [number, number, number]): number {
  return (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255;
}

/** Our one accent. Used when the palette has nothing usable in it. */
const ACCENT = "#c97b5f";

/**
 * The silhouette's fill colour: the palette's dominant colour, unless it is so
 * pale or so dark that the shape would disappear. A near-white wall swatch is
 * genuinely dominant in most room photos and makes a useless sprite, so we walk
 * down the palette for the first colour with usable mid-tone luminance and fall
 * back to the accent if there is none.
 */
export function tintFromPalette(palette: string[]): string {
  const parsed = palette
    .map((h) => ({ hex: h, rgb: hexToRgb(h) }))
    .filter((p): p is { hex: string; rgb: [number, number, number] } => !!p.rgb);
  if (!parsed.length) return ACCENT;
  const usable = parsed.find((p) => {
    const l = luminance(p.rgb);
    return l > 0.14 && l < 0.8;
  });
  // An all-white or all-black palette has nothing to tint with, and shading a
  // white silhouette gives a white silhouette. Take the accent instead.
  return usable ? usable.hex : ACCENT;
}

function shade(hex: string, factor: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  return rgbToHex([rgb[0] * factor, rgb[1] * factor, rgb[2] * factor]);
}

/* ------------------------------------------------- silhouette + unknown art */

/** The two hex values written into every file in public/silhouettes/. */
const SVG_MAIN = "#C97B5F";
const SVG_DETAIL = "#2A2724";

/** Rasterised height for fallback art. Plenty for a phone-sized sprite. */
const FALLBACK_HEIGHT = 1024;

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

async function renderSilhouette(
  key: SilhouetteKey,
  tint: string,
): Promise<Buffer> {
  const file = path.join(process.cwd(), "public", "silhouettes", `${key}.svg`);
  const svg = await readFile(file, "utf8");
  const tinted = svg
    .split(SVG_MAIN)
    .join(tint)
    .split(SVG_DETAIL)
    .join(shade(tint, 0.42));
  return sharp(Buffer.from(tinted), { density: 384 })
    .resize({ height: FALLBACK_HEIGHT, fit: "inside", withoutEnlargement: false })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

/**
 * Category unknown: a neutral rounded rectangle at 1:1 with the category name
 * on it. Never nothing — a missing sprite reads as a crash, a named rectangle
 * reads as "we do not have a drawing for this yet".
 */
async function renderUnknown(category: string, tint: string): Promise<Buffer> {
  const label = escapeXml(category.slice(0, 22));
  // The label is the tint itself, not a shade of it: this rectangle has to be
  // readable over a bright window and over a dark corner of the same room.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
<rect x="24" y="24" width="464" height="464" rx="56" fill="${tint}" fill-opacity="0.2" stroke="${tint}" stroke-width="12"/>
<text x="256" y="270" text-anchor="middle" font-family="Instrument Sans, Helvetica Neue, Helvetica, Arial, sans-serif" font-size="46" font-weight="600" fill="${tint}">${label}</text>
</svg>`;
  return sharp(Buffer.from(svg), { density: 384 })
    .resize({ height: FALLBACK_HEIGHT, fit: "inside" })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

/** Trim rasterised art to its own alpha bounds, same rule as the cutout. */
async function trimAlpha(input: Buffer): Promise<Cutout | null> {
  const { data, info } = await sharp(input, { limitInputPixels: 16_000_000 })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const W = info.width;
  const H = info.height;
  const C = info.channels;
  if (!W || !H || C < 4) return null;

  let minX = W;
  let minY = H;
  let maxX = -1;
  let maxY = -1;
  for (let i = 0; i < W * H; i++) {
    if (data[i * C + 3] > ALPHA_FLOOR) {
      const x = i % W;
      const y = (i - x) / W;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < minX || maxY < minY) return null;

  const width = maxX - minX + 1;
  const height = maxY - minY + 1;
  const png = await sharp(data, { raw: { width: W, height: H, channels: C } })
    .extract({ left: minX, top: minY, width, height })
    .png({ compressionLevel: 9 })
    .toBuffer();
  return { png, width, height, keyedRatio: 1 };
}

/* --------------------------------------------------------- the generator CLI */

/**
 * The Higgsfield CLI is authenticated on this machine. Resolve it next to the
 * Node binary running the server first — that is where nvm puts it — then the
 * usual places, then whatever is on PATH.
 */
function resolveCli(): string {
  const candidates = [
    process.env.HIGGSFIELD_BIN,
    path.join(path.dirname(process.execPath), "higgsfield"),
    path.join(os.homedir(), ".local", "bin", "higgsfield"),
    "/opt/homebrew/bin/higgsfield",
    "/usr/local/bin/higgsfield",
  ].filter((c): c is string => !!c);
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return "higgsfield";
}

const GENERATION_MODEL = process.env.PLACEHOLDER_MODEL ?? "gpt_image_2_5";
const GENERATION_TIMEOUT_MS = Number(
  process.env.PLACEHOLDER_TIMEOUT_MS ?? 210_000,
);

function generationEnabled(): boolean {
  return process.env.PLACEHOLDER_DISABLE_GENERATION !== "1";
}

/** Pull the first JSON array or object out of noisy CLI stdout. */
function extractJson(stdout: string): unknown {
  const start = stdout.search(/[[{]/);
  if (start < 0) return null;
  const open = stdout[start];
  const close = open === "[" ? "]" : "}";
  const end = stdout.lastIndexOf(close);
  if (end <= start) return null;
  try {
    return JSON.parse(stdout.slice(start, end + 1));
  } catch {
    return null;
  }
}

function runCli(args: string[], timeoutMs: number, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    // No shell. Every argument is passed as its own argv entry, so nothing the
    // user typed can be read as a command even if sanitisation is loosened.
    const child = spawn(resolveCli(), args, {
      stdio: ["ignore", "pipe", "pipe"],
      signal,
    });
    let out = "";
    let err = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      reject(new Error(`higgsfield timed out after ${timeoutMs} ms`));
    }, timeoutMs);

    child.stdout.on("data", (d: Buffer) => {
      out += d.toString();
    });
    child.stderr.on("data", (d: Buffer) => {
      err += d.toString();
    });
    child.on("error", (e) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(`higgsfield exited ${code}: ${err.trim() || out.trim()}`));
    });
  });
}

type CliJob = { status?: string; result_url?: string; min_result_url?: string };

/** Run one generation and hand back the finished PNG bytes. */
async function generate(
  prompt: string,
  aspect: string,
  signal?: AbortSignal,
): Promise<Buffer> {
  const stdout = await runCli(
    [
      "generate",
      "create",
      GENERATION_MODEL,
      "--prompt",
      prompt,
      "--aspect_ratio",
      aspect,
      "--quality",
      process.env.PLACEHOLDER_QUALITY ?? "medium",
      "--resolution",
      "1k",
      "--wait",
      "--wait-timeout",
      "3m",
      "--json",
    ],
    GENERATION_TIMEOUT_MS,
    signal,
  );

  const parsed = extractJson(stdout);
  const jobs: CliJob[] = Array.isArray(parsed)
    ? (parsed as CliJob[])
    : parsed
      ? [parsed as CliJob]
      : [];
  const done = jobs.find((j) => j.result_url);
  if (!done?.result_url) {
    throw new Error("higgsfield returned no image");
  }
  if (done.status && done.status !== "completed") {
    throw new Error(`higgsfield job status ${done.status}`);
  }

  const bytes = await fetchPublicImage(done.result_url, signal);
  if (!bytes) throw new Error("Could not download the generated image");
  return bytes;
}

/**
 * After a failure, stop trying for a while. Otherwise four items placed in a
 * row while the credits are out spawns four CLI processes that each take three
 * minutes to fail, and the whole screen sits on skeletons.
 */
const FAILURE_COOLDOWN_MS = 60_000;
let generationBlockedUntil = 0;

/* -------------------------------------------------------------- the entry */

const inflight = new Map<string, Promise<PlaceholderResult>>();

/**
 * Room context plus a category in, one trimmed cutout out. Always resolves;
 * the only way this throws is a filesystem that will not accept writes, and
 * even then the caller has a silhouette path that does not need the disk.
 */
export async function resolvePlaceholder(
  input: PlaceholderInput,
  signal?: AbortSignal,
): Promise<PlaceholderResult> {
  const { category, silhouette } = normalizeCategory(input.category, input.request);
  const palette = cleanPalette(input.roomContext?.palette);
  const styleTags = cleanStyleTags(input.roomContext?.styleTags);
  const picked = cleanPalette(input.roomContext?.picked);
  const lighting = input.roomContext?.lighting ?? "neutral";
  const ctx: RoomContext = { palette, styleTags, lighting, picked };

  // picked colours change the object itself, so they change the image
  const key = cacheKeyFor(category, [...palette, ...picked], styleTags);

  const hit = await readCacheEntry(key);
  if (hit) {
    return {
      url: urlForKey(key),
      widthRatio: hit.widthRatio,
      category: hit.category,
      source: hit.source,
      cached: true,
    };
  }

  const running = inflight.get(key);
  if (running) return running;

  const job = (async (): Promise<PlaceholderResult> => {
    const tint = tintFromPalette(palette);

    /*
     * 1. Generated — FOR ANY OBJECT, not only the ten we drew silhouettes for.
     *
     * This used to require `silhouette`, so "a disco ball" or "a brass
     * telescope" skipped generation entirely and stood in the room as the
     * unknown grey rectangle, while "a tall lamp" got a picture. The silhouette
     * is a FALLBACK, not a licence: all it contributes here is a sensible
     * aspect ratio, and an unknown object gets a square one.
     */
    if (generationEnabled() && Date.now() >= generationBlockedUntil) {
      try {
        const raw = await generate(
          buildPrompt(category, ctx),
          silhouette ? GENERATION_ASPECT[silhouette] : UNKNOWN_ASPECT,
          signal,
        );
        const cut = await keyOutAndTrim(raw);
        // keyedRatio tells us whether there was a white background at all. A
        // generation that came back as a full-bleed scene would key out to
        // nothing and stand in the room as an opaque rectangle, which is worse
        // than a silhouette, so it is treated as a failure.
        if (cut && cut.keyedRatio > 0.05 && cut.width > 8 && cut.height > 8) {
          const widthRatio = cut.width / cut.height;
          await writeCacheEntry(key, cut.png, {
            widthRatio,
            category,
            source: "generated",
            width: cut.width,
            height: cut.height,
            createdAt: Date.now(),
          });
          return {
            url: urlForKey(key),
            widthRatio,
            category,
            source: "generated",
            cached: false,
          };
        }
        console.warn(
          `[placeholder] ${category}: generated image had no keyable background, using the silhouette`,
        );
        generationBlockedUntil = Date.now() + FAILURE_COOLDOWN_MS;
      } catch (err) {
        generationBlockedUntil = Date.now() + FAILURE_COOLDOWN_MS;
        console.warn(
          `[placeholder] ${category}: generation failed, using the silhouette —`,
          err instanceof Error ? err.message : err,
        );
      }
    }

    // 2. Silhouette, 3. neutral rectangle. Both are cheap and deterministic, so
    // they are cached under their own key and never block a later generation
    // from filling in the real one.
    const fallbackKey = cacheKeyFor(
      silhouette ? `silhouette:${silhouette}` : `unknown:${category}`,
      [tint],
      [],
    );
    const fallbackHit = await readCacheEntry(fallbackKey);
    if (fallbackHit) {
      return {
        url: urlForKey(fallbackKey),
        widthRatio: fallbackHit.widthRatio,
        category,
        source: fallbackHit.source,
        cached: true,
      };
    }

    const source: PlaceholderSource = silhouette ? "silhouette" : "unknown";
    const art = silhouette
      ? await renderSilhouette(silhouette, tint)
      : await renderUnknown(category, tint);
    const cut = await trimAlpha(art);
    if (!cut) {
      // The curated SVGs are ours and are never empty, so this is unreachable
      // in practice; 1:1 is the honest answer if it ever is reached.
      throw new Error("the fallback art rendered empty");
    }
    const widthRatio = cut.width / cut.height;
    await writeCacheEntry(fallbackKey, cut.png, {
      widthRatio,
      category,
      source,
      width: cut.width,
      height: cut.height,
      createdAt: Date.now(),
    });
    return {
      url: urlForKey(fallbackKey),
      widthRatio,
      category,
      source,
      cached: false,
    };
  })();

  inflight.set(key, job);
  try {
    return await job;
  } finally {
    inflight.delete(key);
  }
}
