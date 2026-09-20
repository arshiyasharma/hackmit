import {
  parseDimensionsFromText,
  unknownDimensions,
  type Dimensions,
} from "@/lib/sourcing/dims";

const FETCH_TIMEOUT_MS = 2_500;

const DEFAULT_HEADERS: HeadersInit = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml",
  "Accept-Language": "en-US,en;q=0.9",
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

type LabeledMeasure = { label: string; valueInches: number };

export async function fetchProductHtml(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: DEFAULT_HEADERS,
      signal: controller.signal,
      redirect: "follow",
    });
    if (!response.ok) {
      console.warn(
        `[scrape] HTTP ${response.status} fetching dimensions from ${url}`
      );
      return null;
    }
    return await response.text();
  } catch (err) {
    console.warn("[scrape] Failed to fetch product page:", err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Parse values like `67 3/8 "`, `30 ¾ "`, or `81 in` into decimal inches. */
export function parseFractionalInches(raw: string): number | null {
  let text = raw
    .replace(/&quot;/gi, '"')
    .replace(/&#34;/g, '"')
    .replace(/\u00a0/g, " ")
    .trim();

  // Normalize unicode vulgar fractions: "30 ¾" → "30 3/4"
  for (const [glyph, value] of Object.entries(VULGAR_FRACTIONS)) {
    if (!text.includes(glyph)) continue;
    // Prefer mixed number form when preceded by a whole number.
    text = text.replace(
      new RegExp(`(\\d+)\\s*${glyph}`),
      (_, whole: string) => {
        const frac = value;
        // convert to n/d approximation for shared parser path
        if (frac === 0.5) return `${whole} 1/2`;
        if (frac === 0.25) return `${whole} 1/4`;
        if (frac === 0.75) return `${whole} 3/4`;
        if (frac === 0.125) return `${whole} 1/8`;
        if (frac === 0.375) return `${whole} 3/8`;
        if (frac === 0.625) return `${whole} 5/8`;
        if (frac === 0.875) return `${whole} 7/8`;
        return `${Number(whole) + frac}`;
      }
    );
    text = text.replaceAll(glyph, String(value));
  }

  const mixed = text.match(
    /(\d+)\s+(\d+)\s*\/\s*(\d+)\s*(?:["”″]|in(?:ches)?|cm)?/i
  );
  if (mixed) {
    const whole = Number(mixed[1]);
    const num = Number(mixed[2]);
    const den = Number(mixed[3]);
    if ([whole, num, den].every(Number.isFinite) && den !== 0) {
      let inches = whole + num / den;
      if (/cm/i.test(mixed[0])) inches = inches / 2.54;
      return Math.round(inches * 100) / 100;
    }
  }

  const frac = text.match(/(\d+)\s*\/\s*(\d+)\s*(?:["”″]|in(?:ches)?|cm)?/i);
  if (frac && !/^\d+\s+\d/.test(text)) {
    const num = Number(frac[1]);
    const den = Number(frac[2]);
    if ([num, den].every(Number.isFinite) && den !== 0) {
      let inches = num / den;
      if (/cm/i.test(frac[0])) inches = inches / 2.54;
      return Math.round(inches * 100) / 100;
    }
  }

  const plain = text.match(/(\d+(?:\.\d+)?)\s*(cm)?/i);
  if (!plain) return null;
  let value = Number(plain[1]);
  if (!Number.isFinite(value)) return null;
  if (plain[2] || /\bcm\b/i.test(text)) value = value / 2.54;
  return Math.round(value * 100) / 100;
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

function dimFromJsonLdField(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") return parseFractionalInches(value);
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (typeof obj.value === "number") return obj.value;
    if (typeof obj.value === "string") return parseFractionalInches(obj.value);
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
        if (!label || val == null) continue;
        labeled.push({ label, valueInches: val });
      }
      Object.assign(found, pickAxesFromLabels(labeled, found));
    }

    if (found.h == null && found.w == null && found.d == null) continue;

    return {
      h_in: found.h ?? null,
      w_in: found.w ?? null,
      d_in: found.d ?? null,
      estimated: false,
    };
  }

  return unknownDimensions();
}

/**
 * Score a measurement label for an axis. Higher is better.
 * Negative means "do not use for overall product size".
 */
function labelAxisScore(label: string, axis: Axis): number {
  const l = label.toLowerCase().trim();

  // Reject package / seat / armrest / clearance noise for overall dims.
  if (
    /package|packaging|shipping|carton|box|seat|armrest|arm rest|under furniture|under the furniture|height under|leg height|floor to|clearance|weight|volume|thickness/.test(
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

/** Spec labels that hold a full HxWxD / LxWxH blob instead of one axis. */
function isDimensionBlobLabel(label: string): boolean {
  const l = label.toLowerCase().trim();
  return (
    /^(product\s+)?(overall\s+)?(assembled\s+)?(item\s+)?(dimensions?|size)$/.test(
      l
    ) ||
    /^(assembled\s+product\s+dimensions?|item\s+dimensions?|product\s+size)$/.test(
      l
    )
  );
}

function pushLabeled(
  out: LabeledMeasure[],
  label: string,
  valueRaw: string
): void {
  const cleanLabel = label.replace(/\s+/g, " ").trim();
  const cleanValue = valueRaw
    .replace(/\\"/g, '"')
    .replace(/&quot;/gi, '"')
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleanLabel || !cleanValue) return;

  // Full dimension strings: "11.8\" L x 11.8\" W x 19\" H" or "23.62 x 23.62 x 23.62 in"
  if (isDimensionBlobLabel(cleanLabel) || /[x×]/i.test(cleanValue)) {
    const parsed = parseDimensionsFromText(cleanValue);
    if (parsed.h_in != null) out.push({ label: "Height", valueInches: parsed.h_in });
    if (parsed.w_in != null) out.push({ label: "Width", valueInches: parsed.w_in });
    if (parsed.d_in != null) out.push({ label: "Depth", valueInches: parsed.d_in });
    // If blob parse failed but value is a single number under a Size label, skip.
    if (parsed.h_in != null || parsed.w_in != null || parsed.d_in != null) {
      return;
    }
  }

  const valueInches = parseFractionalInches(cleanValue);
  if (valueInches == null || valueInches > 500) return;
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

function isUsefulSpecLabel(label: string): boolean {
  const l = label.toLowerCase().trim();
  return /^(assembled\s+product\s+)?(overall\s+)?(product\s+)?(item\s+)?(dimensions?|size|height|width|depth|length|diameter)$/.test(
    l
  );
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
    />\s*((?:Assembled\s+Product\s+|Overall\s+|Product\s+|Item\s+)?(?:Width|Height|Depth|Length|Dimensions?|Size)[^<]{0,40}?)\s*<\/(?:td|th|dt|span|div)>\s*<[^>]+>\s*([^<]{1,60}?)\s*</gi;
  let table: RegExpExecArray | null;
  while ((table = tableRe.exec(html)) !== null) {
    pushLabeled(out, table[1], table[2]);
  }

  // Visible list / prose: "Dimensions: 11.8\" L x 11.8\" W x 19\" H"
  const proseRe =
    /(?:Assembled\s+)?(?:Product\s+|Item\s+|Overall\s+)?Dimensions?\s*[:\-–]?\s*((?:\d+(?:\.\d+)?[^\n<]{0,12}?){1}(?:\s*[x×]\s*\d+(?:\.\d+)?[^\n<]{0,12}?){1,2})/gi;
  let prose: RegExpExecArray | null;
  while ((prose = proseRe.exec(html)) !== null) {
    pushLabeled(out, "Dimensions", prose[1]);
  }

  // Compact labeled triples in marketing copy: 13.8"D x 15.8"W x 23.7"H
  const compactRe =
    /(\d+(?:\.\d+)?\s*(?:["”″'′]{1,2}|in(?:ches)?|cm)?\s*[LlWwHhDd]\s*[x×]\s*\d+(?:\.\d+)?\s*(?:["”″'′]{1,2}|in(?:ches)?|cm)?\s*[LlWwHhDd]\s*[x×]\s*\d+(?:\.\d+)?\s*(?:["”″'′]{1,2}|in(?:ches)?|cm)?\s*[LlWwHhDd])/gi;
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

  return {
    h_in: picked.h ?? null,
    w_in: picked.w ?? null,
    d_in: picked.d ?? null,
    estimated: false,
  };
}

function firstMatch(html: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return match[1];
  }
  return null;
}

function amazonDimensions(html: string): Dimensions {
  const blob = firstMatch(html, [
    /Product Dimensions\s*<\/td>\s*<td[^>]*>\s*([^<]+)/i,
    /Product Dimensions[^<]*<\/span>\s*<span[^>]*>\s*([^<]+)/i,
    /Item Dimensions[^<]{0,40}L\s*x\s*W\s*x\s*H[^<]*<\/span>\s*<span[^>]*>\s*([^<]+)/i,
    /"productDimensions"\s*:\s*"([^"]+)"/i,
  ]);
  if (!blob) return unknownDimensions();
  return parseDimensionsFromText(blob);
}

function walmartDimensions(html: string): Dimensions {
  const blob = firstMatch(html, [
    /"assembledProductDimensions"\s*:\s*"([^"]+)"/i,
    /"productDimensions"\s*:\s*"([^"]+)"/i,
    /"name"\s*:\s*"(?:Assembled product dimensions|Dimensions|Size|Product Dimensions)"\s*,\s*"value"\s*:\s*"([^"]+)"/i,
    /Assembled Product Dimensions[^\d]{0,40}([^<\n]{5,80})/i,
    /Product Dimensions[^\d]{0,40}([^<\n]{5,80})/i,
    /Dimensions?\s*:\s*([^<\n]{5,80})/i,
  ]);
  if (blob) {
    const parsed = parseDimensionsFromText(blob.replace(/\\"/g, '"'));
    if (parsed.h_in != null || parsed.w_in != null || parsed.d_in != null) {
      return parsed;
    }
  }
  return unknownDimensions();
}

function wayfairDimensions(html: string): Dimensions {
  const blob = firstMatch(html, [
    /Overall Dimensions[^<\d]{0,40}([^<\n]{5,100})/i,
    /"overallDimensions"\s*:\s*"([^"]+)"/i,
    /"dimensions"\s*:\s*"([^"]+)"/i,
  ]);
  if (blob) return parseDimensionsFromText(blob);
  return unknownDimensions();
}

