import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { config } from "../src/config.js";
import { openDb, setDb, type Db } from "../src/db.js";
import { drain } from "../src/jobs.js";
import { FakePayPal } from "../src/paypal/fake.js";
import { setPayPal } from "../src/paypal/index.js";
import { seedDemo, type DemoIds } from "../src/services/seed.js";
import { getPo, latestReceipt, latestResolution, linesOf } from "../src/store.js";
import { lineFingerprint } from "../src/services/receiving.js";
import { handlers } from "../src/worker.js";
import { Client } from "./client.js";
import { serveTracked } from "./journey-coverage.js";
import { walkFoundation } from "./journey-foundation.js";
import { ASK_ROUTES, PUBLIC_ROUTES, WORKSPACE_ROUTES } from "./workspace-routes.js";

// Acceptance journey: the demo scenario end to end over HTTP for buyer owner, receiver and supplier,
// including two-part delivery, a disputed and revised receipt, a re-planned replacement, an ETA warning,
// a late defect refunded across both captures, a pending hold, a refused capture and its retry.
// It fails if any route is never used or any request returns a 5xx.
let db: Db;
let fake: FakePayPal;
let srv: Awaited<ReturnType<typeof serveTracked>>;
let base: string;
let ids: DemoIds;

const run = async () => {
  await db.query("UPDATE jobs SET run_at = now() WHERE status = 'pending'");
  return drain(db, handlers);
};
const one = async (sql: string, p: unknown[] = []) => (await db.query<any>(sql, p)).rows[0];
const all = async (sql: string, p: unknown[] = []) => (await db.query<any>(sql, p)).rows;
const ok = (r: { status: number; location: string | null }) => {
  expect(r.status, r.location ?? "").toBe(302);
  expect(decodeURIComponent(r.location ?? "")).not.toMatch(/[?&]err=/);
  return r;
};
const err = (r: { location: string | null }) => decodeURIComponent(new URL(r.location!, base).searchParams.get("err") ?? "");

async function login(key: string) {
  const c = new Client(base);
  expect((await c.post("/login", { person_id: ids.people[key], next: "/home" })).status).toBe(302);
  return c;
}

beforeEach(async () => {
  db = await openDb({ memory: true });
  setDb(db);
  fake = new FakePayPal();
  setPayPal(fake);
  config.paypal.webhookId = "";
  ids = (await db.tx((q) => seedDemo(q))).ids;
  srv = await serveTracked(createApp());
  base = srv.base;
});
afterEach(async () => {
  await srv.close();
  setPayPal(null);
  await db.close();
});

