import { getDb, type Queryable } from "../db.js";
import { enqueue } from "../jobs.js";
import { ACTIVE_AUTH } from "../core/funding.js";
import { fmt } from "../core/money.js";
import { newId } from "../lib/ids.js";
import { GtError } from "../lib/util.js";
import { capturesOf, paypal, PayPalError, UnknownOutcomeError } from "../paypal/index.js";
import { fundingOf, getPo, latestResolution, logEvent, postMessage, setPo, treeOf, type PaymentOp, type PO } from "../store.js";
import { instanceTag, placeHold } from "./orders.js";
import { dryRun } from "../guard/dryrun.js";
import { startRun } from "../trace.js";
import { partCharged } from "./parts.js";

/**
 * Settlement saga for one agreed resolution version:
 *   capture_original -> confirm_release -> order_replacement -> authorize_replacement -> finish
 * A recorded step never runs again; a retried PayPal call reuses its request id.
 */

class Retry extends Error {
  constructor(message: string, readonly delayMs = 15_000) {
    super(message);
  }
}
/** PayPal accepted the request but the money is not final yet: wait as long as it takes, never escalate on count. */
class Waiting extends Retry {}

async function stepDone(q: Queryable, poId: string, v: number, step: string) {
  return (await q.query("SELECT 1 FROM saga_steps WHERE po_id = $1 AND version = $2 AND step = $3", [poId, v, step])).rows.length > 0;
}
async function record(q: Queryable, poId: string, v: number, step: string, result: unknown) {
  await q.query("INSERT INTO saga_steps (po_id, version, step, result) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING", [poId, v, step, JSON.stringify(result ?? null)]);
}

async function opByRequest(q: Queryable, requestId: string): Promise<PaymentOp | null> {
  return (await q.query<PaymentOp>("SELECT * FROM payment_ops WHERE request_id = $1", [requestId])).rows[0] ?? null;
}

async function ensureOp(q: Queryable, po: PO, kind: PaymentOp["kind"], requestId: string, amount: number, extra: Partial<PaymentOp> = {}): Promise<PaymentOp> {
  const r = await q.query<PaymentOp>(
    `INSERT INTO payment_ops (id, po_id, root_id, kind, status, amount_cents, final_capture, request_id, parent_paypal_id, paypal_order_id)
     VALUES ($1,$2,$3,$4,'planned',$5,$6,$7,$8,$9) ON CONFLICT (request_id) DO NOTHING RETURNING *`,
    [newId("op"), po.id, po.root_id, kind, amount, extra.final_capture ?? false, requestId, extra.parent_paypal_id ?? null, extra.paypal_order_id ?? null],
  );
  return r.rows[0] ?? (await opByRequest(q, requestId))!;
}

async function exception(po: PO, msg: string) {
  const db = await getDb();
  await setPo(db, po.id, { status: "exception", exception: msg });
  await logEvent(db, po, "settle.exception", msg);
  await postMessage(db, po.id, null, "StockSure", "system", `Needs attention: ${msg}`, "system");
}

export async function settle(poId: string, version: number, attempt = 0) {
  const db = await getDb();
  const po = await getPo(db, poId);
  const res = await latestResolution(db, poId);
  if (!res || res.version !== version || (res.status !== "agreed" && res.status !== "settled")) return; // stale job
  if (po.status !== "settling") return;
  const body = res.body;
  try {
    // After a charged part delivery, the final capture is the total less what the part already captured.
    const already = await partCharged(db, poId);
    await captureOriginal(po, version, Math.max(0, body.totals.accepted_cents - already), already);
    await confirmRelease(po, version);
    const repl = await orderReplacement(po, version, body);
    if (repl) await authorizeReplacement(po, version, repl);
    await finish(po, version, repl);
  } catch (e) {
    if (e instanceof Waiting) {
      await enqueue(db, "settle", { poId, version, attempt }, new Date(Date.now() + e.delayMs), `settle:${poId}:${version}`);
      await logEvent(db, po, "settle.waiting_payment", e.message);
      return;
    }
    if (e instanceof Retry) {
      if (attempt >= 6) return exception(po, `${e.message} after ${attempt + 1} checks. Retry from the PO page once PayPal shows it.`);
      await enqueue(db, "settle", { poId, version, attempt: attempt + 1 }, new Date(Date.now() + e.delayMs), `settle:${poId}:${version}`);
      await logEvent(db, po, "settle.waiting", e.message);
      return;
    }
    if (e instanceof GtError && (e.code === "held" || e.code === "held_again")) {
      if (e.code === "held") await logEvent(db, po, "settle.held", e.message);
      return; // the owner's approval re-queues this job (guard/release.ts)
    }
    if (e instanceof GtError && e.code === "exception") return exception(po, e.message);
    throw e; // job retry with backoff
  }
}

