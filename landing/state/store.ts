import { manifest, type ChapterIndex, type FabricId, type HotspotId, type PieceId } from "../data/manifest";

export interface Progress {
  chapter: ChapterIndex;
  pieces: PieceId[];
  visited: HotspotId[];
  fabric: FabricId;
  phoneFound: boolean;
  approved: boolean;
  muted: boolean;
}

type Listener = (state: Progress, changed: Partial<Progress>) => void;

class Store {
  state: Progress = {
    chapter: 0,
    pieces: [],
    visited: [],
    fabric: "oat",
    phoneFound: false,
    approved: false,
    muted: false,
  };
  private listeners = new Set<Listener>();

  subscribe(fn: Listener) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  set(patch: Partial<Progress>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((fn) => fn(this.state, patch));
  }

  has(id: PieceId) {
    return this.state.pieces.includes(id);
  }

  earn(id: PieceId) {
    if (!this.has(id)) this.set({ pieces: [...this.state.pieces, id] });
  }

  visit(id: HotspotId) {
    if (!this.state.visited.includes(id)) this.set({ visited: [...this.state.visited, id] });
  }

  fillBasket() {
    this.set({ pieces: manifest.pieces.map((p) => p.id), phoneFound: true });
  }

  get count() {
    return this.state.pieces.length;
  }

  get left() {
    return manifest.pieces.length - this.count;
  }

  get total() {
    return manifest.pieces.filter((p) => this.has(p.id)).reduce((sum, p) => sum + p.price, 0);
  }

  /** the room still a chapter shows for the current progress */
  roomStill(chapter: ChapterIndex) {
    if (chapter === 0) return this.has("lamp") ? manifest.rooms.R1b : manifest.rooms.R1a;
    if (chapter === 1) return manifest.rooms.R2;
    // chapter IV is the hackathon room the About page opens over
    if (chapter === 3) return manifest.rooms.R4;
    return manifest.roomFabricVariants[this.state.fabric] ?? manifest.rooms.R3;
  }

  reset() {
    this.listeners.clear();
    this.state = { chapter: 0, pieces: [], visited: [], fabric: "oat", phoneFound: false, approved: false, muted: false };
  }
}

export const store = new Store();

// Whether this browser has already been through the onboarding. It decides
// nothing about the flow; it only makes the Skip tile louder on a return visit.
const SEEN = "pixxar:onboarded";
export const hasOnboarded = () => {
  try { return localStorage.getItem(SEEN) === "1"; } catch { return false; }
};
export const markOnboarded = () => {
  try { localStorage.setItem(SEEN, "1"); } catch { /* private window: it just will not stick */ }
};
