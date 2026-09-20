import { createHash } from "node:crypto";

import sharp from "sharp";
import { fetchPublicImage } from "@/lib/remoteImage";

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


export type CutoutResult = {
  url: string;
  widthRatio: number;
  /** what fraction of the frame turned transparent, for the caller's log */
  keyedRatio: number;
  /** trimmed area over original area — a collage barely shrinks */
  trimmedRatio: number;
  /** false when the background could not be removed and the photo stands as it is */
  keyed: boolean;
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
      keyed: true,
    };
  }

  const bytes = await fetchPublicImage(imageUrl, signal);
  if (!bytes) return null;

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

  /*
   * A REFUSED KEY IS NOT A REFUSED PHOTO.
   *
   * The gates below catch a marketing collage — thumbnail strips, a hand
   * holding a remote — which must never stand in the room wearing an alpha
   * channel. But refusing outright left the generated drawing standing where
   * the user had just chosen a real product, which is the one thing they
   * asked not to happen. Google's own listing thumbnails come off
   * encrypted-tbn*.gstatic.com already padded, and they trip these gates
   * routinely.
   *
   * So a photo that will not key cleanly still becomes the sprite — as
   * itself, opaque, on its own background — as long as it is shaped like a
   * product shot rather than a banner. Only something that is not a photo of
   * one thing is refused.
   */
  const refusal =
    cut.keyedRatio > MAX_KEYED_RATIO
      ? `keyed ${cut.keyedRatio.toFixed(2)} — no background to remove`
      : cut.keyedRatio < MIN_KEYED_RATIO
        ? `keyed ${cut.keyedRatio.toFixed(2)} — background is not plain`
        : trimmedRatio > MAX_TRIMMED_RATIO
          ? `trimmed ${trimmedRatio.toFixed(2)} — the photo barely shrank`
          : null;

  if (refusal) {
    const plain = await plainSprite(bytes, meta);
    if (plain) {
      console.info(`[cutout] ${refusal}; using the listing photo as it is`);
      await writeCacheEntry(key, plain.png, {
        widthRatio: plain.widthRatio,
        category: "listing",
        source: "generated",
        width: plain.width,
        height: plain.height,
        createdAt: 0,
      });
      return {
        url: urlForKey(key),
        widthRatio: plain.widthRatio,
        keyedRatio: cut.keyedRatio,
        trimmedRatio,
        keyed: false,
      };
    }
    console.info(`[cutout] refused: ${refusal}`);
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

  return {
    url: urlForKey(key),
    widthRatio,
    keyedRatio: cut.keyedRatio,
    trimmedRatio,
    keyed: true,
  };
}

/**
 * The listing photo as it is: no alpha, just the picture, re-encoded as a PNG
 * so it travels the same path as a keyed cutout. Refused when the frame is
 * shaped like a banner rather than a product shot.
 */
async function plainSprite(
  bytes: Buffer,
  meta: { width?: number; height?: number }
): Promise<{ png: Buffer; widthRatio: number; width: number; height: number } | null> {
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  if (width < 80 || height < 80) return null;

  const ratio = width / height;
  // wider than 5:2 or taller than 2:5 is a banner or a colour strip
  if (ratio > 2.5 || ratio < 0.4) return null;

  try {
    const png = await sharp(bytes).png().toBuffer();
    return { png, widthRatio: ratio, width, height };
  } catch {
    return null;
  }
}
