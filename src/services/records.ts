import type { Queryable } from "../db.js";
import { formatUnits } from "../core/units.js";
import { shipmentsOf } from "./parts.js";
import { fundingOf, getPo, linesOf, opsOfRoot, receiptsOf, resolutionsOf, treeOf, docsOf, type PO } from "../store.js";

/** Full audit record for an order tree: every PO, receipt version, resolution version, payment op, document hash. */
export async function recordJson(q: Queryable, rootId: string) {
  const root = await getPo(q, rootId);
  const tree = await treeOf(q, rootId);
  const pos = [];
  for (const po of tree) {
    const lines = await linesOf(q, po.id);
    pos.push({
      number: po.number,
      kind: po.kind,
      parent: tree.find((p) => p.id === po.parent_id)?.number ?? null,
      status: po.status,
      deliver_by: po.deliver_by,
      accepted_quote_version: po.accepted_quote_version,
      authorization_id: po.auth_id,
      lines: lines.map((l) => ({ line_no: l.line_no, sku: l.product.sku, name: l.product.name, qty_packs: l.qty_packs, pack_units: l.product.pack_units, unit_price_cents: l.unit_price_cents, substitutes: l.substitutes })),
      receipts: (await receiptsOf(q, po.id)).map((r) => ({ version: r.receipt.version, status: r.receipt.status, confirmed_by: r.receipt.confirmed_by, at: r.receipt.created_at, lines: r.lines.map((l) => ({ line: lines.find((x) => x.id === l.po_line_id)?.line_no, delivered: l.delivered_units, accepted: l.accepted_units, damaged: l.damaged_units, wrong: l.wrong_units, supplier: l.supplier_status, supplier_note: l.supplier_note, reviewed_by: l.reviewed_by })) })),
      resolutions: (await resolutionsOf(q, po.id)).map((r) => ({ version: r.version, status: r.status, hash: r.hash, totals: r.body.totals, flags: r.body.flags, buyer_approved_by: r.buyer_approved_by, supplier_approved_by: r.supplier_approved_by, replacement: r.body.plan?.chosen?.picks ?? [] })),
      shipments: (await shipmentsOf(q, po.id)).map((x) => ({ seq: x.seq, kind: x.kind, packs: Object.fromEntries(lines.map((l) => [l.line_no, x.packs[l.id] ?? 0])), status: x.status, receipt_version: x.receipt_version, charged_cents: x.accepted_cents, by: x.dispatched_by, at: x.created_at })),
      documents: (await docsOf(q, po.id)).map((d) => ({ kind: d.kind, filename: d.filename, sha256: d.sha256, size: d.size, flags: d.flags, uploaded_by: d.uploaded_by, at: d.created_at })),
    });
  }
  const ops = await opsOfRoot(q, rootId);
  const events = (await q.query<any>("SELECT at, actor, type, summary FROM events WHERE root_id = $1 ORDER BY id", [rootId])).rows;
  return { order: root.number, buyer: root.buyer_name, supplier: root.supplier_name, currency: root.currency, spend_limit_cents: root.spend_limit_cents, funding: await fundingOf(q, rootId), purchase_orders: pos, payment_ops: ops.map((o) => ({ po: o.po_number, kind: o.kind, status: o.status, amount_cents: o.amount_cents, final_capture: o.final_capture, request_id: o.request_id, paypal_order_id: o.paypal_order_id, paypal_id: o.paypal_id, parent: o.parent_paypal_id, paypal_status: o.paypal_status, attempts: o.attempts })), events };
}

const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? "" : String(v);
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s; // no formula injection in spreadsheets
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

