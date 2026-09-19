export type Dimensions = {
  h_in: number | null;
  w_in: number | null;
  d_in: number | null;
  estimated: boolean;
};

export function unknownDimensions(): Dimensions {
  return {
    h_in: null,
    w_in: null,
    d_in: null,
    estimated: true,
  };
}

function toInches(value: number, unit: "in" | "cm"): number {
  const inches = unit === "cm" ? value / 2.54 : value;
  return Math.round(inches * 100) / 100;
}

function parseUnit(raw: string | undefined): "in" | "cm" | null {
  if (!raw) return null;
  const u = raw.toLowerCase();
  if (u.startsWith("cm") || u.includes("centimeter")) return "cm";
  if (
    u.startsWith("in") ||
    u.includes("″") ||
    u.includes('"') ||
    u.includes("'") ||
    u.includes("′")
  ) {
    return "in";
  }
  return null;
}

function hasAnyDim(d: Dimensions): boolean {
  return d.h_in != null || d.w_in != null || d.d_in != null;
}

/**
 * Parse HxWxD-style dimensions from free text.
 * Returns unknown/estimated dimensions when nothing reliable is found.
 * Does not invent values.
 */
export function parseDimensionsFromText(
  text: string | null | undefined
): Dimensions {
  if (!text || typeof text !== "string") return unknownDimensions();

  const labeled = parseLabeledDimensions(text);
  if (labeled && hasAnyDim(labeled)) return labeled;

  const triple = parseTripleDimensions(text);
  if (triple && hasAnyDim(triple)) return triple;

  const single = parseSingleAxisMention(text);
  if (single && hasAnyDim(single)) return single;

  return unknownDimensions();
}

/** Merge multiple text sources; first reliable parse wins per axis. */
export function parseDimensionsFromTexts(
  texts: Array<string | null | undefined>
): Dimensions {
  const merged: Dimensions = unknownDimensions();
  let found = false;

  for (const text of texts) {
    const parsed = parseDimensionsFromText(text);
    if (!hasAnyDim(parsed)) continue;
    found = true;
    if (merged.h_in == null && parsed.h_in != null) merged.h_in = parsed.h_in;
    if (merged.w_in == null && parsed.w_in != null) merged.w_in = parsed.w_in;
    if (merged.d_in == null && parsed.d_in != null) merged.d_in = parsed.d_in;
  }

  if (!found) return unknownDimensions();
  merged.estimated = false;
  return merged;
}

export type FeatureKV = { title?: string | null; value?: string | null };

/**
 * Map SerpAPI immersive `about_the_product.features` into dimensions.
 * e.g. Length: 81″ long, Depth: 34″ deep, Height: 34″
 */
export function parseDimensionsFromFeatures(
  features: FeatureKV[] | null | undefined
): Dimensions {
  if (!Array.isArray(features) || features.length === 0) {
    return unknownDimensions();
  }

  const found: Partial<Record<"h" | "w" | "d", number>> = {};

  for (const feature of features) {
    const title = (feature.title || "").toLowerCase().trim();
    const value = feature.value || "";
    if (!title || !value) continue;

    const numberMatch = value.match(/(\d+(?:\.\d+)?)/);
    if (!numberMatch) continue;
    const amount = Number(numberMatch[1]);
    if (!Number.isFinite(amount)) continue;

    const unit: "in" | "cm" = /cm/i.test(value) ? "cm" : "in";
    const inches = toInches(amount, unit);

    if (
      title === "height" ||
      title.includes("overall height") ||
      title === "h"
    ) {
      found.h = inches;
    } else if (
      title === "width" ||
      title === "length" ||
      title.includes("overall width") ||
      title.includes("overall length") ||
      title === "w"
    ) {
      // Furniture "Length" is typically the left-right width.
      found.w = inches;
    } else if (
      title === "depth" ||
      title.includes("overall depth") ||
      title === "d"
    ) {
      found.d = inches;
    } else {
      // Fall back: parse labeled patterns inside the value string.
      const fromValue = parseDimensionsFromText(`${title} ${value}`);
      if (fromValue.h_in != null) found.h = fromValue.h_in;
      if (fromValue.w_in != null) found.w = fromValue.w_in;
      if (fromValue.d_in != null) found.d = fromValue.d_in;
    }
  }

  if (found.h == null && found.w == null && found.d == null) {
    return unknownDimensions();
  }

  return {
    h_in: found.h ?? null,
    w_in: found.w ?? null,
    d_in: found.d ?? null,
    estimated: false,
  };
}

/**
 * e.g. 32" H x 78" W x 34" D
 *      81.5'' W x 34'' H x 35'' D
 *      13.8"D x 15.8"W x 23.7"H
 *      11.8" L x 11.8" W x 19" H
 *      Dimensions: 34 H x 81 W x 35 D
 */
