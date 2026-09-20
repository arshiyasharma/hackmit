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
export function createRun(basket: Basket): CheckoutRun {
  const run: CheckoutRun = {
    runId: crypto.randomUUID(),
    basket: { ...basket, lines: basket.lines.map((line) => ({ ...line })) },
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

/**
 * Every state a line can be in that it will never leave.
 *
 * `held` belongs here: the agent has finished deciding and is waiting on a
 * person, not on itself. Leaving it out would mean a run with one held line
 * never stamps `finishedAt`, so the stream never sends `done` and the overlay
 * spins forever.
 */
const TERMINAL: ReadonlySet<LineStatus["state"]> = new Set([
  "placed",
  "held",
  "failed",
]);

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
export function findRunByBasketId(basketId: string): CheckoutRun | undefined {
  let newest: CheckoutRun | undefined;
  for (const run of store().values()) {
    if (run.basket.basketId !== basketId) continue;
    if (!newest || run.createdAt > newest.createdAt) newest = run;
  }
  return newest;
}

/**
 * The most recent run that actually finished, or nothing.
 *
 * Read-only, and the savings ledger is the only caller: "time saved" is
 * measured against a run that really happened, so a session with no finished
 * run has no claim to make and the counter shows a dash.
 */
export function latestFinishedRun(): CheckoutRun | undefined {
  let newest: CheckoutRun | undefined;
  for (const run of store().values()) {
    if (run.finishedAt === null) continue;
    if (!newest || run.finishedAt > (newest.finishedAt as number)) newest = run;
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
