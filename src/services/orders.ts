import { config } from "../config.js";
import { getDb, type Queryable } from "../db.js";
import { shipmentsOf } from "./parts.js";
import { extractInvoice, type Candidate } from "../ai/extract.js";
import { fmt } from "../core/money.js";
import { newId } from "../lib/ids.js";
import { enqueue } from "../jobs.js";
import { GtError, sha256Hex } from "../lib/util.js";
import { authOf, paypal, PayPalError, UnknownOutcomeError } from "../paypal/index.js";
import { catalog, fundingOf, getPo, heldPacks, linesOf, logEvent, orgById, poFor, postMessage, putSetting, setPo, setting, who, type Person, type PO, type PoLine } from "../store.js";
import { dryRun } from "../guard/dryrun.js";
import { startRun, type Run } from "../trace.js";
import { countersignAsSupplier, signAsBuyer } from "./agreements.js";
import { scheduleReauthorize } from "./reauth.js";
import { notifyOrder } from "../channels/handlers.js";

export const quoteTotal = (lines: PoLine[]) => lines.reduce((a, l) => a + l.qty_packs * (l.unit_price_cents ?? 0), 0);

/** Short random suffix so PayPal invoice ids stay unique across demo resets. */
export async function instanceTag(q: Queryable): Promise<string> {
  let t = await setting(q, "instance_tag");
  if (!t) {
    t = newId("i", 5).slice(2).toUpperCase();
    await putSetting(q, "instance_tag", t);
  }
  return t;
}

function need(person: Person, roles: Person["role"][], what: string) {
  if (!roles.includes(person.role)) throw new GtError(`Only ${roles.join(" or ")} can ${what}.`, "forbidden", 403);
}

function needState(po: PO, states: PO["status"][], what: string) {
  if (!states.includes(po.status)) throw new GtError(`${po.number} is ${po.status.replace(/_/g, " ")}; cannot ${what}.`, "bad_state", 409);
}

async function nextNumber(q: Queryable): Promise<string> {
  const n = Number((await setting(q, "po_seq")) ?? "1000") + 1;
  await putSetting(q, "po_seq", String(n));
  return `SS-${n}`;
}

export interface DraftLine {
  product_id: string;
  qty_packs: number;
  substitutes: string[];
  replace_shortfall: boolean;
}

export async function createPo(person: Person, input: { supplier_id: string; lines: DraftLine[]; deliver_by: Date; spend_limit_cents: number; note?: string }, isDemo = false): Promise<string> {
  need(person, ["owner"], "create a purchase order");
  if (!input.lines.length) throw new GtError("Add at least one line.", "invalid");
  if (!Number.isInteger(input.spend_limit_cents) || input.spend_limit_cents <= 0) throw new GtError("Set a spending limit above $0.", "invalid");
  if (Number.isNaN(input.deliver_by.getTime())) throw new GtError("Set a delivery deadline.", "invalid");
  const db = await getDb();
  return db.tx(async (q) => {
    const supplier = await orgById(q, input.supplier_id);
    if (!supplier || supplier.kind !== "supplier") throw new GtError("Unknown supplier", "invalid");
    const cat = new Map((await catalog(q, supplier.id)).map((p) => [p.id, p]));
    const id = newId("po");
    const number = await nextNumber(q);
    await q.query(
      `INSERT INTO purchase_orders (id, number, buyer_id, supplier_id, root_id, status, deliver_by, spend_limit_cents, currency, note, is_demo) VALUES ($1,$2,$3,$4,$1,'draft',$5,$6,$7,$8,$9)`,
      [id, number, person.org_id, supplier.id, input.deliver_by, input.spend_limit_cents, config.currency, input.note ?? "", isDemo],
    );
    let n = 0;
    for (const l of input.lines) {
      const p = cat.get(l.product_id);
      if (!p) throw new GtError("A line names a product this supplier does not sell.", "invalid");
      if (!Number.isInteger(l.qty_packs) || l.qty_packs <= 0) throw new GtError(`Quantity for ${p.sku} must be a whole number of ${p.pack_label}s.`, "invalid");
      const subs = l.substitutes.filter((s) => s !== p.id && cat.get(s)?.base_unit === p.base_unit);
      await q.query("INSERT INTO po_lines (id, po_id, line_no, product_id, qty_packs, substitutes, replace_shortfall) VALUES ($1,$2,$3,$4,$5,$6,$7)", [newId("ln"), id, ++n, p.id, l.qty_packs, JSON.stringify(subs), l.replace_shortfall]);
    }
    await logEvent(q, { id, root_id: id }, "po.created", `${who(person)} drafted ${number}`, null, who(person));
    return id;
  });
}

