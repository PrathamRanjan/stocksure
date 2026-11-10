import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { config } from "../src/config.js";
import { openDb, setDb, withWorkspace, type Db } from "../src/db.js";
import { FakePayPal } from "../src/paypal/fake.js";
import { setPayPal } from "../src/paypal/index.js";
import { seedDemo } from "../src/services/seed.js";
import { closeWorkspace, createWorkspace, getWorkspace, seedStatus, SEED_PAYMENTS } from "../src/demo/workspaces.js";
import { checkWallet } from "../src/demo/wallet.js";
import { receiveWebhook } from "../src/webhooks.js";
import { Client } from "./client.js";
import { sign } from "../src/lib/crypto.js";
import { serveTracked } from "./journey-coverage.js";
import { WORKSPACE_ROUTES } from "./workspace-routes.js";

// Spec A1 + A2.1: every visitor gets a private workspace, seeded through the real order path and paid from the
// saved demo wallet; two visitors never see each other's data; closing a workspace voids its holds.
let db: Db;
let fake: FakePayPal;
let srv: Awaited<ReturnType<typeof serveTracked>>;
let base: string;
const saved = { ...config.demo };
const TOKEN = "TOKEN-DEMO-WALLET";

const inWs = <T>(ws: string | null, sql: string, p: unknown[] = []) => withWorkspace(ws, async () => (await db.query<any>(sql, p)).rows as T[]);
async function settled(id: string) {
  for (let i = 0; i < 200; i++) {
    const w = (await getWorkspace(id))!;
    const s = await seedStatus(w);
    if (s.done) return s;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("seeding never finished");
}
const wsCookieOf = (c: Client) => c.cookies.get("ss_ws");

beforeEach(async () => {
  db = await openDb({ memory: true });
  setDb(db);
  fake = new FakePayPal();
  fake.tokens.add(TOKEN);
  setPayPal(fake);
  config.demo.vaultToken = TOKEN;
  config.demo.vaultPayer = "sandbox-buyer@example.com";
  config.demo.adminKey = "test-admin-key-0123456789";
  config.demo.perAddressPerHour = 50;
  await db.tx((q) => seedDemo(q));
  srv = await serveTracked(createApp());
  base = srv.base;
});
afterEach(async () => {
  Object.assign(config.demo, saved);
  await srv.close();
  setPayPal(null);
  await db.close();
});

describe("private demo workspaces", () => {
  it("seeds through the real path: six PayPal operations confirmed, sample history labelled, wallet marked", { timeout: 60000 }, async () => {
    const w = await createWorkspace("visitor", "10.0.0.1", { background: false });
    const s = await seedStatus((await getWorkspace(w.id))!);
    expect(s.stopped).toBeNull();
    expect(s.wallet).toBe(true);
    expect(s.expected).toBe(SEED_PAYMENTS);
    expect(s.confirmed).toBe(SEED_PAYMENTS);
    const ops = await inWs<{ kind: string; status: string; paypal_id: string | null }>(w.id, "SELECT kind, status, paypal_id FROM payment_ops ORDER BY created_at");
    expect(ops.filter((o) => o.status === "succeeded" && o.paypal_id)).toHaveLength(SEED_PAYMENTS);
    // Every hold in the workspace came from the saved wallet and carries the workspace in custom_id.
    const holds = fake.bodies.filter((b) => b.method === "createVaultedAuthorizeOrder").map((b) => b.body as any);
    expect(holds.length).toBeGreaterThanOrEqual(3);
    for (const h of holds) {
      expect(h.vaultId).toBe(TOKEN);
      expect(String(h.customId)).toMatch(new RegExp(`^${w.id}:`));
    }
    const orgs = await inWs<{ vault_source: string | null }>(w.id, "SELECT vault_source FROM orgs WHERE vault_token_id IS NOT NULL");
    expect(orgs.every((o) => o.vault_source === "demo_wallet")).toBe(true);
    const samples = await inWs<{ is_sample: boolean }>(w.id, "SELECT is_sample FROM purchase_orders WHERE is_sample");
    expect(samples.length).toBeGreaterThan(0);
    // Sample rows never carry a PayPal id.
    const sampleOps = await inWs(w.id, "SELECT 1 FROM payment_ops o JOIN purchase_orders p ON p.id = o.po_id WHERE p.is_sample");
    expect(sampleOps).toHaveLength(0);
  });

  it("without a working wallet: no payments, drafts stay drafts, the page offers PayPal's own approval", { timeout: 60000 }, async () => {
    fake.tokens.clear();
    expect((await checkWallet())!.status).toBe("missing");
    const w = await createWorkspace("visitor", "10.0.0.2", { background: false });
    const s = await seedStatus((await getWorkspace(w.id))!);
    expect(s).toMatchObject({ wallet: false, expected: 0, confirmed: 0, done: true });
    expect(fake.bodies.filter((b) => b.method === "createVaultedAuthorizeOrder")).toHaveLength(0);
  });

  it("two visitors are isolated; join links share one; reset closes only your own; showcase is read-only", { timeout: 90000 }, async () => {
    const a = new Client(base);
    const b = new Client(base);
    expect((await a.get("/start")).status).toBe(200);
    const sa = await a.postJson("/demo/start", {});
    expect(sa.json).toMatchObject({ ok: true, to: "/login" });
    const sb = await b.postJson("/demo/start", {});
    expect(sb.json.ok).toBe(true);
    const wa = (await a.get("/api/ui/workspace")).json;
    const wb = (await b.get("/api/ui/workspace")).json;
    expect(wa.workspace.id).toBeTruthy();
    expect(wa.workspace.id).not.toBe(wb.workspace.id);
    expect(wa.wallet).toMatchObject({ configured: true });
    await settled(wa.workspace.id);
    await settled(wb.workspace.id);

    // Signing in inside A, then changing data, never shows up in B (or in the base data).
    const peopleA = (await a.get("/api/ui/people")).json.people;
    const jordanA = peopleA.find((p: any) => p.first === "Jordan");
    expect((await a.post("/login", { person_id: jordanA.id, next: "/home" })).status).toBe(302);
    const marker = "Isolation marker 7Q";
    await withWorkspace(wa.workspace.id, () => db.query("UPDATE purchase_orders SET note = $1 WHERE status = 'draft'", [marker]));
    expect(await inWs(wb.workspace.id, "SELECT 1 FROM purchase_orders WHERE note = $1", [marker])).toHaveLength(0);
    expect(await inWs(null, "SELECT 1 FROM purchase_orders WHERE note = $1", [marker])).toHaveLength(0);
    // A's person id means nothing in B.
    expect((await b.post("/login", { person_id: jordanA.id, next: "/home" })).location).toMatch(/err=/);
    // A's home only lists A's orders.
    const homeA = (await a.get("/api/ui/home")).json;
    expect(homeA).toBeTruthy();

    // Webhooks find their workspace from custom_id, else from the PayPal ids the workspace recorded.
    const hold = fake.bodies.find((x) => x.method === "createVaultedAuthorizeOrder" && String((x.body as any).customId).startsWith(`${wa.workspace.id}:`))!;
    const authB = (await inWs<{ paypal_id: string }>(wb.workspace.id, "SELECT paypal_id FROM payment_ops WHERE kind = 'authorize' AND status = 'succeeded' LIMIT 1"))[0].paypal_id;
    config.paypal.webhookId = "WH-CONFIGURED";
    const sig = { "paypal-transmission-sig": "valid-fake-signature" };
    expect((await a.postJson("/webhooks/paypal", { id: "WH-WS-1", event_type: "CHECKOUT.ORDER.APPROVED", resource: { id: "ORDER-X", custom_id: (hold.body as any).customId } }, sig)).json).toEqual({ ok: true });
    expect((await a.postJson("/webhooks/paypal", { id: "WH-WS-2", event_type: "PAYMENT.AUTHORIZATION.CREATED", resource: { id: authB } }, sig)).json).toEqual({ ok: true });
    expect((await a.postJson("/webhooks/paypal", { id: "WH-WS-3", event_type: "PAYMENT.AUTHORIZATION.CREATED", resource: { id: "UNKNOWN", custom_id: "zzzzzzzz:po" } }, sig)).json).toEqual({ ok: true });
    const evs = await inWs<{ id: string; ws_id: string | null }>(null, "SELECT id, ws_id FROM webhook_events WHERE id LIKE 'WH-WS-%' ORDER BY id");
    expect(evs.map((e) => e.ws_id)).toEqual([wa.workspace.id, wb.workspace.id, null]);
    const jobs = await inWs<{ ws_id: string | null }>(null, "SELECT ws_id FROM jobs WHERE type = 'process_webhook' ORDER BY id");
    expect(jobs.map((j) => j.ws_id)).toEqual([wa.workspace.id, wb.workspace.id, null]);
    config.paypal.webhookId = "";

    // A join link puts a second device into the same workspace; the QR encodes it.
    const joinUrl = new URL(wa.workspace.join_url);
    expect((await a.get("/demo/join.svg")).text).toMatch(/<svg/);
    expect((await new Client(base).get("/demo/join.svg")).status).toBe(404);
    const phone = new Client(base);
    expect((await phone.get(joinUrl.pathname)).location).toMatch(/^\/login/);
    expect((await phone.get("/api/ui/workspace")).json.workspace.id).toBe(wa.workspace.id);
    expect((await new Client(base).get("/demo/join/not-a-real-token")).location).toMatch(/err=/);

    // Faults are armed only in your own workspace.
    expect((await a.post("/demo/fault", { method: "captureAuthorization", kind: "fail_503" })).location).not.toMatch(/err=/);
    expect(await inWs(wa.workspace.id, "SELECT 1 FROM demo_faults")).toHaveLength(1);
    expect(await inWs(wb.workspace.id, "SELECT 1 FROM demo_faults")).toHaveLength(0);

    // Reset gives A a new workspace and closes A's old one (holds voided); B is untouched.
    const activeA = await inWs<{ paypal_id: string }>(wa.workspace.id, "SELECT DISTINCT paypal_id FROM payment_ops WHERE kind = 'authorize' AND status = 'succeeded'");
    expect((await a.post("/demo/reset")).location).toMatch(/^\/login/);
    const wa2 = (await a.get("/api/ui/workspace")).json.workspace;
    expect(wa2.id).not.toBe(wa.workspace.id);
    for (let i = 0; i < 200 && (await getWorkspace(wa.workspace.id))!.seed_state !== "expired"; i++) await new Promise((r) => setTimeout(r, 25));
    let old = (await getWorkspace(wa.workspace.id))!;
    for (let i = 0; i < 200 && !/Voided/.test(old.error ?? ""); i++) {
      await new Promise((r) => setTimeout(r, 25));
      old = (await getWorkspace(wa.workspace.id))!;
    }
    expect(old.seed_state).toBe("expired");
    expect(old.error).toMatch(/Voided \d+ hold/);
    for (const { paypal_id } of activeA) expect(["VOIDED", "CAPTURED", "PARTIALLY_CAPTURED"]).toContain((await fake.getAuthorization(paypal_id)).status);
    expect((await getWorkspace(wb.workspace.id))!.seed_state).toBe("ready");
    expect((await b.get("/api/ui/workspace")).json.workspace.id).toBe(wb.workspace.id);

    // Admin: key required; then the showcase is built through the same path and is read-only.
    const admin = new Client(base);
    expect((await admin.get("/admin/workspaces")).status).toBe(401);
    expect((await admin.post("/admin/login", { key: "wrong" })).status).toBe(401);
    expect((await admin.post("/admin/login", { key: config.demo.adminKey, next: "/admin/workspaces" })).status).toBe(302);
    expect((await admin.get("/admin/workspaces")).text).toContain(wb.workspace.id);
    expect((await admin.post("/admin/showcase")).location).not.toMatch(/err=/);
    expect((await admin.post("/admin/expire")).location).not.toMatch(/err=/);
    expect((await admin.post("/admin/reset-base")).location).not.toMatch(/err=/);
    const show = (await inWs<{ id: string; join_token: string }>(null, "SELECT id, join_token FROM workspaces WHERE kind = 'showcase' AND seed_state = 'ready'"))[0];
    expect(show).toBeTruthy();
    // A showcase cannot be joined as a visitor, and writes into it are refused.
    expect((await new Client(base).get(`/demo/join/${show.join_token}`)).location).toMatch(/err=/);
    const viewer = new Client(base);
    viewer.cookies.set("ss_ws", encodeURIComponent(sign(show.id)));
    expect((await viewer.get("/api/ui/workspace")).json.workspace.kind).toBe("showcase");
    const people = (await viewer.get("/api/ui/people")).json.people;
    expect(people.length).toBeGreaterThan(0);
    const w403 = await viewer.post("/login", { person_id: people[0].id, next: "/home" });
    expect(w403.status).toBe(403);
    expect((await viewer.post("/demo/fault", { method: "captureAuthorization", kind: "fail_503" })).status).toBe(403);

    // Wallet page and re-approval (the fake stands in for PayPal's approval page).
    expect((await admin.get("/admin/paypal/wallet?check=1")).text).toMatch(/Status: <b>ok<\/b>/);
    const start = await admin.post("/admin/paypal/wallet/start");
    const setup = new URL(start.location!).searchParams.get("token")!;
    expect(setup).toBeTruthy();
    fake.setupApproved.add(setup); // the sandbox buyer approving on PayPal
    expect((await admin.get(`/admin/paypal/wallet/return?approval_token_id=${setup}`)).location).not.toMatch(/err=/);
    expect((await admin.get(`/admin/paypal/wallet/return?approval_token_id=someone-elses`)).location).toMatch(/err=/);
    expect((await admin.get("/admin/paypal/wallet")).text).toMatch(/re-approved/);

    expect(srv.failures).toEqual([]);
    // Every demo and admin route is exercised here (the main journey runs on the base data and skips them).
    expect(srv.missed().filter((r) => WORKSPACE_ROUTES.includes(r))).toEqual([]);
  });

  it("closing a workspace voids its open holds and drops its data", { timeout: 60000 }, async () => {
    const w = await createWorkspace("visitor", "10.0.0.3", { background: false });
    const auths = await inWs<{ paypal_id: string }>(w.id, "SELECT DISTINCT paypal_id FROM payment_ops WHERE kind = 'authorize' AND status = 'succeeded'");
    const open = [];
    for (const { paypal_id } of auths) if (["CREATED", "PARTIALLY_CAPTURED"].includes((await fake.getAuthorization(paypal_id)).status)) open.push(paypal_id);
    expect(open.length).toBeGreaterThan(0);
    const r = await closeWorkspace(w.id, "test");
    expect(r.failed).toEqual([]);
    expect(r.voided.sort()).toEqual(open.sort());
    for (const id of open) expect((await fake.getAuthorization(id)).status).toBe("VOIDED");
    await expect(inWs(w.id, "SELECT 1 FROM purchase_orders")).rejects.toThrow();
  });
});
