import { currentWs, withWorkspace, type Db, type Queryable } from "./db.js";

export type JobType = "settle" | "process_webhook" | "defect_refund" | "settle_part" | "hold_recheck" | "send_channel_message" | "send_push" | "reauthorize_hold" | "sync_disputes" | "agent_step" | "release_approved";

/** Queues a job in the shared queue, tagged with the workspace it belongs to (it runs there later). Dedupe keys are
 *  scoped to the workspace, so two visitors' "settle SS-1006" never collide. */
export async function enqueue(q: Queryable, type: JobType, payload: Record<string, unknown>, runAt: Date = new Date(), dedupeKey?: string) {
  const ws = currentWs();
  if (dedupeKey) {
    await q.query(
      `INSERT INTO jobs (type, payload, run_at, dedupe_key, ws_id) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (dedupe_key) DO UPDATE SET payload = EXCLUDED.payload, run_at = EXCLUDED.run_at,
         status = 'pending', attempts = 0, last_error = NULL, updated_at = now()`,
      [type, JSON.stringify(payload), runAt, ws ? `${ws}|${dedupeKey}` : dedupeKey, ws],
    );
  } else {
    await q.query("INSERT INTO jobs (type, payload, run_at, ws_id) VALUES ($1,$2,$3,$4)", [type, JSON.stringify(payload), runAt, ws]);
  }
}

/** Jobs whose workspace is gone (expired or reset) are cancelled instead of run against a dropped schema. */
async function liveWorkspace(db: Db, ws: string | null, cache: Map<string, boolean>): Promise<boolean> {
  if (!ws) return true;
  if (!cache.has(ws)) cache.set(ws, (await db.query("SELECT 1 FROM workspaces WHERE id = $1 AND seed_state IN ('seeding','ready')", [ws])).rows.length > 0);
  return cache.get(ws)!;
}

export type Handler = (payload: any) => Promise<void>;

/**
 * Runs due jobs one at a time, each inside the workspace that queued it. A failed job retries with backoff, up to 5
 * attempts, then stays `failed` for a person. `onlyWs` limits the run to one workspace (null: the base schema's own
 * jobs); leave it out to run every workspace's jobs (the worker).
 */
export async function runDueJobs(db: Db, handlers: Record<JobType, Handler>, limit = 25, now: Date = new Date(), onlyWs?: string | null): Promise<number> {
  const scoped = onlyWs !== undefined;
  const due = (
    await db.query<{ id: number; type: JobType; payload: any; attempts: number; ws_id: string | null }>(
      `SELECT id, type, payload, attempts, ws_id FROM jobs WHERE status = 'pending' AND run_at <= $1 ${scoped ? "AND ws_id IS NOT DISTINCT FROM $3" : ""} ORDER BY run_at, id LIMIT $2`,
      scoped ? [now, limit, onlyWs] : [now, limit],
    )
  ).rows;
  let ran = 0;
  const live = new Map<string, boolean>();
  for (const job of due) {
    if (!(await liveWorkspace(db, job.ws_id, live))) {
      await db.query("UPDATE jobs SET status = 'cancelled', last_error = 'workspace closed', updated_at = now() WHERE id = $1", [job.id]);
      continue;
    }
    const claimed = await db.query("UPDATE jobs SET status = 'running', attempts = attempts + 1, updated_at = now() WHERE id = $1 AND status = 'pending' RETURNING id", [job.id]);
    if (!claimed.rows.length) continue;
    try {
      const h = handlers[job.type];
      if (!h) throw new Error(`No handler for job type ${job.type}`);
      const payload = typeof job.payload === "string" ? JSON.parse(job.payload) : job.payload;
      await withWorkspace(job.ws_id, () => h(payload));
      // A handler may re-queue its own dedupe key (e.g. "retry in 10 minutes"); that sets it back to pending, so only
      // a job still marked running is finished here.
      await db.query("UPDATE jobs SET status = 'done', updated_at = now() WHERE id = $1 AND status = 'running'", [job.id]);
    } catch (e) {
      const attempts = job.attempts + 1;
      await db.query("UPDATE jobs SET status = $2, last_error = $3, run_at = $4, updated_at = now() WHERE id = $1", [
        job.id,
        attempts >= 5 ? "failed" : "pending",
        String((e as Error).message ?? e).slice(0, 500),
        new Date(Date.now() + 15_000 * 2 ** attempts),
      ]);
    }
    ran++;
  }
  return ran;
}

/** Runs everything that is due now, repeatedly, until the queue is quiet. Used by tests and scripts. */
export async function drain(db: Db, handlers: Record<JobType, Handler>, maxRounds = 20, now?: Date, onlyWs?: string | null): Promise<number> {
  let total = 0;
  for (let i = 0; i < maxRounds; i++) {
    const n = await runDueJobs(db, handlers, 50, now ?? new Date(), onlyWs);
    total += n;
    if (!n) break;
  }
  return total;
}