export async function submitPo(person: Person, poId: string) {
  need(person, ["owner"], "submit an order");
  const db = await getDb();
  await db.tx(async (q) => {
    const po = await poFor(q, person, poId, true);
    if (po.status === "submitted") return;
    needState(po, ["draft"], "submit");
    await setPo(q, po.id, { status: "submitted" });
    await logEvent(q, po, "po.submitted", `${who(person)} sent ${po.number} to ${po.supplier_name}`, null, who(person));
    await notifyOrder("supplier", po.supplier_id, `New order ${po.number} from ${po.buyer_name}: please quote.`, po.id, q).catch(() => undefined);
  });
}

/** Supplier prices each line; every quote bumps the version so the buyer accepts a specific one. */
export async function quotePo(person: Person, poId: string, prices: Record<string, number>) {
  need(person, ["supplier"], "quote");
  const db = await getDb();
  await db.tx(async (q) => {
    const po = await poFor(q, person, poId, true);
    needState(po, ["submitted", "quoted"], "quote");
    const lines = await linesOf(q, po.id);
    for (const l of lines) {
      const c = prices[l.id] ?? l.product.price_cents;
      if (!Number.isInteger(c) || c < 0) throw new GtError(`Price for line ${l.line_no} is not valid.`, "invalid");
      await q.query("UPDATE po_lines SET unit_price_cents = $2 WHERE id = $1", [l.id, c]);
    }
    const total = quoteTotal(await linesOf(q, po.id));
    await setPo(q, po.id, { status: "quoted", quote_version: po.quote_version + 1 });
    await logEvent(q, po, "po.quoted", `${who(person)} quoted ${fmt(total)} (v${po.quote_version + 1})`, { total_cents: total }, who(person));
    await notifyOrder("buyer", po.buyer_id, `${po.supplier_name} quoted ${fmt(total)} for ${po.number} (v${po.quote_version + 1}). Accept it in StockSure to place the hold.`, po.id, q).catch(() => undefined);
  });
}

/** Buyer accepts quote vN and the hold is placed on their saved PayPal. */
export async function acceptQuote(person: Person, poId: string, version: number, opts: { agentId?: string } = {}) {
  need(person, ["owner"], "accept a quote");
  const db = await getDb();
  const po = await db.tx(async (q) => {
    const po = await poFor(q, person, poId, true);
    if (po.status === "funded" && po.accepted_quote_version === version) return po;
    needState(po, ["quoted"], "accept the quote");
    if (version !== po.quote_version) throw new GtError(`The supplier changed the quote (now v${po.quote_version}). Review it and accept again.`, "stale_quote", 409);
    const total = quoteTotal(await linesOf(q, po.id));
    if (total > po.spend_limit_cents) throw new GtError(`Quote ${fmt(total)} is above your ${fmt(po.spend_limit_cents)} limit.`, "over_limit", 409);
    const buyer = await orgById(q, po.buyer_id);
    if (!buyer?.vault_token_id) throw new GtError("Connect PayPal first so the hold can be placed.", "no_paypal", 409);
    await setPo(q, po.id, { status: "funding", accepted_quote_version: version });
    // S5: the exact terms both sides are bound to, hashed and HMAC-signed; the supplier countersigns at dispatch.
    const agreement = await signAsBuyer(q, po, version, opts.agentId ? `${opts.agentId} for ${who(person)}` : who(person));
    await logEvent(q, po, "po.accepted", `${opts.agentId ? `Agent ${opts.agentId} (for ${who(person)})` : who(person)} accepted quote v${version} (${fmt(total)}); agreement ${agreement.hash.slice(0, 12)}`, { total_cents: total, agreement_hash: agreement.hash, agent_id: opts.agentId ?? null }, who(person));
    return po;
  });
  if (po.status !== "funded") await placeHold(po.id, { agentId: opts.agentId });
}

