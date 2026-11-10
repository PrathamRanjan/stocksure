import type { Request, Response } from "express";
import { config } from "./config.js";
import { getDb, withWorkspace, WS_ID } from "./db.js";
import { enqueue } from "./jobs.js";
import { paypal } from "./paypal/index.js";
import { postMessage } from "./store.js";

/** Stores every event once; acts only on events PayPal verifies, and acting means re-running read-back paths. */
export async function receiveWebhook(req: Request, res: Response) {
  const body = req.body ?? {};
  const id = String(body.id ?? "");
  if (!id || !body.event_type) return res.status(400).json({ error: "not a PayPal event" });
  const headers: Record<string, string | undefined> = {};
  for (const h of ["paypal-auth-algo", "paypal-cert-url", "paypal-transmission-id", "paypal-transmission-sig", "paypal-transmission-time"]) headers[h] = req.header(h) ?? undefined;
  let verified = false;
  if (config.paypal.webhookId) verified = await paypal().verifyWebhookSignature(headers, body, config.paypal.webhookId).catch(() => false);
  const db = await getDb();
  const ws = await workspaceForEvent(body);
  const r = await withWorkspace(null, () => db.query("INSERT INTO webhook_events (id, event_type, resource_id, body, verified, ws_id) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING RETURNING id", [id, String(body.event_type), String(body.resource?.id ?? ""), JSON.stringify(body), verified, ws]));
  if (!verified) return res.status(400).json({ error: "signature not verified" });
  // The event is processed inside the workspace whose order it is about (or the base schema).
  if (r.rows.length) await withWorkspace(ws, () => enqueue(db, "process_webhook", { eventId: id }, new Date(), `wh:${id}`));
  res.json({ ok: true });
}

/**
 * Spec A1.1: which workspace an event belongs to. First the resource's custom_id ("<workspace>:<order id>", set on
 * every order a workspace creates), then the ids recorded when the workspace created them. Null: the base schema.
 */
export async function workspaceForEvent(body: any): Promise<string | null> {
  const res = body?.resource ?? {};
  const custom = String(res.custom_id ?? res.purchase_units?.[0]?.custom_id ?? "");
  const m = /^([a-z0-9]{6,24}):/.exec(custom);
  const db = await getDb();
  const known = async (ws: string) => (await withWorkspace(null, () => db.query("SELECT 1 FROM workspaces WHERE id = $1", [ws]))).rows.length > 0;
  if (m && WS_ID.test(m[1]) && (await known(m[1]))) return m[1];
  const related = res.supplementary_data?.related_ids ?? {};
  const ids = [res.id, related.authorization_id, related.order_id, related.capture_id].filter((x) => typeof x === "string" && x);
  if (!ids.length) return null;
  const row = (await withWorkspace(null, () => db.query<{ ws_id: string }>("SELECT ws_id FROM paypal_refs WHERE resource_id = ANY($1) LIMIT 1", [ids]))).rows[0];
  return row?.ws_id ?? null;
}

export async function processWebhook(eventId: string) {
  const db = await getDb();
  const ev = (await db.query<any>("SELECT * FROM webhook_events WHERE id = $1", [eventId])).rows[0];
  if (!ev?.verified || ev.processed_at) return;
  const body = typeof ev.body === "string" ? JSON.parse(ev.body) : ev.body;
  const resId = String(body.resource?.id ?? "");
  const authId = String(body.resource?.supplementary_data?.related_ids?.authorization_id ?? resId);
  // Any authorization or capture change: re-run settlement for a PO that is waiting on it (it reads PayPal back).
  const po = (await db.query<{ id: string }>("SELECT id FROM purchase_orders WHERE auth_id = $1 AND status = 'settling'", [authId])).rows[0];
  if (po) {
    const v = (await db.query<{ version: number }>("SELECT version FROM resolutions WHERE po_id = $1 ORDER BY version DESC LIMIT 1", [po.id])).rows[0];
    if (v) await enqueue(db, "settle", { poId: po.id, version: v.version }, new Date(), `settle:${po.id}:${v.version}`);
  }
  // A capture that changes after the order moved on (pending → denied, or a reversal) must not be lost.
  const capOp = (await db.query<any>("SELECT o.*, p.status AS po_status FROM payment_ops o JOIN purchase_orders p ON p.id = o.po_id WHERE o.paypal_id = $1 AND o.kind = 'capture'", [resId])).rows[0];
  if (capOp) {
    const c = await paypal().getCapture(resId).catch(() => null);
    if (c && c.status !== capOp.paypal_status) {
      await db.query("UPDATE payment_ops SET paypal_status = $2, status = CASE WHEN $2 = 'COMPLETED' THEN 'succeeded' WHEN $2 IN ('DECLINED','FAILED') THEN 'failed' ELSE status END, updated_at = now() WHERE id = $1", [capOp.id, c.status]);
      if (capOp.po_status === "settling") {
        const v = (await db.query<{ version: number }>("SELECT version FROM resolutions WHERE po_id = $1 ORDER BY version DESC LIMIT 1", [capOp.po_id])).rows[0];
        if (v) await enqueue(db, "settle", { poId: capOp.po_id, version: v.version }, new Date(), `settle:${capOp.po_id}:${v.version}`);
      } else if (["DECLINED", "FAILED", "REVERSED", "REFUNDED"].includes(c.status) && !(c.status === "REFUNDED" && (await ourRefunds(resId)) >= capOp.amount_cents)) {
        const msg = `PayPal now reports capture ${resId} as ${c.status} after this order moved on. The accepted goods may be unpaid; check before shipping or crediting anything else.`;
        await db.query("UPDATE purchase_orders SET status = 'exception', exception = $2 WHERE id = $1", [capOp.po_id, msg]);
        await postMessage(db, capOp.po_id, null, "StockSure", "system", `Needs attention: ${msg}`, "system");
      }
    }
  }
  await db.query("UPDATE webhook_events SET processed_at = now() WHERE id = $1", [eventId]);
}

/** What StockSure itself refunded (or is refunding) on a capture: a REFUNDED status these explain is not an alarm. */
async function ourRefunds(captureId: string): Promise<number> {
  const db = await getDb();
  return (await db.query<{ s: number }>("SELECT COALESCE(SUM(amount_cents),0)::int AS s FROM payment_ops WHERE kind = 'refund' AND parent_paypal_id = $1 AND status IN ('planned','pending','succeeded')", [captureId])).rows[0].s;
}
