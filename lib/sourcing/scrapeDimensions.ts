import { isDirectRetailerUrl } from "./whitelist";
import {
  parseDimensionsFromText,
  unknownDimensions,
  type Dimensions,
} from "@/lib/sourcing/dims";

/**
 * A retailer product page is not a small document. Lowe's, Wayfair and Amazon
 * all routinely take three or four seconds to answer a cold request, so the
 * old 2.5 second budget was timing the page out before it had finished being
 * sent, which reads as "this listing has no dimensions" when in fact we never
 * saw the page at all.
 */
const FETCH_TIMEOUT_MS = 6_000;

/**
 * Several shops answer an obviously automated request with HTTP 403 — Lowe's
 * did exactly that — and others quietly return a stub page with none of the
 * specification markup on it. The cheapest remedy is to send what a shopper's
 * browser sends: a current desktop Chrome user agent, the Accept and
 * Accept-Language headers that always travel with it, and the navigation hints
 * a top level page request carries. None of this defeats a real bot wall, and
 * it is not meant to: when the wall answers we log one line and stop rather
 * than retrying into a rate limit.
 */
const DEFAULT_HEADERS: HeadersInit = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Upgrade-Insecure-Requests": "1",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Sec-Fetch-User": "?1",
};

const VULGAR_FRACTIONS: Record<string, number> = {
  "¼": 0.25,
  "½": 0.5,
  "¾": 0.75,
  "⅓": 1 / 3,
  "⅔": 2 / 3,
  "⅛": 0.125,
  "⅜": 0.375,
  "⅝": 0.625,
  "⅞": 0.875,
};

type Axis = "h" | "w" | "d";

/** Pages label the horizontal span "length" as often as "width". */
type AxisLetter = Axis | "l";

type LabeledMeasure = { label: string; valueInches: number };

/**
 * The longest measurement a piece of home furniture can honestly claim. A
 * ten seater dining table is about 144 inches and a wall unit rarely passes
 * 120, so 400 leaves room for the freak cases while still catching what we
 * actually see go wrong: a pixel count, a SKU, a price or a year that a
 * regular expression read as a measurement. A value outside the range is
 * dropped rather than clamped, because a 900 inch sofa standing in someone's
 * room is a worse answer than a listing that admits it does not know.
 */
const MAX_PLAUSIBLE_INCHES = 400;

function isPlausibleInches(value: number | null | undefined): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value > 0 &&
    value <= MAX_PLAUSIBLE_INCHES
  );
}

/**
 * Drop any axis that cannot be true. This runs at every boundary rather than
 * once at the end, so a nonsense number cannot travel far enough to out-rank
 * a real one during merging.
 */
function sanitizeDimensions(dims: Dimensions): Dimensions {
  const h = isPlausibleInches(dims.h_in) ? dims.h_in : null;
  const w = isPlausibleInches(dims.w_in) ? dims.w_in : null;
  const d = isPlausibleInches(dims.d_in) ? dims.d_in : null;
  if (h == null && w == null && d == null) return unknownDimensions();
  return { h_in: h, w_in: w, d_in: d, estimated: dims.estimated };
}

type UnitName = "in" | "ft" | "cm" | "mm";

const INCHES_PER_UNIT: Record<UnitName, number> = {
  in: 1,
  ft: 12,
  cm: 1 / 2.54,
  mm: 1 / 25.4,
};

/** UN/CEFACT codes, which is how schema.org states a unit when it states one. */
const JSON_LD_UNIT_CODES: Record<string, UnitName> = {
  INH: "in",
  FOT: "ft",
  CMT: "cm",
  MMT: "mm",
};

const NUMBER_PATTERN = String.raw`\d+(?:\.\d+)?`;

/**
 * Every spelling of a unit of length a product page uses, including the two
 * marks that are not quotation marks at all: the double prime that means
 * inches, and the single prime which on a retailer page almost always means
 * inches too, because `81''` is written as often as `81"`. Feet are folded
 * into inches by the normaliser before this pattern is ever applied, so
 * reading a lone prime as inches here is safe.
 */
const UNIT_PATTERN = String.raw`(?:mm|millimet(?:er|re)s?|cm|centimet(?:er|re)s?|inches|inch|in|feet|foot|ft|''|"|″|”|'|′|’)`;

/**
 * One to three numbers joined by the multiplication sign, each free to carry
 * its own unit and its own axis letter. This single shape covers `24 x 36 x
 * 30 inches`, `61 x 91 x 76 cm`, `24" x 36"` and `12"D x 24"W x 30"H`, which
 * between them are most of what a shop writes next to the word "Dimensions".
 */
const MEASURE_RUN_PATTERN = String.raw`${NUMBER_PATTERN}\s*${UNIT_PATTERN}?\s*(?:[HWDLhwdl](?![A-Za-z]))?(?:\s*[x×]\s*${NUMBER_PATTERN}\s*${UNIT_PATTERN}?\s*(?:[HWDLhwdl](?![A-Za-z]))?){0,2}`;

const LENGTH_UNIT_RE = new RegExp(String.raw`\d\s*${UNIT_PATTERN}`, "i");

function roundInches(value: number): number {
  return Math.round(value * 100) / 100;
}

function toInches(value: number, unit: UnitName): number {
  return roundInches(value * INCHES_PER_UNIT[unit]);
}

