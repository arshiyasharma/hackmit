/**
 * VISA shared types.
 *
 * TWO RULES, NO EXCEPTIONS:
 *   - every dimension is an INTEGER of MILLIMETRES.
 *   - every money value is an INTEGER of CENTS.
 * No floats, no inches, no mixed units. Convert at the edge (the input field,
 * the API parser) and store millimetres and cents from then on.
 *
 * Field names mirror the API routes so a response can be handed straight to
 * the store without a translation layer.
 *
 * The product is one loop: photograph the room, ask for ONE object, stand a
 * placeholder sprite of it in the room, link a real listing to it, watch the
 * budget move. There is no mask, no region, no variant grid — those types are
 * gone and are not coming back.
 */

import type {
  FitResult as KernelFitResult,
  Profile as KernelProfile,
} from "@/lib/fit";

/** A box in source-image pixel coordinates. */
export type Rect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

/** Packed carton, millimetres: [width, height, depth]. */
export type Carton = [number, number, number];

/* ------------------------------------------------------------------ room */

/** The captured photo. `dataUrl` is already EXIF-rotated and downscaled. */
export type Room = {
  /**
   * A 512px copy sent to /api/analyze and nowhere else. The style read wants
   * five colours and four words, not detail, and a tenth of the bytes is a
   * tenth of the upload and the tokens.
   */
  analysisDataUrl?: string;
  dataUrl: string;
  /** natural pixels of dataUrl, after downscale */
  width: number;
  height: number;
  /** 0..1 mean luminance measured at capture; drives the "it's dark in here" note */
  luminance?: number;
  capturedAt: number;
};

/** Where the room context came from. A fallback says so on screen. */
export type RoomContextSource = "model" | "fallback";

/**
 * What /api/analyze gives back about the room. The photo is read for this and
 * for nothing else.
 *
 * `styleTags` are SHOPPING WORDS — "traditional", "middle eastern", "ornate",
 * "warm wood". They are pasted straight into the product search query, so a tag
 * nobody would type into a shop's search box is a useless tag.
 */
export type RoomContext = {
  /**
   * The colours the USER added by hand, a subset of `palette`. Kept apart
   * because these are intent — someone who picks sage means "find me a sage
   * one" — while the five read off the photo are just what the room looks
   * like. Only these go into the search query.
   */
  picked?: string[];
  /** words a shopper would type, lowercase, at most five */
  styleTags: string[];
  /** five hex strings, ordered by dominance */
  palette: string[];
  lighting: "warm" | "cool" | "neutral";
  /** plain words, e.g. "living room" — used to pick a default when the ask is empty */
  roomType?: string;
  /** ask-chip seeds generated from THIS room, e.g. "a tall lamp" */
  suggestions?: string[];
  /** "fallback" means the read failed and the search will be generic */
  source?: RoomContextSource;
};

/** What the user tapped to give the photo a real-world scale (photo mode). */
export type ScaleReference = {
  kind: "wall" | "door" | "outlet" | "brick" | "custom";
  /** what we show the user, e.g. "a standard interior door" */
  label: string;
  /** the assumed real size of that object */
  realMm: number;
  /** how many source-image pixels that object measured */
  pixels: number;
  /** where they tapped, source-image pixels */
  point: { x: number; y: number };
};

/* -------------------------------------------------------------- products */

/**
 * Where a dimension came from. "estimated" MUST be surfaced on screen in the
 * warn colour, and "missing" reads "no dimensions listed" — never hide the
 * difference between quoted, guessed and absent.
 */
/**
 * Where a size came from. "quoted" is the retailer's own number, "estimated"
 * is the scraper's reading of an unclear page, "approx" is what this kind of
 * object usually measures — a bowl-sized bowl — and "missing" is nothing at
 * all. They are never allowed to blur together: everything downstream says
 * which one it is showing.
 */
export type DimsSource = "quoted" | "estimated" | "approx" | "missing";

export type Product = {
  id: string;
  retailer: string;
  /** for the favicon, e.g. "ikea.com" */
  retailerDomain?: string;
  title: string;
  /** the REAL listing. A judge will tap this. */
  url: string;
  /** the listing's own photo. `image` is accepted as an alias from /api/search. */
  imageUrl?: string;
  image?: string;
  priceCents: number;
  /** ISO 4217, e.g. "USD" */
  currency: string;
  /** [width, height, depth] in millimetres; absent when the listing omits them */
  dimsMm?: Carton;
  dimsSource: DimsSource;
  inStock: boolean;
  /** the item this listing is an option for; set by the search route */
  itemId?: string;
  /** v2 called the same thing elementId. Optional, ignored by v3. */
  elementId?: string;
};

/** One place to read a listing's picture, whichever field the source filled. */
export function productImage(product: Product): string | undefined {
  return product.imageUrl ?? product.image;
}

/* ------------------------------------------------------------------- fit */

/**
 * EXACTLY what lib/fit.ts returns — aliased from the kernel, so the two can
 * never drift. Do not round it, do not reword `reason`. The presentation layer
 * prints these numbers verbatim.
 */
export type FitResult = KernelFitResult;
export type FitVerdict = FitResult["verdict"];
export type FitBinding = FitResult["binding"];
/** The kernel's own profile shape, as `fits(carton, profile)` wants it. */
export type FitProfile = KernelProfile;

