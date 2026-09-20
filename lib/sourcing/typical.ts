import type { Carton } from "@/types";

/**
 * WHAT THIS KIND OF THING USUALLY MEASURES.
 *
 * Most listings quote no size at all. Etsy sellers almost never do, and plenty
 * of Amazon and Walmart pages bury it somewhere the scraper cannot reach — so
 * the honest answer, "no dimensions listed", was the answer for most of the
 * shelf, and an object with no size cannot stand in the room at the right
 * height or be fit-checked against a doorway.
 *
 * A bowl is a bowl. It is about 150 mm across and about 80 mm tall, and saying
 * so is far more useful than saying nothing, as long as nobody is told it came
 * from the listing. Every number here is a typical retail size for that kind
 * of object, and everything that uses one is marked "approx" all the way
 * through the app — the strip under the sprite, the card, the basket and the
 * fit sheet all say so, and the fit check treats it as a warning rather than a
 * measurement.
 *
 * THE ORDER OF THIS LIST IS THE RULE. The first pattern that matches wins, so
 * the specific ones come first: "floor lamp" before "lamp", "coffee table"
 * before "table", "floor pillow" before "pillow". A word that could mean two
 * very different objects is left out entirely rather than guessed at.
 *
 * Millimetres, as [width, height, depth], the same order and units as the rest
 * of the app.
 */

type Typical = readonly [RegExp, Carton];