/**
 * Places a PayPal authorization (hold) for a PO. Used for the accepted quote and for replacement orders.
 * Same request id on every retry; the funding check reads only confirmed state.
 */
export async function placeHold(poId: string, opts: { checkFunding?: boolean; agentId?: string } = {}): Promise<"funded" | "waiting" | "failed"> {
  const db = await getDb();
  const po = await getPo(db, poId);
  if (po.status === "funded" || po.auth_id) return "funded";
  const lines = await linesOf(db, po.id);
  const total = quoteTotal(lines);
  const buyer = await orgById(db, po.buyer_id);
  const tag = await instanceTag(db);
  const base = `hold:${po.id}:${po.accepted_quote_version ?? 1}`;
  const prior = (await db.query<any>("SELECT * FROM payment_ops WHERE po_id = $1 AND kind = 'authorize' AND (request_id = $2 OR request_id LIKE $3) ORDER BY created_at DESC, id DESC", [po.id, base, `${base}:r%`])).rows;
  // Reuse the live request; only after a definite refusal does a new attempt get a new request id.
  let op = prior[0] && prior[0].status !== "failed" ? prior[0] : null;
  const requestId = prior.length ? `${base}:r${prior.length}` : base;
  if (!op) {
    if (opts.checkFunding) {
      const f = await fundingOf(db, po.root_id);
      if (f.spendable_cents < total) return f.expected.length ? "waiting" : "failed";
    }
    op = (
      await db.query<any>("INSERT INTO payment_ops (id, po_id, root_id, kind, status, amount_cents, request_id) VALUES ($1,$2,$3,'authorize','pending',$4,$5) ON CONFLICT (request_id) DO UPDATE SET updated_at = now() RETURNING *", [
        newId("op"),
        po.id,
        po.root_id,
        total,
        requestId,
      ])
    ).rows[0];
  }
  if (op.status === "succeeded") return "funded";
  const opRequest: string = op.request_id;
  if (!buyer?.vault_token_id) throw new GtError("Buyer has no saved PayPal.", "no_paypal", 409);
  // B.6: dry run against the mandate and live state before any PayPal write. A refused hold is a refusal, not a retry.
  const run: Run = await startRun({ actor: opts.agentId ? "agent" : "code", agentId: opts.agentId ?? null, subject: `hold ${po.number} ${fmt(total)}`, entity: "po", entityId: po.id }, db);
  const verdict = await dryRun({ action: "authorize", ownerId: po.buyer_id, agentScope: opts.agentId ? `agent:${opts.agentId}` : `org:${po.buyer_id}`, entity: "po", entityId: po.id, cents: total, trustedCents: [total] }, run, db);
  if (verdict.gate !== "allowed") {
    const reason = verdict.reason;
    await run.end("failed");
    await db.query("UPDATE payment_ops SET status = 'failed', error = $2, updated_at = now() WHERE id = $1", [op.id, `guard: ${reason}`]);
    await setPo(db, po.id, { status: po.kind === "replacement" ? "exception" : "quoted", exception: `The guard refused the hold: ${reason}` });
    await logEvent(db, po, "guard.refused", `Hold of ${fmt(total)} refused before PayPal: ${reason}`, { gate: verdict.gate });
    if (po.kind === "replacement") return "failed";
    throw new GtError(`The guard refused the hold: ${reason}`, "guard", 403);
  }
  try {
    await db.query("UPDATE payment_ops SET attempts = attempts + 1, status = 'pending', updated_at = now() WHERE id = $1", [op.id]);
    const t0 = Date.now();
    const order = await paypal().createVaultedAuthorizeOrder(
      { vaultId: buyer.vault_token_id, amountCents: total, currency: po.currency, customId: po.id, invoiceId: `${po.number}-${tag}-H${opRequest.includes(":r") ? opRequest.split(":r").pop() : ""}`, description: `StockSure ${po.number}: ${po.supplier_name} hold` },
      opRequest,
    );
    await run.step({ actor: "paypal", tool: "createVaultedAuthorizeOrder", pp_request_id: opRequest, gate: "allowed", result: { order_id: order.id, status: order.status }, duration_ms: Date.now() - t0 });
    let auth = authOf(order);
    if (!auth && order.status !== "COMPLETED") auth = authOf(await paypal().authorizeOrder(order.id, `authz:${po.id}`));
    if (!auth) throw new GtError(`PayPal order ${order.id} is ${order.status} with no authorization.`, "no_authorization", 502);
    const read = await paypal().getAuthorization(auth.id);
    await run.step({ actor: "paypal", tool: "getAuthorization", result: { authorization_id: read.id, status: read.status }, gate: "allowed" });
    const outcome = await applyHoldStatus(po, op.id, order.id, read.id, read.status, total);
    await run.end(outcome === "funded" ? "done" : outcome === "waiting" ? "held" : "failed");
    return outcome;
  } catch (e) {
    await run.step({ actor: "paypal", tool: "hold", result: { error: (e as Error).message.slice(0, 300) }, gate: "denied", pp_debug_id: e instanceof PayPalError ? e.debugId ?? null : null });
    await run.end("failed");
    if (e instanceof GtError && e.code === "hold_status") throw e;
    if (e instanceof UnknownOutcomeError || (e instanceof PayPalError && e.status >= 500)) {
      // Same request id next time: PayPal returns the original order rather than placing a second hold.
      await db.query("UPDATE payment_ops SET error = $2, updated_at = now() WHERE id = $1", [op.id, (e as Error).message]);
      await setPo(db, po.id, { exception: `Hold not confirmed yet: ${(e as Error).message}. Retry is safe.` });
      throw new GtError(`PayPal did not confirm the hold (${(e as Error).message}). Retrying is safe: it uses the same request.`, "retry", 502);
    }
    await db.query("UPDATE payment_ops SET status = 'failed', error = $2, updated_at = now() WHERE id = $1", [op.id, (e as Error).message]);
    await setPo(db, po.id, { status: po.kind === "replacement" ? "exception" : "quoted", exception: `PayPal refused the hold: ${(e as Error).message}` });
    await logEvent(db, po, "paypal.hold_failed", `PayPal refused the hold: ${(e as Error).message}`);
    throw e instanceof GtError ? e : new GtError(`PayPal refused the hold: ${(e as Error).message}`, "paypal", 502);
  }
}

