import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { recoverListingCutoutRequests, retryListingCutout } from "./listingCutout";
import { itemById, useStore } from "./store";
import { CUTOUT_VERSION } from "./cutoutVersion";
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

  it("explicitly refreshes a ready cutout, keeping its photo and placement until replacement is ready", async () => {
    const fresh = deferred<Response>();
    const fetchMock = vi.fn().mockResolvedValueOnce(response({ url: "/old-cutout.png", widthRatio: 0.5 }))
      .mockReturnValueOnce(fresh.promise);
    vi.stubGlobal("fetch", fetchMock);
    await retryListingCutout(id);
    const refresh = retryListingCutout(id, true);
    expect(current()).toMatchObject({
      listingCutoutStatus: "pending", listingCutoutUrl: "/old-cutout.png", listingWidthRatio: 0.5,
      position: [0.25, 0, 0.7], rotationY: 23, scale: 1.75,
    });
    await retryListingCutout(id, true); // Force still deduplicates an active refresh.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ imageUrl: "https://shop.example/a.jpg" });
    fresh.resolve(response({ url: "/improved-v7.png", widthRatio: 0.85 }));
    await refresh;
    expect(current()).toMatchObject({
      listingCutoutStatus: "ready", listingCutoutUrl: "/improved-v7.png", listingWidthRatio: 0.85,
      position: [0.25, 0, 0.7], rotationY: 23, scale: 1.75,
    });
  });

  it("keeps the previous cutout after a failed refresh and during its next retry", async () => {
    const retry = deferred<Response>();
    const fetchMock = vi.fn().mockResolvedValueOnce(response({ url: "/old-cutout.png", widthRatio: 0.5 }))
      .mockResolvedValueOnce(response({ url: null, note: "Keeping the shape preview." }))
      .mockReturnValueOnce(retry.promise);
    vi.stubGlobal("fetch", fetchMock);
    await retryListingCutout(id);
    await retryListingCutout(id, true);
    expect(current()).toMatchObject({
      listingCutoutStatus: "failed", listingCutoutUrl: "/old-cutout.png", listingWidthRatio: 0.5,
      position: [0.25, 0, 0.7], rotationY: 23, scale: 1.75,
    });
    expect(current().listingCutoutNote).toContain("previous photo is still shown");
    const work = retryListingCutout(id);
    expect(current()).toMatchObject({ listingCutoutStatus: "pending", listingCutoutUrl: "/old-cutout.png" });
    retry.resolve(response({ url: "/retry-cutout.png", widthRatio: 0.9 }));
    await work;
    expect(current()).toMatchObject({ listingCutoutStatus: "ready", listingCutoutUrl: "/retry-cutout.png" });
  });

  it("never restores the old photo when the product changes during a refresh", async () => {
    const refresh = deferred<Response>();
    const fetchMock = vi.fn().mockResolvedValueOnce(response({ url: "/old-a.png", widthRatio: 0.5 }))
      .mockReturnValueOnce(refresh.promise);
    vi.stubGlobal("fetch", fetchMock);
    await retryListingCutout(id);
    const work = retryListingCutout(id, true);
    useStore.getState().linkProduct(id, product("b"));
    await work;
    refresh.resolve(response({ url: "/late-a.png", widthRatio: 0.9 }));
    await Promise.resolve();
    expect(current()).toMatchObject({
      linkedProduct: { id: "b" }, listingCutoutStatus: "idle", listingCutoutUrl: null, listingWidthRatio: null,
    });
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
    await vi.advanceTimersByTimeAsync(30_000);
    await work;
    expect(current().listingCutoutStatus).toBe("failed");
    expect(current().listingCutoutNote).toContain("too long");
  });

  it("recovers pending status with no live request after reload or hydration", async () => {
    useStore.setState((state) => ({ items: state.items.map((item) => ({
      ...item, listingCutoutStatus: "pending", listingCutoutRequestId: 12345,
    })) }));
    recoverListingCutoutRequests();
    expect(current()).toMatchObject({ listingCutoutStatus: "failed", listingCutoutRequestId: null });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ url: "/recovered.png", widthRatio: 0.8 })));
    await retryListingCutout(id);
    expect(current()).toMatchObject({ listingCutoutStatus: "ready", listingCutoutUrl: "/recovered.png" });
  });

  it.each(["delete", "unlink", "relink", "new room"])("aborts immediately on %s without waiting for another extraction", async (action) => {
    const wait = deferred<Response>();
    const fetchMock = vi.fn().mockReturnValue(wait.promise);
    vi.stubGlobal("fetch", fetchMock);
    const work = retryListingCutout(id);
    const signal = fetchMock.mock.calls[0][1].signal as AbortSignal;
    if (action === "delete") useStore.getState().removeItem(id);
    if (action === "unlink") useStore.getState().linkProduct(id, null);
    if (action === "relink") useStore.getState().linkProduct(id, product("b"));
    if (action === "new room") useStore.getState().setRoomImage(null);
    expect(signal.aborted).toBe(true);
    await work; // settles even though this fake transport never acknowledges abort
    const item = itemById(useStore.getState().items, id);
    expect(item?.listingCutoutStatus).not.toBe("pending");
  });

  it("recovers jobs owned by a replaced module and rejects its late reply", async () => {
    const wait = deferred<Response>();
    const fetchMock = vi.fn().mockReturnValueOnce(wait.promise)
      .mockResolvedValueOnce(response({ url: "/new-runtime.png", widthRatio: 1 }));
    vi.stubGlobal("fetch", fetchMock);
    const oldWork = retryListingCutout(id);
    const runtime = globalThis as typeof globalThis & { __pixxCutoutDispose?: () => void };
    runtime.__pixxCutoutDispose?.();
    recoverListingCutoutRequests();
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
    expect(current().listingCutoutStatus).toBe("failed");
    const newWork = retryListingCutout(id);
    await Promise.all([oldWork, newWork]);
    wait.resolve(response({ url: "/obsolete-runtime.png", widthRatio: 2 }));
    await Promise.resolve();
    expect(current()).toMatchObject({ listingCutoutStatus: "ready", listingCutoutUrl: "/new-runtime.png" });
  });

  it("enforces 30 seconds even when the fetch implementation ignores abort", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));
    const work = retryListingCutout(id);
    await vi.advanceTimersByTimeAsync(29_999);
    expect(current().listingCutoutStatus).toBe("pending");
    await vi.advanceTimersByTimeAsync(1);
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


