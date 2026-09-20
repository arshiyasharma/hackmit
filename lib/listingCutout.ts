"use client";

import { withDemo } from "@/lib/demo";
import { itemById, useStore } from "@/lib/store";
import { productImage } from "@/types";

const EXTRACTION_TIMEOUT_MS = 90_000;
const FAILED = "Couldn’t remove the product photo’s background. The illustration is still shown.";
const requests = new Map<string, AbortController>();

/** Decode before swapping: a broken asset URL must leave the illustration in place. */
async function imageRatio(url: string, fallback: number, signal: AbortSignal): Promise<number> {
  if (typeof Image === "undefined") return fallback;
  return new Promise((resolve, reject) => {
    const image = new Image();
    const finish = (error?: Error) => {
      signal.removeEventListener("abort", abort);
      image.onload = null;
      image.onerror = null;
      if (error) {
        image.src = "";
        reject(error);
      } else {
        resolve(image.naturalWidth > 0 && image.naturalHeight > 0
          ? image.naturalWidth / image.naturalHeight : fallback);
      }
    };
    const abort = () => finish(new Error("Product photo interrupted"));
    image.onload = () => finish();
    image.onerror = () => finish(new Error("Product photo unavailable"));
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    else image.src = url;
  });
}

/** Explicit retries share the same guarded path as the first product selection. */
export async function retryListingCutout(itemId: string): Promise<void> {
  const store = useStore.getState();
  const item = itemById(store.items, itemId);
  const product = item?.linkedProduct;
  if (!product || item.listingCutoutStatus === "pending" || item.listingCutoutStatus === "ready") return;
  const requestId = store.startListingCutout(itemId);
  if (requestId === null) return;

  requests.get(itemId)?.abort();
  const controller = new AbortController();
  requests.set(itemId, controller);
  const timer = setTimeout(() => controller.abort(), EXTRACTION_TIMEOUT_MS);
  const fail = (note = FAILED) => useStore.getState().setListingCutout(itemId, null, requestId, note);
  try {
    const imageUrl = productImage(product);
    if (!imageUrl) {
      fail("This listing has no product photo. The illustration is still shown.");
      return;
    }
    const res = await fetch(withDemo("/api/cutout"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imageUrl }),
      signal: controller.signal,
    });
    if (!res.ok) { fail(); return; }
    const body = await res.json() as { url?: unknown; widthRatio?: unknown; note?: unknown };
    if (typeof body.url !== "string" || !body.url.trim()) {
      // Provider notes are retained for details, never interpreted as markup.
      fail(typeof body.note === "string" && body.note.trim() ? body.note.trim().slice(0, 240) : FAILED);
      return;
    }
    // A replacement may have landed while this response was being parsed.
    const current = itemById(useStore.getState().items, itemId);
    if (current?.listingCutoutRequestId !== requestId || current.listingCutoutStatus !== "pending") return;
    const reportedRatio = typeof body.widthRatio === "number" && Number.isFinite(body.widthRatio) && body.widthRatio > 0
      ? body.widthRatio : 1;
    const widthRatio = await imageRatio(body.url, reportedRatio, controller.signal);
    useStore.getState().setListingCutout(itemId, { url: body.url, widthRatio }, requestId);
  } catch {
    fail(controller.signal.aborted ? "Product photo took too long. Try again." : FAILED);
  } finally {
    clearTimeout(timer);
    if (requests.get(itemId) === controller) requests.delete(itemId);
  }
}
