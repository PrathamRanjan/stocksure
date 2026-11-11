/**
 * `npx tsx --env-file=.env scripts/score-scam.ts [question …]`: asks Decisions every scam question for every labelled
 * case and prints each case's probabilities, so a person can see where a question separates scam from genuine
 * before a label or threshold is chosen. Writes nothing.
 */
import { scoreAll } from "../src/eval/calibrate.js";

const qs = process.argv.slice(2);
const scored = await scoreAll();
for (const s of scored) {
  const cols = (qs.length ? qs : Object.keys(s.p)).map((q) => `${q}=${s.p[q] === null ? "—" : s.p[q]!.toFixed(2)}`);
  console.log(`${s.c.id.padEnd(28)} ${s.c.split.padEnd(8)} scam=${s.c.scam ? "Y" : "n"} ${cols.join(" ")}`);
}
console.log(`model ${scored[0]?.model}, $${scored.reduce((a, s) => a + s.cost, 0).toFixed(5)}`);
process.exit(0);
