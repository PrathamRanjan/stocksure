import { getDb, type Queryable } from "../db.js";
import { enqueue } from "../jobs.js";
import { fmt } from "../core/money.js";
import { plan as planReplacements, type CatItem } from "../core/planner.js";
import { canonical, isClean, match, type RInvoiceLine, type Remedy } from "../core/resolve.js";
import { newId } from "../lib/ids.js";
import { GtError, sha256Hex } from "../lib/util.js";
import { catalog, fundingOf, getPo, heldPacks, latestReceipt, latestResolution, linesOf, logEvent, poFor, postMessage, setPo, who, type Person, type PO } from "../store.js";

export interface ResolutionOpts {
  choices?: Record<string, Remedy>;
  needed_by?: string; // ISO
  plan_index?: number;
}

/** Default replacement deadline: 07:00 UTC the day after the delivery deadline, or tomorrow, whichever is later. */
export function defaultNeededBy(po: PO, now = new Date()): Date {
  const base = new Date(Math.max(new Date(po.deliver_by).getTime(), now.getTime()));
  const d = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate() + 1, 7, 0, 0));
  return d;
}

async function invoiceLines(q: Queryable, poId: string): Promise<{ docId: string | null; lines: RInvoiceLine[] | null }> {
  const doc = (await q.query<{ id: string }>("SELECT id FROM documents WHERE po_id = $1 AND kind = 'invoice' ORDER BY created_at DESC LIMIT 1", [poId])).rows[0];
  if (!doc) return { docId: null, lines: null };
  const rows = (await q.query<any>("SELECT * FROM invoice_lines WHERE document_id = $1 ORDER BY idx", [doc.id])).rows;
  return { docId: doc.id, lines: rows.map((r) => ({ po_line_id: r.po_line_id, description: r.description, billed_units: r.billed_units, unit_price_cents: r.unit_price_cents, line_cents: r.line_cents })) };
}

/** Builds a resolution body from the agreed receipt. Payable amounts come from quote x accepted units only. */
export async function buildBody(q: Queryable, po: PO, opts: ResolutionOpts, now = new Date()) {
  const lines = await linesOf(q, po.id);
  const rec = await latestReceipt(q, po.id);
  if (!rec) throw new GtError("No confirmed receipt yet.", "bad_state", 409);
  const inv = await invoiceLines(q, po.id);
  const m = match(
    lines.map((l) => ({ line_id: l.id, line_no: l.line_no, product: l.product, qty_packs: l.qty_packs, unit_price_cents: l.unit_price_cents ?? 0, substitutes: l.substitutes, replace_shortfall: l.replace_shortfall })),
    rec.lines.map((r) => ({ line_id: r.po_line_id, delivered: r.delivered_units, accepted: r.accepted_units, damaged: r.damaged_units, wrong: r.wrong_units })),
    inv.lines,
    opts.choices ?? {},
  );
  const root = await getPo(q, po.root_id);
  const f = await fundingOf(q, po.root_id);
  const thisHold = f.holds.find((h) => h.id === po.auth_id);
  const thisLive = thisHold?.live_cents ?? 0;
  // Already captured on this PO's own hold (a part delivery) is inside accepted_cents below: not "other" spend.
  const thisCaptured = thisHold?.captured_cents ?? 0;
  // Committed elsewhere in the tree: captures, other live holds and holds in flight.
  const otherSpend = f.captured_cents - thisCaptured - f.refunded_cents + (f.held_cents - thisLive) + f.inflight_cents;
  const budget = root.spend_limit_cents - otherSpend - m.totals.accepted_cents;
  const neededBy = opts.needed_by ? new Date(opts.needed_by) : defaultNeededBy(po, now);
  if (Number.isNaN(neededBy.getTime())) throw new GtError("Replacement deadline is not a valid date.", "invalid");
  const cat: CatItem[] = (await catalog(q, po.supplier_id, po.id)).map((p) => ({ ...p }));
  const planned = m.needs.length ? planReplacements(m.needs.map((n) => ({ ...n, needed_by: neededBy })), cat, Math.max(0, budget), now) : { plans: [], blocked: [], budget_cents: Math.max(0, budget) };
  const idx = Math.min(Math.max(0, opts.plan_index ?? 0), Math.max(0, planned.plans.length - 1));
  const chosen = planned.plans[idx] ?? null;
  const replacement = chosen?.cost_cents ?? 0;
  const final = otherSpend + m.totals.accepted_cents + replacement;
  return {
    po_id: po.id,
    po_number: po.number,
    receipt_version: rec.receipt.version,
    quote_version: po.accepted_quote_version,
    invoice_doc_id: inv.docId,
    choices: Object.fromEntries(m.lines.filter((l) => l.shortfall > 0).map((l) => [l.line_id, l.remedy])),
    lines: m.lines,
    flags: m.flags,
    needs: m.needs,
    needed_by: neededBy.toISOString(),
    plan: { chosen_index: chosen ? idx : null, chosen, alternatives: planned.plans, blocked: planned.blocked, budget_cents: planned.budget_cents },
    totals: { ...m.totals, replacement_cents: replacement, other_spend_cents: otherSpend, final_cents: final, limit_cents: root.spend_limit_cents, headroom_cents: root.spend_limit_cents - final },
    funding: { spendable_now_cents: f.spendable_cents, hold_cents: thisHold?.amount_cents ?? 0, release_expected_cents: Math.max(0, thisLive - m.totals.accepted_cents) },
    auto: isClean(m),
  };
}

