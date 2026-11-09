/**
 * Journey leg for the roadmap foundation (Parts B and C): MCP and the merchant cart API, agent negotiation,
 * the guard console (mandate, backtest, kill switch, approvals, passkey endpoints, audit), traces, evidence,
 * judge mode, channels and webhooks, PWA endpoints, the ledger, the deliveries board, the dock, the driver page
 * and the supplier's disputes page. Every new route is reached at least once; no request may return a 5xx.
 */
import { expect } from "vitest";
import { Client as McpClient } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Db } from "../src/db.js";
import type { FakePayPal } from "../src/paypal/fake.js";
import type { DemoIds } from "../src/services/seed.js";
import { setting } from "../src/store.js";
import { dryRun } from "../src/guard/dryrun.js";
import { DEFAULT_RULES } from "../src/guard/policy.js";
import type { Client } from "./client.js";

export interface FoundationCtx {
  base: string;
  db: Db;
  ids: DemoIds;
  fake: FakePayPal;
  anon: Client;
  jordan: Client;
  sam: Client;
  ana: Client;
  run: () => Promise<number>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const okRedirect = (r: { status: number; location: string | null }) => {
  expect(r.status, r.location ?? "").toBe(302);
  expect(decodeURIComponent(r.location ?? "")).not.toMatch(/[?&]err=/);
  return r;
};

export async function walkFoundation(c: FoundationCtx) {
  const { base, db, ids, anon, jordan, sam, ana } = c;
  const one = async (sql: string, p: unknown[] = []) => (await db.query<any>(sql, p)).rows[0];
  const keys: Record<string, string> = JSON.parse((await setting(db, "demo_keys")) ?? "{}");
  const laneway = ids.laneway;
  const bearer = { authorization: `Bearer ${keys.jordan}` };

  // ---- MCP: tools listed, a read tool answers, no key is refused ----
  const mcp = new McpClient({ name: "journey-agent", version: "1" });
  await mcp.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { ...bearer, "x-agent-id": "journey-agent" } } }));
  expect((await mcp.listTools()).tools.map((t) => t.name)).toEqual(expect.arrayContaining(["get_mandate", "draft_order", "submit_order", "negotiate", "accept_quote", "get_order", "list_catalog", "get_stock"]));
  const mandate: any = await mcp.callTool({ name: "get_mandate", arguments: {} });
  expect(JSON.parse(mandate.content[0].text).rules.max_order_cents).toBeGreaterThan(0);
  const stock: any = await mcp.callTool({ name: "get_stock", arguments: {} });
  expect(JSON.parse(stock.content[0].text).stock).toBeDefined();
  await mcp.close();
  expect((await fetch(`${base}/mcp`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).status).toBe(401);

  // ---- Merchant cart API: suppliers, catalog, cart, items, quote, checkout ----
  const sups = await anon.get("/api/merchant/suppliers", bearer);
  expect(sups.status).toBe(200);
  const supplierId = sups.json.suppliers[0].id as string;
  const cat = await anon.get(`/api/merchant/suppliers/${supplierId}/catalog`, bearer);
  expect(cat.json.items.length).toBeGreaterThan(1);
  const cart = await anon.postJson("/api/merchant/carts", { supplier_id: supplierId }, bearer);
  expect(cart.status).toBe(200);
  const cartId = cart.json.cart_id as string;
  expect((await anon.postJson(`/api/merchant/carts/${cartId}/items`, { sku: cat.json.items[0].sku, qty_packs: 2 }, bearer)).json.quote.total_cents).toBeGreaterThan(0);
  expect((await anon.postJson(`/api/merchant/carts/${cartId}/items`, { sku: cat.json.items[1].sku, qty_packs: 1 }, bearer)).json.items.length).toBe(2);
  expect((await anon.req("DELETE", `/api/merchant/carts/${cartId}/items/${encodeURIComponent(cat.json.items[1].sku)}`, { headers: bearer })).json.items.length).toBe(1);
  const quote = await anon.get(`/api/merchant/carts/${cartId}`, bearer);
  expect(quote.json.quote.mandate.outcome).toMatch(/run|wait/);
  expect((await anon.postJson(`/api/merchant/carts/${cartId}/checkout`, { confirm: false }, bearer)).status).toBe(422);
  const out = await anon.postJson(`/api/merchant/carts/${cartId}/checkout`, { confirm: true, deliver_by: new Date(Date.now() + 2 * 864e5).toISOString() }, bearer);
  expect(out.status, out.text).toBe(200);
  const agentPo = out.json.po_id as string;
  expect((await one("SELECT status, created_by_agent FROM purchase_orders WHERE id = $1", [agentPo])).status).toBe("submitted");

  // ---- Agents negotiate the agent's order; the agreement places the hold through the gate ----
  const started = okRedirect(await jordan.post("/negotiations/start", { po: agentPo }));
  const negId = started.location!.split("/negotiations/")[1].split("?")[0];
  for (let i = 0; i < 12; i++) {
    await c.run();
    const n = await one("SELECT status FROM negotiations WHERE id = $1", [negId]);
    if (n.status !== "open") break;
    await sleep(600);
  }
  const neg = await one("SELECT * FROM negotiations WHERE id = $1", [negId]);
  expect(["agreed", "held"], JSON.stringify(neg.outcome)).toContain(neg.status);
  expect((await jordan.get("/negotiations")).text).toMatch(/Negotiations/);
  expect((await jordan.get(`/negotiations/${negId}`)).text).toMatch(/Round 1/);
  expect((await ana.get(`/negotiations/${negId}`)).status).toBe(200);
  const agentPoRow = await one("SELECT status FROM purchase_orders WHERE id = $1", [agentPo]);
  expect(["funded", "funding", "quoted"]).toContain(agentPoRow.status);

  // ---- Deliveries board: supplier records an ETA by dragging; the server checks first ----
  expect((await ana.get("/deliveries")).text).toMatch(/Deliveries over time/);
  expect((await jordan.get("/deliveries/data.json")).json.events.length).toBeGreaterThan(0);
  const deliverBy = (await one("SELECT deliver_by FROM purchase_orders WHERE id = $1", [agentPo])).deliver_by;
  const when = new Date(new Date(deliverBy).getTime() + 2 * 36e5).toISOString();
  const chk = await ana.get(`/deliveries/check?po=${agentPo}&when=${encodeURIComponent(when)}`);
  expect(chk.status).toBe(200);
  if (chk.json.ok) {
    okRedirect(await ana.post("/deliveries/move", { po: agentPo, when }));
    expect((await one("SELECT count(*) AS n FROM eta_updates WHERE po_id = $1", [agentPo])).n).not.toBe("0");
  } else {
    expect((await ana.post("/deliveries/move", { po: agentPo, when })).status).toBe(302);
  }
  expect((await jordan.get(`/deliveries/check?po=${agentPo}&when=${encodeURIComponent(when)}`)).json.ok).toBe(false);

  // ---- Supplier: disputes page, floor, driver link, driver page ----
  expect((await ana.get("/disputes")).text).toMatch(/Disputes/);
  okRedirect(await ana.post("/disputes/floor", { floor_pct: "85" }));
  expect((await one("SELECT floor_pct FROM orgs WHERE id = $1", [ids.supplier])).floor_pct).toBe(85);
  okRedirect(await ana.post("/disputes/driver-link"));
  const token = (await one("SELECT driver_token FROM people WHERE id = $1", [ids.people.ana])).driver_token as string;
  expect(token).toBeTruthy();
  expect((await anon.get(`/driver/${token}`)).text).toMatch(/stops/);
  expect((await anon.get("/driver/not-a-token")).status).toBe(302);
  okRedirect(await anon.post(`/driver/${token}/arrive`, { po: agentPo }));
  okRedirect(await anon.post(`/driver/${token}/tracking`, { po: agentPo, carrier: "DHL", tracking_number: "JD0001" }));
  expect((await one("SELECT tracking_number FROM shipments WHERE po_id = $1", [agentPo])).tracking_number).toBe("JD0001");
  // A dispute on a real capture: sync links it, the evidence pack goes to PayPal once.
  const capture = await one("SELECT paypal_id, po_id FROM payment_ops WHERE root_id = $1 AND kind = 'capture' AND status = 'succeeded' ORDER BY created_at LIMIT 1", [ids.demoPo]);
  expect(capture?.paypal_id).toBeTruthy();
  const dispute = c.fake.openDispute(capture.paypal_id);
  okRedirect(await ana.post("/disputes/sync"));
  expect((await one("SELECT dispute_id FROM purchase_orders WHERE id = $1", [capture.po_id])).dispute_id).toBe(dispute.dispute_id);
  okRedirect(await ana.post(`/disputes/${encodeURIComponent(dispute.dispute_id)}/evidence`, { po: capture.po_id }));
  okRedirect(await ana.post(`/disputes/${encodeURIComponent(dispute.dispute_id)}/evidence`, { po: capture.po_id }));
  expect((await ana.get("/disputes")).text).toMatch(new RegExp(dispute.dispute_id));
  expect((await jordan.get("/disputes")).status).toBe(302);

  // ---- Guard console ----
  expect((await jordan.get("/guard")).text).toMatch(/Mandate/);
  expect((await sam.get("/guard")).status).toBe(302);
  const preview = await jordan.post("/guard/policy", { text: "No more than $800 per order and $2,000 per day. Ask me before charging more than $400. Agents may order and accept quotes up to 5% above catalog. 6 rounds.", mode: "preview" });
  expect(preview.status).toBe(200);
  const polId = preview.text.match(/\/guard\/policy\/([^/"]+)\/activate/)?.[1];
  expect(polId).toBeTruthy();
  okRedirect(await jordan.post(`/guard/policy/${polId}/activate`));
  expect((await one("SELECT active FROM policies WHERE id = $1", [polId])).active).toBe(true);
  okRedirect(await jordan.post("/guard/policy", { text: "No more than $900 per order.", mode: "adopt" }));
  expect((await jordan.post("/guard/backtest", { approve_above_cents: "20000" })).status).toBe(200);
  okRedirect(await jordan.post("/guard/adopt-rules", { rules: JSON.stringify({ ...DEFAULT_RULES, approve_above_cents: 50000, agents_may_order: true, agents_may_accept: true }) }));
  expect((await jordan.post("/guard/suggestions", { payload: "[]" })).status).toBe(302);
  okRedirect(await jordan.post("/guard/kill", { scope: `org:${laneway}`, engaged: "1", reason: "journey" }));
  expect((await one("SELECT engaged FROM kill_switches WHERE scope = $1", [`org:${laneway}`])).engaged).toBe(true);
  const denied = await dryRun({ action: "authorize", ownerId: laneway, agentScope: "agent:journey", entity: "po", entityId: ids.demoPo, cents: 1000, trustedCents: [1000] });
  expect(denied.gate).toBe("denied");
  okRedirect(await jordan.post("/guard/kill", { scope: `org:${laneway}`, engaged: "0" }));
  expect((await jordan.post("/guard/kill", { scope: "org:someone-else", engaged: "1" })).status).toBe(302);
  // Approvals: one held capture is approved by click, a bigger one is declined; the countersign threshold is enforced.
  const held = await dryRun({ action: "capture", ownerId: laneway, agentScope: `org:${laneway}`, entity: "po", entityId: ids.demoPo, cents: 50000, trustedCents: [50000] });
  expect(held.gate).toBe("held");
  const big = await dryRun({ action: "capture", ownerId: laneway, agentScope: `org:${laneway}`, entity: "po", entityId: ids.demoPo, cents: 60000, trustedCents: [60000] });
  expect(big.gate).toBe("held");
  const heldId = (held as any).approvalId as string;
  const bigId = (big as any).approvalId as string;
  expect((await jordan.get("/guard")).text).toMatch(/Waiting for you \(2\)/);
  expect(decodeURIComponent((await jordan.post(`/guard/approvals/${bigId}/click`, { approve: "1" })).location ?? "")).toMatch(/passkey/);
  okRedirect(await jordan.post(`/guard/approvals/${bigId}/click`, { approve: "0" }));
  okRedirect(await jordan.post(`/guard/approvals/${heldId}/click`, { approve: "1" }));
  expect((await one("SELECT status, method FROM approvals WHERE id = $1", [heldId])).status).toBe("approved");
  expect((await one("SELECT status FROM approvals WHERE id = $1", [bigId])).status).toBe("declined");
  const allowedNow = await dryRun({ action: "capture", ownerId: laneway, agentScope: `org:${laneway}`, entity: "po", entityId: ids.demoPo, cents: 50000, trustedCents: [50000] });
  expect(allowedNow.gate).toBe("allowed");
  await c.run();
  // Passkey endpoints: a challenge is issued; a bogus registration is refused; signing an unknown approval is refused.
  const reg = await jordan.postJson("/guard/passkey/register/start", {});
  expect(reg.status).toBe(200);
  expect(reg.json.challenge).toBeTruthy();
  expect((await jordan.postJson("/guard/passkey/register/finish", { chalId: reg.json.id, clientDataJSON: "AA", authenticatorData: "AA", rawId: "AA" })).status).toBe(400);
  expect((await jordan.postJson("/guard/passkey/sign/start", { approvalId: bigId })).status).toBe(404);
  expect((await jordan.postJson("/guard/passkey/sign/finish", { approvalId: bigId, chalId: "x" })).status).toBe(404);
  expect((await sam.postJson("/guard/passkey/register/start", {})).status).toBe(403);
  const audit = await jordan.get("/guard/audit.json");
  expect(audit.json.chain.ok).toBe(true);
  expect(audit.json.rows.length).toBeGreaterThan(3);
  expect((await jordan.get("/guard/runs.json")).json.runs).toBeDefined();

  // ---- Traces ----
  expect((await jordan.get("/traces")).text).toMatch(/Agent runs/);
  const run = await one("SELECT r.id FROM agent_runs r WHERE r.entity = 'po' AND r.entity_id IN (SELECT id FROM purchase_orders WHERE buyer_id = $1) ORDER BY started_at DESC LIMIT 1", [laneway]);
  expect(run?.id).toBeTruthy();
  expect((await jordan.get(`/trace/${run.id}`)).text).toMatch(/Agent trace/);
  expect((await anon.get(`/trace/${run.id}`)).status).toBe(302);
  expect((await jordan.get("/api/v1/runs")).json.runs.length).toBeGreaterThan(0);
  expect((await anon.get(`/api/v1/runs?po=${agentPo}`, bearer)).json.runs).toBeDefined();
  expect((await anon.get(`/api/v1/runs/${run.id}`, bearer)).json.run.id).toBe(run.id);
  expect((await anon.get(`/api/v1/runs/${run.id}`)).status).toBe(401);

  // ---- Evidence, judge mode ----
  expect((await anon.get("/evidence")).text).toMatch(/Real vs simulated/);
  expect([200, 404]).toContain((await anon.get("/evidence/three-arm.md")).status);
  expect([200, 404]).toContain((await anon.get("/evidence/arena.md")).status);
  expect((await anon.get("/evidence/eval")).text).toMatch(/Eval explorer/);
  expect((await anon.get("/evidence/eval?suite=arena&arm=gate&outcome=wrong&trap=trap")).status).toBe(200);
  expect((await anon.get("/evidence/eval.csv?suite=receiving")).text).toMatch(/^id,arm/);
  expect((await anon.get("/llms.txt")).text).toMatch(/\/mcp/);
  expect((await anon.get("/skill.md")).text).toMatch(/StockSure skill/);
  const judge = await anon.get("/judge");
  expect(judge.text).toMatch(/six beats/);
  const sid = judge.text.match(/\/judge\?s=([^&"]+)&b=1/)?.[1];
  expect(sid).toBeTruthy();
  expect((await anon.get(`/judge?s=${sid}&b=3`)).text).toMatch(/4\. /);

  // ---- Channels: simulator shows what live channels would send; replies work; webhooks accept bodies ----
  const channels = await jordan.get("/channels");
  expect(channels.text).toMatch(/Channels/);
  okRedirect(await jordan.post("/channels/reply", { address: `buyer:${laneway}`, text: "pending" }));
  okRedirect(await jordan.post("/channels/reply", { address: `supplier:${ids.supplier}`, text: "orders" }));
  expect((await jordan.post("/channels/reply", { address: "nobody", text: "hi" })).status).toBe(302);
  const msgs = await db.query<any>("SELECT id, body FROM channel_messages WHERE address = $1 AND direction = 'out' ORDER BY created_at DESC LIMIT 20", [`buyer:${laneway}`]);
  expect(msgs.rows.map((m: any) => m.body).join("\n")).toMatch(/Nothing waiting|approve:/);
  expect((await jordan.postJson("/channels/link", { channel: "telegram", address: "123456" })).json.linked).toBe(true);
  expect((await jordan.postJson("/channels/link", { channel: "pigeon", address: "1" })).status).toBe(422);
  expect((await anon.postJson("/webhooks/telegram", { message: { chat: { id: 123456 }, text: "pending" } })).json).toEqual({ ok: true });
  expect((await anon.postJson("/webhooks/telegram", { callback_query: { data: `${msgs.rows[0]?.id ?? "m"}:decline:x`, message: { chat: { id: 123456 } } } })).json).toEqual({ ok: true });
  expect((await anon.get("/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=1")).status).toBe(403);
  expect((await anon.get("/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=stocksure-verify&hub.challenge=abc")).text).toBe("abc");
  expect((await anon.postJson("/webhooks/whatsapp", { entry: [{ changes: [{ value: { messages: [{ type: "text", from: "6591234567", text: { body: "link buyer:" + laneway } }] } }] }] })).json).toEqual({ ok: true });

  // ---- PWA ----
  expect((await anon.get("/manifest.webmanifest")).json.name).toBe("StockSure");
  expect((await anon.get("/sw.js")).status).toBe(200);
  expect((await anon.get("/push/public-key")).status).toBe(200);
  expect((await jordan.postJson("/push/subscribe", { endpoint: "https://push.example/x", keys: { p256dh: "a", auth: "b" } })).json.subscribed).toBe(true);
  expect((await anon.postJson("/push/subscribe", { endpoint: "x" })).status).toBe(401);

  // ---- Ledger, dock ----
  expect((await jordan.get("/ledger")).text).toMatch(/Billed versus paid/);
  expect((await jordan.get("/ledger?q=which+orders+cost+more+than+quoted")).text).toMatch(/Answered by/);
  expect((await ana.get("/ledger/data.json")).json.orders.length).toBeGreaterThan(0);
  expect((await jordan.get("/ledger/export.csv")).text).toMatch(/^number,status/);
  expect((await sam.get("/dock")).text).toMatch(/Receiving dock/);
  expect((await ana.get("/dock")).status).toBe(302);
}
