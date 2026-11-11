/**
 * Spec B4 item 3: two agents settle a shortfall; a referee in code refuses moves outside either limit or on a line
 * that isn't short; agreed terms become a resolution version both people approve before PayPal settles. The model
 * is scripted; the seeded order, the resolution, the approvals and the fake PayPal are the real paths.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { config } from "../src/config.js";
import { openDb, setDb, withWorkspace, type Db } from "../src/db.js";
import { drain } from "../src/jobs.js";
import { handlers } from "../src/worker.js";
import { FakePayPal } from "../src/paypal/fake.js";
import { setPayPal } from "../src/paypal/index.js";
import { setProviderFetch } from "../src/ai/provider.js";
import { getWorkspace, seedStatus } from "../src/demo/workspaces.js";
import { referee, runShortfallTalk, startShortfallTalk, talkFacts, type Move } from "../src/agents/shortfall.js";
import { approveResolution } from "../src/services/resolution.js";
import { demoIds } from "../src/services/seed.js";
import { latestResolution, personById, setting } from "../src/store.js";
import { Client } from "./client.js";
import { serveTracked } from "./journey-coverage.js";

let db: Db;
let srv: Awaited<ReturnType<typeof serveTracked>>;
const saved = { demo: { ...config.demo }, key: config.ai.openaiKey, provider: config.ai.provider };
const TOKEN = "TOKEN-DEMO-WALLET";

beforeEach(async () => {
  db = await openDb({ memory: true });
  setDb(db);
  const fake = new FakePayPal();
  fake.tokens.add(TOKEN);
  setPayPal(fake);
  config.demo.vaultToken = TOKEN;
  config.demo.vaultPayer = "sandbox-buyer@example.com";
  config.demo.perAddressPerHour = 50;
  srv = await serveTracked(createApp());
});
afterEach(async () => {
  Object.assign(config.demo, saved.demo);
  config.ai.openaiKey = saved.key;
  config.ai.provider = saved.provider;
  setProviderFetch(null);
  await srv.close();
  setPayPal(null);
  await db.close();
});

let c: Client;
async function seeded(): Promise<string> {
  c = new Client(srv.base);
  expect((await c.postJson("/demo/start", {})).json.ok).toBe(true);
  const ws = (await c.get("/api/ui/workspace")).json.workspace.id;
  for (let i = 0; i < 400; i++) {
    const s = await seedStatus((await getWorkspace(ws))!);
    if (s.done) {
      expect(s.stopped).toBeNull();
      return ws;
    }
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("seeding never finished");
}

/** Scripted agents: each Responses call gets the next move. Decisions (scam checks) answer "nothing". */
function script(moves: (Partial<Move> & { action: Move["action"] })[]) {
  let i = 0;
  config.ai.openaiKey = "sk-test";
  config.ai.provider = "openai";
  setProviderFetch((async (url: any, init: any) => {
    const body = JSON.parse(String(init.body));
    if (String(url).endsWith("/v1/decisions")) return new Response(JSON.stringify({ model: "gpt-6-luna", answers: body.questions.map((q: any) => ({ type: "predicate", name: q.name, probability: 0 })), usage: { input_tokens: 1 } }), { status: 200 });
    const m = moves[Math.min(i++, moves.length - 1)];
    return new Response(JSON.stringify({ model: "gpt-6.1-sol", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({ lines: [], price_pct: 100, message: "", ...m }) }] }], usage: { input_tokens: 100, output_tokens: 20 } }), { status: 200 });
  }) as typeof fetch);
}

