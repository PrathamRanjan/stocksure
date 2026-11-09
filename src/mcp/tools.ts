/**
 * MCP tools for StockSure (roadmap S2, S4). A buyer's agent drafts, negotiates and accepts orders under the owner's
 * mandate; a supplier's agent quotes and manages its floor. Keyed by a person's StockSure key (ssk_), so every
 * call acts as a named person of a named organisation, with the agent id recorded for the trace and the kill switch.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getDb } from "../db.js";
import { newId } from "../lib/ids.js";
import { GtError } from "../lib/util.js";
import { isKilled } from "../guard/kill.js";
import { activePolicy, DEFAULT_RULES, rulesFor } from "../guard/policy.js";
import { acceptQuote, createPo, quotePo, quoteTotal, submitPo } from "../services/orders.js";
import { supplierPerformance } from "../services/records.js";
import { loadNegotiation, negotiationsFor, startNegotiation } from "../agents/runtime.js";
import { agreementFor } from "../services/agreements.js";
import { catalog, fundingOf, getPo, linesOf, type Person } from "../store.js";
import { runsFor } from "../trace.js";

const RATE = new Map<string, number[]>();
function rateLimit(key: string, perMin = 60) {
  const now = Date.now();
  const hits = (RATE.get(key) ?? []).filter((t) => now - t < 60_000);
  if (hits.length >= perMin) throw new GtError("Rate limit: 60 tool calls per minute", "rate_limited", 429);
  hits.push(now);
  RATE.set(key, hits);
}

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };
const ok = (v: unknown): ToolResult => ({ content: [{ type: "text", text: JSON.stringify(v, null, 2) }] });
const fail = (e: unknown): ToolResult => {
  const g = e instanceof GtError ? e : null;
  return { content: [{ type: "text", text: JSON.stringify({ error: g?.code ?? "error", message: (e as Error).message }) }], isError: true };
};

/** Runs a tool once per idempotency key, after the kill switch and the rate limit. */
async function run(p: Person, agentId: string, tool: string, args: Record<string, unknown>, fn: () => Promise<unknown>): Promise<ToolResult> {
  try {
    rateLimit(`${p.org_id}:${agentId}`);
    const db = await getDb();
    const killed = (await isKilled(`org:${p.org_id}`, db)) ?? (await isKilled(`agent:${agentId}`, db));
    if (killed?.engaged) throw new GtError(`Kill switch engaged (${killed.scope})${killed.reason ? `: ${killed.reason}` : ""}. Nothing runs until the owner releases it.`, "killed", 423);
    const key = typeof args.idempotency_key === "string" && args.idempotency_key ? args.idempotency_key.slice(0, 80) : null;
    if (key) {
      const prev = (await db.query<any>("SELECT ok, result FROM agent_requests WHERE org_id = $1 AND tool = $2 AND idempotency_key = $3", [p.org_id, tool, key])).rows[0];
      if (prev && prev.ok !== null) {
        const r = typeof prev.result === "string" ? JSON.parse(prev.result) : prev.result;
        return prev.ok ? ok({ ...r, replayed: true }) : fail(new GtError(r?.message ?? "Earlier call failed", r?.error ?? "error"));
      }
    }
    const id = newId("req");
    await db.query("INSERT INTO agent_requests (id, org_id, agent_id, tool, args, idempotency_key) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING", [id, p.org_id, agentId, tool, JSON.stringify(args), key]);
    try {
      const out = await fn();
      await db.query("UPDATE agent_requests SET ok = true, result = $2 WHERE id = $1", [id, JSON.stringify(out)]);
      return ok(out);
    } catch (e) {
      await db.query("UPDATE agent_requests SET ok = false, result = $2 WHERE id = $1", [id, JSON.stringify({ error: (e as GtError).code ?? "error", message: (e as Error).message })]);
      throw e;
    }
  } catch (e) {
    return fail(e);
  }
}

const money = (c: number | null | undefined) => (c === null || c === undefined ? null : (c / 100).toFixed(2));

