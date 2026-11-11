/**
 * Dry run and the money gate (roadmap B.6). Every PayPal write is simulated against live PayPal state and the
 * buyer's mandate before PayPal is called. Impossible moves are refused before any request leaves the process;
 * moves at or above the owner's threshold are held for approval (a click, or a passkey countersign over the exact
 * payload hash above SS_COUNTERSIGN_ABOVE_CENTS).
 */
import { tick } from "../demo/checklist.js";
import { fmt } from "../core/money.js";
import { createHash } from "node:crypto";
import { assessSettlement } from "../safety/index.js";
import { config } from "../config.js";
import type { Queryable } from "../db.js";
import { getDb } from "../db.js";
import { newId } from "../lib/ids.js";
import { paypal } from "../paypal/index.js";
import type { Run } from "../trace.js";
import { appendAudit } from "./audit.js";
import { isKilled } from "./kill.js";
import { rulesFor } from "./policy.js";
import { notifyParty } from "../channels/index.js";
import { moneyArgumentOk } from "./provenance.js";

export type MoneyAction = "authorize" | "capture" | "void" | "refund" | "payout" | "reauthorize";

export interface MoneyMove {
  action: MoneyAction;
  /** The buyer organisation whose mandate applies. */
  ownerId: string;
  /** Kill-switch scope for the actor: "org:<id>" or "agent:<id>". The owner's own scope is always checked too. */
  agentScope: string;
  entity: string;
  entityId: string;
  cents: number;
  /** Amounts code or PayPal derived this move from (quote total, agreed accepted value, authorization amount). */
  trustedCents: number[];
  authorizationId?: string | null;
  captureId?: string | null;
  orderId?: string | null;
}

export type GateVerdict = { gate: "allowed"; checks: string[] } | { gate: "dry_run_refused" | "denied"; reason: string; checks: string[] } | { gate: "held"; approvalId: string; reason: string; checks: string[]; /** False when this repeats an approval already waiting: say nothing new. */ fresh: boolean };

export class HeldForApproval extends Error {
  constructor(readonly approvalId: string, msg: string) {
    super(msg);
  }
}
export class GateDenied extends Error {
  constructor(readonly gate: "dry_run_refused" | "denied", msg: string) {
    super(msg);
  }
}

export function payloadHash(v: unknown): string {
  return createHash("sha256").update(JSON.stringify(v)).digest("hex");
}