describe("StockSure acceptance journey", () => {
  it("demo scenario, every role and every recovery path, with no route unused and no server error", { timeout: 120000 }, async () => {
    const anon = new Client(base);
    expect((await anon.get("/healthz")).status).toBe(200);
    expect((await anon.get("/")).status).toBeLessThan(400);
    expect((await anon.get("/login")).status).toBe(200);
    // Front-end pages are served by the app shell; their data comes from /api/ui/* (JSON, read-only).
    for (const u of ["/demo", "/about", "/favicon.svg"]) expect((await anon.get(u)).status, u).toBe(200);
    expect((await anon.get("/no-such-page", { accept: "text/html" })).status).toBe(404);
    expect((await anon.get("/api/ui/no-such-view")).status).toBe(404);
    expect((await anon.get("/api/ui/home")).status).toBe(401);
    const demoView = (await anon.get("/api/ui/demo")).json;
    expect(demoView.po.id).toBe(ids.demoPo);
    expect(demoView.quote_total_cents).toBeGreaterThan(0);
    expect((await anon.get("/api/ui/session")).json.who).toBeNull();
    expect((await anon.get("/api/ui/people")).json.people.map((x: any) => x.first).slice(0, 3)).toEqual(["Jordan", "Sam", "Ana"]);
    expect((await anon.get("/api/ui/preview")).json.po.number).toBeTruthy();
    const jordan = await login("jordan");
    const sam = await login("sam");
    const ana = await login("ana");
    const marco = await login("marco");
    const id = ids.demoPo;
    const po = () => getPo(db, id);
    const line = async (poId = id) => (await linesOf(db, poId))[0].id;
    const seen = async (poId = id) => {
      const rec = (await latestReceipt(db, poId))!;
      return lineFingerprint(rec.receipt.version, rec.lines[0]);
    };
    let reread = false;
    const receive = async (poId: string, delivered: string, damaged: string, sample: "damaged" | "clean" | null) => {
      if (sample) ok(await sam.post(`/po/${poId}/receive/upload`, { sample }));
      if (sample && !reread) {
        // "Read it again" re-reads the stored document and replaces its reading (no second extraction row).
        reread = true;
        const doc = (await db.query<{ id: string }>("SELECT id FROM documents WHERE po_id = $1 AND kind = 'delivery_note' ORDER BY created_at DESC LIMIT 1", [poId])).rows[0];
        const before = (await db.query("SELECT 1 FROM extractions WHERE document_id = $1", [doc.id])).rows.length;
        ok(await sam.post(`/po/${poId}/receive/reread/${doc.id}`));
        expect((await db.query("SELECT 1 FROM extractions WHERE document_id = $1", [doc.id])).rows.length).toBe(before);
      }
      const l = await line(poId);
      return sam.post(`/po/${poId}/receive/confirm`, { [`delivered_${l}`]: delivered, [`damaged_${l}`]: damaged, [`wrong_${l}`]: "0", [`note_${l}`]: "", checked: "1" });
    };

    // Buyer owner connects PayPal through the vault approval.
    expect((await jordan.get("/home")).status).toBe(200);
    expect((await jordan.get("/api/ui/home")).json).toMatchObject({ can_connect: true, org: { paypal_connected: false } });
    expect((await jordan.get("/api/ui/session")).json.who).toMatchObject({ first: "Jordan", owner: true });
    const connect = await jordan.post("/connect-paypal");
    const setup = new URL(connect.location!).searchParams.get("token")!;
    expect(err(await jordan.get(`/connect-paypal/return?approval_token_id=wrong`))).toMatch(/does not match/);
    fake.approveSetup(setup);
    ok(await jordan.get(`/connect-paypal/return?approval_token_id=${setup}`));
    expect((await one("SELECT vault_token_id FROM orgs WHERE id = $1", [ids.laneway])).vault_token_id).toBeTruthy();

    // Catalog, stock and performance pages for each side; the supplier edits a catalog row.
    for (const c of [jordan, ana]) for (const u of ["/catalog", "/stock", "/performance", "/home", "/approvals", "/api/ui/catalog", "/api/ui/performance", "/api/ui/home", "/api/ui/approvals"]) expect((await c.get(u)).status, u).toBeLessThan(400);
    expect((await jordan.get("/api/ui/stock")).status).toBe(200);
    expect((await ana.get("/api/ui/stock")).status).toBe(403);
    expect((await ana.get("/api/ui/catalog")).json.can_edit).toBe(true);
    expect((await jordan.get("/api/ui/catalog")).json.can_edit).toBe(false);
    const sku = await one("SELECT id, stock_packs, price_cents FROM products WHERE sku = 'OAT-6'");
    expect(err(await jordan.post(`/catalog/${sku.id}`, { stock: "5", price: "1.00" }))).toMatch(/Only the supplier/);
    ok(await ana.post(`/catalog/${sku.id}`, { stock: String(sku.stock_packs + 1), price: (sku.price_cents / 100).toFixed(2) }));

    // A second order from the form, to use for the pending-hold and refused-capture paths.
    expect((await jordan.get("/po/new")).status).toBe(200);
    expect((await jordan.get("/api/ui/po-new")).json.suppliers[0].catalog.length).toBeGreaterThan(0);
    expect((await sam.get("/api/ui/po-new")).status).toBe(403);
    const deliverBy = new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 16);
    const r2 = ok(await jordan.post("/po/new", { supplier_id: ids.supplier, product_0: ids.products["OAT-12"], qty_0: "2", limit: "40.00", deliver_by: deliverBy, note: "Weekend top-up" }));
    const po2 = r2.location!.split("/po/")[1].split("?")[0];

    // Main order: send, quote, accept → a $200 hold.
    ok(await jordan.post(`/po/${id}/submit`));
    ok(await ana.post(`/po/${id}/quote`, { [`price_${await line()}`]: "10.00" }));
    ok(await jordan.post(`/po/${id}/accept`, { version: "1" }));
    expect((await po()).status).toBe("funded");
    ok(await jordan.post(`/po/${id}/message`, { line_id: await line(), body: "Please pack the cases upright" }));
    ok(await ana.post(`/po/${id}/message`, { body: "Will do" }));

    // Early warning: a carrier ETA after the deliver-by opens a risk; the owner chooses to wait.
    const due = new Date((await po()).deliver_by).getTime();
    const t = (ms: number) => new Date(ms).toISOString().slice(0, 16);
    ok(await ana.post(`/po/${id}/eta`, { eta: t(due + 6 * 36e5), observed_at: t(Date.now() - 60_000), source: "carrier", ref: "trk-1" }));
    expect((await one("SELECT status FROM po_risks WHERE po_id = $1", [id])).status).toBe("open");
    ok(await jordan.post(`/po/${id}/risk`, { choice: "wait", note: "Brunch can use the old stock" }));

    // Two-part delivery: 8 cases now (charged on agreement, not final), the rest later.
    const l = await line();
    ok(await ana.post(`/po/${id}/dispatch-part`, { [`part_${l}`]: "8" }));
    expect((await sam.get(`/po/${id}/receive`)).status).toBe(200);
    expect((await sam.get(`/api/ui/po/${id}/receive`)).json).toMatchObject({ mode: "part", open: true });
    expect((await ana.get(`/api/ui/po/${id}/receive`)).status).toBe(403);
    ok(await receive(id, "8 cs", "0", null));
    await run();
    expect((await po()).status).toBe("part_delivered");
    expect([...fake.captures.values()].map((c) => [c.cents, c.final_capture])).toEqual([[8000, false]]);

    // The rest ships with an invoice that hides instructions to pay someone else; 2 cases arrive crushed.
    ok(await ana.post(`/po/${id}/dispatch`, { sample: "inject" }));
    ok(await receive(id, "12 cs", "2 cs", "damaged"));
    const inv = await one("SELECT id, flags FROM documents WHERE po_id = $1 AND kind = 'invoice'", [id]);
    expect(inv.flags.length).toBeGreaterThan(0);
    expect((await jordan.get(`/doc/${inv.id}`)).headers.get("content-security-policy")).toMatch(/sandbox/);
    expect((await marco.get(`/doc/${inv.id}`)).status).toBe(404);
    // Supplier disputes, receiver re-counts, supplier agrees the revision.
    ok(await ana.post(`/po/${id}/lines/${l}/review`, { action: "dispute", note: "Photo shows two cases, not three", seen: await seen() }));
    ok(await receive(id, "12 cs", "2 cs", null));
    ok(await ana.post(`/po/${id}/lines/${l}/review`, { action: "agree", seen: await seen() }));
    expect((await po()).status).toBe("resolving");

    // The buyer asks for a different replacement option; both approve the new version.
    const v1 = (await latestResolution(db, id))!;
    ok(await jordan.post(`/po/${id}/resolution/revise`, { plan_index: "0" }));
    const v2 = (await latestResolution(db, id))!;
    expect(v2.version).toBe(v1.version + 1);
    expect(err(await jordan.post(`/po/${id}/resolution/approve`, { version: String(v1.version), hash: v1.hash }))).toBeTruthy();
    ok(await jordan.post(`/po/${id}/resolution/approve`, { version: String(v2.version), hash: v2.hash }));
    ok(await ana.post(`/po/${id}/resolution/approve`, { version: String(v2.version), hash: v2.hash }));
    await run();
    await run();
    const auth = [...fake.auths.values()][0];
    expect([...fake.captures.values()].filter((c) => c.authId === auth.id).reduce((a, c) => a + c.cents, 0)).toBe(18000);
    const repl = (await one("SELECT id FROM purchase_orders WHERE parent_id = $1", [id])).id;
    expect((await getPo(db, repl)).status).toBe("funded");
    ok(await ana.post(`/po/${repl}/dispatch`, {}));
    ok(await receive(repl, "2 cs", "0", null));
    await run();
    expect((await po()).status).toBe("closed");

    // A late defect is refunded across both captures behind the original order.
    ok(await jordan.post(`/po/${id}/defects`, { line_id: l, units: "120", note: "Ten cases spoiled before their date" }));
    const claim = await one("SELECT * FROM defect_claims WHERE po_id = $1", [id]);
    ok(await ana.post(`/po/${id}/defects/${claim.id}`, { agree: "1", note: "Sorry" }));
    await run();
    expect((await one("SELECT status FROM defect_claims WHERE id = $1", [claim.id])).status).toBe("refunded");
    const refunded = [...fake.refunds.values()].reduce((a, r) => a + Math.round(Number(r.amount?.value) * 100), 0);
    expect(refunded).toBe(claim.amount_cents);

    // Records, and a repeat order from the closed one.
    expect((await jordan.get(`/po/${id}/record.csv`)).text).toContain("OAT-12");
    expect((await jordan.get(`/po/${id}/record.json`)).json.purchase_orders.length).toBe(2);
    expect((await jordan.get(`/po/${id}`)).status).toBe(200);
    const view = (await jordan.get(`/api/ui/po/${id}`)).json;
    expect(view.docs.find((d: any) => d.kind === "invoice").flags.length).toBeGreaterThan(0);
    expect(view.po.status).toBe("closed");
    expect(view.ops.some((o: any) => o.kind === "capture" && o.paypal_id)).toBe(true);
    const rep = ok(await jordan.post(`/po/${id}/reorder`));
    expect((await getPo(db, rep.location!.split("/po/")[1].split("?")[0])).status).toBe("draft");

    // Second order: PayPal holds it as PENDING, so it waits; the owner retries once PayPal confirms.
    ok(await jordan.post(`/po/${po2}/submit`));
    ok(await ana.post(`/po/${po2}/quote`, { [`price_${await line(po2)}`]: "10.00" }));
    const get = fake.getAuthorization.bind(fake);
    let status = "PENDING";
    fake.getAuthorization = async (x: string) => ({ ...(await get(x)), status }) as any;
    await jordan.post(`/po/${po2}/accept`, { version: "1" });
    expect((await getPo(db, po2)).status).toBe("funding");
    status = "CREATED";
    ok(await jordan.post(`/po/${po2}/retry-hold`));
    fake.getAuthorization = get;
    expect((await getPo(db, po2)).status).toBe("funded");

    // The first order used the supplier's oat milk: shipping more is refused until the supplier restocks.
    expect(err(await ana.post(`/po/${po2}/dispatch`, { sample: "clean" }))).toMatch(/Not enough OAT-12/);
    const oat = await one("SELECT id, stock_packs, price_cents FROM products WHERE sku = 'OAT-12'");
    ok(await ana.post(`/catalog/${oat.id}`, { stock: String(oat.stock_packs + 10), price: (oat.price_cents / 100).toFixed(2) }));
    // A refused capture (armed from the demo page) becomes an exception; retry settles it once.
    ok(await ana.post(`/po/${po2}/dispatch`, { sample: "clean" }));
    ok(await receive(po2, "2 cs", "0", "clean"));
    ok(await anon.post("/demo/fault", { method: "captureAuthorization", kind: "fail_422" }));
    await run();
    expect((await getPo(db, po2)).status).toBe("exception");
    expect((await sam.post(`/po/${po2}/retry-settle`)).status).toBeGreaterThanOrEqual(302);
    ok(await jordan.post(`/po/${po2}/retry-settle`));
    await run();
    expect((await getPo(db, po2)).status).toBe("closed");

    // Roadmap foundation: agents, guard, traces, channels, PWA, ledger, deliveries, dock, driver, disputes.
    await walkFoundation({ base, db, ids, fake, anon, jordan, sam, ana, run });

    // Webhooks: an unverified event is stored but not acted on; a verified one is accepted once.
    const hook = { id: "WH-J1", event_type: "PAYMENT.CAPTURE.COMPLETED", resource: { id: "X" } };
    expect((await anon.postJson("/webhooks/paypal", hook)).status).toBe(400);
    config.paypal.webhookId = "WH-CONFIGURED";
    expect((await anon.postJson("/webhooks/paypal", { ...hook, id: "WH-J2" }, { "paypal-transmission-sig": "valid-fake-signature" })).json).toEqual({ ok: true });
    await run();

    // Reset (keeping the PayPal connection) and sign out.
    ok(await jordan.post("/demo/reset", { keep: "1" }));
    expect((await one("SELECT vault_token_id FROM orgs WHERE name LIKE 'Laneway%'")).vault_token_id).toBeTruthy();
    expect((await marco.post("/logout")).status).toBe(302);

    expect(srv.failures).toEqual([]);
    // Workspace and admin routes are walked end to end in test/workspaces.test.ts.
    expect(srv.missed(Object.fromEntries([...WORKSPACE_ROUTES, ...ASK_ROUTES, ...PUBLIC_ROUTES].map((r) => [r, "covered by test/workspaces.test.ts"])))).toEqual([]);
  });
});
