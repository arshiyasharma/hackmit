import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { linkProductToItem } from "./ProductCard";
import { itemById, useStore } from "@/lib/store";
import type { FitResult, Product } from "@/types";

const product = (id: string): Product => ({
  id, retailer: "Shop", title: id, url: `https://shop.example/${id}`,
  imageUrl: `https://shop.example/${id}.jpg`, priceCents: 1000, currency: "USD",
  dimsMm: [400, 700, 400], dimsSource: "quoted", inStock: true,
});
const response = (body: object) => new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
const fit = (reason: string): FitResult => ({ verdict: "unknown", binding: "measurements", marginMm: null, reason });
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
};
let id: string;
const current = () => itemById(useStore.getState().items, id)!;
beforeEach(() => {
  useStore.getState().reset();
  id = useStore.getState().addItem({ request: "a chair", category: "chair" });
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("product linking with photo extraction", () => {
  it("allows choosing the same product again to retry its failed photo without relinking or rechecking fit", async () => {
    let attempts = 0;
    const fetchMock = vi.fn((url: string) => Promise.resolve(url.includes("/fit")
      ? response({ fit: fit("Current fit") })
      : response(++attempts === 1 ? { url: null, note: "Extraction unavailable" } : { url: "/retry.png", widthRatio: 0.7 })));
    vi.stubGlobal("fetch", fetchMock);
    await linkProductToItem(id, product("a"));
    const version = current().linkedProductVersion;
    expect(current().listingCutoutStatus).toBe("failed");
    await linkProductToItem(id, product("a"));
    expect(current()).toMatchObject({ linkedProductVersion: version, listingCutoutStatus: "ready", listingCutoutUrl: "/retry.png", fit: fit("Current fit") });
    expect(fetchMock.mock.calls.filter(([url]) => url.includes("/fit"))).toHaveLength(1);
  });

  it("publishes fit before a slow extraction completes", async () => {
    const image = deferred<Response>();
    vi.stubGlobal("fetch", vi.fn((url: string) => url.includes("/fit")
      ? Promise.resolve(response({ fit: fit("Fit is ready") })) : image.promise));
    const work = linkProductToItem(id, product("a"));
    await vi.waitFor(() => expect(current().fit?.reason).toBe("Fit is ready"));
    expect(current().listingCutoutStatus).toBe("pending");
    image.resolve(response({ url: "/a.png", widthRatio: 1 }));
    await work;
  });

  it("keeps the newest fit verdict after A → B → A", async () => {
    const fits = [deferred<Response>(), deferred<Response>(), deferred<Response>()];
    let fitCall = 0;
    vi.stubGlobal("fetch", vi.fn((url: string) => url.includes("/fit")
      ? fits[fitCall++].promise : Promise.resolve(response({ url: null }))));
    const oldA = linkProductToItem(id, product("a"));
    const b = linkProductToItem(id, product("b"));
    const newA = linkProductToItem(id, product("a"));
    fits[2].resolve(response({ fit: fit("Newest A") }));
    await newA;
    fits[0].resolve(response({ fit: fit("Old A") }));
    fits[1].resolve(response({ fit: fit("Old B") }));
    await Promise.all([oldA, b]);
    expect(current().fit?.reason).toBe("Newest A");
  });

  it("does not start jobs for an item that no longer exists", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    useStore.getState().removeItem(id);
    await linkProductToItem(id, product("a"));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