function unitFromToken(token: string | undefined | null): UnitName | null {
  if (!token) return null;
  const t = token.toLowerCase().trim();
  if (!t) return null;
  if (t.startsWith("mm") || t.startsWith("millimet")) return "mm";
  if (t.startsWith("cm") || t.startsWith("centimet")) return "cm";
  if (t.startsWith("ft") || t.startsWith("feet") || t.startsWith("foot")) {
    return "ft";
  }
  if (t.startsWith("in") || /^(?:''|"|″|”|'|′|’)/.test(t)) {
    return "in";
  }
  return null;
}

/**
 * The unit a page states once for a whole run — `12D x 24W x 30H cm` names it
 * after the last axis letter, nowhere near a digit — so this deliberately
 * looks for the word anywhere rather than only where a number sits.
 */
function looseUnitFromText(text: string): UnitName | null {
  const match = text.match(
    /\b(mm|millimet(?:er|re)s?|cm|centimet(?:er|re)s?|inches|inch|in|feet|foot|ft)\b/i
  );
  return unitFromToken(match?.[1]);
}

function expandVulgarFractions(text: string): string {
  let out = text;
  for (const [glyph, value] of Object.entries(VULGAR_FRACTIONS)) {
    if (!out.includes(glyph)) continue;
    // A whole number in front of the glyph makes it a mixed number: 30¾ = 30.75.
    out = out.replace(
      new RegExp(String.raw`(\d+)\s*${glyph}`, "g"),
      (_, whole: string) => String(Number(whole) + value)
    );
    out = out.replaceAll(glyph, String(value));
  }
  return out;
}

/**
 * The same job for fractions typed as ASCII. The denominator cap and the
 * requirement that the numerator be the smaller number are what keep a date
 * or an aspect ratio from being quietly turned into a decimal.
 */
function expandCommonFractions(text: string): string {
  const mixed = text.replace(
    /(\d+)\s+(\d{1,2})\s*\/\s*(\d{1,2})(?!\d)/g,
    (whole, digits: string, num: string, den: string) => {
      const denominator = Number(den);
      if (denominator === 0 || denominator > 64) return whole;
      return String(Number(digits) + Number(num) / denominator);
    }
  );

  return mixed.replace(
    /(^|[^\d./])(\d{1,2})\s*\/\s*(\d{1,2})(?!\d)/g,
    (whole, lead: string, num: string, den: string) => {
      const numerator = Number(num);
      const denominator = Number(den);
      if (denominator === 0 || denominator > 64) return whole;
      if (numerator >= denominator) return whole;
      return `${lead}${numerator / denominator}`;
    }
  );
}

/**
 * `5' 3"` and `5 ft 3 in` are both 63 inches. The pair forms are folded first
 * so that the lone-feet rule underneath cannot claim the 5 and throw the 3
 * away, and the single prime is only ever read as feet when a second number
 * follows it — `81''` is inches and must stay that way.
 */
function foldFeetAndInches(text: string): string {
  const inchMark = String.raw`(?:''|"|″|”|in(?:ch(?:es)?)?\b)`;
  const number = NUMBER_PATTERN;

  return text
    .replace(
      new RegExp(
        String.raw`(${number})\s*['′](?!['′])\s*(${number})\s*${inchMark}?`,
        "g"
      ),
      (_, feet: string, inches: string) =>
        `${Number(feet) * 12 + Number(inches)}"`
    )
    .replace(
      new RegExp(
        String.raw`(${number})\s*(?:feet|foot|ft)\b\s*(${number})\s*${inchMark}?`,
        "gi"
      ),
      (_, feet: string, inches: string) =>
        `${Number(feet) * 12 + Number(inches)}"`
    )
    .replace(
      new RegExp(String.raw`(${number})\s*(?:feet|foot|ft)\b`, "gi"),
      (_, feet: string) => `${Number(feet) * 12}"`
    );
}

/**
 * Bring a scrap of page text to the one shape the number patterns can read:
 * entities decoded, curly quotes and the multiplication sign folded onto their
 * ASCII twins, fractions turned into decimals and feet added into inches.
 * Doing it once, here, is what lets everything below share a single pair of
 * number and unit patterns instead of each growing its own.
 */
function decodeHtmlEntities(raw: string): string {
  return raw
    .replace(/\\"/g, '"')
    .replace(/&quot;/gi, '"')
    .replace(/&#0*34;|&#x0*22;/gi, '"')
    .replace(/&#0*39;|&#x0*27;|&apos;/gi, "'")
    .replace(/&#8221;|&#8243;|&rdquo;|&ldquo;|&Prime;/gi, '"')
    .replace(/&times;/gi, "x")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&");
}

function normalizeMeasurementText(raw: string): string {
  if (!raw) return "";
  const decoded = decodeHtmlEntities(raw)
    .replace(/[‘’′]/g, "'")
    .replace(/[“”″]/g, '"')
    .replace(/ /g, " ")
    .replace(/[×✕✖]/g, "x")
    .replace(/[‒-―]/g, "-");

  const expanded = expandCommonFractions(expandVulgarFractions(decoded));
  return foldFeetAndInches(expanded).replace(/\s+/g, " ").trim();
}

export async function fetchProductHtml(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    let current = url;
    for (let redirects = 0; redirects <= 3; redirects++) {
      if (!isDirectRetailerUrl(current)) return null;
      const response = await fetch(current, {
        headers: DEFAULT_HEADERS,
        signal: controller.signal,
        redirect: "manual",
      });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const next = response.headers.get("location");
        await response.body?.cancel();
        if (!next) return null;
        current = new URL(next, current).toString();
        continue;
      }
      if (!response.ok) {
        console.warn(`[scrape] HTTP ${response.status} fetching dimensions from ${url}`);
        return null;
      }
      return await response.text();
    }
    return null;
  } catch (err) {
    console.warn("[scrape] Failed to fetch product page:", err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Parse a single measurement — `67 3/8 "`, `30 ¾ "`, `81 in`, `914 mm`,
 * `200 cm`, `5' 3"` — into decimal inches. The normaliser above has already
 * dealt with everything awkward about the input, so all that is left here is
 * one number and one unit. When the unit is not glued to the number we look
 * for it anywhere in the string, because `30 (cm)` is written as often as
 * `30cm`, and we fall back to inches only because American retail states
 * inches by omission. Nothing is invented: a string with no number in it
 * returns null rather than a plausible-looking size.
 */
export function parseFractionalInches(raw: string): number | null {
  const text = normalizeMeasurementText(raw);
  if (!text) return null;

  const match = text.match(
    new RegExp(String.raw`(${NUMBER_PATTERN})\s*(${UNIT_PATTERN})?`, "i")
  );
  if (!match) return null;

  const value = Number(match[1]);
  if (!Number.isFinite(value)) return null;

  const unit = unitFromToken(match[2]) ?? looseUnitFromText(text) ?? "in";
  return toInches(value, unit);
}

/**
 * Read a whole dimension string at once. Three shapes matter, and they are
 * tried in the order of how much the page actually told us:
 *
 *   1. axis letters attached to the numbers (`12"D x 24"W x 30"H`), which
 *      state the order outright and can be trusted in any order they arrive;
 *   2. a bare run (`24 x 36 x 30 inches`, `61 x 91 x 76 cm`, `24" x 36"`),
 *      where the order has to come from a hint on the label or from the
 *      convention this module has always used;
 *   3. anything else, which goes to the shared text parser that already owns
 *      the single-axis wording such as `80.3" Wide`.
 *
 * `orderHint` is how a caller passes on what the page said somewhere else: an
 * Amazon row headed "Item Dimensions LxWxH" states the order in its title and
 * nowhere near the numbers.
 */
function parseDimensionBlob(
  raw: string,
  orderHint?: AxisLetter[] | null
): Dimensions {
  const text = normalizeMeasurementText(raw);
  if (!text) return unknownDimensions();

  const lettered = dimensionsFromLetterPairs(collectLetteredMeasures(text));
  if (lettered) return sanitizeDimensions(lettered);

  const bare = dimensionsFromBareRun(
    text,
    axisOrderFromText(text) ?? orderHint ?? null
  );
  if (bare) return sanitizeDimensions(bare);

  return sanitizeDimensions(parseDimensionsFromText(text));
}

type LetteredMeasure = {
  letter: AxisLetter;
  value: number;
  unit: UnitName | null;
};

function collectLetteredMeasures(text: string): LetteredMeasure[] {
  const re = new RegExp(
    String.raw`(${NUMBER_PATTERN})\s*(${UNIT_PATTERN})?\s*-?\s*([HWDLhwdl])(?![A-Za-z])`,
    "g"
  );
  const out: LetteredMeasure[] = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const value = Number(match[1]);
    if (!Number.isFinite(value)) continue;
    out.push({
      letter: match[3].toLowerCase() as AxisLetter,
      value,
      unit: unitFromToken(match[2]),
    });
  }
  if (out.length === 0) return out;

  // A unit stated once governs the whole run: `12D x 24W x 30H cm`.
  const stated =
    out.find((measure) => measure.unit != null)?.unit ?? looseUnitFromText(text);
  return out.map((measure) => ({ ...measure, unit: measure.unit ?? stated }));
}

/**
 * Turn axis letters into axes. The one judgement call is L. A page that lists
 * L, W and H and no D is describing a box: L is the left-right span and W is
 * the front-back one. Anywhere else L is simply the width, and depth keeps its
 * own letter.
 */
function dimensionsFromLetterPairs(
  measures: LetteredMeasure[]
): Dimensions | null {
  if (measures.length < 2) return null;

  const letters = new Set(measures.map((measure) => measure.letter));
  const lengthIsWidth = !(
    measures.length === 3 &&
    letters.has("l") &&
    letters.has("w") &&
    letters.has("h") &&
    !letters.has("d")
  );

  const found: Partial<Record<Axis, number>> = {};
  const set = (axis: Axis, value: number) => {
    if (found[axis] == null) found[axis] = value;
  };

  for (const { letter, value, unit } of measures) {
    const inches = toInches(value, unit ?? "in");
    if (letter === "h") set("h", inches);
    else if (letter === "d") set("d", inches);
    else if (letter === "w") set(lengthIsWidth ? "w" : "d", inches);
    else if (!lengthIsWidth) set("w", inches);
    else if (found.w == null) set("w", inches);
    else set("d", inches);
  }

  if (found.h == null && found.w == null && found.d == null) return null;

  return {
    h_in: found.h ?? null,
    w_in: found.w ?? null,
    d_in: found.d ?? null,
    estimated: false,
  };
}

/** `L x W x H`, `(H x W x D)` — a page stating its own axis order in words. */
function axisOrderFromText(text: string): AxisLetter[] | null {
  const match = text.match(
    /\b([hwdl])\s*[x×]\s*([hwdl])\s*[x×]\s*([hwdl])\b/i
  );
  if (!match) return null;
  return [match[1], match[2], match[3]].map(
    (letter) => letter.toLowerCase() as AxisLetter
  );
}

/**
 * Numbers with no axis letters anywhere near them. Two rules earn their keep
 * here. A pair is read as width then height, because the flat things a shop
 * describes with two numbers — art, mirrors, headboards — are measured across
 * and then up. And a pair carrying no unit at all is refused outright, because
 * `set of 2 x 4` is not a measurement and treating it as one puts imaginary
 * furniture in a real room. A triple keeps the order this module has always
 * assumed when the page does not say, H x W x D; changing that quietly would
 * move every listing already sitting in the index.
 */
function dimensionsFromBareRun(
  text: string,
  order: AxisLetter[] | null
): Dimensions | null {
  const re = new RegExp(
    String.raw`(${NUMBER_PATTERN})\s*(${UNIT_PATTERN})?\s*[x×]\s*(${NUMBER_PATTERN})\s*(${UNIT_PATTERN})?(?:\s*[x×]\s*(${NUMBER_PATTERN})\s*(${UNIT_PATTERN})?)?`,
    "i"
  );
  const match = text.match(re);
  if (!match) return null;

  const values = [match[1], match[3], match[5]]
    .filter((value): value is string => typeof value === "string")
    .map(Number);
  if (values.some((value) => !Number.isFinite(value))) return null;

  const stated = [match[2], match[4], match[6]]
    .map(unitFromToken)
    .find((unit) => unit != null);
  const loose = looseUnitFromText(text);
  if (values.length === 2 && stated == null && loose == null) return null;

  const unit = stated ?? loose ?? "in";
  const fallbackOrder: AxisLetter[] =
    values.length === 2 ? ["w", "h"] : ["h", "w", "d"];
  const letters =
    order && order.length === values.length ? order : fallbackOrder;

  return dimensionsFromLetterPairs(
    values.map((value, index) => ({ letter: letters[index], value, unit }))
  );
}

function extractJsonLdBlocks(html: string): unknown[] {
  const blocks: unknown[] = [];
  const re =
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) {
    const raw = match[1]?.trim();
    if (!raw) continue;
    try {
      blocks.push(JSON.parse(raw));
    } catch {
      // ignore invalid JSON-LD
    }
  }
  return blocks;
}

function flattenObjects(nodes: unknown[]): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const visit = (node: unknown) => {
    if (!node) return;
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (typeof node !== "object") return;
    const obj = node as Record<string, unknown>;
    out.push(obj);
    if (obj["@graph"]) visit(obj["@graph"]);
  };
  nodes.forEach(visit);
  return out;
}

function isProductNode(node: Record<string, unknown>): boolean {
  const type = node["@type"];
  if (typeof type === "string") return type.toLowerCase() === "product";
  if (Array.isArray(type)) {
    return type.some(
      (t) => typeof t === "string" && t.toLowerCase() === "product"
    );
  }
  return false;
}

/**
 * A schema.org QuantitativeValue carries its unit beside the number, in either
 * a UN/CEFACT code or plain words. Honouring it matters more than it looks:
 * a European shop publishing `{ "value": 200, "unitCode": "CMT" }` means a
 * 78 inch sofa, and reading that 200 as inches produces a number that is
 * wrong but not absurd enough for the plausibility guard to catch.
 */
function dimFromJsonLdField(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") return parseFractionalInches(value);
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const unit =
      (typeof obj.unitCode === "string"
        ? JSON_LD_UNIT_CODES[obj.unitCode.toUpperCase()]
        : null) ??
      (typeof obj.unitText === "string" ? unitFromToken(obj.unitText) : null);
    if (typeof obj.value === "number" && Number.isFinite(obj.value)) {
      return toInches(obj.value, unit ?? "in");
    }
    if (typeof obj.value === "string") {
      const parsed = parseFractionalInches(obj.value);
      if (parsed == null) return null;
      // Only apply the declared unit when the string did not state one itself.
      return unit && !LENGTH_UNIT_RE.test(obj.value)
        ? toInches(parsed, unit)
        : parsed;
    }
    if (typeof obj.text === "string") return parseFractionalInches(obj.text);
  }
  return null;
}

/** Pull width/height/depth from schema.org Product JSON-LD when present. */
export function dimensionsFromJsonLd(html: string): Dimensions {
  const nodes = flattenObjects(extractJsonLdBlocks(html));
  for (const node of nodes) {
    if (!isProductNode(node)) continue;

    const found: Partial<Record<Axis, number>> = {};
    const w = dimFromJsonLdField(node.width);
    const h = dimFromJsonLdField(node.height);
    const d = dimFromJsonLdField(node.depth);
    if (w != null) found.w = w;
    if (h != null) found.h = h;
    if (d != null) found.d = d;

    const extras = node.additionalProperty;
    if (Array.isArray(extras)) {
      const labeled: LabeledMeasure[] = [];
      for (const prop of extras) {
        if (!prop || typeof prop !== "object") continue;
        const p = prop as Record<string, unknown>;
        const label = String(p.name || p.propertyID || "");
        const val = dimFromJsonLdField(p.value);
        if (!label || !isPlausibleInches(val)) continue;
        labeled.push({ label, valueInches: val });
      }
      Object.assign(found, pickAxesFromLabels(labeled, found));
    }

    if (found.h == null && found.w == null && found.d == null) continue;

    return sanitizeDimensions({
      h_in: found.h ?? null,
      w_in: found.w ?? null,
      d_in: found.d ?? null,
      estimated: false,
    });
  }

  return unknownDimensions();
}

/**
 * A carton is not the object inside it. Amazon and Walmart both publish
 * package dimensions next to, and sometimes instead of, the item's own, and a
 * flat-packed wardrobe ships in a box nothing like the wardrobe's shape. Any
 * label carrying one of these words is refused outright, which is also what
 * makes "prefer item over package" work: there is nothing left to prefer.
 */
function isPackagingLabel(label: string): boolean {
  return /package|packaging|shipping|carton|\bbox(?:ed)?\b|freight|parcel|crate|pallet|unassembled/i.test(
    label
  );
}

/**
 * Score a measurement label for an axis. Higher is better.
 * Negative means "do not use for overall product size".
 */
function labelAxisScore(label: string, axis: Axis): number {
  const l = label.toLowerCase().trim();

  // Reject package / seat / armrest / clearance noise for overall dims.
  if (isPackagingLabel(l)) return -1;
  if (
    /seat|armrest|arm rest|under furniture|under the furniture|height under|leg height|floor to|clearance|weight|volume|thickness/.test(
      l
    )
  ) {
    return -1;
  }

  if (axis === "w") {
    if (/^(overall\s+)?width$/.test(l)) return 100;
    if (/overall\s+width|product\s+width|assembled\s+product\s+width/.test(l))
      return 90;
    if (/^width$/.test(l) || l === "w") return 80;
    // Furniture "length" is usually left-right span.
    if (
      /^(overall\s+)?length$/.test(l) ||
      /^assembled\s+product\s+length$/.test(l)
    ) {
      return 50;
    }
    if (/^(overall\s+)?diameter$/.test(l)) return 40;
    if (/\bwidth\b/.test(l)) return 20;
    return -1;
  }

  if (axis === "d") {
    if (/^(overall\s+)?depth$/.test(l)) return 100;
    if (/overall\s+depth|product\s+depth|assembled\s+product\s+depth/.test(l))
      return 90;
    if (/^depth$/.test(l) || l === "d") return 80;
    if (/\bdepth\b/.test(l)) return 20;
    // Diameter → treat as depth/footprint for lamps/round items when no depth.
    if (/^(overall\s+)?diameter$/.test(l)) return 40;
    return -1;
  }

  // height — prefer overall / including cushions; avoid weak generic matches
  if (
    /height including back cushions|overall height|total height|product height|assembled\s+product\s+height/.test(
      l
    )
  ) {
    return 100;
  }
  if (/^(overall\s+)?height$/.test(l) || l === "h") return 80;
  // Last resort when overall height is absent (common on some IKEA sofas).
  if (/^backrest height$/.test(l)) return 35;
  return -1;
}

function pickAxesFromLabels(
  labels: LabeledMeasure[],
  seed: Partial<Record<Axis, number>> = {}
): Partial<Record<Axis, number>> {
  const best: Partial<Record<Axis, { score: number; value: number }>> = {};
  for (const axis of ["h", "w", "d"] as Axis[]) {
    if (seed[axis] != null) {
      best[axis] = { score: 1000, value: seed[axis]! };
    }
  }

  // Pass 1: width/depth so height guards can use width as context.
  // Pass 2: height.
  for (const axes of [
    ["w", "d"] as Axis[],
    ["h"] as Axis[],
  ]) {
    for (const { label, valueInches } of labels) {
      for (const axis of axes) {
        const score = labelAxisScore(label, axis);
        if (score < 0) continue;

        // Bare "Height" with a tiny value is almost always packaging —
        // but only when the product is clearly furniture-scale (wide).
        // Lamps/side tables are often under 20" tall.
        const widthHint = seed.w ?? best.w?.value;
        if (
          axis === "h" &&
          valueInches < 15 &&
          typeof widthHint === "number" &&
          widthHint > 36 &&
          score < 90
        ) {
          continue;
        }

        const prev = best[axis];
        // On ties, prefer the larger measurement (overall > package).
        if (
          !prev ||
          score > prev.score ||
          (score === prev.score && valueInches > prev.value)
        ) {
          best[axis] = { score, value: valueInches };
        }
      }
    }
  }

  return {
    h: best.h?.value,
    w: best.w?.value,
    d: best.d?.value,
  };
}

/**
 * Spec labels that hold a full HxWxD / LxWxH blob instead of one axis. The
 * trailing word boundary rather than an end anchor is what lets "Item
 * Dimensions LxWxH" and "Assembled Product Dimensions (L x W x H)" through:
 * both are blob labels that happen to carry their axis order in the label.
 */
function isDimensionBlobLabel(label: string): boolean {
  const l = label.toLowerCase().trim();
  if (isPackagingLabel(l)) return false;
  return /^(?:assembled\s+)?(?:product\s+|item\s+|overall\s+|total\s+)*(?:dimensions?|measurements?|size)\b/.test(
    l
  );
}

function pushLabeled(
  out: LabeledMeasure[],
  label: string,
  valueRaw: string
): void {
  const cleanLabel = label.replace(/\s+/g, " ").trim();
  const cleanValue = normalizeMeasurementText(valueRaw);
  if (!cleanLabel || !cleanValue) return;

  /*
   * The packaging check has to happen here and not only in the scorer below.
   * A blob is exploded into bare Height/Width/Depth entries a few lines down,
   * and that throws away the one word - "Package" - that said these numbers
   * describe the carton rather than the thing inside it. Refusing the row now
   * is what stops a flat-pack's shipping box being reported as the wardrobe.
   */
  if (isPackagingLabel(cleanLabel)) return;

  // Full dimension strings: "11.8\" L x 11.8\" W x 19\" H" or "23.62 x 23.62 x 23.62 in"
  if (isDimensionBlobLabel(cleanLabel) || /[x×]/i.test(cleanValue)) {
    const parsed = parseDimensionBlob(cleanValue, axisOrderFromText(cleanLabel));
    if (parsed.h_in != null) out.push({ label: "Height", valueInches: parsed.h_in });
    if (parsed.w_in != null) out.push({ label: "Width", valueInches: parsed.w_in });
    if (parsed.d_in != null) out.push({ label: "Depth", valueInches: parsed.d_in });
    // If blob parse failed but value is a single number under a Size label, skip.
    if (parsed.h_in != null || parsed.w_in != null || parsed.d_in != null) {
      return;
    }
  }

  const valueInches = parseFractionalInches(cleanValue);
  if (!isPlausibleInches(valueInches)) return;
  out.push({ label: cleanLabel, valueInches });
}

function collectJsonNameValuePairs(html: string): Array<[string, string]> {
  const pairs: Array<[string, string]> = [];
  // Handle escaped quotes inside JSON strings: "11.8\" L x 11.8\" W"
  const re =
    /"name"\s*:\s*"((?:\\.|[^"\\])*)"\s*,\s*"value"\s*:\s*"((?:\\.|[^"\\])*)"/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) {
    const label = match[1]
      .replace(/\\"/g, '"')
      .replace(/\\u003c/gi, "<")
      .replace(/\\u003e/gi, ">")
      .replace(/\\n/g, " ");
    const value = match[2]
      .replace(/\\"/g, '"')
      .replace(/\\u003c/gi, "<")
      .replace(/\\u003e/gi, ">")
      .replace(/\\n/g, " ");
    pairs.push([label, value]);
  }
  // value-then-name order
  const re2 =
    /"value"\s*:\s*"((?:\\.|[^"\\])*)"\s*,\s*"name"\s*:\s*"((?:\\.|[^"\\])*)"/gi;
  while ((match = re2.exec(html)) !== null) {
    const value = match[1].replace(/\\"/g, '"');
    const label = match[2].replace(/\\"/g, '"');
    pairs.push([label, value]);
  }
  return pairs;
}

/**
 * Ending on a word boundary rather than an anchor admits the labels a shop
 * really writes, which the anchored pattern was quietly dropping: Wayfair's
 * "Overall Width - Side to Side", Amazon's "Item Dimensions LxWxH", Walmart's
 * "Assembled Product Dimensions (L x W x H)". Letting them in costs nothing,
 * because labelAxisScore is the gate that decides what a label is worth.
 */
function isUsefulSpecLabel(label: string): boolean {
  const l = label.toLowerCase().trim();
  if (isPackagingLabel(l)) return false;
  return /^(?:assembled\s+)?(?:product\s+|item\s+|overall\s+|total\s+)*(?:dimensions?|measurements?|size|height|width|depth|length|diameter)\b/.test(
    l
  );
}

/**
 * The page's own words with the markup taken out. Most of the sizes we fail to
 * find are plainly visible on the page but split across tags:
 * `<b>Dimensions</b>: <span>24" x 36"</span>` is one sentence to a shopper and
 * two unrelated fragments to a pattern reading raw HTML. Scripts and styles go
 * first, because a stylesheet is full of numbers that look like measurements
 * and are not.
 */
function visibleText(html: string): string {
  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ");
  // Entities are decoded here as well as per value, because a page that writes
  // `24&quot; x 36&quot;` hides the multiplication sign behind the entity and
  // the run would otherwise be read as a single lonely number.
  return decodeHtmlEntities(stripped).replace(/\s+/g, " ");
}

/**
 * The label half deliberately includes the packaging words. Leaving them out
 * would not skip those rows, it would match the word "Dimensions" inside them
 * and lose the qualifier that says whose dimensions they are; pushLabeled is
 * then free to refuse the row on sight.
 */
const PROSE_MEASURE_RE = new RegExp(
  String.raw`((?:(?:assembled|overall|product|item|package|packaging|shipping|carton|boxed|folded|unfolded|total|approx(?:imate)?)\s+){0,3}(?:dimensions?|measurements?|size)(?:\s*\(?\s*[hwdl]\s*[x×]\s*[hwdl]\s*[x×]\s*[hwdl]\s*\)?)?)\s*[:\-–]?\s*(${MEASURE_RUN_PATTERN})`,
  "gi"
);

function pushProseMeasurements(out: LabeledMeasure[], text: string): void {
  const re = new RegExp(PROSE_MEASURE_RE.source, PROSE_MEASURE_RE.flags);
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    pushLabeled(out, match[1], match[2]);
  }
}

function attributeValue(tag: string, name: string): string | null {
  const match = tag.match(
    new RegExp(String.raw`\b${name}\s*=\s*["']([^"']*)["']`, "i")
  );
  return match?.[1] ?? null;
}

const PIXEL_CONTEXT_RE =
  /image|video|thumbnail|logo|icon|photo|picture|player|banner|viewport|pixel|\bpx\b/i;

/**
 * A few shops publish the size in markup a shopper never sees: an itemprop
 * meta tag, or a data- attribute on the gallery. Both are worth reading, and
 * both are also where pixel counts live - og:image:width is 1200 and says
 * nothing whatever about the sofa - so a value is only accepted here when it
 * carries a unit of length, or when the attribute name itself promises
 * inches. A bare number does not become a measurement by sitting next to the
 * word "width".
 */
function collectMarkupAttributeMeasurements(html: string): LabeledMeasure[] {
  const out: LabeledMeasure[] = [];

  const metaRe = /<meta\b[^>]*>/gi;
  let tag: RegExpExecArray | null;
  while ((tag = metaRe.exec(html)) !== null) {
    const raw = tag[0];
    const name =
      attributeValue(raw, "itemprop") ??
      attributeValue(raw, "property") ??
      attributeValue(raw, "name");
    const content = attributeValue(raw, "content");
    if (!name || !content) continue;
    if (PIXEL_CONTEXT_RE.test(name)) continue;
    const axisWord = name.match(
      /(dimensions?|measurements?|width|height|depth|length)/i
    );
    if (!axisWord) continue;
    if (!LENGTH_UNIT_RE.test(content)) continue;
    pushLabeled(out, isPackagingLabel(name) ? name : axisWord[1], content);
  }

  const dataRe =
    /\bdata-(?:product-|item-)?(dimensions?|measurements?|width|height|depth|length)(-in(?:ch(?:es)?)?)?\s*=\s*["']([^"']{1,80})["']/gi;
  let attr: RegExpExecArray | null;
  while ((attr = dataRe.exec(html)) !== null) {
    const promisesInches = Boolean(attr[2]);
    const value = attr[3];
    if (!promisesInches && !LENGTH_UNIT_RE.test(value)) continue;
    pushLabeled(out, attr[1], promisesInches ? `${value} in` : value);
  }

  return out;
}

function collectLabeledMeasurements(html: string): LabeledMeasure[] {
  const out: LabeledMeasure[] = [];

  // Walmart __NEXT_DATA__ and similar: walk all name/value pairs (escaped-quote safe).
  for (const [label, value] of collectJsonNameValuePairs(html)) {
    if (!isUsefulSpecLabel(label)) continue;
    pushLabeled(out, label, value);
  }

  // Simpler multi-pass extractors (IKEA measure/name, generic label/text):
  const patterns: RegExp[] = [
    /"name"\s*:\s*"([^"]+)"\s*,\s*"measure"\s*:\s*"([^"]+)"/gi,
    /"measure"\s*:\s*"([^"]+)"\s*,\s*"name"\s*:\s*"([^"]+)"/gi,
    /"label"\s*:\s*"([^"]+)"\s*,\s*"text"\s*:\s*"([^"]+)"/gi,
    /"label"\s*:\s*"([^"]+)"\s*,\s*"type"\s*:\s*"(?:width|height|depth|length)"\s*,\s*"text"\s*:\s*"([^"]+)"/gi,
    /"type"\s*:\s*"(width|height|depth|length)"\s*,\s*"text"\s*:\s*"([^"]+)"/gi,
  ];

  for (const re of patterns) {
    let match: RegExpExecArray | null;
    while ((match = re.exec(html)) !== null) {
      let label = match[1] || "";
      let valueRaw = match[2] || "";
      if (/^\d/.test(label) && /[a-z]/i.test(valueRaw)) {
        const tmp = label;
        label = valueRaw;
        valueRaw = tmp;
      }
      pushLabeled(out, label, valueRaw);
    }
  }

  // HTML measurement rows (IKEA + similar):
  const rowRe =
    /measurement-name[^>]*>\s*([^<]+?)\s*<\/[^>]+>\s*<[^>]*measurement-value[^>]*>\s*([^<]+?)\s*</gi;
  let row: RegExpExecArray | null;
  while ((row = rowRe.exec(html)) !== null) {
    pushLabeled(out, row[1], row[2]);
  }

  // Definition-list / table style: Width</td><td>81 in
  const tableRe =
    />\s*((?:Assembled\s+Product\s+|Overall\s+|Product\s+|Item\s+|Package\s+)?(?:Width|Height|Depth|Length|Dimensions?|Measurements?|Size)[^<]{0,40}?)\s*<\/(?:td|th|dt|span|div|b|strong|p|li)>\s*<[^>]+>\s*([^<]{1,60}?)\s*</gi;
  let table: RegExpExecArray | null;
  while ((table = tableRe.exec(html)) !== null) {
    pushLabeled(out, table[1], table[2]);
  }

  // Visible list / prose: "Dimensions: 11.8\" L x 11.8\" W x 19\" H". Read
  // twice - once against the raw markup, once against the page with its tags
  // stripped - because a label and its value sit in two elements as often as
  // they sit in one.
  pushProseMeasurements(out, html);
  pushProseMeasurements(out, visibleText(html));

  out.push(...collectMarkupAttributeMeasurements(html));

  // Compact labeled triples in marketing copy: 13.8"D x 15.8"W x 23.7"H
  const compactRe =
    /(\d+(?:\.\d+)?\s*(?:["”″'′]{1,2}|in(?:ches)?|cm|mm)?\s*[LlWwHhDd]\s*[x×]\s*\d+(?:\.\d+)?\s*(?:["”″'′]{1,2}|in(?:ches)?|cm|mm)?\s*[LlWwHhDd]\s*[x×]\s*\d+(?:\.\d+)?\s*(?:["”″'′]{1,2}|in(?:ches)?|cm|mm)?\s*[LlWwHhDd])/gi;
  let compact: RegExpExecArray | null;
  while ((compact = compactRe.exec(html)) !== null) {
    pushLabeled(out, "Dimensions", compact[1]);
  }

  return out;
}

/** General labeled W/H/D extraction from PDP HTML/JSON. */
export function dimensionsFromLabeledHtml(html: string): Dimensions {
  const labels = collectLabeledMeasurements(html);
  if (!labels.length) return unknownDimensions();

  const picked = pickAxesFromLabels(labels);
  if (picked.h == null && picked.w == null && picked.d == null) {
    return unknownDimensions();
  }

  return sanitizeDimensions({
    h_in: picked.h ?? null,
    w_in: picked.w ?? null,
    d_in: picked.d ?? null,
    estimated: false,
  });
}

function firstMatch(html: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return match[1];
  }
  return null;
}

function hasAnyAxis(dims: Dimensions): boolean {
  return dims.h_in != null || dims.w_in != null || dims.d_in != null;
}

/**
 * Tidy a label lifted straight out of markup or out of a JSON key, so that the
 * predicates above see the words a person would read: entities decoded, a
 * camel-cased key such as `assembledProductDimensions` split back into words,
 * and the colon a page puts after a bullet label taken off the end.
 */
function cleanRowLabel(label: string): string {
  return label
    .replace(/&nbsp;/gi, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[\s:;–\-：]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function collectPairs(
  html: string,
  patterns: RegExp[]
): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const pattern of patterns) {
    const flags = pattern.flags.includes("g")
      ? pattern.flags
      : `${pattern.flags}g`;
    const re = new RegExp(pattern.source, flags);
    let match: RegExpExecArray | null;
    while ((match = re.exec(html)) !== null) {
      if (!match[1] || !match[2]) continue;
      out.push([cleanRowLabel(match[1]), match[2]]);
    }
  }
  return out;
}

/**
 * Walk labelled candidates in the order the page presented them and keep the
 * first that yields a real measurement. Packaging rows are stepped over
 * rather than parsed, and a label that states its own axis order overrides the
 * caller's default, because what the page says beats what we assume.
 */
function firstParsedBlob(
  candidates: Array<[string, string]>,
  defaultOrder: AxisLetter[] | null = null
): Dimensions {
  for (const [label, value] of candidates) {
    if (isPackagingLabel(label)) continue;
    const parsed = parseDimensionBlob(
      value,
      axisOrderFromText(label) ?? defaultOrder
    );
    if (hasAnyAxis(parsed)) return parsed;
  }
  return unknownDimensions();
}

/**
 * Amazon does not have one product page, it has several templates, and each
 * states the size differently: the product details table, the older technical
 * specification table, the detail bullet list, and a JSON island shipped for
 * the mobile view. The row headed "Item Dimensions LxWxH" is the useful one
 * because it is the only place the axis order is written down; the bare
 * "Product Dimensions" row uses that same order without saying so, which is
 * why length-width-height is passed in as the default rather than the
 * module's usual height-first assumption. Package dimensions are stepped
 * over: the carton a flat-packed desk arrives in is not the desk.
 */
function amazonDimensions(html: string): Dimensions {
  const candidates = collectPairs(html, [
    // productDetails / techSpec tables: <th>Item Dimensions LxWxH</th><td>…</td>
    /<t[hd][^>]*>\s*([^<]{3,60}?)\s*<\/t[hd]>\s*<t[hd][^>]*>\s*([^<]{3,90}?)\s*</gi,
    // detail bullets: <span class="a-text-bold">Product Dimensions : </span><span>…</span>
    /<span[^>]*a-text-bold[^>]*>\s*([^<]{3,60}?)\s*<\/span>\s*<span[^>]*>\s*([^<]{3,90}?)\s*</gi,
    // JSON the page carries for its own scripts
    /"(itemDimensions|productDimensions|packageDimensions)"\s*:\s*"([^"]{3,90})"/gi,
  ]).filter(([label]) => isDimensionBlobLabel(label));

  return firstParsedBlob(candidates, ["l", "w", "h"]);
}

