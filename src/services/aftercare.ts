import { getDb } from "../db.js";
import { dryRun } from "../guard/dryrun.js";
import { startRun } from "../trace.js";
import { enqueue } from "../jobs.js";
import { fmt } from "../core/money.js";
import { newId } from "../lib/ids.js";
import { GtError } from "../lib/util.js";
import { paypal, PayPalError, UnknownOutcomeError } from "../paypal/index.js";
import { latestReceipt, linesOf, logEvent, poFor, postMessage, who, type Person } from "../store.js";

/**
 * Late defects: stock that spoils or turns out damaged after it was accepted. The signed receipt is never edited;
 * the claim is its own record. An agreed claim is refunded on the PO's original PayPal capture, within what remains.
 */

/** Every completed capture on the PO with what is left to refund on it (a two-part delivery has two). Newest first. */
async function capturesOf(q: { query: any }, poId: string) {
  const caps = (await q.query("SELECT * FROM payment_ops WHERE po_id = $1 AND kind = 'capture' AND status = 'succeeded' AND paypal_id IS NOT NULL ORDER BY created_at DESC, id DESC", [poId])).rows as any[];
  const out: { id: string; captured: number; left: number }[] = [];
  for (const c of caps) {
    const refunded = (await q.query("SELECT COALESCE(SUM(amount_cents),0)::int AS s FROM payment_ops WHERE parent_paypal_id = $1 AND kind = 'refund' AND status IN ('planned','pending','succeeded')", [c.paypal_id])).rows[0].s as number;
    out.push({ id: c.paypal_id, captured: c.amount_cents, left: c.amount_cents - refunded });
  }
  return out;
}

async function captureOf(q: { query: any }, poId: string) {
  const caps = await capturesOf(q, poId);
  if (!caps.length) return null;
  return { id: caps[0].id, captured: caps.reduce((a, c) => a + c.captured, 0), left: caps.reduce((a, c) => a + c.left, 0) };
}

export async function reportDefect(person: Person, poId: string, lineId: string, units: number, note: string) {
  if (person.org_kind !== "buyer") throw new GtError("Only the buyer reports a defect.", "forbidden", 403);
  if (!Number.isInteger(units) || units <= 0) throw new GtError("Say how many units are affected.", "invalid");
  if (!note.trim()) throw new GtError("Say what is wrong (e.g. spoiled before its date).", "invalid");
  const db = await getDb();
  return db.tx(async (q) => {
    const po = await poFor(q, person, poId, true);
    const cap = await captureOf(q, po.id);
    if (!cap) throw new GtError(`${po.number} has no completed payment to refund against yet.`, "bad_state", 409);
    const line = (await linesOf(q, po.id)).find((l) => l.id === lineId);
    const rec = await latestReceipt(q, po.id);
    const rl = rec?.lines.find((l) => l.po_line_id === lineId);
    if (!line || !rl) throw new GtError("Line not found", "not_found", 404);
    const claimed = (await q.query<{ s: number }>("SELECT COALESCE(SUM(units),0)::int AS s FROM defect_claims WHERE po_line_id = $1 AND status <> 'disputed' AND status <> 'failed'", [lineId])).rows[0].s;
    if (units > rl.accepted_units - claimed) throw new GtError(`Only ${rl.accepted_units - claimed} accepted unit(s) of ${line.product.sku} are left to claim on.`, "too_many", 409);
    const amount = Math.round((units * (line.unit_price_cents ?? 0)) / line.product.pack_units);
    if (amount > cap.left) throw new GtError(`Only ${fmt(cap.left)} of the payment is left to refund.`, "too_much", 409);
    const id = newId("dc");
    await q.query("INSERT INTO defect_claims (id, po_id, po_line_id, units, amount_cents, note, status, reported_by, capture_id) VALUES ($1,$2,$3,$4,$5,$6,'reported',$7,$8)", [id, po.id, lineId, units, amount, note.trim().slice(0, 1000), who(person), cap.id]);
    await postMessage(q, po.id, lineId, who(person), person.role, `Reported a late defect: ${units} unit(s) of ${line.product.sku}: ${note.trim()}. Asking for ${fmt(amount)} back. The signed receipt stays as it was.`, "message");
    await logEvent(q, po, "defect.reported", `${who(person)} reported ${units} defective unit(s) of ${line.product.sku} (${fmt(amount)})`, { claim: id }, who(person));
    return id;
  });
}

