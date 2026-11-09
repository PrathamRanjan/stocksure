/**
 * Merchant endpoint for shopping agents (roadmap S2), shaped like a Cart API: open a cart against a supplier,
 * add items by SKU, read a quote that says what the buyer's mandate would do, then check out into a purchase
 * order. Keyed by the buyer's StockSure key (ssk_). Nothing here touches PayPal: checkout drafts and submits
 * the order; the hold is placed when a quote is accepted, through the same gate as every other order.
 */
import { Router, type Request } from "express";
import { getDb } from "../db.js";
import { newId } from "../lib/ids.js";
import { GtError } from "../lib/util.js";
import { isKilled } from "../guard/kill.js";
import { rulesFor } from "../guard/policy.js";
import { createPo, submitPo } from "../services/orders.js";
import { catalog, type Person } from "../store.js";
import { agentIdOf } from "../mcp/http.js";
import { personByKey } from "./auth.js";
import { json } from "./common.js";

async function buyerFromBearer(req: Request): Promise<Person> {
  const m = /^Bearer\s+(\S+)$/i.exec(req.header("authorization") ?? "");
  const p = m ? await personByKey(m[1]) : null;
  if (!p) throw new GtError("Authorization: Bearer <ssk_ key> required", "unauthorized", 401);
  if (p.org_kind !== "buyer") throw new GtError("The merchant endpoint is for buyer keys", "forbidden", 403);
  const k = await isKilled(`org:${p.org_id}`);
  if (k?.engaged) throw new GtError(`Kill switch engaged for this organisation${k.reason ? `: ${k.reason}` : ""}`, "killed", 423);
  return p;
}

async function loadCart(id: string, buyerId: string) {
  const db = await getDb();
  const c = (await db.query<any>("SELECT * FROM carts WHERE id = $1 AND buyer_id = $2", [id, buyerId])).rows[0];
  if (!c) throw new GtError("Cart not found", "not_found", 404);
  return c;
}

async function quoteCart(c: any) {
  const db = await getDb();
  const cat = await catalog(db, c.supplier_id);
  const bySku = new Map(cat.map((p) => [p.sku, p]));
  const lines = (c.items as any[]).map((it) => {
    const p = bySku.get(it.sku);
    if (!p) return { sku: it.sku, qty_packs: it.qty_packs, error: "not in this supplier's catalog" };
    return { sku: p.sku, product_id: p.id, name: p.name, pack: `${p.pack_label} of ${p.pack_units} ${p.base_unit}`, qty_packs: it.qty_packs, unit_price_cents: p.price_cents, line_cents: p.price_cents * it.qty_packs, in_stock_packs: p.stock_packs, lead_hours: p.lead_hours };
  });
  const total = lines.reduce((a, l: any) => a + (l.line_cents ?? 0), 0);
  const rules = await rulesFor(c.buyer_id);
  const mandate = !rules.agents_may_order ? { outcome: "deny", reason: "the owner's mandate does not let agents order" } : total > rules.max_order_cents ? { outcome: "deny", reason: `total ${total} cents is above the per-order limit of ${rules.max_order_cents}` } : rules.allowed_suppliers.length && !rules.allowed_suppliers.includes(c.supplier_id) ? { outcome: "deny", reason: "supplier is not on the allowed list" } : total > rules.approve_above_cents ? { outcome: "wait", reason: `charges above ${rules.approve_above_cents} cents wait for the owner before capture` } : { outcome: "run", reason: "inside the mandate" };
  return { lines, total_cents: total, currency: "USD", mandate, catalog_prices: true, note: "Prices are catalog prices. The supplier quotes after submit; the buyer's agent or owner accepts, and only then is a hold placed." };
}

