import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { config } from "../src/config.js";
import { openDb, setDb, type Db } from "../src/db.js";
import { drain } from "../src/jobs.js";
import { setProviderFetch } from "../src/ai/provider.js";
import { FakePayPal } from "../src/paypal/fake.js";
import { PayPalError, setPayPal } from "../src/paypal/index.js";
import { seedDemo, type DemoIds } from "../src/services/seed.js";
import { fundingOf, getPo, postMessage, latestReceipt, latestResolution, linesOf } from "../src/store.js";
import { lineFingerprint } from "../src/services/receiving.js";
import { instanceTag } from "../src/services/orders.js";
import { handlers } from "../src/worker.js";
import { Client } from "./client.js";
import { DEMO_SUPPLIER_CHANGE } from "../src/web/safety.js";

let db: Db;
const savedAi = { key: config.ai.openaiKey, provider: config.ai.provider };
let fake: FakePayPal;
let server: Server;
let base: string;
let ids: DemoIds;
let jordan: Client, sam: Client, ana: Client, marco: Client;

const run = async () => {
  await db.query("UPDATE jobs SET run_at = now() WHERE status = 'pending'");
  return drain(db, handlers);
};
const po = () => getPo(db, ids.demoPo);
const seenOf = async (poId = ids.demoPo) => {
  const rec = (await latestReceipt(db, poId))!;
  return lineFingerprint(rec.receipt.version, rec.lines[0]);
};
const lineId = async (poId = ids.demoPo) => (await linesOf(db, poId))[0].id;
const ok = (r: { status: number; location: string | null }) => {
  expect(r.status, r.location ?? "").toBe(302);
  expect(r.location ?? "", decodeURIComponent(r.location ?? "")).not.toMatch(/[?&]err=/);
  return r;
};
const err = (r: { status: number; location: string | null }) => decodeURIComponent(new URL(r.location!, base).searchParams.get("err") ?? "");

async function login(personKey: string) {
  const c = new Client(base);
  const r = await c.post("/login", { person_id: ids.people[personKey], next: "/home" });
  expect(r.status).toBe(302);
  return c;
}

async function connectPayPal(orgId: string) {
  const st = await fake.createSetupToken({ returnUrl: "x" }, `st-${orgId}`);
  fake.approveSetup(st.id);
  const t = await fake.createPaymentToken(st.id, `pt-${orgId}`);
  await db.query("UPDATE orgs SET vault_token_id = $2, vault_payer = 'buyer@example.com' WHERE id = $1", [orgId, t.id]);
}

/** Draft -> submitted -> quoted at $10 -> accepted: $200 hold. */
async function orderAndHold(price = "10.00") {
  ok(await jordan.post(`/po/${ids.demoPo}/submit`));
  ok(await ana.post(`/po/${ids.demoPo}/quote`, { [`price_${await lineId()}`]: price }));
  ok(await jordan.post(`/po/${ids.demoPo}/accept`, { version: "1" }));
  expect((await po()).status).toBe("funded");
}

async function dispatch(id: string, sample = "inject") {
  ok(await ana.post(`/po/${id}/dispatch`, sample ? { sample } : {}));
}

async function receive(id: string, delivered: string, damaged: string, sampleNote: "damaged" | "clean" | null = "damaged") {
  if (sampleNote) ok(await sam.post(`/po/${id}/receive/upload`, { sample: sampleNote }));
  const l = await lineId(id);
  return sam.post(`/po/${id}/receive/confirm`, { [`delivered_${l}`]: delivered, [`damaged_${l}`]: damaged, [`wrong_${l}`]: "0", [`note_${l}`]: "", checked: "1" });
}

async function approveBoth(id = ids.demoPo) {
  const r = (await latestResolution(db, id))!;
  ok(await jordan.post(`/po/${id}/resolution/approve`, { version: String(r.version), hash: r.hash }));
  ok(await ana.post(`/po/${id}/resolution/approve`, { version: String(r.version), hash: r.hash }));
  return r;
}

const replacementOf = async (id: string) => (await db.query<{ id: string }>("SELECT id FROM purchase_orders WHERE parent_id = $1", [id])).rows[0]?.id;
const calls = (m: string) => fake.calls.filter((c) => c === m).length;

/** Damage scenario up to the agreed facts: 20 delivered, 2 damaged, supplier agrees. */
async function toResolution() {
  await orderAndHold();
  await dispatch(ids.demoPo);
  ok(await receive(ids.demoPo, "20 cs", "2 cs"));
  expect((await po()).status).toBe("in_review");
  ok(await ana.post(`/po/${ids.demoPo}/lines/${await lineId()}/review`, { action: "agree", seen: await seenOf() }));
  expect((await po()).status).toBe("resolving");
}

beforeEach(async () => {
  db = await openDb({ memory: true });
  setDb(db);
  fake = new FakePayPal();
  setPayPal(fake);
  ids = (await db.tx((q) => seedDemo(q))).ids;
  server = createApp().listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  jordan = await login("jordan");
  sam = await login("sam");
  ana = await login("ana");
  marco = await login("marco");
  await connectPayPal(ids.laneway);
});

afterEach(async () => {
  server.close();
  setPayPal(null);
  setProviderFetch(null);
  config.ai.openaiKey = savedAi.key;
  config.ai.provider = savedAi.provider;
  await db.close();
});