/** One row per line per PO: ordered, delivered, accepted, damaged, quoted, invoiced and paid, with PayPal ids. */
export async function recordCsv(q: Queryable, rootId: string): Promise<string> {
  const tree = await treeOf(q, rootId);
  const ops = await opsOfRoot(q, rootId);
  const rows: unknown[][] = [["po", "kind", "line", "sku", "product", "ordered", "delivered", "accepted", "damaged", "wrong", "unit_price", "quoted", "invoiced", "paid", "remedy", "authorization", "capture", "status"]];
  for (const po of tree) {
    const res = (await resolutionsOf(q, po.id)).filter((r) => r.status === "agreed" || r.status === "settled").at(-1);
    const lines = await linesOf(q, po.id);
    const cap = ops.find((o) => o.po_id === po.id && o.kind === "capture" && o.status === "succeeded");
    for (const l of lines) {
      const rl = res?.body.lines.find((x: any) => x.line_id === l.id);
      rows.push([po.number, po.kind, l.line_no, l.product.sku, l.product.name, formatUnits(l.qty_packs * l.product.pack_units, l.product), rl ? formatUnits(rl.delivered, l.product) : "", rl ? formatUnits(rl.accepted, l.product) : "", rl ? formatUnits(rl.damaged, l.product) : "", rl ? formatUnits(rl.wrong, l.product) : "", ((l.unit_price_cents ?? 0) / 100).toFixed(2), rl ? (rl.quoted_cents / 100).toFixed(2) : "", rl?.invoice_cents != null ? (rl.invoice_cents / 100).toFixed(2) : "", rl ? (rl.accepted_cents / 100).toFixed(2) : "", rl?.remedy ?? "", po.auth_id ?? "", cap?.paypal_id ?? "", po.status]);
    }
  }
  return rows.map((r) => r.map(csvCell).join(",")).join("\n") + "\n";
}

export interface Perf {
  orders: number;
  on_time_pct: number | null;
  fill_rate_pct: number | null;
  damage_rate_pct: number | null;
  dispute_rate_pct: number | null;
  median_resolution_hours: number | null;
  invoice_accuracy_pct: number | null;
}

const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : null);

/** Supplier performance from recorded outcomes only. */
export async function supplierPerformance(q: Queryable, supplierId: string, buyerId?: string): Promise<Perf> {
  const pos = (await q.query<PO>("SELECT * FROM purchase_orders WHERE supplier_id = $1 AND dispatched_at IS NOT NULL" + (buyerId ? " AND buyer_id = $2" : ""), buyerId ? [supplierId, buyerId] : [supplierId])).rows;
  let ordered = 0;
  let accepted = 0;
  let damaged = 0;
  let disputed = 0;
  let invoices = 0;
  let cleanInvoices = 0;
  const hours: number[] = [];
  for (const po of pos) {
    const lines = await linesOf(q, po.id);
    const recs = await receiptsOf(q, po.id);
    const last = recs.at(-1);
    for (const l of lines) {
      ordered += l.qty_packs * l.product.pack_units;
      const rl = last?.lines.find((x) => x.po_line_id === l.id);
      if (rl) {
        accepted += Math.min(rl.accepted_units, l.qty_packs * l.product.pack_units);
        damaged += rl.damaged_units;
      }
    }
    const everDisputed = recs.some((r) => r.lines.some((l) => l.supplier_status === "disputed" || /disput/i.test(l.supplier_note)));
    if (everDisputed) disputed++;
    if (po.received_at && po.agreed_at) hours.push((new Date(po.agreed_at).getTime() - new Date(po.received_at).getTime()) / 3_600_000);
    const inv = (await q.query<{ flags: any }>("SELECT d.flags FROM documents d WHERE d.po_id = $1 AND d.kind = 'invoice'", [po.id])).rows;
    if (inv.length) {
      invoices++;
      const res = (await resolutionsOf(q, po.id)).at(-1);
      const flags = (typeof inv[0].flags === "string" ? JSON.parse(inv[0].flags) : inv[0].flags) as unknown[];
      if (!flags.length && !(res?.body.flags ?? []).some((f: any) => f.code !== "invoice_missing")) cleanInvoices++;
    }
  }
  hours.sort((a, b) => a - b);
  const onTime = pos.filter((p) => p.dispatched_at && new Date(p.dispatched_at) <= new Date(p.deliver_by)).length;
  return {
    orders: pos.length,
    on_time_pct: pct(onTime, pos.length),
    fill_rate_pct: pct(accepted, ordered),
    damage_rate_pct: pct(damaged, ordered),
    dispute_rate_pct: pct(disputed, pos.length),
    median_resolution_hours: hours.length ? Math.round(hours[Math.floor(hours.length / 2)] * 10) / 10 : null,
    invoice_accuracy_pct: pct(cleanInvoices, invoices),
  };
}