export const hashBody = (body: unknown) => sha256Hex(canonical(body));

/** Creates resolution vN (superseding any open one). A clean receipt is agreed automatically and settles. */
export async function proposeResolution(q: Queryable, poId: string, opts: ResolutionOpts, actor: string) {
  const po = await getPo(q, poId);
  const body = await buildBody(q, po, opts);
  const hash = hashBody(body);
  const last = await latestResolution(q, po.id);
  if (last && last.status === "proposed" && last.hash === hash) return last.version;
  if (last && (last.status === "agreed" || last.status === "settled")) throw new GtError(`Resolution v${last.version} is already agreed.`, "bad_state", 409);
  if (last) await q.query("UPDATE resolutions SET status = 'superseded' WHERE id = $1 AND status = 'proposed'", [last.id]);
  const version = (last?.version ?? 0) + 1;
  const auto = body.auto;
  await q.query(
    `INSERT INTO resolutions (id, po_id, version, status, body, hash, buyer_approved_by, buyer_approved_hash, buyer_approved_at, supplier_approved_by, supplier_approved_hash, supplier_approved_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$7,$8,$9)`,
    [newId("rs"), po.id, version, auto ? "agreed" : "proposed", JSON.stringify(body), hash, auto ? "auto: matches the accepted quote" : null, auto ? hash : null, auto ? new Date() : null],
  );
  if (auto) {
    await setPo(q, po.id, { status: "settling" });
    await postMessage(q, po.id, null, "StockSure", "system", `Delivery matches the order. Settling ${fmt(body.totals.accepted_cents)} on the hold.${body.flags.length ? ` Invoice notes: ${body.flags.map((f) => f.message).join(" ")}` : ""}`, "system");
    await logEvent(q, po, "resolution.auto", `Resolution v${version}: clean delivery, settling ${fmt(body.totals.accepted_cents)}`, { hash }, actor);
    await enqueue(q, "settle", { poId: po.id, version }, new Date(), `settle:${po.id}:${version}`);
  } else {
    await setPo(q, po.id, { status: "resolving" });
    await logEvent(q, po, "resolution.proposed", `Resolution v${version}: pay ${fmt(body.totals.accepted_cents)}${body.totals.replacement_cents ? ` + replacement ${fmt(body.totals.replacement_cents)}` : ""} = ${fmt(body.totals.final_cents)} of ${fmt(body.totals.limit_cents)}`, { hash }, actor);
  }
  return version;
}

/** Buyer changes a remedy, the replacement deadline or the chosen plan: a new version, earlier approvals go stale. */
export async function reviseResolution(person: Person, poId: string, change: ResolutionOpts) {
  if (person.role !== "owner") throw new GtError("Only the buyer's owner changes the resolution.", "forbidden", 403);
  const db = await getDb();
  return db.tx(async (q) => {
    const po = await poFor(q, person, poId, true);
    let cur = await latestResolution(q, po.id);
    // After a replacement that no longer works, the accepted goods are already charged: agree a new replacement.
    const stuck = po.status === "exception" && cur?.status === "agreed" && !(await q.query("SELECT 1 FROM purchase_orders WHERE parent_id = $1 AND parent_version = $2", [po.id, cur.version])).rows.length && (await q.query("SELECT 1 FROM saga_steps WHERE po_id = $1 AND step = 'capture_original'", [po.id])).rows.length;
    if (stuck) {
      await q.query("UPDATE resolutions SET status = 'superseded' WHERE id = $1", [cur!.id]);
      await q.query("UPDATE stock_holds SET status = 'released' WHERE source_po = $1 AND status = 'held'", [po.id]);
      await setPo(q, po.id, { status: "resolving", exception: null });
      await logEvent(q, po, "resolution.replan", `${who(person)} re-planned the replacement after v${cur!.version}'s replacement stopped working; the accepted goods stay charged`, null, who(person));
      cur = await latestResolution(q, po.id);
      change = { ...change, plan_index: 0 };
    } else if (po.status !== "resolving") throw new GtError(`${po.number} is ${po.status.replace(/_/g, " ")}.`, "bad_state", 409);
    const opts: ResolutionOpts = {
      choices: { ...(cur?.body.choices ?? {}), ...(change.choices ?? {}) },
      needed_by: change.needed_by ?? cur?.body.needed_by,
      plan_index: change.plan_index ?? (change.choices || change.needed_by ? 0 : cur?.body.plan.chosen_index ?? 0),
    };
    return proposeResolution(q, po.id, opts, who(person));
  });
}