function parseLabeledDimensions(text: string): Dimensions | null {
  // Unit may be glued to the axis letter (`13.8"D`).
  const re =
    /(\d+(?:\.\d+)?)\s*(cm|centimeters?|in(?:ches)?|["”″'′]{1,2})?\s*([HhWwDdLl])\b/gi;
  const found: Partial<Record<"h" | "w" | "d", number>> = {};
  const letters: Array<"h" | "w" | "d" | "l"> = [];
  const values: number[] = [];
  let unit: "in" | "cm" = "in";
  let match: RegExpExecArray | null;

  while ((match = re.exec(text)) !== null) {
    const value = Number(match[1]);
    if (!Number.isFinite(value)) continue;
    const parsedUnit = parseUnit(match[2]);
    if (parsedUnit) unit = parsedUnit;
    const label = match[3].toLowerCase() as "h" | "w" | "d" | "l";
    const inches = toInches(value, unit);
    letters.push(label);
    values.push(inches);
  }

  if (letters.length < 2) return null;

  // L×W×H (no D) → length×width×height where width is the other horizontal (depth).
  const set = new Set(letters);
  if (set.has("l") && set.has("w") && set.has("h") && !set.has("d") && letters.length === 3) {
    const by: Partial<Record<"l" | "w" | "h", number>> = {};
    letters.forEach((lab, i) => {
      if (lab === "l" || lab === "w" || lab === "h") by[lab] = values[i];
    });
    return {
      h_in: by.h ?? null,
      w_in: by.l ?? null,
      d_in: by.w ?? null,
      estimated: false,
    };
  }

  letters.forEach((label, i) => {
    const inches = values[i]!;
    if (label === "h") found.h = inches;
    else if (label === "w") found.w = inches;
    else if (label === "d") found.d = inches;
    else if (label === "l") {
      // Lone/paired length without the L×W×H special-case → width.
      if (found.w == null) found.w = inches;
      else if (found.d == null) found.d = inches;
    }
  });

  if (found.h == null && found.w == null && found.d == null) return null;

  return {
    h_in: found.h ?? null,
    w_in: found.w ?? null,
    d_in: found.d ?? null,
    estimated: false,
  };
}

/** e.g. 32 x 78 x 34 inches  or  81 × 198 × 86 cm */
function parseTripleDimensions(text: string): Dimensions | null {
  const re =
    /(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*(cm|centimeters?|in(?:ches)?|["”″'′]{1,2})?/i;
  const match = text.match(re);
  if (!match) return null;

  const a = Number(match[1]);
  const b = Number(match[2]);
  const c = Number(match[3]);
  if (![a, b, c].every(Number.isFinite)) return null;

  const unit = parseUnit(match[4]) ?? "in";

  // Convention when unlabeled: H x W x D
  return {
    h_in: toInches(a, unit),
    w_in: toInches(b, unit),
    d_in: toInches(c, unit),
    estimated: false,
  };
}

/** e.g. 80.3" Wide  /  84'' long  /  34" deep */
function parseSingleAxisMention(text: string): Dimensions | null {
  const patterns: Array<{ re: RegExp; axis: "h" | "w" | "d" }> = [
    {
      re: /(\d+(?:\.\d+)?)\s*(?:["”″'′]{1,2}|in(?:ches)?|cm)?\s*(?:wide|width|long|length)\b/i,
      axis: "w",
    },
    {
      re: /(\d+(?:\.\d+)?)\s*(?:["”″'′]{1,2}|in(?:ches)?|cm)?\s*(?:high|height|tall)\b/i,
      axis: "h",
    },
    {
      re: /(\d+(?:\.\d+)?)\s*(?:["”″'′]{1,2}|in(?:ches)?|cm)?\s*(?:deep|depth)\b/i,
      axis: "d",
    },
  ];

  const found: Partial<Record<"h" | "w" | "d", number>> = {};
  for (const { re, axis } of patterns) {
    const match = text.match(re);
    if (!match) continue;
    const value = Number(match[1]);
    if (!Number.isFinite(value)) continue;
    const unit: "in" | "cm" = /cm/i.test(match[0]) ? "cm" : "in";
    found[axis] = toInches(value, unit);
  }

  if (found.h == null && found.w == null && found.d == null) return null;

  return {
    h_in: found.h ?? null,
    w_in: found.w ?? null,
    d_in: found.d ?? null,
    estimated: false,
  };
}

/** Map SerpAPI store offer strings to stock when reliable. */
export function parseInStockFromOffers(
  offers: string[] | null | undefined
): boolean | null {
  if (!Array.isArray(offers) || offers.length === 0) return null;
  const text = offers.join(" ").toLowerCase();
  if (/out of stock|sold out|unavailable|currently unavailable/.test(text)) {
    return false;
  }
  if (/\bin stock\b/.test(text)) {
    return true;
  }
  return null;
}