describe("one-time existing photo upgrades", () => {
  it("automatically replaces an existing v6 cutout once while preserving its photo and placement", async () => {
    const replacement = deferred<Response>();
    const fetchMock = vi.fn().mockReturnValue(replacement.promise);
    vi.stubGlobal("fetch", fetchMock);
    useStore.getState().setListingCutout(id, { url: "/v6.png", widthRatio: 0.4, version: "fast-product-v6" });
    recoverListingCutoutRequests();
    await vi.waitFor(() => expect(current().listingCutoutStatus).toBe("pending"));
    expect(current()).toMatchObject({
      listingCutoutUrl: "/v6.png", listingWidthRatio: 0.4, listingCutoutVersion: "fast-product-v6",
      listingCutoutRequestedVersion: CUTOUT_VERSION, position: [0.25, 0, 0.7], rotationY: 23, scale: 1.75,
    });
    replacement.resolve(response({ url: "/v7.png", widthRatio: 0.75, version: CUTOUT_VERSION }));
    await vi.waitFor(() => expect(current().listingCutoutStatus).toBe("ready"));
    expect(current()).toMatchObject({ listingCutoutUrl: "/v7.png", listingCutoutVersion: CUTOUT_VERSION });
    recoverListingCutoutRequests();
    useStore.getState().moveItem(id, [0.3, 0, 0.8]);
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("never repeats a failed automatic upgrade, including after a module restart", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({ url: null }));
    vi.stubGlobal("fetch", fetchMock);
    useStore.getState().setListingCutout(id, { url: "/unversioned.png", widthRatio: 0.6 });
    recoverListingCutoutRequests();
    await vi.waitFor(() => expect(current().listingCutoutStatus).toBe("failed"));
    expect(current()).toMatchObject({ listingCutoutUrl: "/unversioned.png", listingCutoutRequestedVersion: CUTOUT_VERSION });
    const runtime = globalThis as typeof globalThis & { __pixxCutoutDispose?: () => void };
    runtime.__pixxCutoutDispose?.();
    recoverListingCutoutRequests();
    useStore.getState().resizeItem(id, 1.2);
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not loop if an older server returns an unversioned successful photo", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({ url: "/still-unversioned.png", widthRatio: 1 }));
    vi.stubGlobal("fetch", fetchMock);
    useStore.getState().setListingCutout(id, { url: "/legacy.png", widthRatio: 0.5 });
    recoverListingCutoutRequests();
    await vi.waitFor(() => expect(current().listingCutoutUrl).toBe("/still-unversioned.png"));
    expect(current().listingCutoutVersion).toBeNull();
    expect(current().listingCutoutRequestedVersion).toBe(CUTOUT_VERSION);
    const runtime = globalThis as typeof globalThis & { __pixxCutoutDispose?: () => void };
    runtime.__pixxCutoutDispose?.();
    recoverListingCutoutRequests();
    useStore.getState().resizeItem(id, 1.3);
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("serializes automatic upgrades for multiple old photos", async () => {
    const first = deferred<Response>();
    const second = deferred<Response>();
    const fetchMock = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    vi.stubGlobal("fetch", fetchMock);
    const store = useStore.getState();
    const secondId = store.addItem({ request: "a lamp", category: "lamp" });
    store.linkProduct(secondId, product("b"));
    store.setListingCutout(id, { url: "/old-a.png", widthRatio: 0.5 });
    store.setListingCutout(secondId, { url: "/old-b.png", widthRatio: 0.5 });
    recoverListingCutoutRequests();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(itemById(useStore.getState().items, secondId)?.listingCutoutStatus).toBe("ready");
    first.resolve(response({ url: "/new-a.png", widthRatio: 0.7, version: CUTOUT_VERSION }));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    second.resolve(response({ url: "/new-b.png", widthRatio: 0.8, version: CUTOUT_VERSION }));
    await vi.waitFor(() => expect(itemById(useStore.getState().items, secondId)?.listingCutoutStatus).toBe("ready"));
    expect(current().listingCutoutUrl).toBe("/new-a.png");
  });

  it("leaves a current-version ready photo alone", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    useStore.getState().setListingCutout(id, { url: "/current.png", widthRatio: 0.8, version: CUTOUT_VERSION });
    recoverListingCutoutRequests();
    await Promise.resolve();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(current().listingCutoutUrl).toBe("/current.png");
  });
});
