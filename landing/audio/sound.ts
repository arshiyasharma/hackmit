import { Howl, Howler } from "howler";
import { asset, manifest } from "../data/manifest";
import { exists } from "../gl/placeholder";
import { gsap, wait } from "../motion";

// Audio with a global mute. Every file is optional: a missing voice line still
// holds its subtitle for a natural reading time, a missing effect is silent.

type SfxName = keyof typeof manifest.sfx;

class Sound {
  private sfxCache = new Map<string, Howl | null>();
  private roomtone?: Howl;
  private current?: Howl;
  muted = false;
  private hushed = false;

  private async load(path: string, opts: Partial<ConstructorParameters<typeof Howl>[0]> = {}) {
    if (this.sfxCache.has(path)) return this.sfxCache.get(path)!;
    const howl = (await exists(path)) ? new Howl({ src: [asset(path)], preload: true, ...opts }) : null;
    this.sfxCache.set(path, howl);
    return howl;
  }

  preload() {
    for (const path of Object.values(manifest.sfx)) void this.load(path);
    for (const vo of manifest.vo) void this.load(vo.file);
  }

  async startRoomtone() {
    const howl = await this.load(manifest.sfx.roomtone, { loop: true, volume: 0 });
    if (!howl || this.roomtone) return;
    this.roomtone = howl;
    howl.play();
    howl.fade(0, this.hushed ? 0 : 0.5, 2000);
  }

  private duck(down: boolean) {
    if (!this.roomtone) return;
    if (this.hushed) return;
    this.roomtone.fade(this.roomtone.volume(), down ? 0.15 : 0.5, 400);
  }

  /** The product brings its own room, so the recorded one steps out while it is open. */
  hush(on: boolean) {
    this.hushed = on;
    if (!this.roomtone) return;
    this.roomtone.fade(this.roomtone.volume(), on ? 0 : 0.5, 600);
  }

  async sfx(name: SfxName, volume = 0.7) {
    const howl = await this.load(manifest.sfx[name]);
    if (!howl) return;
    howl.volume(volume);
    howl.play();
  }

  /** Play voice line n (1 based). Resolves with how long the line lasts. */
  async vo(n: number, onStart?: (seconds: number) => void) {
    const entry = manifest.vo[n - 1];
    const howl = await this.load(entry.file);
    const fallback = Math.max(1.8, entry.line.length * 0.07);
    if (!howl) {
      onStart?.(fallback);
      await wait(fallback);
      return;
    }
    if (howl.state() !== "loaded") await new Promise<void>((resolve) => howl.once("load", () => resolve()));
    this.current?.stop();
    this.current = howl;
    this.duck(true);
    const seconds = howl.duration() || fallback;
    onStart?.(seconds);
    howl.play();
    await wait(seconds + 0.15);
    this.duck(false);
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    Howler.mute(muted);
  }

  destroy() {
    gsap.killTweensOf(this);
    Howler.unload();
    this.sfxCache.clear();
    this.roomtone = undefined;
  }
}

export const sound = new Sound();
