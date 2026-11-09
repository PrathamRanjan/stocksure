/**
 * Negotiation runtime (roadmap S4): one job step per round, every proposal guarded and traced. On agreement the
 * supplier's quote is applied and, if the mandate allows, the buyer accepts it: the PayPal hold then runs through
 * the money gate like any other. Nothing here can move money directly.
 */
import { fmt } from "../core/money.js";
import { getDb } from "../db.js";
import { enqueue } from "../jobs.js";
import { newId } from "../lib/ids.js";
import { GtError } from "../lib/util.js";
import { isKilled } from "../guard/kill.js";
import { rulesFor } from "../guard/policy.js";
import { acceptQuote, quotePo } from "../services/orders.js";
import { getPo, linesOf, logEvent, personById, postMessage, type Person } from "../store.js";
import { Run, startRun } from "../trace.js";
import { buyerCounter, buyerOpening } from "./buyer.js";
import { guardBuyerOffer, guardSupplierAsk, hopeless, meets, totalOf, wording, type Offer } from "./negotiate.js";
import { supplierCounter, supplierOpening } from "./supplier.js";

export interface Negotiation {
  id: string;
  po_id: string;
  status: "open" | "agreed" | "walked_away" | "held" | "failed";
  round: number;
  max_rounds: number;
  buyer_agent: string;
  supplier_agent: string;
  outcome: any;
  run_id: string | null;
}

async function personFor(orgId: string, role: Person["role"]): Promise<Person> {
  const db = await getDb();
  const r = (await db.query<{ id: string }>("SELECT id FROM people WHERE org_id = $1 AND role = $2 ORDER BY id LIMIT 1", [orgId, role])).rows[0];
  const p = r ? await personById(db, r.id) : null;
  if (!p) throw new GtError(`No ${role} person for organisation ${orgId}`, "not_found", 404);
  return p;
}

export async function startNegotiation(poId: string, opts: { buyerAgent: string; supplierAgent?: string }): Promise<string> {
  const db = await getDb();
  const po = await getPo(db, poId);
  if (!["submitted", "quoted"].includes(po.status)) throw new GtError(`${po.number} is ${po.status}; a negotiation needs a submitted or quoted order.`, "bad_state", 409);
  const open = (await db.query<{ id: string }>("SELECT id FROM negotiations WHERE po_id = $1 AND status = 'open'", [poId])).rows[0];
  if (open) return open.id;
  const rules = await rulesFor(po.buyer_id, db);
  if (!rules.agents_may_order) throw new GtError("The buyer's mandate does not let agents negotiate orders.", "forbidden", 403);
  const run = await startRun({ actor: "agent", agentId: opts.buyerAgent, subject: `negotiate ${po.number}`, entity: "po", entityId: po.id }, db);
  const id = newId("neg");
  await db.query("INSERT INTO negotiations (id, po_id, status, max_rounds, buyer_agent, supplier_agent, run_id) VALUES ($1,$2,'open',$3,$4,$5,$6)", [id, poId, rules.max_rounds, opts.buyerAgent, opts.supplierAgent ?? "supplier-agent", run.id]);
  await logEvent(db, po, "negotiation.started", `Agents ${opts.buyerAgent} and ${opts.supplierAgent ?? "supplier-agent"} negotiate ${po.number} (up to ${rules.max_rounds} rounds)`, { negotiation_id: id });
  await enqueue(db, "agent_step", { negotiationId: id }, new Date(), `agent_step:${id}:1`);
  return id;
}

export async function loadNegotiation(id: string): Promise<(Negotiation & { rounds: any[] }) | null> {
  const db = await getDb();
  const n = (await db.query<Negotiation>("SELECT * FROM negotiations WHERE id = $1", [id])).rows[0];
  if (!n) return null;
  const rounds = (await db.query("SELECT * FROM negotiation_rounds WHERE negotiation_id = $1 ORDER BY round, CASE side WHEN 'buyer' THEN 0 ELSE 1 END", [id])).rows;
  return { ...n, rounds };
}

export async function negotiationsFor(poId: string) {
  const db = await getDb();
  return (await db.query<Negotiation>("SELECT * FROM negotiations WHERE po_id = $1 ORDER BY created_at DESC", [poId])).rows;
}

async function finish(n: Negotiation, run: Run, status: Negotiation["status"], outcome: Record<string, unknown>) {
  const db = await getDb();
  await db.query("UPDATE negotiations SET status = $2, outcome = $3, updated_at = now() WHERE id = $1", [n.id, status, JSON.stringify(outcome)]);
  await run.end(status === "agreed" ? "done" : status === "held" ? "held" : "failed");
}

