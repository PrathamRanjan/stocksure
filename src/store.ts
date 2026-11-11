import { EVENT_KEYS, tick } from "./demo/checklist.js";
import type { Queryable } from "./db.js";
import { funding, type FundOp } from "./core/funding.js";
import type { UnitSpec } from "./core/units.js";
import { GtError } from "./lib/util.js";

export interface Org {
  id: string;
  kind: "buyer" | "supplier";
  name: string;
  vault_token_id: string | null;
  vault_payer: string | null;
  pending_setup_token: string | null;
}

export interface Person {
  id: string;
  org_id: string;
  name: string;
  role: "owner" | "receiving" | "supplier";
  org_name?: string;
  org_kind?: "buyer" | "supplier";
}

export interface Product extends UnitSpec {
  id: string;
  supplier_id: string;
  sku: string;
  name: string;
  family: string;
  price_cents: number;
  stock_packs: number;
  lead_hours: number;
  active: boolean;
}

export type PoStatus = "draft" | "submitted" | "quoted" | "funding" | "funded" | "dispatched" | "in_review" | "resolving" | "settling" | "part_settling" | "part_delivered" | "awaiting_replacement" | "closed" | "exception" | "cancelled";

export interface PO {
  id: string;
  number: string;
  /** Sample history from the seed: shown as Sample, never paid through PayPal. */
  is_sample?: boolean;
  buyer_id: string;
  supplier_id: string;
  root_id: string;
  parent_id: string | null;
  parent_version: number | null;
  kind: "original" | "replacement";
  status: PoStatus;
  deliver_by: Date;
  spend_limit_cents: number;
  currency: string;
  quote_version: number;
  accepted_quote_version: number | null;
  auth_id: string | null;
  note: string;
  exception: string | null;
  dispatched_at: Date | null;
  received_at: Date | null;
  agreed_at: Date | null;
  closed_at: Date | null;
  created_at: Date;
  buyer_name?: string;
  supplier_name?: string;
}

export interface PoLine {
  id: string;
  po_id: string;
  line_no: number;
  product_id: string;
  qty_packs: number;
  unit_price_cents: number | null;
  substitutes: string[];
  replace_shortfall: boolean;
  replaces_line_id: string | null;
  product: Product;
}

export interface Receipt {
  id: string;
  po_id: string;
  version: number;
  status: "confirmed" | "superseded";
  confirmed_by: string;
  created_at: Date;
}

export interface ReceiptLine {
  receipt_id: string;
  po_line_id: string;
  delivered_units: number;
  accepted_units: number;
  damaged_units: number;
  wrong_units: number;
  note: string;
  evidence: string[];
  proposal: any;
  supplier_status: "pending" | "agreed" | "disputed";
  supplier_note: string;
  reviewed_by: string | null;
}

export interface Resolution {
  id: string;
  po_id: string;
  version: number;
  status: "proposed" | "agreed" | "superseded" | "settled";
  body: any;
  hash: string;
  buyer_approved_by: string | null;
  buyer_approved_hash: string | null;
  buyer_approved_at: Date | null;
  supplier_approved_by: string | null;
  supplier_approved_hash: string | null;
  supplier_approved_at: Date | null;
  created_at: Date;
}