async function captureOriginal(po: PO, v: number, accepted: number, already = 0) {
  const db = await getDb();
  if (await stepDone(db, po.id, v, "capture_original")) return;
  // A revised resolution after settlement began (a re-planned replacement) never captures again.
  const earlier = (await db.query<any>("SELECT version FROM saga_steps WHERE po_id = $1 AND step = 'capture_original' AND version <> $2 LIMIT 1", [po.id, v])).rows[0];
  if (earlier) {
    await record(db, po.id, v, "capture_original", { reused_from_version: earlier.version });
    return;
  }
  if (!po.auth_id) throw new GtError(`${po.number} has no PayPal hold.`, "exception");
  const tag = await instanceTag(db);
  const pp = paypal();
  const holdOp = (await db.query<PaymentOp>("SELECT * FROM payment_ops WHERE paypal_id = $1 AND kind = 'authorize'", [po.auth_id])).rows[0];
  if (accepted === 0) {
    const op = await ensureOp(db, po, "void", `void:${po.id}:${v}`, holdOp?.amount_cents ?? 0, { parent_paypal_id: po.auth_id });
    if (op.status !== "succeeded") {
      try {
        await pp.voidAuthorization(po.auth_id, op.request_id);
      } catch (e) {
        if (!(e instanceof UnknownOutcomeError) && !(e instanceof PayPalError && e.status >= 500)) {
          const a = await pp.getAuthorization(po.auth_id).catch(() => null);
          if (a?.status !== "VOIDED") {
            await db.query("UPDATE payment_ops SET status = 'failed', error = $2, attempts = attempts + 1 WHERE id = $1", [op.id, (e as Error).message]);
            throw new GtError(`PayPal refused to release the hold: ${(e as Error).message}`, "exception");
          }
        } else {
          const a = await pp.getAuthorization(po.auth_id).catch(() => null);
          if (a?.status !== "VOIDED") throw e;
        }
      }
      await db.query("UPDATE payment_ops SET status = 'succeeded', error = NULL, attempts = attempts + 1, updated_at = now() WHERE id = $1", [op.id]);
      await logEvent(db, po, "paypal.void", already ? `Rest of hold ${po.auth_id} released (part 1 already charged ${fmt(already)}; nothing more to charge)` : `Hold ${po.auth_id} released in full (nothing accepted)`);
    }
    await record(db, po.id, v, "capture_original", { voided: true });
    return;
  }
  const op = await ensureOp(db, po, "capture", `cap:${po.id}:${v}`, accepted, { final_capture: true, parent_paypal_id: po.auth_id, paypal_order_id: holdOp?.paypal_order_id ?? null });
  if (op.status === "pending" && op.paypal_id && op.paypal_status === "PENDING") {
    // A capture PayPal reported as PENDING: read it back; only COMPLETED settles.
    const c = await pp.getCapture(op.paypal_id);
    await applyCaptureStatus(po, op.id, op.paypal_id, c.status, accepted);
  } else if (op.status !== "succeeded") {
    const invoiceId = `${po.number}-${tag}-C${v}`;
    let captureId: string | null = null;
    let status: string | null = null;
    // B.6: dry run against the mandate and the live authorization before the capture leaves the process.
    const run = await startRun({ actor: "code", subject: `capture ${po.number} v${v} ${fmt(accepted)}`, entity: "po", entityId: po.id }, db);
    const verdict = await dryRun({ action: "capture", ownerId: po.buyer_id, agentScope: `org:${po.buyer_id}`, entity: "po", entityId: po.id, cents: accepted, trustedCents: [accepted], authorizationId: po.auth_id }, run, db);
    if (verdict.gate === "held") {
      await run.end("held");
      // Said once, when the approval is first created; a re-run that finds it still waiting stays quiet.
      if (verdict.fresh) await postMessage(db, po.id, null, "StockSure", "system", `Capture of ${fmt(accepted)} waits for the buyer's approval: ${verdict.reason}`, "system");
      throw new GtError(`Capture of ${fmt(accepted)} is held for approval ${verdict.approvalId}: ${verdict.reason}`, verdict.fresh ? "held" : "held_again");
    }
    if (verdict.gate !== "allowed") {
      await run.end("failed");
      throw new GtError(`The guard refused the capture before PayPal: ${verdict.reason}`, "exception");
    }
    try {
      await db.query("UPDATE payment_ops SET status = 'pending', attempts = attempts + 1, updated_at = now() WHERE id = $1", [op.id]);
      const t0 = Date.now();
      const c = await pp.captureAuthorization(po.auth_id, { amountCents: accepted, currency: po.currency, finalCapture: true, invoiceId, note: already ? `${po.number}: rest of the accepted goods per resolution v${v} (part 1 charged ${fmt(already)})` : `${po.number}: accepted goods per agreed resolution v${v}` }, op.request_id);
      captureId = c.id;
      status = c.status;
      await run.step({ actor: "paypal", tool: "captureAuthorization", pp_request_id: op.request_id, gate: "allowed", result: { capture_id: c.id, status: c.status, final: true }, duration_ms: Date.now() - t0 });
    } catch (e) {
      await run.step({ actor: "paypal", tool: "captureAuthorization", pp_request_id: op.request_id, gate: "denied", result: { error: (e as Error).message.slice(0, 300) }, pp_debug_id: e instanceof PayPalError ? e.debugId ?? null : null });
      const unknown = e instanceof UnknownOutcomeError || (e instanceof PayPalError && (e.status >= 500 || e.name_ === "AUTHORIZATION_ALREADY_CAPTURED"));
      if (!unknown) {
        await db.query("UPDATE payment_ops SET status = 'failed', error = $2, updated_at = now() WHERE id = $1", [op.id, (e as Error).message]);
        throw new GtError(`PayPal refused the capture: ${(e as Error).message}`, "exception");
      }
      // Did it land? Read the order back; never capture again blindly.
      const found = holdOp?.paypal_order_id ? capturesOf(await pp.getOrder(holdOp.paypal_order_id)).find((c) => c.invoice_id === invoiceId) : null;
      if (!found) {
        await db.query("UPDATE payment_ops SET error = $2, updated_at = now() WHERE id = $1", [op.id, (e as Error).message]);
        throw e; // retry with the same request id
      }
      captureId = found.id;
      status = found.status;
      await logEvent(db, po, "paypal.readback", `Capture response was lost; read back ${found.id} from order ${holdOp!.paypal_order_id}`);
    }
    await run.end(status === "COMPLETED" ? "done" : status === "PENDING" ? "held" : "failed");
    await applyCaptureStatus(po, op.id, captureId!, status!, accepted);
  }
  await record(db, po.id, v, "capture_original", { capture: op.request_id });
}

