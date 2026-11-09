/**
 * Reauthorize a hold after PayPal's 3-day honor period (roadmap B.7 / S7). A hold that is still live and not yet
 * captured gets a fresh authorization for the same amount; the order keeps funding without a new acceptance.
 * Runs through the money gate like every other PayPal write.
 */
import { config } from "../config.js";
import { getDb } from "../db.js";
import { enqueue } from "../jobs.js";
import type { Queryable } from "../db.js";
import { fmt } from "../core/money.js";
import { newId } from "../lib/ids.js";
import { appendAudit } from "../guard/audit.js";
import { dryRun } from "../guard/dryrun.js";
import { paypal, PayPalError, UnknownOutcomeError } from "../paypal/index.js";
import { getPo, logEvent, postMessage, type PaymentOp } from "../store.js";
import { startRun } from "../trace.js";

/** States in which the hold is still the live instrument (nothing captured yet). */
const REAUTH_STATES = new Set(["funded", "dispatched", "in_review", "resolving"]);

export function scheduleReauthorize(q: Queryable, poId: string, from = Date.now()) {
  return enqueue(q, "reauthorize_hold", { poId }, new Date(from + config.guard.reauthorizeAfterDays * 864e5 + 60_000), `reauth:${poId}`);
}

export async function reauthorizeHold(poId: string): Promise<void> {
  const db = await getDb();
  const po = await getPo(db, poId);
  if (!po.auth_id || !REAUTH_STATES.has(po.status) || (po as any).reauthorized_at) return;
  const holdOp = (await db.query<PaymentOp>("SELECT * FROM payment_ops WHERE paypal_id = $1 AND kind = 'authorize'", [po.auth_id])).rows[0];
  if (!holdOp) return;
  const run = await startRun({ actor: "code", subject: `reauthorize hold ${po.number}`, entity: "po", entityId: po.id }, db);
  const gate = await dryRun({ action: "reauthorize", ownerId: po.buyer_id, agentScope: `org:${po.buyer_id}`, entity: "po", entityId: po.id, cents: holdOp.amount_cents, trustedCents: [holdOp.amount_cents], authorizationId: po.auth_id }, run, db);
  if (gate.gate !== "allowed") {
    await run.end(gate.gate === "held" ? "held" : "failed");
    await logEvent(db, po, "paypal.reauthorize.skipped", `Reauthorize not allowed: ${gate.reason}`);
    return;
  }
  const requestId = `reauth:${po.id}:${po.auth_id}`;
  const oldAuth = po.auth_id;
  await db.query("INSERT INTO payment_ops (id, po_id, root_id, kind, status, amount_cents, request_id, parent_paypal_id, paypal_order_id) VALUES ($1,$2,$3,'reauthorize','pending',$4,$5,$6,$7) ON CONFLICT (request_id) DO NOTHING", [newId("op"), po.id, po.root_id, holdOp.amount_cents, requestId, oldAuth, holdOp.paypal_order_id]);
  const t0 = Date.now();
  try {
    const a = await paypal().reauthorize(oldAuth, requestId);
    await run.step({ actor: "paypal", tool: "reauthorize", pp_request_id: requestId, result: { authorization_id: a.id, status: a.status }, duration_ms: Date.now() - t0, gate: "allowed" });
    await db.tx(async (q) => {
      await q.query("UPDATE payment_ops SET status = 'succeeded', paypal_id = $2, paypal_status = $3, updated_at = now() WHERE request_id = $1", [requestId, a.id, a.status]);
      // The old hold is superseded at PayPal; the new one carries the order from here.
      await q.query("UPDATE payment_ops SET paypal_status = 'VOIDED', updated_at = now() WHERE paypal_id = $1 AND kind = 'authorize'", [oldAuth]);
      await q.query("INSERT INTO payment_ops (id, po_id, root_id, kind, status, amount_cents, request_id, paypal_id, paypal_status, paypal_order_id) VALUES ($1,$2,$3,'authorize','succeeded',$4,$5,$6,$7,$8)", [newId("op"), po.id, po.root_id, holdOp.amount_cents, `${requestId}:new`, a.id, a.status, holdOp.paypal_order_id]);
      await q.query("UPDATE purchase_orders SET auth_id = $2, reauthorized_at = now() WHERE id = $1", [po.id, a.id]);
      await logEvent(q, po, "paypal.reauthorized", `Hold ${oldAuth} re-authorized after the honor period as ${a.id} (${a.status}, ${fmt(holdOp.amount_cents)})`, { old_authorization_id: oldAuth, authorization_id: a.id });
      await postMessage(q, po.id, null, "StockSure", "system", `PayPal hold refreshed: ${a.id} for ${fmt(holdOp.amount_cents)}. Nothing was charged.`, "system");
    });
    await appendAudit("money.reauthorized", "po", po.id, { old_authorization_id: oldAuth, authorization_id: a.id, cents: holdOp.amount_cents }, db);
    await run.end("done");
  } catch (e) {
    await run.step({ actor: "paypal", tool: "reauthorize", pp_request_id: requestId, pp_debug_id: e instanceof PayPalError ? e.debugId ?? null : null, result: { error: (e as Error).message.slice(0, 300) }, duration_ms: Date.now() - t0, gate: "denied" });
    await db.query("UPDATE payment_ops SET status = 'failed', error = $2, updated_at = now() WHERE request_id = $1", [requestId, (e as Error).message]);
    await logEvent(db, po, "paypal.reauthorize.error", (e as Error).message.slice(0, 300));
    await run.end("failed");
    if (e instanceof UnknownOutcomeError || (e instanceof PayPalError && e.status >= 500)) throw e; // job retry, same request id
  }
}
