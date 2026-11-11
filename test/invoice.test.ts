/**
 * Spec B4 item 2: every invoice is checked in code (duplicate, price above recent, new payee, instruction to an AI,
 * early-payment terms). The samples go through the real supplier route; nothing an invoice says changes what is paid.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { config } from "../src/config.js";
import { openDb, setDb, withWorkspace, type Db } from "../src/db.js";
import { FakePayPal } from "../src/paypal/fake.js";
import { setPayPal } from "../src/paypal/index.js";
import { getWorkspace, seedStatus } from "../src/demo/workspaces.js";
import { duplicateOf, earlyTerms, invoiceNumber } from "../src/services/invoice-checks.js";
import { demoIds, sampleInvoice } from "../src/services/seed.js";
import { latestResolution, setting } from "../src/store.js";
import { Client } from "./client.js";
import { serveTracked } from "./journey-coverage.js";

let db: Db;
let srv: Awaited<ReturnType<typeof serveTracked>>;
const saved = { demo: { ...config.demo }, key: config.ai.openaiKey };
const TOKEN = "TOKEN-DEMO-WALLET";

beforeEach(async () => {
  db = await openDb({ memory: true });
  setDb(db);
  const fake = new FakePayPal();
  fake.tokens.add(TOKEN);
  setPayPal(fake);
  config.ai.openaiKey = "";
  config.demo.vaultToken = TOKEN;
  config.demo.vaultPayer = "sandbox-buyer@example.com";
  config.demo.perAddressPerHour = 50;
  srv = await serveTracked(createApp());
});
afterEach(async () => {
  Object.assign(config.demo, saved.demo);
  config.ai.openaiKey = saved.key;
  await srv.close();
  setPayPal(null);
  await db.close();
});

describe("invoice rules", () => {
  it("reads numbers and early terms, and tells a resent invoice from a different one", () => {
    const sl = [{ sku: "OAT-12", name: "Oat milk", qty_packs: 20, pack_label: "case of 12", unit_price_cents: 1000 }];
    const a = sampleInvoice("PO-1042", "Laneway", sl);
    expect(invoiceNumber(a)).toBe("INV-1042");
    expect(earlyTerms("Payment terms: 2% discount if paid within 10 days, otherwise net 30.")).toEqual({ pct: 2, days: 10 });
    expect(earlyTerms("2/10 net 30")).toEqual({ pct: 2, days: 10 });
    expect(earlyTerms("Payment terms: on delivery via PayPal")).toBeNull();
    const lines = [{ sku: "OAT-12", billed_units: 240, unit_price_cents: 1000, line_cents: 240000 / 1 }];
    const earlier = [{ id: "doc1", po_number: "PO-1042", text: a, lines }];
    expect(duplicateOf(a, lines, earlier)?.message).toMatch(/already sent/);
    const resent = a.replace(/(INV-\d+)/, "$1-B");
    expect(duplicateOf(resent, lines, earlier)?.message).toMatch(/under a new number INV-1042-B/);
    const other = sampleInvoice("PO-1043", "Laneway", [{ ...sl[0], qty_packs: 18 }]);
    expect(duplicateOf(other, [{ ...lines[0], billed_units: 216, line_cents: 216000 }], earlier)).toBeNull();
  });
});

describe("supplier invoices on an order", () => {
  it("flags a bad invoice and its duplicate, ticks the judge path, shows them on Protected, and takes an early discount", { timeout: 90000 }, async () => {
    const c = new Client(srv.base);
    expect((await c.postJson("/demo/start", {})).json.ok).toBe(true);
    const ws = (await c.get("/api/ui/workspace")).json.workspace.id;
    for (let i = 0; i < 400 && !(await seedStatus((await getWorkspace(ws))!)).done; i++) await new Promise((r) => setTimeout(r, 25));
    const { ids, poId, agentsPo } = await withWorkspace(ws, async () => {
      const ids = (await demoIds(db))!;
      const po = (await db.query<{ id: string }>("SELECT id FROM purchase_orders WHERE buyer_id = $1 AND NOT is_sample AND kind = 'original' AND status = 'dispatched' ORDER BY created_at LIMIT 1", [ids.laneway])).rows[0];
      return { ids, poId: po.id, agentsPo: (await setting(db, "judge_agents_po"))! };
    });

    // Sam (receiving) may not send an invoice; Ana can.
    expect((await c.post("/login", { person_id: ids.people.sam, next: "/home" })).status).toBe(302);
    const refused = await c.post(`/po/${poId}/invoice`, { sample: "bad" });
    expect(refused.location ?? "").toMatch(/err=/);
    expect((await c.post("/login", { person_id: ids.people.ana, next: "/home" })).status).toBe(302);
    const r1 = await c.post(`/po/${poId}/invoice`, { sample: "bad" });
    expect(r1.status).toBe(302);
    const r2 = await c.post(`/po/${poId}/invoice`, { sample: "duplicate" });
    expect(r2.status).toBe(302);

    const docs = (await c.get(`/api/ui/po/${poId}`)).json.docs.filter((d: any) => d.kind === "invoice" && d.checks);
    const codes = docs.map((d: any) => d.checks.flags.map((f: any) => f.code));
    const all = codes.flat();
    expect(all).toContain("contains_instruction");
    expect(all).toContain("asks_to_change_payee");
    expect(all).toContain("duplicate_of_earlier_invoice");

    const judge = (await c.get("/api/public/judge")).json;
    const path = judge.paths.find((p: any) => p.id === "invoice");
    expect(path.steps.map((s: any) => s.done)).toEqual([true, true]);

    // The café's home: the duplicate is listed apart from the money total (StockSure pays counts, not invoices).
    expect((await c.get("/api/ui/protected")).status).toBe(403);
    // The receiver counts goods; the money figures are the owner's.
    expect((await c.post("/login", { person_id: ids.people.sam, next: "/home" })).status).toBe(302);
    expect((await c.get("/api/ui/protected")).status).toBe(403);
    expect((await c.post("/login", { person_id: ids.people.jordan, next: "/home" })).status).toBe(302);
    const prot = (await c.get("/api/ui/protected")).json;
    const dup = prot.rows.find((r: any) => r.key === "duplicates");
    expect(dup.items.length).toBe(1);
    expect(dup.in_total).toBe(false);

    // Early-payment terms on the order whose fix is open: the fix is proposed again with the discount off the capture.
    expect((await c.post("/login", { person_id: ids.people.ana, next: "/home" })).status).toBe(302);
    const before = await withWorkspace(ws, () => latestResolution(db, agentsPo));
    expect((await c.post(`/po/${agentsPo}/invoice`, { sample: "discount" })).status).toBe(302);
    const after = (await withWorkspace(ws, () => latestResolution(db, agentsPo)))!;
    expect(after.version).toBe(before!.version + 1);
    expect(after.body.early_payment).toMatchObject({ pct: 2, days: 10 });
    expect(after.body.totals.early_discount_cents).toBe(Math.round(after.body.totals.accepted_cents * 0.02));
    expect(after.body.totals.payable_cents).toBe(after.body.totals.accepted_cents - after.body.totals.early_discount_cents);
  });
});
