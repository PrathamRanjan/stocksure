/**
 * Ask the agent a question as a demo person, from the command line (spec A5.3):
 *   npx tsx --env-file=.env scripts/ask.ts [jordan|ana|sam] "which supplier short-delivers most, and what did it cost?"
 * Prints every step of the run (what the AI work rail shows) and the answer with its citations.
 */
import { getDb } from "../src/db.js";
import { ask } from "../src/ai/agent.js";
import { demoIds, seedDemo } from "../src/services/seed.js";
import { personById } from "../src/store.js";

const [who = "jordan", ...rest] = process.argv.slice(2);
const question = rest.join(" ") || "Which supplier short-delivers most, and what did it cost?";
const db = await getDb();
let ids = await demoIds(db);
if (!ids) ids = (await db.tx((q) => seedDemo(q))).ids;
const pid = (ids.people as Record<string, string>)[who];
if (!pid) throw new Error(`No demo person ${who}`);
const p = (await personById(db, pid))!;
const r = await ask(p, question);
const steps = (await db.query<any>("SELECT step, actor, tool, args, result, duration_ms FROM agent_trace WHERE run_id = $1 ORDER BY step", [r.run_id])).rows;
for (const s of steps) console.log(`${String(s.step).padStart(2)} ${s.actor.padEnd(6)} ${s.tool.padEnd(30)} ${String(s.duration_ms ?? "").padStart(5)} ms  ${JSON.stringify(s.args ?? {}).slice(0, 80)}  →  ${JSON.stringify(s.result ?? {}).slice(0, 140)}`);
console.log(`\n${r.status} · $${r.cost_usd.toFixed(4)} · ${r.paypal_mcp.note}`);
for (const s of r.sentences) console.log(`- ${s.text} ${s.linked ? `[${s.cites.join(", ")}]` : "[not linked to a fact]"}`);
if (r.could_not_answer) console.log(`Could not answer: ${r.could_not_answer}`);
if (r.error) console.log(`Error shown: ${r.error}`);
for (const pr of r.proposals) console.log(`Draft for ${pr.po_number}: ${pr.text}`);
process.exit(0);