/**
 * Walmart renders from a JSON payload embedded in the page, and the
 * specification rows inside it are the only statement of size the fetched
 * HTML actually contains; the visible table is built by script after load and
 * never appears in what we downloaded. The walk is depth limited because that
 * payload is large and deeply nested, and every row it finds goes through the
 * same pushLabeled gate as the rest of the module, so "Assembled Product
 * Width" is scored exactly as it would be had it come from a table.
 */
function walmartNextDataMeasurements(html: string): LabeledMeasure[] {
  const script = html.match(
    /<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i
  );
  if (!script?.[1]) return [];

  let payload: unknown;
  try {
    payload = JSON.parse(script[1]);
  } catch {
    return [];
  }

  const out: LabeledMeasure[] = [];
  const visit = (node: unknown, depth: number): void => {
    if (depth > 14 || node == null || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const child of node) visit(child, depth + 1);
      return;
    }

    const obj = node as Record<string, unknown>;
    const name =
      typeof obj.name === "string"
        ? obj.name
        : typeof obj.displayName === "string"
          ? obj.displayName
          : null;
    const value =
      typeof obj.value === "string"
        ? obj.value
        : Array.isArray(obj.values) && typeof obj.values[0] === "string"
          ? obj.values[0]
          : null;
    if (name && value && isUsefulSpecLabel(name)) pushLabeled(out, name, value);

    for (const [key, child] of Object.entries(obj)) {
      if (typeof child === "string") {
        if (/dimension|measurement/i.test(key)) {
          pushLabeled(out, cleanRowLabel(key), child);
        }
        continue;
      }
      visit(child, depth + 1);
    }
  };

  visit(payload, 0);
  return out;
}