/**
 * What PayPal says about a hold decides the order's state: only CREATED funds it (and lets it ship). PENDING waits,
 * rechecked by a job; DENIED, VOIDED or EXPIRED means there is no hold, so the order goes back to its quote.
 */
async function applyHoldStatus(po: PO, opId: string, orderId: string, authId: string, status: string, total: number): Promise<"funded" | "waiting" | "failed"> {
  const db = await getDb();
  if (status === "PENDING") {
    await db.tx(async (q) => {
      await q.query("UPDATE payment_ops SET status = 'pending', paypal_order_id = $2, paypal_id = $3, paypal_status = 'PENDING', updated_at = now() WHERE id = $1", [opId, orderId, authId]);
      await setPo(q, po.id, { status: "funding", exception: `PayPal shows hold ${authId} as PENDING. ${po.number} is not funded and cannot ship until PayPal confirms it.` });
      await logEvent(q, po, "paypal.hold_pending", `Hold ${authId} for ${fmt(total)} is PENDING at PayPal; rechecking`, { authorization_id: authId });
      await enqueue(q, "hold_recheck", { poId: po.id }, new Date(Date.now() + 5 * 60_000), `hold_recheck:${po.id}`);
    });
    return "waiting";
  }
  if (status !== "CREATED") {
    await db.tx(async (q) => {
      await q.query("UPDATE payment_ops SET status = 'failed', paypal_order_id = $2, paypal_id = $3, paypal_status = $4, error = $5, updated_at = now() WHERE id = $1", [opId, orderId, authId, status, `Authorization ${status}`]);
      await setPo(q, po.id, { status: po.kind === "replacement" ? "exception" : "quoted", auth_id: null, exception: `PayPal reports hold ${authId} as ${status}: there is no hold, so ${po.number} is not funded. Accept the quote again to place a new hold.` });
      await logEvent(q, po, "paypal.hold_failed", `Hold ${authId} is ${status} at PayPal: not funded`, { authorization_id: authId, status });
      await postMessage(q, po.id, null, "StockSure", "system", `PayPal did not grant the hold (${status}). Nothing is held or charged; ${po.number} is back to its quote.`, "system");
    });
    if (po.kind === "replacement") return "failed";
    throw new GtError(`PayPal did not grant the hold (${status}). Nothing is held; accept the quote again to retry.`, "hold_status", 402);
  }
  await db.tx(async (q) => {
      await q.query("UPDATE payment_ops SET status = 'succeeded', paypal_order_id = $2, paypal_id = $3, paypal_status = $4, error = NULL, updated_at = now() WHERE id = $1", [opId, orderId, authId, status]);
      const read = { id: authId, status };
      const order = { id: orderId };
      await setPo(q, po.id, { status: "funded", auth_id: read.id, exception: null });
      await scheduleReauthorize(q, po.id);
      await logEvent(q, po, "paypal.hold", `Hold ${read.id} for ${fmt(total)} is ${read.status}`, { order_id: order.id, authorization_id: read.id, status: read.status });
      await postMessage(q, po.id, null, "StockSure", "system", `PayPal hold placed: ${fmt(total)} (authorization ${read.id}). Nothing is charged until goods are received and agreed.`, "system");
  });
  return "funded";
}

