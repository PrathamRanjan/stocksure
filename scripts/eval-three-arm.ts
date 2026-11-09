/** Three-arm receiving eval: rules, model+code, oracle over synthetic delivery notes. Writes eval/three-arm.md. */
import { getDb } from "../src/db.js";
import { demoIds, seedDemo } from "../src/services/seed.js";
import { runSuite } from "../src/eval/runner.js";

const db = await getDb();
if (!(await demoIds(db))) await db.tx((q) => seedDemo(q));
const rs = await runSuite("receiving");
for (const s of rs) console.log(`${s.arm.padEnd(7)} cases=${s.cases} correct=${s.correct} traps=${s.traps} traps_inflate=${s.traps_paid} pays=$${s.dollars_paid.toFixed(2)} at_risk=$${s.dollars_at_risk.toFixed(2)} cost=$${s.cost_usd.toFixed(4)} p50=${s.p50_ms}ms`);
console.log("\nReport: eval/three-arm.md");
process.exit(0);