export async function decideDefect(person: Person, claimId: string, agree: boolean, note: string) {
  if (person.org_kind !== "supplier") throw new GtError("The supplier decides on a defect claim.", "forbidden", 403);
  const db = await getDb();
  await db.tx(async (q) => {
    const c = (await q.query<any>("SELECT * FROM defect_claims WHERE id = $1 FOR UPDATE", [claimId])).rows[0];
    if (!c) throw new GtError("Claim not found", "not_found", 404);
    const po = await poFor(q, person, c.po_id, true);
    if (c.status !== "reported") return;
    if (!agree) {
      if (!note.trim()) throw new GtError("Say why you dispute it.", "invalid");
      await q.query("UPDATE defect_claims SET status = 'disputed', decided_by = $2, decision_note = $3 WHERE id = $1", [c.id, who(person), note.trim().slice(0, 1000)]);
      await postMessage(q, po.id, c.po_line_id, who(person), person.role, `Disputed the defect claim: ${note.trim()}`, "message");
      return;
    }
    const caps = await capturesOf(q, po.id);
    const left = caps.reduce((a, x) => a + x.left, 0);
    if (!caps.length || c.amount_cents > left) throw new GtError(`Only ${fmt(left)} of the payment is left to refund; this claim is ${fmt(c.amount_cents)}.`, "too_much", 409);
    await q.query("UPDATE defect_claims SET status = 'refunding', decided_by = $2, decision_note = $3 WHERE id = $1", [c.id, who(person), note.trim().slice(0, 1000)]);
    // Spread across the captures, newest first. Each part is recorded before it is sent, under its own request id.
    let remaining = c.amount_cents;
    let n = 0;
    const parts: string[] = [];
    for (const cap of caps) {
      if (remaining <= 0) break;
      const take = Math.min(cap.left, remaining);
      if (take <= 0) continue;
      n++;
      await q.query("INSERT INTO payment_ops (id, po_id, root_id, kind, status, amount_cents, request_id, parent_paypal_id) VALUES ($1,$2,$3,'refund','planned',$4,$5,$6) ON CONFLICT (request_id) DO NOTHING", [newId("op"), po.id, po.root_id, take, `defect:${c.id}:${n}`, cap.id]);
      parts.push(`${fmt(take)} on capture ${cap.id}`);
      remaining -= take;
    }
    // Spoiled or damaged stock is no longer usable: it leaves the buyer's stock (never below zero).
    const line = (await q.query<any>("SELECT product_id FROM po_lines WHERE id = $1", [c.po_line_id])).rows[0];
    const have = (await q.query<any>("SELECT units FROM stock WHERE buyer_id = $1 AND product_id = $2", [po.buyer_id, line.product_id])).rows[0]?.units ?? 0;
    const out = Math.min(have, c.units);
    if (out > 0) {
      await q.query("INSERT INTO stock_moves (buyer_id, product_id, delta, reason, po_id, source_key) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (source_key) DO NOTHING", [po.buyer_id, line.product_id, -out, `Defect claim on ${po.number}: removed from stock`, po.id, `defect:${c.id}`]);
      await q.query("UPDATE stock SET units = units - $3 WHERE buyer_id = $1 AND product_id = $2", [po.buyer_id, line.product_id, out]);
    }
    await postMessage(q, po.id, c.po_line_id, who(person), person.role, `Agreed the defect claim: ${fmt(c.amount_cents)} will be refunded to the original PayPal payment${n > 1 ? ` (${n} captures)` : ""}.`, "message");
    await logEvent(q, po, "defect.agreed", `${who(person)} agreed claim ${c.id}: refund ${parts.join(" + ")}; ${out} unit(s) removed from stock`, { claim: c.id }, who(person));
  });
  if (agree) await executeDefectRefund(claimId);
}

/**
 * Sends (or re-sends with the same request id) each part of the claim's refund and records PayPal's answers. The claim
 * is refunded when every part is COMPLETED; PENDING waits; a refusal of any part needs a person.
 */
export async function executeDefectRefund(claimId: string) {
  const db = await getDb();
  const c = (await db.query<any>("SELECT d.*, p.currency, p.root_id, p.buyer_id, p.supplier_id, p.number FROM defect_claims d JOIN purchase_orders p ON p.id = d.po_id WHERE d.id = $1", [claimId])).rows[0];
  if (!c || c.status !== "refunding") return;
  const ops = (await db.query<any>("SELECT * FROM payment_ops WHERE request_id = $1 OR request_id LIKE $2 ORDER BY request_id", [`defect:${c.id}`, `defect:${c.id}:%`])).rows;
  let waiting = false;
  for (const op of ops) {
    if (op.status === "succeeded") continue;
    const r = await refundPart(c, op);
    if (r === "failed") return;
    if (r === "held") return; // the owner's approval re-queues this job (guard/release.ts)
    if (r === "waiting") waiting = true;
  }
  if (waiting) {
    await enqueue(db, "defect_refund", { claimId }, new Date(Date.now() + 60_000), `defect:${claimId}`);
    return;
  }
  const all = (await db.query<any>("SELECT * FROM payment_ops WHERE request_id = $1 OR request_id LIKE $2", [`defect:${c.id}`, `defect:${c.id}:%`])).rows;
  if (!all.every((o) => o.status === "succeeded" && o.paypal_status === "COMPLETED")) return;
  await db.tx(async (q) => {
    const moved = (await q.query("UPDATE defect_claims SET status = 'refunded' WHERE id = $1 AND status = 'refunding' RETURNING id", [claimId])).rows.length;
    if (!moved) return;
    await postMessage(q, c.po_id, c.po_line_id, "StockSure", "system", `Refunded ${fmt(c.amount_cents)} to the original PayPal payment (refund ${all.map((o) => o.paypal_id).join(", ")}).`, "system");
    await logEvent(q, { id: c.po_id, root_id: c.root_id }, "paypal.refund", `Defect refund ${fmt(c.amount_cents)}: ${all.map((o) => `${fmt(o.amount_cents)} ${o.paypal_id} on ${o.parent_paypal_id}`).join(" + ")} COMPLETED`, { claim: claimId });
  });
}

