import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import * as ort from "onnxruntime-node";
import sharp from "sharp";
import type { ProductCutout } from "./productCutout";

type ModelSpec = { file: string; url: string; checksum: string; hash: "sha256" | "md5"; side: number; logits: boolean };
// The 512 export keeps inference around one second on the local CPU. Both
// models mask the original listing pixels; neither generates a replacement.
const FAST_MODEL: ModelSpec = {
  file: "birefnet-lite-512.onnx", side: 512, logits: true, hash: "sha256",
  url: "https://huggingface.co/studioludens/birefnet-lite-512/resolve/4a3c40c36c94093cc1e724d9ea428b8fa4b57dc7/onnx/model.onnx",
  checksum: "1cb0fb360dadd15af77c639085d77a9df67db0c64315560c3de005f676345ac2",
};
const FALLBACK_MODEL: ModelSpec = {
  file: "u2net.onnx", side: 320, logits: false, hash: "md5",
  url: "https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2net.onnx",
  checksum: "60024c5c889badc19c04ad937298a77b",
};
type Runtime = { sessions: Map<string, Promise<ort.InferenceSession>>; tail: Promise<unknown>; queued: number };
// Keep the native sessions through development hot reloads as well as requests.
const host = globalThis as typeof globalThis & { __pixxCutout512?: Runtime };
const runtime = host.__pixxCutout512 ??= { sessions: new Map(), tail: Promise.resolve(), queued: 0 };

async function modelBytes(spec: ModelSpec): Promise<Buffer> {
  const override = spec === FAST_MODEL ? process.env.CUTOUT_MODEL_PATH : undefined;
  const modelPath = override ?? path.join(/* turbopackIgnore: true */
    process.env.PLACEHOLDER_CACHE_DIR ?? path.join(/* turbopackIgnore: true */ process.cwd(), ".placeholder-cache"), "models", spec.file,
  );
  const valid = (bytes: Buffer) => createHash(spec.hash).update(bytes).digest("hex") === spec.checksum;
  // Models are provisioned or downloaded at runtime, never bundled from a local cache.
  const cached = await readFile(/* turbopackIgnore: true */ modelPath).catch(() => null);
  if (cached && valid(cached)) return cached;
  if (override) throw new Error("CUTOUT_MODEL_PATH must point to the verified 512 model");
  const response = await fetch(spec.url, { signal: AbortSignal.timeout(20_000) });
  if (!response.ok || !response.body || Number(response.headers.get("content-length")) > 210_000_000) throw new Error("Cutout model unavailable");
  const chunks: Buffer[] = [];
  let size = 0;
  const reader = response.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 210_000_000) { await reader.cancel(); throw new Error("Cutout model too large"); }
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

function session(spec: ModelSpec) {
  let promise = runtime.sessions.get(spec.file);
  if (!promise) {
    promise = modelBytes(spec).then((bytes) => ort.InferenceSession.create(bytes, {
      executionProviders: ["cpu"], intraOpNumThreads: 2, interOpNumThreads: 1, graphOptimizationLevel: "all",
    })).catch((error) => { runtime.sessions.delete(spec.file); throw error; });
    runtime.sessions.set(spec.file, promise);
  }
  return promise;
}