/** The five things the user measures. Millimetres. */
export type ProfileField =
  | "doorWidthMm"
  | "doorHeightMm"
  | "hallwayWidthMm"
  | "landingWidthMm"
  | "ceilingHeightMm";

export type Profile = {
  doorWidthMm: number;
  doorHeightMm: number;
  hallwayWidthMm: number;
  landingWidthMm: number;
  ceilingHeightMm: number;
  /**
   * true once the user edited that field. Drives "assumed" vs
   * "you measured this" — the same honesty rule as quoted vs estimated dims.
   */
  measured: Partial<Record<ProfileField, boolean>>;
  /** what the user is willing to spend, integer cents */
  budgetCents: number;
  /** display preference only; the stored value is always millimetres */
  units: "mm" | "in";
};

/* ------------------------------------------------------------ placed items */

/** Whether an async job attached to an item has landed. */
export type AssetStatus = "pending" | "ready" | "failed";

/**
 * Which of the two pictures a sprite is wearing: the linked listing's own
 * photograph, or the drawing that was generated before any listing existed.
 *
 * Both are legitimate answers and which one is better is not something the
 * program can decide. A listing photo keyed cleanly off its white background is
 * the real product and beats any drawing of it, which is why it is the default
 * wherever one exists. A photo that would not key is a whole rectangular
 * picture — a lifestyle shot, a padded thumbnail, an advert — standing in the
 * middle of somebody's living room, and there the drawing is the honest one. So
 * the preference is remembered per item and the user has the final word.
 */
export type SpriteSource = "photo" | "drawing";

/**
 * One object the user asked for, standing in the room.
 *
 * THE ITEM EXISTS BEFORE EITHER ASYNC JOB RETURNS. `placeholderUrl` is "" and
 * `options` is empty until they land, which is what lets the UI show a skeleton
 * in the right place instead of a blank screen.
 *
 * The sprite's PICTURE never changes when a different listing is linked. Its
 * SIZE does — that is the part that tells the truth.
 */
export type PlacedItem = {
  id: string;
  /** what the user typed: "a tall lamp" */
  request: string;
  /** normalised server-side: "floor lamp" */
  category: string;
  /** the generated cutout PNG; "" until /api/placeholder answers */
  placeholderUrl: string;
  /**
   * The LINKED listing's own photo, keyed and trimmed. Once a product is
   * chosen the room shows the real thing; unlink and the stand-in returns,
   * which is why this is a second field rather than an overwrite.
   */
  listingCutoutUrl: string | null;
  listingWidthRatio: number | null;
  /**
   * Whether the background actually came off that photo. /api/cutout answers
   * with the listing photo untouched when it cannot key one cleanly, rather
   * than refusing and leaving the drawing standing where a real product had
   * just been chosen — so the url alone no longer tells us what is in the
   * picture, and this says which of the two arrived.
   */
  listingCutoutKeyed: boolean;
  /**
   * The user's OWN choice of picture, and null until they make one.
   *
   * Kept apart from the two urls for the same reason the room context keeps
   * edits apart from the model's answer: a choice is intent and must outlive
   * whatever lands afterwards, while an absent choice has to be worked out
   * fresh from the pictures that are actually there. Read it through
   * spriteSourceFor() rather than directly — null is a question, not an answer.
   */
  spriteSource: SpriteSource | null;
  /** the cutout's natural width / height, so the plane never distorts */
  placeholderWidthRatio: number;
  placeholderStatus: AssetStatus;
  /** the ~5 real listings */
  options: Product[];
  optionsStatus: AssetStatus;
  /** metres, AR world space */
  position: [number, number, number];
  /** degrees in photo mode, where the sprite lies in the picture plane */
  rotationY: number;
  /**
   * The user's own size, as a multiple of the listing's real size. 1 is true
   * scale and is what the fit check always judges — a sprite resized by hand
   * says so on its label rather than quietly claiming to be to scale.
   */
  scale: number;
  /** false until the user taps the floor (or drops it in photo mode) */
  placed: boolean;
  /** null until they pick one */
  linkedProduct: Product | null;
  fit: FitResult | null;
  createdAt: number;
};

/**
 * One line on the checkout review. The room screen has no cart — the basket IS
 * the set of items with a `linkedProduct` — but the review screen still groups
 * lines by retailer, and it builds them out of this.
 */
export type CartItem = {
  /** stable line id; the PlacedItem's id, so a line points back at its sprite */
  id: string;
  product: Product;
  quantity: number;
  /** the PlacedItem this line came from */
  itemId: string;
  addedAt: number;
};

/* --------------------------------------------------------------- savings */

/**
 * Every field is nullable ON PURPOSE. These are computed from a real ledger by
 * /api/savings. If the endpoint gives us nothing, the readout shows a dash.
 * An honest dash beats an invented number.
 */
export type Savings = {
  budgetCents: number | null;
  spentCents: number | null;
  minutesSaved: number | null;
  /** 0..100 */
  tokenPercentSaved: number | null;
  fitWarnings: number | null;
  itemsChecked: number | null;
};

/* ------------------------------------------------------------------ flow */

/** Two places, not four steps: the camera, then the room. */
export type Step = "capture" | "room";

/**
 * The room screen's explicit state machine. `activeItemId` names which item the
 * chrome is about; this names what that item is doing.
 */
export type RoomPhase =
  | "empty"
  | "asking"
  | "generating"
  | "placing"
  | "linked";
