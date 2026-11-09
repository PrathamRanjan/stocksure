/**
 * What StockSure says on channels and how it answers replies (roadmap B.8). Buyers get approval requests and order
 * events; suppliers get new orders, quotes accepted, receipts and claims; drivers get their stops. Replies can
 * approve or decline a held charge or refund, list what is waiting, or link an address.
 */
import { getDb, type Queryable } from "../db.js";
import { enqueue } from "../jobs.js";
import { countersignThreshold, decideApproval } from "../guard/dryrun.js";
import { orgById, personById } from "../store.js";
import { link, notifyParty, onInbound, type Party } from "./index.js";

const usd = (c: number) => `$${(c / 100).toFixed(2)}`;

export function installChannelHandlers() {
  onInbound(async (m) => {
    const text = m.text.trim();
    const db = await getDb();
    // Linking needs a one-time code made by a signed-in person (Messages, Connect Telegram). An org id alone is not a
    // secret, so "link buyer:<org id>" from a chat is refused: otherwise anyone could receive a café's approval buttons.
    const st = text.match(/^\/start(?:\s+(\S+))?$/i);
    if (st && m.channel !== "simulator") {
      const code = st[1] ?? "";
      const row = code ? (await db.query<{ value: string }>("SELECT value FROM settings WHERE key = $1", [`tglink:${code}`])).rows[0] : undefined;
      if (code) await db.query("DELETE FROM settings WHERE key = $1", [`tglink:${code}`]);
      const v = row ? (JSON.parse(row.value) as { party: Party; party_id: string; exp: number }) : null;
      if (!v || v.exp < Date.now()) return code ? "That connect link has expired. In StockSure, open Messages and tap “Connect Telegram” again." : "Hi, this is StockSure. Sign in, open Messages and tap “Connect Telegram” to link this chat.";
      const exists = v.party === "driver" ? await personById(db, v.party_id) : await orgById(db, v.party_id);
      if (!exists) return "That account no longer exists.";
      await link(m.channel, m.address, v.party, v.party_id);
      return `Connected. You will get ${v.party === "buyer" ? "approval requests and order events" : v.party === "supplier" ? "new orders, quotes and receipts" : "your stops"} here.`;
    }
    if (/^\/?link\s+(buyer|supplier|driver):/i.test(text) && m.channel !== "simulator") return "For safety, chats are linked from the app: sign in to StockSure, open Messages and tap “Connect Telegram”.";
    const party = m.party ?? (m.channel === "simulator" && /^(buyer|supplier|driver):/.test(m.address) ? { party: m.address.split(":")[0], party_id: m.address.split(":").slice(1).join(":") } : null);
    if (!party) return "This chat is not linked yet. Sign in to StockSure, open Messages and tap “Connect Telegram”.";

    const cmd = (m.buttonId ?? text).match(/^(approve|decline):(\S+)$/i);
    if (cmd && party.party === "buyer") {
      const approve = cmd[1].toLowerCase() === "approve";
      const a = (await db.query<any>("SELECT * FROM approvals WHERE id = $1 AND owner_id = $2 AND status = 'pending'", [cmd[2], party.party_id])).rows[0];
      if (!a) return "That request is no longer pending.";
      if (approve && a.payload.cents > countersignThreshold()) return `${usd(a.payload.cents)} is above your countersign threshold (${usd(countersignThreshold())}). Approve it with your passkey in the guard console.`;
      const payload = await decideApproval(a.id, party.party_id, approve, "click");
      if (payload && approve) await enqueue(db, "release_approved", { approvalId: a.id }, new Date(), `release:${a.id}`);
      return approve ? `Approved ${usd(a.payload.cents)}. The ${a.action} is back in the queue.` : "Declined. Nothing moves.";
    }
    if (/^(pending|approvals|waiting)$/i.test(text) && party.party === "buyer") {
      const rows = (await db.query<any>("SELECT * FROM approvals WHERE owner_id = $1 AND status = 'pending' ORDER BY created_at", [party.party_id])).rows;
      if (!rows.length) return "Nothing waiting for you.";
      return rows.map((a: any) => `${a.action} ${usd(a.payload.cents)} (${a.payload.entity_id}): reply approve:${a.id} or decline:${a.id}`).join("\n");
    }
    if (/^(orders|status|open)$/i.test(text) && (party.party === "buyer" || party.party === "supplier")) {
      const col = party.party === "buyer" ? "buyer_id" : "supplier_id";
      const rows = (await db.query<any>(`SELECT number, status, deliver_by FROM purchase_orders WHERE ${col} = $1 AND status NOT IN ('closed','cancelled') ORDER BY deliver_by LIMIT 10`, [party.party_id])).rows;
      if (!rows.length) return "No open orders.";
      return rows.map((r: any) => `${r.number}: ${String(r.status).replace(/_/g, " ")}, deliver by ${new Date(r.deliver_by).toISOString().slice(0, 10)}`).join("\n");
    }
    if (/^(today|stops|deliveries)$/i.test(text) && party.party === "driver") {
      const p = await personById(db, party.party_id);
      if (!p) return "Driver not found.";
      const rows = (await db.query<any>("SELECT po.number, b.name AS buyer, po.deliver_by FROM purchase_orders po JOIN orgs b ON b.id = po.buyer_id WHERE po.supplier_id = $1 AND po.status IN ('dispatched','part_delivered') ORDER BY po.deliver_by LIMIT 10", [p.org_id])).rows;
      return rows.length ? rows.map((r: any) => `${r.number} → ${r.buyer} by ${new Date(r.deliver_by).toISOString().slice(11, 16)} UTC`).join("\n") : "No dispatched orders right now.";
    }
    return party.party === "buyer" ? "Reply 'pending' for what is waiting for you, or 'orders' for open orders." : party.party === "supplier" ? "Reply 'orders' for open orders." : "Reply 'today' for your stops.";
  });
}

export async function notifyApprovalRequest(buyerId: string, approvalId: string, action: string, cents: number, reason: string) {
  const big = cents > countersignThreshold();
  await notifyParty(
    "buyer",
    buyerId,
    `StockSure wants to ${action} ${usd(cents)}. ${reason}${big ? ` This is above ${usd(countersignThreshold())}, so it needs your passkey in the guard console.` : ""}`,
    big ? [{ id: `decline:${approvalId}`, label: "Decline" }] : [{ id: `approve:${approvalId}`, label: "Approve" }, { id: `decline:${approvalId}`, label: "Decline" }],
    "approval",
    approvalId,
  );
}

/** Pass the transaction's Queryable when calling from inside db.tx: PGlite has one connection and a stray getDb() query would deadlock. */
export async function notifyOrder(party: Party, partyId: string, body: string, poId: string, q?: Queryable) {
  await notifyParty(party, partyId, body, undefined, "po", poId, q);
}
