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

  run.lines[at] = { lineId, status };
  if (run.finishedAt === null && run.lines.every((line) => isTerminal(line.status))) {
    run.finishedAt = Date.now();
  }
  return run;
}

/** Record the Visa purchase instruction this run spends under. Prompt 7 calls this. */
export function setInstructionId(runId: string, instructionId: string): void {
  const run = store().get(runId);
  if (run) run.instructionId = instructionId;
}

/** Has every line stopped moving? */
export function isRunFinished(run: CheckoutRun): boolean {
  return run.lines.every((line) => isTerminal(line.status));
}
