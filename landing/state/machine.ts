// Finite state machine: the single source of truth for what the page is
// showing. Input is ignored while a transition runs (spec E1 item 10).

export type StateName =
  | "BOOT" | "TITLE" | "INTRO_VO" | "ROOM" | "FOUND" | "INTERACTION" | "REWARD"
  | "BASKET" | "FLYOUT" | "FACADE" | "TRUCK" | "FLYIN" | "APPROVE" | "RECEIPTS" | "FINALE"
  /** the real product is open over room III; the landing is only its backdrop */
  | "PRODUCT";

type Listener = (next: StateName, prev: StateName) => void;

class Machine {
  state: StateName = "BOOT";
  busy = false;
  private listeners = new Set<Listener>();

  subscribe(fn: Listener) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  is(...names: StateName[]) {
    return names.includes(this.state);
  }

  set(next: StateName) {
    const prev = this.state;
    if (prev === next) return;
    this.state = next;
    this.listeners.forEach((fn) => fn(next, prev));
  }

  /** Run a transition with the input lock held. Returns false when refused. */
  async run(via: StateName | null, to: StateName, work: () => Promise<unknown> | void) {
    if (this.busy) return false;
    this.busy = true;
    try {
      if (via) this.set(via);
      await work();
      this.set(to);
    } finally {
      this.busy = false;
    }
    return true;
  }

  reset() {
    this.listeners.clear();
    this.state = "BOOT";
    this.busy = false;
  }
}

export const machine = new Machine();
