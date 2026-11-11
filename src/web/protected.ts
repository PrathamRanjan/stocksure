/**
 * Spec B4 item 2 and A9: the café's home screen leads with "Protected this month", computed from this workspace's
 * own records, each figure with its order numbers and PayPal ids. Sample history (is_sample) is never counted.
 *   not charged      goods that did not arrive or were damaged, left uncaptured on the hold (agreed fixes)
 *   overbilling      invoice amounts above what was accepted at the quote (agreed fixes)
 *   discounts taken  early-payment discounts code took off a capture
 *   scam holds       payments the scam check paused for the owner (paused, not lost: shown apart from the total)
 *   duplicates       invoices flagged as duplicates (StockSure pays counts, not invoices: shown apart from the total)
 */
import { Router, type Request, type Response } from "express";
import { getDb } from "../db.js";
import { fmt } from "../core/money.js";
import { GtError } from "../lib/util.js";
import type { Person } from "../store.js";
import { me } from "./auth.js";

const parse = (v: unknown) => (typeof v === "string" ? JSON.parse(v) : v);

export async function protectedThisMonth(p: Person, now = new Date()) {
  const db = await getDb();
  const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const res = (await db.query<any>(
    `SELECT r.po_id, r.version, r.body, r.status, r.created_at, p.number FROM resolutions r JOIN purchase_orders p ON p.id = r.po_id
     WHERE p.buyer_id = $1 AND NOT p.is_sample AND r.status IN ('agreed','settled') AND r.created_at >= $2 ORDER BY r.created_at`,
    [p.org_id, since],
  )).rows;
  const ops = async (poId: string) => (await db.query<{ kind: string; paypal_id: string | null; amount_cents: number }>("SELECT kind, paypal_id, amount_cents FROM payment_ops WHERE po_id = $1 AND status = 'succeeded' AND paypal_id IS NOT NULL ORDER BY created_at", [poId])).rows;
  const notCharged: any[] = [];
  const overbilled: any[] = [];
  const discounts: any[] = [];
  for (const r of res) {
    const b = parse(r.body);
    const o = await ops(r.po_id);
    const ids = o.filter((x) => x.kind === "capture" || x.kind === "void").map((x) => ({ kind: x.kind === "void" ? "release (void)" : "capture", id: x.paypal_id, amount: fmt(x.amount_cents) }));
    const nc = (b.lines ?? []).reduce((a: number, l: any) => a + (l.not_charged_cents ?? 0), 0);
    if (nc > 0) notCharged.push({ po_id: r.po_id, po_number: r.number, cents: nc, amount: fmt(nc), why: (b.lines ?? []).filter((l: any) => l.shortfall > 0).map((l: any) => `${l.sku}: ${l.reason}`).join(" "), paypal: ids });
    const over = (b.lines ?? []).reduce((a: number, l: any) => a + Math.max(0, l.invoice_delta_cents ?? 0), 0);
    if (over > 0) overbilled.push({ po_id: r.po_id, po_number: r.number, cents: over, amount: fmt(over), why: (b.flags ?? []).filter((f: any) => f.code === "overbilled_qty" || f.code === "price_above_quote").map((f: any) => f.message).join(" "), invoice_doc: b.invoice_doc_id, paypal: ids });
    const disc = b.totals?.early_discount_cents ?? 0;
    if (disc > 0) discounts.push({ po_id: r.po_id, po_number: r.number, cents: disc, amount: fmt(disc), why: `${b.early_payment?.pct}% for paying within ${b.early_payment?.days} days`, paypal: ids });
  }
  const holds: any[] = (await db.query<any>("SELECT id, payload, status, created_at FROM approvals WHERE owner_id = $1 AND payload->>'safety_rule' IS NOT NULL AND created_at >= $2 ORDER BY created_at", [p.org_id, since])).rows.map((a) => {
    const pl = parse(a.payload);
    return { approval_id: a.id, cents: pl.cents, amount: fmt(pl.cents), action: pl.action, status: a.status, why: (pl.safety_reasons ?? [])[0] ?? "", entity_id: pl.entity_id };
  });
  for (const h of holds) {
    const po = h.entity_id ? (await db.query<{ number: string }>("SELECT number FROM purchase_orders WHERE id = $1", [h.entity_id])).rows[0] : null;
    h.po_number = po?.number ?? null;
    h.po_id = h.entity_id;
  }
  const dups = (await db.query<any>(
    `SELECT d.id, d.filename, d.checks, p.number, p.id AS po_id FROM documents d JOIN purchase_orders p ON p.id = d.po_id WHERE p.buyer_id = $1 AND d.kind = 'invoice' AND d.created_at >= $2 AND d.checks IS NOT NULL ORDER BY d.created_at`,
    [p.org_id, since],
  )).rows
    .map((d) => ({ d, c: parse(d.checks) }))
    .filter(({ c }) => (c?.flags ?? []).some((f: any) => f.code === "duplicate_of_earlier_invoice"))
    .map(({ d, c }) => ({ doc_id: d.id, po_id: d.po_id, po_number: d.number, invoice: c.number ?? d.filename, cents: c.total_cents, amount: c.total_cents === null ? "—" : fmt(c.total_cents), why: c.flags.find((f: any) => f.code === "duplicate_of_earlier_invoice").message }));
  const sum = (xs: { cents: number }[]) => xs.reduce((a, x) => a + (x.cents ?? 0), 0);
  const total = sum(notCharged) + sum(overbilled) + sum(discounts);
  return {
    month: since.toISOString().slice(0, 7),
    total_cents: total,
    total: fmt(total),
    rows: [
      { key: "not_charged", title: "Not paid for goods that didn't arrive", cents: sum(notCharged), amount: fmt(sum(notCharged)), items: notCharged, in_total: true },
      { key: "overbilling", title: "Overbilling refused", cents: sum(overbilled), amount: fmt(sum(overbilled)), items: overbilled, in_total: true },
      { key: "discounts", title: "Early-payment discounts taken", cents: sum(discounts), amount: fmt(sum(discounts)), items: discounts, in_total: true },
      { key: "scam_holds", title: "Payments the scam check paused for you", cents: sum(holds), amount: fmt(sum(holds)), items: holds, in_total: false, note: "Paused until you decide; not counted as saved." },
      { key: "duplicates", title: "Duplicate invoices caught", cents: sum(dups.map((d) => ({ cents: d.cents ?? 0 }))), amount: fmt(sum(dups.map((d) => ({ cents: d.cents ?? 0 })))), items: dups, in_total: false, note: "StockSure pays agreed counts, never an invoice, so these were never at risk here; they are flagged so your books don't pay them either." },
    ],
    basis: "From this demo's agreed fixes, invoice checks and scam holds since the 1st of the month (UTC). Sample history is not counted.",
  };
}

export function protectedRouter() {
  const r = Router();
  r.get("/api/ui/protected", async (req: Request, res: Response) => {
    try {
      const p = await me(req);
      if (!p) throw new GtError("Sign in first.", "unauthorized", 401);
      if (p.org_kind !== "buyer") throw new GtError("This is the café's view.", "forbidden", 403);
      res.setHeader("Cache-Control", "no-store").json(await protectedThisMonth(p));
    } catch (e) {
      const g = e instanceof GtError ? e : null;
      if (!g) console.error("[stocksure protected]", e);
      res.status(g?.status ?? 500).json({ error: g?.code ?? "error", message: g?.message ?? "Something went wrong." });
    }
  });
  return r;
}