export async function dryRun(m: MoneyMove, run?: Run | null, q?: Queryable): Promise<GateVerdict> {
  const db = q ?? (await getDb());
  const checks: string[] = [];
  const refuse = async (reason: string, gate: "dry_run_refused" | "denied" = "dry_run_refused"): Promise<GateVerdict> => {
    await run?.step({ actor: "guard", tool: `dry_run:${m.action}`, args: { cents: m.cents, entity: m.entity, entity_id: m.entityId }, gate, result: { reason, checks } });
    await appendAudit(`money.${gate}`, m.entity, m.entityId, { action: m.action, cents: m.cents, reason }, db);
    return { gate, reason, checks };
  };

  const killed = (await isKilled(`org:${m.ownerId}`, db)) ?? (m.agentScope !== `org:${m.ownerId}` ? await isKilled(m.agentScope, db) : null);
  if (killed) return refuse(`kill switch engaged (${killed.scope})${killed.reason ? `: ${killed.reason}` : ""}`, "denied");
  checks.push("kill switch clear");

  if (m.action !== "void" && (!Number.isInteger(m.cents) || m.cents <= 0)) return refuse(`amount ${m.cents} is not a positive whole number of cents`);
  if (m.action !== "void") {
    const prov = await moneyArgumentOk(m.entity, m.entityId, m.cents, m.trustedCents, db);
    if (!prov.ok) return refuse(prov.reason, "denied");
    checks.push(prov.reason);
  }

  const rules = await rulesFor(m.ownerId, db);
  if ((m.action === "authorize" || m.action === "reauthorize") && m.cents > rules.max_order_cents) return refuse(`order of ${fmt(m.cents)} is above the owner's per-order limit of ${fmt(rules.max_order_cents)}`, "denied");
  if (m.action === "authorize") {
    const today = (await db.query<{ s: string }>("SELECT coalesce(sum(amount_cents),0) AS s FROM payment_ops o JOIN purchase_orders p ON p.id = o.po_id WHERE p.buyer_id = $1 AND o.kind = 'authorize' AND o.status IN ('pending','succeeded') AND o.created_at > now() - interval '1 day'", [m.ownerId])).rows[0];
    if (Number(today?.s ?? 0) + m.cents > rules.max_daily_cents) return refuse(`today's holds ${fmt(Number(today?.s ?? 0))} plus ${fmt(m.cents)} would pass the owner's daily limit of ${fmt(rules.max_daily_cents)}`, "denied");
  }
  checks.push("within the mandate");

  // Live PayPal state. Read-only calls; nothing is written here.
  try {
    if (m.authorizationId && (m.action === "capture" || m.action === "void" || m.action === "reauthorize")) {
      const a = await paypal().getAuthorization(m.authorizationId);
      const ok = m.action === "reauthorize" ? ["CREATED", "EXPIRED", "PENDING"].includes(a.status) : a.status === "CREATED" || a.status === "PENDING" || a.status === "PARTIALLY_CAPTURED";
      if (!ok) return refuse(`authorization ${m.authorizationId} is ${a.status}; cannot ${m.action}`);
      const authCents = Math.round(Number(a.amount?.value ?? 0) * 100);
      if (m.action === "capture" && m.cents > authCents) return refuse(`capture of ${fmt(m.cents)} is more than the ${fmt(authCents)} hold`);
      checks.push(`authorization ${a.status}, ${fmt(authCents)}`);
    }
    if (m.captureId && m.action === "refund") {
      const c = await paypal().getCapture(m.captureId);
      if (!["COMPLETED", "PARTIALLY_REFUNDED"].includes(c.status)) return refuse(`capture ${m.captureId} is ${c.status}; cannot refund`);
      const capCents = Math.round(Number(c.amount?.value ?? 0) * 100);
      if (m.cents > capCents) return refuse(`refund of ${fmt(m.cents)} is more than the ${fmt(capCents)} charged`);
      checks.push(`capture ${c.status}, ${fmt(capCents)}`);
    }
  } catch (e) {
    return refuse(`PayPal state could not be read: ${(e as Error).message.slice(0, 160)}`);
  }

  // Scam check (SAFETY_ACCESSIBILITY_SPEC §4): supplier messages on the order, invoice against settlement, protected mode.
  let safety: Awaited<ReturnType<typeof assessSettlement>> | null = null;
  if ((m.action === "capture" || m.action === "refund") && m.entity === "po") {
    safety = await assessSettlement(m.entityId, m.action, m.cents, db);
    checks.push(`scam check: ${safety.summary}`);
  }
  const safetyHold = safety?.level === "hold";
  if ((m.action === "capture" || m.action === "refund") && (safetyHold || m.cents >= rules.approve_above_cents) && !(await approvedFor(m.entity, m.entityId, m.action, m.cents, db))) {
    // The hash covers the move itself only (action, entity, id, amount): the same move held again finds the same
    // approval, and approvedFor() finds it once granted. Safety details are stored beside it, never hashed: hashing
    // them made an approved scam hold unfindable, so settlement held it again forever.
    const move = { action: m.action, entity: m.entity, entity_id: m.entityId, cents: m.cents };
    const payload = { ...move, ...(safetyHold ? { safety_rule: safety!.rule ?? "rule", safety_reasons: safety!.reasons, safety_risk: safety!.risk } : {}) };
    const hash = payloadHash(move);
    const existing = (await db.query<{ id: string }>("SELECT id FROM approvals WHERE owner_id = $1 AND payload_hash = $2 AND status = 'pending'", [m.ownerId, hash])).rows[0];
    const approvalId = existing?.id ?? newId("apr");
    if (!existing) await db.query("INSERT INTO approvals (id, owner_id, action, payload_hash, payload) VALUES ($1,$2,$3,$4,$5)", [approvalId, m.ownerId, m.action, hash, JSON.stringify(payload)]);
    await run?.step({ actor: "guard", tool: `dry_run:${m.action}`, args: payload, gate: "held", result: { approval_id: approvalId, checks } });
    if (!existing) {
      if (safetyHold) await tick(db, "scam_held");
      await appendAudit("money.held", m.entity, m.entityId, { ...payload, approval_id: approvalId }, db);
      const big = m.cents > config.guard.countersignAboveCents;
      await notifyParty("buyer", m.ownerId, `StockSure wants to ${m.action} ${fmt(m.cents)} on ${m.entity} ${m.entityId}. ${safetyHold ? `The scam check paused it: ${safety!.reasons[0]}` : "It is at or above your approval threshold."}${big ? ` Above ${fmt(config.guard.countersignAboveCents)} it needs your passkey in the guard console.` : ""}`, big ? [{ id: `decline:${approvalId}`, label: "Decline" }] : [{ id: `approve:${approvalId}`, label: "Approve" }, { id: `decline:${approvalId}`, label: "Decline" }], "approval", approvalId, db).catch(() => undefined);
    }
    return { gate: "held", approvalId, fresh: !existing, reason: safetyHold ? `paused by the scam check: ${safety!.reasons[0]}` : `${m.action} of ${fmt(m.cents)} is at or above the owner's approval threshold of ${fmt(rules.approve_above_cents)}`, checks };
  }

  await run?.step({ actor: "guard", tool: `dry_run:${m.action}`, args: { cents: m.cents, entity: m.entity, entity_id: m.entityId }, gate: "allowed", result: { checks } });
  return { gate: "allowed", checks };
}

