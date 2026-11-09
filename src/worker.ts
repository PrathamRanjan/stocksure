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
  console.log(`[stocksure] worker running every ${intervalMs} ms`);
}

export function stopWorker() {
  if (timer) clearInterval(timer);
  timer = null;
}
