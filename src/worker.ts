import { applyCommittedCalibration } from "./eval/apply.js";
import { config } from "./config.js";
import { getDb } from "./db.js";
import { Handler, JobType, runDueJobs } from "./jobs.js";
import { settle, settlePart } from "./services/settle.js";
import { executeDefectRefund } from "./services/aftercare.js";
import { recheckHold } from "./services/orders.js";
import { processWebhook } from "./webhooks.js";
import { deliver } from "./channels/index.js";
import { sendPush } from "./channels/push.js";
import { reauthorizeHold } from "./services/reauth.js";
import { syncDisputes } from "./services/disputes.js";
import { agentStep } from "./agents/runtime.js";
import { releaseApproved } from "./guard/release.js";
import { sweepStuck } from "./services/sweeper.js";
import { checkWallet } from "./demo/wallet.js";
import { ensureShowcase, expireWorkspaces, showcase } from "./demo/workspaces.js";
import { ensureFreshProof } from "./eval/proof.js";

export const handlers: Record<JobType, Handler> = {
  settle: (p) => settle(p.poId, p.version, p.attempt ?? 0),
  process_webhook: (p) => processWebhook(p.eventId),
  defect_refund: (p) => executeDefectRefund(p.claimId),
  settle_part: (p) => settlePart(p.poId, p.attempt ?? 0),
  hold_recheck: (p) => recheckHold(p.poId),
  send_channel_message: (p) => deliver(p.messageId),
  send_push: (p) => sendPush(p.subscriptionId, p.payload),
  reauthorize_hold: (p) => reauthorizeHold(p.poId),
  sync_disputes: () => syncDisputes().then(() => undefined),
  agent_step: (p) => agentStep(p.negotiationId),
  release_approved: (p) => releaseApproved(p.approvalId),
};

export async function tick() {
  return runDueJobs(await getDb(), handlers);
}

let timer: NodeJS.Timeout | null = null;

export function startWorker(intervalMs = config.workerIntervalMs) {
  if (timer) return;
  let busy = false;
  timer = setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      await tick();
    } catch (e) {
      console.error("[stocksure worker]", (e as Error).message);
    } finally {
      busy = false;
    }
  }, intervalMs);
  startMaintenance();
  console.log(`[stocksure] worker running every ${intervalMs} ms`);
}

export function stopWorker() {
  if (timer) clearInterval(timer);
  timer = null;
  for (const t of maintenance) clearInterval(t);
  maintenance.length = 0;
}

/**
 * Housekeeping that keeps the demo from decaying (spec A1.2, A2.1, A4). Each task runs on its own timer and logs
 * its own failure; one failing never stops the others or the job loop.
 *   every 5 min   reclaim jobs left running by a restart; re-queue or surface stuck settlements
 *   every 24 h    apply the committed Decisions calibration (and at startup)
 *   every 15 min  close visitor workspaces idle past their expiry (holds voided and read back first)
 *   every 24 h    check the saved demo wallet with PayPal; rebuild the showcase (and once at startup if missing)
 */
const maintenance: NodeJS.Timeout[] = [];
export function startMaintenance() {
  if (maintenance.length) return;
  const every = (ms: number, name: string, fn: () => Promise<unknown>, atStart = false) => {
    let running = false;
    const run = async () => {
      if (running) return;
      running = true;
      try {
        const r = await fn();
        if (r && typeof r === "object" && Object.values(r).some((v) => (Array.isArray(v) ? v.length : Number(v) > 0))) console.log(`[stocksure ${name}]`, JSON.stringify(r));
      } catch (e) {
        console.error(`[stocksure ${name}]`, (e as Error).message);
      } finally {
        running = false;
      }
    };
    maintenance.push(setInterval(run, ms));
    if (atStart) setTimeout(run, 5_000);
  };
  every(5 * 60_000, "sweeper", () => sweepStuck(), true);
  // Spec A5.2: thresholds committed in eval/calibration are applied to the table the scam check reads.
  every(24 * 3600_000, "calibration", async () => ({ applied: await applyCommittedCalibration() }), true);
  if (config.demoMode) {
    every(15 * 60_000, "expire", async () => ({ closed: await expireWorkspaces() }), true);
    every(24 * 3600_000, "wallet", async () => {
      const w = await checkWallet();
      return w ? { wallet: w.status === "ok" ? 0 : 1 } : null;
    }, true);
    every(3600_000, "showcase", () => ensureShowcase(), true);
    // Spec A5.6: the proof suites run nightly in the showcase demo (and after a deploy when the last run is stale).
    every(3600_000, "proof", async () => {
      const s = await showcase();
      return s && s.seed_state === "ready" ? ensureFreshProof(s.id) : { ran: 0 };
    }, true);
  }
}