/**
 * Records what PayPal says about a capture. COMPLETED settles; PENDING is recorded and waited on (nothing after it
 * runs: no release spending, no replacement, no close); anything else is an exception for the owner.
 */
async function applyCaptureStatus(po: PO, opId: string, captureId: string, status: string, accepted: number) {
  const db = await getDb();
  if (status === "PENDING") {
    const first = (await db.query("UPDATE payment_ops SET status = 'pending', paypal_id = $2, paypal_status = 'PENDING', error = NULL, updated_at = now() WHERE id = $1 AND (paypal_status IS DISTINCT FROM 'PENDING') RETURNING id", [opId, captureId])).rows.length;
    if (first) {
      await logEvent(db, po, "paypal.capture_pending", `PayPal accepted capture ${captureId} for ${fmt(accepted)} but shows it PENDING. Not settled: nothing else happens until PayPal completes it.`, { capture_id: captureId, status });
      await postMessage(db, po.id, null, "StockSure", "system", `Payment of ${fmt(accepted)} is confirming with PayPal (capture ${captureId} is pending). The replacement and close wait until it completes.`, "system");
    }
    throw new Waiting(`PayPal shows capture ${captureId} as PENDING; waiting for it to complete`, 10 * 60_000);
  }
  await db.query("UPDATE payment_ops SET status = $2, paypal_id = $3, paypal_status = $4, error = NULL, updated_at = now() WHERE id = $1", [opId, status === "COMPLETED" ? "succeeded" : "failed", captureId, status]);
  if (status !== "COMPLETED") throw new GtError(`PayPal reports capture ${captureId} as ${status}: the accepted goods are not paid. Contact the buyer before releasing anything more.`, "exception");
  await logEvent(db, po, "paypal.capture", `Captured ${fmt(accepted)} on hold ${po.auth_id} (final capture): ${captureId} COMPLETED`, { capture_id: captureId, status });
  await postMessage(db, po.id, null, "StockSure", "system", `Charged ${fmt(accepted)} for accepted goods (capture ${captureId}). The rest of the hold is being released.`, "system");
}