function walmartDimensions(html: string): Dimensions {
  const picked = pickAxesFromLabels(walmartNextDataMeasurements(html));
  const fromPayload = sanitizeDimensions({
    h_in: picked.h ?? null,
    w_in: picked.w ?? null,
    d_in: picked.d ?? null,
    estimated: false,
  });
  if (hasAnyAxis(fromPayload)) return fromPayload;

  const blob = firstMatch(html, [
    /"assembledProductDimensions"\s*:\s*"([^"]+)"/i,
    /"productDimensions"\s*:\s*"([^"]+)"/i,
    /"name"\s*:\s*"(?:Assembled product dimensions|Dimensions|Size|Product Dimensions)"\s*,\s*"value"\s*:\s*"([^"]+)"/i,
    /Assembled Product Dimensions[^\d]{0,40}([^<\n]{5,80})/i,
    /Product Dimensions[^\d]{0,40}([^<\n]{5,80})/i,
    /Dimensions?\s*:\s*([^<\n]{5,80})/i,
  ]);
  if (blob) {
    const parsed = parseDimensionBlob(blob);
    if (hasAnyAxis(parsed)) return parsed;
  }
  return unknownDimensions();
}

/**
 * Wayfair's specification panel is a list of labelled rows - "Overall Width -
 * Side to Side" and its siblings - which the general pass already reads. What
 * is added here is the single "Overall" row that carries the whole blob,
 * which the general pass steps over because its label is one word naming no
 * axis at all.
 */
