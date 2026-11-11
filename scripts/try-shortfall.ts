/**
 * `npx tsx --env-file=.env scripts/try-shortfall.ts`: seeds a demo workspace in memory (fake PayPal), then lets the
 * real models settle the barista-oat shortfall and prints every move with the referee's verdict. Writes nothing.
 */
import { config } from "../src/config.js";
import { openDb, setDb, withWorkspace } from "../src/db.js";
import { FakePayPal } from "../src/paypal/fake.js";
import { setPayPal } from "../src/paypal/index.js";
import { createWorkspace } from "../src/demo/workspaces.js";
import { demoIds } from "../src/services/seed.js";
import { runShortfallTalk, startShortfallTalk } from "../src/agents/shortfall.js";
import { latestResolution, personById, setting } from "../src/store.js";

const db = await openDb({ memory: true });
setDb(db);
const fake = new FakePayPal();
fake.tokens.add("TOKEN-TRY");
setPayPal(fake);
config.demo.vaultToken = "TOKEN-TRY";
config.demo.vaultPayer = "sandbox-buyer@example.com";
const w = await createWorkspace("visitor", "127.0.0.1", { background: false });
await withWorkspace(w.id, async () => {
  const ids = (await demoIds(db))!;
  const poId = (await setting(db, "judge_agents_po"))!;
  const jordan = (await personById(db, ids.people.jordan))!;
  const t0 = Date.now();
  const id = await startShortfallTalk(jordan, poId);
  await runShortfallTalk(id);
  const n = (await db.query<any>("SELECT status, outcome FROM negotiations WHERE id = $1", [id])).rows[0];
  for (const m of (await db.query<any>("SELECT round, side, proposal, guard, wording FROM negotiation_rounds WHERE negotiation_id = $1 ORDER BY id", [id])).rows) {
    console.log(`R${m.round} ${m.side.padEnd(8)} ${m.proposal.action} ${JSON.stringify(m.proposal.lines.map((l: any) => l.remedy))} ${m.proposal.price_pct}% ${m.guard.ok ? "ALLOWED" : "REFUSED: " + m.guard.reasons.join("; ")} | ${m.wording}`);
  }
  console.log(n.status, JSON.stringify(n.outcome), `${Math.round((Date.now() - t0) / 1000)} s`);
  const r = await latestResolution(db, poId);
  console.log(`resolution v${r?.version} ${r?.status} replacement ${r?.body.totals.replacement_cents} negotiated ${JSON.stringify(r?.body.negotiated)}`);
});
process.exit(0);
