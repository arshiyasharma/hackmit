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
    expect(first!.keyedRatio).toBeLessThan(1);
    expect(first!.trimmedRatio).toBeLessThan(1);
    expect(first!.widthRatio).toBeCloseTo(40 / 70);
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
  it("does not fetch unsupported URLs or create a cutout from an unavailable photo", async () => {
    expect(await cutout.cutoutFromListing("file:///private/photo.png")).toBeNull();
    expect(fetchPublicImage).not.toHaveBeenCalled();
    fetchPublicImage.mockResolvedValue(null);
    expect(await cutout.cutoutFromListing("https://example.com/missing.png")).toBeNull();
  });
});
