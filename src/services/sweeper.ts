/**
 * Spec A4, "stuck states clear themselves": a settlement saga stuck on a step retries with the same request id,
 * then surfaces as "needs you".
 *
 * Two ways a saga gets stuck on a small host that restarts and sleeps:
 *   1. The process stops while a job is `running`. Nothing would ever pick it up again. After STALE_RUNNING_MIN it
 *      goes back to `pending`; handlers are idempotent (PayPal request ids are derived from the step), so re-running
 *      cannot charge twice.
 *   2. An order sits in settling, part settling or funding with no job queued for it (the job failed five times, or
 *      was never queued). It is re-queued once, with the same dedupe key and so the same request ids; if it is still
 *      stuck an hour later, it becomes an exception the owner sees on Home with the reason and a retry button.
 * An order waiting on the owner's approval is not stuck: it already shows as needing them.
 */
import { getDb, withWorkspace, type Db } from "../db.js";
import { enqueue, type JobType } from "../jobs.js";
import { logEvent, postMessage, setPo, type PO } from "../store.js";

export const STALE_RUNNING_MIN = 10;
export const STUCK_MIN = 15;

interface Outcome {
  reclaimed: number;
  requeued: string[];
  surfaced: string[];
}

export async function sweepStuck(): Promise<Outcome> {
  const db = await getDb();
  const reclaimed = await withWorkspace(null, async () =>
    (await db.query("UPDATE jobs SET status = 'pending', run_at = now(), last_error = 'reclaimed: the worker stopped while running it', updated_at = now() WHERE status = 'running' AND updated_at < now() - make_interval(mins => $1) RETURNING id", [STALE_RUNNING_MIN])).rows.length,
  );
  const out: Outcome = { reclaimed, requeued: [], surfaced: [] };
  const workspaces = await withWorkspace(null, async () => (await db.query<{ id: string }>("SELECT id FROM workspaces WHERE seed_state IN ('seeding','ready')")).rows.map((r) => r.id));
  for (const ws of [null, ...workspaces]) {
    try {
      await withWorkspace(ws, () => sweepOne(db, ws, out));
    } catch (e) {
      // One closed or broken workspace never stops the sweep of the others.
      console.error("[stocksure sweeper]", ws ?? "base", (e as Error).message);
    }
  }
  return out;
}

async function sweepOne(db: Db, ws: string | null, out: Outcome) {
  const stuck = (await db.query<PO>("SELECT * FROM purchase_orders WHERE status IN ('settling','part_settling','funding') AND updated_at < now() - make_interval(mins => $1)", [STUCK_MIN])).rows;
  for (const po of stuck) {
    const jobs = await withWorkspace(null, async () => (await db.query<{ status: string; last_error: string | null }>("SELECT status, last_error FROM jobs WHERE ws_id IS NOT DISTINCT FROM $1 AND payload->>'poId' = $2 ORDER BY updated_at DESC", [ws, po.id])).rows);
    if (jobs.some((j) => j.status === "pending" || j.status === "running")) continue; // in hand
    const waiting = (await db.query("SELECT 1 FROM approvals WHERE status = 'pending' AND payload->>'entity_id' = $1 LIMIT 1", [po.id])).rows.length > 0;
    if (waiting) continue; // the owner's approval is the next step; Home already shows it
    const lastError = jobs.find((j) => j.status === "failed")?.last_error ?? null;
    const requeuedRecently = (await db.query("SELECT 1 FROM events WHERE po_id = $1 AND type = 'saga.requeued' AND at > now() - interval '1 hour' LIMIT 1", [po.id])).rows.length > 0;
    if (!requeuedRecently && !(po.status === "funding" && po.exception)) {
      const job = await requeue(db, po);
      if (job) {
        await logEvent(db, po, "saga.requeued", `Settlement had stopped on ${po.status.replace(/_/g, " ")}${lastError ? ` (${lastError.slice(0, 200)})` : ""}; retrying the same step with the same PayPal request ids`);
        out.requeued.push(`${ws ?? "base"}:${po.number}`);
        continue;
      }
    }
    const why = `${po.number} stopped while ${po.status.replace(/_/g, " ")}${lastError ? `: ${lastError.slice(0, 200)}` : ""}. An automatic retry didn't finish it. Retry from this page; nothing is charged twice.`;
    if (po.status === "funding") await setPo(db, po.id, { exception: why });
    else await setPo(db, po.id, { status: "exception", exception: why });
    await logEvent(db, po, "settle.exception", why);
    await postMessage(db, po.id, null, "StockSure", "system", `Needs attention: ${why}`, "system");
    out.surfaced.push(`${ws ?? "base"}:${po.number}`);
  }
}

/** Queues the step the order is on, under the dedupe key its own code uses, so request ids stay the same. */
async function requeue(db: Db, po: PO): Promise<JobType | null> {
  if (po.status === "settling") {
    const v = (await db.query<{ version: number }>("SELECT version FROM resolutions WHERE po_id = $1 AND status IN ('agreed','settled') ORDER BY version DESC LIMIT 1", [po.id])).rows[0];
    if (!v) return null;
    await enqueue(db, "settle", { poId: po.id, version: v.version }, new Date(), `settle:${po.id}:${v.version}`);
    return "settle";
  }
  if (po.status === "part_settling") {
    await enqueue(db, "settle_part", { poId: po.id }, new Date(), `settle_part:${po.id}`);
    return "settle_part";
  }
  await enqueue(db, "hold_recheck", { poId: po.id }, new Date(), `hold_recheck:${po.id}`);
  return "hold_recheck";
}
