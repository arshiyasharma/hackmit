import sharp from "sharp";

export type ProductCutout = {
  png: Buffer;
  width: number;
  height: number;
  keyedRatio: number;
  trimmedRatio: number;
  /** Pale foreground on a pale backdrop needs a semantic matte for enclosed gaps. */
  needsRefinement?: boolean;
};

const ALPHA_FLOOR = 8;
const MAX_SIDE = 1536;
// Cropped products can occupy part of the frame. Require a clear background
// majority, rather than treating every non-background border pixel as a veto.
const BORDER_CONSENSUS = 0.7;
type RGB = [number, number, number];

function distance(data: Buffer, offset: number, background: RGB): number {
  return Math.max(
    Math.abs(data[offset] - background[0]),
    Math.abs(data[offset + 1] - background[1]),
    Math.abs(data[offset + 2] - background[2]),
  );
}

/**
 * Isolate a packshot using its actual border colour. Pale pixels inside the
 * product are never globally keyed: only matching pixels connected to the
 * frame can be removed. Ambiguous photos are refused instead of being pasted
 * into the room as an opaque rectangle. No model or image provider is called.
 */
export async function extractProductCutout(input: Buffer): Promise<ProductCutout | null> {
  const { data, info } = await sharp(input, { limitInputPixels: 16_000_000 })
    .rotate()
    .resize({ width: MAX_SIDE, height: MAX_SIDE, fit: "inside", withoutEnlargement: true })
    .toColourspace("srgb")
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  if (w < 32 || h < 32 || info.channels !== 4) return null;
  const count = w * h;
  const border: number[] = [];
  for (let x = 0; x < w; x++) border.push(x, (h - 1) * w + x);
  for (let y = 1; y < h - 1; y++) border.push(y * w, y * w + w - 1);

  const transparentBorder = border.filter((i) => data[i * 4 + 3] <= ALPHA_FLOOR).length / border.length;
  const hasCutoutAlpha = transparentBorder >= 0.55;
  const outside = new Uint8Array(count);
  let background: RGB | null = null;

  if (hasCutoutAlpha) {
    // Preserve an existing alpha matte, including opaque white furniture.
    for (let i = 0; i < count; i++) outside[i] = data[i * 4 + 3] <= ALPHA_FLOOR ? 1 : 0;
  } else {
    const opaqueBorder = border.filter((i) => data[i * 4 + 3] >= 250);
    if (opaqueBorder.length < border.length * 0.9) return null;
    background = [0, 1, 2].map((c) => {
      const values = opaqueBorder.map((i) => data[i * 4 + c]).sort((a, b) => a - b);
      return values[Math.floor(values.length / 2)];
    }) as RGB;
    const differences = opaqueBorder.map((i) => distance(data, i * 4, background!)).sort((a, b) => a - b);
    // Learn noise from the dominant border colour, excluding cropped product
    // edges. Keep the tolerance narrow: widening it eats pale furniture. A
    // coloured backdrop is safe only with the same strong, flat consensus.
    const tolerance = Math.min(10, Math.max(4, differences[Math.floor(differences.length * 0.6)] + 2));
    if (differences.filter((d) => d <= tolerance).length < border.length * BORDER_CONSENSUS) return null;

    const queue = new Uint32Array(count);
    let head = 0;
    let tail = 0;
    const visit = (i: number) => {
      if (outside[i]) return;
      const offset = i * 4;
      if (data[offset + 3] > ALPHA_FLOOR && distance(data, offset, background!) > tolerance) return;
      outside[i] = 1;
      queue[tail++] = i;
    };
    for (const i of border) visit(i);
    while (head < tail) {
      const i = queue[head++];
      const x = i % w;
      if (x > 0) visit(i - 1);
      if (x + 1 < w) visit(i + 1);
      if (i >= w) visit(i - w);
      if (i + w < count) visit(i + w);
    }
  }

  let minX = w, minY = h, maxX = -1, maxY = -1;
  let foreground = 0;
  let paleForeground = 0;
  for (let i = 0; i < count; i++) {
    if (outside[i] || data[i * 4 + 3] <= ALPHA_FLOOR) continue;
    const x = i % w, y = Math.floor(i / w);
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    foreground++;
    const pixel = i * 4;
    if (Math.min(data[pixel], data[pixel + 1], data[pixel + 2]) >= 225 &&
        Math.max(data[pixel], data[pixel + 1], data[pixel + 2]) - Math.min(data[pixel], data[pixel + 1], data[pixel + 2]) <= 24) paleForeground++;
  }
  const keyedRatio = 1 - foreground / count;
  if (foreground < Math.max(24, count * 0.002) || keyedRatio < 0.1) return null;
  const width = maxX - minX + 1, height = maxY - minY + 1;
  const trimmedRatio = width * height / count;
  if (width < 4 || height < 4) return null;
  if (!hasCutoutAlpha) {
    // White padding around a rectangular lifestyle/photo card is not a matte.
    // Prefer the existing shape preview for these ambiguous, nearly full boxes.
    if (trimmedRatio > 0.4 && foreground / (width * height) > 0.985) return null;

    // Keep disconnected pieces (legs, a detached shade, a furniture set) and
    // cropped edges. They are still real product pixels on a known backdrop;
    // neither their component count nor touching the frame requires a model.
  }

  // Unmatte only the one-pixel foreground boundary, using nearby interior
  // colour to estimate coverage. Never lighten/key the white interior itself.
  const original = background ? Buffer.from(data) : data;
  for (let i = 0; i < count; i++) {
    const p = i * 4;
    if (outside[i]) { data.fill(0, p, p + 4); continue; }
    if (!background || data[p + 3] < 250) continue;
    const x = i % w, y = Math.floor(i / w);
    if (![x > 0 && outside[i - 1], x + 1 < w && outside[i + 1], y > 0 && outside[i - w], y + 1 < h && outside[i + w]].some(Boolean)) continue;
    let core = p;
    let coreDistance = distance(original, p, background);
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      if (x + dx < 0 || x + dx >= w || y + dy < 0 || y + dy >= h) continue;
      const j = i + dy * w + dx;
      if (outside[j]) continue;
      const d = distance(original, j * 4, background);
      if (d > coreDistance) { core = j * 4; coreDistance = d; }
    }
    if (coreDistance <= distance(original, p, background) + 8) continue;
    let numerator = 0, denominator = 0;
    for (let c = 0; c < 3; c++) {
      const delta = background[c] - original[core + c];
      numerator += (background[c] - original[p + c]) * delta;
      denominator += delta * delta;
    }
    const alpha = Math.max(0.05, Math.min(1, numerator / (denominator || 1)));
    if (alpha >= 0.98) continue;
    for (let c = 0; c < 3; c++) data[p + c] = Math.round(Math.max(0, Math.min(255, (original[p + c] - background[c] * (1 - alpha)) / alpha)));
    data[p + 3] = Math.round(alpha * original[p + 3]);
  }

  // A rectangular product can occupy its entire tight crop. Preserve a tiny
  // transparent rim in that case, rather than returning an all-opaque PNG.
  let transparentInCrop = false;
  for (let y = minY; y <= maxY && !transparentInCrop; y++) {
    for (let x = minX; x <= maxX; x++) {
      if (data[(y * w + x) * 4 + 3] < 250) { transparentInCrop = true; break; }
    }
  }
  const padding = transparentInCrop ? 0 : 1;
  let output = sharp(data, { raw: { width: w, height: h, channels: 4 } })
    .extract({ left: minX, top: minY, width, height });
  if (padding) output = output.extend({
    top: padding, bottom: padding, left: padding, right: padding,
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  });
  const png = await output.png({ compressionLevel: 6 }).toBuffer();
  const needsRefinement = !hasCutoutAlpha && !!background && Math.min(...background) >= 210 &&
    paleForeground >= Math.max(12, foreground * 0.01);
  return { png, width: width + padding * 2, height: height + padding * 2, keyedRatio, trimmedRatio, needsRefinement };
}
