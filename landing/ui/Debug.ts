import { manifest, type ChapterIndex } from "../data/manifest";
import { machine } from "../state/machine";
import type { Stage } from "../gl/Stage";
import type { PostValues } from "../gl/PostFX";
import { store } from "../state/store";

// Debug panel, toggled with the D key (spec M1): a slider for every post
// uniform, the camera moves, Fill basket, and dots that show where hotspots project.

export interface DebugActions {
  flyOut(): void;
  truck(dir: -1 | 1): void;
  flyIn(): void;
  chapter(): ChapterIndex;
}

export class Debug {
  el = document.createElement("div");
  private dots: HTMLElement[] = [];
  private off: (() => void)[] = [];

  constructor(private ui: HTMLElement, private stage: Stage, actions: DebugActions) {
    this.el.className = "sense-debug";
    this.el.hidden = true;
    const keys: (keyof PostValues)[] = ["zoom", "horizontal", "focus", "veil", "exposure", "grain"];
    this.el.innerHTML = `<h4>Sense debug (D)</h4>${keys
      .map((k) => `<label>${k}<input type="range" min="0" max="${k === "exposure" ? 1.5 : 1}" step="0.01" data-k="${k}"><output></output></label>`)
      .join("")}
      <label>rig<input type="range" min="0" max="1" step="0.01" data-rig><output></output></label>
      <div class="row">
        <button data-a="out">Fly out</button><button data-a="left">Truck left</button>
        <button data-a="right">Truck right</button><button data-a="in">Fly in</button>
        <button data-a="fill">Fill basket</button><button data-a="quality">Low quality</button>
      </div>`;
    ui.appendChild(this.el);

    this.el.querySelectorAll<HTMLInputElement>("input[data-k]").forEach((input) => {
      const k = input.dataset.k as keyof PostValues;
      input.addEventListener("input", () => { stage.post.values[k] = Number(input.value); });
    });
    const rig = this.el.querySelector<HTMLInputElement>("input[data-rig]")!;
    rig.addEventListener("input", () => { stage.world.rigAmount = Number(rig.value); });

    let low = false;
    this.el.addEventListener("click", (e) => {
      const a = (e.target as HTMLElement).dataset.a;
      if (a === "out") actions.flyOut();
      if (a === "left") actions.truck(-1);
      if (a === "right") actions.truck(1);
      if (a === "in") actions.flyIn();
      if (a === "fill") store.fillBasket();
      if (a === "quality") { low = !low; stage.setQuality(low); }
    });

    for (const h of manifest.hotspots) {
      const dot = document.createElement("i");
      dot.className = "sense-debug-dot";
      dot.dataset.id = h.id;
      dot.hidden = true;
      ui.appendChild(dot);
      this.dots.push(dot);
    }

    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "d" || e.metaKey || e.ctrlKey || e.altKey) return;
      // a "d" typed into a field is a letter, not a shortcut: the product's ask
      // field and budget field live on this page now
      const t = e.target;
      if (t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (machine.is("PRODUCT")) return;
      this.el.hidden = !this.el.hidden;
      this.dots.forEach((d) => (d.hidden = this.el.hidden));
    };
    window.addEventListener("keydown", onKey);
    this.off.push(() => window.removeEventListener("keydown", onKey));

    this.off.push(stage.onFrame(() => {
      if (this.el.hidden) return;
      this.el.querySelectorAll<HTMLInputElement>("input[data-k]").forEach((input) => {
        const v = stage.post.values[input.dataset.k as keyof PostValues];
        if (document.activeElement !== input) input.value = String(v);
        (input.nextElementSibling as HTMLOutputElement).value = v.toFixed(2);
      });
      if (document.activeElement !== rig) rig.value = String(stage.world.rigAmount);
      (rig.nextElementSibling as HTMLOutputElement).value = stage.world.rigAmount.toFixed(2);
      manifest.hotspots.forEach((h, i) => {
        const p = stage.world.project(h.u, h.v, h.chapter);
        this.dots[i].style.transform = `translate(${p.x}px, ${p.y}px)`;
      });
    }));
  }

  destroy() {
    this.off.forEach((fn) => fn());
    this.el.remove();
    this.dots.forEach((d) => d.remove());
  }
}
