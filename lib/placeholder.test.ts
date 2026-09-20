import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const spawn = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ spawn }));
let cache: string;
let library: typeof import("./placeholder");
beforeAll(async () => {
  cache = await mkdtemp(path.join(os.tmpdir(), "pixxar-placeholder-test-"));
  vi.stubEnv("PLACEHOLDER_CACHE_DIR", cache);
  vi.stubEnv("PLACEHOLDER_DISABLE_GENERATION", "0");
  library = await import("./placeholder");
});
afterAll(async () => { vi.unstubAllEnvs(); await rm(cache, { recursive: true, force: true }); });

describe("placeholder fallback", () => {
  it("produces a usable cached transparent sprite when the generator fails", async () => {
    spawn.mockImplementation(() => {
      const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn() });
      queueMicrotask(() => child.emit("error", new Error("dummy unavailable generator")));
      return child;
    });
    const result = await library.resolvePlaceholder({ category: "floor lamp", roomContext: { palette: ["#778866"], styleTags: [] } });
    expect(result.source).toBe("silhouette");
    expect(result.widthRatio).toBeGreaterThan(0);
    const key = new URL(result.url, "http://localhost").searchParams.get("key")!;
    const cached = await library.readCachedPng(key);
    expect(cached?.png.subarray(1, 4).toString()).toBe("PNG");
    const repeated = await library.resolvePlaceholder({ category: "floor lamp", roomContext: { palette: ["#778866"], styleTags: [] } });
    expect(repeated.cached).toBe(true);
    expect(spawn).toHaveBeenCalledTimes(1);
  });
  it("caps incoming category before matching and filters mixed palettes", () => {
    expect(library.normalizeCategory("x".repeat(10000)).category.length).toBeLessThanOrEqual(40);
    expect(library.cleanPalette([null, 2, {}, "#abc", "#112233"])).toEqual(["#abc", "#112233"]);
  });
});


describe("placeholder aesthetic intent", () => {
  it("keeps explicit object colour and current style in the image prompt", () => {
    const prompt = library.buildPrompt("floor lamp", { palette: ["#2e7d32"], picked: ["#2e7d32"], styleTags: ["red velvet", "minimalist"], lighting: "neutral" }, "a blue floor lamp");
    expect(prompt).toContain("A single blue floor lamp");
    expect(prompt).toContain("velvet, minimalist character");
    expect(prompt).toContain("must be blue");
    expect(prompt).not.toContain("red velvet");
    expect(prompt).not.toContain("must be green");
  });
  it("does not restore modern styling or a colour after both are cleared", () => {
    const prompt = library.buildPrompt("chair", { palette: [], picked: [], styleTags: [], lighting: "neutral" });
    expect(prompt).not.toContain("modern");
    expect(prompt).not.toContain("must be");
  });
  it("does not reuse a different explicitly coloured object from cache", async () => {
    const roomContext = { palette: ["#2e7d32"], styleTags: ["minimalist"] };
    const blue = await library.resolvePlaceholder({ category: "chair", request: "a blue chair", roomContext });
    const red = await library.resolvePlaceholder({ category: "chair", request: "a red chair", roomContext });
    expect(blue.url).not.toBe(red.url);
    expect((await library.resolvePlaceholder({ category: "chair", request: "a blue chair", roomContext })).cached).toBe(true);
  });
});