async function confirmRelease(po: PO, v: number) {
  const db = await getDb();
  if (await stepDone(db, po.id, v, "confirm_release")) return;
  const a = await paypal().getAuthorization(po.auth_id!);
  await db.query("UPDATE payment_ops SET paypal_status = $2, updated_at = now() WHERE paypal_id = $1 AND kind = 'authorize'", [a.id, a.status]);
  if (ACTIVE_AUTH.has(a.status)) throw new Retry(`PayPal still shows hold ${a.id} as ${a.status}; the released amount is not spendable yet`, 10_000);
  await logEvent(db, po, "paypal.release", `Hold ${a.id} is ${a.status}: remainder released`, { status: a.status });
  await record(db, po.id, v, "confirm_release", { status: a.status });
}

async function orderReplacement(po: PO, v: number, body: any): Promise<string | null> {
  const db = await getDb();
  const picks = body.plan?.chosen?.picks ?? [];
  if (!picks.length) return null;
  const existing = (await db.query<{ id: string }>("SELECT id FROM purchase_orders WHERE parent_id = $1 AND parent_version = $2", [po.id, v])).rows[0];
  if (existing) return existing.id;
  // Recheck before committing: the held stock, the price and the deadline must still hold.
  const problems: string[] = [];
  for (const p of picks) {
    const prod = (await db.query<any>("SELECT * FROM products WHERE id = $1", [p.product_id])).rows[0];
    const held = (await db.query<{ n: number }>("SELECT COALESCE(SUM(packs),0)::int AS n FROM stock_holds WHERE source_po = $1 AND version = $2 AND product_id = $3 AND status = 'held'", [po.id, v, p.product_id])).rows[0].n;
    if (!prod?.active) problems.push(`${p.sku} is no longer sold`);
    else if (held < p.packs) problems.push(`${p.sku} is no longer held (${held} of ${p.packs} packs)`);
    else if (prod.stock_packs < p.packs) problems.push(`only ${prod.stock_packs} pack(s) of ${p.sku} are left in stock`);
    if (prod && prod.price_cents !== p.pack_price_cents) problems.push(`${p.sku} price changed from ${fmt(p.pack_price_cents)} to ${fmt(prod.price_cents)}`);
    if (prod && body.needed_by && Date.now() + prod.lead_hours * 3_600_000 > new Date(body.needed_by).getTime()) problems.push(`${p.sku} can no longer arrive by ${new Date(body.needed_by).toISOString().slice(0, 16).replace("T", " ")}`);
  }
  if (problems.length) {
    await db.query("UPDATE stock_holds SET status = 'released' WHERE source_po = $1 AND version = $2 AND status = 'held'", [po.id, v]);
    throw new GtError(`The agreed replacement no longer works: ${problems.join("; ")}. The accepted goods were charged; nothing else was ordered or held. Agree a new replacement.`, "exception");
  }
  return db.tx(async (q) => {
    const again = (await q.query<{ id: string }>("SELECT id FROM purchase_orders WHERE parent_id = $1 AND parent_version = $2", [po.id, v])).rows[0];
    if (again) return again.id;
    const root = await getPo(q, po.root_id);
    const n = (await q.query<{ c: number }>("SELECT count(*)::int AS c FROM purchase_orders WHERE root_id = $1", [po.root_id])).rows[0].c;
    const id = newId("po");
    const number = `${root.number}-R${n}`;
    await q.query(
      `INSERT INTO purchase_orders (id, number, buyer_id, supplier_id, root_id, parent_id, parent_version, kind, status, deliver_by, spend_limit_cents, currency, quote_version, accepted_quote_version, note, is_demo)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'replacement','funding',$8,$9,$10,1,1,$11,(SELECT is_demo FROM purchase_orders WHERE id = $6))`,
      [id, number, po.buyer_id, po.supplier_id, po.root_id, po.id, v, body.needed_by, root.spend_limit_cents, po.currency, `Replacement for ${po.number} per resolution v${v}`],
    );
    let i = 0;
    for (const p of picks) {
      await q.query("INSERT INTO po_lines (id, po_id, line_no, product_id, qty_packs, unit_price_cents, substitutes, replace_shortfall, replaces_line_id) VALUES ($1,$2,$3,$4,$5,$6,'[]',true,$7)", [newId("ln"), id, ++i, p.product_id, p.packs, p.pack_price_cents, p.line_id]);
    }
    await q.query("UPDATE stock_holds SET for_po = $3 WHERE source_po = $1 AND version = $2 AND status = 'held'", [po.id, v, id]);
    await logEvent(q, { id, root_id: po.root_id }, "po.replacement", `Replacement ${number} created from ${po.number} v${v}: ${picks.map((p: any) => `${p.packs} x ${p.sku}`).join(", ")} = ${fmt(body.totals.replacement_cents)}`);
    return id;
  });
}

