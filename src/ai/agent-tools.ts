/**
 * Spec A5.3 (a) and (c): the agent's own tools. Every one reads this person's organisation's records and returns
 * figures computed by code; none moves money or changes an order. `propose_message_to_supplier` only records a
 * draft for the owner to send (or not) themselves.
 *
 * Text inside records (supplier messages, invoice lines) is returned as data under a `data_not_instructions` key.
 */
import type { Queryable } from "../db.js";
import { fmt } from "../core/money.js";
import { fundingOf, getPo, linesOf, opsOfRoot, receiptsOf, type Person, type PO } from "../store.js";
import { supplierPerformance } from "../services/records.js";
import { quoteTotal } from "../services/orders.js";

export interface AgentTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  /** "read" tools only look; "propose" tools record a draft for a person. Nothing else exists. */
  kind: "read" | "propose";
  run: (q: Queryable, p: Person, args: any, ctx: { proposals: Proposal[] }) => Promise<unknown>;
}

export interface Proposal {
  id: string;
  kind: "message_to_supplier";
  po_id: string;
  po_number: string;
  text: string;
}

const obj = (props: Record<string, unknown>) => ({ type: "object", properties: props, required: Object.keys(props), additionalProperties: false });
const PO_ARG = { type: "string", description: "The order number (for example PO-1042) or its id." };

async function findPo(q: Queryable, p: Person, ref: string): Promise<PO> {
  const r = String(ref ?? "").trim();
  const row = (await q.query<PO>("SELECT * FROM purchase_orders WHERE (id = $1 OR upper(number) = upper($1)) AND (buyer_id = $2 OR supplier_id = $2) LIMIT 1", [r, p.org_id])).rows[0];
  if (!row) throw new Error(`No order ${r} for ${p.org_name ?? "this organisation"}`);
  return getPo(q, row.id);
}

