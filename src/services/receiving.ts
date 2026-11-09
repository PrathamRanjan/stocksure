import { getDb, type Queryable } from "../db.js";
import { extractDelivery, observePhoto, type DamageHint, type DeliveryExtraction } from "../ai/extract.js";
import { formatUnits, parseQuantity, type UnitSpec } from "../core/units.js";
import { newId } from "../lib/ids.js";
import { GtError } from "../lib/util.js";
import { closeRisksOnDelivery } from "./supply-watch.js";
import { deliveryContext, startPartCharge } from "./parts.js";
import { latestReceipt, linesOf, logEvent, poFor, postMessage, setPo, who, type Person, type PO, type PoLine, type ReceiptLine } from "../store.js";
import { notifyOrder } from "../channels/handlers.js";
import { candidates, isText, storeDoc, type UploadFile } from "./orders.js";
import { proposeResolution } from "./resolution.js";

/** Receiving uploads a delivery note or photo; extraction makes a proposal only. */
export async function uploadReceivingDoc(person: Person, poId: string, kind: "delivery_note" | "photo", f: UploadFile) {
  if (person.org_kind !== "buyer") throw new GtError("Only the buyer's team uploads receiving documents.", "forbidden", 403);
  const db = await getDb();
  const po = await poFor(db, person, poId);
  if (!["dispatched", "in_review"].includes(po.status)) throw new GtError(`${po.number} is ${po.status.replace(/_/g, " ")}; nothing to receive.`, "bad_state", 409);
  const cands = await candidates(db, po);
  const text = isText(f.mime, f.filename) ? f.body.toString("utf8") : null;
  let ex: DeliveryExtraction | null = null;
  let hint: DamageHint | null = null;
  if (kind === "delivery_note") ex = await extractDelivery({ mime: f.mime, body: f.body, text }, cands);
  else hint = await observePhoto({ mime: f.mime, body: f.body, text: null }, cands);
  return db.tx(async (q) => {
    const d = await storeDoc(q, po.id, kind, f, who(person), ex?.instructions ?? []);
    const lines = ex?.lines ?? [];
    const damage = ex?.damage ?? (hint ? [hint] : []);
    await q.query("INSERT INTO extractions (id, document_id, source, lines, flags) VALUES ($1,$2,$3,$4,$5)", [newId("ex"), d.id, ex?.source ?? (hint ? "model-photo" : "none"), JSON.stringify({ lines, damage, notes: ex?.notes ?? [] }), JSON.stringify(ex?.instructions ?? [])]);
    if (ex?.instructions.length) await postMessage(q, po.id, null, "StockSure", "system", `${f.filename}: ${ex.instructions.length} instruction-like line(s) removed before reading. Documents cannot change counts, payee or amounts.`, "system", d.id);
    if (hint) await postMessage(q, po.id, hint.line_id, "StockSure", "system", `AI photo note (unverified): ${hint.text}`, "system", d.id);
    await logEvent(q, po, "doc.uploaded", `${who(person)} uploaded ${kind.replace("_", " ")} ${f.filename}`, { document_id: d.id, lines: lines.length, flags: ex?.instructions.length ?? 0 }, who(person));
    return d.id;
  });
}

export interface LineProposal {
  line_id: string;
  delivered: number | null;
  damaged: number;
  wrong: number;
  flags: string[];
  confidence: number | null;
  hints: string[];
  source: string | null;
}