async function orderView(p: Person, poId: string) {
  const db = await getDb();
  const po = await getPo(db, poId);
  if (po.buyer_id !== p.org_id && po.supplier_id !== p.org_id) throw new GtError("Order not found", "not_found", 404);
  const lines = await linesOf(db, po.id);
  const f = await fundingOf(db, po.root_id).catch(() => null);
  const agreement = await agreementFor(po.id).catch(() => null);
  const negs = await negotiationsFor(po.id);
  return {
    po_id: po.id,
    number: po.number,
    status: po.status,
    kind: po.kind,
    buyer: po.buyer_name,
    supplier: po.supplier_name,
    deliver_by: po.deliver_by,
    spend_limit: money(po.spend_limit_cents),
    quote_version: po.quote_version,
    accepted_quote_version: po.accepted_quote_version,
    quote_total: money(quoteTotal(lines)) ,
    lines: lines.map((l) => ({ line_id: l.id, line_no: l.line_no, sku: l.product.sku, name: l.product.name, qty_packs: l.qty_packs, pack: `${l.product.pack_label} of ${l.product.pack_units} ${l.product.base_unit}`, catalog_price: money(l.product.price_cents), quoted_price: money(l.unit_price_cents), substitutes: l.substitutes, replace_shortfall: l.replace_shortfall })),
    funding: f ? { held: money(f.held_cents), captured: money(f.captured_cents), refunded: money(f.refunded_cents), spendable_now: money(f.spendable_cents) } : null,
    agreement: agreement ? { hash: agreement.hash, buyer_signed_at: agreement.buyer_signed_at, supplier_signed_at: agreement.supplier_signed_at } : null,
    negotiations: negs.map((n: any) => ({ negotiation_id: n.id, status: n.status, round: n.round })),
    exception: po.exception,
  };
}