describe("StockSure flows", () => {
  it("full demo: 20 ordered, 2 damaged, Barista Oat replacement, $204 of $210 with hidden invoice instructions ignored", async () => {
    await toResolution();
    const res = (await latestResolution(db, ids.demoPo))!;
    expect(res.body.totals).toMatchObject({ quoted_cents: 20000, accepted_cents: 18000, not_charged_cents: 2000, replacement_cents: 2400, final_cents: 20400, limit_cents: 21000, invoice_cents: 20000 });
    expect(res.body.plan.chosen.picks).toMatchObject([{ sku: "OAT-B12", packs: 2, cents: 2400 }]);
    expect(res.body.funding).toMatchObject({ spendable_now_cents: 1000, hold_cents: 20000, release_expected_cents: 2000 });
    const inv = (await db.query<any>("SELECT flags FROM documents WHERE kind = 'invoice'")).rows[0];
    expect(inv.flags.length).toBeGreaterThan(0);

    await approveBoth();
    await run();
    const orig = await po();
    expect(orig.status).toBe("awaiting_replacement");
    const repl = await replacementOf(ids.demoPo);
    expect((await getPo(db, repl)).status).toBe("funded");
    let f = await fundingOf(db, ids.demoPo);
    expect(f).toMatchObject({ captured_cents: 18000, held_cents: 2400, spendable_cents: 600 });

    await dispatch(repl, "");
    ok(await receive(repl, "2 cs", "0", null));
    await run();
    expect((await getPo(db, repl)).status).toBe("closed");
    expect((await po()).status).toBe("closed");
    f = await fundingOf(db, ids.demoPo);
    expect(f).toMatchObject({ captured_cents: 20400, held_cents: 0, spendable_cents: 600, expected: [] });
    expect(fake.capturedTotal()).toBe(20400);
    // PayPal saw exactly the agreed amounts, and never a payee.
    const writes = fake.bodies.filter((b) => ["createVaultedAuthorizeOrder", "captureAuthorization"].includes(b.method)).map((b) => [b.method, (b.body as any).amountCents]);
    expect(writes).toEqual([["createVaultedAuthorizeOrder", 20000], ["captureAuthorization", 18000], ["createVaultedAuthorizeOrder", 2400], ["captureAuthorization", 2400]]);
    expect(JSON.stringify(fake.bodies)).not.toMatch(/payee|harbour-billing|50000/);
    for (const a of fake.auths.values()) expect(a.status).toBe("CAPTURED");
    // Stock: 18 cases original + 2 cases Barista.
    const stock = (await db.query<{ sku: string; units: number }>("SELECT p.sku, s.units FROM stock s JOIN products p ON p.id = s.product_id WHERE s.buyer_id = $1 ORDER BY p.sku", [ids.laneway])).rows;
    expect(stock).toEqual([{ sku: "OAT-12", units: 216 }, { sku: "OAT-B12", units: 24 }]);
    const csv = await jordan.get(`/po/${ids.demoPo}/record.csv`);
    expect(csv.text).toContain("OAT-B12");
    const json = (await jordan.get(`/po/${ids.demoPo}/record.json`)).json;
    expect(json.purchase_orders).toHaveLength(2);
    expect(json.funding.captured_cents).toBe(20400);
    const view = (await jordan.get(`/api/ui/po/${ids.demoPo}`)).json;
    expect(view.docs.find((d: any) => d.kind === "invoice").flags.length).toBeGreaterThan(0);
    expect(view.resolution.totals.accepted_cents).toBe(20400 - view.resolution.totals.replacement_cents);
  });

  it("a demo reset gets a new invoice-id tag, so PayPal never sees a repeated invoice id", async () => {
    const before = await instanceTag(db);
    await db.tx((q) => seedDemo(q, { keepPayPal: true }));
    expect(await instanceTag(db)).not.toBe(before);
  });

  it("two-part delivery on one hold: part 1 is captured (not final), the rest settles the remainder as the final capture, and the captures add up", async () => {
    await orderAndHold();
    const l = await lineId();
    const part = (n: string, who = ana) => who.post(`/po/${ids.demoPo}/dispatch-part`, { [`part_${l}`]: n });
    const packs = async () => (await db.query<any>("SELECT stock_packs FROM products WHERE id = (SELECT product_id FROM po_lines WHERE id = $1)", [l])).rows[0].stock_packs as number;
    expect(err(await part("8", jordan))).toMatch(/Only the supplier/);
    expect(err(await part("20"))).toMatch(/whole order/);
    expect(err(await part("21"))).toMatch(/only 20/);
    const stock0 = await packs();
    ok(await part("8"));
    expect((await po()).status).toBe("dispatched");
    expect(await packs()).toBe(stock0 - 8);
    expect((await sam.get(`/api/ui/po/${ids.demoPo}/receive`)).json.mode).toBe("part");
    // Part 1 arrives complete: counted against what was shipped in the part, so it agrees itself.
    ok(await receive(ids.demoPo, "8 cs", "0", null));
    expect((await po()).status).toBe("part_settling");
    await run();
    expect((await po()).status).toBe("part_delivered");
    const auth = [...fake.auths.values()][0];
    expect([...fake.captures.values()].map((c) => [c.cents, c.final_capture])).toEqual([[8000, false]]);
    expect(auth.status).toBe("PARTIALLY_CAPTURED");
    expect(await fundingOf(db, ids.demoPo)).toMatchObject({ captured_cents: 8000, held_cents: 12000 });
    expect((await fundingOf(db, ids.demoPo)).holds[0].status).toBe("PARTIALLY_CAPTURED");
    expect(err(await part("4"))).toMatch(/funded order/);
    // The rest ships: only the remaining 12 packs leave stock.
    await dispatch(ids.demoPo, "clean");
    expect(await packs()).toBe(stock0 - 20);
    expect((await sam.get(`/po/${ids.demoPo}/receive`)).text).toMatch(/the rest/);
    // Sam counts only this delivery: 12 delivered, 2 crushed. The receipt adds part 1.
    ok(await receive(ids.demoPo, "12 cs", "2 cs", null));
    const rec = (await latestReceipt(db, ids.demoPo))!;
    expect(rec.lines[0]).toMatchObject({ delivered_units: 240, damaged_units: 24, accepted_units: 216 });
    expect((await db.query<any>("SELECT COALESCE(SUM(delta),0)::int AS n FROM stock_moves WHERE po_id = $1", [ids.demoPo])).rows[0].n).toBe(216);
    expect((await po()).status).toBe("in_review");
    ok(await ana.post(`/po/${ids.demoPo}/lines/${l}/review`, { action: "agree", seen: await seenOf() }));
    expect((await po()).status).toBe("resolving");
    expect((await jordan.get(`/api/ui/po/${ids.demoPo}`)).json.resolution.part_charged_cents).toBe(8000);
    const r = await approveBoth();
    expect(r.body.totals.accepted_cents).toBe(18000);
    await run();
    await run();
    const onOriginal = [...fake.captures.values()].filter((c) => c.authId === auth.id);
    expect(onOriginal.map((c) => [c.cents, c.final_capture])).toEqual([[8000, false], [10000, true]]);
    expect(onOriginal.reduce((a, c) => a + c.cents, 0)).toBe(r.body.totals.accepted_cents);
    expect(auth.status).toBe("CAPTURED");
    expect(await replacementOf(ids.demoPo)).toBeTruthy();
    const f = await fundingOf(db, ids.demoPo);
    expect(f.holds.find((h) => h.id === auth.id)).toMatchObject({ captured_cents: 18000, live_cents: 0 });
    expect((await jordan.get(`/po/${ids.demoPo}/record.json`)).json.purchase_orders[0].shipments.map((x: any) => [x.kind, x.packs["1"], x.status])).toEqual([["part", 8, "charged"], ["rest", 12, "dispatched"]]);
  });

  it("two clean parts close at the full quote; a lost part-capture response is read back, never captured twice", async () => {
    await orderAndHold();
    const l = await lineId();
    ok(await ana.post(`/po/${ids.demoPo}/dispatch-part`, { [`part_${l}`]: "10" }));
    ok(await receive(ids.demoPo, "10 cs", "0", null));
    fake.loseResponseNext("captureAuthorization");
    await run();
    expect((await po()).status).toBe("part_delivered");
    expect([...fake.captures.values()].map((c) => c.cents)).toEqual([10000]);
    await dispatch(ids.demoPo, "clean");
    ok(await receive(ids.demoPo, "10 cs", "0", null));
    expect((await po()).status).toBe("settling");
    await run();
    expect((await po()).status).toBe("closed");
    expect([...fake.captures.values()].map((c) => [c.cents, c.final_capture])).toEqual([[10000, false], [10000, true]]);
    expect(fake.capturedTotal()).toBe(20000);
    expect(await replacementOf(ids.demoPo)).toBeUndefined();
  });

  it("a part with nothing accepted charges nothing; the final capture covers only what was accepted", async () => {
    await orderAndHold();
    const l = await lineId();
    ok(await ana.post(`/po/${ids.demoPo}/dispatch-part`, { [`part_${l}`]: "5" }));
    ok(await receive(ids.demoPo, "5 cs", "5 cs", null));
    ok(await ana.post(`/po/${ids.demoPo}/lines/${l}/review`, { action: "agree", seen: await seenOf() }));
    await run();
    expect((await po()).status).toBe("part_delivered");
    expect(fake.captures.size).toBe(0);
    await dispatch(ids.demoPo, "clean");
    ok(await receive(ids.demoPo, "15 cs", "0", null));
    ok(await ana.post(`/po/${ids.demoPo}/lines/${l}/review`, { action: "agree", seen: await seenOf() }));
    const r = await approveBoth();
    expect(r.body.totals.accepted_cents).toBe(15000);
    await run();
    await run();
    expect([...fake.captures.values()].filter((c) => c.authId === [...fake.auths.values()][0].id).map((c) => [c.cents, c.final_capture])).toEqual([[15000, true]]);
    // A demo reset with shipments, defect claims, ETA risks and stock holds in place succeeds and clears them.
    ok(await jordan.post(`/po/${ids.demoPo}/defects`, { line_id: l, units: "12", note: "One case spoiled" }));
    await db.query("INSERT INTO eta_updates (id, po_id, eta, observed_at, source, ref, recorded_by, applied) VALUES ('eta_x', $1, now(), now(), 'carrier', 'x', 'test', true)", [ids.demoPo]);
    await db.query("INSERT INTO po_risks (id, po_id, kind, status, eta, deliver_by, slack_minutes) VALUES ('rsk_x', $1, 'late', 'open', now(), now(), -60)", [ids.demoPo]);
    await db.tx((q) => seedDemo(q, { keepPayPal: true }));
    for (const t of ["defect_claims", "shipments", "eta_updates", "po_risks", "stock_holds"]) expect((await db.query(`SELECT 1 FROM ${t}`)).rows, t).toHaveLength(0);
  });

  it("review SS-1: a PENDING hold doesn't fund the order or let it ship; it funds once PayPal confirms", async () => {
    ok(await jordan.post(`/po/${ids.demoPo}/submit`));
    ok(await ana.post(`/po/${ids.demoPo}/quote`, { [`price_${await lineId()}`]: "10.00" }));
    const get = fake.getAuthorization.bind(fake);
    let status = "PENDING";
    fake.getAuthorization = async (id: string) => ({ ...(await get(id)), status }) as any;
    const r = await jordan.post(`/po/${ids.demoPo}/accept`, { version: "1" });
    expect(decodeURIComponent(r.location ?? "")).toMatch(/pending/);
    expect((await po()).status).toBe("funding");
    expect(err(await ana.post(`/po/${ids.demoPo}/dispatch`, { sample: "clean" }))).toMatch(/funding/);
    status = "CREATED";
    await run();
    expect((await po()).status).toBe("funded");
    ok(await ana.post(`/po/${ids.demoPo}/dispatch`, { sample: "clean" }));
  });

  it("review SS-1: a DENIED hold returns the order to its quote; nothing is held or shipped", async () => {
    ok(await jordan.post(`/po/${ids.demoPo}/submit`));
    ok(await ana.post(`/po/${ids.demoPo}/quote`, { [`price_${await lineId()}`]: "10.00" }));
    const get = fake.getAuthorization.bind(fake);
    fake.getAuthorization = async (id: string) => ({ ...(await get(id)), status: "DENIED" }) as any;
    expect(err(await jordan.post(`/po/${ids.demoPo}/accept`, { version: "1" }))).toMatch(/DENIED/);
    expect(await po()).toMatchObject({ status: "quoted", auth_id: null });
    expect(err(await ana.post(`/po/${ids.demoPo}/dispatch`, { sample: "clean" }))).toMatch(/quoted/);
  });

  it("review SS-2/3/5/6: after two parts, a defect refund spans both captures, our own refund raises no alarm, the ETA warning waits for the rest, and spoiled stock leaves stock", async () => {
    await orderAndHold();
    const l = await lineId();
    const t = (ms: number) => new Date(ms).toISOString().slice(0, 16);
    const due = new Date((await po()).deliver_by).getTime();
    ok(await ana.post(`/po/${ids.demoPo}/eta`, { eta: t(due + 6 * 36e5), observed_at: t(Date.now() - 60_000), source: "carrier", ref: "late-1" }));
    ok(await ana.post(`/po/${ids.demoPo}/dispatch-part`, { [`part_${l}`]: "8" }));
    ok(await receive(ids.demoPo, "8 cs", "0", null));
    await run();
    expect((await po()).status).toBe("part_delivered");
    expect((await db.query<any>("SELECT status FROM po_risks WHERE po_id = $1", [ids.demoPo])).rows[0].status).not.toBe("closed");
    await dispatch(ids.demoPo, "clean");
    ok(await receive(ids.demoPo, "12 cs", "0", "clean"));
    await run();
    expect((await po()).status).toBe("closed");
    expect((await db.query<any>("SELECT status, closed_reason FROM po_risks WHERE po_id = $1", [ids.demoPo])).rows[0]).toMatchObject({ status: "closed", closed_reason: "Delivered" });
    const stockOf = async () => (await db.query<any>("SELECT units FROM stock WHERE buyer_id = $1 AND product_id = (SELECT product_id FROM po_lines WHERE id = $2)", [ids.laneway, l])).rows[0].units as number;
    const before = await stockOf();
    // 12 cases spoiled = $120: exactly the newest capture, which is then fully refunded by us.
    ok(await jordan.post(`/po/${ids.demoPo}/defects`, { line_id: l, units: "144", note: "Twelve cases spoiled" }));
    const claim = (await db.query<any>("SELECT id FROM defect_claims")).rows[0].id;
    ok(await ana.post(`/po/${ids.demoPo}/defects/${claim}`, { agree: "1", note: "Agreed" }));
    const refunds = (await db.query<any>("SELECT amount_cents, parent_paypal_id, paypal_status FROM payment_ops WHERE kind = 'refund' ORDER BY request_id")).rows;
    const caps = (await db.query<any>("SELECT paypal_id, amount_cents FROM payment_ops WHERE kind = 'capture' ORDER BY created_at")).rows;
    expect(caps.map((c) => c.amount_cents)).toEqual([8000, 12000]);
    expect(refunds.map((r) => [r.amount_cents, r.parent_paypal_id, r.paypal_status])).toEqual([[12000, caps[1].paypal_id, "COMPLETED"]]);
    expect((await db.query<any>("SELECT status FROM defect_claims WHERE id = $1", [claim])).rows[0].status).toBe("refunded");
    expect(await stockOf()).toBe(before - 144);
    // PayPal's own webhook for the fully refunded capture: explained by our refund, so no alarm.
    await db.query("INSERT INTO webhook_events(id, event_type, resource_id, body, verified) VALUES ('wh-own', 'PAYMENT.CAPTURE.REFUNDED', $1, $2, true)", [caps[1].paypal_id, JSON.stringify({ resource: { id: caps[1].paypal_id } })]);
    const hooks = await import("../src/webhooks.js");
    await hooks.processWebhook("wh-own");
    expect(await po()).toMatchObject({ status: "closed" });
    // A claim for more than what is left is refused when it is reported.
    expect(err(await jordan.post(`/po/${ids.demoPo}/defects`, { line_id: l, units: "108", note: "More spoiled" }))).toMatch(/Only 96 accepted/);
  });

  it("review SS-2: a defect larger than the newest capture is split across both captures", async () => {
    await orderAndHold();
    const l = await lineId();
    ok(await ana.post(`/po/${ids.demoPo}/dispatch-part`, { [`part_${l}`]: "12" }));
    ok(await receive(ids.demoPo, "12 cs", "0", null));
    await run();
    await dispatch(ids.demoPo, "clean");
    ok(await receive(ids.demoPo, "8 cs", "0", "clean"));
    await run();
    const caps = (await db.query<any>("SELECT paypal_id, amount_cents FROM payment_ops WHERE kind = 'capture' ORDER BY created_at")).rows;
    expect(caps.map((c) => c.amount_cents)).toEqual([12000, 8000]);
    ok(await jordan.post(`/po/${ids.demoPo}/defects`, { line_id: l, units: "108", note: "Nine cases spoiled" }));
    const claim = (await db.query<any>("SELECT id FROM defect_claims")).rows[0].id;
    ok(await ana.post(`/po/${ids.demoPo}/defects/${claim}`, { agree: "1", note: "Agreed" }));
    const refunds = (await db.query<any>("SELECT amount_cents, parent_paypal_id, paypal_status FROM payment_ops WHERE kind = 'refund' ORDER BY request_id")).rows;
    expect(refunds.map((r) => [r.amount_cents, r.parent_paypal_id, r.paypal_status])).toEqual([[8000, caps[1].paypal_id, "COMPLETED"], [1000, caps[0].paypal_id, "COMPLETED"]]);
    expect((await db.query<any>("SELECT status FROM defect_claims WHERE id = $1", [claim])).rows[0].status).toBe("refunded");
  });

  it("review SS-4: a replacement that no longer works can be re-planned and agreed again, without capturing twice", async () => {
    await toResolution();
    const v1 = await approveBoth();
    const pick = v1.body.plan.chosen.picks[0];
    await db.query("UPDATE products SET price_cents = price_cents + 100 WHERE id = $1", [pick.product_id]);
    await run();
    expect((await po()).status).toBe("exception");
    expect((await po()).exception).toMatch(/replacement no longer works/);
    expect((await jordan.get(`/api/ui/po/${ids.demoPo}`)).json.can_replan).toBe(true);
    expect((await ana.get(`/api/ui/po/${ids.demoPo}`)).json.can_replan).toBe(false);
    ok(await jordan.post(`/po/${ids.demoPo}/resolution/revise`, {}));
    expect((await po()).status).toBe("resolving");
    const v2 = await approveBoth();
    expect(v2.version).toBe(2);
    expect(v2.body.plan.chosen.picks[0].pack_price_cents).toBe(pick.pack_price_cents + 100);
    await run();
    await run();
    expect((await po()).status).toBe("awaiting_replacement");
    expect(fake.calls.filter((c) => c === "captureAuthorization").length).toBe(1);
    expect(await replacementOf(ids.demoPo)).toBeTruthy();
  });

  it("review SS-8: a declined part capture is an exception; retry places a new capture and the part is charged once", async () => {
    await orderAndHold();
    const l = await lineId();
    ok(await ana.post(`/po/${ids.demoPo}/dispatch-part`, { [`part_${l}`]: "8" }));
    ok(await receive(ids.demoPo, "8 cs", "0", null));
    fake.nextCaptureStatus = "DECLINED";
    await run();
    fake.nextCaptureStatus = null;
    expect((await po()).status).toBe("exception");
    expect((await po()).exception).toMatch(/Retry tries a new capture/);
    ok(await jordan.post(`/po/${ids.demoPo}/retry-settle`));
    await run();
    expect((await po()).status).toBe("part_delivered");
    const caps = (await db.query<any>("SELECT request_id, status, paypal_status FROM payment_ops WHERE kind = 'capture' ORDER BY created_at")).rows;
    expect(caps.map((c) => [c.status, c.paypal_status])).toEqual([["failed", "DECLINED"], ["succeeded", "COMPLETED"]]);
    expect(caps[1].request_id).toMatch(/part1:r1$/);
  });

  it("a clean delivery settles the full quote without approvals", async () => {
    await orderAndHold();
    await dispatch(ids.demoPo, "clean");
    ok(await receive(ids.demoPo, "20 cs", "0", "clean"));
    expect((await po()).status).toBe("settling");
    await run();
    expect((await po()).status).toBe("closed");
    expect(fake.capturedTotal()).toBe(20000);
    expect(await replacementOf(ids.demoPo)).toBeUndefined();
  });

  it("early warning: a late ETA opens a risk card; older or duplicate updates can't override a newer one; deciding creates no money", async () => {
    await orderAndHold();
    const due = new Date((await po()).deliver_by).getTime();
    const t = (ms: number) => new Date(ms).toISOString().slice(0, 16);
    const ago = (min: number) => t(Date.now() - min * 60_000);
    const eta = (body: Record<string, string>) => ana.post(`/po/${ids.demoPo}/eta`, body);
    const risk = async () => (await db.query<any>("SELECT * FROM po_risks WHERE po_id = $1 ORDER BY created_at DESC LIMIT 1", [ids.demoPo])).rows[0];
    const opsBefore = (await db.query("SELECT id FROM payment_ops")).rows.length;
    const posBefore = (await db.query("SELECT id FROM purchase_orders")).rows.length;
    const callsBefore = fake.calls.length;

    ok(await eta({ eta: t(due - 2 * 36e5), observed_at: ago(60), source: "supplier", ref: "s1" }));
    expect(await risk()).toBeUndefined();
    ok(await eta({ eta: t(due + 6 * 36e5), observed_at: ago(30), source: "carrier", ref: "trk-2" }));
    expect(await risk()).toMatchObject({ status: "open", slack_minutes: -360 });
    expect((await jordan.get("/api/ui/home")).json.orders.find((o: any) => o.id === ids.demoPo)).toMatchObject({ late: true, needs_you: true });
    const risky = (await jordan.get(`/api/ui/po/${ids.demoPo}`)).json;
    expect(risky.supply.risk).toMatchObject({ status: "open", can_decide: true });
    expect(risky.supply.risk.unknowns.join(" ")).toMatch(/usage rate isn't recorded/);
    expect((await db.query<any>("SELECT body FROM messages WHERE po_id = $1 AND body LIKE 'Early warning%'", [ids.demoPo])).rows).toHaveLength(1);

    // The same carrier event again is one update; an older observation is kept but not applied.
    ok(await eta({ eta: t(due + 6 * 36e5), observed_at: ago(30), source: "carrier", ref: "trk-2" }));
    ok(await eta({ eta: t(due - 5 * 36e5), observed_at: ago(90), source: "supplier", ref: "s0" }));
    const ups = (await db.query<any>("SELECT ref, applied, ignored_reason FROM eta_updates WHERE po_id = $1 ORDER BY created_at", [ids.demoPo])).rows;
    expect(ups.map((u) => [u.ref, u.applied])).toEqual([["s1", true], ["trk-2", true], ["s0", false]]);
    expect(ups[2].ignored_reason).toMatch(/the newer ETA stands/);
    expect(await risk()).toMatchObject({ status: "open", slack_minutes: -360 });

    // Roles: the buyer can't record an ETA; only the owner decides.
    expect(err(await jordan.post(`/po/${ids.demoPo}/eta`, { eta: t(due), observed_at: ago(1), source: "supplier", ref: "x" }))).toMatch(/Only the supplier/);
    expect(err(await sam.post(`/po/${ids.demoPo}/risk`, { choice: "wait" }))).toMatch(/Only the buyer's owner/);
    ok(await jordan.post(`/po/${ids.demoPo}/risk`, { choice: "expedite", note: "Saturday brunch" }));
    expect(await risk()).toMatchObject({ status: "expedite_asked", decision: "expedite" });
    expect((await db.query<any>("SELECT body FROM messages WHERE po_id = $1 AND body LIKE 'Please expedite%'", [ids.demoPo])).rows).toHaveLength(1);
    // Preparing for the risk made no payment, hold or order.
    expect((await db.query("SELECT id FROM payment_ops")).rows.length).toBe(opsBefore);
    expect((await db.query("SELECT id FROM purchase_orders")).rows.length).toBe(posBefore);
    expect(fake.calls.length).toBe(callsBefore);

    // A newer on-time estimate closes the warning; a later slip opens a new one; delivery closes it.
    ok(await eta({ eta: t(due - 36e5), observed_at: ago(5), source: "supplier", ref: "s2" }));
    expect((await risk()).status).toBe("closed");
    expect((await risk()).closed_reason).toMatch(/Back on time/);
    ok(await eta({ eta: t(due + 36e5), observed_at: ago(2), source: "carrier", ref: "trk-3" }));
    expect((await risk()).status).toBe("open");
    await dispatch(ids.demoPo, "clean");
    ok(await receive(ids.demoPo, "20 cs", "0", "clean"));
    expect(await risk()).toMatchObject({ status: "closed", closed_reason: "Delivered" });
    expect((await jordan.get("/api/ui/home")).json.orders.find((o: any) => o.id === ids.demoPo).late).toBe(false);
    // After delivery no more estimates are taken.
    expect(err(await eta({ eta: t(due), observed_at: ago(1), source: "supplier", ref: "s9" }))).toMatch(/only between funding and delivery/);
  });

  it("a late defect after a clean, closed delivery is refunded on the original capture; the signed receipt is unchanged", async () => {
    await orderAndHold();
    await dispatch(ids.demoPo, "clean");
    ok(await receive(ids.demoPo, "20 cs", "0", "clean"));
    await run();
    expect((await po()).status).toBe("closed");
    const receiptBefore = JSON.stringify((await latestReceipt(db, ids.demoPo))!.lines);
    const line = await lineId();
    // Too many units is refused; a supplier can't report; then a real claim.
    expect(decodeURIComponent((await jordan.post(`/po/${ids.demoPo}/defects`, { line_id: line, units: "9999", note: "spoiled" })).location ?? "")).toMatch(/left to claim/);
    expect(decodeURIComponent((await ana.post(`/po/${ids.demoPo}/defects`, { line_id: line, units: "12", note: "x" })).location ?? "")).toMatch(/Only the buyer/);
    ok(await jordan.post(`/po/${ids.demoPo}/defects`, { line_id: line, units: "12", note: "One case spoiled two days before its date" }));
    const claim = (await db.query<any>("SELECT * FROM defect_claims")).rows[0];
    expect(claim).toMatchObject({ status: "reported", units: 12 });
    expect(claim.amount_cents).toBeGreaterThan(0);
    expect(decodeURIComponent((await jordan.post(`/po/${ids.demoPo}/defects/${claim.id}`, { agree: "1" })).location ?? "")).toMatch(/supplier decides/);
    fake.failNext("refundCapture");
    await ana.post(`/po/${ids.demoPo}/defects/${claim.id}`, { agree: "1", note: "Sorry" });
    expect((await db.query<any>("SELECT status FROM defect_claims WHERE id = $1", [claim.id])).rows[0].status).toBe("refunding");
    await run();
    const cap = (await db.query<any>("SELECT paypal_id FROM payment_ops WHERE kind = 'capture' AND status = 'succeeded'")).rows[0].paypal_id;
    expect([...fake.refunds.values()].filter((r) => r.captureId === cap).map((r) => r.amount?.value)).toEqual([(claim.amount_cents / 100).toFixed(2)]);
    expect((await db.query<any>("SELECT status FROM defect_claims WHERE id = $1", [claim.id])).rows[0].status).toBe("refunded");
    expect(JSON.stringify((await latestReceipt(db, ids.demoPo))!.lines)).toBe(receiptBefore);
    expect((await jordan.get(`/api/ui/po/${ids.demoPo}`)).json.defects.claims.map((c: any) => c.status)).toContain("refunded");
  });

  it("dispute, revise, agree: only the changed line is re-reviewed and stock follows the revision", async () => {
    await orderAndHold();
    await dispatch(ids.demoPo);
    ok(await receive(ids.demoPo, "20 cs", "2 cs"));
    const v1Seen = await seenOf();
    ok(await ana.post(`/po/${ids.demoPo}/lines/${await lineId()}/review`, { action: "dispute", note: "Photo 2 shows only one crushed case", seen: v1Seen }));
    expect((await po()).status).toBe("in_review");
    ok(await receive(ids.demoPo, "20 cs", "1 cs", null));
    // An "agree" sent from the page showing v1 cannot approve the revised v2 counts.
    const stale = await ana.post(`/po/${ids.demoPo}/lines/${await lineId()}/review`, { action: "agree", seen: v1Seen });
    expect(decodeURIComponent(stale.location ?? "")).toMatch(/receipt changed since you looked/);
    expect((await db.query<any>("SELECT l.supplier_status FROM receipts r JOIN receipt_lines l ON l.receipt_id = r.id WHERE r.po_id = $1 AND r.version = 2", [ids.demoPo])).rows[0].supplier_status).toBe("pending");
    const rec = (await db.query<any>("SELECT r.version, l.supplier_status, l.accepted_units FROM receipts r JOIN receipt_lines l ON l.receipt_id = r.id WHERE r.po_id = $1 ORDER BY r.version", [ids.demoPo])).rows;
    expect(rec.map((x) => [x.version, x.supplier_status, x.accepted_units])).toEqual([[1, "disputed", 216], [2, "pending", 228]]);
    const moves = (await db.query<{ delta: number }>("SELECT delta FROM stock_moves WHERE po_id = $1 ORDER BY id", [ids.demoPo])).rows.map((m) => m.delta);
    expect(moves).toEqual([216, 12]);
    ok(await ana.post(`/po/${ids.demoPo}/lines/${await lineId()}/review`, { action: "agree", seen: await seenOf() }));
    const res = (await latestResolution(db, ids.demoPo))!;
    expect(res.body.totals).toMatchObject({ accepted_cents: 19000, replacement_cents: 1200, final_cents: 20200 });
    const msgs = (await db.query<{ body: string }>("SELECT body FROM messages WHERE po_line_id = $1 ORDER BY id", [await lineId()])).rows.map((m) => m.body);
    expect(msgs.some((m) => m.includes("Disputed"))).toBe(true);
  });

  it("an approval for an older version is refused; settlement uses only the version both approved", async () => {
    await toResolution();
    const v1 = (await latestResolution(db, ids.demoPo))!;
    ok(await jordan.post(`/po/${ids.demoPo}/resolution/approve`, { version: "1", hash: v1.hash }));
    ok(await jordan.post(`/po/${ids.demoPo}/resolution/revise`, { [`choice_${await lineId()}`]: "credit" }));
    const late = await ana.post(`/po/${ids.demoPo}/resolution/approve`, { version: "1", hash: v1.hash });
    expect(err(late)).toMatch(/changed to v2/);
    const v2 = await approveBoth();
    expect(v2.version).toBe(2);
    expect(v2.body.totals).toMatchObject({ accepted_cents: 18000, replacement_cents: 0, final_cents: 18000 });
    await run();
    expect((await po()).status).toBe("closed");
    expect(fake.capturedTotal()).toBe(18000);
    expect(calls("createVaultedAuthorizeOrder")).toBe(1);
  });

  it("double approvals and duplicate settle jobs produce one capture and one replacement", async () => {
    await toResolution();
    const r = await approveBoth();
    ok(await jordan.post(`/po/${ids.demoPo}/resolution/approve`, { version: String(r.version), hash: r.hash }));
    ok(await ana.post(`/po/${ids.demoPo}/resolution/approve`, { version: String(r.version), hash: r.hash }));
    await Promise.all([run(), run()]);
    const { handlers: h } = await import("../src/worker.js");
    await h.settle({ poId: ids.demoPo, version: r.version });
    await h.settle({ poId: ids.demoPo, version: r.version });
    expect(calls("captureAuthorization")).toBe(1);
    expect((await db.query("SELECT 1 FROM purchase_orders WHERE parent_id = $1", [ids.demoPo])).rows).toHaveLength(1);
    expect(calls("createVaultedAuthorizeOrder")).toBe(2);
  });

  it("a capture held by the scam check, once approved, settles once (no approval loop, one held message)", async () => {
    await toResolution();
    await postMessage(db, ids.demoPo, null, "Ana Ruiz", "supplier", DEMO_SUPPLIER_CHANGE);
    const r = await approveBoth();
    await run();
    expect(calls("captureAuthorization")).toBe(0);
    const { handlers: h } = await import("../src/worker.js");
    await h.settle({ poId: ids.demoPo, version: r.version });
    await h.settle({ poId: ids.demoPo, version: r.version });
    const pending = (await db.query<any>("SELECT id, payload FROM approvals WHERE status = 'pending'")).rows;
    expect(pending).toHaveLength(1);
    expect((typeof pending[0].payload === "string" ? JSON.parse(pending[0].payload) : pending[0].payload).safety_rule).toBe("supplier_details_changed_in_message");
    const held = (await db.query<any>("SELECT body FROM messages WHERE po_id = $1 AND body LIKE '%waits for the buyer''s approval%'", [ids.demoPo])).rows;
    expect(held).toHaveLength(1);
    expect((await db.query("SELECT 1 FROM events WHERE po_id = $1 AND type = 'settle.held'", [ids.demoPo])).rows).toHaveLength(1);
    // The owner approves (by click; the amount is under the passkey threshold).
    ok(await jordan.post(`/guard/approvals/${pending[0].id}/click`, { approve: "1" }));
    await run();
    await run();
    expect(calls("captureAuthorization")).toBe(1);
    expect((await po()).status).toBe("awaiting_replacement");
    expect((await db.query("SELECT 1 FROM approvals WHERE status = 'pending'")).rows).toHaveLength(0);
    // S3: every amount in the activity reads as currency.
    const texts = (await db.query<{ summary: string }>("SELECT summary FROM events WHERE po_id = $1", [ids.demoPo])).rows.map((e) => e.summary).join("\n");
    expect(texts).toMatch(/Owner approved the \$\d+\.\d\d charge/);
    expect(texts).not.toMatch(/\d+ cents/);
  });

  it("a 503 on capture retries with the same request id: one capture", async () => {
    await toResolution();
    await approveBoth();
    fake.failNext("captureAuthorization");
    await run();
    await run();
    expect(calls("captureAuthorization")).toBe(2);
    expect(fake.captures.size).toBe(1);
    const op = (await db.query<any>("SELECT * FROM payment_ops WHERE kind = 'capture'")).rows;
    expect(op).toHaveLength(1);
    expect(op[0]).toMatchObject({ status: "succeeded", request_id: `cap:${ids.demoPo}:1` });
    expect((await po()).status).toBe("awaiting_replacement");
  });

  it("a lost capture response is read back from PayPal, never captured again", async () => {
    await toResolution();
    await approveBoth();
    fake.loseResponseNext("captureAuthorization");
    await run();
    expect(fake.captures.size).toBe(1);
    expect(calls("captureAuthorization")).toBe(1);
    expect(calls("getOrder")).toBeGreaterThan(0);
    const ev = (await db.query("SELECT 1 FROM events WHERE type = 'paypal.readback'")).rows;
    expect(ev).toHaveLength(1);
    expect((await po()).status).toBe("awaiting_replacement");
  });

  it("a PENDING capture is not settled: no release spending or replacement until PayPal completes it", async () => {
    await toResolution();
    await approveBoth();
    fake.nextCaptureStatus = "PENDING";
    await run();
    fake.nextCaptureStatus = null;
    const op = (await db.query<any>("SELECT * FROM payment_ops WHERE kind = 'capture'")).rows[0];
    expect(op).toMatchObject({ status: "pending", paypal_status: "PENDING" });
    expect((await po()).status).toBe("settling");
    expect((await db.query("SELECT 1 FROM purchase_orders WHERE parent_id = $1", [ids.demoPo])).rows).toHaveLength(0);
    await run();
    expect((await po()).status).toBe("settling");
    fake.setCaptureStatus(op.paypal_id, "COMPLETED");
    await run();
    expect((await po()).status).toBe("awaiting_replacement");
    expect(fake.captures.size).toBe(1);
    expect((await db.query<any>("SELECT status, paypal_status FROM payment_ops WHERE kind = 'capture'")).rows[0]).toMatchObject({ status: "succeeded", paypal_status: "COMPLETED" });
  });

  it("PENDING then DECLINED: the order goes to an exception and nothing else happens", async () => {
    await toResolution();
    await approveBoth();
    fake.nextCaptureStatus = "PENDING";
    await run();
    fake.nextCaptureStatus = null;
    const op = (await db.query<any>("SELECT * FROM payment_ops WHERE kind = 'capture'")).rows[0];
    fake.setCaptureStatus(op.paypal_id, "DECLINED");
    await run();
    expect((await po()).status).toBe("exception");
    expect((await po()).exception).toMatch(/DECLINED/);
    expect((await db.query("SELECT 1 FROM purchase_orders WHERE parent_id = $1", [ids.demoPo])).rows).toHaveLength(0);
    expect((await db.query<any>("SELECT status FROM payment_ops WHERE kind = 'capture'")).rows[0].status).toBe("failed");
  });

  it("agreed replacement stock is held: another order cannot ship it, and a stock or price change stops the replacement before it is ordered", async () => {
    await toResolution();
    await approveBoth();
    const res = (await latestResolution(db, ids.demoPo))!;
    const pick = res.body.plan.chosen.picks[0];
    const holds = (await db.query<any>("SELECT * FROM stock_holds WHERE source_po = $1 AND status = 'held'", [ids.demoPo])).rows;
    expect(holds.map((h) => [h.product_id, h.packs])).toEqual([[pick.product_id, pick.packs]]);
    // The supplier cuts the price list before settlement runs: the replacement is not ordered at the old terms.
    await db.query("UPDATE products SET price_cents = price_cents + 100 WHERE id = $1", [pick.product_id]);
    await run();
    expect((await po()).status).toBe("exception");
    expect((await po()).exception).toMatch(/price changed/);
    expect((await db.query("SELECT 1 FROM purchase_orders WHERE parent_id = $1", [ids.demoPo])).rows).toHaveLength(0);
    expect((await db.query<any>("SELECT status FROM stock_holds WHERE source_po = $1", [ids.demoPo])).rows.every((h) => h.status === "released")).toBe(true);
    expect(fake.captures.size).toBe(1);
  });

  it("an expected release is not spent: the replacement hold waits until PayPal shows the hold released", async () => {
    await toResolution();
    await approveBoth();
    fake.releaseLag = 2;
    await run(); // capture lands; read-back still shows the hold live
    expect(fake.captures.size).toBe(1);
    expect(calls("createVaultedAuthorizeOrder")).toBe(1);
    let f = await fundingOf(db, ids.demoPo);
    expect(f.spendable_cents).toBe(1000);
    expect(f.expected).toEqual([expect.objectContaining({ cents: 2000 })]);
    expect((await po()).status).toBe("settling");
    await run(); // still lagging
    expect(calls("createVaultedAuthorizeOrder")).toBe(1);
    await run(); // released
    f = await fundingOf(db, ids.demoPo);
    expect(calls("createVaultedAuthorizeOrder")).toBe(2);
    expect(f).toMatchObject({ captured_cents: 18000, held_cents: 2400, spendable_cents: 600 });
  });

  it("a refused replacement hold leaves the capture in place; retry resumes without capturing again", async () => {
    await toResolution();
    await approveBoth();
    fake.failNext("createVaultedAuthorizeOrder", new PayPalError("Instrument declined", 422, "INSTRUMENT_DECLINED", "fake", null));
    await run();
    const p1 = await po();
    expect(p1.status).toBe("exception");
    expect(p1.exception).toMatch(/Replacement hold failed/);
    expect(fake.captures.size).toBe(1);
    ok(await jordan.post(`/po/${ids.demoPo}/retry-settle`));
    await run();
    expect((await po()).status).toBe("awaiting_replacement");
    expect(calls("captureAuthorization")).toBe(1);
    const holds = (await db.query<{ request_id: string; status: string }>("SELECT request_id, status FROM payment_ops WHERE kind = 'authorize' ORDER BY created_at")).rows;
    expect(holds.map((h) => h.status)).toEqual(["succeeded", "failed", "succeeded"]);
    expect(holds[2].request_id).toMatch(/:r1$/);
  });

  it("model output cannot carry a payee or an amount; hidden instructions never reach payments", async () => {
    config.ai.openaiKey = "test-key";
    config.ai.provider = "openai";
    setProviderFetch(async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      const schema = body.text.format.name;
      const sent = JSON.stringify(body.input);
      expect(sent).not.toMatch(/harbour-billing|ASSISTANT:/);
      const out =
        schema === "invoice_lines"
          ? { lines: [{ sku: "OAT-12", description: "Oat Milk 12 x 1 L", quantity_text: "20 cs", unit_price: "10.00", line_total: "200.00", payee: "attacker@example.com" }], total_seen: "500.00", pay_to: "attacker@example.com" }
          : { lines: [{ sku: "OAT-12", description: "Oat Milk 12 x 1 L", quantity_text: "20 cs", confidence: 0.95 }], damage: [{ description: "2 cases crushed", quantity_text: "2 cs", product_hint: "OAT-12", kind: "damaged", confidence: 0.7 }], approve_amount: 50000 };
      return new Response(JSON.stringify({ model: body.model, status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(out) }] }], usage: { input_tokens: 100, output_tokens: 50 } }), { status: 200 });
    });
    await toResolution();
    const res = (await latestResolution(db, ids.demoPo))!;
    expect(res.body.totals.accepted_cents).toBe(18000);
    expect(JSON.stringify(res.body)).not.toMatch(/attacker|pay_to|approve_amount/);
    const ex = (await db.query<{ lines: any; source: string }>("SELECT e.lines, e.source FROM extractions e JOIN documents d ON d.id = e.document_id WHERE d.kind = 'invoice'")).rows[0];
    expect(ex.source).toMatch(/gpt-6/);
    expect(JSON.stringify(ex.lines)).not.toMatch(/attacker/);
    await approveBoth();
    await run();
    expect(fake.bodies.filter((b) => b.method === "captureAuthorization").map((b) => (b.body as any).amountCents)).toEqual([18000]);
  });

  it("when every model fails the reading says so (no rules stand-in), and Read it again works once a model answers", async () => {
    config.ai.openaiKey = "test-key";
    config.ai.provider = "openai";
    let up = false;
    const models: string[] = [];
    setProviderFetch(async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      models.push(body.model);
      if (!up) return new Response(JSON.stringify({ error: { message: "overloaded" } }), { status: 500 });
      const out = { lines: [{ sku: "OAT-12", description: "Oat Milk 12 x 1 L", quantity_text: "20 cs", confidence: 0.95 }], damage: [] };
      return new Response(JSON.stringify({ model: body.model, status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(out) }] }], usage: { input_tokens: 10, output_tokens: 10 } }), { status: 200 });
    });
    await orderAndHold();
    await dispatch(ids.demoPo, "");
    ok(await sam.post(`/po/${ids.demoPo}/receive/upload`, { note_text: "Delivery docket: 20 cs Oat Milk 12 x 1 L" }));
    // The primary and the backup model were both tried; nothing else read the docket.
    expect(new Set(models)).toEqual(new Set([config.ai.models.read, config.ai.models.readBackup]));
    const view = (await sam.get(`/api/ui/po/${ids.demoPo}/receive`)).json;
    expect(view.extractions[0]).toMatchObject({ failed: true, source: "none", lines: [] });
    expect(view.extractions[0].notes.join(" ")).toMatch(/couldn't read that/);
    expect(JSON.stringify(view)).not.toMatch(/overloaded|OpenAI 500/);
    up = true;
    ok(await sam.post(`/po/${ids.demoPo}/receive/reread/${view.extractions[0].document_id}`));
    const after = (await sam.get(`/api/ui/po/${ids.demoPo}/receive`)).json;
    expect(after.extractions).toHaveLength(1);
    expect(after.extractions[0].failed).toBe(false);
    expect(after.extractions[0].lines).toHaveLength(1);
  });

  it("access control: other buyers see nothing; roles are enforced server-side", async () => {
    expect((await marco.get(`/api/ui/po/${ids.demoPo}`)).status).toBe(404);
    expect((await marco.get(`/api/ui/po/${ids.demoPo}/receive`)).status).toBe(404);
    expect((await marco.get(`/po/${ids.demoPo}/record.json`)).status).toBe(404);
    ok(await jordan.post(`/po/${ids.demoPo}/submit`));
    expect(err(await sam.post(`/po/${ids.demoPo}/quote`, {}))).toMatch(/Only supplier/);
    ok(await ana.post(`/po/${ids.demoPo}/quote`, { [`price_${await lineId()}`]: "11.00" }));
    expect(err(await jordan.post(`/po/${ids.demoPo}/accept`, { version: "1" }))).toMatch(/above your \$210.00 limit/);
    ok(await ana.post(`/po/${ids.demoPo}/quote`, { [`price_${await lineId()}`]: "10.00" }));
    expect(err(await jordan.post(`/po/${ids.demoPo}/accept`, { version: "1" }))).toMatch(/changed the quote/);
    expect(err(await sam.post(`/po/${ids.demoPo}/accept`, { version: "2" }))).toMatch(/Only owner/);
    ok(await jordan.post(`/po/${ids.demoPo}/accept`, { version: "2" }));
    ok(await jordan.post(`/po/${ids.demoPo}/accept`, { version: "2" })); // idempotent
    expect(calls("createVaultedAuthorizeOrder")).toBe(1);
    await dispatch(ids.demoPo);
    const l = await lineId();
    expect(err(await ana.post(`/po/${ids.demoPo}/receive/confirm`, { [`delivered_${l}`]: "20 cs", [`damaged_${l}`]: "0", [`wrong_${l}`]: "0", checked: "1" }))).toMatch(/receiving person or owner/);
    expect(err(await receive(ids.demoPo, "20 cs", "21 cs", null))).toMatch(/more than delivered/);
    expect(err(await receive(ids.demoPo, "20 pallets", "0", null))).toMatch(/unknown unit/);
    const doc = (await db.query<{ id: string }>("SELECT id FROM documents LIMIT 1")).rows[0];
    expect((await marco.get(`/doc/${doc.id}`)).status).toBe(404);
    expect((await jordan.get(`/doc/${doc.id}`)).headers.get("content-security-policy")).toMatch(/sandbox/);
    // Messages reach the front end as JSON data (React renders text, never HTML); the page shell never contains them.
    expect((await jordan.get(`/po/${ids.demoPo}`)).text).not.toMatch(/<script>alert/);
    expect((await jordan.get(`/api/ui/po/${ids.demoPo}`)).headers.get("content-type")).toMatch(/application\/json/);
  });
});
