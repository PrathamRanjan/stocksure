/**
 * PayPal disputes on StockSure captures (roadmap B.7 / S7). The merchant behind the app credentials is the
 * wholesaler, so disputes are the supplier's to answer. The evidence pack is what StockSure already holds: the
 * accepted quote hash, the receipt both sides agreed, the resolution version and hash, the delivery documents.
 */
import { fmt } from "../core/money.js";
import { getDb } from "../db.js";
import { appendAudit } from "../guard/audit.js";
import { paypal, type PPDispute } from "../paypal/index.js";
import { docsOf, getPo, latestReceipt, latestResolution, linesOf, logEvent } from "../store.js";
import { startRun } from "../trace.js";
import { agreementFor } from "./agreements.js";

export async function syncDisputes(): Promise<number> {
  const db = await getDb();
  const disputes = await paypal().listDisputes({}).catch(() => [] as PPDispute[]);
  let linked = 0;
  for (const d of disputes) {
    const txn = d.disputed_transactions?.[0]?.seller_transaction_id;
    if (!txn) continue;
    const op = (await db.query<{ po_id: string }>("SELECT po_id FROM payment_ops WHERE paypal_id = $1 AND kind = 'capture'", [txn])).rows[0];
    if (!op) continue;
    const po = await getPo(db, op.po_id);
    if ((po as any).dispute_id !== d.dispute_id) {
      await db.query("UPDATE purchase_orders SET dispute_id = $2 WHERE id = $1", [po.id, d.dispute_id]);
      await logEvent(db, po, "dispute.opened", `PayPal dispute ${d.dispute_id} (${d.reason ?? "no reason"}) ${d.status} on capture ${txn}`, { dispute_id: d.dispute_id, capture_id: txn });
      linked++;
    }
    if (d.status === "WAITING_FOR_SELLER_RESPONSE") await provideEvidence(po.id, d.dispute_id);
  }
  return linked;
}

export type EvidenceOutcome = "sent" | "already_sent" | "no_evidence";

/** Sends the pack once per dispute. */
export async function provideEvidence(poId: string, disputeId: string): Promise<EvidenceOutcome> {
  const db = await getDb();
  const already = (await db.query("SELECT 1 FROM events WHERE po_id = $1 AND type = 'dispute.evidence_sent' AND data->>'dispute_id' = $2", [poId, disputeId])).rows.length > 0;
  if (already) return "already_sent";
  const pack = await evidencePack(poId);
  if (!pack) return "no_evidence";
  const po = await getPo(db, poId);
  const run = await startRun({ actor: "code", subject: `dispute evidence ${disputeId}`, entity: "po", entityId: poId }, db);
  const requestId = `ss-evidence-${disputeId}`;
  try {
    await run.timed({ actor: "paypal", tool: "provideDisputeEvidence", pp_request_id: requestId, gate: "allowed" }, () => paypal().provideDisputeEvidence(disputeId, { notes: pack.notes, evidenceType: "PROOF_OF_FULFILLMENT", trackingNumber: pack.tracking ?? undefined, carrier: pack.carrier ?? undefined }, requestId));
    await logEvent(db, po, "dispute.evidence_sent", `Evidence pack sent for ${disputeId}`, { dispute_id: disputeId, sha256: pack.hashes });
    await appendAudit("dispute.evidence_sent", "po", poId, { dispute_id: disputeId, hashes: pack.hashes }, db);
    await run.end("done");
    return "sent";
  } catch (e) {
    await logEvent(db, po, "dispute.evidence_error", (e as Error).message.slice(0, 300), { dispute_id: disputeId });
    await run.end("failed");
    throw e;
  }
}

export async function evidencePack(poId: string): Promise<{ notes: string; hashes: Record<string, string>; tracking: string | null; carrier: string | null } | null> {
  const db = await getDb();
  const po = await getPo(db, poId).catch(() => null);
  if (!po) return null;
  const lines = await linesOf(db, po.id);
  const rec = await latestReceipt(db, po.id);
  const res = await latestResolution(db, po.id);
  const docs = await docsOf(db, po.id);
  const agreement = await agreementFor(po.id);
  const ship = (await db.query<any>("SELECT tracking_number, carrier FROM shipments WHERE po_id = $1 AND tracking_number IS NOT NULL ORDER BY seq DESC LIMIT 1", [po.id])).rows[0];
  const hashes: Record<string, string> = {};
  if (agreement) hashes.agreement = agreement.hash;
  if (res) hashes.resolution = res.hash;
  for (const d of docs) if ((d as any).sha256) hashes[`doc:${(d as any).kind}:${d.id}`] = (d as any).sha256;
  const notes = [
    `StockSure order ${po.number}: ${po.buyer_name} bought from ${po.supplier_name}; deliver by ${new Date(po.deliver_by).toISOString().slice(0, 10)}.`,
    `Accepted quote v${po.accepted_quote_version ?? po.quote_version}: ${lines.map((l) => `${l.qty_packs} x ${l.product.sku} @ ${fmt(l.unit_price_cents ?? 0)}`).join(", ")}${agreement ? `; two-party agreement hash ${agreement.hash}, signed by buyer ${agreement.buyer_signed_by ?? "-"} and supplier ${agreement.supplier_signed_by ?? "-"}` : ""}.`,
    rec ? `Receipt v${rec.receipt.version} (${rec.receipt.status}) confirmed by ${rec.receipt.confirmed_by ?? "-"}: ${rec.lines.map((rl) => `${rl.accepted_units} accepted / ${rl.delivered_units} delivered (${rl.damaged_units} damaged, ${rl.wrong_units} wrong) ${rl.supplier_status}`).join("; ")}.` : "No receipt recorded.",
    res ? `Resolution v${res.version} ${res.status}: accepted ${fmt(res.body?.totals?.accepted_cents ?? 0)}; hash ${res.hash}; approved by ${[res.buyer_approved_by, res.supplier_approved_by].filter(Boolean).join(" and ") || "-"}.` : "No resolution recorded.",
    docs.length ? `Documents: ${docs.map((d: any) => `${d.kind} ${d.filename} sha256 ${d.sha256 ?? "-"}`).join("; ")}.` : "No documents uploaded.",
    `PayPal hold ${po.auth_id ?? "-"}; captures follow the agreed resolution only.`,
  ].join("\n");
  return { notes: notes.slice(0, 2000), hashes, tracking: ship?.tracking_number ?? null, carrier: ship?.carrier ?? null };
}

export async function disputesForSupplier(supplierId: string) {
  const db = await getDb();
  const pos = (await db.query<{ id: string; number: string; dispute_id: string; buyer_name: string }>("SELECT po.id, po.number, po.dispute_id, b.name AS buyer_name FROM purchase_orders po JOIN orgs b ON b.id = po.buyer_id WHERE po.supplier_id = $1 AND po.dispute_id IS NOT NULL ORDER BY po.created_at DESC", [supplierId])).rows;
  const out: { po_id: string; number: string; buyer_name: string; dispute: PPDispute | null }[] = [];
  for (const p of pos) out.push({ po_id: p.id, number: p.number, buyer_name: p.buyer_name, dispute: await paypal().getDispute(p.dispute_id).catch(() => null) });
  return out;
}
