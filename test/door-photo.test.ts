/**
 * Spec B4 item 4: a door photo proposes counts and damage for the receiver to confirm; a photo of a screen counts
 * nothing; a QR link opens the receive page on a phone as the receiver, once. The models are scripted; the routes,
 * the proposal and the sign-in are the real paths.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { config } from "../src/config.js";
import { openDb, setDb, withWorkspace, type Db } from "../src/db.js";
import { FakePayPal } from "../src/paypal/fake.js";
import { setPayPal } from "../src/paypal/index.js";
import { setProviderFetch } from "../src/ai/provider.js";
import { getWorkspace, seedStatus } from "../src/demo/workspaces.js";
import { clarityOf } from "../src/ai/door-photo.js";
import { demoIds } from "../src/services/seed.js";
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

/** The vision model sees `cases` of the first SKU with `crushed`; Decisions says whether it's a screen. */
function scriptPhoto(sku: string, cases: number, crushed: number, screen: number) {
  config.ai.openaiKey = "sk-test";
  config.ai.provider = "openai";
  setProviderFetch((async (url: any, init: any) => {
    const body = JSON.parse(String(init.body));
    if (String(url).endsWith("/v1/decisions")) {
      const p: Record<string, number> = { shows_damage: crushed ? 0.9 : 0.05, label_matches_ordered_item: 0.98, photo_is_of_a_screen: screen };
      return new Response(JSON.stringify({ model: "gpt-6-luna", answers: body.questions.map((q: any) => (q.type === "score" ? { type: "score", name: q.name, probabilities: [{ value: 2, label: "clear", probability: 0.9 }, { value: 1, label: "rough", probability: 0.1 }] } : { type: "predicate", name: q.name, probability: p[q.name] ?? 0 })), usage: { input_tokens: 1 } }), { status: 200 });
    }
    const out = { items: [{ sku, label_text: `${sku} label`, cases_visible: cases, cases_damaged: crushed, confidence: 0.93 }], description: "Cases by the back door." };
    return new Response(JSON.stringify({ model: "gpt-6.1-sol", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(out) }] }], usage: { input_tokens: 100, output_tokens: 20 } }), { status: 200 });
  }) as typeof fetch);
}

async function seeded() {
  const c = new Client(srv.base);
  expect((await c.postJson("/demo/start", {})).json.ok).toBe(true);
  const ws = (await c.get("/api/ui/workspace")).json.workspace.id;
  for (let i = 0; i < 400 && !(await seedStatus((await getWorkspace(ws))!)).done; i++) await new Promise((r) => setTimeout(r, 25));
  const out = await withWorkspace(ws, async () => {
    const ids = (await demoIds(db))!;
    const po = (await db.query<{ id: string }>("SELECT id FROM purchase_orders WHERE buyer_id = $1 AND NOT is_sample AND kind = 'original' AND status = 'dispatched' ORDER BY created_at LIMIT 1", [ids.laneway])).rows[0];
    const line = (await db.query<any>("SELECT l.id, l.qty_packs, p.sku, p.pack_units FROM po_lines l JOIN products p ON p.id = l.product_id WHERE l.po_id = $1 ORDER BY l.line_no LIMIT 1", [po.id])).rows[0];
    return { ids, poId: po.id, line };
  });
  return { c, ws, ...out };
}

describe("door photo", () => {
  it("reads the count clarity from either answer shape", () => {
    expect(clarityOf({ probabilities: [{ value: 0, label: "cannot_count", probability: 0.2 }, { value: 2, label: "clear", probability: 0.7 }] })).toBe("clear");
    expect(clarityOf({ score: 1 })).toBe("rough");
    expect(clarityOf(undefined)).toBeNull();
  });

  it("a generated door photo proposes counts and crushed cases for Sam to confirm; a photo of a screen counts nothing", { timeout: 90000 }, async () => {
    const { c, ids, poId, line } = await seeded();
    expect((await c.post("/login", { person_id: ids.people.sam, next: "/home" })).status).toBe(302);

    scriptPhoto(line.sku, line.qty_packs - 1, 2, 0.02);
    expect((await c.post(`/po/${poId}/receive/upload`, { sample: "photo" })).status).toBe(302);
    let m = (await c.get(`/api/ui/po/${poId}/receive`)).json;
    const ex = m.extractions.find((e: any) => e.door_photo);
    expect(ex).toMatchObject({ kind: "photo", screen: false, failed: false });
    expect(ex.filename).toMatch(/^generated-door-photo-/);
    expect(ex.decisions.count_clarity).toBe("clear");
    const l = m.lines.find((x: any) => x.id === line.id);
    expect(l.proposal.delivered).toBe((line.qty_packs - 1) * line.pack_units);
    expect(l.proposal.flags).toContain("possible_damage");
    expect(l.prefill.damaged).toMatch(/^2 /);

    // A screen: kept as evidence, nothing counted, and the proposal is unchanged.
    scriptPhoto(line.sku, 99, 0, 0.99);
    expect((await c.post(`/po/${poId}/receive/upload`, { sample: "screen" })).status).toBe(302);
    m = (await c.get(`/api/ui/po/${poId}/receive`)).json;
    const sc = m.extractions.find((e: any) => e.screen);
    expect(sc.notes[0]).toMatch(/photo of a screen/);
    expect(sc.lines).toHaveLength(0);
    expect(m.lines.find((x: any) => x.id === line.id).proposal.delivered).toBe((line.qty_packs - 1) * line.pack_units);

    // A delivery note that disagrees with the photo (read by the offline parser): the note sets the count and the line is flagged.
    setProviderFetch(null);
    config.ai.openaiKey = "";
    expect((await c.post(`/po/${poId}/receive/upload`, { sample: "clean" })).status).toBe(302);
    m = (await c.get(`/api/ui/po/${poId}/receive`)).json;
    const after = m.lines.find((x: any) => x.id === line.id);
    expect(after.proposal.flags).toContain("count_differs");
  });

  it("the QR link signs a phone in as the receiver, once", { timeout: 60000 }, async () => {
    const { c, ids, poId } = await seeded();
    expect((await c.post("/login", { person_id: ids.people.ana, next: "/home" })).status).toBe(302);
    expect((await c.get(`/api/ui/po/${poId}/phone-link`)).status).toBe(403);
    expect((await c.post("/login", { person_id: ids.people.jordan, next: "/home" })).status).toBe(302);
    const link = (await c.get(`/api/ui/po/${poId}/phone-link`)).json;
    expect(link.svg).toMatch(/^<svg/);
    const path = new URL(link.url).pathname;
    const phone = new Client(srv.base);
    const r = await phone.get(path);
    expect(r.status).toBe(302);
    expect(r.location).toBe(`/po/${poId}/receive?phone=1`);
    const who = (await phone.get("/api/ui/session")).json;
    expect(JSON.stringify(who)).toMatch(/receiving/);
    expect((await new Client(srv.base).get(path)).status).toBe(410);
    expect((await new Client(srv.base).get("/phone/forged.token")).status).toBe(410);
  });
});