function wayfairDimensions(html: string): Dimensions {
  const rows = firstParsedBlob(
    collectPairs(html, [
      />\s*(Overall(?:\s+Product)?(?:\s+Dimensions?)?)\s*:?\s*<\/(?:t[hd]|dt|dd|span|div|p|b|strong)>\s*<[^>]+>\s*([^<]{3,90}?)\s*</gi,
      /"(overallDimensions|overall|dimensions)"\s*:\s*"([^"]{3,90})"/gi,
    ])
  );
  if (hasAnyAxis(rows)) return rows;

  const blob = firstMatch(html, [
    /Overall Dimensions[^<\d]{0,40}([^<\n]{5,100})/i,
    /Overall[^<\d]{0,20}([\d][^<\n]{4,100})/i,
  ]);
  if (blob) {
    const parsed = parseDimensionBlob(blob);
    if (hasAnyAxis(parsed)) return parsed;
  }
  return unknownDimensions();
}

/**
 * An Etsy seller rarely fills in a size field; they write the size into the
 * description, as "Measurements: 12" tall x 8" wide" or "Size: 24 x 36
 * inches". The general prose pass catches those once the tags are stripped,
 * so what is left for here is the item-details panel, whose label and value
 * sit in separate elements with several tags between them, and the free-text
 * sentence that names one axis at a time rather than a tidy triple.
 */