export function buildServer(p: Person, agentId: string): McpServer {
  const isBuyer = p.org_kind === "buyer";
  const s = new McpServer(
    { name: "stocksure", version: "0.1.0" },
    {
      instructions: isBuyer
        ? "StockSure buys stock for a small business under the owner's mandate. Read get_mandate first. Draft with draft_order, send with submit_order, then either negotiate (two agents, code-guarded) or wait for the supplier's quote and call accept_quote. Money is held on the owner's PayPal only when a quote is accepted, and captured only for what the receiver confirms. Write tools take idempotency_key; repeat it to retry safely."
        : "StockSure's supplier side. list_open_orders shows orders waiting for a quote; quote_order prices them (never below your floor); get_performance shows how buyers see you. Write tools take idempotency_key.",
    },
  );

  if (isBuyer) {
    s.registerTool(
      "get_mandate",
      { title: "Owner's mandate", description: "The limits this agent works under: per order, per day, approval threshold, whether agents may order or accept, how far above catalog a quote may go, allowed suppliers.", inputSchema: {} },
      async (args) =>
        run(p, agentId, "get_mandate", args, async () => {
          const pol = await activePolicy(p.org_id);
          return { rules: pol?.rules ?? DEFAULT_RULES, in_owner_words: pol?.text ?? null, note: "Calls outside these limits are denied before any PayPal request is made." };
        }),
    );
    s.registerTool(
      "list_suppliers",
      { title: "List suppliers", description: "Suppliers this buyer can order from, with ids for draft_order.", inputSchema: {} },
      async (args) =>
        run(p, agentId, "list_suppliers", args, async () => {
          const db = await getDb();
          const rules = await rulesFor(p.org_id);
          const rows = (await db.query<any>("SELECT id, name FROM orgs WHERE kind = 'supplier' ORDER BY name")).rows;
          return { suppliers: rows.map((r: any) => ({ supplier_id: r.id, name: r.name, allowed: !rules.allowed_suppliers.length || rules.allowed_suppliers.includes(r.id) })) };
        }),
    );
    s.registerTool(
      "list_catalog",
      { title: "Supplier catalog", description: "SKUs, pack sizes, catalog prices, stock and lead time for one supplier.", inputSchema: { supplier_id: z.string() } },
      async (args) =>
        run(p, agentId, "list_catalog", args, async () => {
          const cat = await catalog(await getDb(), args.supplier_id);
          return { items: cat.map((c) => ({ sku: c.sku, name: c.name, family: c.family, pack: `${c.pack_label} of ${c.pack_units} ${c.base_unit}`, price: money(c.price_cents), in_stock_packs: c.stock_packs, lead_hours: c.lead_hours })) };
        }),
    );
    s.registerTool(
      "get_stock",
      { title: "Our stock", description: "On-hand units from confirmed receipts, with the last move.", inputSchema: {} },
      async (args) =>
        run(p, agentId, "get_stock", args, async () => {
          const db = await getDb();
          const rows = (await db.query<any>("SELECT s.units, pr.sku, pr.name, pr.pack_units, pr.pack_label, pr.base_unit, (SELECT max(at) FROM stock_moves m WHERE m.buyer_id = s.buyer_id AND m.product_id = s.product_id) AS last FROM stock s JOIN products pr ON pr.id = s.product_id WHERE s.buyer_id = $1 ORDER BY pr.sku", [p.org_id])).rows;
          return { stock: rows.map((r: any) => ({ sku: r.sku, name: r.name, units: r.units, packs_equivalent: Math.floor(r.units / r.pack_units), unit: r.base_unit, last_move: r.last })) };
        }),
    );
    s.registerTool(
      "draft_order",
      {
        title: "Draft an order",
        description: "Create a draft purchase order with the given lines (by SKU) and a spending limit that also covers replacements. Needs the mandate's agents_may_order. Nothing is sent or held yet.",
        inputSchema: {
          supplier_id: z.string(),
          lines: z.array(z.object({ sku: z.string(), qty_packs: z.number().int().positive(), substitutes: z.array(z.string()).optional(), replace_shortfall: z.boolean().optional() })).min(1).max(40),
          deliver_by: z.string().describe("ISO date-time"),
          spend_limit: z.string().describe("Dollars, e.g. '210.00'"),
          note: z.string().max(200).optional(),
          idempotency_key: z.string().max(80).optional(),
        },
      },
      async (args) =>
        run(p, agentId, "draft_order", args, async () => {
          const rules = await rulesFor(p.org_id);
          if (!rules.agents_may_order) throw new GtError("The owner's mandate does not let agents order; ask your user to order from the app or change the mandate", "policy_denied", 403);
          if (rules.allowed_suppliers.length && !rules.allowed_suppliers.includes(args.supplier_id)) throw new GtError("Supplier is not on the mandate's allowed list", "policy_denied", 403);
          const limit = Math.round(Number(args.spend_limit) * 100);
          if (!Number.isInteger(limit) || limit <= 0) throw new GtError("spend_limit must be a positive dollar amount", "validation", 422);
          if (limit > rules.max_order_cents) throw new GtError(`spend_limit ${money(limit)} is above the mandate's per-order limit ${money(rules.max_order_cents)}`, "policy_denied", 403);
          const db = await getDb();
          const cat = await catalog(db, args.supplier_id);
          const bySku = new Map(cat.map((c) => [c.sku, c]));
          const lines = args.lines.map((l) => {
            const prod = bySku.get(l.sku);
            if (!prod) throw new GtError(`SKU ${l.sku} is not in this supplier's catalog`, "validation", 422);
            return { product_id: prod.id, qty_packs: l.qty_packs, substitutes: (l.substitutes ?? []).map((s) => bySku.get(s)?.id).filter((x): x is string => Boolean(x)), replace_shortfall: l.replace_shortfall ?? true };
          });
          const owner: Person = p.role === "owner" ? p : { ...p, role: "owner" };
          const poId = await createPo(owner, { supplier_id: args.supplier_id, lines, deliver_by: new Date(args.deliver_by), spend_limit_cents: limit, note: args.note });
          await db.query("UPDATE purchase_orders SET created_by_agent = $2 WHERE id = $1", [poId, agentId]);
          return { po_id: poId, status: "draft", next_step: "Call submit_order, then negotiate or wait for the supplier's quote." };
        }),
    );
    s.registerTool(
      "submit_order",
      { title: "Send the order", description: "Send a draft to the supplier for a quote.", inputSchema: { po_id: z.string(), idempotency_key: z.string().max(80).optional() } },
      async (args) =>
        run(p, agentId, "submit_order", args, async () => {
          const owner: Person = p.role === "owner" ? p : { ...p, role: "owner" };
          await submitPo(owner, args.po_id);
          return { po_id: args.po_id, status: "submitted" };
        }),
    );
    s.registerTool(
      "negotiate",
      { title: "Negotiate the price", description: "Start a code-guarded negotiation between this agent and the supplier's agent over a submitted order. Rounds run in the background; poll get_negotiation. On agreement the quote is recorded and, if the mandate allows agents to accept, the hold is placed.", inputSchema: { po_id: z.string(), idempotency_key: z.string().max(80).optional() } },
      async (args) =>
        run(p, agentId, "negotiate", args, async () => {
          const id = await startNegotiation(args.po_id, { buyerAgent: agentId });
          return { negotiation_id: id, status: "open", poll: "get_negotiation" };
        }),
    );
    s.registerTool(
      "get_negotiation",
      { title: "Negotiation state", description: "Rounds so far, each side's offer, what the guards did, the outcome.", inputSchema: { negotiation_id: z.string() } },
      async (args) =>
        run(p, agentId, "get_negotiation", args, async () => {
          const n = await loadNegotiation(args.negotiation_id);
          if (!n) throw new GtError("Negotiation not found", "not_found", 404);
          const po = await getPo(await getDb(), n.po_id);
          if (po.buyer_id !== p.org_id) throw new GtError("Negotiation not found", "not_found", 404);
          return { negotiation_id: n.id, po_id: n.po_id, status: n.status, round: n.round, max_rounds: n.max_rounds, outcome: n.outcome, rounds: n.rounds.map((r: any) => ({ round: r.round, side: r.side, total: money(Object.values(r.proposal as Record<string, number>).reduce((a, b) => a + b, 0)), guard: r.guard, accepted: r.accepted, said: r.wording })), trace_run_id: n.run_id };
        }),
    );
    s.registerTool(
      "accept_quote",
      { title: "Accept a quote", description: "Accept quote version N: signs the agreement for the buyer and places the PayPal hold through the gate (kill switch, mandate, provenance, live PayPal state). Needs agents_may_accept and the quote inside max_over_catalog_pct.", inputSchema: { po_id: z.string(), version: z.number().int().positive(), idempotency_key: z.string().max(80).optional() } },
      async (args) =>
        run(p, agentId, "accept_quote", args, async () => {
          const rules = await rulesFor(p.org_id);
          if (!rules.agents_may_accept) throw new GtError("The owner's mandate does not let agents accept quotes; ask your user to accept in the app", "policy_denied", 403);
          const db = await getDb();
          const lines = await linesOf(db, args.po_id);
          const quoted = quoteTotal(lines);
          const cat = lines.reduce((a, l) => a + l.qty_packs * l.product.price_cents, 0);
          const over = cat ? ((quoted - cat) / cat) * 100 : 0;
          if (over > rules.max_over_catalog_pct) throw new GtError(`Quote is ${over.toFixed(1)}% above catalog; the mandate allows ${rules.max_over_catalog_pct}%`, "policy_denied", 403);
          const owner: Person = p.role === "owner" ? p : { ...p, role: "owner" };
          await acceptQuote(owner, args.po_id, args.version, { agentId });
          const po = await getPo(db, args.po_id);
          return { po_id: po.id, status: po.status, note: po.status === "funded" ? "Hold placed." : po.status === "funding" ? "Hold pending; PayPal has not confirmed yet." : `Order is ${po.status}${po.exception ? `: ${po.exception}` : ""}` };
        }),
    );
    s.registerTool(
      "list_orders",
      { title: "List orders", description: "This buyer's orders with status and quote total.", inputSchema: { status: z.string().optional() } },
      async (args) =>
        run(p, agentId, "list_orders", args, async () => {
          const db = await getDb();
          const rows = (await db.query<any>("SELECT id FROM purchase_orders WHERE buyer_id = $1 AND ($2::text IS NULL OR status = $2) ORDER BY created_at DESC LIMIT 50", [p.org_id, args.status ?? null])).rows;
          const out = [];
          for (const r of rows) {
            const po = await getPo(db, r.id);
            out.push({ po_id: po.id, number: po.number, status: po.status, supplier: po.supplier_name, deliver_by: po.deliver_by, quote_total: money(quoteTotal(await linesOf(db, po.id))), spend_limit: money(po.spend_limit_cents) });
          }
          return { orders: out };
        }),
    );
  } else {
    s.registerTool(
      "list_open_orders",
      { title: "Orders waiting for you", description: "Submitted orders without a quote, and quoted orders not yet accepted.", inputSchema: {} },
      async (args) =>
        run(p, agentId, "list_open_orders", args, async () => {
          const db = await getDb();
          const rows = (await db.query<any>("SELECT id FROM purchase_orders WHERE supplier_id = $1 AND status IN ('submitted','quoted','funded') ORDER BY deliver_by LIMIT 50", [p.org_id])).rows;
          const out = [];
          for (const r of rows) out.push(await orderView(p, r.id));
          return { orders: out };
        }),
    );
    s.registerTool(
      "quote_order",
      { title: "Quote an order", description: "Price each line in dollars per pack (by line_id). Lines left out keep the catalog price. Never below your floor (see /disputes).", inputSchema: { po_id: z.string(), prices: z.record(z.string(), z.string()), idempotency_key: z.string().max(80).optional() } },
      async (args) =>
        run(p, agentId, "quote_order", args, async () => {
          const db = await getDb();
          const floor = (await db.query<{ floor_pct: number }>("SELECT coalesce(floor_pct, 90) AS floor_pct FROM orgs WHERE id = $1", [p.org_id])).rows[0]?.floor_pct ?? 90;
          const lines = await linesOf(db, args.po_id);
          const prices: Record<string, number> = {};
          for (const [lineId, dollars] of Object.entries(args.prices)) {
            const l = lines.find((x) => x.id === lineId);
            if (!l) throw new GtError(`Unknown line_id ${lineId}`, "validation", 422);
            const c = Math.round(Number(dollars) * 100);
            if (!Number.isInteger(c) || c < 0) throw new GtError(`Price for ${lineId} is not valid`, "validation", 422);
            if (c < Math.round((l.product.price_cents * floor) / 100)) throw new GtError(`Price for ${l.product.sku} is below your floor (${floor}% of catalog)`, "floor", 422);
            prices[lineId] = c;
          }
          const supplier: Person = p.role === "supplier" ? p : { ...p, role: "supplier" };
          await quotePo(supplier, args.po_id, prices);
          return await orderView(p, args.po_id);
        }),
    );
    s.registerTool(
      "get_performance",
      { title: "Your performance", description: "On-time, fill rate, damage, disputes, invoice accuracy as buyers see them.", inputSchema: { buyer_id: z.string().optional() } },
      async (args) => run(p, agentId, "get_performance", args, async () => supplierPerformance(await getDb(), p.org_id, args.buyer_id)),
    );
    s.registerTool(
      "set_floor",
      { title: "Set the negotiation floor", description: "Your agent never quotes below this percentage of catalog.", inputSchema: { floor_pct: z.number().int().min(50).max(100), idempotency_key: z.string().max(80).optional() } },
      async (args) =>
        run(p, agentId, "set_floor", args, async () => {
          await (await getDb()).query("UPDATE orgs SET floor_pct = $2 WHERE id = $1", [p.org_id, args.floor_pct]);
          return { floor_pct: args.floor_pct };
        }),
    );
  }

  s.registerTool(
    "get_order",
    { title: "Get order", description: "Lines, quote, funding (held, captured, refunded), agreement hash, negotiations.", inputSchema: { po_id: z.string() } },
    async (args) => run(p, agentId, "get_order", args, async () => orderView(p, args.po_id)),
  );
  s.registerTool(
    "get_trace",
    { title: "Agent runs on an order", description: "Every traced run (hold, capture, refund, negotiation) on this order with gate decisions and PayPal request ids.", inputSchema: { po_id: z.string() } },
    async (args) =>
      run(p, agentId, "get_trace", args, async () => {
        await orderView(p, args.po_id);
        return { runs: await runsFor("po", args.po_id, 20) };
      }),
  );
  return s;
}