/** Job: a PENDING hold is read again until PayPal decides. */
export async function recheckHold(poId: string) {
  const db = await getDb();
  const po = await getPo(db, poId);
  if (po.status !== "funding") return;
  const op = (await db.query<any>("SELECT * FROM payment_ops WHERE po_id = $1 AND kind = 'authorize' AND paypal_status = 'PENDING' ORDER BY created_at DESC LIMIT 1", [poId])).rows[0];
  if (!op?.paypal_id) return;
  const a = await paypal().getAuthorization(op.paypal_id);
  const total = quoteTotal(await linesOf(db, po.id));
  if (a.status === "PENDING") {
    await enqueue(db, "hold_recheck", { poId }, new Date(Date.now() + 10 * 60_000), `hold_recheck:${poId}`);
    return;
  }
  await applyHoldStatus(po, op.id, op.paypal_order_id, a.id, a.status, total).catch((e) => {
    if (!(e instanceof GtError && e.code === "hold_status")) throw e;
  });
}

export async function retryHold(person: Person, poId: string) {
  need(person, ["owner"], "retry the hold");
  const db = await getDb();
  const po = await poFor(db, person, poId);
  needState(po, ["funding"], "retry the hold");
  await placeHold(po.id);
}

export interface UploadFile {
  filename: string;
  mime: string;
  body: Buffer;
}

