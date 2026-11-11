/**
 * Spec A3.1: the judge page's steps tick themselves. When the server records an event that a step stands for, the
 * visitor's workspace gets that key in `workspaces.checklist` (the first time only, with the time). Nothing ticks
 * while a workspace is still being seeded, so the seed's own captures never count as the visitor's.
 *
 * Uses the caller's connection (inside a transaction when there is one); `workspaces` resolves to the shared table
 * through the search path.
 */
import { currentWs, type Queryable } from "../db.js";

export type CheckKey =
  | "counted" | "doc_read" | "supplier_agreed" | "resolution_approved" | "captured" | "released" | "replacement_held"
  | "scam_flagged" | "scam_checked" | "scam_held"
  | "ai_asked" | "ai_paypal" | "ai_drafted"
  | "agents_agreed" | "agents_supplier_ok" | "agents_settled"
  | "invoice_caught" | "duplicate_caught" | "reconciled";

/** Event types (store.logEvent) that stand for a checklist step. */
export const EVENT_KEYS: Record<string, CheckKey> = {
  "receipt.confirmed": "counted",
  "receipt.agreed": "supplier_agreed",
  // Both sides approve the fix; the step is done when the second one does.
  "resolution.agreed": "resolution_approved",
  "resolution.agreed_agents": "agents_settled",
  "paypal.capture": "captured",
  "paypal.release": "released",
  "paypal.void": "released",
};

export async function tick(q: Queryable, key: CheckKey): Promise<void> {
  const ws = currentWs();
  if (!ws) return;
  try {
    await q.query("UPDATE workspaces SET checklist = checklist || jsonb_build_object($2::text, to_jsonb(now())) WHERE id = $1 AND seed_state = 'ready' AND coalesce(seed_progress->>'done', 'false') = 'true' AND NOT (checklist ? $2)", [ws, key]);
  } catch (e) {
    // A checklist tick never stops the work it describes.
    console.error("[stocksure checklist]", key, (e as Error).message);
  }
}
