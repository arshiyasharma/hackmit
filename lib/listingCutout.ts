"use client";

import { CUTOUT_VERSION } from "@/lib/cutoutVersion";
import { withDemo } from "@/lib/demo";
import { itemById, useStore } from "@/lib/store";
import { productImage, type PlacedItem } from "@/types";

const EXTRACTION_TIMEOUT_MS = 30_000;
const FAILED = "Couldn’t remove the product photo’s background. The illustration is still shown.";
const REFRESH_FAILED = "Couldn’t refresh the product photo. The previous photo is still shown.";
const INTERRUPTED = "Product photo was interrupted. Try again.";
type Job = { controller: AbortController; requestId: number; linkVersion: number };
const requests = new Map<string, Job>();
const starting = new Set<string>();
let watching = false;
let reconciling = false;
let unsubscribe: (() => void) | undefined;
const upgradeQueue = new Map<string, number>();
let upgrading = false;
let upgradeScheduled = false;

function needsUpgrade(item: PlacedItem): boolean {
  return !!item.linkedProduct && !!item.listingCutoutUrl &&
    (item.listingCutoutStatus === "ready" || item.listingCutoutStatus === undefined) &&
    item.listingCutoutVersion !== CUTOUT_VERSION && item.listingCutoutRequestedVersion !== CUTOUT_VERSION;
}

/** Existing photos upgrade once, one at a time; user-triggered requests stay immediate. */
function queueUpgrades(): void {
  for (const item of useStore.getState().items) {
    if (needsUpgrade(item)) upgradeQueue.set(item.id, item.linkedProductVersion);
  }
  if (!watching || upgrading || upgradeScheduled || upgradeQueue.size === 0) return;
  upgradeScheduled = true;
  queueMicrotask(() => { upgradeScheduled = false; void upgradeExistingPhotos(); });
}

async function upgradeExistingPhotos(): Promise<void> {
  if (!watching || upgrading) return;
  upgrading = true;
  try {
    while (watching && upgradeQueue.size > 0) {
      const [itemId, linkVersion] = upgradeQueue.entries().next().value!;
      upgradeQueue.delete(itemId);
      const item = itemById(useStore.getState().items, itemId);
      if (!item || item.linkedProductVersion !== linkVersion || !needsUpgrade(item)) continue;
      // startListingCutout records the target version before the request. Even
      // failure or an older server response therefore cannot enqueue it again.
      await retryListingCutout(itemId, true);
    }
  } finally {
    upgrading = false;
    if (watching && upgradeQueue.size > 0) queueUpgrades();
  }
}

// Fast Refresh can replace this module while Zustand keeps the room. Dispose
// the previous watcher/jobs instead of leaving its pending state behind.
const scope = globalThis as typeof globalThis & { __pixxCutoutDispose?: () => void };

function reconcileRequests(): void {
  if (reconciling) return;
  reconciling = true;
  try {
    const items = useStore.getState().items;
    for (const [id, job] of requests) {
      const item = itemById(items, id);
      if (item?.listingCutoutStatus === "pending" && item.listingCutoutRequestId === job.requestId &&
          item.linkedProductVersion === job.linkVersion && item.linkedProduct) continue;
      requests.delete(id);
      job.controller.abort();
    }
    const orphaned = items.some((item) => item.listingCutoutStatus === "pending" &&
      !starting.has(item.id) && !requests.has(item.id));
    if (orphaned) {
      useStore.setState((state) => ({
        items: state.items.map((item) => item.listingCutoutStatus === "pending" &&
          !starting.has(item.id) && !requests.has(item.id)
          ? { ...item, listingCutoutStatus: "failed", listingCutoutNote: INTERRUPTED, listingCutoutRequestId: null }
          : item),
      }));
    }
  } finally {
    reconciling = false;
  }
  queueUpgrades();
}

