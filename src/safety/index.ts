/**
 * Safety layer for StockSure (SAFETY_ACCESSIBILITY_SPEC §4, §6 StockSure row). Money here only ever moves under the
 * agreed order to the merchant account PayPal already knows; no call takes a payee. So the tampering risk is in the
 * paper and the thread: a delivery note or invoice that bills more than the order, text that asks the buyer to pay
 * somewhere else, or a "we changed our bank details" message before settlement. Rules (A) and the synthetic-data
 * risk model (C) run here on the buyer's own records; the browser text model (B) only explains messages on /safety.
 * Protected mode (per buyer organisation) makes every capture and refund wait for the owner.
 *
 * Reads the database only; never imports the PayPal client or the services.
 */
import type { Queryable } from "../db.js";
import { getDb } from "../db.js";
import { putSetting, setting } from "../store.js";
import { maxLevel, payeeRules, scanText, TACTIC_WORDS, type Level, type RuleResult, type Tactic } from "./rules.js";
import { riskLevel, riskScore } from "./risk.js";
import { checkSupplierMessages } from "./check.js";

export interface Assessment {
  level: Level;
  rule: string | null;
  reasons: string[];
  risk: number;
  tactics: Tactic[];
  summary: string;
}

/** Assess a capture or refund on a purchase order: supplier messages, invoice totals against the order, protected mode. */
export async function assessSettlement(poId: string, action: string, cents: number, q?: Queryable): Promise<Assessment> {
  const db = q ?? (await getDb());
  const po = (await db.query<any>("SELECT id, buyer_id, supplier_id, spend_limit_cents FROM purchase_orders WHERE id = $1", [poId])).rows[0];
  if (!po) return { level: "clear", rule: null, reasons: [], risk: 0, tactics: [], summary: "no order found; nothing to check" };
  // Spec A6: every supplier message on the order gets the three-reader check (stored on the message, run once).
  const checks = await checkSupplierMessages(db, poId);
  const invoiced = (await db.query<{ s: string }>("SELECT coalesce(sum(il.line_cents),0) AS s FROM invoice_lines il JOIN documents d ON d.id = il.document_id WHERE d.po_id = $1 AND d.kind = 'invoice'", [poId])).rows[0]?.s ?? "0";
  const flagged = (await db.query<{ n: string }>("SELECT count(*) AS n FROM extractions e JOIN documents d ON d.id = e.document_id WHERE d.po_id = $1 AND jsonb_array_length(e.flags) > 0", [poId])).rows[0]?.n ?? "0";
  const history = (await db.query<{ c: string }>("SELECT amount_cents AS c FROM payment_ops o JOIN purchase_orders p ON p.id = o.po_id WHERE p.buyer_id = $1 AND p.supplier_id = $2 AND o.kind = 'capture' AND o.status = 'succeeded'", [po.buyer_id, po.supplier_id])).rows.map((r) => Number(r.c));
  const med = history.length ? history.slice().sort((a, b) => a - b)[Math.floor(history.length / 2)] : null;
  const res = payeeRules({
    payeeAgeDays: null,
    detailsChangedDaysAgo: null,
    detailsChangeSource: null,
    amountCents: cents,
    historyMedianCents: med,
    velocity10m: 0,
    velocity24hSumRatio: 1,
    requestChannelUntrusted: false,
    hourLocal: 12,
    text: null,
  });
  const out = combine(res);
  out.reasons = out.reasons.map((r) => r.replace("this payee's usual payment", "the usual settlement with this supplier"));
  // Amount against the buyer's own history is a caution: the capture amount is code-derived from accepted quantities.
  if (out.level === "hold" && out.rule === "amount_vs_history") out.level = "caution";
  // A supplier message that holds on any reader (rules, Decisions, or a payment destination not on file) holds
  // settlement until the owner has read it. Amber messages are listed as reasons.
  const held = checks.find((c) => c.check.level === "hold");
  const tactics = new Set(out.tactics);
  for (const c of checks) for (const t of c.check.readers.rules.tactics) tactics.add(t as Tactic);
  out.tactics = [...tactics];
  if (held) {
    const r = held.check.readers;
    out.level = "hold";
    out.rule = r.rules.tactics.includes("changed_details") ? "supplier_details_changed_in_message" : r.rules.tactics.includes("off_platform") ? "supplier_asks_off_platform" : r.code.level === "hold" ? "supplier_message_destination" : r.rules.level === "hold" ? "supplier_message_rules" : "supplier_message_decisions";
    out.reasons.unshift(`A supplier message on this order was held by the scam check: ${held.check.reasons[0] ?? "it asks you to pay somewhere else"} StockSure pays only through PayPal under the agreed order; read the thread before settling.`);
  } else {
    const amber = checks.find((c) => c.check.level === "caution");
    if (amber) out.reasons.push(`A supplier message on this order is amber: ${amber.check.advice}`);
  }
  const inv = Number(invoiced);
  if (inv > 0 && cents > 0 && inv > cents * 1.1) {
    out.reasons.push(`The invoice bills ${(inv / 100).toFixed(2)} against a settlement of ${(cents / 100).toFixed(2)} from accepted quantities; the difference is not paid.`);
    if (out.level === "clear") {
      out.level = "caution";
      out.rule = "invoice_over_settlement";
    }
  }
  if (Number(flagged) > 0) out.reasons.push(`${flagged} document${flagged === "1" ? "" : "s"} on this order carried instruction-like lines that were removed before reading.`);
  const prot = await protectedMode(po.buyer_id, db);
  if (prot.on && (action === "capture" || action === "refund") && out.level !== "hold") {
    out.level = "hold";
    out.rule = "protected_settlement";
    out.reasons.unshift(`Protected mode is on: every ${action} waits for the owner.`);
  }
  out.summary = out.level === "clear" ? `no scam signals; risk ${(out.risk * 100).toFixed(0)}%` : `${out.level}: ${out.reasons[0]} (risk ${(out.risk * 100).toFixed(0)}%)`;
  return out;
}