export const isText = (mime: string, filename: string) => /^text\//.test(mime) || /\.(txt|csv|md)$/i.test(filename);

export async function storeDoc(q: Queryable, poId: string, kind: "delivery_note" | "invoice" | "photo" | "evidence", f: UploadFile, by: string, flags: unknown[] = []) {
  if (f.body.length > config.maxUploadBytes) throw new GtError(`File is larger than ${Math.round(config.maxUploadBytes / 1048576)} MB.`, "too_large", 413);
  if (!/^(image\/(png|jpe?g|gif|webp)|application\/pdf|text\/(plain|csv))$/.test(f.mime) && !isText(f.mime, f.filename)) throw new GtError("Upload a photo (PNG/JPEG/WebP), a PDF or a text file.", "bad_type", 415);
  const id = newId("doc");
  const text = isText(f.mime, f.filename) ? f.body.toString("utf8") : null;
  await q.query("INSERT INTO documents (id, po_id, kind, filename, mime, size, sha256, body, text_content, flags, uploaded_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)", [
    id,
    poId,
    kind,
    f.filename.slice(0, 120),
    isText(f.mime, f.filename) ? "text/plain" : f.mime,
    f.body.length,
    sha256Hex(f.body),
    f.body,
    text,
    JSON.stringify(flags),
    by,
  ]);
  return { id, text };
}

export async function candidates(q: Queryable, po: PO): Promise<Candidate[]> {
  const lines = await linesOf(q, po.id);
  const onPo = new Set(lines.map((l) => l.product_id));
  const cands: Candidate[] = lines.map((l) => ({ line_id: l.id, ordered_units: l.qty_packs * l.product.pack_units, product: l.product }));
  for (const p of await catalog(q, po.supplier_id)) if (!onPo.has(p.id)) cands.push({ line_id: null, ordered_units: null, product: p });
  return cands;
}

