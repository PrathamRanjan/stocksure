import { getDb, type Queryable } from "../db.js";
import { formatUnits } from "../core/units.js";
import { newId } from "../lib/ids.js";
import { GtError } from "../lib/util.js";
import { linesOf, logEvent, poFor, postMessage, who, type Person, type PO } from "../store.js";

/**
 * Early warning on a late supplier. The supplier records an ETA, either its own or a carrier event it forwards,
 * each with the time it was observed. The newest observation wins, so an old or out-of-order update can't
 * replace a newer one. An ETA after the PO's deliver-by date opens a risk card with its evidence. The owner can
 * wait or ask the supplier to expedite. Neither choice creates a payment, a hold or a second order.
 */

const WATCHED = ["funded", "dispatched", "part_delivered"];
const iso = (d: Date) => d.toISOString().slice(0, 16).replace("T", " ") + " UTC";
const hours = (ms: number) => Math.round(ms / 36e5);

export interface EtaInput {
  eta: Date;
  observedAt: Date;
  source: "supplier" | "carrier";
  ref: string;
  note?: string;
}

export async function currentEta(q: Queryable, poId: string) {
  return (await q.query<any>("SELECT * FROM eta_updates WHERE po_id = $1 AND applied ORDER BY observed_at DESC, created_at DESC LIMIT 1", [poId])).rows[0] ?? null;
}

export async function etaUpdates(q: Queryable, poId: string) {
  return (await q.query<any>("SELECT * FROM eta_updates WHERE po_id = $1 ORDER BY created_at", [poId])).rows;
}

export async function openRisk(q: Queryable, poId: string) {
  return (await q.query<any>("SELECT * FROM po_risks WHERE po_id = $1 AND status <> 'closed' ORDER BY created_at DESC LIMIT 1", [poId])).rows[0] ?? null;
}

/** The supplier records an ETA. Same reference twice is one update; an older observation is kept but not applied. */
export async function recordEta(person: Person, poId: string, input: EtaInput) {
  if (person.org_kind !== "supplier") throw new GtError("Only the supplier records a delivery estimate.", "forbidden", 403);
  if (Number.isNaN(input.eta.getTime()) || Number.isNaN(input.observedAt.getTime())) throw new GtError("Give the new arrival time and when it was observed.", "invalid");
  if (input.observedAt.getTime() > Date.now() + 5 * 60_000) throw new GtError("The observation time can't be in the future.", "invalid");
  const ref = input.ref.trim() || `${input.source}:${input.observedAt.toISOString()}`;
  const db = await getDb();
  return db.tx(async (q) => {
    const po = await poFor(q, person, poId, true);
    if (!WATCHED.includes(po.status)) throw new GtError(`${po.number} is ${po.status.replace(/_/g, " ")}; delivery estimates apply only between funding and delivery.`, "bad_state", 409);
    const dup = (await q.query<any>("SELECT * FROM eta_updates WHERE po_id = $1 AND ref = $2", [po.id, ref])).rows[0];
    if (dup) return { update: dup, duplicate: true, risk: await openRisk(q, po.id) };
    const cur = await currentEta(q, po.id);
    const older = cur && input.observedAt.getTime() < new Date(cur.observed_at).getTime();
    const id = newId("eta");
    const ignored = older ? `Observed ${iso(input.observedAt)}, before the update observed ${iso(new Date(cur.observed_at))} (${cur.ref}); the newer ETA stands.` : null;
    await q.query(
      "INSERT INTO eta_updates (id, po_id, eta, observed_at, source, ref, note, recorded_by, applied, ignored_reason) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
      [id, po.id, input.eta, input.observedAt, input.source, ref, (input.note ?? "").slice(0, 300), who(person), !older, ignored],
    );
    await logEvent(q, po, older ? "eta.ignored" : "eta.recorded", older ? `ETA ${iso(input.eta)} from ${input.source} (${ref}) not applied: ${ignored}` : `${input.source === "carrier" ? "Carrier" : "Supplier"} ETA ${iso(input.eta)} (${ref}, observed ${iso(input.observedAt)})`, { id }, who(person));
    const risk = older ? await openRisk(q, po.id) : await assess(q, po);
    return { update: (await q.query<any>("SELECT * FROM eta_updates WHERE id = $1", [id])).rows[0], duplicate: false, risk };
  });
}

