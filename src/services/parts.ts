import { getDb, type Queryable } from "../db.js";
import { enqueue } from "../jobs.js";
import { lineCents } from "../core/money.js";
import { fmt } from "../core/money.js";
import { formatUnits } from "../core/units.js";
import { newId } from "../lib/ids.js";
import { GtError } from "../lib/util.js";
import { heldPacks, linesOf, logEvent, poFor, postMessage, setPo, who, type Person, type PO, type PoLine } from "../store.js";

/**
 * Delivery in two parts on one PayPal hold.
 *   part:  the supplier ships some packs now; once both sides agree that delivery's counts, StockSure captures
 *          just its accepted value with final_capture=false, so the rest of the hold stays live.
 *   rest:  the supplier ships the remaining packs; the buyer counts only that delivery; the receipt adds it to the
 *          agreed part, so the usual resolution sees the whole order. Settlement then captures the total less what
 *          the part already charged, as the final capture, and PayPal releases what is left.
 * The two captures always add up to the agreed payable amount.
 */

export interface Shipment {
  id: string;
  po_id: string;
  seq: number;
  kind: "part" | "rest";
  packs: Record<string, number>;
  status: "dispatched" | "charging" | "charged";
  receipt_version: number | null;
  accepted_cents: number | null;
  dispatched_by: string;
  created_at: Date;
}

const parse = (s: any): Shipment => ({ ...s, packs: typeof s.packs === "string" ? JSON.parse(s.packs) : s.packs });

export async function shipmentsOf(q: Queryable, poId: string): Promise<Shipment[]> {
  return (await q.query<any>("SELECT * FROM shipments WHERE po_id = $1 ORDER BY seq", [poId])).rows.map(parse);
}

export type DeliveryMode = "whole" | "part" | "rest";

export interface DeliveryContext {
  mode: DeliveryMode;
  part: Shipment | null;
  /** Units expected in the delivery being received now, per PO line. */
  expected: Map<string, number>;
  /** Agreed counts of the part already charged, per PO line (only in "rest" mode). */
  base: Map<string, { delivered: number; damaged: number; wrong: number; accepted: number }>;
}

/** What the delivery being received now is: the whole order, the first part, or the rest after a charged part. */
export async function deliveryContext(q: Queryable, po: PO, lines?: PoLine[]): Promise<DeliveryContext> {
  const ls = lines ?? (await linesOf(q, po.id));
  const ships = await shipmentsOf(q, po.id);
  const part = ships.find((s) => s.kind === "part") ?? null;
  const expected = new Map<string, number>();
  const base = new Map<string, { delivered: number; damaged: number; wrong: number; accepted: number }>();
  if (!part) {
    for (const l of ls) expected.set(l.id, l.qty_packs * l.product.pack_units);
    return { mode: "whole", part: null, expected, base };
  }
  if (part.status !== "charged") {
    for (const l of ls) expected.set(l.id, (part.packs[l.id] ?? 0) * l.product.pack_units);
    return { mode: "part", part, expected, base };
  }
  const rows = (
    await q.query<any>("SELECT rl.* FROM receipt_lines rl JOIN receipts r ON r.id = rl.receipt_id WHERE r.po_id = $1 AND r.version = $2", [po.id, part.receipt_version])
  ).rows;
  for (const r of rows) base.set(r.po_line_id, { delivered: r.delivered_units, damaged: r.damaged_units, wrong: r.wrong_units, accepted: r.accepted_units });
  for (const l of ls) expected.set(l.id, (l.qty_packs - (part.packs[l.id] ?? 0)) * l.product.pack_units);
  return { mode: "rest", part, expected, base };
}

/** What the charged part captured (0 when there is none or it accepted nothing). */
export async function partCharged(q: Queryable, poId: string): Promise<number> {
  const r = (await q.query<{ c: number }>("SELECT COALESCE(SUM(accepted_cents),0)::int AS c FROM shipments WHERE po_id = $1 AND kind = 'part' AND status = 'charged'", [poId])).rows[0];
  return r.c;
}

/** The value of a part delivery's accepted goods at the quote: never more than was shipped in that part. */
export function partValue(lines: PoLine[], part: Shipment, accepted: Map<string, number>): number {
  let total = 0;
  for (const l of lines) {
    const shipped = (part.packs[l.id] ?? 0) * l.product.pack_units;
    const paid = Math.min(accepted.get(l.id) ?? 0, shipped);
    total += lineCents(paid, l.product.pack_units, l.unit_price_cents ?? 0).cents;
  }
  return total;
}

