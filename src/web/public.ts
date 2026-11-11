/**
 * Spec A3: the judge page and the pages that need no sign-in.
 *
 *   /api/public/judge   paths with self-ticking steps for the visitor's own demo, the live-versus-simulated table
 *                       (built from this server's configuration at request time), the sandbox accounts and the QR.
 *   /api/public/ai      the last 20 model calls in the showcase demo.
 *   /api/public/paypal  every PayPal API this app calls, when, and a live id from the showcase demo for each.
 *   /api/public/mcp     how an outside assistant connects, and the tools it gets.
 *   /api/public/proof   evaluation results with every case (src/eval/proof.ts).
 *
 * Read-only. The showcase is a demo workspace rebuilt daily through the real order path.
 */
import { Router, type Request, type Response } from "express";
import { config } from "../config.js";
import { currentWs, getDb, withWorkspace, type Queryable } from "../db.js";
import { showcase } from "../demo/workspaces.js";
import { walletInfo } from "../demo/wallet.js";
import { workspaceOf } from "../demo/routes.js";
import { hasOpenAI } from "../ai/provider.js";
import { READ_TOOLS } from "../ai/paypal-mcp.js";
import { AGENT_TOOLS } from "../ai/agent-tools.js";
import { TEN_NOV } from "../eval/scam-cases.js";
import { demoIds } from "../services/seed.js";
import { setting } from "../store.js";
import { proofView } from "../eval/proof.js";
import { me } from "./auth.js";

const wrap = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response) =>
  fn(req, res)
    .then((out) => {
      if (!res.headersSent) res.setHeader("Cache-Control", "no-store").json(out);
    })
    .catch((e) => {
      console.error("[stocksure public]", (e as Error).message);
      if (!res.headersSent) res.status(500).json({ error: "error", message: "This page couldn't load its data. Try again." });
    });

async function inShowcaseWs<T>(fn: (db: Queryable, wsId: string | null) => Promise<T>): Promise<{ from: "showcase" | "none"; data: T | null; built_at: string | null }> {
  const s = await showcase();
  if (!s) return { from: "none", data: null, built_at: null };
  const db = await getDb();
  return { from: "showcase", data: await withWorkspace(s.id, () => fn(db, s.id)), built_at: new Date(s.created_at).toISOString() };
}

/** Spec A3.1: generated from this server's settings, so it cannot drift from what actually runs. */
export async function liveTable() {
  const pp = !!(config.paypal.clientId && config.paypal.clientSecret);
  const w = await walletInfo().catch(() => null);
  const ai = hasOpenAI();
  const sim = (on: boolean, live: string, off: string) => ({ state: on ? "live" : "simulated", detail: on ? live : off });
  return [
    { area: "PayPal holds, captures, voids, reauthorizations (Orders v2, Payments v2)", ...sim(pp, `PayPal ${config.paypal.env}; every write carries a PayPal-Request-Id and is read back`, "no PayPal credentials: nothing can be held or charged") },
    { area: "PayPal refunds", ...sim(pp, `PayPal ${config.paypal.env}, on credits after a capture`, "off") },
    { area: "Saved demo wallet (Vault payment token)", state: w ? (w.status === "ok" || w.status === "unchecked" ? "live" : "not working") : "off", detail: w ? `sandbox buyer wallet, status ${w.status}${w.checkedAt ? `, checked with PayPal ${new Date(w.checkedAt).toISOString().slice(0, 10)}` : ""}` : "not configured: buyers approve on PayPal's own page" },
    { area: "PayPal webhooks", ...sim(!!config.paypal.webhookId, "signature verified with PayPal, then the resource is read back", "no webhook id: state comes from read-backs only") },
    { area: "PayPal disputes, tracking, invoicing", ...sim(pp, `PayPal ${config.paypal.env}`, "off") },
    { area: "PayPal's MCP server (agent reads)", ...sim(pp && !!config.ai.paypalMcpUrl && config.paypal.env === "sandbox", `${config.ai.paypalMcpUrl}, ${READ_TOOLS.length} read tools; no write tool is offered`, "off") },
    { area: "Reading delivery notes, invoices and photos", ...sim(ai, `OpenAI ${config.ai.models.read} (backup ${config.ai.models.readBackup}); a person confirms every count`, "no model: the page says it couldn't read it and offers the form") },
    { area: "Scam check, second reader", ...sim(ai, `OpenAI Decisions ${config.ai.models.decide}, thresholds set in code from a labelled set`, "no model: nothing is marked safe") },
    { area: "Ask (agent with tools)", ...sim(ai, `OpenAI ${config.ai.models.agent}, at most ${config.ai.agentMaxSteps} steps and ${Math.round(config.ai.agentMaxMs / 1000)} s, ${config.ai.agentDailyQuestions} questions a day per demo`, "off") },
    { area: "Scam check, on-device model", state: "live", detail: "MiniLM text model, int8 ONNX, runs in your browser; trained on public scam message sets" },
    { area: "Payment-risk model", state: "live (synthetic training data)", detail: "LightGBM trained on synthetic payments; a ranking signal next to the rule reasons, never a fraud rate" },
    { area: "Telegram alerts", ...sim(!!config.channels.telegramToken, `bot @${config.channels.telegramBot}`, "in-app simulator: messages show on the Phone alerts page, nothing is sent") },
    { area: "WhatsApp alerts", ...sim(!!config.channels.whatsappToken, "WhatsApp Cloud API", "in-app simulator") },
    { area: "Web push", ...sim(!!(config.channels.vapidPublic && config.channels.vapidPrivate), "VAPID web push", "off") },
    { area: "Phone calls", state: "not built", detail: "StockSure has no phone channel" },
    { area: "Sample history", state: "sample", detail: "older closed orders in each demo are marked Sample; they never touched PayPal and are left out of every PayPal figure" },
  ];
}

