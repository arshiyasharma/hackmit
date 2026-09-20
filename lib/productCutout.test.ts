import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { extractProductCutout } from "./productCutout";

type Pixel = [number, number, number, number];
const white: Pixel = [255, 255, 255, 255];
const dark: Pixel = [40, 60, 70, 255];
function inside(x: number, y: number, x0: number, y0: number, x1: number, y1: number) {
  return x >= x0 && x < x1 && y >= y0 && y < y1;
}
async function photo(pixel: (x: number, y: number) => Pixel, width = 128, height = 128) {
  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data.set(pixel(x, y), (y * width + x) * 4);
  return sharp(data, { raw: { width, height, channels: 4 } }).png().toBuffer();
}
async function pixels(png: Buffer) {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { at: (x: number, y: number) => Array.from(data.subarray((y * info.width + x) * 4, (y * info.width + x) * 4 + 4)), ...info };
}

describe("listing-photo extraction", () => {
  it("removes connected white around a product while preserving its natural bounds", async () => {
    const input = await photo((x, y) => inside(x, y, 40, 30, 88, 90) || inside(x, y, 45, 90, 51, 110) ? dark : white);
    const cut = await extractProductCutout(input);
    expect(cut).not.toBeNull();
    expect([cut!.width, cut!.height]).toEqual([48, 80]);
    const image = await pixels(cut!.png);
    expect(image.at(2, 75)[3]).toBe(0);
    expect(image.at(7, 75)).toEqual(dark);
  });
  it("keeps pale furniture that the old 200..236 white key consumed", async () => {
    const pale: Pixel = [235, 236, 237, 255];
    const cut = await extractProductCutout(await photo((x, y) => inside(x, y, 35, 30, 93, 98) ? pale : white));
    expect(cut).not.toBeNull();
    expect((await pixels(cut!.png)).at(28, 30)).toEqual(pale);
  });
  it("preserves pure white surfaces enclosed by a product edge", async () => {
    const cut = await extractProductCutout(await photo((x, y) => {
      if (inside(x, y, 35, 30, 93, 98)) return inside(x, y, 38, 33, 90, 95) ? white : dark;
      return white;
    }));
    expect(cut).not.toBeNull();
    expect((await pixels(cut!.png)).at(28, 30)).toEqual(white);
  });
  it("learns an off-white background without removing a white object", async () => {
    const background: Pixel = [244, 240, 232, 255];
    const cut = await extractProductCutout(await photo((x, y) => inside(x, y, 35, 30, 93, 98) ? white : background));
    expect(cut).not.toBeNull();
    expect((await pixels(cut!.png)).at(28, 30)).toEqual(white);
    expect(cut!.keyedRatio).toBeCloseTo(1 - 58 * 68 / (128 * 128));
  });
  it("tolerates small neutral JPEG-like background noise without leaving speckles", async () => {
    const cut = await extractProductCutout(await photo((x, y) => {
      if (inside(x, y, 40, 30, 88, 90)) return dark;
      const shade = 252 + (x + y) % 4;
      return [shade, shade, shade, 255];
    }));
    expect(cut).not.toBeNull();
    expect([cut!.width, cut!.height]).toEqual([48, 60]);
  });
  it("keeps a slender lamp even when almost all of its frame is background", async () => {
    const cut = await extractProductCutout(await photo((x, y) => inside(x, y, 63, 15, 65, 107) || inside(x, y, 53, 107, 75, 111) ? dark : white));
    expect(cut).not.toBeNull();
    expect(cut!.keyedRatio).toBeGreaterThan(0.98);
    expect([cut!.width, cut!.height]).toEqual([22, 96]);
  });
  it("unmattes antialiased boundary pixels instead of leaving a white fringe", async () => {
    const edge: Pixel = [148, 158, 163, 255];
    const cut = await extractProductCutout(await photo((x, y) => {
      if (!inside(x, y, 40, 30, 88, 90)) return white;
      return x === 40 || x === 87 || y === 30 || y === 89 ? edge : dark;
    }));
    const rgba = (await pixels(cut!.png)).at(0, 30);
    expect(rgba[3]).toBeGreaterThan(120);
    expect(rgba[3]).toBeLessThan(140);
    expect(rgba[0]).toBeLessThan(45);
    expect(rgba[1]).toBeLessThan(65);
    expect(rgba[2]).toBeLessThan(75);
  });
  it("preserves existing transparency and white objects without rekeying them", async () => {
    const cut = await extractProductCutout(await photo((x, y) => {
      if (inside(x, y, 35, 30, 93, 98)) return x === 35 ? [255, 255, 255, 128] : white;
      return [0, 0, 0, 0];
    }));
    expect(cut).not.toBeNull();
    const image = await pixels(cut!.png);
    expect(image.at(0, 30)).toEqual([255, 255, 255, 128]);
    expect(image.at(28, 30)).toEqual(white);
  });
  it("rejects blank backgrounds and objects cut off by the frame", async () => {
    expect(await extractProductCutout(await photo(() => white))).toBeNull();
    expect(await extractProductCutout(await photo((x, y) => inside(x, y, 45, 0, 83, 80) ? dark : white))).toBeNull();
  });
  it("rejects lifestyle photos and white-padded opaque photo rectangles", async () => {
    expect(await extractProductCutout(await photo((x, y) => [100 + x % 100, 120 + y % 100, 150, 255]))).toBeNull();
    expect(await extractProductCutout(await photo((x, y) => inside(x, y, 15, 15, 113, 113) ? [100 + x % 100, 120 + y % 100, 150, 255] : white))).toBeNull();
  });
  it("rejects collages with more than one substantial isolated object", async () => {
    expect(await extractProductCutout(await photo((x, y) => inside(x, y, 15, 25, 50, 105) || inside(x, y, 78, 25, 113, 105) ? dark : white))).toBeNull();
  });
});
