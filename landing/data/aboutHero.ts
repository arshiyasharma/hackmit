/** Shared composition for the live HTML hero and the room's canvas preview. */
export const aboutHero = {
  width: 1600,
  height: 900,
  background: "#353e89",
  ink: "#f5dfa0",
  art: [
    { name: "ribbons", src: "about/hackmit/rabbit-ribbon.png", x: 870, y: 116, width: 710, height: 1005.7 },
    { name: "cloud", src: "about/hackmit/about-cloud.png", x: 946, y: 12, width: 590, height: 395.2 },
  ],
  eyebrow: { x: 112, y: 76, size: 16, lineHeight: 24, lines: ["PIXX-AR AT HACKMIT / 2026"] },
  title: { x: 104, y: 151, size: 140, lineHeight: 125, lines: ["Thank you,", "HackMIT."] },
  lede: { x: 112, y: 454, size: 22, lineHeight: 34, lines: ["To the judges, mentors, organizers, and volunteers:", "thank you for the questions, the encouragement,", "and the space to build something new."] },
  note: { x: 112, y: 579, size: 20, lineHeight: 30, lines: ["A room to reimagine. A weekend to build."] },
  cta: { x: 112, y: 645, width: 264, height: 58, size: 17, label: "The story behind PIXX-AR" },
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