function etsyDimensions(html: string): Dimensions {
  const blob = firstMatch(html, [
    /Item details[\s\S]{0,400}?Dimensions?\s*<\/[a-z0-9]+>\s*<[^>]+>([^<]+)/i,
    /"dimensions"\s*:\s*"([^"]+)"/i,
  ]);
  if (blob) return parseDimensionsFromText(blob);
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
  return merged;
}

function hasCompleteDimensions(d: Dimensions): boolean {
  return d.h_in != null && d.w_in != null && d.d_in != null;
}

/**
 * Scrape a retailer PDP for dimensions.
 * Pipeline (general → specific):
 *   1) schema.org JSON-LD
 *   2) labeled measurement tables/JSON (works across IKEA and similar)
 *   3) retailer-specific fallbacks
 */
export async function scrapeRetailerDimensions(
  productUrl: string,
  retailer: string,
  existing?: Dimensions
): Promise<Dimensions> {
  const current = existing ?? unknownDimensions();
  if (hasCompleteDimensions(current)) return current;

  const html = await fetchProductHtml(productUrl);
  if (!html) return current;

  let scraped = dimensionsFromJsonLd(html);
  scraped = mergeDimensions(scraped, dimensionsFromLabeledHtml(html));

  if (!hasCompleteDimensions(scraped)) {
    scraped = mergeDimensions(
      scraped,
      retailerSpecificDimensions(html, retailer)
    );
  }

  return mergeDimensions(current, scraped);
}
