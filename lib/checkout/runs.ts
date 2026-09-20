/**
 * Where a checkout run lives while it is running.
 *
 * A module-level Map, on purpose and for now. Every caller goes through
 * `createRun` / `getRun` / `updateLine`, so swapping the body of those three
 * for a Mongo collection later changes nothing above this line.
 *
 * WHAT A MAP COSTS, said out loud so nobody is surprised at the booth:
 *   - it is per process. Two serverless instances do not share a run, so a
 *     `GET /api/checkout/{runId}` can land on an instance that never saw it.
 *     One Vercel deploy at demo scale keeps one instance warm and this holds;
 *     it is not a production answer and is not pretending to be one.
 *   - `next dev` replaces the module on hot reload and the runs go with it.
 *     Press checkout again.
 *
 * `globalThis` keeps the Map across a dev-server hot reload, which is worth the
 * four lines it costs — otherwise every edit mid-demo empties it.
 */

import type { Basket, CheckoutRun, LineStatus, RunLine } from "./types";

const STORE_KEY = Symbol.for("visa.checkout.runs");

type RunStore = Map<string, CheckoutRun>;

function store(): RunStore {
  const globals = globalThis as unknown as Record<symbol, RunStore | undefined>;
  const existing = globals[STORE_KEY];
  if (existing) return existing;
  const created: RunStore = new Map();
  globals[STORE_KEY] = created;
  return created;
}

/**
 * Freeze the basket into a run and mark every line pending.
 *
 * The basket is COPIED, not referenced. The room screen keeps editing while
 * the agent walks, and a settled run has to report the numbers it actually ran
 * on rather than whatever the basket drifted to afterwards.
 */
export function createRun(basket: Basket, ownerId?: string): CheckoutRun {
  const run: CheckoutRun = {
    runId: crypto.randomUUID(),
    ownerId,
    basket: structuredClone(basket),
    lines: basket.lines.map(
      (line): RunLine => ({ lineId: line.lineId, status: { state: "pending" } })
    ),
    createdAt: Date.now(),
    finishedAt: null,
    instructionId: null,
  };
  store().set(run.runId, run);
  return run;
}

export function getRun(runId: string): CheckoutRun | undefined {
  return store().get(runId);
}

/** Every state a line can be in that it will never leave. */
const TERMINAL: ReadonlySet<LineStatus["state"]> = new Set(["placed", "failed"]);

export function isTerminal(status: LineStatus): boolean {
  return TERMINAL.has(status.state);
}

/**
 * Move one line, and stamp `finishedAt` when that was the last one still
 * moving. Returns the updated run, or undefined when the run or the line is
 * not there — an unknown id is a 404 for the caller to answer, not a throw.
 */
export function updateLine(
  runId: string,
  lineId: string,
  status: LineStatus
): CheckoutRun | undefined {
  const run = store().get(runId);
  if (!run) return undefined;

  const at = run.lines.findIndex((line) => line.lineId === lineId);
  if (at === -1) return undefined;

  if (isTerminal(run.lines[at].status)) return run;
  run.lines[at] = { lineId, status };
  if (run.finishedAt === null && run.lines.every((line) => isTerminal(line.status))) {
    run.finishedAt = Date.now();
  }
  return run;
}

/**
 * The run whose frozen basket carries this basketId.
 *
 * The mandate endpoint is handed a basketId by the screen, not a runId, and a
 * mandate has to be built from the basket the agent ACTUALLY RAN ON rather
 * than from whatever the room screen has drifted to since. The newest matching
 * run wins, because pressing checkout twice should mandate the second basket.
 */
export function findRunByBasketId(basketId: string, ownerId?: string): CheckoutRun | undefined {
  let newest: CheckoutRun | undefined;
  for (const run of store().values()) {
    if (run.basket.basketId !== basketId || (ownerId !== undefined && run.ownerId !== ownerId)) continue;
    if (!newest || run.createdAt > newest.createdAt) newest = run;
  }
  return newest;
}

/** Record the Visa purchase instruction this run spends under. Prompt 7 calls this. */
export function setInstructionId(runId: string, instructionId: string): void {
  const run = store().get(runId);
  if (run) run.instructionId = instructionId;
}

/**
 * The Visa transaction reference for one line.
 *
 * THE SAME ID MUST BE USED TWICE: once to pull the payment credential and
 * again to confirm the transaction. Visa ties the two calls together by it, so
 * generating a fresh one at confirm time reports an event against a
 * transaction that never existed. It is minted at credential time and read
 * back here.
 *
 * It is an identifier, not a credential — no card data is ever stored.
 */
export function setTransactionReference(
  runId: string,
  lineId: string,
  transactionReferenceId: string
): void {
  const run = store().get(runId);
  if (!run) return;
  run.transactionReferences ??= {};
  run.transactionReferences[lineId] = transactionReferenceId;
}

export function getTransactionReference(
  runId: string,
  lineId: string
): string | undefined {
  return store().get(runId)?.transactionReferences?.[lineId];
}

/** The line's status inside a run, or undefined. */
export function getLineStatus(runId: string, lineId: string): LineStatus | undefined {
  return store().get(runId)?.lines.find((line) => line.lineId === lineId)?.status;
}

/** Has every line stopped moving? */
export function isRunFinished(run: CheckoutRun): boolean {
  return run.lines.every((line) => isTerminal(line.status));
}

/** Scope cancellation to the same browser that created the mandate. */
export function findRunByInstructionId(instructionId: string, ownerId: string): CheckoutRun | undefined {
  for (const run of store().values()) {
    if (run.instructionId === instructionId && run.ownerId === ownerId) return run;
  }
  return undefined;
}

/** Collapse concurrent retries and retain a successful safe response per run. */
export async function runOnce(run: CheckoutRun, key: string, operation: () => Promise<Response>): Promise<Response> {
  run.operations ??= new Map();
  let pending = run.operations.get(key);
  if (!pending) {
    pending = Promise.resolve().then(operation);
    run.operations.set(key, pending);
  }
  try {
    const response = await pending;
    if (!response.ok) run.operations.delete(key);
    return response.clone();
  } catch (error) {
    run.operations.delete(key);
    throw error;
  }
}
