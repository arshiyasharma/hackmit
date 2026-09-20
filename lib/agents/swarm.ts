import type { CartItem, Doorway } from "@/lib/cart-store";
import { evaluateItem, footprintOf } from "./constraints";
import { authorizeMandate, placeOrder } from "./visa-commerce";
import type {
  AgentContext,
  AgentEvent,
  ExpectedAttributes,
  PurchaseRecord,
  RetailerTask,
  Room,
  SpendMandate,
} from "./types";

/** Presentation pacing between verification steps so the swarm is legible on stage. */
const PACING_MS = 420;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Concurrent producers -> single async consumer. */
class EventQueue<T> {
  private buf: T[] = [];
  private waiting: ((r: IteratorResult<T>) => void) | null = null;
  private closed = false;

  push(v: T) {
    if (this.closed) return;
    if (this.waiting) {
      const w = this.waiting;
      this.waiting = null;
      w({ value: v, done: false });
    } else {
      this.buf.push(v);
    }
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    if (this.waiting) {
      const w = this.waiting;
      this.waiting = null;
      w({ value: undefined as never, done: true });
    }
  }

  async *stream(): AsyncGenerator<T> {
    for (;;) {
      if (this.buf.length) {
        yield this.buf.shift() as T;
        continue;
      }
      if (this.closed) return;
      const r = await new Promise<IteratorResult<T>>((res) => (this.waiting = res));
      if (r.done) return;
      yield r.value;
    }
  }
}

/** Real work: normalize every listing to inches before anything is compared. */
function normalize(item: CartItem): CartItem {
  if (item.dimensions.unit === "in") return item;
  const k = 1 / 2.54;
  return {
    ...item,
    dimensions: {
      h: +(item.dimensions.h * k).toFixed(1),
      w: +(item.dimensions.w * k).toFixed(1),
      d: +(item.dimensions.d * k).toFixed(1),
      unit: "in",
    },
  };
}

/** Shared authority ledger. Check-and-reserve is synchronous, so parallel agents can't race. */
class MandateLedger {
  committedUsd = 0;
  committedFootprintSqIn = 0;

  constructor(
    private mandate: SpendMandate,
    private doorway: Doorway | null,
    private room: Room | null,
    private expected?: ExpectedAttributes
  ) {}

  private ctx(): AgentContext {
    return {
      mandate: this.mandate,
      doorway: this.doorway,
      room: this.room,
      expected: this.expected,
      committedUsd: this.committedUsd,
      committedFootprintSqIn: this.committedFootprintSqIn,
    };
  }

  /** Evaluate and, on success, atomically reserve budget + floor space. */
  claim(item: CartItem) {
    const verdict = evaluateItem(item, this.ctx());
    if (verdict.ok) {
      this.committedUsd += item.price;
      this.committedFootprintSqIn += footprintOf(item);
    }
    return verdict;
  }
}

function groupByRetailer(items: CartItem[]): RetailerTask[] {
  const map = new Map<string, CartItem[]>();
  for (const it of items) {
    const list = map.get(it.retailer) ?? [];
    list.push(it);
    map.set(it.retailer, list);
  }
  return [...map.entries()].map(([retailer, items]) => ({ retailer, items }));
}

/**
 * One agent per retailer. Verifies each listing's dimensions/color, then asks the
 * shared mandate for authority to buy. Items that fail the constraints are halted
 * and escalated rather than purchased.
 */
async function runAgent(
  task: RetailerTask,
  ledger: MandateLedger,
  emit: (e: AgentEvent) => void
): Promise<{ retailer: string; approved: CartItem[]; halted: { retailer: string; title: string; reason: string }[] }> {
  emit({ type: "dispatched", retailer: task.retailer, itemCount: task.items.length });
  const approved: CartItem[] = [];
  const halted: { retailer: string; title: string; reason: string }[] = [];

  for (const raw of task.items) {
    const item = normalize(raw);
    emit({ type: "verifying", retailer: task.retailer, title: item.title });
    await wait(PACING_MS);

    const d = item.dimensions;
    emit({
      type: "verified",
      retailer: task.retailer,
      title: item.title,
      dims: `${d.w}×${d.d}×${d.h}in`,
      color: item.color,
    });
    await wait(PACING_MS / 2);

    const verdict = ledger.claim(item);
    if (verdict.ok) {
      approved.push(item);
      emit({ type: "constraint_pass", retailer: task.retailer, title: item.title, notes: verdict.notes });
    } else {
      halted.push({ retailer: task.retailer, title: item.title, reason: verdict.reason });
      emit({
        type: "halted",
        retailer: task.retailer,
        title: item.title,
        code: verdict.code,
        reason: verdict.reason,
      });
    }
    await wait(PACING_MS / 2);
  }

  return { retailer: task.retailer, approved, halted };
}

export async function* runSwarm(opts: {
  items: CartItem[];
  mandate: SpendMandate;
  doorway: Doorway | null;
  room: Room | null;
  expected?: ExpectedAttributes;
  userId: string;
}): AsyncGenerator<AgentEvent> {
  const tasks = groupByRetailer(opts.items);
  const queue = new EventQueue<AgentEvent>();
  const emit = (e: AgentEvent) => queue.push(e);

  emit({ type: "swarm_start", retailers: tasks.map((t) => t.retailer), mandate: opts.mandate });

  const ledger = new MandateLedger(opts.mandate, opts.doorway, opts.room, opts.expected);

  // Phase 1 — agents fan out and work in parallel.
  const settled = Promise.allSettled(tasks.map((t) => runAgent(t, ledger, emit)));

  // Phase 2 — once every agent reports back, settle once and place the orders.
  const finish = settled.then(async (results) => {
    const halted: { retailer: string; title: string; reason: string }[] = [];
    const approvedByRetailer: { retailer: string; items: CartItem[] }[] = [];

    results.forEach((r, i) => {
      if (r.status === "fulfilled") {
        halted.push(...r.value.halted);
        if (r.value.approved.length) approvedByRetailer.push({ retailer: r.value.retailer, items: r.value.approved });
      } else {
        emit({
          type: "failed",
          retailer: tasks[i].retailer,
          error: r.reason instanceof Error ? r.reason.message : String(r.reason),
        });
      }
    });

    const totalUsd = approvedByRetailer.reduce(
      (s, g) => s + g.items.reduce((a, i) => a + i.price, 0),
      0
    );

    const purchased: PurchaseRecord[] = [];
    let visaToken = "";

    if (totalUsd > 0) {
      // ONE real tokenized authorization covering every retailer.
      const mandate = await authorizeMandate({
        amountUsd: totalUsd,
        userId: opts.userId,
        retailers: approvedByRetailer.map((g) => g.retailer),
      });
      visaToken = mandate.visaToken;

      for (const group of approvedByRetailer) {
        const amount = group.items.reduce((a, i) => a + i.price, 0);
        emit({ type: "purchasing", retailer: group.retailer, amountUsd: amount });
        await wait(PACING_MS / 2);
        const order = await placeOrder({ mandate, retailer: group.retailer, amountUsd: amount });
        purchased.push(order);
        emit({ type: "purchased", retailer: group.retailer, order });
        await wait(PACING_MS / 2);
      }
    }

    emit({ type: "swarm_done", purchased, halted, totalUsd, visaToken });
  });

  // Surface a settlement failure loudly rather than ending on a silent half-done swarm.
  finish
    .catch((err) =>
      emit({
        type: "failed",
        retailer: "settlement",
        error: err instanceof Error ? err.message : String(err),
      })
    )
    .finally(() => queue.close());

  yield* queue.stream();
}
