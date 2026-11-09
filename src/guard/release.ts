/**
 * After an owner approves a held move, the work that was waiting goes back to the queue (job release_approved).
 * Payloads are what dryRun stored: action, entity, entity_id, cents.
 */
import { getDb } from "../db.js";
import { enqueue } from "../jobs.js";
import { logEvent } from "../store.js";

export async function releaseApproved(approvalId: string) {
  const db = await getDb();
  const a = (await db.query<any>("SELECT * FROM approvals WHERE id = $1 AND status = 'approved'", [approvalId])).rows[0];
  if (!a) return;
  const p = a.payload as { action: string; entity: string; entity_id: string; cents: number };
  if (p.entity === "po" && p.action === "capture") {
    const po = (await db.query<any>("SELECT id, root_id, status FROM purchase_orders WHERE id = $1", [p.entity_id])).rows[0];
    const v = (await db.query<{ version: number }>("SELECT version FROM resolutions WHERE po_id = $1 ORDER BY version DESC LIMIT 1", [p.entity_id])).rows[0];
    if (po && v) {
      if (po.status === "settling") await enqueue(db, "settle", { poId: po.id, version: v.version }, new Date(), `settle:${po.id}:${v.version}`);
      if (po.status === "part_settling") await enqueue(db, "settle_part", { poId: po.id }, new Date(), `settle_part:${po.id}`);
      await logEvent(db, po, "approval.released", `Owner approved capture of ${p.cents} cents; settlement resumes`);
    }
  }
  if (p.entity === "claim" && p.action === "refund") {
    await enqueue(db, "defect_refund", { claimId: p.entity_id }, new Date(), `defect:${p.entity_id}`);
  }
}
