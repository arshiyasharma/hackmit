import { createHash } from "node:crypto";

import { fetchPublicImage } from "@/lib/remoteImage";
import { CUTOUT_VERSION } from "@/lib/cutoutVersion";
import { extractProductCutout } from "@/lib/productCutout";
import { readCachedPng, urlForKey, writeCacheEntry, type CacheEntry } from "@/lib/placeholder";

type CutoutMetadata = {
  version: string;
  keyedRatio: number;
  trimmedRatio: number;
};
type CutoutCacheEntry = CacheEntry & { cutout?: CutoutMetadata };

export type CutoutResult = {
  url: string;
  version: string;
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
      Number.isFinite(metadata.keyedRatio) && metadata.keyedRatio >= 0.005 && metadata.keyedRatio < 1 &&
      Number.isFinite(metadata.trimmedRatio) && metadata.trimmedRatio > 0 && metadata.trimmedRatio <= 1) {
    return {
      url: urlForKey(key), version: CUTOUT_VERSION, widthRatio: cached.entry.widthRatio,
      keyedRatio: metadata.keyedRatio, trimmedRatio: metadata.trimmedRatio, keyed: true,
    };
  }

  const bytes = await fetchPublicImage(imageUrl, signal);
  if (!bytes) return null;
  let cut = await extractProductCutout(bytes);
  if (!cut || cut.needsRefinement) {
    signal?.throwIfAborted();
    const { segmentProductCutout } = await import("@/lib/productSegmentation");
    const refined = await segmentProductCutout(bytes, signal).catch((error) => {
      signal?.throwIfAborted();
      if (cut) return null;
      throw error;
    });
    // Border-only removal cannot distinguish a white tabletop from the white
    // opening underneath. Let the model remove those gaps, while refusing a
    // refinement that discards most of the real product (e.g. only a shade).
    // Allow shrinking the old bounds: shadows and retained white background
    // can extend well beyond the legs of a correctly isolated table.
    if (refined && (!cut || (
      refined.width >= cut.width * 0.6 && refined.height >= cut.height * 0.6 &&
      refined.width <= cut.width * 1.2 && refined.height <= cut.height * 1.2
    ))) cut = refined;
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
  return { url: urlForKey(key), version: CUTOUT_VERSION, widthRatio, keyedRatio: cut.keyedRatio, trimmedRatio: cut.trimmedRatio, keyed: true };
}