/** The judge's paths. A step's `done` comes from the workspace checklist the server ticks (src/demo/checklist.ts). */
async function paths(db: Queryable, checklist: Record<string, string>) {
  const ids = await demoIds(db);
  const pick = async (sql: string, args: unknown[] = []) => (await db.query<{ id: string; number: string }>(sql, args)).rows[0] ?? null;
  const toCount = ids ? await pick("SELECT id, number FROM purchase_orders WHERE buyer_id = $1 AND status = 'dispatched' AND kind = 'original' AND NOT is_sample ORDER BY created_at LIMIT 1", [ids.laneway]) : null;
  const flow = ids ? await pick("SELECT id, number FROM purchase_orders WHERE buyer_id = $1 AND NOT is_sample AND kind = 'original' AND status NOT IN ('closed','cancelled') ORDER BY CASE status WHEN 'dispatched' THEN 0 WHEN 'in_review' THEN 1 WHEN 'resolving' THEN 2 ELSE 3 END, created_at LIMIT 1", [ids.laneway]) : null;
  // Once the visitor has counted an order, every path keeps pointing at that order (the seed's own counts come earlier).
  const counted = ids && checklist.counted ? await pick("SELECT p.id, p.number FROM receipts r JOIN purchase_orders p ON p.id = r.po_id WHERE p.buyer_id = $1 AND p.kind = 'original' AND NOT p.is_sample AND r.created_at >= $2::timestamptz - interval '1 minute' ORDER BY r.created_at LIMIT 1", [ids.laneway, checklist.counted]) : null;
  const order = counted ?? toCount ?? flow;
  const people = ids?.people ?? {};
  const s = (key: string, title: string, as: string | null, to: string, help: string, done: string[] = [key]) => ({ key, title, as, person_id: as ? people[as] ?? null : null, to, help, done: done.some((k) => !!checklist[k]), done_at: done.map((k) => checklist[k]).find(Boolean) ?? null });
  const po = order ? `/po/${order.id}` : "/home";
  return [
    {
      id: "short",
      title: "A short delivery, paid for exactly",
      minutes: 3,
      paypal_login: false,
      note: order ? `Uses ${order.number}, already held on PayPal from the demo's saved sandbox wallet.` : "This demo has no order left to count. Reset your demo on the demo page.",
      steps: [
        s("counted", "Count it in as Sam: load a sample delivery note (one has two crushed cases), tick that you checked the goods, confirm", "sam", order ? `${po}/receive` : "/home", "The model proposes counts from the paperwork; Sam confirms them. Nothing is paid from the paper."),
        s("supplier_agreed", "As Ana, the wholesaler: agree the count, then approve the fix", "ana", po, "Code works out the fix from the quote and the confirmed counts: credit what's missing, or a replacement inside the limit."),
        s("resolution_approved", "As Jordan: approve the same fix", "jordan", `${po}#resolution`, "Both sides sign the same fingerprinted version; then PayPal is asked to capture."),
        s("captured", "Watch PayPal capture what arrived and release the rest", "jordan", `${po}#paypal-ops`, "Each PayPal id on the page can be looked up in the sandbox.", ["captured", "released"]),
      ],
    },
    {
      id: "scam",
      title: "Catch a bank-change scam",
      minutes: 1,
      paypal_login: false,
      note: "The message from the 10 Nov review: polite, no threats, a new PayPal at an outlook.com address.",
      steps: [
        s("scam_flagged", "Post the bank-change message on an order as Ana", "ana", order ? `${po}?say=${encodeURIComponent(TEN_NOV)}#messages` : "/home", "The message is checked as it arrives: rules, OpenAI Decisions, and the payment destination compared with the supplier's details on file."),
        s("scam_checked", "Paste it into the scam check as Jordan and see all four readers", "jordan", `/safety?demo=1#check`, "Nothing can show green for a message that names somewhere to pay."),
      ],
    },
    {
      id: "ask",
      title: "Ask the AI, and watch it work",
      minutes: 1,
      paypal_login: false,
      note: "Each tool call shows on the AI work rail as it runs. No tool can move money.",
      steps: [
        s("ai_asked", "Ask which supplier short-delivers most, as Jordan", "jordan", `/ask?q=${encodeURIComponent("Which supplier short-delivers most, and what did it cost?")}`, "The answer's sentences link to the tool calls they rest on."),
        s("ai_paypal", "Ask what you've been charged, with PayPal ids", "jordan", `/ask?q=${encodeURIComponent("What have I been charged so far, with the PayPal ids?")}`, "Reads come from StockSure's records and PayPal's own MCP server (read tools only)."),
        s("ai_drafted", "Ask it to draft a note to the supplier", "jordan", `/ask?q=${encodeURIComponent(order ? `Draft a short note to Harbour about ${order.number} asking when the missing cases will arrive.` : "Draft a short note to Harbour asking when my next delivery arrives.")}`, "A draft only: you send it yourself, or don't."),
      ],
    },
  ];
}

