/** Negotiation arena and adversarial gate cases. Writes eval/arena.md; exits 1 if any attack is not held. */
import { runArena } from "../src/eval/arena.js";

const rs = await runArena();
for (const r of rs) console.log(`${r.held ? "HELD " : "HOLE "} ${r.id.padEnd(8)} ${r.kind.padEnd(14)} ${r.outcome.padEnd(12)} ${r.description}`);
const holes = rs.filter((r) => !r.held);
console.log(`\n${rs.length - holes.length}/${rs.length} cases held`);
process.exit(holes.length ? 1 : 0);