/** The supplier ships part of a funded order now. The rest follows with the normal dispatch. */
export async function dispatchPart(person: Person, poId: string, packs: Record<string, number>) {
  if (person.role !== "supplier") throw new GtError("Only the supplier dispatches.", "forbidden", 403);
  const db = await getDb();
  await db.tx(async (q) => {
    const po = await poFor(q, person, poId, true);
    if (po.status !== "funded") throw new GtError(`${po.number} is ${po.status.replace(/_/g, " ")}; a part delivery can only start from a funded order.`, "bad_state", 409);
    if ((await shipmentsOf(q, po.id)).length) throw new GtError(`${po.number} already has a part delivery.`, "bad_state", 409);
    const lines = await linesOf(q, po.id);
    const clean: Record<string, number> = {};
    let any = false;
    let all = true;
    for (const l of lines) {
      const n = packs[l.id] ?? 0;
      if (!Number.isInteger(n) || n < 0) throw new GtError(`Line ${l.line_no}: ship a whole number of ${l.product.pack_label}s.`, "invalid");
      if (n > l.qty_packs) throw new GtError(`Line ${l.line_no}: only ${l.qty_packs} ${l.product.pack_label}(s) were ordered.`, "invalid");
      clean[l.id] = n;
      if (n > 0) any = true;
      if (n < l.qty_packs) all = false;
    }
    if (!any) throw new GtError("Ship at least one pack in the first part.", "invalid");
    if (all) throw new GtError("That is the whole order: use Mark dispatched instead.", "invalid");
    for (const l of lines) {
      const n = clean[l.id];
      if (!n) continue;
      const others = await heldPacks(q, l.product_id, po.id);
      const r = await q.query("UPDATE products SET stock_packs = stock_packs - $2 WHERE id = $1 AND stock_packs - $3 >= $2 RETURNING stock_packs", [l.product_id, n, others]);
      if (!r.rows.length) throw new GtError(`Not enough ${l.product.sku} free to ship ${n} (some stock is held for agreed replacements).`, "stock", 409);
    }
    await q.query("INSERT INTO shipments (id, po_id, seq, kind, packs, status, dispatched_by) VALUES ($1,$2,1,'part',$3,'dispatched',$4)", [newId("shp"), po.id, JSON.stringify(clean), who(person)]);
    await setPo(q, po.id, { status: "dispatched", dispatched_at: new Date() });
    const what = lines.filter((l) => clean[l.id]).map((l) => `${clean[l.id]} of ${l.qty_packs} × ${l.product.sku}`).join(", ");
    await logEvent(q, po, "po.dispatched_part", `${who(person)} dispatched part 1 of ${po.number}: ${what}`, { packs: clean }, who(person));
    await postMessage(q, po.id, null, "StockSure", "system", `Part 1 shipped: ${what}. Once its counts are agreed, only the accepted part is charged; the rest of the hold stays in place for the remaining delivery.`, "system");
  });
}

/** Both sides agreed the part's counts: record its value and charge it on the hold (job settle_part). */
export async function startPartCharge(q: Queryable, po: PO, receiptVersion: number, accepted: Map<string, number>) {
  const ctx = await deliveryContext(q, po);
  if (ctx.mode !== "part" || !ctx.part || ctx.part.status !== "dispatched") return false;
  const lines = await linesOf(q, po.id);
  const value = partValue(lines, ctx.part, accepted);
  await q.query("UPDATE shipments SET status = 'charging', receipt_version = $2, accepted_cents = $3 WHERE id = $1", [ctx.part.id, receiptVersion, value]);
  await setPo(q, po.id, { status: "part_settling", agreed_at: new Date() });
  const summary = lines
    .filter((l) => (ctx.part!.packs[l.id] ?? 0) > 0)
    .map((l) => `${formatUnits(Math.min(accepted.get(l.id) ?? 0, ctx.expected.get(l.id) ?? 0), l.product)} of ${formatUnits(ctx.expected.get(l.id) ?? 0, l.product)} ${l.product.sku}`)
    .join(", ");
  await logEvent(q, po, "part.agreed", `Part 1 counts agreed (receipt v${receiptVersion}): ${summary} accepted, worth ${fmt(value)}`);
  await enqueue(q, "settle_part", { poId: po.id }, new Date(), `settle_part:${po.id}`);
  return true;
}
