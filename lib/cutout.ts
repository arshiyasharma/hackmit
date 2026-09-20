import { createHash } from "node:crypto";

import { fetchPublicImage } from "@/lib/remoteImage";
import { extractProductCutout } from "@/lib/productCutout";
import { readCachedPng, urlForKey, writeCacheEntry, type CacheEntry } from "@/lib/placeholder";

/** Invalidates old opaque-photo fallbacks and the broad white-key algorithm. */
const CUTOUT_VERSION = "u2net-v3";

type CutoutMetadata = {
  version: string;
  keyedRatio: number;
  trimmedRatio: number;
};
type CutoutCacheEntry = CacheEntry & { cutout?: CutoutMetadata };

export type CutoutResult = {
  url: string;
  widthRatio: number;
  keyedRatio: number;
  trimmedRatio: number;
  /** Every successful result has an actual transparent background. */
  keyed: true;
};

function keyFor(imageUrl: string): string {
  return createHash("sha256").update(`cutout:${CUTOUT_VERSION}:${imageUrl}`).digest("hex");
}

/** A failed extraction keeps the existing placeholder; opaque photos are never sprites. */
export async function cutoutFromListing(imageUrl: string, signal?: AbortSignal): Promise<CutoutResult | null> {
  if (!/^https?:\/\//i.test(imageUrl)) return null;
  const key = keyFor(imageUrl);
  const cached = await readCachedPng(key);
  const metadata = (cached?.entry as CutoutCacheEntry | undefined)?.cutout;
  if (cached && metadata?.version === CUTOUT_VERSION &&
      Number.isFinite(metadata.keyedRatio) && metadata.keyedRatio >= 0.1 && metadata.keyedRatio < 1 &&
      Number.isFinite(metadata.trimmedRatio) && metadata.trimmedRatio > 0 && metadata.trimmedRatio <= 1) {
    return {
      url: urlForKey(key), widthRatio: cached.entry.widthRatio,
      keyedRatio: metadata.keyedRatio, trimmedRatio: metadata.trimmedRatio, keyed: true,
    };
  }

  const bytes = await fetchPublicImage(imageUrl, signal);
  if (!bytes) return null;
  let cut = await extractProductCutout(bytes);
  if (!cut) {
    signal?.throwIfAborted();
    const { segmentProductCutout } = await import("@/lib/productSegmentation");
    cut = await segmentProductCutout(bytes);
  }
  signal?.throwIfAborted();
  if (!cut) return null;
  const widthRatio = cut.width / cut.height;
  const entry: CutoutCacheEntry = {
    widthRatio, category: "listing", source: "generated", width: cut.width,
    height: cut.height, createdAt: Date.now(),
    cutout: { version: CUTOUT_VERSION, keyedRatio: cut.keyedRatio, trimmedRatio: cut.trimmedRatio },
  };
  await writeCacheEntry(key, cut.png, entry);
  return { url: urlForKey(key), widthRatio, keyedRatio: cut.keyedRatio, trimmedRatio: cut.trimmedRatio, keyed: true };
}
