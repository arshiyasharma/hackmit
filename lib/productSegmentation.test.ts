import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { applyProductMask, segmentProductCutout } from "./productSegmentation";

describe("product model matte", () => {
  it("keeps original product colours, removes the background, and trims without channel striping", async () => {
    const pixels = Buffer.alloc(64 * 64 * 4);
    for (let i = 0; i < 64 * 64; i++) pixels.set([170, 65, 40, 255], i * 4);
    const photo = await sharp(pixels, { raw: { width: 64, height: 64, channels: 4 } }).png().toBuffer();
    const mask = new Float32Array(64 * 64);
    // L-shaped product: its inset corner must stay transparent after trimming.
    for (let y = 12; y < 52; y++) for (let x = 16; x < 40; x++) if (x < 24 || y >= 40) mask[y * 64 + x] = 1;
    const result = await applyProductMask(photo, mask, 64, 64);
    expect(result).not.toBeNull();
    expect([result!.width, result!.height]).toEqual([24, 40]);
    const { data, info } = await sharp(result!.png).raw().toBuffer({ resolveWithObject: true });
    expect(info.channels).toBe(4);
    for (let y = 0; y < 40; y++) expect([...data.subarray(y * 24 * 4, y * 24 * 4 + 4)]).toEqual([170, 65, 40, 255]);
    expect(data[(10 * 24 + 20) * 4 + 3]).toBe(0);
  });
  it("does not amplify uncertain masks but accepts separated foreground pieces", async () => {
    const photo = await sharp({ create: { width: 64, height: 64, channels: 3, background: "#774422" } }).png().toBuffer();
    const weak = new Float32Array(64 * 64).fill(0.03);
    for (let y = 12; y < 52; y++) for (let x = 16; x < 40; x++) weak[y * 64 + x] = 0.05;
    expect(await applyProductMask(photo, weak, 64, 64)).toBeNull();
    const double = new Float32Array(64 * 64);
    for (let y = 12; y < 52; y++) for (const left of [10, 42]) for (let x = left; x < left + 12; x++) double[y * 64 + x] = 1;
    expect(await applyProductMask(photo, double, 64, 64)).not.toBeNull();
  });
  it("skips cancelled extraction before loading a model", async () => {
    await expect(segmentProductCutout(Buffer.alloc(0), AbortSignal.abort())).rejects.toThrow();
  });
  it("keeps a usable cropped product instead of falling back to an illustration", async () => {
    const photo = await sharp({ create: { width: 64, height: 64, channels: 3, background: "#774422" } }).png().toBuffer();
    const cropped = new Float32Array(64 * 64);
    for (let y = 12; y < 64; y++) for (let x = 22; x < 42; x++) cropped[y * 64 + x] = 1;
    const cut = await applyProductMask(photo, cropped, 64, 64);
    expect(cut).not.toBeNull();
    const { data } = await sharp(cut!.png).raw().toBuffer({ resolveWithObject: true });
    expect(data.some((value, index) => index % 4 === 3 && value === 0)).toBe(true);
  });
  it("rejects empty, uniform, non-finite and whole-photo masks", async () => {
    const photo = await sharp({ create: { width: 64, height: 64, channels: 3, background: "white" } }).png().toBuffer();
    expect(await applyProductMask(photo, new Float32Array(16), 4, 4)).toBeNull();
    expect(await applyProductMask(photo, Float32Array.of(0, NaN, 1, 0), 2, 2)).toBeNull();
    const full = new Float32Array(64 * 64).fill(1); full[0] = 0;
    expect(await applyProductMask(photo, full, 64, 64)).toBeNull();
  });
});