/** Supplier ships: stock leaves the warehouse and the invoice (if any) is stored and compared, never paid from. */
export async function dispatchPo(person: Person, poId: string, invoice: UploadFile | null) {
  need(person, ["supplier"], "dispatch");
  const db = await getDb();
  const po0 = await poFor(db, person, poId);
  if (po0.status === "dispatched") return;
  needState(po0, ["funded", "part_delivered"], "dispatch");
  const ex = invoice ? await extractInvoice({ mime: invoice.mime, body: invoice.body, text: isText(invoice.mime, invoice.filename) ? invoice.body.toString("utf8") : null }, await candidates(db, po0)) : null;
  await db.tx(async (q) => {
    const po = await poFor(q, person, poId, true);
    if (po.status === "dispatched") return;
    needState(po, ["funded", "part_delivered"], "dispatch");
    // S5: dispatching countersigns the hashed agreement; changed lines refuse the dispatch.
    try {
      await countersignAsSupplier(q, po, who(person));
    } catch (e) {
      throw new GtError((e as Error).message, "agreement", 409);
    }
    // After a charged part delivery only the remaining packs ship.
    const part = (await shipmentsOf(q, po.id)).find((x) => x.kind === "part");
    if (po.status === "part_delivered" && part?.status !== "charged") throw new GtError(`${po.number}: part 1 is not settled yet.`, "bad_state", 409);
    const rest: Record<string, number> = {};
    for (const l of await linesOf(q, po.id)) {
      const n = l.qty_packs - (part?.status === "charged" ? (part.packs[l.id] ?? 0) : 0);
      rest[l.id] = n;
      if (n <= 0) continue;
      // Packs held for other orders' agreed replacements are not free to ship here.
      const others = await heldPacks(q, l.product_id, po.id);
      const r = await q.query("UPDATE products SET stock_packs = stock_packs - $2 WHERE id = $1 AND stock_packs - $3 >= $2 RETURNING stock_packs", [l.product_id, n, others]);
      if (!r.rows.length) throw new GtError(`Not enough ${l.product.sku} free to ship ${n} (some stock is held for agreed replacements).`, "stock", 409);
    }
    if (part?.status === "charged") await q.query("INSERT INTO shipments (id, po_id, seq, kind, packs, status, dispatched_by) VALUES ($1,$2,2,'rest',$3,'dispatched',$4) ON CONFLICT (po_id, seq) DO NOTHING", [newId("shp"), po.id, JSON.stringify(rest), who(person)]);
    await q.query("UPDATE stock_holds SET status = 'shipped' WHERE for_po = $1 AND status = 'held'", [po.id]);
    if (invoice && ex) {
      const d = await storeDoc(q, po.id, "invoice", invoice, who(person), ex.instructions);
      await q.query("INSERT INTO extractions (id, document_id, source, lines, flags) VALUES ($1,$2,$3,$4,$5)", [newId("ex"), d.id, ex.source, JSON.stringify(ex.lines), JSON.stringify(ex.instructions)]);
      let i = 0;
      for (const l of ex.lines) await q.query("INSERT INTO invoice_lines (document_id, idx, po_line_id, description, billed_units, unit_price_cents, line_cents) VALUES ($1,$2,$3,$4,$5,$6,$7)", [d.id, i++, l.line_id, l.description, l.units, l.unit_price_cents, l.line_cents]);
      if (ex.instructions.length)
        await postMessage(q, po.id, null, "StockSure", "system", `Invoice ${invoice.filename} contains ${ex.instructions.length} instruction-like line(s) (${[...new Set(ex.instructions.map((f) => f.kind.replace(/_/g, " ")))].join(", ")}). They were removed before reading and cannot change who is paid or how much.`, "system", d.id);
    }
    await setPo(q, po.id, { status: "dispatched", dispatched_at: new Date() });
    await notifyOrder("buyer", po.buyer_id, `${po.number} is on its way from ${po.supplier_name}. Open the dock when it arrives.`, po.id, q).catch(() => undefined);
    await logEvent(q, po, "po.dispatched", `${who(person)} dispatched ${part?.status === "charged" ? `the rest of ${po.number}` : po.number}${invoice ? ` with invoice ${invoice.filename}` : ""}`, ex ? { invoice_lines: ex.lines.length, instruction_flags: ex.instructions.length } : null, who(person));
  });
}

// ---------- PayPal connect (Vault) ----------

export async function startConnect(person: Person): Promise<string> {
  need(person, ["owner"], "connect PayPal");
  const db = await getDb();
  const st = await paypal().createSetupToken({ returnUrl: `${config.appUrl}/connect-paypal/return`, cancelUrl: `${config.appUrl}/home?err=${encodeURIComponent("PayPal connection cancelled")}`, description: "StockSure purchase holds for your wholesaler orders" }, `setup:${person.org_id}:${Date.now()}`);
  if (!st.approveUrl) throw new GtError("PayPal did not return an approval link.", "paypal", 502);
  await db.query("UPDATE orgs SET pending_setup_token = $2 WHERE id = $1", [person.org_id, st.id]);
  return st.approveUrl;
}

export async function completeConnect(person: Person, setupTokenId: string) {
  need(person, ["owner"], "connect PayPal");
  const db = await getDb();
  const org = await orgById(db, person.org_id);
  if (!org || org.pending_setup_token !== setupTokenId) throw new GtError("That PayPal approval does not match this account.", "mismatch", 409);
  const t = await paypal().createPaymentToken(setupTokenId, `ptok:${setupTokenId}`);
  await db.query("UPDATE orgs SET vault_token_id = $2, vault_payer = $3, pending_setup_token = NULL WHERE id = $1", [org.id, t.id, t.payerEmail ?? null]);
  await logEvent(db, null, "paypal.connected", `${org.name} saved PayPal${t.payerEmail ? ` (${t.payerEmail})` : ""}`, { token: t.id }, who(person));
}