export function merchantRouter() {
  const r = Router();

  r.post(
    "/api/merchant/carts",
    json(async (req) => {
      const p = await buyerFromBearer(req);
      const supplierId = String(req.body?.supplier_id ?? "");
      const db = await getDb();
      const sup = (await db.query<{ id: string; name: string }>("SELECT id, name FROM orgs WHERE id = $1 AND kind = 'supplier'", [supplierId])).rows[0];
      if (!sup) throw new GtError("supplier_id must name a supplier (GET /api/merchant/suppliers)", "validation", 422);
      const id = newId("cart");
      await db.query("INSERT INTO carts (id, buyer_id, supplier_id, agent_id, status, items) VALUES ($1,$2,$3,$4,'open','[]')", [id, p.org_id, sup.id, agentIdOf(req)]);
      return { cart_id: id, supplier: sup.name, status: "open", next: `POST /api/merchant/carts/${id}/items {sku, qty_packs}` };
    }),
  );

  r.get(
    "/api/merchant/suppliers",
    json(async (req) => {
      await buyerFromBearer(req);
      const db = await getDb();
      const rows = (await db.query<any>("SELECT id, name FROM orgs WHERE kind = 'supplier' ORDER BY name")).rows;
      return { suppliers: rows };
    }),
  );

  r.get(
    "/api/merchant/suppliers/:id/catalog",
    json(async (req) => {
      await buyerFromBearer(req);
      const cat = await catalog(await getDb(), req.params.id);
      return { items: cat.map((p) => ({ sku: p.sku, name: p.name, family: p.family, pack: `${p.pack_label} of ${p.pack_units} ${p.base_unit}`, price_cents: p.price_cents, in_stock_packs: p.stock_packs, lead_hours: p.lead_hours })) };
    }),
  );

  r.post(
    "/api/merchant/carts/:id/items",
    json(async (req) => {
      const p = await buyerFromBearer(req);
      const c = await loadCart(req.params.id, p.org_id);
      if (c.status !== "open") throw new GtError(`Cart is ${c.status}`, "bad_state", 409);
      const sku = String(req.body?.sku ?? "").trim();
      const qty = Number(req.body?.qty_packs);
      if (!sku || !Number.isInteger(qty) || qty <= 0 || qty > 10000) throw new GtError("sku and a whole qty_packs between 1 and 10000", "validation", 422);
      const items = (c.items as any[]).filter((x) => x.sku !== sku).concat([{ sku, qty_packs: qty }]);
      await (await getDb()).query("UPDATE carts SET items = $2, updated_at = now() WHERE id = $1", [c.id, JSON.stringify(items)]);
      return { cart_id: c.id, items, quote: await quoteCart({ ...c, items }) };
    }),
  );

  r.delete(
    "/api/merchant/carts/:id/items/:sku",
    json(async (req) => {
      const p = await buyerFromBearer(req);
      const c = await loadCart(req.params.id, p.org_id);
      const items = (c.items as any[]).filter((x) => x.sku !== req.params.sku);
      await (await getDb()).query("UPDATE carts SET items = $2, updated_at = now() WHERE id = $1", [c.id, JSON.stringify(items)]);
      return { cart_id: c.id, items };
    }),
  );

  r.get(
    "/api/merchant/carts/:id",
    json(async (req) => {
      const p = await buyerFromBearer(req);
      const c = await loadCart(req.params.id, p.org_id);
      const quote = await quoteCart(c);
      await (await getDb()).query("UPDATE carts SET quote = $2, status = CASE WHEN status = 'open' AND $3::int > 0 THEN 'quoted' ELSE status END, updated_at = now() WHERE id = $1", [c.id, JSON.stringify(quote), (c.items as any[]).length]);
      return { cart_id: c.id, status: c.status, supplier_id: c.supplier_id, items: c.items, quote, po_id: c.po_id };
    }),
  );

  r.post(
    "/api/merchant/carts/:id/checkout",
    json(async (req) => {
      const p = await buyerFromBearer(req);
      const c = await loadCart(req.params.id, p.org_id);
      if (c.status === "checked_out") return { cart_id: c.id, status: c.status, po_id: c.po_id, replayed: true };
      if (!(c.items as any[]).length) throw new GtError("Cart is empty", "validation", 422);
      if (req.body?.confirm !== true) throw new GtError("Set confirm=true after your user has seen the quote", "not_confirmed", 422);
      const quote = await quoteCart(c);
      const bad = quote.lines.find((l: any) => l.error);
      if (bad) throw new GtError(`${bad.sku}: ${bad.error}`, "validation", 422);
      if (quote.mandate.outcome === "deny") throw new GtError(`Denied by the owner's mandate: ${quote.mandate.reason}`, "policy_denied", 403);
      const deliverBy = new Date(String(req.body?.deliver_by ?? new Date(Date.now() + 2 * 864e5).toISOString()));
      const limit = Number.isInteger(req.body?.spend_limit_cents) ? Number(req.body.spend_limit_cents) : Math.ceil(quote.total_cents * 1.1);
      const rules = await rulesFor(p.org_id);
      if (limit > rules.max_order_cents) throw new GtError(`spend_limit_cents ${limit} is above the mandate's per-order limit ${rules.max_order_cents}`, "policy_denied", 403);
      const owner: Person = p.role === "owner" ? p : { ...p, role: "owner" };
      const poId = await createPo(owner, { supplier_id: c.supplier_id, lines: quote.lines.map((l: any) => ({ product_id: l.product_id, qty_packs: l.qty_packs, substitutes: [], replace_shortfall: true })), deliver_by: deliverBy, spend_limit_cents: limit, note: `From cart ${c.id} by ${c.agent_id}`.slice(0, 200) });
      const db = await getDb();
      await db.query("UPDATE purchase_orders SET created_by_agent = $2 WHERE id = $1", [poId, c.agent_id]);
      await submitPo(owner, poId);
      await db.query("UPDATE carts SET status = 'checked_out', po_id = $2, quote = $3, updated_at = now() WHERE id = $1", [c.id, poId, JSON.stringify(quote)]);
      return { cart_id: c.id, status: "checked_out", po_id: poId, total_cents: quote.total_cents, mandate: quote.mandate, what_happens_next: "The supplier quotes. Accept it with the MCP accept_quote tool (if the mandate allows agents to accept) or let the owner accept; a PayPal hold is placed only then." };
    }),
  );

  return r;
}
