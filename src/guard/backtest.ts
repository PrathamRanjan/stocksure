/**
 * Mandate backtest and earned autonomy (roadmap B.6). Replays the buyer's own order history through a candidate
 * mandate and reports what would have run, waited for a person, or been denied. Earned autonomy suggests limits the
 * owner's own approvals already support, never past anything they declined.
 */
import type { Queryable } from "../db.js";
import { getDb } from "../db.js";
import { RulesSchema, type Rules } from "./policy.js";

export interface BacktestRow {
  po_id: string;
  number: string;
  at: Date;
  total_cents: number;
  supplier: string;
  over_catalog_pct: number;
  outcome: "run" | "wait" | "deny";
  reason: string;
}

export interface Backtest {
  days: number;
  orders: number;
  run: number;
  wait: number;
  deny: number;
  auto_cents: number;
  held_cents: number;
  rows: BacktestRow[];
}

export async function backtest(buyerId: string, rules: Rules, days = 90, q?: Queryable): Promise<Backtest> {
  const db = q ?? (await getDb());
  const pos = (
    await db.query<{ id: string; number: string; created_at: Date; supplier: string; total: string; over: string }>(
      `SELECT po.id, po.number, po.created_at, s.name AS supplier,
              coalesce(sum(l.qty_packs * coalesce(l.unit_price_cents, p.price_cents)),0) AS total,
              coalesce(max(CASE WHEN p.price_cents > 0 THEN (coalesce(l.unit_price_cents, p.price_cents) - p.price_cents) * 100.0 / p.price_cents ELSE 0 END),0) AS over
       FROM purchase_orders po JOIN orgs s ON s.id = po.supplier_id JOIN po_lines l ON l.po_id = po.id JOIN products p ON p.id = l.product_id
       WHERE po.buyer_id = $1 AND po.kind = 'original' AND po.created_at > now() - ($2 || ' days')::interval
       GROUP BY po.id, po.number, po.created_at, s.name ORDER BY po.created_at`,
      [buyerId, String(days)],
    )
  ).rows;
  const perDay = new Map<string, number>();
  const out: Backtest = { days, orders: pos.length, run: 0, wait: 0, deny: 0, auto_cents: 0, held_cents: 0, rows: [] };
  for (const p of pos) {
    const total = Number(p.total);
    const over = Math.round(Number(p.over) * 10) / 10;
    const day = new Date(p.created_at).toISOString().slice(0, 10);
    const daily = (perDay.get(day) ?? 0) + total;
    perDay.set(day, daily);
    let outcome: BacktestRow["outcome"] = "run";
    let reason = "within the mandate";
    if (total > rules.max_order_cents) (outcome = "deny"), (reason = `order ${total} > max ${rules.max_order_cents}`);
    else if (daily > rules.max_daily_cents) (outcome = "deny"), (reason = `day total ${daily} > max ${rules.max_daily_cents}`);
    else if (rules.allowed_suppliers.length && !rules.allowed_suppliers.map((s) => s.toLowerCase()).includes(p.supplier.toLowerCase())) (outcome = "deny"), (reason = `supplier ${p.supplier} not allowed`);
    else if (over > rules.max_over_catalog_pct) (outcome = "wait"), (reason = `a line is ${over}% above catalog (> ${rules.max_over_catalog_pct}%): a person decides`);
    else if (total >= rules.approve_above_cents) (outcome = "wait"), (reason = `capture ${total} needs approval (>= ${rules.approve_above_cents})`);
    out[outcome] += 1;
    if (outcome === "run") out.auto_cents += total;
    else if (outcome === "wait") out.held_cents += total;
    out.rows.push({ po_id: p.id, number: p.number, at: p.created_at, total_cents: total, supplier: p.supplier, over_catalog_pct: over, outcome, reason });
  }
  return out;
}

export interface Suggestion {
  field: keyof Rules;
  current: number | boolean;
  suggested: number | boolean;
  basis: string;
}

/** Earned autonomy: limits the owner's own decisions support. Never suggests past a declined value. */
export async function suggestAutonomy(buyerId: string, rules: Rules, q?: Queryable): Promise<Suggestion[]> {
  const db = q ?? (await getDb());
  const approvals = (await db.query<{ action: string; status: string; payload: any }>("SELECT action, status, payload FROM approvals WHERE owner_id = $1 ORDER BY created_at", [buyerId])).rows;
  const approved = approvals.filter((a) => a.status === "approved").map((a) => Number(a.payload?.cents ?? 0));
  const declined = approvals.filter((a) => a.status === "declined").map((a) => Number(a.payload?.cents ?? 0));
  const out: Suggestion[] = [];
  if (approved.length >= 3) {
    const sorted = [...approved].sort((a, b) => a - b);
    const p80 = sorted[Math.floor(sorted.length * 0.8)];
    const ceiling = declined.length ? Math.min(...declined) - 1 : Infinity;
    const suggested = Math.min(p80, ceiling);
    if (suggested > rules.approve_above_cents) out.push({ field: "approve_above_cents", current: rules.approve_above_cents, suggested, basis: `${approved.length} captures approved by hand; 80% were at or below this${declined.length ? "; never above the smallest you declined" : ""}` });
  }
  const closed = (await db.query<{ n: string }>("SELECT count(*) AS n FROM purchase_orders WHERE buyer_id = $1 AND status = 'closed'", [buyerId])).rows[0];
  const disputed = (await db.query<{ n: string }>("SELECT count(*) AS n FROM receipt_lines rl JOIN receipts r ON r.id = rl.receipt_id JOIN purchase_orders po ON po.id = r.po_id WHERE po.buyer_id = $1 AND rl.supplier_status = 'disputed'", [buyerId])).rows[0];
  if (Number(closed?.n ?? 0) >= 10 && Number(disputed?.n ?? 0) === 0 && !rules.agents_may_accept) out.push({ field: "agents_may_accept", current: false, suggested: true, basis: `${closed.n} orders closed with no disputed line` });
  return out;
}

export function applySuggestions(rules: Rules, picks: Suggestion[]): Rules {
  const next: any = { ...rules };
  for (const p of picks) next[p.field] = p.suggested;
  return RulesSchema.parse(next);
}