describe("agents settle a shortfall", () => {
  it("the referee refuses moves outside either limit; agreed terms need both people; PayPal holds the replacement at the agreed price", { timeout: 90000 }, async () => {
    const ws = await seeded();
    await withWorkspace(ws, async () => {
      const ids = (await demoIds(db))!;
      const poId = (await setting(db, "judge_agents_po"))!;
      expect(poId).toBeTruthy();
      const t = await talkFacts(db, poId);
      expect(t.lines).toHaveLength(1);
      const line = t.lines[0];
      expect(line).toMatchObject({ sku: "OAT-B12", short_units: 24, replaceable: true, replacement_cents: 2400 });

      // The referee on its own: a new line, a price under the floor, a price over the ceiling, a missing line.
      expect(referee(t, { action: "offer", lines: [{ line_id: line.line_id, remedy: "replace" }], price_pct: 80, message: "" }, null).join(" ")).toMatch(/below the supplier's floor/);
      expect(referee(t, { action: "offer", lines: [{ line_id: line.line_id, remedy: "replace" }], price_pct: 105, message: "" }, null).join(" ")).toMatch(/above the café's ceiling/);
      expect(referee(t, { action: "offer", lines: [{ line_id: line.line_id, remedy: "replace" }, { line_id: "ln_invented", remedy: "credit" }], price_pct: 95, message: "" }, null).join(" ")).toMatch(/no new lines/);
      expect(referee(t, { action: "offer", lines: [], price_pct: 95, message: "" }, null).join(" ")).toMatch(/must be settled/);
      expect(referee(t, { action: "accept", lines: [], price_pct: 0, message: "" }, null)).toEqual(["there is no offer from the other side to accept"]);
      expect(referee(t, { action: "offer", lines: [{ line_id: line.line_id, remedy: "credit" }], price_pct: 50, message: "" }, null)).toEqual([]);

      const jordan = (await personById(db, ids.people.jordan))!;
      const ana = (await personById(db, ids.people.ana))!;
      script([
        { action: "offer", lines: [{ line_id: line.line_id, remedy: "replace" }], price_pct: 80, message: "Could you do 80% for the trouble?" },
        { action: "offer", lines: [{ line_id: line.line_id, remedy: "replace" }], price_pct: 92, message: "92% then." },
        { action: "accept", message: "Deal." },
      ]);
      // Over HTTP as the owner: the panel offers the agents; Sam (receiving) may not send them.
      expect((await c.post("/login", { person_id: ids.people.sam, next: "/home" })).status).toBe(302);
      expect((await c.postJson(`/api/ui/po/${poId}/agents`, {})).status).toBe(403);
      expect((await c.post("/login", { person_id: ids.people.jordan, next: "/home" })).status).toBe(302);
      const panel = (await c.get(`/api/ui/po/${poId}/agents`)).json;
      expect(panel).toMatchObject({ can_start: true, latest: null, rules: { floor: { floor_pct: 90 } } });
      const id = await startShortfallTalk(jordan, poId);
      await runShortfallTalk(id);
      // The route returns the open one (if any) or refuses once the order has moved on.
      expect((await c.postJson(`/api/ui/po/${poId}/agents`, {})).status).toBe(409);
      expect((await c.get(`/negotiations/${id}`)).status).toBe(200);
      const view = (await c.get(`/api/ui/po/${poId}/agents`)).json.latest;
      expect(view).toMatchObject({ id, kind: "shortfall", status: "agreed" });
      expect(view.moves[0]).toMatchObject({ side: "buyer", allowed: false, price_pct: 80 });
      const n = (await db.query<any>("SELECT status, outcome FROM negotiations WHERE id = $1", [id])).rows[0];
      expect(n.status).toBe("agreed");
      const moves = (await db.query<any>("SELECT side, guard FROM negotiation_rounds WHERE negotiation_id = $1 ORDER BY id", [id])).rows;
      expect(moves.map((m) => [m.side, m.guard.ok])).toEqual([["buyer", false], ["buyer", true], ["supplier", true]]);
      expect(moves[0].guard.reasons.join(" ")).toMatch(/below the supplier's floor/);

      // A new version of the fix, at the agreed price, waiting for both people.
      const res = (await latestResolution(db, poId))!;
      expect(res.status).toBe("proposed");
      expect(res.body.negotiated).toEqual({ negotiation_id: id, replacement_price_pct: 92 });
      expect(res.body.totals.replacement_cents).toBe(2 * Math.round(1200 * 0.92));
      expect(res.body.plan.chosen.picks[0]).toMatchObject({ list_price_cents: 1200, pack_price_cents: 1104 });

      // Ana approves: the supplier step ticks; nothing is settled yet. Then Jordan: both sides agreed.
      await approveResolution(ana, poId, res.version, res.hash);
      expect((await latestResolution(db, poId))!.status).toBe("proposed");
      await approveResolution(jordan, poId, res.version, res.hash);
    });
    await drain(db, handlers as any, 20, undefined, ws);
    await withWorkspace(ws, async () => {
      const poId = (await setting(db, "judge_agents_po"))!;
      const repl = (await db.query<any>("SELECT p.id, p.status, l.unit_price_cents, l.qty_packs FROM purchase_orders p JOIN po_lines l ON l.po_id = p.id WHERE p.parent_id = $1", [poId])).rows[0];
      expect(repl).toMatchObject({ unit_price_cents: 1104, qty_packs: 2 });
      expect(["funded", "funding"]).toContain(repl.status);
    });
    const checklist = (await withWorkspace(null, async () => (await db.query<any>("SELECT checklist FROM workspaces WHERE id = $1", [ws])).rows[0].checklist)) ?? {};
    expect(Object.keys(checklist)).toEqual(expect.arrayContaining(["agents_agreed", "agents_supplier_ok", "agents_settled"]));
    expect(checklist.resolution_approved).toBeUndefined();
  });
});