/** One part of a claim's refund, on one capture. */
async function refundPart(c: any, op: any): Promise<"done" | "waiting" | "failed" | "held"> {
  const db = await getDb();
  const pp = paypal();
  let status: string;
  let refundId: string;
  const run = await startRun({ actor: "code", subject: `defect refund ${c.number ?? c.po_id} ${fmt(op.amount_cents)}`, entity: "claim", entityId: c.id }, db);
  try {
    if (op.paypal_id) {
      const r = await pp.getRefund(op.paypal_id);
      status = r.status;
      refundId = r.id;
    } else {
      // B.6: the refund is the supplier's money leaving; its mandate and kill switch apply, the buyer's kill switch too.
      const verdict = await dryRun({ action: "refund", ownerId: c.supplier_id, agentScope: `org:${c.buyer_id}`, entity: "claim", entityId: c.id, cents: op.amount_cents, trustedCents: [op.amount_cents, c.amount_cents], captureId: op.parent_paypal_id }, run, db);
      if (verdict.gate === "held") {
        await run.end("held");
        if (verdict.fresh) await postMessage(db, c.po_id, c.po_line_id, "StockSure", "system", `Refund of ${fmt(op.amount_cents)} waits for approval: ${verdict.reason}`, "system");
        return "held";
      }
      if (verdict.gate !== "allowed") {
        await run.end("failed");
        await db.query("UPDATE payment_ops SET status = 'failed', error = $2 WHERE id = $1", [op.id, `guard: ${verdict.reason}`]);
        await db.query("UPDATE defect_claims SET status = 'failed' WHERE id = $1", [c.id]);
        await postMessage(db, c.po_id, c.po_line_id, "StockSure", "system", `The guard refused the defect refund before PayPal: ${verdict.reason}. Needs a person.`, "system");
        return "failed";
      }
      await db.query("UPDATE payment_ops SET status = 'pending', attempts = attempts + 1, updated_at = now() WHERE id = $1", [op.id]);
      const r = await run.timed({ actor: "paypal", tool: "refundCapture", pp_request_id: op.request_id, gate: "allowed" }, () => pp.refundCapture(op.parent_paypal_id, op.amount_cents, c.currency, `Late defect: ${c.note}`.slice(0, 255), op.request_id), (r) => ({ refund_id: r.id, status: r.status }));
      status = r.status;
      refundId = r.id;
    }
    await run.end("done");
  } catch (e) {
    await run.end("failed");
    const uncertain = e instanceof UnknownOutcomeError || (e instanceof PayPalError && e.status >= 500);
    await db.query("UPDATE payment_ops SET error = $2, updated_at = now() WHERE id = $1", [op.id, (e as Error).message.slice(0, 300)]);
    if (uncertain) return "waiting";
    await db.query("UPDATE payment_ops SET status = 'failed' WHERE id = $1", [op.id]);
    await db.query("UPDATE defect_claims SET status = 'failed' WHERE id = $1", [c.id]);
    await postMessage(db, c.po_id, c.po_line_id, "StockSure", "system", `PayPal refused the defect refund: ${(e as Error).message}. Needs a person.`, "system");
    return "failed";
  }
  if (status === "COMPLETED") {
    await db.query("UPDATE payment_ops SET status = 'succeeded', paypal_id = $2, paypal_status = 'COMPLETED', error = NULL, updated_at = now() WHERE id = $1 AND status <> 'succeeded'", [op.id, refundId]);
    return "done";
  }
  if (status === "PENDING") {
    await db.query("UPDATE payment_ops SET paypal_id = $2, paypal_status = 'PENDING', updated_at = now() WHERE id = $1", [op.id, refundId]);
    return "waiting";
  }
  await db.query("UPDATE payment_ops SET status = 'failed', paypal_id = $2, paypal_status = $3 WHERE id = $1", [op.id, refundId, status]);
  await db.query("UPDATE defect_claims SET status = 'failed' WHERE id = $1", [c.id]);
  return "failed";
}

export async function claimsOf(q: { query: any }, poId: string) {
  return (await q.query("SELECT d.*, l.line_no, pr.sku FROM defect_claims d JOIN po_lines l ON l.id = d.po_line_id JOIN products pr ON pr.id = l.product_id WHERE d.po_id = $1 ORDER BY d.created_at", [poId])).rows as any[];
}