/** Runs the gate and throws when the move may not proceed; the caller maps HeldForApproval / GateDenied to its own states. */
export async function gate(m: MoneyMove, run?: Run | null, q?: Queryable): Promise<string[]> {
  const v = await dryRun(m, run, q);
  if (v.gate === "allowed") return v.checks;
  if (v.gate === "held") throw new HeldForApproval(v.approvalId, v.reason);
  throw new GateDenied(v.gate, v.reason);
}

/** Approval already granted for this exact payload? */
export async function approvedFor(entity: string, entityId: string, action: MoneyAction, cents: number, q?: Queryable): Promise<boolean> {
  const db = q ?? (await getDb());
  const h = payloadHash({ action, entity, entity_id: entityId, cents });
  // The payload match also finds approvals stored before the hash covered the move only (scam holds hashed their
  // safety details too, so the hash alone never matched them).
  const r = await db.query(
    "SELECT 1 FROM approvals WHERE status = 'approved' AND (payload_hash = $1 OR (payload->>'action' = $2 AND payload->>'entity' = $3 AND payload->>'entity_id' = $4 AND (payload->>'cents')::bigint = $5)) LIMIT 1",
    [h, action, entity, entityId, cents],
  );
  return r.rows.length > 0;
}

export async function decideApproval(id: string, ownerId: string, approve: boolean, method: "passkey" | "click" | "agent-denied", q?: Queryable) {
  const db = q ?? (await getDb());
  const r = await db.query("UPDATE approvals SET status = $3, method = $4, decided_at = now() WHERE id = $1 AND owner_id = $2 AND status = 'pending' RETURNING payload", [id, ownerId, approve ? "approved" : "declined", method]);
  if (!r.rows.length) return null;
  await appendAudit(approve ? "approval.approved" : "approval.declined", "approval", id, { owner_id: ownerId, method, payload: r.rows[0].payload }, db);
  return r.rows[0].payload as { action: MoneyAction; entity: string; entity_id: string; cents: number };
}

export async function pendingApprovals(ownerId: string, q?: Queryable) {
  const db = q ?? (await getDb());
  return (await db.query("SELECT * FROM approvals WHERE owner_id = $1 AND status = 'pending' ORDER BY created_at", [ownerId])).rows as any[];
}

export const countersignThreshold = () => config.guard.countersignAboveCents;
