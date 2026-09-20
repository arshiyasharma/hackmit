// HackMIT-flavoured decoration, drawn rather than generated: flat vector ribbons,
// clouds, stars and sparkles in their palette minus the deep navy, which the
// landing replaces with its own blue. SVG keeps it crisp at any size, themeable
// from the tokens, and weightless next to another set of images.

export const HACK = {
  coral: "#E2705F",
  peach: "#F0A868",
  butter: "#F2D888",
  sage: "#9FC8A8",
  lavender: "#B5A8DE",
  sky: "#8FC4DE",
};

/** A long flowing ribbon, the motif the HackMIT page is built from. */
export function ribbon(colors: string[], opacity = 1) {
  const band = (i: number, c: string) =>
    `<path d="M-40 ${120 + i * 26} C 240 ${40 + i * 30}, 520 ${240 + i * 22}, 820 ${120 + i * 28}
              C 1060 ${30 + i * 26}, 1240 ${210 + i * 24}, 1480 ${140 + i * 26}"
       fill="none" stroke="${c}" stroke-width="${30 - i * 2}" stroke-linecap="round"/>`;
  return `<svg class="decor-ribbon" viewBox="0 0 1440 420" preserveAspectRatio="none" aria-hidden="true"
      style="opacity:${opacity}">${colors.map((c, i) => band(i, c)).join("")}</svg>`;
}

/** The four-point sparkle scattered across their sky. */
export function sparkle(color: string, size = 24) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 0 C 12.6 7.2, 16.8 11.4, 24 12 C 16.8 12.6, 12.6 16.8, 12 24
             C 11.4 16.8, 7.2 12.6, 0 12 C 7.2 11.4, 11.4 7.2, 12 0 Z" fill="${color}"/></svg>`;
}

/** A stack of scalloped cloud lobes, as on their About sky. */
export function cloud(color: string, w = 260) {
  return `<svg width="${w}" height="${Math.round(w * 0.46)}" viewBox="0 0 260 120" aria-hidden="true">
    <path fill="${color}" d="M18 108 C 2 98, 4 74, 24 68 C 18 44, 44 26, 66 38 C 74 14, 112 8, 128 28
      C 146 6, 186 12, 194 38 C 220 34, 242 54, 236 78 C 254 84, 256 106, 238 112 Z"/></svg>`;
}

/** The checkerboard band under their tent valance. */
export function checker(a: string, b: string, cols = 12) {
  const cells = Array.from({ length: cols * 2 }, (_, i) => {
    const x = (i % cols) * 20;
    const y = Math.floor(i / cols) * 20;
    const fill = (Math.floor(i / cols) + (i % cols)) % 2 ? a : b;
    return `<rect x="${x}" y="${y}" width="20" height="20" fill="${fill}"/>`;
  });
  return `<svg class="decor-checker" viewBox="0 0 ${cols * 20} 40" preserveAspectRatio="none" aria-hidden="true">${cells.join("")}</svg>`;
}

/** A scalloped valance, the top edge of their sponsor tent. */
export function valance(color: string, scallops = 10) {
  const w = 1440;
  const r = w / scallops / 2;
  let d = `M0 0 H${w} V26 `;
  for (let i = scallops - 1; i >= 0; i--) d += `A${r} ${r} 0 0 1 ${i * 2 * r} 26 `;
  return `<svg class="decor-valance" viewBox="0 0 ${w} 56" preserveAspectRatio="none" aria-hidden="true">
    <path d="${d} Z" fill="${color}"/></svg>`;
}

/** A hand-drawn star, smaller and rounder than the sparkle. */
export function star(color: string, size = 18) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true">
    <path fill="${color}" d="M12 1.6 L14.9 8.6 L22.4 9.2 L16.7 14.1 L18.4 21.4 L12 17.5 L5.6 21.4
      L7.3 14.1 L1.6 9.2 L9.1 8.6 Z"/></svg>`;
}
