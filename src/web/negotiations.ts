/** Negotiation pages (roadmap S4): list for the organisation, detail with every round and guard verdict, start from an order. */
import { Router, type Request, type Response } from "express";
import { getDb } from "../db.js";
import { fmt } from "../core/money.js";
import { GtError } from "../lib/util.js";
import { loadNegotiation, startNegotiation } from "../agents/runtime.js";
import { getPo, linesOf, type Person } from "../store.js";
import { me, whoOf } from "./auth.js";
import { back, flashOf, page } from "./common.js";
import { fmtDate, html, layout, pill, raw } from "./html.js";

async function needPerson(req: Request, res: Response): Promise<Person | null> {
  const p = await me(req);
  if (!p) {
    res.redirect(`/login?next=${encodeURIComponent(req.originalUrl.slice(0, 200))}`);
    return null;
  }
  return p;
}

export function negotiationsRouter() {
  const r = Router();

  r.get(
    "/negotiations",
    page(async (req, res) => {
      const p = await needPerson(req, res);
      if (!p) return;
      const db = await getDb();
      const col = p.org_kind === "buyer" ? "buyer_id" : "supplier_id";
      const rows = (await db.query<any>(`SELECT n.*, po.number, b.name AS buyer, s.name AS supplier FROM negotiations n JOIN purchase_orders po ON po.id = n.po_id JOIN orgs b ON b.id = po.buyer_id JOIN orgs s ON s.id = po.supplier_id WHERE po.${col} = $1 ORDER BY n.created_at DESC LIMIT 100`, [p.org_id])).rows;
      const open = (await db.query<any>("SELECT id, number FROM purchase_orders WHERE buyer_id = $1 AND status IN ('submitted','quoted') AND negotiation_id IS NULL ORDER BY created_at DESC LIMIT 20", [p.org_id])).rows;
      res.send(
        layout(
          { title: "Negotiations", who: whoOf(p), flash: flashOf(req), scripts: rows.some((x: any) => x.status === "open") ? raw(`<script>setTimeout(()=>location.reload(), 4000)</script>`) : undefined },
          html`<h1>Negotiations</h1>
<p class="sub">Your agent and the supplier's agent trade offers inside the owner's mandate and the supplier's floor. Code guards every offer; the model only writes the words. On agreement the quote is recorded and the two-party agreement is hashed.</p>
${p.org_kind === "buyer" && p.role === "owner" && open.length ? html`<div class="card"><h2>Start one</h2><form method="post" action="/negotiations/start" class="row"><select name="po">${open.map((o: any) => html`<option value="${o.id}">${o.number}</option>`)}</select><button class="btn primary small">Let the agents negotiate</button></form></div>` : ""}
<div class="table-wrap"><table><thead><tr><th>Order</th><th>${p.org_kind === "buyer" ? "Supplier" : "Buyer"}</th><th>Status</th><th>Round</th><th>Agents</th><th>Started</th></tr></thead><tbody>${rows.length ? raw(rows.map((x: any) => `<tr><td><a href="/negotiations/${x.id}">${x.number}</a></td><td>${String(p.org_kind === "buyer" ? x.supplier : x.buyer).replace(/</g, "&lt;")}</td><td>${pill(x.status).value}</td><td>${x.round}/${x.max_rounds}</td><td class="small mono">${String(x.buyer_agent).replace(/</g, "&lt;")} vs ${String(x.supplier_agent).replace(/</g, "&lt;")}</td><td>${fmtDate(x.created_at)}</td></tr>`).join("")) : html`<tr><td colspan="6" class="muted">No negotiations yet.</td></tr>`}</tbody></table></div>`,
        ),
      );
    }, () => "/home"),
  );

  r.post(
    "/negotiations/start",
    page(async (req, res) => {
      const p = await needPerson(req, res);
      if (!p) return;
      if (p.org_kind !== "buyer" || p.role !== "owner") throw new GtError("Only the buyer's owner starts a negotiation", "forbidden", 403);
      const db = await getDb();
      const po = await getPo(db, String(req.body.po));
      if (po.buyer_id !== p.org_id) throw new GtError("Order not found", "not_found", 404);
      const id = await startNegotiation(po.id, { buyerAgent: `owner-ui:${p.id}` });
      back(res, `/negotiations/${id}`, "Negotiation started; rounds run in the background");
    }, () => "/negotiations"),
  );

  r.get(
    "/negotiations/:id",
    page(async (req, res) => {
      const p = await needPerson(req, res);
      if (!p) return;
      const n = await loadNegotiation(req.params.id);
      if (!n) throw new GtError("Negotiation not found", "not_found", 404);
      const db = await getDb();
      const po = await getPo(db, n.po_id);
      if (po.buyer_id !== p.org_id && po.supplier_id !== p.org_id) throw new GtError("Negotiation not found", "not_found", 404);
      const lines = await linesOf(db, po.id);
      const total = (offer: Record<string, number>) => lines.reduce((a, l) => a + l.qty_packs * (offer[l.id] ?? l.product.price_cents), 0);
      const catalog = total({});
      res.send(
        layout(
          { title: `Negotiation ${po.number}`, who: whoOf(p), flash: flashOf(req), scripts: n.status === "open" ? raw(`<script>setTimeout(()=>location.reload(), 3000)</script>`) : undefined },
          html`<h1>${po.number}: ${pill(n.status)}</h1>
<p class="sub">${n.buyer_agent} (buyer) vs ${n.supplier_agent} (supplier) · round ${n.round} of ${n.max_rounds} · catalog total ${fmt(catalog)} · spending limit ${fmt(po.spend_limit_cents)}${n.run_id ? html` · <a href="/trace/${n.run_id}">trace</a>` : ""} · <a href="/po/${po.id}">order</a></p>
${n.outcome ? html`<div class="banner ${n.status === "agreed" ? "good" : n.status === "walked_away" ? "warn" : "bad"}">${JSON.stringify(n.outcome).replace(/[{}"]/g, "").replace(/,/g, ", ")}</div>` : ""}
<ol class="rounds">${raw(n.rounds.map((x: any) => `<li class="${x.side}"><div class="spread"><b>Round ${x.round} · ${x.side}</b><span>${fmt(total(x.proposal))} <span class="small muted">(${(((total(x.proposal) - catalog) / Math.max(1, catalog)) * 100).toFixed(1)}% vs catalog)</span></span></div><div>${String(x.wording).replace(/</g, "&lt;")}</div><div class="small muted">Guard: ${x.guard?.ok ? "within rules" : `adjusted: ${(x.guard?.reasons ?? []).map((s: string) => String(s).replace(/</g, "&lt;")).join("; ")}`}${x.accepted ? " · accepted" : ""}</div></li>`).join(""))}</ol>
${!n.rounds.length ? html`<p class="muted">Waiting for the first round (the worker runs every ${Math.round(2)} s).</p>` : ""}
<table class="small"><thead><tr><th>Line</th><th>Qty</th><th>Catalog</th><th>Last buyer offer</th><th>Last supplier ask</th></tr></thead><tbody>${raw(lines.map((l) => {
  const lb = [...n.rounds].reverse().find((x: any) => x.side === "buyer")?.proposal?.[l.id];
  const ls = [...n.rounds].reverse().find((x: any) => x.side === "supplier")?.proposal?.[l.id];
  return `<tr><td>${l.product.sku} ${String(l.product.name).replace(/</g, "&lt;")}</td><td>${l.qty_packs}</td><td>${fmt(l.product.price_cents)}</td><td>${lb === undefined ? "—" : fmt(lb)}</td><td>${ls === undefined ? "—" : fmt(ls)}</td></tr>`;
}).join(""))}</tbody></table>`,
        ),
      );
    }, () => "/negotiations"),
  );

  return r;
}
