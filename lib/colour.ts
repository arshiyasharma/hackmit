/**
 * Hex to a word a shop would recognise.
 *
 * A colour the user picked is intent — they mean "find me a sage one" — but
 * "#7b8b6f" is not something anyone types into a search box, so it has to
 * become a word before it can join the query. The list below is deliberately
 * short and deliberately made of SHOPPING words: the names retailers put in
 * their own titles, not paint-chart poetry. "sage" and "walnut" return
 * furniture; "eau de nil" and "greige" return nothing.
 *
 * Nearest match in RGB, which is crude but right for this: the palette only
 * needs to land on the right word, and every entry is far enough from its
 * neighbours that a near miss still reads as the same colour family.
 */

const NAMED: Array<[string, [number, number, number]]> = [
  ["black", [0x1a, 0x1a, 0x1a]],
  ["charcoal", [0x36, 0x38, 0x3a]],
  ["grey", [0x8a, 0x8d, 0x8f]],
  ["white", [0xf7, 0xf6, 0xf3]],
  ["cream", [0xef, 0xe4, 0xcf]],
  ["beige", [0xd9, 0xc7, 0xa8]],
  ["tan", [0xc2, 0x9c, 0x6c]],
  ["brown", [0x7a, 0x54, 0x33]],
  ["walnut", [0x5b, 0x3a, 0x29]],
  ["oak", [0xb8, 0x8e, 0x5a]],
  ["brass", [0xc9, 0xa2, 0x27]],
  ["gold", [0xd4, 0xaf, 0x37]],
  ["silver", [0xc0, 0xc0, 0xc0]],
  ["rust", [0xa8, 0x4b, 0x2a]],
  ["terracotta", [0xc9, 0x7b, 0x5f]],
  ["red", [0xb3, 0x23, 0x24]],
  ["pink", [0xe8, 0xa0, 0xb0]],
  ["purple", [0x6b, 0x4c, 0x8a]],
  ["navy", [0x1f, 0x2d, 0x54]],
  ["blue", [0x2f, 0x6f, 0xb5]],
  ["teal", [0x1f, 0x7a, 0x74]],
  ["green", [0x2e, 0x7d, 0x32]],
  ["sage", [0x7b, 0x8b, 0x6f]],
  ["olive", [0x6b, 0x6b, 0x2f]],
  ["mustard", [0xcf, 0xa6, 0x2b]],
  ["orange", [0xe0, 0x7b, 0x20]],
];

function rgb(hex: string): [number, number, number] | null {
  const raw = hex.trim().replace(/^#/, "");
  const full =
    raw.length === 3
      ? raw
          .split("")
          .map((c) => c + c)
          .join("")
      : raw;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

/** "#7b8b6f" -> "sage". null when it is not a colour at all. */
export function colourName(hex: string): string | null {
  const target = rgb(hex);
  if (!target) return null;

  let best = NAMED[0][0];
  let bestDistance = Infinity;
  for (const [name, value] of NAMED) {
    const d =
      (target[0] - value[0]) ** 2 +
      (target[1] - value[1]) ** 2 +
      (target[2] - value[2]) ** 2;
    if (d < bestDistance) {
      bestDistance = d;
      best = name;
    }
  }
  return best;
}

/**
 * The words for a set of picked colours, in order, without repeats — two
 * shades of the same green must not put "green green" in the query.
 */
export function colourNames(hexes: readonly string[]): string[] {
  const out: string[] = [];
  for (const hex of hexes) {
    const name = colourName(hex);
    if (name && !out.includes(name)) out.push(name);
  }
  return out;
}

/** Representative swatch for the same shopping colour names used in queries. */
export function colourHex(name: string): string | null {
  const match = NAMED.find(([word]) => word === name.toLowerCase());
  return match ? `#${match[1].map((channel) => channel.toString(16).padStart(2, "0")).join("")}` : null;
}
