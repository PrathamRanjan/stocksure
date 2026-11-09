/**
 * Two-party hashed agreement on an accepted quote (roadmap S5). The body is the exact commercial terms: lines,
 * unit prices, deadline, total. SHA-256 over the canonical body, HMAC with the server secret so a stored row
 * cannot be edited in place without detection. The buyer signs by accepting; the supplier countersigns by dispatching.
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { config } from "../config.js";
import { getDb, type Queryable } from "../db.js";
import { newId } from "../lib/ids.js";
import { linesOf, type PO } from "../store.js";

export interface AgreementBody {
  po_id: string;
  number: string;
  buyer_id: string;
  supplier_id: string;
  quote_version: number;
  deliver_by: string;
  currency: string;
  lines: { line_no: number; sku: string; qty_packs: number; unit_price_cents: number; substitutes: string[] }[];
  total_cents: number;
}

export interface Agreement {
  id: string;
  po_id: string;
  quote_version: number;
  body: AgreementBody;
  hash: string;
  hmac: string;
  buyer_signed_by: string | null;
  buyer_signed_at: Date | null;
  supplier_signed_by: string | null;
  supplier_signed_at: Date | null;
  created_at: Date;
}

const canonical = (b: AgreementBody) => JSON.stringify(b, Object.keys(b).sort());
export const agreementHash = (b: AgreementBody) => createHash("sha256").update(canonical(b)).digest("hex");
const mac = (hash: string) => createHmac("sha256", "ss-agreement:" + config.sessionSecret).update(hash).digest("hex");

export async function buildBody(q: Queryable, po: PO, quoteVersion: number): Promise<AgreementBody> {
  const lines = await linesOf(q, po.id);
  const out: AgreementBody = {
    po_id: po.id,
    number: po.number,
    buyer_id: po.buyer_id,
    supplier_id: po.supplier_id,
    quote_version: quoteVersion,
    deliver_by: new Date(po.deliver_by).toISOString(),
    currency: po.currency,
    lines: lines.map((l) => ({ line_no: l.line_no, sku: l.product.sku, qty_packs: l.qty_packs, unit_price_cents: l.unit_price_cents ?? 0, substitutes: [...l.substitutes].sort() })).sort((a, b) => a.line_no - b.line_no),
    total_cents: lines.reduce((a, l) => a + l.qty_packs * (l.unit_price_cents ?? 0), 0),
  };
  return out;
}

/** Buyer side: called inside acceptQuote's transaction. Idempotent per (po, version). */
export async function signAsBuyer(q: Queryable, po: PO, quoteVersion: number, by: string): Promise<Agreement> {
  const body = await buildBody(q, po, quoteVersion);
  const hash = agreementHash(body);
  const id = newId("agr");
  await q.query(
    `INSERT INTO agreements (id, po_id, quote_version, body, hash, hmac, buyer_signed_by, buyer_signed_at) VALUES ($1,$2,$3,$4,$5,$6,$7,now())
     ON CONFLICT (po_id, quote_version) DO UPDATE SET buyer_signed_by = coalesce(agreements.buyer_signed_by, EXCLUDED.buyer_signed_by), buyer_signed_at = coalesce(agreements.buyer_signed_at, now())`,
    [id, po.id, quoteVersion, JSON.stringify(body), hash, mac(hash), by],
  );
  return (await agreementFor(po.id, q))!;
}

/** Supplier side: called when the supplier dispatches against the accepted version. Refuses if the terms changed. */
export async function countersignAsSupplier(q: Queryable, po: PO, by: string): Promise<Agreement | null> {
  const v = po.accepted_quote_version;
  if (!v) return null;
  const a = await agreementFor(po.id, q);
  if (!a || a.quote_version !== v) return null;
  const now = await buildBody(q, po, v);
  if (agreementHash(now) !== a.hash) throw new Error(`Agreement ${a.id} no longer matches the order lines (hash ${a.hash.slice(0, 12)} vs ${agreementHash(now).slice(0, 12)}); dispatch refused.`);
  await q.query("UPDATE agreements SET supplier_signed_by = coalesce(supplier_signed_by, $2), supplier_signed_at = coalesce(supplier_signed_at, now()) WHERE id = $1", [a.id, by]);
  return (await agreementFor(po.id, q))!;
}

export async function agreementFor(poId: string, q?: Queryable): Promise<Agreement | null> {
  const db = q ?? (await getDb());
  const r = (await db.query<Agreement>("SELECT * FROM agreements WHERE po_id = $1 ORDER BY quote_version DESC LIMIT 1", [poId])).rows[0];
  return r ?? null;
}

/** Recomputes hash and HMAC: a tampered row fails one or both. */
export function verifyAgreement(a: Agreement): { hash_ok: boolean; hmac_ok: boolean } {
  const hash = agreementHash(a.body);
  const hash_ok = hash === a.hash;
  const m = Buffer.from(mac(a.hash));
  const stored = Buffer.from(a.hmac);
  return { hash_ok, hmac_ok: m.length === stored.length && timingSafeEqual(m, stored) };
}
