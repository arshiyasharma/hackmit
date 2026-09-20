/** Room-entry preview echoes the pitch page’s slogan, colors, and team photography. */
export const aboutHero = {
  width: 1600,
  height: 900,
  background: "#353e89",
  ink: "#f5dfa0",
  art: [
    { name: "ribbons", src: "about/hackmit/rabbit-ribbon.png", x: 1090, y: 70, width: 500, height: 710 },
    { name: "team", src: "about/photos/opening-ceremony.webp", x: 1040, y: 120, width: 375, height: 500 },
    { name: "build", src: "about/photos/team-build.webp", x: 940, y: 550, width: 410, height: 231 },
  ],
  eyebrow: { x: 112, y: 76, size: 16, lineHeight: 24, lines: ["ROOM IV / PIXX-AR AT HACKMIT"] },
  title: { x: 104, y: 151, size: 136, lineHeight: 125, lines: ["The spatial", "marketplace."] },
  lede: { x: 112, y: 454, size: 22, lineHeight: 34, lines: ["Your room is the starting point.", "Everything it could become is the possibility."] },
  note: { x: 112, y: 579, size: 20, lineHeight: 30, lines: ["A photo. A feeling. A room full of possibilities."] },
  cta: { x: 112, y: 645, width: 264, height: 58, size: 17, label: "Step into our story" },
  event: { x: 112, y: 832, size: 14, lineHeight: 22, lines: ["SEPTEMBER 19–20, 2026  /  CAMBRIDGE, MA"] },
} as const;

export type HeroText = { x: number; y: number; size: number; lineHeight: number; lines: readonly string[] };

export const heroTextStyle = (text: HeroText) =>
  `left:${text.x / aboutHero.width * 100}%;top:${text.y / aboutHero.height * 100}%;font-size:${text.size / aboutHero.width * 100}cqw;line-height:${text.lineHeight / text.size}`;

export const aboutChapters = [
  { title: "The problem", note: "The question that started it.", target: "about-problem", art: "chapter-1" },
  { title: "Targeted Tracks", note: "The challenges we explored.", target: "about-tracks", art: "chapter-2" },
  { title: "The weekend", note: "From an idea to a prototype.", target: "about-weekend", art: "chapter-3" },
  { title: "Fun Moments", note: "The people behind the pixels.", target: "about-gallery", art: "chapter-4" },
] as const;