/** Merges the latest delivery-note extraction and photo notes into a prefill per PO line. Nothing here is confirmed. */
export async function proposalFor(q: Queryable, po: PO): Promise<{ lines: Map<string, LineProposal>; unmatched: any[]; notes: string[]; instructions: any[] }> {
  const poLines = await linesOf(q, po.id);
  const exs = (
    await q.query<any>("SELECT e.*, d.kind, d.filename FROM extractions e JOIN documents d ON d.id = e.document_id WHERE d.po_id = $1 AND d.kind IN ('delivery_note','photo') ORDER BY e.created_at", [po.id])
  ).rows.map((e) => ({ ...e, lines: typeof e.lines === "string" ? JSON.parse(e.lines) : e.lines, flags: typeof e.flags === "string" ? JSON.parse(e.flags) : e.flags }));
  const note = [...exs].reverse().find((e) => e.kind === "delivery_note");
  const out = new Map<string, LineProposal>();
  for (const l of poLines) out.set(l.id, { line_id: l.id, delivered: null, damaged: 0, wrong: 0, flags: [], confidence: null, hints: [], source: null });
  const unmatched: any[] = [];
  if (note) {
    for (const pl of note.lines.lines ?? []) {
      const p = pl.line_id ? out.get(pl.line_id) : null;
      if (!p) {
        unmatched.push(pl);
        continue;
      }
      p.delivered = (p.delivered ?? 0) + (pl.units ?? 0);
      p.flags.push(...pl.flags);
      p.confidence = pl.confidence;
      p.source = `${note.filename} (${note.source})`;
      p.hints.push(`Note says "${pl.qty_text}" for ${pl.sku ?? pl.description}`, ...pl.notes);
    }
  }
  for (const e of exs) {
    if (e.kind === "photo" || e === note) {
      for (const d of e.lines.damage ?? []) {
        const p = d.line_id ? out.get(d.line_id) : null;
        if (!p) continue;
        if (d.kind === "damaged" && d.source === "note" && d.units) p.damaged = Math.max(p.damaged, d.units);
        if (d.kind === "wrong" && d.units) p.wrong = Math.max(p.wrong, d.units);
        if (!p.flags.includes("possible_damage") && d.kind === "damaged") p.flags.push("possible_damage");
        p.hints.push(`${d.source === "photo" ? "Photo" : "Note"} (unverified): ${d.text}`);
      }
    }
  }
  for (const p of out.values()) {
    p.flags = [...new Set(p.flags)];
    if (p.delivered === null && note) p.flags.push("not_on_note");
  }
  return { lines: out, unmatched, notes: note?.lines.notes ?? [], instructions: note?.flags ?? [] };
}

/** People enter counts as "18 cs", "2", "6 ea". A bare number means packs. */
export function humanUnits(text: string, spec: UnitSpec, label: string): number {
  const t = String(text ?? "").trim();
  if (!t) return 0;
  const q = parseQuantity(/^\d+$/.test(t) ? `${t} ${spec.pack_label}` : t, spec);
  if (q.units === null) throw new GtError(`${label}: ${q.reason ?? "cannot read the quantity"}`, "invalid");
  if (q.uncertain && q.reason?.includes("not a whole number")) throw new GtError(`${label}: ${q.reason}`, "invalid");
  if (q.units < 0) throw new GtError(`${label} cannot be negative.`, "invalid");
  return q.units;
}

export interface CountInput {
  delivered: string;
  damaged: string;
  wrong: string;
  note: string;
}

const exact = (expected: number, d: number, dmg: number, wrong: number) => d === expected && dmg === 0 && wrong === 0;