async function authorizeReplacement(po: PO, v: number, replId: string) {
  const db = await getDb();
  if (await stepDone(db, po.id, v, "authorize_replacement")) return;
  const r = await placeHold(replId, { checkFunding: true }).catch(async (e) => {
    if (e instanceof GtError && e.code === "retry") throw new Retry(e.message, 15_000);
    throw new GtError(`Replacement hold failed: ${(e as Error).message}`, "exception");
  });
  if (r === "waiting") {
    const f = await fundingOf(db, po.root_id);
    throw new Retry(`Replacement needs funding; ${fmt(f.spendable_cents)} spendable now and ${f.expected.map((x) => fmt(x.cents)).join(" + ")} expected but not confirmed`, 10_000);
  }
  if (r === "failed") {
    const f = await fundingOf(db, po.root_id);
    throw new GtError(`Not enough funding for the replacement: ${fmt(f.spendable_cents)} spendable of the ${fmt(f.limit_cents)} limit.`, "exception");
  }
  await record(db, po.id, v, "authorize_replacement", { replacement_po: replId });
}

async function finish(po: PO, v: number, replId: string | null) {
  const db = await getDb();
  await db.tx(async (q) => {
    if (await stepDone(q, po.id, v, "finish")) return;
    await q.query("UPDATE resolutions SET status = 'settled' WHERE po_id = $1 AND version = $2", [po.id, v]);
    if (replId) {
      const r = await getPo(q, replId);
      await setPo(q, po.id, { status: "awaiting_replacement", exception: null });
      await postMessage(q, po.id, null, "StockSure", "system", `Replacement ${r.number} is ordered and funded. ${po.number} closes when it arrives.`, "system");
    } else {
      await setPo(q, po.id, { status: "closed", closed_at: new Date(), exception: null });
    }
    await record(q, po.id, v, "finish", { replacement: replId });
    await logEvent(q, po, "settle.done", replId ? `Settled v${v}; waiting for replacement` : `Settled v${v}; ${po.number} closed`);
    await closeUpTree(q, po);
  });
}

/** A replacement that closes completes its parent; the root closes when the whole tree has. */
async function closeUpTree(q: Queryable, po: PO) {
  let cur = await getPo(q, po.id);
  while (cur.status === "closed" && cur.parent_id) {
    const parent = await getPo(q, cur.parent_id);
    if (parent.status !== "awaiting_replacement") break;
    const open = (await q.query("SELECT 1 FROM purchase_orders WHERE parent_id = $1 AND status <> 'closed'", [parent.id])).rows.length;
    if (open) break;
    await setPo(q, parent.id, { status: "closed", closed_at: new Date() });
    await logEvent(q, parent, "po.closed", `${parent.number} closed: replacement received`);
    cur = await getPo(q, parent.id);
  }
  const tree = await treeOf(q, po.root_id);
  if (tree.every((p) => p.status === "closed")) {
    const f = await fundingOf(q, po.root_id);
    await logEvent(q, { id: po.root_id, root_id: po.root_id }, "root.closed", `Order closed: ${fmt(f.captured_cents - f.refunded_cents)} spent of ${fmt(f.limit_cents)}`, f);
  }
}

