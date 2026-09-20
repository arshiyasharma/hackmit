import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { retryListingCutout } from "./listingCutout";
import { itemById, useStore } from "./store";
import type { Product } from "@/types";

const product = (id: string, extra: Partial<Product> = {}): Product => ({
  id, retailer: "Shop", title: `Product ${id}`, url: `https://shop.example/${id}`,
  imageUrl: `https://shop.example/${id}.jpg`, priceCents: 1000, currency: "USD",
  dimsSource: "missing", inStock: true, ...extra,
});
const response = (body: object, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "Content-Type": "application/json" },
});
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
};
let id: string;
const current = () => itemById(useStore.getState().items, id)!;

beforeEach(() => {
  useStore.getState().reset();
  id = useStore.getState().addItem({ request: "a chair", category: "chair", position: [0.25, 0, 0.7] });
  useStore.getState().setPlaceholder(id, { url: "/placeholder.png", widthRatio: 0.4 });
  useStore.getState().resizeItem(id, 1.75);
  useStore.getState().moveItem(id, [0.25, 0, 0.7], 23);
  useStore.getState().linkProduct(id, product("a"));
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("listing photo replacement", () => {
  it("shows pending, replaces only the sprite/ratio, and preserves placement and user scale", async () => {
    const wait = deferred<Response>();
    const fetchMock = vi.fn().mockReturnValue(wait.promise);
    vi.stubGlobal("fetch", fetchMock);
    const work = retryListingCutout(id);
    expect(current().listingCutoutStatus).toBe("pending");
    expect(current().listingCutoutUrl).toBeNull();
    wait.resolve(response({ url: "/listing.png", widthRatio: 2.75 }));
    await work;
    expect(current()).toMatchObject({
      listingCutoutStatus: "ready", listingCutoutUrl: "/listing.png", listingWidthRatio: 2.75,
      placeholderUrl: "/placeholder.png", position: [0.25, 0, 0.7], rotationY: 23, scale: 1.75,
    });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ imageUrl: "https://shop.example/a.jpg" });
    expect(fetchMock.mock.calls[0][0]).toBe("/api/cutout");
  });

  it("deduplicates clicks while pending and does not re-extract a ready photo", async () => {
    const wait = deferred<Response>();
    const fetchMock = vi.fn().mockReturnValue(wait.promise);
    vi.stubGlobal("fetch", fetchMock);
    const work = retryListingCutout(id);
    await retryListingCutout(id);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    wait.resolve(response({ url: "/listing.png", widthRatio: 1 }));
    await work;
    await retryListingCutout(id);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("offers an explicit retry after a null response and accepts the new result", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ url: null, note: "The listing photo is unavailable." }))
      .mockResolvedValueOnce(response({ url: "/retry.png", widthRatio: 0.65 }));
    vi.stubGlobal("fetch", fetchMock);
    await retryListingCutout(id);
    expect(current()).toMatchObject({ listingCutoutStatus: "failed", listingCutoutUrl: null, listingCutoutNote: "The listing photo is unavailable." });
    await retryListingCutout(id);
    expect(current()).toMatchObject({ listingCutoutStatus: "ready", listingCutoutUrl: "/retry.png", listingCutoutNote: null });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("rejects old A and B responses after A → B → A, even if transport ignores abort", async () => {
    const firstA = deferred<Response>();
    const b = deferred<Response>();
    const lastA = deferred<Response>();
    const fetchMock = vi.fn().mockReturnValueOnce(firstA.promise).mockReturnValueOnce(b.promise).mockReturnValueOnce(lastA.promise);
    vi.stubGlobal("fetch", fetchMock);
    const oldA = retryListingCutout(id);
    useStore.getState().linkProduct(id, product("b"));
    const workB = retryListingCutout(id);
    useStore.getState().linkProduct(id, product("a"));
    const newA = retryListingCutout(id);
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
    lastA.resolve(response({ url: "/new-a.png", widthRatio: 2 }));
    await newA;
    firstA.resolve(response({ url: "/old-a.png", widthRatio: 9 }));
    b.resolve(response({ url: null, note: "Old failure" }));
    await Promise.all([oldA, workB]);
    expect(current()).toMatchObject({ listingCutoutStatus: "ready", listingCutoutUrl: "/new-a.png", listingWidthRatio: 2, listingCutoutNote: null });
  });

  it("clears a previous product photo synchronously on relink and unlink", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ url: "/a.png", widthRatio: 1 })));
    await retryListingCutout(id);
    useStore.getState().linkProduct(id, product("b"));
    expect(current()).toMatchObject({ listingCutoutUrl: null, listingWidthRatio: null, listingCutoutStatus: "idle", position: [0.25, 0, 0.7], scale: 1.75 });
    useStore.getState().linkProduct(id, null);
    expect(current()).toMatchObject({ linkedProduct: null, listingCutoutStatus: "idle" });
  });

  it("does not resurrect a removed item or accept its pending result after undo", async () => {
    const wait = deferred<Response>();
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(wait.promise));
    const work = retryListingCutout(id);
    const saved = current();
    useStore.getState().removeItem(id);
    useStore.getState().restoreItem(saved);
    expect(current().listingCutoutStatus).toBe("failed");
    wait.resolve(response({ url: "/old.png", widthRatio: 1 }));
    await work;
    expect(current().listingCutoutUrl).toBeNull();
    expect(current().listingCutoutStatus).toBe("failed");
  });

  it.each(["http", "network", "invalid"])("records %s failures without losing the illustration", async (failure) => {
    vi.stubGlobal("fetch", failure === "network" ? vi.fn().mockRejectedValue(new Error("offline"))
      : vi.fn().mockResolvedValue(failure === "http" ? response({}, 503) : new Response("not json")));
    await retryListingCutout(id);
    expect(current()).toMatchObject({ listingCutoutStatus: "failed", listingCutoutUrl: null, placeholderUrl: "/placeholder.png" });
    expect(current().listingCutoutNote).toBeTruthy();
  });

  it("can extract a legacy linked item with no status or cutout fields", async () => {
    useStore.setState((state) => ({ items: state.items.map((item) => ({
      ...item, listingCutoutStatus: undefined, listingCutoutUrl: undefined,
    })) as unknown as typeof state.items }));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ url: "/legacy.png", widthRatio: 0.8 })));
    await retryListingCutout(id);
    expect(current()).toMatchObject({ listingCutoutStatus: "ready", listingCutoutUrl: "/legacy.png" });
  });

  it("explains a missing listing photo without a network request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    useStore.getState().linkProduct(id, product("no-photo", { imageUrl: undefined }));
    await retryListingCutout(id);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(current().listingCutoutStatus).toBe("failed");
    expect(current().listingCutoutNote).toContain("no product photo");
  });

  it("turns a timed-out extraction into a retryable failure", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn((_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    })));
    const work = retryListingCutout(id);
    await vi.advanceTimersByTimeAsync(90_000);
    await work;
    expect(current().listingCutoutStatus).toBe("failed");
    expect(current().listingCutoutNote).toContain("too long");
  });

  it("does not mark a returned URL ready when the image fails to load", async () => {
    vi.stubGlobal("Image", class {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_value: string) { queueMicrotask(() => this.onerror?.()); }
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ url: "/broken.png", widthRatio: 1 })));
    await retryListingCutout(id);
    expect(current()).toMatchObject({ listingCutoutStatus: "failed", listingCutoutUrl: null });
  });

  it("uses the decoded photo proportions without stretching the replacement", async () => {
    vi.stubGlobal("Image", class {
      naturalWidth = 800;
      naturalHeight = 200;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_value: string) { queueMicrotask(() => this.onload?.()); }
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ url: "/wide.png", widthRatio: 1 })));
    await retryListingCutout(id);
    expect(current().listingWidthRatio).toBe(4);
  });
});