/** Recover hydration/hot-reload jobs and immediately cancel obsolete requests. */
export function recoverListingCutoutRequests(): void {
  if (!watching) {
    scope.__pixxCutoutDispose?.();
    watching = true;
    unsubscribe = useStore.subscribe((state, previous) => {
      if (state.items !== previous.items) reconcileRequests();
    });
    scope.__pixxCutoutDispose = () => {
      unsubscribe?.();
      unsubscribe = undefined;
      watching = false;
      for (const job of requests.values()) job.controller.abort();
      requests.clear();
      starting.clear();
      upgradeQueue.clear();
    };
  }
  reconcileRequests();
}

if (typeof window !== "undefined") recoverListingCutoutRequests();

/** A deadline also settles callers when a transport ignores AbortSignal. */
function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new Error("Product photo interrupted"));
    // Observe the underlying promise even if cancellation arrived first, so
    // a fetch/body rejection cannot become an unhandled promise rejection.
    work.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
  });
}

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

/**
 * Force requests the server's latest cutout even when a photo is already ready.
 * Server cache versions decide when to regenerate; this does not bypass a
 * current good cache. One-time upgrades are queued separately by the watcher.
 */
export async function retryListingCutout(itemId: string, force = false): Promise<void> {
  recoverListingCutoutRequests();
  const store = useStore.getState();
  const item = itemById(store.items, itemId);
  const product = item?.linkedProduct;
  if (!product || item.listingCutoutStatus === "pending" || (!force && item.listingCutoutUrl && item.listingCutoutStatus !== "failed")) return;
  const preserveExisting = !!item.listingCutoutUrl;
  const defaultFailure = preserveExisting ? REFRESH_FAILED : FAILED;
  starting.add(itemId);
  const requestId = store.startListingCutout(itemId, preserveExisting, CUTOUT_VERSION);
  if (requestId === null) { starting.delete(itemId); return; }

  const controller = new AbortController();
  const job = { controller, requestId, linkVersion: item.linkedProductVersion };
  requests.set(itemId, job);
  starting.delete(itemId);
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, EXTRACTION_TIMEOUT_MS);
  const fail = (note = defaultFailure) => useStore.getState().setListingCutout(itemId, null, requestId, note);
  try {
    const imageUrl = productImage(product);
    if (!imageUrl) {
      fail(preserveExisting ? REFRESH_FAILED : "This listing has no product photo. The illustration is still shown.");
      return;
    }
    const res = await abortable(fetch(withDemo("/api/cutout"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imageUrl }),
      signal: controller.signal,
    }), controller.signal);
    if (!res.ok) { fail(); return; }
    const body = await abortable(res.json(), controller.signal) as { url?: unknown; widthRatio?: unknown; note?: unknown; version?: unknown };
    if (typeof body.url !== "string" || !body.url.trim()) {
      // Provider notes are retained for details, never interpreted as markup.
      fail(preserveExisting ? REFRESH_FAILED
        : typeof body.note === "string" && body.note.trim() ? body.note.trim().slice(0, 240) : FAILED);
      return;
    }
    // A replacement may have landed while this response was being parsed.
    const current = itemById(useStore.getState().items, itemId);
    if (current?.listingCutoutRequestId !== requestId || current.listingCutoutStatus !== "pending") return;
    const reportedRatio = typeof body.widthRatio === "number" && Number.isFinite(body.widthRatio) && body.widthRatio > 0
      ? body.widthRatio : 1;
    const widthRatio = await imageRatio(body.url, reportedRatio, controller.signal);
    const version = typeof body.version === "string" && body.version.trim() ? body.version.trim() : null;
    useStore.getState().setListingCutout(itemId, { url: body.url, widthRatio, version }, requestId);
  } catch {
    fail(timedOut ? "Product photo took too long. Try again." : controller.signal.aborted ? INTERRUPTED : defaultFailure);
  } finally {
    clearTimeout(timer);
    if (requests.get(itemId) === job) requests.delete(itemId);
  }
}
