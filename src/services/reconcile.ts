/**
 * Spec B4 item 5: "Check against PayPal". Reads every PayPal id on an order back from PayPal (GET calls only) and
 * compares it with StockSure's record: matched, differs (amount), missing (PayPal doesn't know the id), and extra
 * (PayPal shows an authorization or capture on the order that StockSure has no record of). Moves no money.
 */
import { getDb } from "../db.js";
import { fmt } from "../core/money.js";
import { paypal } from "../paypal/index.js";
import { GtError } from "../lib/util.js";
import { getPo, logEvent, type Person } from "../store.js";
import { tick } from "../demo/checklist.js";

const cents = (v: string | number | undefined | null) => (v === undefined || v === null ? null : Math.round(Number(v) * 100));

export interface ReconRow { op_id: string; kind: string; paypal_id: string; ours_cents: number; ours_status: string | null; paypal_cents: number | null; paypal_status: string | null; verdict: "matched" | "differs" | "missing"; note: string | null }

export async function reconcileOrder(person: Person, poId: string) {
  const db = await getDb();
  const po = await getPo(db, poId);
  if (po.buyer_id !== person.org_id && po.supplier_id !== person.org_id) throw new GtError("Order not found", "not_found", 404);
  const ops = (await db.query<any>("SELECT id, kind, paypal_id, paypal_order_id, amount_cents, paypal_status FROM payment_ops WHERE po_id = $1 AND status = 'succeeded' AND paypal_id IS NOT NULL ORDER BY created_at", [po.id])).rows;
  const pp = paypal();
  const rows: ReconRow[] = [];
  for (const o of ops) {
    if (o.kind === "void" || o.kind === "reauthorize") continue; // a void has no object of its own; a reauthorize is its new authorization
    try {
      const live: any = o.kind === "authorize" ? await pp.getAuthorization(o.paypal_id) : o.kind === "capture" ? await pp.getCapture(o.paypal_id) : o.kind === "refund" ? await pp.getRefund(o.paypal_id) : null;
      if (!live) continue;
      const pc = cents(live.amount?.value);
      const differs = pc !== null && pc !== o.amount_cents;
      rows.push({ op_id: o.id, kind: o.kind, paypal_id: o.paypal_id, ours_cents: o.amount_cents, ours_status: o.paypal_status, paypal_cents: pc, paypal_status: live.status ?? null, verdict: differs ? "differs" : "matched", note: differs ? `PayPal shows ${fmt(pc!)}; StockSure recorded ${fmt(o.amount_cents)}.` : live.status && o.paypal_status && live.status !== o.paypal_status ? `Status moved on since it was recorded (${o.paypal_status} → ${live.status}).` : null });
    } catch (e) {
      const notFound = /404|RESOURCE_NOT_FOUND|not found/i.test((e as Error).message);
      rows.push({ op_id: o.id, kind: o.kind, paypal_id: o.paypal_id, ours_cents: o.amount_cents, ours_status: o.paypal_status, paypal_cents: null, paypal_status: null, verdict: "missing", note: notFound ? "PayPal has no record of this id." : `PayPal could not be read: ${(e as Error).message.slice(0, 160)}` });
    }
  }
  // Extras: what PayPal's order shows that StockSure has no record of.
  const known = new Set(ops.map((o) => o.paypal_id));
  const extra: { kind: string; paypal_id: string; cents: number | null; status: string | null }[] = [];
  for (const orderId of [...new Set(ops.map((o) => o.paypal_order_id).filter(Boolean))] as string[]) {
    try {
      const ord: any = await pp.getOrder(orderId);
      for (const u of ord.purchase_units ?? []) {
        for (const a of u.payments?.authorizations ?? []) if (!known.has(a.id)) extra.push({ kind: "authorize", paypal_id: a.id, cents: cents(a.amount?.value), status: a.status ?? null });
        for (const c of u.payments?.captures ?? []) if (!known.has(c.id)) extra.push({ kind: "capture", paypal_id: c.id, cents: cents(c.amount?.value), status: c.status ?? null });
      }
    } catch {
      // The order read is only for extras; a failure is reported in the summary, never as "nothing extra".
      extra.push({ kind: "order_unreadable", paypal_id: orderId, cents: null, status: null });
    }
  }
  const matched = rows.filter((r) => r.verdict === "matched").length;
  const bad = rows.length - matched + extra.length;
  const summary = !rows.length ? "No PayPal ids on this order yet." : bad ? `${matched} of ${rows.length} match PayPal; ${rows.filter((r) => r.verdict === "differs").length} differ, ${rows.filter((r) => r.verdict === "missing").length} missing, ${extra.length} extra. Look before settling anything else.` : `All ${rows.length} PayPal id${rows.length === 1 ? "" : "s"} match PayPal's own records.`;
  await logEvent(db, po, "paypal.reconciled", summary, { matched, rows: rows.length, extra: extra.length });
  if (rows.length && !bad) await tick(db, "reconciled");
  return { po: { id: po.id, number: po.number }, checked_at: new Date().toISOString(), rows, extra, summary, ok: !bad };
}