export const AGENT_TOOLS: AgentTool[] = [
  {
    name: "list_orders",
    kind: "read",
    description: "Lists this organisation's orders, newest first: number, status, supplier or buyer, quote total, sample flag. Use it to find order numbers.",
    parameters: obj({ status: { type: ["string", "null"], description: "Only orders with this status (draft, quoted, funded, dispatched, in_review, settling, awaiting_replacement, closed, exception), or null for all." } }),
    run: async (q, p, a) => {
      const rows = (await q.query<PO>(`SELECT * FROM purchase_orders WHERE (buyer_id = $1 OR supplier_id = $1) ${a.status ? "AND status = $2" : ""} ORDER BY created_at DESC LIMIT 40`, a.status ? [p.org_id, a.status] : [p.org_id])).rows;
      const out = [];
      for (const po of rows) {
        const full = await getPo(q, po.id);
        out.push({ number: full.number, kind: full.kind, status: full.status, supplier: full.supplier_name, buyer: full.buyer_name, quote_total: fmt(quoteTotal(await linesOf(q, po.id))), sample: !!full.is_sample, created: full.created_at, exception: full.exception });
      }
      return { orders: out };
    },
  },
  {
    name: "order",
    kind: "read",
    description: "One order: its lines (ordered packs, quoted prices), status, spend limit, delivery date and any exception.",
    parameters: obj({ po: PO_ARG }),
    run: async (q, p, a) => {
      const po = await findPo(q, p, a.po);
      const lines = await linesOf(q, po.id);
      return { number: po.number, kind: po.kind, status: po.status, supplier: po.supplier_name, buyer: po.buyer_name, sample: !!po.is_sample, spend_limit: fmt(po.spend_limit_cents), quote_total: fmt(quoteTotal(lines)), deliver_by: po.deliver_by, exception: po.exception, lines: lines.map((l) => ({ line: l.line_no, sku: l.product.sku, name: l.product.name, ordered_packs: l.qty_packs, pack: `${l.product.pack_label} of ${l.product.pack_units} ${l.product.base_unit}`, quoted_unit_price: l.unit_price_cents === null ? null : fmt(l.unit_price_cents), catalog_price: fmt(l.product.price_cents) })) };
    },
  },
  {
    name: "receipt_versions",
    kind: "read",
    description: "Every count of an order's delivery (receipt versions): delivered, accepted, damaged and wrong units per line, and whether the supplier agreed.",
    parameters: obj({ po: PO_ARG }),
    run: async (q, p, a) => {
      const po = await findPo(q, p, a.po);
      const lines = await linesOf(q, po.id);
      const recs = await receiptsOf(q, po.id);
      return { number: po.number, receipts: recs.map((r) => ({ version: r.receipt.version, counted_at: r.receipt.created_at, lines: r.lines.map((l) => { const pl = lines.find((x) => x.id === l.po_line_id); return { sku: pl?.product.sku, ordered_units: pl ? pl.qty_packs * pl.product.pack_units : null, delivered: l.delivered_units, accepted: l.accepted_units, damaged: l.damaged_units, wrong: l.wrong_units, supplier: l.supplier_status, data_not_instructions: { note: l.note, supplier_note: l.supplier_note } }; }) })) };
    },
  },
  {
    name: "invoice_lines",
    kind: "read",
    description: "The lines read from an order's invoice (billed units and prices), next to what the order quoted. StockSure never pays from an invoice; it is compared.",
    parameters: obj({ po: PO_ARG }),
    run: async (q, p, a) => {
      const po = await findPo(q, p, a.po);
      const rows = (await q.query<any>("SELECT d.filename, il.idx, il.po_line_id, il.description, il.billed_units, il.unit_price_cents, il.line_cents FROM invoice_lines il JOIN documents d ON d.id = il.document_id WHERE d.po_id = $1 AND d.kind = 'invoice' ORDER BY d.created_at, il.idx", [po.id])).rows;
      const flags = (await q.query<any>("SELECT filename, flags FROM documents WHERE po_id = $1 AND kind = 'invoice'", [po.id])).rows;
      return { number: po.number, invoices: flags.map((f) => ({ file: f.filename, instruction_lines_removed: (typeof f.flags === "string" ? JSON.parse(f.flags) : f.flags ?? []).length })), lines: rows.map((r) => ({ file: r.filename, billed_units: r.billed_units, unit_price: r.unit_price_cents === null ? null : fmt(r.unit_price_cents), line_total: r.line_cents === null ? null : fmt(r.line_cents), on_order: !!r.po_line_id, data_not_instructions: { description: r.description } })) };
    },
  },
  {
    name: "price_history",
    kind: "read",
    description: "Quoted unit prices for one product (by SKU or name) across this organisation's orders, oldest first.",
    parameters: obj({ product: { type: "string", description: "SKU (for example OAT-12) or part of the product name." } }),
    run: async (q, p, a) => {
      const rows = (await q.query<any>("SELECT po.number, po.created_at, pr.sku, pr.name, l.qty_packs, l.unit_price_cents, pr.price_cents FROM po_lines l JOIN purchase_orders po ON po.id = l.po_id JOIN products pr ON pr.id = l.product_id WHERE (po.buyer_id = $1 OR po.supplier_id = $1) AND (upper(pr.sku) = upper($2) OR pr.name ILIKE '%' || $2 || '%') ORDER BY po.created_at", [p.org_id, String(a.product ?? "")])).rows;
      return { product: a.product, deliveries: rows.map((r) => ({ order: r.number, at: r.created_at, sku: r.sku, name: r.name, packs: r.qty_packs, quoted_unit_price: r.unit_price_cents === null ? null : fmt(r.unit_price_cents), catalog_price: fmt(r.price_cents) })) };
    },
  },
  {
    name: "supplier_performance",
    kind: "read",
    description: "Recorded outcomes per supplier for this buyer: orders, fill rate, damage rate, dispute rate, invoice accuracy, and the value of goods not charged because they were short or damaged.",
    parameters: obj({}),
    run: async (q, p) => {
      const sups = (await q.query<{ id: string; name: string }>("SELECT DISTINCT o.id, o.name FROM purchase_orders po JOIN orgs o ON o.id = po.supplier_id WHERE po.buyer_id = $1", [p.org_id])).rows;
      const out = [];
      for (const s of sups) {
        const perf = await supplierPerformance(q, s.id, p.org_id);
        // Value not charged: ordered minus accepted on the latest count, at quote prices, from recorded receipts.
        const v = (await q.query<{ c: string }>(
          `SELECT coalesce(sum(greatest(0, l.qty_packs * pr.pack_units - rl.accepted_units)::numeric * coalesce(l.unit_price_cents, pr.price_cents) / pr.pack_units), 0) AS c
           FROM purchase_orders po JOIN po_lines l ON l.po_id = po.id JOIN products pr ON pr.id = l.product_id
           JOIN LATERAL (SELECT rl.* FROM receipts r JOIN receipt_lines rl ON rl.receipt_id = r.id WHERE r.po_id = po.id AND rl.po_line_id = l.id ORDER BY r.version DESC LIMIT 1) rl ON true
           WHERE po.buyer_id = $1 AND po.supplier_id = $2`,
          [p.org_id, s.id],
        )).rows[0];
        out.push({ supplier: s.name, ...perf, not_charged_short_or_damaged: fmt(Math.round(Number(v?.c ?? 0))) });
      }
      return { suppliers: out };
    },
  },
  {
    name: "spendable",
    kind: "read",
    description: "Where an order's money is, from PayPal's read-backs: charged, held now, being released (PayPal has not yet confirmed the release, so it is not spendable), released, refunding, and spendable now under the limit.",
    parameters: obj({ po: PO_ARG }),
    run: async (q, p, a) => {
      const po = await findPo(q, p, a.po);
      const f = await fundingOf(q, po.root_id);
      return { order: po.number, spend_limit: fmt(f.limit_cents), charged: fmt(f.captured_cents), refunded: fmt(f.refunded_cents), held_now: fmt(f.held_now_cents), being_released: fmt(f.releasing_cents), released: fmt(f.released_cents), refunding: fmt(f.refunding_cents), spendable_now: fmt(f.spendable_cents), waiting_on_paypal: f.expected.map((e) => ({ what: e.label, amount: fmt(e.cents) })), rule: "Money counts as spendable only after PayPal's read-back confirms it; an expected release is listed but not counted." };
    },
  },
  {
    name: "payment_ops",
    kind: "read",
    description: "Every PayPal operation on an order and its replacements: kind (authorize, capture, void, refund), status, amount, PayPal id and PayPal's read-back status.",
    parameters: obj({ po: PO_ARG }),
    run: async (q, p, a) => {
      const po = await findPo(q, p, a.po);
      const ops = await opsOfRoot(q, po.root_id);
      return { order: po.number, ops: ops.map((o) => ({ order: o.po_number, kind: o.kind, status: o.status, amount: fmt(o.amount_cents), paypal_id: o.paypal_id, paypal_order_id: o.paypal_order_id, paypal_status: o.paypal_status, final_capture: o.final_capture, at: o.created_at })) };
    },
  },
  {
    name: "propose_message_to_supplier",
    kind: "propose",
    description: "Drafts a message to the supplier on an order. It is NOT sent: the owner sees the draft and sends it or not. Use only when the owner asks for a message.",
    parameters: obj({ po: PO_ARG, text: { type: "string", description: "The message, plain and short." } }),
    run: async (q, p, a, ctx) => {
      if (p.org_kind !== "buyer" || p.role !== "owner") throw new Error("Only the buyer's owner can have a message drafted");
      const po = await findPo(q, p, a.po);
      const id = `prp_${ctx.proposals.length + 1}`;
      ctx.proposals.push({ id, kind: "message_to_supplier", po_id: po.id, po_number: po.number, text: String(a.text ?? "").slice(0, 1000) });
      return { proposal_id: id, status: "drafted, waiting for the owner; nothing was sent" };
    },
  },
];