function etsyDimensions(html: string): Dimensions {
  const panel = firstParsedBlob(
    collectPairs(html, [
      /Item details[\s\S]{0,400}?(Dimensions?|Measurements?|Size)\s*<\/[a-z0-9]+>\s*<[^>]+>\s*([^<]{3,90}?)\s*</gi,
      /"(dimensions|measurements|itemDimensions)"\s*:\s*"([^"]{3,90})"/gi,
    ])
  );
  if (hasAnyAxis(panel)) return panel;

  const sentence = visibleText(html).match(
    /(?:measurements?|dimensions?|size)\s*[:\-–]?\s*([^|]{5,120})/i
  );
  if (sentence?.[1]) {
    const parsed = parseDimensionBlob(sentence[1]);
    if (hasAnyAxis(parsed)) return parsed;
  }
  return unknownDimensions();
}

function retailerSpecificDimensions(
  html: string,
  retailer: string
): Dimensions {
  switch (retailer) {
    case "amazon.com":
      return amazonDimensions(html);
    case "walmart.com":
      return walmartDimensions(html);
    case "wayfair.com":
      return wayfairDimensions(html);
    case "etsy.com":
      return etsyDimensions(html);
    default:
      return unknownDimensions();
  }
}

export function mergeDimensions(base: Dimensions, extra: Dimensions): Dimensions {
  const width = base.w_in ?? extra.w_in;

  const pickHeight = (
    primary: number | null,
    secondary: number | null
  ): number | null => {
    // Prefer a plausible overall height over clearance/leg measurements.
    if (
      primary != null &&
      primary < 15 &&
      secondary != null &&
      secondary >= 15
    ) {
      return secondary;
    }
    if (primary != null) {
      if (primary < 15 && (width ?? 0) > 36 && secondary == null) {
        return null;
      }
      return primary;
    }
    if (secondary != null && secondary < 15 && (width ?? 0) > 36) {
      return null;
    }
    return secondary;
  };

  const merged: Dimensions = {
    h_in: pickHeight(base.h_in, extra.h_in),
    w_in: base.w_in ?? extra.w_in,
    d_in: base.d_in ?? extra.d_in,
    estimated: true,
  };
  if (merged.h_in != null || merged.w_in != null || merged.d_in != null) {
    merged.estimated = false;
  }
  return sanitizeDimensions(merged);
}