export interface PaymentOp {
  id: string;
  po_id: string;
  root_id: string;
  kind: "authorize" | "capture" | "void" | "refund";
  status: "planned" | "pending" | "succeeded" | "failed";
  amount_cents: number;
  final_capture: boolean;
  request_id: string;
  paypal_order_id: string | null;
  paypal_id: string | null;
  parent_paypal_id: string | null;
  paypal_status: string | null;
  attempts: number;
  error: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface Doc {
  id: string;
  po_id: string;
  kind: "delivery_note" | "invoice" | "photo" | "evidence";
  filename: string;
  mime: string;
  size: number;
  sha256: string;
  text_content: string | null;
  flags: any[];
  uploaded_by: string;
  created_at: Date;
}

const parse = <T>(v: unknown): T => (typeof v === "string" ? JSON.parse(v) : (v as T));

export async function personById(q: Queryable, id: string): Promise<Person | null> {
  return (await q.query<Person>("SELECT p.*, o.name AS org_name, o.kind AS org_kind FROM people p JOIN orgs o ON o.id = p.org_id WHERE p.id = $1", [id])).rows[0] ?? null;
}

export async function orgById(q: Queryable, id: string): Promise<Org | null> {
  return (await q.query<Org>("SELECT * FROM orgs WHERE id = $1", [id])).rows[0] ?? null;
}

export async function getPo(q: Queryable, id: string, lock = false): Promise<PO> {
  const r = await q.query<PO>(
    `SELECT po.*, b.name AS buyer_name, s.name AS supplier_name FROM purchase_orders po JOIN orgs b ON b.id = po.buyer_id JOIN orgs s ON s.id = po.supplier_id WHERE po.id = $1`,
    [id],
  );
  if (!r.rows[0]) throw new GtError("Purchase order not found", "not_found", 404);
  if (lock) await q.query("SELECT id FROM purchase_orders WHERE id = $1 FOR UPDATE", [id]);
  return r.rows[0];
}

/** The PO, if this person is a party to it; otherwise not found (no existence leak). */
export async function poFor(q: Queryable, person: Person, id: string, lock = false): Promise<PO> {
  const po = await getPo(q, id, lock).catch(() => null);
  if (!po || (po.buyer_id !== person.org_id && po.supplier_id !== person.org_id)) throw new GtError("Purchase order not found", "not_found", 404);
  return po;
}

export async function productById(q: Queryable, id: string): Promise<Product> {
  const p = (await q.query<Product>("SELECT * FROM products WHERE id = $1", [id])).rows[0];
  if (!p) throw new GtError("Product not found", "not_found", 404);
  return p;
}

/** Products with stock shown as what is free: on hand minus packs held for agreed replacements (other than `forPo`'s own). */
export async function catalog(q: Queryable, supplierId: string, forPo: string | null = null): Promise<Product[]> {
  return (
    await q.query<Product>(
      "SELECT p.*, GREATEST(0, p.stock_packs - COALESCE((SELECT SUM(h.packs) FROM stock_holds h WHERE h.product_id = p.id AND h.status = 'held' AND h.source_po IS DISTINCT FROM $2), 0))::int AS stock_packs FROM products p WHERE p.supplier_id = $1 ORDER BY p.family, p.sku",
      [supplierId, forPo],
    )
  ).rows;
}

/** Packs held for agreed replacements, excluding those held for `exceptPo` (its own shipment). */
export async function heldPacks(q: Queryable, productId: string, exceptPo: string | null) {
  return (await q.query<{ n: number }>("SELECT COALESCE(SUM(packs),0)::int AS n FROM stock_holds WHERE product_id = $1 AND status = 'held' AND for_po IS DISTINCT FROM $2", [productId, exceptPo])).rows[0].n;
}

export async function linesOf(q: Queryable, poId: string): Promise<PoLine[]> {
  const rows = (await q.query<any>("SELECT l.*, row_to_json(p.*) AS product FROM po_lines l JOIN products p ON p.id = l.product_id WHERE l.po_id = $1 ORDER BY l.line_no", [poId])).rows;
  return rows.map((r) => ({ ...r, substitutes: parse<string[]>(r.substitutes), product: parse<Product>(r.product) }));
}

export async function latestReceipt(q: Queryable, poId: string): Promise<{ receipt: Receipt; lines: ReceiptLine[] } | null> {
  const receipt = (await q.query<Receipt>("SELECT * FROM receipts WHERE po_id = $1 ORDER BY version DESC LIMIT 1", [poId])).rows[0];
  if (!receipt) return null;
  const lines = (await q.query<any>("SELECT * FROM receipt_lines WHERE receipt_id = $1", [receipt.id])).rows.map((r) => ({ ...r, evidence: parse<string[]>(r.evidence), proposal: parse(r.proposal) }));
  return { receipt, lines };
}

export async function receiptsOf(q: Queryable, poId: string) {
  const rs = (await q.query<Receipt>("SELECT * FROM receipts WHERE po_id = $1 ORDER BY version", [poId])).rows;
  const out: { receipt: Receipt; lines: ReceiptLine[] }[] = [];
  for (const r of rs) out.push({ receipt: r, lines: (await q.query<ReceiptLine>("SELECT * FROM receipt_lines WHERE receipt_id = $1", [r.id])).rows });
  return out;
}

export async function latestResolution(q: Queryable, poId: string): Promise<Resolution | null> {
  const r = (await q.query<Resolution>("SELECT * FROM resolutions WHERE po_id = $1 ORDER BY version DESC LIMIT 1", [poId])).rows[0];
  return r ? { ...r, body: parse(r.body) } : null;
}

export async function resolutionsOf(q: Queryable, poId: string): Promise<Resolution[]> {
  return (await q.query<Resolution>("SELECT * FROM resolutions WHERE po_id = $1 ORDER BY version", [poId])).rows.map((r) => ({ ...r, body: parse(r.body) }));
}

export async function docsOf(q: Queryable, poId: string): Promise<Doc[]> {
  return (await q.query<Doc>("SELECT id, po_id, kind, filename, mime, size, sha256, text_content, flags, checks, uploaded_by, created_at FROM documents WHERE po_id = $1 ORDER BY created_at", [poId])).rows.map((d: any) => ({ ...d, flags: parse(d.flags), checks: d.checks ? parse(d.checks) : null }));
}

export async function opsOfRoot(q: Queryable, rootId: string): Promise<(PaymentOp & { po_number: string })[]> {
  return (await q.query<any>("SELECT o.*, po.number AS po_number FROM payment_ops o JOIN purchase_orders po ON po.id = o.po_id WHERE o.root_id = $1 ORDER BY o.created_at, o.id", [rootId])).rows;
}

export async function treeOf(q: Queryable, rootId: string): Promise<PO[]> {
  return (await q.query<PO>("SELECT * FROM purchase_orders WHERE root_id = $1 ORDER BY created_at", [rootId])).rows;
}

export async function fundingOf(q: Queryable, rootId: string) {
  const root = await getPo(q, rootId);
  const ops = await opsOfRoot(q, rootId);
  return funding(root.spend_limit_cents, ops.map((o): FundOp => ({ ...o, po_number: o.po_number })));
}

export async function logEvent(q: Queryable, po: Pick<PO, "id" | "root_id"> | null, type: string, summary: string, data: unknown = null, actor = "system") {
  await q.query("INSERT INTO events (po_id, root_id, type, summary, data, actor) VALUES ($1,$2,$3,$4,$5,$6)", [po?.id ?? null, po?.root_id ?? null, type, summary, data === null ? null : JSON.stringify(data), actor]);
  // Spec A3.1: the judge page's steps tick themselves from these events.
  const key = EVENT_KEYS[type];
  if (key) await tick(q, key);
  if (type === "paypal.hold" && po && po.id !== po.root_id) await tick(q, "replacement_held");
}

export async function postMessage(q: Queryable, poId: string, lineId: string | null, author: string, role: string, body: string, kind: "message" | "system" = "message", documentId: string | null = null) {
  const r = await q.query<{ id: number }>("INSERT INTO messages (po_id, po_line_id, author, author_role, body, kind, document_id) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id", [poId, lineId, author, role, body.slice(0, 4000), kind, documentId]);
  return Number(r.rows[0]?.id);
}

export async function setPo(q: Queryable, id: string, fields: Record<string, unknown>) {
  const keys = Object.keys(fields);
  await q.query(`UPDATE purchase_orders SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(", ")}, updated_at = now() WHERE id = $1`, [id, ...keys.map((k) => fields[k])]);
}

export async function setting(q: Queryable, key: string): Promise<string | null> {
  return (await q.query<{ value: string }>("SELECT value FROM settings WHERE key = $1", [key])).rows[0]?.value ?? null;
}

export async function putSetting(q: Queryable, key: string, value: string) {
  await q.query("INSERT INTO settings (key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [key, value]);
}

export const who = (p: Person) => `${p.name} (${p.org_name ?? p.org_id})`;