/** Use the actual foreground, even when cropped or split into separate pieces. */
export async function applyProductMask(input: Buffer, mask: Float32Array, maskWidth: number, maskHeight: number): Promise<ProductCutout | null> {
  if (mask.length !== maskWidth * maskHeight || !mask.length) return null;
  let min = Infinity, max = -Infinity;
  for (const value of mask) {
    if (!Number.isFinite(value)) return null;
    min = Math.min(min, value); max = Math.max(max, value);
  }
  // Reject an absent/meaningless prediction, not an imperfect product outline.
  if (max < 0.5 || max - min < 0.2) return null;
  const matte = Buffer.from(Array.from(mask, (value) => Math.round((value - min) / (max - min) * 255)));
  const { data, info } = await sharp(input, { limitInputPixels: 16_000_000 }).rotate()
    .resize({ width: 1280, height: 1280, fit: "inside", withoutEnlargement: true })
    .toColourspace("srgb").ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const alpha = await sharp(matte, { raw: { width: maskWidth, height: maskHeight, channels: 1 } })
    .resize(width, height, { fit: "fill" }).toColourspace("b-w").raw().toBuffer();
  let minX = width, maxX = -1, minY = height, maxY = -1, foreground = 0;
  for (let i = 0; i < width * height; i++) {
    const coverage = Math.max(0, Math.min(1, (alpha[i] - 12) / 228));
    data[i * 4 + 3] = Math.round(data[i * 4 + 3] * coverage);
    if (data[i * 4 + 3] <= 8) { data.fill(0, i * 4, i * 4 + 4); continue; }
    foreground++;
    const x = i % width, y = Math.floor(i / width);
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  const area = width * height;
  if (foreground < Math.max(8, area * 0.001) || foreground > area * 0.995) return null;
  const cropWidth = maxX - minX + 1, cropHeight = maxY - minY + 1;
  if (cropWidth < 2 || cropHeight < 2) return null;
  // Rectangular products still need an actual transparent rim after trimming.
  const padding = foreground === cropWidth * cropHeight ? 1 : 0;
  let image = sharp(data, { raw: { width, height, channels: 4 } })
    .extract({ left: minX, top: minY, width: cropWidth, height: cropHeight });
  if (padding) image = image.extend({ top: 1, bottom: 1, left: 1, right: 1, background: { r: 0, g: 0, b: 0, alpha: 0 } });
  const png = await image.png({ compressionLevel: 6 }).toBuffer();
  return { png, width: cropWidth + 2 * padding, height: cropHeight + 2 * padding, keyedRatio: 1 - foreground / area, trimmedRatio: cropWidth * cropHeight / area };
}

async function predict(input: Buffer, spec: ModelSpec, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const model = await session(spec);
  signal?.throwIfAborted();
  const rgb = await sharp(input, { limitInputPixels: 16_000_000 }).rotate()
    .flatten({ background: "white" }).toColourspace("srgb").removeAlpha()
    .resize(spec.side, spec.side, { fit: "fill" }).raw().toBuffer();
  const plane = spec.side * spec.side, values = new Float32Array(3 * plane);
  let divisor = 255;
  if (!spec.logits) { divisor = 1; for (const value of rgb) divisor = Math.max(divisor, value); }
  const mean = [0.485, 0.456, 0.406], std = [0.229, 0.224, 0.225];
  for (let c = 0; c < 3; c++) for (let i = 0; i < plane; i++) values[c * plane + i] = (rgb[i * 3 + c] / divisor - mean[c]) / std[c];
  signal?.throwIfAborted();
  const outputs = await model.run({ [model.inputNames[0]]: new ort.Tensor("float32", values, [1, 3, spec.side, spec.side]) });
  signal?.throwIfAborted();
  const mask = outputs[model.outputNames[0]];
  if (!(mask.data instanceof Float32Array)) return null;
  const probabilities = new Float32Array(mask.data.length);
  for (let i = 0; i < probabilities.length; i++) {
    const value = Number(mask.data[i]);
    probabilities[i] = spec.logits ? 1 / (1 + Math.exp(-value)) : value;
  }
  let foreground = 0, edge = 0;
  const width = Number(mask.dims[3]), height = Number(mask.dims[2]);
  for (let i = 0; i < probabilities.length; i++) if (probabilities[i] > 0.5) {
    foreground++;
    if (i < width || i >= width * (height - 1) || i % width === 0 || i % width === width - 1) edge++;
  }
  return { cut: await applyProductMask(input, probabilities, width, height), touchesEdge: edge > 4, foreground };
}

/** Fast CPU segmentation, with a second lightweight mask for difficult photos. */
export async function segmentProductCutout(input: Buffer, signal?: AbortSignal): Promise<ProductCutout | null> {
  signal?.throwIfAborted();
  if (runtime.queued >= 6) throw new Error("Product photo processor busy; retry shortly");
  runtime.queued++;
  const inference = runtime.tail.then(async () => {
    signal?.throwIfAborted();
    const first = await predict(input, FAST_MODEL, signal).catch(() => {
      signal?.throwIfAborted();
      return null;
    });
    if (first?.cut && !first.touchesEdge) return first.cut;
    // A different lightweight model can recover a lamp against a similar wall.
    // A cropped but usable first matte is kept if the fallback has no subject.
    const fallback = await predict(input, FALLBACK_MODEL, signal).catch((error) => {
      signal?.throwIfAborted();
      if (first?.cut) return null;
      throw error;
    });
    return fallback?.cut ?? first?.cut ?? null;
  });
  runtime.tail = inference.catch(() => {});
  try { return await inference; } finally { runtime.queued--; }
}
