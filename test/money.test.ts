/**
 * Spec B4 item 5: the hold's "best charged by" date; a capture after the honor period refreshes the hold first; and
 * "Check against PayPal" reads every id back (GET only) and reports matched, differs and missing.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { config } from "../src/config.js";
import { openDb, setDb, withWorkspace, type Db } from "../src/db.js";
import { drain } from "../src/jobs.js";
import { handlers } from "../src/worker.js";
import { FakePayPal } from "../src/paypal/fake.js";
import { setPayPal } from "../src/paypal/index.js";
import { getWorkspace, seedStatus } from "../src/demo/workspaces.js";
import { approveResolution } from "../src/services/resolution.js";
import { demoIds } from "../src/services/seed.js";
import { getPo, latestResolution, personById, setting } from "../src/store.js";
import { Client } from "./client.js";
import { serveTracked } from "./journey-coverage.js";

let db: Db;
let fake: FakePayPal;
let srv: Awaited<ReturnType<typeof serveTracked>>;
const saved = { demo: { ...config.demo } };
const TOKEN = "TOKEN-DEMO-WALLET";

beforeEach(async () => {
  db = await openDb({ memory: true });
  setDb(db);
  fake = new FakePayPal();
  fake.tokens.add(TOKEN);
  setPayPal(fake);
  config.demo.vaultToken = TOKEN;
  config.demo.vaultPayer = "sandbox-buyer@example.com";
  config.demo.perAddressPerHour = 50;
  srv = await serveTracked(createApp());
});
afterEach(async () => {
  Object.assign(config.demo, saved.demo);
  await srv.close();
  setPayPal(null);
  await db.close();
});

async function seeded() {
  const c = new Client(srv.base);
  expect((await c.postJson("/demo/start", {})).json.ok).toBe(true);
  const ws = (await c.get("/api/ui/workspace")).json.workspace.id;
  for (let i = 0; i < 400 && !(await seedStatus((await getWorkspace(ws))!)).done; i++) await new Promise((r) => setTimeout(r, 25));
  const ids = await withWorkspace(ws, async () => (await demoIds(db))!);
  return { c, ws, ids };
}

describe("money panel", () => {
  it("shows when a hold is best charged by, and checks every PayPal id against PayPal", { timeout: 90000 }, async () => {
    const { c, ws, ids } = await seeded();
    const poId = await withWorkspace(ws, async () => (await setting(db, "judge_agents_po"))!);
    expect((await c.post("/login", { person_id: ids.people.jordan, next: "/home" })).status).toBe(302);
    const m = (await c.get(`/api/ui/po/${poId}`)).json;
    expect(m.hold.live).toBe(true);
    expect(new Date(m.hold.best_charged_by).getTime() - new Date(m.hold.placed_at).getTime()).toBe(3 * 864e5);
    expect(new Date(m.hold.valid_until).getTime() - new Date(m.hold.placed_at).getTime()).toBe(29 * 864e5);

    let r = (await c.postJson(`/api/ui/po/${poId}/reconcile`, {})).json;
    expect(r.ok).toBe(true);
    expect(r.rows.length).toBeGreaterThan(0);
    expect(r.rows.every((x: any) => x.verdict === "matched")).toBe(true);
    expect(r.summary).toMatch(/match PayPal's own records/);

    // StockSure's record disagrees with PayPal: reported, never smoothed over.
    await withWorkspace(ws, () => db.query("UPDATE payment_ops SET amount_cents = amount_cents + 100 WHERE po_id = $1 AND kind = 'authorize'", [poId]));
    await withWorkspace(ws, () => db.query("INSERT INTO payment_ops (id, po_id, root_id, kind, status, amount_cents, request_id, paypal_id) SELECT 'op_ghost', id, root_id, 'capture', 'succeeded', 500, 'ghost-req', 'CAP-NOT-AT-PAYPAL' FROM purchase_orders WHERE id = $1", [poId]));
    r = (await c.postJson(`/api/ui/po/${poId}/reconcile`, {})).json;
    expect(r.ok).toBe(false);
    expect(r.rows.find((x: any) => x.kind === "authorize").verdict).toBe("differs");
    expect(r.rows.find((x: any) => x.paypal_id === "CAP-NOT-AT-PAYPAL").verdict).toBe("missing");

    // The receiver can't run it; the supplier can.
    expect((await c.post("/login", { person_id: ids.people.sam, next: "/home" })).status).toBe(302);
    expect((await c.postJson(`/api/ui/po/${poId}/reconcile`, {})).status).toBe(403);
    expect((await c.post("/login", { person_id: ids.people.ana, next: "/home" })).status).toBe(302);
    expect((await c.postJson(`/api/ui/po/${poId}/reconcile`, {})).status).toBe(200);
  });

  it("a capture after the 3-day honor period refreshes the hold first, then captures on the new authorization", { timeout: 90000 }, async () => {
    const { ws, ids } = await seeded();
    const poId = await withWorkspace(ws, async () => {
      const poId = (await setting(db, "judge_agents_po"))!;
      await db.query("UPDATE payment_ops SET created_at = now() - interval '4 days' WHERE po_id = $1 AND kind = 'authorize'", [poId]);
      const res = (await latestResolution(db, poId))!;
      await approveResolution((await personById(db, ids.people.ana))!, poId, res.version, res.hash);
      await approveResolution((await personById(db, ids.people.jordan))!, poId, res.version, res.hash);
      return poId;
    });
    await drain(db, handlers as any, 20, undefined, ws);
    await withWorkspace(ws, async () => {
      const po = await getPo(db, poId);
      const ops = (await db.query<any>("SELECT kind, status, paypal_id, parent_paypal_id FROM payment_ops WHERE po_id = $1 ORDER BY created_at", [poId])).rows;
      const re = ops.find((o) => o.kind === "reauthorize");
      expect(re?.status).toBe("succeeded");
      expect(po.auth_id).toBe(re.paypal_id);
      const cap = ops.find((o) => o.kind === "capture" && o.status === "succeeded");
      expect(cap?.parent_paypal_id).toBe(re.paypal_id);
      expect((po as any).reauthorized_at).toBeTruthy();
    });
  });
});