export function publicRouter() {
  const r = Router();

  r.get("/api/public/judge", wrap(async (req) => {
    const w = workspaceOf(req);
    const mine = w && w.kind === "visitor" ? w : null;
    const db = await getDb();
    const checklist = mine ? ((await withWorkspace(null, async () => (await db.query<{ checklist: any }>("SELECT checklist FROM workspaces WHERE id = $1", [mine.id])).rows[0]?.checklist)) ?? {}) : {};
    const wallet = await walletInfo().catch(() => null);
    const p = await me(req).catch(() => null);
    return {
      workspace: mine ? { id: mine.id, state: mine.seed_state, join_qr: "/demo/join.svg", join_url: `${config.appUrl}/demo/join/${mine.join_token}` } : null,
      signed_in: p ? { name: p.name, role: p.role } : null,
      accounts: {
        wallet: wallet ? { payer: wallet.payer || "the demo's saved sandbox buyer", note: "Holds and captures in your demo are paid from this saved sandbox wallet: no PayPal login needed." } : null,
        judge_buyer: null as null | { email: string },
        judge_buyer_note: "A separate sandbox buyer login for judges who want to connect their own PayPal has not been published yet; the no-login paths below cover every PayPal step.",
      },
      paths: mine ? await paths(db, typeof checklist === "string" ? JSON.parse(checklist) : checklist) : [],
      live: await liveTable(),
      pages: [
        { to: "/proof", title: "Proof", what: "Every evaluation case: input, expected, the model's answer, pass or fail, model ids and date" },
        { to: "/ai", title: "AI calls", what: "The last 20 model calls in the showcase demo, with latency and cost" },
        { to: "/paypal", title: "PayPal APIs", what: "Every PayPal API StockSure calls, when, with a live sandbox id" },
        { to: "/who-can-move-money", title: "Who can move money", what: "Owner, receiver, supplier, each model, outside agents: can and cannot" },
        { to: "/accessibility", title: "Accessibility", what: "What was tested, how, and what was not" },
        { to: "/agents", title: "Agents and MCP", what: "How an outside assistant connects, with a copy-paste command" },
      ],
      repo: { url: "https://github.com/PrathamRanjan/stocksure", public: false },
    };
  }));

  r.get("/api/public/ai", wrap(async () => {
    const out = await inShowcaseWs(async (db) => {
      const calls = (await db.query<any>("SELECT id, purpose, model, via, tokens_in, tokens_out, cost_usd, latency_ms, ok, output, run_id, at FROM ai_calls ORDER BY id DESC LIMIT 20")).rows;
      const runs = [...new Set(calls.map((c) => c.run_id).filter(Boolean))];
      const steps = runs.length ? (await db.query<any>("SELECT run_id, step, actor, tool, duration_ms FROM agent_trace WHERE run_id = ANY($1) ORDER BY run_id, step", [runs])).rows : [];
      return calls.map((c) => ({ id: Number(c.id), purpose: c.purpose, model: c.model, via: c.via, ok: c.ok, tokens_in: c.tokens_in, tokens_out: c.tokens_out, cost_usd: Number(c.cost_usd), latency_ms: c.latency_ms, at: c.at, output: summarize(c.output), tools: steps.filter((s) => s.run_id === c.run_id).map((s) => `${s.tool} (${s.duration_ms ?? 0} ms)`) }));
    });
    return { ...out, note: "Inputs are not stored (only their hash), so a delivery note or message never sits in this log; outputs are the structured answers." };
  }));

  r.get("/api/public/paypal", wrap(async () => {
    const out = await inShowcaseWs(async (db) => {
      const op = async (kind: string) => (await db.query<any>("SELECT paypal_id, paypal_order_id, paypal_status, amount_cents, created_at FROM payment_ops WHERE kind = $1 AND status = 'succeeded' AND paypal_id IS NOT NULL ORDER BY created_at DESC LIMIT 1", [kind])).rows[0] ?? null;
      const auth = await op("authorize");
      const cap = await op("capture");
      const voided = await op("void");
      const reauth = await op("reauthorize");
      const refund = await op("refund");
      const inv = (await db.query<any>("SELECT paypal_invoice_id FROM purchase_orders WHERE paypal_invoice_id IS NOT NULL LIMIT 1")).rows[0]?.paypal_invoice_id ?? null;
      const track = (await db.query<any>("SELECT tracking_number FROM shipments WHERE tracking_number IS NOT NULL LIMIT 1")).rows[0]?.tracking_number ?? null;
      const dispute = (await db.query<any>("SELECT dispute_id FROM purchase_orders WHERE dispute_id IS NOT NULL LIMIT 1")).rows[0]?.dispute_id ?? null;
      return [
        { api: "OAuth 2.0 client credentials", call: "POST /v1/oauth2/token", when: "Before any call; the token is cached until it expires", id: null },
        { api: "Vault: setup and payment tokens", call: "POST /v3/vault/setup-tokens, /v3/vault/payment-tokens, GET /v3/vault/payment-tokens/{id}", when: "Once, when a buyer saves PayPal (or the owner re-approves the demo wallet); the demo wallet is checked daily", id: null, note: "The demo wallet's token id is not shown" },
        { api: "Orders v2: create with a saved payment token, intent AUTHORIZE", call: "POST /v2/checkout/orders", when: "The buyer accepts a quote: a hold for the quote total", id: auth?.paypal_order_id ?? null },
        { api: "Payments v2: authorization", call: "POST /v2/checkout/orders/{id}/authorize, GET /v2/payments/authorizations/{id}", when: "The hold; read back after every change", id: auth?.paypal_id ?? null, status: auth?.paypal_status ?? null },
        { api: "Payments v2: capture", call: "POST /v2/payments/authorizations/{id}/capture, GET /v2/payments/captures/{id}", when: "Both sides agreed what arrived: only that amount is captured, the last capture marked final", id: cap?.paypal_id ?? null },
        { api: "Payments v2: void", call: "POST /v2/payments/authorizations/{id}/void", when: "An order is cancelled, or a hold is no longer needed", id: voided?.paypal_id ?? voided?.paypal_order_id ?? null },
        { api: "Payments v2: reauthorize", call: "POST /v2/payments/authorizations/{id}/reauthorize", when: "A hold passes PayPal's 3-day honor period before capture", id: reauth?.paypal_id ?? null },
        { api: "Payments v2: refund", call: "POST /v2/payments/captures/{id}/refund, GET /v2/payments/refunds/{id}", when: "A credit after a capture (damage found later)", id: refund?.paypal_id ?? null },
        { api: "Orders v2: tracking", call: "POST /v2/checkout/orders/{id}/track", when: "The supplier dispatches with a tracking number", id: track },
        { api: "Invoicing v2", call: "POST /v2/invoicing/invoices, /send", when: "The supplier sends the agreed settlement as a PayPal invoice record", id: inv },
        { api: "Disputes v1", call: "GET /v1/customer/disputes, POST provide-evidence, accept-claim", when: "A PayPal dispute is opened on a capture", id: dispute },
        { api: "Transaction search v1", call: "GET /v1/reporting/transactions", when: "The ledger reconciles StockSure's records against PayPal", id: null },
        { api: "Webhooks v1", call: "POST /v1/notifications/verify-webhook-signature", when: "Every webhook, before it is acted on; the resource is then read back", id: null },
        { api: "PayPal MCP server (sandbox)", call: `${config.ai.paypalMcpUrl || "off"}: ${READ_TOOLS.join(", ")}`, when: "The Ask agent's read tools; no write tool is offered", id: null },
      ];
    });
    return out;
  }));

  r.get("/api/public/mcp", wrap(async (req) => {
    const w = workspaceOf(req);
    let key: string | null = null;
    if (w && w.kind === "visitor") {
      const db = await getDb();
      const keys = await setting(db, "demo_keys");
      key = keys ? JSON.parse(keys).jordan ?? null : null;
    }
    return {
      endpoint: `${config.appUrl}/mcp`,
      transport: "Streamable HTTP (stateless), POST",
      auth: "Authorization: Bearer <StockSure key>. Each key acts as one named person in one demo.",
      key,
      key_note: key ? "This is Jordan's key in your own demo. It works only in your demo and closes with it." : "Start a demo to get a key of your own.",
      command: `claude mcp add --transport http stocksure ${config.appUrl}/mcp --header "Authorization: Bearer ${key ?? "<your ssk_ key>"}"`,
      tools_outside: {
        buyer: ["get_mandate", "list_suppliers", "list_catalog", "get_stock", "draft_order", "submit_order", "negotiate", "get_negotiation", "accept_quote", "list_orders", "get_order", "get_trace"],
        supplier: ["list_open_orders", "quote_order", "get_performance", "set_floor", "get_order", "get_trace"],
      },
      tools_outside_note: "A buyer's agent can draft, submit, negotiate and accept orders inside the owner's mandate (read it with get_mandate). Accepting places a PayPal hold for the quote total; no tool captures, refunds or names a payee. A supplier's agent can quote, never below its floor.",
      agent_tools: AGENT_TOOLS.map((t) => ({ name: t.name, kind: t.kind, what: t.description })),
      paypal_read_tools: READ_TOOLS,
      ws: currentWs(),
    };
  }));

  r.get("/api/public/proof", wrap(async () => proofView()));

  return r;
}

function summarize(o: unknown): string {
  if (!o) return "";
  const v = typeof o === "string" ? JSON.parse(o) : o;
  const s = JSON.stringify(v);
  return s.length > 300 ? s.slice(0, 300) + "…" : s;
}