/** One round: buyer proposes, supplier answers, code decides. Re-enqueues itself while the negotiation is open. */
export async function agentStep(negotiationId: string): Promise<void> {
  const db = await getDb();
  const n = (await db.query<Negotiation>("SELECT * FROM negotiations WHERE id = $1", [negotiationId])).rows[0];
  if (!n || n.status !== "open") return;
  const po = await getPo(db, n.po_id);
  const lines = await linesOf(db, po.id);
  const rules = await rulesFor(po.buyer_id, db);
  const supplierOrg = (await db.query<{ floor_pct: number }>("SELECT coalesce(floor_pct, 90) AS floor_pct FROM orgs WHERE id = $1", [po.supplier_id])).rows[0];
  const floorPct = Number(supplierOrg?.floor_pct ?? 90);
  const run = new Run(n.run_id ?? (await startRun({ actor: "agent", agentId: n.buyer_agent, subject: `negotiate ${po.number}`, entity: "po", entityId: po.id }, db)).id, db);
  // Resume the step counter from what is already recorded.
  const stepsSoFar = Number((await db.query<{ c: string }>("SELECT count(*) AS c FROM agent_trace WHERE run_id = $1", [run.id])).rows[0]?.c ?? 0);
  (run as any).n = stepsSoFar;

  const killed = (await isKilled(`org:${po.buyer_id}`, db)) ?? (await isKilled(`agent:${n.buyer_agent}`, db)) ?? (await isKilled(`org:${po.supplier_id}`, db));
  if (killed) {
    await run.step({ actor: "guard", tool: "kill_switch", gate: "denied", result: { scope: killed.scope, reason: killed.reason } });
    await logEvent(db, po, "negotiation.stopped", `Negotiation stopped by kill switch ${killed.scope}`, { negotiation_id: n.id });
    return finish(n, run, "failed", { reason: `kill switch ${killed.scope}` });
  }
  if (!["submitted", "quoted"].includes(po.status)) return finish(n, run, "failed", { reason: `order is ${po.status}` });

  const rounds = (await db.query<any>("SELECT * FROM negotiation_rounds WHERE negotiation_id = $1 ORDER BY round", [n.id])).rows;
  const lastBuyer: Offer | null = rounds.filter((r) => r.side === "buyer").at(-1)?.proposal ?? null;
  const lastSupplier: Offer | null = rounds.filter((r) => r.side === "supplier").at(-1)?.proposal ?? null;
  const round = n.round + 1;

  if (round === 1) {
    const why = hopeless(lines, rules, floorPct, po.spend_limit_cents);
    if (why) {
      await run.step({ actor: "guard", tool: "feasibility", gate: "denied", result: { reason: why } });
      await logEvent(db, po, "negotiation.walked_away", `No deal possible: ${why}`, { negotiation_id: n.id });
      await postMessage(db, po.id, null, n.buyer_agent, "agent", `No agreement is possible on ${po.number}: ${why}.`, "message");
      return finish(n, run, "walked_away", { reason: why, round });
    }
  }

  // Buyer proposes.
  const rawBuyer = lastBuyer && lastSupplier ? buyerCounter(lines, rules, lastBuyer, lastSupplier, round >= n.max_rounds - 1) : buyerOpening(lines, rules);
  const gb = guardBuyerOffer(rawBuyer, lines, rules, po.spend_limit_cents, lastBuyer, lastSupplier);
  const bw = await wording("buyer", round, lines, gb.offer, lastSupplier ? "Meeting you part of the way." : "Opening offer under our purchasing mandate.");
  await db.query("INSERT INTO negotiation_rounds (negotiation_id, round, side, proposal, guard, wording) VALUES ($1,$2,'buyer',$3,$4,$5)", [n.id, round, JSON.stringify(gb.offer), JSON.stringify({ ok: gb.ok, reasons: gb.reasons, total_cents: totalOf(lines, gb.offer), wording_by: bw.by }), bw.text]);
  await run.step({ actor: "agent", tool: "buyer.propose", args: { round, offer: gb.offer }, policy: `mandate: ceiling +${rules.max_over_catalog_pct}%, concession ${rules.max_concession_pct}%/round`, gate: gb.ok ? "allowed" : "denied", result: { total_cents: totalOf(lines, gb.offer), clamped: gb.reasons } });
  if (!gb.ok) {
    await logEvent(db, po, "negotiation.walked_away", `Buyer agent cannot make a valid offer: ${gb.reasons.join("; ")}`, { negotiation_id: n.id });
    return finish(n, run, "walked_away", { reason: gb.reasons.join("; "), round });
  }

  // Supplier answers.
  const rawSupplier = lastSupplier ? supplierCounter(lines, lastSupplier, gb.offer, floorPct) : supplierOpening(lines);
  const gs = guardSupplierAsk(rawSupplier, lines, floorPct);
  // If the buyer already meets the ask, the supplier accepts at its ask (never raises to the buyer's number).
  const agreed = meets(gb.offer, gs.offer, lines);
  const sw = await wording("supplier", round, lines, gs.offer, agreed ? "Agreed; we will quote at these prices." : lastSupplier ? "That is as far as we can go this round." : "Our list prices for this order.");
  await db.query("INSERT INTO negotiation_rounds (negotiation_id, round, side, proposal, guard, accepted, wording) VALUES ($1,$2,'supplier',$3,$4,$5,$6)", [n.id, round, JSON.stringify(gs.offer), JSON.stringify({ ok: gs.ok, reasons: gs.reasons, total_cents: totalOf(lines, gs.offer), wording_by: sw.by }), agreed, sw.text]);
  await run.step({ actor: "agent", tool: "supplier.answer", args: { round, ask: gs.offer }, policy: `floor ${floorPct}% of catalog`, gate: "allowed", result: { total_cents: totalOf(lines, gs.offer), clamped: gs.reasons, agreed } });
  await db.query("UPDATE negotiations SET round = $2, updated_at = now() WHERE id = $1", [n.id, round]);
  await postMessage(db, po.id, null, n.buyer_agent, "agent", bw.text, "message");
  await postMessage(db, po.id, null, n.supplier_agent, "agent", sw.text, "message");

  if (agreed) {
    const total = totalOf(lines, gs.offer);
    const supplier = await personFor(po.supplier_id, "supplier");
    await quotePo(supplier, po.id, gs.offer);
    const quoted = await getPo(db, po.id);
    await run.step({ actor: "code", tool: "quotePo", args: { version: quoted.quote_version, total_cents: total }, gate: "allowed" });
    await logEvent(db, po, "negotiation.agreed", `Agents agreed ${fmt(total)} in round ${round}; quote v${quoted.quote_version} applied`, { negotiation_id: n.id, total_cents: total });
    if (!rules.agents_may_accept) {
      await postMessage(db, po.id, null, "StockSure", "system", `Agents agreed ${fmt(total)} (quote v${quoted.quote_version}). Your mandate asks a person to accept quotes: review and accept on this page.`, "system");
      return finish(n, run, "agreed", { total_cents: total, quote_version: quoted.quote_version, accepted_by_agent: false, round });
    }
    try {
      const owner = await personFor(po.buyer_id, "owner");
      await acceptQuote(owner, po.id, quoted.quote_version, { agentId: n.buyer_agent });
      await run.step({ actor: "code", tool: "acceptQuote", args: { version: quoted.quote_version }, gate: "allowed", result: { status: (await getPo(db, po.id)).status } });
      return finish(n, run, "agreed", { total_cents: total, quote_version: quoted.quote_version, accepted_by_agent: true, round });
    } catch (e) {
      const g = e instanceof GtError ? e : null;
      await run.step({ actor: "code", tool: "acceptQuote", args: { version: quoted.quote_version }, gate: g?.code === "held" ? "held" : "denied", result: { error: (e as Error).message.slice(0, 300) } });
      await postMessage(db, po.id, null, "StockSure", "system", `Agents agreed ${fmt(total)} but the acceptance is waiting: ${(e as Error).message}`, "system");
      return finish(n, run, "held", { total_cents: total, quote_version: quoted.quote_version, reason: (e as Error).message.slice(0, 300), round });
    }
  }

  if (round >= n.max_rounds) {
    const gap = totalOf(lines, gs.offer) - totalOf(lines, gb.offer);
    await logEvent(db, po, "negotiation.walked_away", `No agreement after ${round} rounds (gap ${fmt(gap)})`, { negotiation_id: n.id });
    await postMessage(db, po.id, null, n.buyer_agent, "agent", `We could not reach agreement within ${round} rounds; the gap is ${fmt(gap)}. A person can take it from here.`, "message");
    return finish(n, run, "walked_away", { reason: `max rounds (${round}) reached`, gap_cents: gap, round });
  }
  await enqueue(db, "agent_step", { negotiationId: n.id }, new Date(Date.now() + 500), `agent_step:${n.id}:${round + 1}`);
}