/**
 * Part delivery charge: captures the agreed part's accepted value on the hold with final_capture=false, so the
 * rest stays authorized for the remaining delivery. Same request id on every retry; a lost response is read back
 * by invoice id; PENDING waits; anything else is an exception. Nothing is charged for a part that accepted nothing.
 */
export async function settlePart(poId: string, attempt = 0) {
  const db = await getDb();
  const po = await getPo(db, poId);
  if (po.status !== "part_settling") return;
  const ship = (await db.query<any>("SELECT * FROM shipments WHERE po_id = $1 AND kind = 'part' AND status = 'charging'", [poId])).rows[0];
  if (!ship) return;
  const amount: number = ship.accepted_cents ?? 0;
  const done = async (captureId: string | null) => {
    // Show the hold as PayPal now has it (PARTIALLY_CAPTURED after a part capture); a failed read changes nothing.
    if (captureId && po.auth_id) {
      const a = await paypal().getAuthorization(po.auth_id).catch(() => null);
      if (a) await db.query("UPDATE payment_ops SET paypal_status = $2, updated_at = now() WHERE paypal_id = $1 AND kind = 'authorize'", [a.id, a.status]);
    }
    await db.tx(async (q) => {
      await q.query("UPDATE shipments SET status = 'charged' WHERE id = $1", [ship.id]);
      await setPo(q, po.id, { status: "part_delivered", exception: null });
      await logEvent(q, po, "part.charged", amount ? `Part 1 charged ${fmt(amount)} on hold ${po.auth_id} (capture ${captureId}, not final); the rest of the hold stays for the remaining delivery` : "Part 1 accepted nothing: nothing charged; the hold stays for the remaining delivery");
      await postMessage(q, po.id, null, "StockSure", "system", amount ? `Part 1 charged ${fmt(amount)} (capture ${captureId}). The rest of the hold is still in place; ship the rest when ready.` : "Part 1 had nothing accepted, so nothing was charged. Ship the rest when ready.", "system");
    });
  };
  if (amount === 0) return done(null);
  if (!po.auth_id) return exception(po, `${po.number} has no PayPal hold for part 1.`);
  const pp = paypal();
  const tag = await instanceTag(db);
  const holdOp = (await db.query<PaymentOp>("SELECT * FROM payment_ops WHERE paypal_id = $1 AND kind = 'authorize'", [po.auth_id])).rows[0];
  // After a refused capture (DECLINED, a 4xx) a retry is a new request: the old one would only replay the refusal.
  const tries = (await db.query<PaymentOp>("SELECT * FROM payment_ops WHERE po_id = $1 AND kind = 'capture' AND (request_id = $2 OR request_id LIKE $3) ORDER BY created_at, id", [po.id, `cap:${po.id}:part1`, `cap:${po.id}:part1:r%`])).rows;
  const last = tries.at(-1);
  if (last?.status === "succeeded") return done(last.paypal_id);
  const n = last?.status === "failed" ? tries.length : Math.max(0, tries.length - 1);
  const op = await ensureOp(db, po, "capture", n ? `cap:${po.id}:part1:r${n}` : `cap:${po.id}:part1`, amount, { final_capture: false, parent_paypal_id: po.auth_id, paypal_order_id: holdOp?.paypal_order_id ?? null });
  if (op.status === "succeeded") return done(op.paypal_id);
  const invoiceId = `${po.number}-${tag}-P1${n ? `R${n}` : ""}`;
  let captureId: string | null = op.paypal_id;
  let status: string | null = op.paypal_status;
  if (!(op.status === "pending" && captureId && status === "PENDING")) {
    const run = await startRun({ actor: "code", subject: `part capture ${po.number} ${fmt(amount)}`, entity: "po", entityId: po.id }, db);
    const verdict = await dryRun({ action: "capture", ownerId: po.buyer_id, agentScope: `org:${po.buyer_id}`, entity: "po", entityId: po.id, cents: amount, trustedCents: [amount], authorizationId: po.auth_id }, run, db);
    if (verdict.gate === "held") {
      await run.end("held");
      if (verdict.fresh) {
        await logEvent(db, po, "settle.held", `Part 1 capture of ${fmt(amount)} waits for the buyer's approval ${verdict.approvalId}: ${verdict.reason}`);
        await postMessage(db, po.id, null, "StockSure", "system", `Part 1 charge of ${fmt(amount)} waits for the buyer's approval: ${verdict.reason}`, "system");
      }
      return; // the owner's approval re-queues this job (guard/release.ts)
    }
    if (verdict.gate !== "allowed") {
      await run.end("failed");
      return exception(po, `The guard refused the part 1 capture before PayPal: ${verdict.reason}`);
    }
    await run.end("done");
  }
  try {
    if (op.status === "pending" && captureId && status === "PENDING") {
      status = (await pp.getCapture(captureId)).status;
    } else {
      await db.query("UPDATE payment_ops SET status = 'pending', attempts = attempts + 1, updated_at = now() WHERE id = $1", [op.id]);
      try {
        const c = await pp.captureAuthorization(po.auth_id, { amountCents: amount, currency: po.currency, finalCapture: false, invoiceId, note: `${po.number}: part 1 accepted goods` }, op.request_id);
        captureId = c.id;
        status = c.status;
      } catch (e) {
        const unknown = e instanceof UnknownOutcomeError || (e instanceof PayPalError && e.status >= 500);
        if (!unknown) {
          await db.query("UPDATE payment_ops SET status = 'failed', error = $2, updated_at = now() WHERE id = $1", [op.id, (e as Error).message]);
          return exception(po, `PayPal refused the part 1 capture: ${(e as Error).message}`);
        }
        const found = holdOp?.paypal_order_id ? capturesOf(await pp.getOrder(holdOp.paypal_order_id)).find((c) => c.invoice_id === invoiceId) : null;
        if (!found) {
          await db.query("UPDATE payment_ops SET error = $2, updated_at = now() WHERE id = $1", [op.id, (e as Error).message]);
          throw e; // job retry, same request id
        }
        captureId = found.id;
        status = found.status;
        await logEvent(db, po, "paypal.readback", `Part 1 capture response was lost; read back ${found.id} from order ${holdOp!.paypal_order_id}`);
      }
    }
  } catch (e) {
    if (attempt < 6) {
      await enqueue(db, "settle_part", { poId, attempt: attempt + 1 }, new Date(Date.now() + 15_000), `settle_part:${poId}`);
      return;
    }
    return exception(po, `Part 1 capture could not be confirmed: ${(e as Error).message}`);
  }
  if (status === "PENDING") {
    await db.query("UPDATE payment_ops SET status = 'pending', paypal_id = $2, paypal_status = 'PENDING', updated_at = now() WHERE id = $1", [op.id, captureId]);
    await logEvent(db, po, "paypal.capture_pending", `Part 1 capture ${captureId} is PENDING at PayPal; the rest waits until it completes`);
    await enqueue(db, "settle_part", { poId, attempt }, new Date(Date.now() + 10 * 60_000), `settle_part:${poId}`);
    return;
  }
  await db.query("UPDATE payment_ops SET status = $2, paypal_id = $3, paypal_status = $4, error = NULL, updated_at = now() WHERE id = $1", [op.id, status === "COMPLETED" ? "succeeded" : "failed", captureId, status]);
  if (status !== "COMPLETED") return exception(po, `PayPal reports the part 1 capture ${captureId} as ${status}: part 1 is not paid and nothing was charged. Retry tries a new capture.`);
  await logEvent(db, po, "paypal.capture", `Captured ${fmt(amount)} on hold ${po.auth_id} for part 1 (not final): ${captureId} COMPLETED`, { capture_id: captureId, status });
  return done(captureId);
}

/** Operator retry after an exception: resumes the saga from the first step not recorded. */
export async function retrySettle(poId: string) {
  const db = await getDb();
  const po = await getPo(db, poId);
  const res = await latestResolution(db, poId);
  const charging = (await db.query("SELECT 1 FROM shipments WHERE po_id = $1 AND status = 'charging'", [poId])).rows.length;
  if (po.status === "exception" && charging) {
    await setPo(db, poId, { status: "part_settling", exception: null });
    await enqueue(db, "settle_part", { poId, attempt: 0 }, new Date(), `settle_part:${poId}`);
    return;
  }
  if (po.status !== "exception" || !res || (res.status !== "agreed" && res.status !== "settled")) throw new GtError("Nothing to retry.", "bad_state", 409);
  await setPo(db, poId, { status: "settling", exception: null });
  await enqueue(db, "settle", { poId, version: res.version, attempt: 0 }, new Date(), `settle:${poId}:${res.version}`);
}
