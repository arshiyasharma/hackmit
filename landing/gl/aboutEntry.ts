import { aboutHero, type HeroText } from "../data/aboutHero";
import { asset } from "../data/manifest";

function loadArt(path: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = asset(path);
  });
}

/** The room window and the live hero share one composition, copy, and artwork. */
export async function aboutEntryCanvas() {
  const canvas = document.createElement("canvas");
  canvas.width = aboutHero.width;
  canvas.height = aboutHero.height;
  const ctx = canvas.getContext("2d")!;
  const styles = getComputedStyle(document.querySelector(".sense") ?? document.documentElement);
  const titleFamily = styles.getPropertyValue("--font-title").trim() || "Georgia, serif";
  const uiFamily = styles.getPropertyValue("--font-ui").trim() || "system-ui, sans-serif";
  const textBlocks = [aboutHero.eyebrow, aboutHero.lede, aboutHero.note, aboutHero.event];

  const loadFonts = async () => {
    if (!document.fonts) return;
    await Promise.allSettled([
      document.fonts.load(`500 ${aboutHero.title.size}px ${titleFamily}`, aboutHero.title.lines.join(" ")),
      document.fonts.load(`400 ${aboutHero.lede.size}px ${uiFamily}`, textBlocks.map((block) => block.lines.join(" ")).join(" ")),
    ]);
  };
  // A failed asset or font must not prevent entering the landing experience.
  const [art] = await Promise.all([
    Promise.all(aboutHero.art.map((entry) => loadArt(entry.src))),
    loadFonts().catch(() => undefined),
  ]);

  ctx.fillStyle = aboutHero.background;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  aboutHero.art.forEach((entry, index) => {
    const image = art[index];
    if (image) ctx.drawImage(image, entry.x, entry.y, entry.width, entry.height);
  });

  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  const lineBaseline = (text: string, top: number, size: number, lineHeight: number) => {
    const metrics = ctx.measureText(text);
    const ascent = Number.isFinite(metrics.fontBoundingBoxAscent) ? metrics.fontBoundingBoxAscent : size * 0.8;
    const descent = Number.isFinite(metrics.fontBoundingBoxDescent) ? metrics.fontBoundingBoxDescent : size * 0.2;
    // CSS centers the font's ascent/descent box within the line-height box.
    return top + (lineHeight - ascent - descent) / 2 + ascent;
  };
  const drawText = (block: HeroText, color: string, title = false) => {
    ctx.font = `${title ? 500 : 400} ${block.size}px ${title ? titleFamily : uiFamily}`;
    ctx.fillStyle = color;
    block.lines.forEach((line, index) => {
      ctx.fillText(line, block.x, lineBaseline(line, block.y + index * block.lineHeight, block.size, block.lineHeight));
    });
  };

  drawText(aboutHero.eyebrow, aboutHero.ink);
  drawText(aboutHero.title, aboutHero.ink, true);
  drawText(aboutHero.lede, "#faf7ee");
  drawText(aboutHero.note, "#d8d9e8");
  drawText(aboutHero.event, "#d8d9e8");

  const cta = aboutHero.cta;
  ctx.fillStyle = aboutHero.ink;
  ctx.beginPath();
  ctx.roundRect(cta.x, cta.y, cta.width, cta.height, 4);
  ctx.fill();
  ctx.font = `400 ${cta.size}px ${uiFamily}`;
  ctx.fillStyle = aboutHero.background;
  ctx.textAlign = "center";
  ctx.fillText(cta.label, cta.x + cta.width / 2, lineBaseline(cta.label, cta.y, cta.size, cta.height));
  return canvas;
}