/** A person confirms what arrived. Creates receipt version N; unchanged agreed lines keep their agreement. */
export async function confirmReceipt(person: Person, poId: string, counts: Record<string, CountInput>) {
  if (person.org_kind !== "buyer" || !["receiving", "owner"].includes(person.role)) throw new GtError("Only the buyer's receiving person or owner can confirm a delivery.", "forbidden", 403);
  const db = await getDb();
  const result = await db.tx(async (q) => {
    const po = await poFor(q, person, poId, true);
    if (!["dispatched", "in_review"].includes(po.status)) throw new GtError(`${po.number} is ${po.status.replace(/_/g, " ")}; the receipt is locked.`, "bad_state", 409);
    const lines = await linesOf(q, po.id);
    const prev = await latestReceipt(q, po.id);
    const prevBy = new Map((prev?.lines ?? []).map((l) => [l.po_line_id, l]));
    const prop = await proposalFor(q, po);
    // After a charged part, people count only this delivery; the receipt adds the agreed part to it.
    const ctx = await deliveryContext(q, po, lines);
    const parsed = lines.map((l) => {
      const c = counts[l.id];
      if (!c) throw new GtError(`Enter counts for line ${l.line_no}.`, "invalid");
      const d0 = humanUnits(c.delivered, l.product, `Line ${l.line_no} delivered`);
      const g0 = humanUnits(c.damaged, l.product, `Line ${l.line_no} damaged`);
      const w0 = humanUnits(c.wrong, l.product, `Line ${l.line_no} wrong item`);
      if (g0 + w0 > d0) throw new GtError(`Line ${l.line_no}: damaged + wrong (${g0 + w0}) is more than delivered (${d0}).`, "invalid");
      const b = ctx.base.get(l.id) ?? { delivered: 0, damaged: 0, wrong: 0, accepted: 0 };
      const delivered = d0 + b.delivered;
      const damaged = g0 + b.damaged;
      const wrong = w0 + b.wrong;
      const expectedNow = ctx.mode === "part" ? (ctx.expected.get(l.id) ?? 0) : l.qty_packs * l.product.pack_units;
      return { l, delivered, damaged, wrong, accepted: delivered - damaged - wrong, expected: expectedNow, note: String(c.note ?? "").slice(0, 500) };
    });
    const changed = prev ? parsed.filter((p) => {
      const o = prevBy.get(p.l.id);
      return !o || o.delivered_units !== p.delivered || o.damaged_units !== p.damaged || o.wrong_units !== p.wrong;
    }) : parsed;
    if (prev && !changed.length) return { po, receiptId: prev.receipt.id, version: prev.receipt.version, unchanged: true };
    const version = (prev?.receipt.version ?? 0) + 1;
    const rid = newId("rc");
    if (prev) await q.query("UPDATE receipts SET status = 'superseded' WHERE id = $1", [prev.receipt.id]);
    await q.query("INSERT INTO receipts (id, po_id, version, status, confirmed_by) VALUES ($1,$2,$3,'confirmed',$4)", [rid, po.id, version, who(person)]);
    for (const p of parsed) {
      const o = prevBy.get(p.l.id);
      const same = o && o.delivered_units === p.delivered && o.damaged_units === p.damaged && o.wrong_units === p.wrong;
      const status: ReceiptLine["supplier_status"] = exact(p.expected, p.delivered, p.damaged, p.wrong) ? "agreed" : same && o!.supplier_status === "agreed" ? "agreed" : "pending";
      const pr = prop.lines.get(p.l.id);
      await q.query(
        "INSERT INTO receipt_lines (receipt_id, po_line_id, delivered_units, accepted_units, damaged_units, wrong_units, note, proposal, supplier_status, supplier_note, reviewed_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
        [rid, p.l.id, p.delivered, p.accepted, p.damaged, p.wrong, p.note, JSON.stringify(pr ?? null), status, status === "agreed" && same ? o!.supplier_note : "", status === "agreed" ? (same ? o!.reviewed_by : "auto: matches the order") : null],
      );
      // Stock ledger: post the difference from the previous version.
      const delta = p.accepted - (o?.accepted_units ?? 0);
      if (delta !== 0) {
        await q.query("INSERT INTO stock_moves (buyer_id, product_id, delta, reason, po_id, source_key) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (source_key) DO NOTHING", [po.buyer_id, p.l.product_id, delta, o ? `Receipt v${version} correction` : `Received ${po.number}`, po.id, `receipt:${rid}:${p.l.id}`]);
        await q.query("INSERT INTO stock (buyer_id, product_id, units) VALUES ($1,$2,$3) ON CONFLICT (buyer_id, product_id) DO UPDATE SET units = stock.units + EXCLUDED.units", [po.buyer_id, p.l.product_id, delta]);
      }
      if (status === "pending")
        await postMessage(q, po.id, p.l.id, who(person), person.role, `Receipt v${version}: delivered ${formatUnits(p.delivered, p.l.product)}, damaged ${formatUnits(p.damaged, p.l.product)}, wrong ${formatUnits(p.wrong, p.l.product)}, accepted ${formatUnits(p.accepted, p.l.product)}.${p.note ? ` ${p.note}` : ""}`, "system");
    }
    await setPo(q, po.id, { status: "in_review", received_at: po.received_at ?? new Date() });
    // A first part is not the delivery the warning is about: it stays open until the rest arrives.
    if (ctx.mode !== "part") await closeRisksOnDelivery(q, po);
    await logEvent(q, po, "receipt.confirmed", `${who(person)} confirmed receipt v${version}`, { receipt_id: rid, changed: changed.length }, who(person));
    await notifyOrder("supplier", po.supplier_id, `${po.buyer_name} confirmed receipt v${version} of ${po.number}${changed.length ? `; ${changed.length} line(s) differ from the order and wait for your agreement` : "; it matches the order"}.`, po.id, q).catch(() => undefined);
    return { po, receiptId: rid, version, unchanged: false };
  });
  await maybeAdvance(poId);
  return result;
}