/** Compare the applied ETA with the need-by. Opens, updates or closes the single risk card for the PO. */
async function assess(q: Queryable, po: PO) {
  const cur = await currentEta(q, po.id);
  const risk = await openRisk(q, po.id);
  if (!cur) return risk;
  const slackMs = new Date(po.deliver_by).getTime() - new Date(cur.eta).getTime();
  const evidence = (await q.query<{ id: string }>("SELECT id FROM eta_updates WHERE po_id = $1 AND applied ORDER BY observed_at", [po.id])).rows.map((r) => r.id);
  if (slackMs >= 0) {
    if (risk) {
      await q.query("UPDATE po_risks SET status = 'closed', closed_at = now(), closed_reason = $2, eta = $3, slack_minutes = $4, evidence = $5 WHERE id = $1", [risk.id, `Back on time: ETA ${iso(new Date(cur.eta))} (${cur.ref})`, cur.eta, Math.round(slackMs / 60_000), JSON.stringify(evidence)]);
      await logEvent(q, po, "risk.closed", `Delivery back on time: ETA ${iso(new Date(cur.eta))}, ${hours(slackMs)}h before deliver-by`);
      await postMessage(q, po.id, null, "StockSure", "system", `Back on time: the latest ETA (${iso(new Date(cur.eta))}) is before the deliver-by time.`, "system");
    }
    return null;
  }
  if (risk) {
    await q.query("UPDATE po_risks SET eta = $2, slack_minutes = $3, evidence = $4 WHERE id = $1", [risk.id, cur.eta, Math.round(slackMs / 60_000), JSON.stringify(evidence)]);
  } else {
    await q.query("INSERT INTO po_risks (id, po_id, kind, status, eta, deliver_by, slack_minutes, evidence) VALUES ($1,$2,'late','open',$3,$4,$5,$6)", [newId("rsk"), po.id, cur.eta, po.deliver_by, Math.round(slackMs / 60_000), JSON.stringify(evidence)]);
  }
  await logEvent(q, po, "risk.late", `At risk: ETA ${iso(new Date(cur.eta))} is ${hours(-slackMs)}h after deliver-by ${iso(new Date(po.deliver_by))} (evidence ${cur.ref})`);
  if (!risk) await postMessage(q, po.id, null, "StockSure", "system", `Early warning: the latest ETA (${iso(new Date(cur.eta))}, ${cur.source} ${cur.ref}) is ${hours(-slackMs)}h after the deliver-by time. The owner can wait or ask to expedite.`, "system");
  return openRisk(q, po.id);
}

/** What the owner sees: slack, stock on hand for each line, other connected suppliers' stock, and what isn't known. */
export async function riskView(q: Queryable, po: PO) {
  const risk = (await q.query<any>("SELECT * FROM po_risks WHERE po_id = $1 ORDER BY created_at DESC LIMIT 1", [po.id])).rows[0] ?? null;
  if (!risk) return null;
  const lines = await linesOf(q, po.id);
  const onHand = [];
  for (const l of lines) {
    const units = (await q.query<{ units: number }>("SELECT units FROM stock WHERE buyer_id = $1 AND product_id = $2", [po.buyer_id, l.product_id])).rows[0]?.units ?? 0;
    const alts = (await q.query<any>("SELECT p.sku, p.name, o.name AS supplier, p.stock_packs, p.lead_hours FROM products p JOIN orgs o ON o.id = p.supplier_id WHERE p.family = $1 AND p.family <> '' AND p.supplier_id <> $2 AND p.active AND p.stock_packs >= $3", [l.product.family, po.supplier_id, l.qty_packs])).rows;
    onHand.push({ line: l, on_hand: formatUnits(units, l.product), ordered: formatUnits(l.qty_packs * l.product.pack_units, l.product), alternatives: alts });
  }
  const ids: string[] = typeof risk.evidence === "string" ? JSON.parse(risk.evidence) : risk.evidence ?? [];
  const evidence = (await q.query<any>("SELECT * FROM eta_updates WHERE id = ANY($1) ORDER BY observed_at", [ids])).rows;
  const unknowns = [
    "Your usage rate isn't recorded, so StockSure can't say when the stock on hand runs out.",
    "Carrier events come only from updates the supplier forwards; StockSure doesn't track the parcel itself.",
  ];
  return { risk, onHand, evidence, unknowns };
}

/** The owner's choice. Neither choice creates a payment, a hold or another order. */
export async function decideRisk(person: Person, poId: string, choice: "wait" | "expedite", note: string) {
  if (person.org_kind !== "buyer" || person.role !== "owner") throw new GtError("Only the buyer's owner decides on a late delivery.", "forbidden", 403);
  const db = await getDb();
  await db.tx(async (q) => {
    const po = await poFor(q, person, poId, true);
    const risk = await openRisk(q, po.id);
    if (!risk) throw new GtError("There is no open delivery risk on this order.", "bad_state", 409);
    if (choice === "wait") {
      await q.query("UPDATE po_risks SET status = 'waiting', decision = 'wait', decided_by = $2, decision_note = $3 WHERE id = $1", [risk.id, who(person), note.slice(0, 300)]);
      await logEvent(q, po, "risk.wait", `${person.name} will wait for the late delivery${note ? `: ${note}` : ""}`, null, who(person));
    } else {
      await q.query("UPDATE po_risks SET status = 'expedite_asked', decision = 'expedite', decided_by = $2, decision_note = $3 WHERE id = $1", [risk.id, who(person), note.slice(0, 300)]);
      await postMessage(q, po.id, null, who(person), "owner", `Please expedite ${po.number}: we need it by ${iso(new Date(po.deliver_by))}.${note ? ` ${note}` : ""} Record a new ETA here when you have one.`);
      await logEvent(q, po, "risk.expedite", `${person.name} asked the supplier to expedite`, null, who(person));
    }
  });
}

/** Delivery closes the warning, whatever the last ETA said. */
export async function closeRisksOnDelivery(q: Queryable, po: PO) {
  await q.query("UPDATE po_risks SET status = 'closed', closed_at = now(), closed_reason = 'Delivered' WHERE po_id = $1 AND status <> 'closed'", [po.id]);
}

export async function riskyPos(q: Queryable, orgId: string) {
  return new Set((await q.query<{ po_id: string }>("SELECT r.po_id FROM po_risks r JOIN purchase_orders p ON p.id = r.po_id WHERE r.status <> 'closed' AND (p.buyer_id = $1 OR p.supplier_id = $1)", [orgId])).rows.map((r) => r.po_id));
}
