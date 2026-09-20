import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const fetchPublicImage = vi.hoisted(() => vi.fn());
const segmentProductCutout = vi.hoisted(() => vi.fn());
vi.mock("./productSegmentation", () => ({ segmentProductCutout }));
vi.mock("./remoteImage", () => ({ fetchPublicImage }));
let cache: string;
let cutout: typeof import("./cutout");
let placeholder: typeof import("./placeholder");
beforeAll(async () => {
  cache = await mkdtemp(path.join(os.tmpdir(), "pixx-cutout-test-"));
  vi.stubEnv("PLACEHOLDER_CACHE_DIR", cache);
  cutout = await import("./cutout");
  placeholder = await import("./placeholder");
});
beforeEach(() => { fetchPublicImage.mockReset(); segmentProductCutout.mockReset().mockResolvedValue(null); });
afterAll(async () => { vi.unstubAllEnvs(); await rm(cache, { recursive: true, force: true }); });

async function packshot() {
  const product = await sharp({ create: { width: 40, height: 70, channels: 4, background: "#708090" } }).png().toBuffer();
  return sharp({ create: { width: 128, height: 128, channels: 4, background: "white" } })
    .composite([{ input: product, left: 44, top: 29 }]).png().toBuffer();
}

describe("listing cutout cache", () => {
  it("ignores old opaque cache entries and preserves actual metrics on a repeat hit", async () => {
    const imageUrl = "https://example.com/versioned-chair.png";
    const oldKey = createHash("sha256").update(`cutout:${imageUrl}`).digest("hex");
    const bytes = await packshot();
    await placeholder.writeCacheEntry(oldKey, bytes, {
      widthRatio: 1, category: "listing", source: "generated", width: 128, height: 128, createdAt: 0,
    });
    fetchPublicImage.mockResolvedValue(bytes);
    const first = await cutout.cutoutFromListing(imageUrl);
    expect(first).not.toBeNull();
    expect(first!.url).not.toContain(oldKey);
    expect(first!.keyed).toBe(true);
    expect(first!.version).toBe("white-matte-v7");
    expect(first!.keyedRatio).toBeLessThan(1);
    expect(first!.trimmedRatio).toBeLessThan(1);
    expect(first!.widthRatio).toBeCloseTo(42 / 72);
    const second = await cutout.cutoutFromListing(imageUrl);
    expect(second).toEqual(first);
    expect(fetchPublicImage).toHaveBeenCalledTimes(1);
  });
  it("refuses a complex background rather than caching an opaque fallback", async () => {
    const imageUrl = "https://example.com/lifestyle.jpg";
    fetchPublicImage.mockResolvedValue(await sharp({ create: { width: 128, height: 128, channels: 3, background: "#668877" } }).png().toBuffer());
    expect(await cutout.cutoutFromListing(imageUrl)).toBeNull();
    expect(await cutout.cutoutFromListing(imageUrl)).toBeNull();
    expect(fetchPublicImage).toHaveBeenCalledTimes(2);
  });
  it("segments a coloured photo and caches the transparent result", async () => {
    const imageUrl = "https://example.com/coloured-lamp.jpg";
    fetchPublicImage.mockResolvedValue(await sharp({ create: { width: 128, height: 128, channels: 3, background: "#886655" } }).png().toBuffer());
    const png = await packshot();
    segmentProductCutout.mockResolvedValue({ png, width: 40, height: 70, keyedRatio: 0.7, trimmedRatio: 0.4 });
    const first = await cutout.cutoutFromListing(imageUrl);
    expect(first).toMatchObject({ keyed: true, widthRatio: 40 / 70, keyedRatio: 0.7 });
    expect(segmentProductCutout).toHaveBeenCalledTimes(1);
    expect(await cutout.cutoutFromListing(imageUrl)).toEqual(first);
    expect(segmentProductCutout).toHaveBeenCalledTimes(1);
  });
  it("uses a semantic matte for white gaps while retaining the whole product", async () => {
    const pixels = Buffer.alloc(128 * 128 * 4, 255);
    for (let y = 30; y < 100; y++) for (let x = 24; x < 104; x++) {
      if (x < 30 || x >= 98 || y < 38 || y >= 94) pixels.set([120, 70, 30, 255], (y * 128 + x) * 4);
    }
    fetchPublicImage.mockResolvedValue(await sharp(pixels, { raw: { width: 128, height: 128, channels: 4 } }).png().toBuffer());
    const refined = { png: await packshot(), width: 80, height: 70, keyedRatio: 0.85, trimmedRatio: 0.34 };
    segmentProductCutout.mockResolvedValue(refined);
    const cut = await cutout.cutoutFromListing("https://example.com/white-gaps-table.jpg");
    expect(segmentProductCutout).toHaveBeenCalledTimes(1);
    expect(cut).toMatchObject({ widthRatio: 80 / 70, keyedRatio: 0.85 });
  });
  it("accepts the full product when removing retained background shrinks the bounds", async () => {
    // The border mask keeps an off-white floor around a smaller table. The
    // semantic mask correctly removes that floor and its enlarged bounds.
    const pixels = Buffer.alloc(128 * 128 * 4, 255);
    for (let y = 20; y < 110; y++) for (let x = 15; x < 115; x++) {
      const table = x >= 25 && x < 105 && y >= 30 && y < 90 &&
        (x < 30 || x >= 100 || y < 37);
      pixels.set(table ? [30, 30, 30, 255] : [230, 230, 230, 255], (y * 128 + x) * 4);
    }
    fetchPublicImage.mockResolvedValue(await sharp(pixels, { raw: { width: 128, height: 128, channels: 4 } }).png().toBuffer());
    segmentProductCutout.mockResolvedValue({ png: await packshot(), width: 80, height: 60, keyedRatio: 0.9, trimmedRatio: 0.3 });
    const cut = await cutout.cutoutFromListing("https://example.com/table-with-floor.jpg");
    expect(segmentProductCutout).toHaveBeenCalledTimes(1);
    expect(cut).toMatchObject({ widthRatio: 80 / 60, keyedRatio: 0.9 });
  });
  it("keeps the whole product when refinement returns only a small part", async () => {
    const product = await sharp({ create: { width: 40, height: 70, channels: 3, background: "#eeeeee" } }).png().toBuffer();
    fetchPublicImage.mockResolvedValue(await sharp({ create: { width: 128, height: 128, channels: 3, background: "white" } }).composite([{ input: product, left: 40, top: 20 }]).png().toBuffer());
    segmentProductCutout.mockResolvedValue({ png: await packshot(), width: 20, height: 15, keyedRatio: 0.9, trimmedRatio: 0.1 });
    const cut = await cutout.cutoutFromListing("https://example.com/white-product-whole.jpg");
    expect(cut!.widthRatio).toBeCloseTo(42 / 72);
  });
  it("does not fetch unsupported URLs or create a cutout from an unavailable photo", async () => {
    expect(await cutout.cutoutFromListing("file:///private/photo.png")).toBeNull();
    expect(fetchPublicImage).not.toHaveBeenCalled();
    fetchPublicImage.mockResolvedValue(null);
    expect(await cutout.cutoutFromListing("https://example.com/missing.png")).toBeNull();
  });
});