const TABLE: readonly Typical[] = [
  /* lighting */
  [/\bfloor lamps?\b|\btorchiere\b/i, [350, 1500, 350]],
  [/\btable lamps?\b|\bbedside lamps?\b|\bdesk lamps?\b/i, [300, 500, 300]],
  [/\bchandeliers?\b|\bpendant lights?\b/i, [500, 600, 500]],
  [/\bwall sconces?\b|\bsconces?\b/i, [150, 300, 200]],
  [/\blamp ?shades?\b/i, [350, 250, 350]],
  [/\bstring lights?\b|\bfairy lights?\b/i, [100, 100, 100]],

  /* seating */
  [/\bsectionals?\b/i, [2600, 850, 1700]],
  [/\bsofas?\b|\bcouch(es)?\b|\bsettees?\b/i, [2100, 850, 900]],
  [/\bloveseats?\b/i, [1500, 850, 900]],
  [/\barmchairs?\b|\baccent chairs?\b|\blounge chairs?\b/i, [800, 850, 850]],
  [/\brocking chairs?\b|\bglider\b/i, [700, 1000, 850]],
  [/\bbar stools?\b|\bcounter stools?\b/i, [400, 750, 400]],
  [/\bdesk chairs?\b|\boffice chairs?\b/i, [650, 1100, 650]],
  [/\bdining chairs?\b|\bside chairs?\b/i, [450, 900, 550]],
  [/\bbean ?bags?\b/i, [800, 700, 800]],
  [/\bpoufs?\b/i, [550, 350, 550]],
  [/\bottomans?\b|\bfootstools?\b/i, [600, 400, 600]],
  [/\bbenches?\b|\bbench\b/i, [1200, 450, 400]],
  [/\bstools?\b/i, [400, 650, 400]],
  [/\bchairs?\b/i, [600, 850, 650]],

  /* tables and storage */
  [/\bcoffee tables?\b|\bcocktail tables?\b/i, [1200, 450, 600]],
  [/\bside tables?\b|\bend tables?\b|\baccent tables?\b/i, [500, 550, 500]],
  [/\bconsole tables?\b|\bsofa tables?\b/i, [1200, 750, 350]],
  [/\bdining tables?\b|\bkitchen tables?\b/i, [1800, 750, 900]],
  [/\bnightstands?\b|\bbedside tables?\b/i, [500, 600, 400]],
  [/\bwriting desks?\b|\bdesks?\b/i, [1200, 750, 600]],
  [/\bbookcases?\b|\bbookshel(f|ves)\b/i, [800, 1800, 300]],
  [/\bwardrobes?\b|\barmoires?\b/i, [1000, 2000, 600]],
  [/\bdressers?\b|\bchests? of drawers\b/i, [1500, 800, 500]],
  [/\bfiling cabinets?\b/i, [400, 700, 500]],
  [/\btv stands?\b|\bmedia consoles?\b|\bentertainment cent(er|re)s?\b/i, [1500, 550, 400]],
  [/\bsideboards?\b|\bbuffets?\b|\bcredenzas?\b/i, [1600, 800, 450]],
  [/\bfloating shel(f|ves)\b|\bwall shel(f|ves)\b|\bshel(f|ves)\b/i, [600, 100, 200]],
  [/\bcoat racks?\b|\bhall trees?\b/i, [500, 1700, 500]],
  [/\bstorage (boxes|box|bins?|baskets?)\b/i, [400, 300, 300]],
  [/\bbaskets?\b/i, [400, 350, 400]],
  [/\btrunks?\b/i, [900, 500, 450]],
  [/\btables?\b/i, [1000, 600, 600]],

  /* beds */
  [/\bking bed\b|\bking size bed\b/i, [1980, 1000, 2130]],
  [/\bqueen bed\b|\bqueen size bed\b|\bbed frames?\b|\bbeds?\b/i, [1560, 1000, 2080]],
  [/\bheadboards?\b/i, [1560, 1200, 80]],
  [/\bcribs?\b|\bcots?\b/i, [1400, 950, 750]],
  [/\bmattress(es)?\b/i, [1530, 250, 2030]],

  /* soft things */
  [/\bfloor pillows?\b|\bfloor cushions?\b|\bmeditation cushions?\b/i, [650, 200, 650]],
  [/\bthrow pillows?\b|\bcushion covers?\b|\bpillows?\b|\bcushions?\b/i, [450, 450, 120]],
  [/\bbody pillows?\b/i, [500, 200, 1350]],
  [/\brunner rugs?\b|\brug runners?\b/i, [760, 10, 2130]],
  [/\brugs?\b|\bcarpets?\b|\bmats?\b/i, [1520, 10, 2130]],
  [/\bthrows?\b|\bblankets?\b|\bquilts?\b/i, [1300, 50, 1700]],
  [/\bcurtains?\b|\bdrapes?\b|\bcurtain panels?\b/i, [1320, 2130, 20]],
  [/\bplush(ies?)?\b|\bstuffed animals?\b|\bplush toys?\b|\bsoft toys?\b/i, [300, 400, 250]],
  [/\byoga mats?\b|\bexercise mats?\b/i, [610, 20, 1730]],

  /* on the wall */
  [/\bfloor mirrors?\b|\bfull.length mirrors?\b/i, [700, 1700, 50]],
  [/\bmirrors?\b/i, [600, 900, 40]],
  [/\bwall clocks?\b|\bclocks?\b/i, [300, 300, 50]],
  [/\bcanvas(es)?\b|\bwall art\b|\bframed (prints?|pictures?|art)\b/i, [600, 900, 40]],
  [/\bposters?\b|\bprints?\b/i, [610, 910, 10]],
  [/\b(picture |photo )?frames?\b/i, [400, 500, 30]],
  [/\btapestr(y|ies)\b/i, [1500, 1000, 10]],

  /* small things on surfaces */
  [/\bplant(ers?| pots?)\b|\bflower ?pots?\b/i, [300, 300, 300]],
  [/\b(potted |house)?plants?\b|\btrees?\b/i, [400, 900, 400]],
  [/\bvases?\b/i, [150, 300, 150]],
  [/\bcandle ?holders?\b|\bcandlesticks?\b/i, [100, 200, 100]],
  [/\bcandles?\b/i, [70, 150, 70]],
  [/\bdiffusers?\b/i, [100, 150, 100]],
  [/\btrays?\b/i, [450, 50, 300]],
  [/\bbowls?\b/i, [150, 80, 150]],
  [/\bplates?\b/i, [260, 20, 260]],
  [/\bmugs?\b|\bcups?\b/i, [90, 100, 120]],
  [/\bbooks?\b|\bbookends?\b/i, [150, 230, 40]],
  [/\bwaste ?baskets?\b|\bbins?\b/i, [250, 300, 250]],
  [/\bspeakers?\b/i, [180, 250, 180]],
  [/\bfans?\b/i, [400, 1200, 400]],
];

/**
 * A typical size for whatever this listing is, or null when nothing in the
 * table is a confident match. Both the listing's own title and what the user
 * asked for are read, because a title like "Ida & Totem Set, Handmade" says
 * nothing while the request, "a plushie", says everything.
 */
export function typicalDimsMm(
  title: string | null | undefined,
  request?: string | null
): Carton | null {
  const haystack = `${title ?? ""} ${request ?? ""}`;
  if (!haystack.trim()) return null;

  for (const [pattern, dims] of TABLE) {
    if (pattern.test(haystack)) return [...dims] as Carton;
  }
  return null;
}
