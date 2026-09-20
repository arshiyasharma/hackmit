import { createHash } from "node:crypto";

import sharp from "sharp";

import {
  keyOutAndTrim,
  readCachedPng,
  urlForKey,
  writeCacheEntry,
} from "@/lib/placeholder";

/**
 * The listing's OWN photo, cut out and stood in the room.
 *
 * The generated stand-in exists because at the moment someone asks for "a tall
 * lamp" there is no lamp yet. Once they link a listing there is: a real product
 * with a real photo, and standing THAT in the room beats standing a drawing of
 * it. So the sprite swaps to the product the moment it is chosen, and the
 * honest caption below it stops being needed for that item.
 *
 * Retailer photos are mostly shot on white, which is exactly what
 * keyOutAndTrim() was written for — the same border flood fill, the same
 * un-premultiplied edges, the same trim to the object's own bounds. A photo
 * that is NOT on white (a lifestyle shot, a room scene) fails the check below
 * and the caller keeps the generated stand-in rather than showing a sprite with
 * a chunk of someone else's living room attached to it.
 */

/**
 * Past this the whole frame went transparent, so there was no object in it.
 * It has to sit very high: a lamp photographed on a big white field legitimately
 * keys ~90% of its frame, and an earlier 0.82 threw those away.
 */
const MAX_KEYED_RATIO = 0.985;
/**
 * Under this, nothing was keyed: the photo has no white margin to remove.
 * Measured against live SerpAPI results — an isolated lamp on white keys a
 * quarter of its frame or more, while a marketing collage keys 0.09.
 */
const MIN_KEYED_RATIO = 0.15;
/**
 * The trim must actually shrink the picture. A collage — thumbnail strip, a
 * hand holding a remote, a sofa behind it — keys only its gutters and comes
 * back the same size it went in, and that is the single clearest signal that
 * what we have is an advert rather than a product.
 */
const MAX_TRIMMED_RATIO = 0.85;

const FETCH_TIMEOUT_MS = 8_000;
/** A listing photo over this is not a listing photo. */
const MAX_BYTES = 12_000_000;

export type CutoutResult = {
  url: string;
  widthRatio: number;
  /** what fraction of the frame turned transparent, for the caller's log */
  keyedRatio: number;
  /** trimmed area over original area — a collage barely shrinks */
  trimmedRatio: number;
};

function keyFor(imageUrl: string): string {
  return createHash("sha256").update(`cutout:${imageUrl}`).digest("hex");
}

/**
 * Returns null when the photo cannot honestly become a sprite — unreachable,
 * too big, not an image, or not shot on a background we can remove.
 */
export async function cutoutFromListing(
  imageUrl: string,
  signal?: AbortSignal,
): Promise<CutoutResult | null> {
  if (!/^https?:\/\//i.test(imageUrl)) return null;

  const key = keyFor(imageUrl);
  const cached = await readCachedPng(key);
  if (cached) {
    return {
      url: urlForKey(key),
      widthRatio: cached.entry.widthRatio,
      keyedRatio: 1,
      trimmedRatio: 1,
    };
  }

  let bytes: Buffer;
  try {
    const res = await fetch(imageUrl, {
      signal: signal ?? AbortSignal.timeout(FETCH_TIMEOUT_MS),
      // a retailer CDN that refuses an unknown agent is a miss, not a crash
      headers: { accept: "image/*" },
    });
    if (!res.ok) return null;
    if (!(res.headers.get("content-type") ?? "").startsWith("image/")) return null;

    const buffer = await res.arrayBuffer();
    if (buffer.byteLength > MAX_BYTES) return null;
    bytes = Buffer.from(buffer);
  } catch {
    return null;
  }

  const cut = await keyOutAndTrim(bytes);
  if (!cut) return null;

  /*
   * How much of the frame survived the trim. An isolated product on white
   * shrinks a lot; a MARKETING COLLAGE — thumbnail strips, a hand holding a
   * remote, a sofa — keys only its gutters and barely shrinks at all, which is
   * exactly the kind of picture that must never end up standing in the room.
   */
  const meta = await sharp(bytes).metadata();
  const originalArea = (meta.width ?? 0) * (meta.height ?? 0);
  const trimmedRatio =
    originalArea > 0 ? (cut.width * cut.height) / originalArea : 1;

  // a photo that is all background, has none, or refused to shrink is not a
  // product shot — the room keeps the stand-in rather than showing an advert
  if (
    cut.keyedRatio > MAX_KEYED_RATIO ||
    cut.keyedRatio < MIN_KEYED_RATIO ||
    trimmedRatio > MAX_TRIMMED_RATIO
  ) {
    return null;
  }

  const widthRatio = cut.height > 0 ? cut.width / cut.height : 1;
  await writeCacheEntry(key, cut.png, {
    widthRatio,
    category: "listing",
    source: "generated",
    width: cut.width,
    height: cut.height,
    createdAt: 0,
  });

  return { url: urlForKey(key), widthRatio, keyedRatio: cut.keyedRatio, trimmedRatio };
}
