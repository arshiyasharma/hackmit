import { latestFinishedRun } from "@/lib/checkout/runs";
import { manualBaseline, baselineModel } from "@/lib/savings/assumptions";
import { costSavings, timeSavings, tokenSavings } from "@/lib/savings/compute";
import { analyzeRecords } from "@/lib/savings/ledger";

/**
 * GET /api/savings — the run ledger, as numbers a counter can show.
 *
 * WHAT THIS ROUTE WILL NOT DO. It will not return a number nobody measured.
 * `components/SavingsRail.tsx` renders null as a dash and says so on screen
 * ("A dash means we haven't measured it yet"), so every field here is either
 * something we counted or it is null. There is no placeholder branch and no
 * "reasonable default" — those are the same bug wearing a tie.
 *
 * THE SHAPE IS SavingsRail's, PLUS ITS OWN WORKING. The four fields the panel
 * reads come first; `detail` carries the arithmetic behind them, labelled
 * measured or assumed, because the two sponsor tracks want to see the method
 * and not just the headline. The panel's `parseSavings` ignores everything it
 * does not recognise, so the extra costs it nothing.
 *
 * WHAT THE SERVER DOES NOT KNOW. The basket lives in the browser's store, so
 * `budgetCents`, `spentCents`, `fitWarnings` and `itemsChecked` are null here
 * on purpose — the panel computes those from the items in front of the person
 * and only falls back to this route. Answering them from a stale server guess
 * would make the panel worse, not better.
 */

export const runtime = "nodejs";

export async function GET() {
  const records = analyzeRecords();
  const tokens = tokenSavings(records);
  const cost = costSavings(records, baselineModel());

  /*
   * Time is the one counter that needs a finished run: it is measured against
   * the shops and lines the agent actually walked. No run, no claim.
   */
  const run = latestFinishedRun();
  const baseline = manualBaseline();

  const time = run
    ? timeSavings({
        retailers: new Set(run.basket.lines.map((l) => l.retailer)).size,
        items: run.basket.lines.length,
        dimensionChecks: run.basket.lines.filter((l) => l.dimensionsMm !== null).length,
        /*
         * Every millisecond we actually timed: the walk itself, plus the model
         * reads that fed it. Real wall clock, not a stand-in.
         */
        measuredMs:
          (run.finishedAt as number) -
          run.createdAt +
          records.reduce((ms, r) => ms + r.elapsedMs, 0),
        baseline,
      })
    : null;

  return Response.json(
    {
      /* ---- what SavingsRail reads ---- */
      // the browser owns the basket; see the note above
      budgetCents: null,
      spentCents: null,
      fitWarnings: null,
      itemsChecked: null,
      minutesSaved: time?.minutesSaved ?? null,
      tokenPercentSaved: tokens.percentSaved,

      /* ---- the working, for anyone who asks how ---- */
      detail: {
        tokens: {
          measured: true,
          ...tokens,
          note:
            "Every token here came back from a provider on a real response. " +
            "`avoidedTokens` is the recorded cost of the call that filled each " +
            "cache entry, so the percentage is what caching actually saved, " +
            "not an estimate of it.",
          floor:
            tokens.unpricedCacheHits > 0
              ? `${tokens.unpricedCacheHits} cache hit(s) predate this process and could not be priced, so the real saving is higher than the figure shown.`
              : null,
        },
        cost: {
          measured: cost.spentUsd !== null,
          ...cost,
          note:
            cost.spentUsd === null
              ? "No prices configured. Set SAVINGS_PRICE_IN_<MODEL> and SAVINGS_PRICE_OUT_<MODEL> (and SAVINGS_BASELINE_MODEL for the comparison) and these fill in. Token counts above are unaffected — they are measured either way."
              : "Priced from the per-model rates in the environment against real token counts.",
        },
        time: time
          ? {
              ...time,
              measured: "actualMinutes",
              assumed: "manualMinutes",
              baseline,
              note:
                "`actualMinutes` is wall clock the app really spent. " +
                "`manualMinutes` is an estimate built from lib/savings/assumptions.ts " +
                "and is the arguable half of this number.",
            }
          : {
              measured: null,
              note: "No finished checkout run yet, so there is nothing to measure against.",
            },
      },
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
