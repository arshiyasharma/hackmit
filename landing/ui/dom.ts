// Tiny DOM helpers shared by every UI module.

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", html = ""): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (html) el.innerHTML = html;
  return el;
}

/** Copy deck markup: *key words* become highlighted spans, {n} style slots are filled. */
export function rich(text: string, vars: Record<string, string | number> = {}) {
  const filled = text.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ""));
  const safe = filled.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  return safe.replace(/\*(.+?)\*/g, '<b class="hl">$1</b>');
}

export const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

/** Resolve on the first click of a button, once. */
export const clicked = (el: HTMLElement) => new Promise<void>((resolve) => el.addEventListener("click", () => resolve(), { once: true }));
