/**
 * Supplier side of PayPal depth (roadmap S7): disputes on captures with the evidence pack StockSure holds,
 * balances and the last 30 days of transactions, the negotiation floor, and the driver link.
 */
import { Router, type Request, type Response } from "express";
import { config } from "../config.js";
import { getDb } from "../db.js";
import { fmt } from "../core/money.js";
import { GtError, newSecret } from "../lib/util.js";
import { paypal } from "../paypal/index.js";
import { disputesForSupplier, evidencePack, provideEvidence, syncDisputes } from "../services/disputes.js";
import type { Person } from "../store.js";
import { me, whoOf } from "./auth.js";
import { back, flashOf, page } from "./common.js";
import { fmtDate, html, layout, pill, raw } from "./html.js";

async function needSupplier(req: Request, res: Response): Promise<Person | null> {
  const p = await me(req);
  if (!p) {
    res.redirect(`/login?next=${encodeURIComponent(req.originalUrl.slice(0, 200))}`);
    return null;
  }
  if (p.org_kind !== "supplier") throw new GtError("This page is the supplier's.", "forbidden", 403);
  return p;
}

export function disputesRouter() {
  const r = Router();

  r.get(
    "/disputes",
    page(async (req, res) => {
      const p = await needSupplier(req, res);
      if (!p) return;
      const db = await getDb();
      const rows = await disputesForSupplier(p.org_id);
      const packs = await Promise.all(rows.map((x) => evidencePack(x.po_id).catch(() => null)));
      let balances: any[] = [];
      let tx: any[] = [];
      if (config.paypal.clientId) {
        balances = await paypal().listBalances().catch(() => []);
        tx = await paypal().searchTransactions({ startDate: new Date(Date.now() - 30 * 864e5), endDate: new Date() }).catch(() => []);
      }
      const org = (await db.query<{ floor_pct: number }>("SELECT coalesce(floor_pct, 90) AS floor_pct FROM orgs WHERE id = $1", [p.org_id])).rows[0];
      const driver = (await db.query<{ driver_token: string | null }>("SELECT driver_token FROM people WHERE id = $1", [p.id])).rows[0];
      res.send(
        layout(
          { title: "Disputes and account", who: whoOf(p), flash: flashOf(req) },
          html`<h1>Disputes, account and agent settings</h1>
<p class="sub">When a buyer disputes a capture, StockSure answers with what both sides already agreed: the hashed quote agreement, the confirmed receipt, the approved resolution and the documents. Evidence can be sent while PayPal is waiting for the seller.</p>
<form method="post" action="/disputes/sync" class="row"><button class="btn small">Sync disputes from PayPal</button></form>
${rows.length
  ? html`<div class="table-wrap"><table><thead><tr><th>Dispute</th><th>Order</th><th>Buyer</th><th>Status</th><th>Stage</th><th>Amount</th><th>Due</th><th>Evidence</th></tr></thead><tbody>${raw(
      rows
        .map((x, i) => {
          const d = x.dispute;
          const pk = packs[i];
          const canSend = d?.status === "WAITING_FOR_SELLER_RESPONSE";
          return `<tr><td class="mono small">${d?.dispute_id ?? "?"}</td><td><a href="/po/${x.po_id}">${x.number}</a></td><td>${x.buyer_name}</td><td>${d ? pill(String(d.status).toLowerCase()).value : "unknown"}</td><td class="small">${d?.dispute_life_cycle_stage ?? ""}</td><td>${d?.dispute_amount ? `${d.dispute_amount.value} ${d.dispute_amount.currency_code}` : ""}</td><td class="small">${d?.seller_response_due_date ? fmtDate(d.seller_response_due_date) : ""}</td><td>${pk ? `<details><summary class="small">pack</summary><pre class="small">${String(pk.notes).replace(/</g, "&lt;")}</pre></details>` : ""}${canSend && d ? `<form method="post" action="/disputes/${encodeURIComponent(d.dispute_id)}/evidence" class="inline"><input type="hidden" name="po" value="${x.po_id}"><button class="btn small primary">Send evidence</button></form>` : ""}</td></tr>`;
        })
        .join(""),
    )}</tbody></table></div>`
  : html`<p class="muted">No disputes on your captures.${config.paypal.clientId ? "" : " (No PayPal credentials in this instance; the fake client has no disputes unless a test opens one.)"}</p>`}

<div class="grid g2">
<div class="card"><h2>Balances</h2>${balances.length ? html`<div class="table-wrap"><table class="small"><thead><tr><th>Currency</th><th>Total</th><th>Available</th><th>Withheld</th></tr></thead><tbody>${raw(balances.map((b: any) => `<tr><td>${b.currency}</td><td>${b.total_balance?.value ?? ""}</td><td>${b.available_balance?.value ?? ""}</td><td>${b.withheld_balance?.value ?? ""}</td></tr>`).join(""))}</tbody></table></div>` : html`<p class="muted small">Not available (needs PayPal credentials and the Reporting scope).</p>`}</div>
<div class="card"><h2>Transactions, last 30 days</h2>${tx.length ? html`<div class="table-wrap"><table class="small"><thead><tr><th>When</th><th>Id</th><th>Event</th><th>Status</th><th>Amount</th><th>Invoice</th></tr></thead><tbody>${raw(tx.slice(0, 40).map((t: any) => `<tr><td>${fmtDate(t.transaction_info?.transaction_initiation_date)}</td><td class="mono">${t.transaction_info?.transaction_id ?? ""}</td><td>${t.transaction_info?.transaction_event_code ?? ""}</td><td>${t.transaction_info?.transaction_status ?? ""}</td><td>${t.transaction_info?.transaction_amount ? `${t.transaction_info.transaction_amount.value} ${t.transaction_info.transaction_amount.currency_code}` : ""}</td><td class="mono small">${t.transaction_info?.invoice_id ?? ""}</td></tr>`).join(""))}</tbody></table></div>` : html`<p class="muted small">Not available (needs PayPal credentials; Transaction Search lags real activity by a few minutes in sandbox).</p>`}</div>
</div>

<div class="grid g2">
<div class="card"><h2>Negotiation floor</h2><p class="small muted">Your sales agent never quotes below this share of the catalog price, whatever a buyer's agent says.</p>
<form method="post" action="/disputes/floor" class="row"><label for="floor" class="small">Floor, % of catalog</label><input id="floor" type="number" name="floor_pct" min="50" max="100" value="${org?.floor_pct ?? 90}" style="width:6rem"><button class="btn small">Save</button></form></div>
<div class="card"><h2>Driver link</h2><p class="small muted">A phone page for your driver: today's dispatched orders, arrival notice, tracking number. No sign-in; the link is the key.</p>
${driver?.driver_token ? html`<p class="mono small">${config.appUrl}/driver/${driver.driver_token}</p>` : ""}<form method="post" action="/disputes/driver-link" class="row"><button class="btn small">${driver?.driver_token ? "Rotate link" : "Create link"}</button></form></div>
</div>
<p class="small muted">Amounts above are PayPal's. ${fmt(0)} shown anywhere else on this page is a placeholder, never a balance.</p>`,
        ),
      );
    }, () => "/home"),
  );

  r.post(
    "/disputes/sync",
    page(async (req, res) => {
      const p = await needSupplier(req, res);
      if (!p) return;
      const n = await syncDisputes();
      back(res, "/disputes", `Synced: ${n} new dispute(s) linked`);
    }, () => "/disputes"),
  );

  r.post(
    "/disputes/:id/evidence",
    page(async (req, res) => {
      const p = await needSupplier(req, res);
      if (!p) return;
      const db = await getDb();
      const po = (await db.query<{ id: string }>("SELECT id FROM purchase_orders WHERE id = $1 AND supplier_id = $2 AND dispute_id = $3", [String(req.body.po), p.org_id, req.params.id])).rows[0];
      if (!po) throw new GtError("Dispute not found on your orders", "not_found", 404);
      const out = await provideEvidence(po.id, req.params.id);
      back(res, "/disputes", out === "sent" ? "Evidence sent to PayPal" : out === "already_sent" ? "Evidence for this dispute was already sent (see the order history)" : "Nothing to build evidence from yet", out === "no_evidence");
    }, () => "/disputes"),
  );

  r.post(
    "/disputes/floor",
    page(async (req, res) => {
      const p = await needSupplier(req, res);
      if (!p) return;
      const v = Number(req.body.floor_pct);
      if (!Number.isInteger(v) || v < 50 || v > 100) throw new GtError("Floor must be a whole number between 50 and 100", "validation", 422);
      await (await getDb()).query("UPDATE orgs SET floor_pct = $2 WHERE id = $1", [p.org_id, v]);
      back(res, "/disputes", `Floor set to ${v}% of catalog`);
    }, () => "/disputes"),
  );

  r.post(
    "/disputes/driver-link",
    page(async (req, res) => {
      const p = await needSupplier(req, res);
      if (!p) return;
      const token = newSecret("drv").replace(/[^A-Za-z0-9_-]/g, "");
      await (await getDb()).query("UPDATE people SET driver_token = $2 WHERE id = $1", [p.id, token]);
      back(res, "/disputes", "Driver link ready");
    }, () => "/disputes"),
  );

  return r;
}