/** What the supplier is agreeing to: this receipt version's counts for one line. A changed count changes it. */
export const lineFingerprint = (version: number, l: { po_line_id: string; delivered_units: number; accepted_units: number; damaged_units: number; wrong_units: number }) =>
  `v${version}:${l.po_line_id}:${l.delivered_units}/${l.accepted_units}/${l.damaged_units}/${l.wrong_units}`;

export async function supplierReview(person: Person, poId: string, lineId: string, action: "agree" | "dispute", note: string, seen: string) {
  if (person.role !== "supplier") throw new GtError("Only the supplier reviews receipt lines.", "forbidden", 403);
  if (action === "dispute" && !note.trim()) throw new GtError("Say what you dispute so the buyer can check.", "invalid");
  const db = await getDb();
  await db.tx(async (q) => {
    const po = await poFor(q, person, poId, true);
    if (po.status !== "in_review") throw new GtError(`${po.number} is ${po.status.replace(/_/g, " ")}; the receipt is not open for review.`, "bad_state", 409);
    const rec = await latestReceipt(q, po.id);
    const line = rec?.lines.find((l) => l.po_line_id === lineId);
    if (!rec || !line) throw new GtError("Line not found", "not_found", 404);
    if (seen !== lineFingerprint(rec.receipt.version, line)) {
      throw new GtError(`The receipt changed since you looked: it is now v${rec.receipt.version} (delivered ${line.delivered_units}, accepted ${line.accepted_units}, damaged ${line.damaged_units}, wrong ${line.wrong_units}). Review the new counts.`, "stale", 409);
    }
    const status = action === "agree" ? "agreed" : "disputed";
    if (line.supplier_status === status && line.supplier_note === note.trim()) return;
    await q.query("UPDATE receipt_lines SET supplier_status = $3, supplier_note = $4, reviewed_by = $5 WHERE receipt_id = $1 AND po_line_id = $2", [rec.receipt.id, lineId, status, note.trim().slice(0, 1000), who(person)]);
    await postMessage(q, po.id, lineId, who(person), "supplier", action === "agree" ? `Agreed receipt v${rec.receipt.version} for this line.${note.trim() ? ` ${note.trim()}` : ""}` : `Disputed: ${note.trim()}`, "system");
    await logEvent(q, po, `receipt.${status}`, `${who(person)} ${status} line ${lineId} of receipt v${rec.receipt.version}`, { note }, who(person));
  });
  await maybeAdvance(poId);
}

export async function postLineMessage(person: Person, poId: string, lineId: string | null, body: string) {
  if (!body.trim()) throw new GtError("Write a message.", "invalid");
  const db = await getDb();
  const po = await poFor(db, person, poId);
  if (lineId && !(await linesOf(db, po.id)).some((l) => l.id === lineId)) throw new GtError("Line not found", "not_found", 404);
  await postMessage(db, po.id, lineId, who(person), person.role, body.trim());
}

/** When every line of the latest receipt is agreed, the resolution is generated (or the clean order settles). */
export async function maybeAdvance(poId: string) {
  const db = await getDb();
  await db.tx(async (q) => {
    const po = (await q.query<PO>("SELECT * FROM purchase_orders WHERE id = $1 FOR UPDATE", [poId])).rows[0];
    if (!po || po.status !== "in_review") return;
    const rec = await latestReceipt(q, po.id);
    if (!rec || rec.lines.some((l) => l.supplier_status !== "agreed")) return;
    // A part delivery is charged on its own; the resolution waits for the rest.
    if (await startPartCharge(q, po, rec.receipt.version, new Map(rec.lines.map((l) => [l.po_line_id, l.accepted_units])))) return;
    await setPo(q, po.id, { agreed_at: new Date() });
    await logEvent(q, po, "receipt.agreed", `Both sides agree receipt v${rec.receipt.version}`);
    await proposeResolution(q, po.id, {}, "system");
  });
}