/** Approval binds to a version and its hash. Both sides approving the current version starts settlement. */
export async function approveResolution(person: Person, poId: string, version: number, hash: string) {
  const side = person.org_kind === "buyer" ? "buyer" : "supplier";
  if (side === "buyer" && person.role !== "owner") throw new GtError("Only the buyer's owner approves payment changes.", "forbidden", 403);
  const db = await getDb();
  return db.tx(async (q) => {
    const po = await poFor(q, person, poId, true);
    const cur = await latestResolution(q, po.id);
    if (!cur) throw new GtError("No resolution yet.", "bad_state", 409);
    if (cur.version !== version || cur.hash !== hash) throw new GtError(`Resolution changed to v${cur.version} since you looked. Review it and approve again.`, "stale", 409);
    if (cur.status === "agreed" || cur.status === "settled") return "agreed";
    if (cur.status !== "proposed" || po.status !== "resolving") throw new GtError("This resolution is no longer open.", "bad_state", 409);
    if (cur.body.totals.final_cents > cur.body.totals.limit_cents) throw new GtError(`Final spend ${fmt(cur.body.totals.final_cents)} is above the ${fmt(cur.body.totals.limit_cents)} limit.`, "over_limit", 409);
    if ((side === "buyer" ? cur.buyer_approved_hash : cur.supplier_approved_hash) === hash) return "already";
    await q.query(`UPDATE resolutions SET ${side}_approved_by = $2, ${side}_approved_hash = $3, ${side}_approved_at = now() WHERE id = $1`, [cur.id, who(person), hash]);
    await postMessage(q, po.id, null, who(person), person.role, `Approved resolution v${version}: pay ${fmt(cur.body.totals.accepted_cents)}${cur.body.totals.replacement_cents ? `, replacement ${fmt(cur.body.totals.replacement_cents)}` : ""}.`, "system");
    await logEvent(q, po, "resolution.approved", `${who(person)} approved v${version}`, { hash }, who(person));
    const other = side === "buyer" ? cur.supplier_approved_hash : cur.buyer_approved_hash;
    if (other !== hash) return "waiting";
    // Hold the replacement stock now, so another order cannot take it while the money settles.
    for (const p of cur.body.plan?.chosen?.picks ?? []) {
      const r = await q.query<{ stock_packs: number; active: boolean }>("SELECT stock_packs, active FROM products WHERE id = $1 FOR UPDATE", [p.product_id]);
      const free = (r.rows[0]?.stock_packs ?? 0) - (await heldPacks(q, p.product_id, null));
      if (!r.rows[0]?.active || free < p.packs) {
        await q.query(`UPDATE resolutions SET ${side}_approved_hash = NULL, ${side}_approved_by = NULL WHERE id = $1`, [cur.id]);
        throw new GtError(`Only ${Math.max(0, free)} pack(s) of ${p.sku} are free now (the plan needs ${p.packs}). Revise the resolution to get a new plan.`, "stale", 409);
      }
      await q.query("INSERT INTO stock_holds (id, product_id, packs, for_po, source_po, version) VALUES ($1,$2,$3,$4,$4,$5)", [newId("sh"), p.product_id, p.packs, po.id, version]);
    }
    await q.query("UPDATE resolutions SET status = 'agreed' WHERE id = $1", [cur.id]);
    await setPo(q, po.id, { status: "settling" });
    await logEvent(q, po, "resolution.agreed", `Both sides agreed resolution v${version}`, { hash });
    await enqueue(q, "settle", { poId: po.id, version }, new Date(), `settle:${po.id}:${version}`);
    return "agreed";
  });
}