function hasCompleteDimensions(d: Dimensions): boolean {
  return d.h_in != null && d.w_in != null && d.d_in != null;
}

/**
 * Everything the scrape does once the HTML is in hand, in order of how much
 * the page told us rather than how general the reader is:
 *
 *   1) schema.org JSON-LD, which names each axis outright and states its unit;
 *   2) the retailer reader, which knows what that particular shop means by an
 *      unlabelled triple — Amazon's is length first, and no general pass can
 *      know that by looking;
 *   3) the general labelled pass, which has to fall back on a convention when
 *      the page names no axes at all.
 *
 * Splitting this out from the fetch is deliberate: it is the half worth
 * testing, and it can be exercised against fixture pages without a network
 * call.
 */
export function dimensionsFromHtml(html: string, retailer: string): Dimensions {
  let scraped = dimensionsFromJsonLd(html);

  if (!hasCompleteDimensions(scraped)) {
    scraped = mergeDimensions(
      scraped,
      retailerSpecificDimensions(html, retailer)
    );
  }

  if (!hasCompleteDimensions(scraped)) {
    scraped = mergeDimensions(scraped, dimensionsFromLabeledHtml(html));
  }

  return sanitizeDimensions(scraped);
}

/** Fetch a retailer PDP and read whatever size it states. */
export async function scrapeRetailerDimensions(
  productUrl: string,
  retailer: string,
  existing?: Dimensions
): Promise<Dimensions> {
  const current = existing ?? unknownDimensions();
  if (hasCompleteDimensions(current)) return current;

  const html = await fetchProductHtml(productUrl);
  if (!html) return current;

  return mergeDimensions(current, dimensionsFromHtml(html, retailer));
}