function combine(res: RuleResult): Assessment {
  let risk = 0;
  try {
    risk = riskScore(res.features);
  } catch {
    risk = 0;
  }
  const level = maxLevel(res.level, riskLevel(risk));
  const reasons = res.reasons.slice();
  const rule = res.rule ?? (level !== "clear" ? "risk_model" : null);
  if (res.level === "clear" && level !== "clear") reasons.push(`The payment-risk model scores this ${(risk * 100).toFixed(0)}% (synthetic training data; a ranking signal, not a fraud rate).`);
  const summary = level === "clear" ? `no scam signals; risk ${(risk * 100).toFixed(0)}%` : `${level}: ${reasons[0]} (risk ${(risk * 100).toFixed(0)}%)`;
  return { level, rule, reasons, risk, tactics: res.scan.fired, summary };
}

/** A pasted supplier email, invoice text or thread message on its own. Rules only on the server; the browser adds the text model. */
export function assessMessage(text: string): Assessment & { words: string[] } {
  const scan = scanText(text);
  const res = payeeRules({ payeeAgeDays: null, detailsChangedDaysAgo: null, detailsChangeSource: null, amountCents: 1, historyMedianCents: null, velocity10m: 0, velocity24hSumRatio: 1, requestChannelUntrusted: true, hourLocal: 12, text });
  const out = combine(res);
  out.reasons = out.reasons.filter((r) => !r.startsWith("The request to pay arrived"));
  if (out.reasons.length === 0) out.level = "clear";
  out.summary = out.level === "clear" ? "no scam signals" : `${out.level}: ${out.reasons[0]}`;
  return { ...out, words: scan.words };
}

/** Protected mode (§4.5) per buyer organisation. */
export async function protectedMode(orgId: string, q?: Queryable): Promise<{ on: boolean; contacts: string[] }> {
  const db = q ?? (await getDb());
  const v = await setting(db, `protected:${orgId}`);
  if (!v) return { on: false, contacts: [] };
  try {
    return JSON.parse(v);
  } catch {
    return { on: false, contacts: [] };
  }
}
export async function setProtectedMode(orgId: string, on: boolean, contacts: string[], q?: Queryable) {
  const db = q ?? (await getDb());
  await putSetting(db, `protected:${orgId}`, JSON.stringify({ on, contacts: contacts.filter(Boolean).slice(0, 2) }));
}

/** Holds the safety layer created for this buyer, newest first. */
export async function safetyHolds(orgId: string, q?: Queryable) {
  const db = q ?? (await getDb());
  return (await db.query<any>("SELECT * FROM approvals WHERE owner_id = $1 AND payload->>'safety_rule' IS NOT NULL ORDER BY created_at DESC LIMIT 20", [orgId])).rows.map((r) => ({ ...r, payload: typeof r.payload === "string" ? JSON.parse(r.payload) : r.payload }));
}
