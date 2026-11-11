/**
 * Spec A5.2: `npx tsx --env-file=.env scripts/calibrate.ts <question|all>`. Runs the labelled scam set through
 * OpenAI Decisions, picks thresholds on the tuning half, scores the held-out half, writes
 * eval/calibration/<question>.{md,json} and the decision_thresholds row. The committed JSON is applied by the
 * deployed server at start (src/eval/apply.ts), so production uses the thresholds this run picked.
 */
import { calibrate, LABELS } from "../src/eval/calibrate.js";

const arg = process.argv[2] ?? "all";
const qs = arg === "all" ? Object.keys(LABELS) : [arg];
const reports = await calibrate(qs);
for (const r of reports) {
  const p = (x: number | null) => (x === null ? "n/a" : `${Math.round(x * 100)}%`);
  console.log(`${r.question}: clear_below ${r.threshold.clear_below}, hold_above ${r.threshold.hold_above > 1 ? "never" : r.threshold.hold_above}; held-out precision ${r.threshold.hold_above > 1 ? "n/a" : p(r.held_out.precision)}, recall ${r.threshold.hold_above > 1 ? "n/a" : p(r.held_out.recall)}, positives above clear ${p(r.held_out.clear_recall)} (${r.model}, $${r.cost_usd.toFixed(5)})`);
}
process.exit(0);
