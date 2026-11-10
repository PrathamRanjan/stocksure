import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { openDb, setDb, type Db } from "../src/db.js";
import { drain } from "../src/jobs.js";
import { FakePayPal } from "../src/paypal/fake.js";
import { setPayPal } from "../src/paypal/index.js";
import { seedDemo, type DemoIds } from "../src/services/seed.js";
import { fundingOf, linesOf } from "../src/store.js";
import { handlers } from "../src/worker.js";
import { Client } from "./client.js";

// The React front end's contract with the server: read-only JSON views under /api/ui/*, and the existing form
// handlers answering { ok, message, to } instead of redirecting when the request carries X-StockSure-UI: 1.
let db: Db;
let fake: FakePayPal;
let server: Server;
let base: string;
let ids: DemoIds;

const UI = { "x-stocksure-ui": "1" };
const uiPost = (c: Client, p: string, form: Record<string, string> = {}) => {
  return c.req("POST", p, { headers: UI, form });
};
const run = async () => {
  await db.query("UPDATE jobs SET run_at = now() WHERE status = 'pending'");
  return drain(db, handlers);
};

async function login(person: string) {
  const c = new Client(base);
  const r = await uiPost(c, "/login", { person_id: ids.people[person], next: "/home" });
  expect(r.json).toEqual({ ok: true, message: "", to: "/home" });
  return c;
}

beforeEach(async () => {
  db = await openDb({ memory: true });
  setDb(db);
  fake = new FakePayPal();
  setPayPal(fake);
  ids = (await db.tx((q) => seedDemo(q))).ids;
  server = createApp().listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  server.close();
  setPayPal(null);
  await db.close();
});

describe("front-end JSON contract", () => {
  it("form posts answer JSON with the server's own message; errors and missing sessions say so", async () => {
    const anon = new Client(base);
    // Without the header nothing changes: still a redirect.
    expect((await anon.post(`/po/${ids.demoPo}/submit`)).status).toBe(302);
    const unauth = await uiPost(anon, `/po/${ids.demoPo}/submit`);
    expect(unauth.status).toBe(401);
    expect(unauth.json).toMatchObject({ ok: false, auth: true });

    const bad = await uiPost(anon, "/login", { key: "nope" });
    expect(bad.json).toMatchObject({ ok: false, message: "That key is not valid." });

    const jordan = await login("jordan");
    const sam = await login("sam");
    const sub = await uiPost(jordan, `/po/${ids.demoPo}/submit`);
    expect(sub.status).toBe(200);
    expect(sub.json).toEqual({ ok: true, message: "Sent to the supplier for a quote.", to: `/po/${ids.demoPo}` });
    // A role error comes back as ok:false with the message, and the flash parameters never leak into `to`.
    const denied = await uiPost(sam, `/po/${ids.demoPo}/quote`, {});
    expect(denied.json.ok).toBe(false);
    expect(denied.json.message).toMatch(/Only supplier/);
    expect(denied.json.to).not.toMatch(/[?&](ok|err)=/);
  });

  it("connecting PayPal hands back the external approval link instead of following it", async () => {
    const jordan = await login("jordan");
    const r = await uiPost(jordan, "/connect-paypal");
    expect(r.json.ok).toBe(true);
    expect(r.json.external).toBe(true);
    expect(r.json.to).toMatch(/^https?:\/\//);
  });

  it("views carry server-computed money only, and only to the people allowed to see it", async () => {
    const jordan = await login("jordan");
    const ana = await login("ana");
    const sam = await login("sam");
    const marco = await login("marco");
    const st = await fake.createSetupToken({ returnUrl: "x" }, "st");
    fake.approveSetup(st.id);
    const t = await fake.createPaymentToken(st.id, "pt");
    await db.query("UPDATE orgs SET vault_token_id = $2, vault_payer = 'buyer@example.com' WHERE id = $1", [ids.laneway, t.id]);

    await uiPost(jordan, `/po/${ids.demoPo}/submit`);
    const l = (await linesOf(db, ids.demoPo))[0];
    expect((await uiPost(ana, `/po/${ids.demoPo}/quote`, { [`price_${l.id}`]: "10.00" })).json.ok).toBe(true);
    const quoted = (await jordan.get(`/api/ui/po/${ids.demoPo}`)).json;
    expect(quoted.quote_total_cents).toBe(20000);
    expect(quoted.paypal).toMatchObject({ connected: true });
    expect(quoted.funding).toMatchObject({ limit_cents: 21000, held_cents: 0, captured_cents: 0 });
    // The supplier's view has no buyer PayPal details.
    expect((await ana.get(`/api/ui/po/${ids.demoPo}`)).json.paypal).toBeNull();

    const acc = await uiPost(jordan, `/po/${ids.demoPo}/accept`, { version: String(quoted.po.quote_version) });
    expect(acc.json).toMatchObject({ ok: true, message: "Quote accepted and PayPal hold placed." });
    await run();
    const held = (await jordan.get(`/api/ui/po/${ids.demoPo}`)).json;
    const f = await fundingOf(db, held.po.root_id);
    expect(held.funding).toMatchObject({ limit_cents: f.limit_cents, held_cents: f.held_cents, spendable_cents: f.spendable_cents });
    expect(held.ops.find((o: any) => o.kind === "authorize")).toMatchObject({ status: "succeeded", amount_cents: 20000 });
    expect(held.lines[0].tally).toEqual({ ordered: 20, accepted: null, damaged: null, wrong: null, short: null });

    // Counts on the home view and in the session follow the same states.
    expect((await ana.get("/api/ui/session")).json.counts.needs).toBeGreaterThan(0);
    expect((await sam.get("/api/ui/home")).json.can_create).toBe(false);
    expect((await marco.get(`/api/ui/po/${ids.demoPo}`)).status).toBe(404);
    expect((await sam.get("/api/ui/approvals")).json.approvals).toEqual([]);
  });
});
