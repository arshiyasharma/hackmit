import * as THREE from "three";
import { asset, manifest } from "../data/manifest";

// Missing assets must never block work (spec E1 item 12): when a file is not
// there, a labelled canvas stands in and one warning is logged.

const cache = new Map<string, Promise<THREE.Texture>>();
const missing = new Set<string>();

const TINTS: Record<string, string> = {
  rooms: "#cfc6b4",
  fabric: "#c9bfa6",
  approve: "#b79b6f",
  facade: "#e8c9a6",
};

function tune(tex: THREE.Texture) {
  // shaders read and write sRGB bytes untouched, so no color space conversion
  tex.colorSpace = THREE.NoColorSpace;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

export function placeholderCanvas(path: string, w = 1920, h = 1080) {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  const kind = path.split("/")[0];
  const name = path.split("/").pop()!.replace(/\.\w+$/, "");
  const chapter = manifest.chapters.find((c) => c.facade === path);

  ctx.fillStyle = TINTS[kind] ?? "#bdbdbd";
  ctx.fillRect(0, 0, w, h);

  ctx.strokeStyle = "rgba(0,0,0,0.12)";
  ctx.lineWidth = 2;
  for (let i = 1; i < 16; i++) {
    ctx.beginPath(); ctx.moveTo((i / 16) * w, 0); ctx.lineTo((i / 16) * w, h); ctx.stroke();
  }
  for (let j = 1; j < 9; j++) {
    ctx.beginPath(); ctx.moveTo(0, (j / 9) * h); ctx.lineTo(w, (j / 9) * h); ctx.stroke();
  }

  if (kind === "facade") {
    const r = manifest.windowRect;
    ctx.fillStyle = chapter?.accent ?? "#333";
    ctx.fillRect((r.x - 0.07) * w, (r.y - 0.03) * h, (r.w + 0.14) * w, (r.h + 0.06) * h);
    ctx.fillStyle = "#000";
    ctx.fillRect(r.x * w, r.y * h, r.w * w, r.h * h);
  } else if (kind === "rooms") {
    const s = manifest.safeArea;
    ctx.setLineDash([24, 16]);
    ctx.strokeStyle = "rgba(0,0,0,0.45)";
    ctx.lineWidth = 4;
    ctx.strokeRect(s.u0 * w, s.v0 * h, (s.u1 - s.u0) * w, (s.v1 - s.v0) * h);
    ctx.setLineDash([]);
  }

  ctx.fillStyle = "rgba(0,0,0,0.62)";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `700 ${Math.round(h * 0.13)}px "Work Sans", system-ui, sans-serif`;
  ctx.fillText(name, w / 2, kind === "facade" ? h * 0.84 : h / 2);
  ctx.font = `400 ${Math.round(h * 0.03)}px "Work Sans", system-ui, sans-serif`;
  ctx.fillText(`placeholder for ${path}`, w / 2, (kind === "facade" ? h * 0.84 : h / 2) + h * 0.1);
  return canvas;
}

/** Load an asset as a texture, or fall back to a labelled placeholder. */
export function loadTexture(path: string): Promise<THREE.Texture> {
  const hit = cache.get(path);
  if (hit) return hit;
  const job = new Promise<THREE.Texture>((resolve) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => {
      const tex = new THREE.Texture(img);
      resolve(tune(tex));
    };
    img.onerror = () => {
      if (!missing.size) console.warn("[sense] missing assets are shown as placeholders, first one:", path);
      missing.add(path);
      resolve(tune(new THREE.CanvasTexture(placeholderCanvas(path))));
    };
    img.src = asset(path);
  });
  cache.set(path, job);
  return job;
}

export const isMissing = (path: string) => missing.has(path);

/** Resolve true when a file exists, used for optional video and audio. */
export async function exists(path: string) {
  try {
    const res = await fetch(asset(path), { method: "HEAD" });
    const type = res.headers.get("content-type") ?? "";
    return res.ok && !type.includes("text/html");
  } catch {
    return false;
  }
}

export function disposeTextures() {
  cache.forEach((job) => job.then((t) => t.dispose()));
  cache.clear();
  missing.clear();
}
