/**
 * Spec A5.6: `npm run eval:proof [scam|receiving|regression ...]`. Runs the proof suites on a fresh local demo
 * (PGlite unless DATABASE_URL is set), stores each run in proof_runs and writes eval/proof/latest.json, which is
 * committed and shown on /proof until the deployed server's nightly run replaces it.
 */
import { getDb } from "../src/db.js";
import { applyCommittedCalibration } from "../src/eval/apply.js";
import { runProof, writeProofFile, type Suite } from "../src/eval/proof.js";
import { demoIds, seedDemo } from "../src/services/seed.js";

const db = await getDb();
if (!(await demoIds(db))) await db.tx((q) => seedDemo(q));
await applyCommittedCalibration();
const pick = process.argv.slice(2) as Suite[];
const runs = await runProof({ suites: pick.length ? pick : undefined, trigger: "script" });
for (const r of runs) {
  console.log(`${r.suite.padEnd(11)} ${r.passed}/${r.cases} passed  $${r.cost_usd.toFixed(4)}  ${r.models}`);
  for (const c of r.results.filter((x) => x.pass === false)) console.log(`   FAIL ${c.id}: expected ${c.expected}; got ${c.actual}`);
  for (const c of r.results.filter((x) => x.pass === null)) console.log(`   ${c.state} ${c.id}: ${c.actual}`);
}
if (!pick.length) writeProofFile(runs);
process.exit(0);
