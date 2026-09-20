import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import * as ort from "onnxruntime-node";
import sharp from "sharp";
import type { ProductCutout } from "./productCutout";

// U²-Net (Apache-2.0), distributed by rembg. Fixed artifact + published checksum.
// The model runs locally: listing pixels are masked, never regenerated.
const MODEL_URL = "https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2net.onnx";
const MODEL_MD5 = "60024c5c889badc19c04ad937298a77b";
const SIDE = 320;
let sessionPromise: Promise<ort.InferenceSession> | undefined;
let inferenceTail: Promise<unknown> = Promise.resolve();

async function modelBytes(): Promise<Buffer> {
  const modelPath = process.env.CUTOUT_MODEL_PATH ?? path.join(
    process.env.PLACEHOLDER_CACHE_DIR ?? path.join(process.cwd(), ".placeholder-cache"),
    "models", "u2net.onnx",
  );
  const valid = (bytes: Buffer) => createHash("md5").update(bytes).digest("hex") === MODEL_MD5;
  const cached = await readFile(modelPath).catch(() => null);
  if (cached && valid(cached)) return cached;
  if (process.env.CUTOUT_MODEL_PATH) throw new Error("Invalid CUTOUT_MODEL_PATH model/checksum");

  const response = await fetch(MODEL_URL, { signal: AbortSignal.timeout(55_000) });
  if (!response.ok || !response.body || Number(response.headers.get("content-length")) > 200_000_000) {
    throw new Error("Cutout model download unavailable");
  }
  const chunks: Buffer[] = [];
  let size = 0;
  const reader = response.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 200_000_000) { await reader.cancel(); throw new Error("Cutout model too large"); }
      chunks.push(Buffer.from(value));
    }
  } finally { reader.releaseLock(); }
  const bytes = Buffer.concat(chunks, size);
  if (!valid(bytes)) throw new Error("Cutout model checksum mismatch");
  await mkdir(path.dirname(modelPath), { recursive: true });
  const temporary = `${modelPath}.${randomUUID()}.tmp`;
  try { await writeFile(temporary, bytes); await rename(temporary, modelPath); }
  finally { await rm(temporary, { force: true }); }
  return bytes;
}

function session() {
  sessionPromise ??= modelBytes().then((bytes) => ort.InferenceSession.create(bytes, {
    executionProviders: ["cpu"], intraOpNumThreads: 2, interOpNumThreads: 1,
    graphOptimizationLevel: "all",
  })).catch((error) => { sessionPromise = undefined; throw error; });
  return sessionPromise;
}

/** Apply an actual alpha matte to the original pixels, then trim the object. */
export async function applyProductMask(input: Buffer, mask: Float32Array, maskWidth: number, maskHeight: number): Promise<ProductCutout | null> {
  if (mask.length !== maskWidth * maskHeight || !mask.length) return null;
  let min = Infinity, max = -Infinity;
  for (const value of mask) {
    if (!Number.isFinite(value)) return null;
    min = Math.min(min, value); max = Math.max(max, value);
  }
  if (max - min < 0.01) return null;
  const matte = Buffer.from(Array.from(mask, (value) => Math.round((value - min) / (max - min) * 255)));
  const { data, info } = await sharp(input, { limitInputPixels: 16_000_000 }).rotate()
    .resize({ width: 1536, height: 1536, fit: "inside", withoutEnlargement: true })
    .toColourspace("srgb").ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const alpha = await sharp(matte, { raw: { width: maskWidth, height: maskHeight, channels: 1 } })
    .resize(width, height, { fit: "fill" }).toColourspace("b-w").raw().toBuffer();
  let minX = width, maxX = -1, minY = height, maxY = -1, foreground = 0, solid = 0;
  for (let i = 0; i < width * height; i++) {
    // Remove low-confidence background haze; retain antialiased object edges.
    const coverage = Math.max(0, Math.min(1, (alpha[i] - 16) / 224));
    data[i * 4 + 3] = Math.round(data[i * 4 + 3] * coverage);
    if (data[i * 4 + 3] <= 8) { data.fill(0, i * 4, i * 4 + 4); continue; }
    foreground++;
    if (data[i * 4 + 3] >= 200) solid++;
    const x = i % width, y = Math.floor(i / width);
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  const area = width * height;
  if (foreground < area * 0.004 || foreground > area * 0.9 || solid < foreground * 0.3) return null;
  const cropWidth = maxX - minX + 1, cropHeight = maxY - minY + 1;
  if (cropWidth < 4 || cropHeight < 4) return null;
  const png = await sharp(data, { raw: { width, height, channels: 4 } })
    .extract({ left: minX, top: minY, width: cropWidth, height: cropHeight }).png().toBuffer();
  return { png, width: cropWidth, height: cropHeight, keyedRatio: 1 - foreground / area, trimmedRatio: cropWidth * cropHeight / area };
}

/** Fallback for coloured/lifestyle backgrounds rejected by the packshot extractor. */
export async function segmentProductCutout(input: Buffer): Promise<ProductCutout | null> {
  const model = await session();
  const rgb = await sharp(input, { limitInputPixels: 16_000_000 }).rotate()
    .flatten({ background: "white" }).toColourspace("srgb").removeAlpha()
    .resize(SIDE, SIDE, { fit: "fill" }).raw().toBuffer();
  const plane = SIDE * SIDE;
  const values = new Float32Array(3 * plane);
  let maximum = 1;
  for (const value of rgb) maximum = Math.max(maximum, value);
  const mean = [0.485, 0.456, 0.406], std = [0.229, 0.224, 0.225];
  for (let c = 0; c < 3; c++) for (let i = 0; i < plane; i++) {
    values[c * plane + i] = (rgb[i * 3 + c] / maximum - mean[c]) / std[c];
  }
  // Reuse one model and serialize CPU inference instead of allocating a model per request.
  const inference = inferenceTail.then(() => model.run({ [model.inputNames[0]]: new ort.Tensor("float32", values, [1, 3, SIDE, SIDE]) }));
  inferenceTail = inference.catch(() => {});
  const outputs = await inference;
  const mask = outputs[model.outputNames[0]];
  if (!(mask.data instanceof Float32Array)) return null;
  return applyProductMask(input, mask.data, Number(mask.dims[3]), Number(mask.dims[2]));
}
