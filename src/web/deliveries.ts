/**
 * Deliveries over time (roadmap S9): Bryntum Scheduler trial build showing every open order from acceptance to its
 * deadline, with the latest ETA. A supplier dragging an order to a later day asks the server whether that ETA can be
 * recorded; nothing is written until they confirm on the verdict banner. Buyers see the same board read-only.
 */
import { Router, type Request, type Response } from "express";
import { getDb } from "../db.js";
import { GtError } from "../lib/util.js";
import { currentEta, recordEta } from "../services/supply-watch.js";
import type { Person } from "../store.js";
import { me, whoOf } from "./auth.js";
import { back, flashOf, json, page } from "./common.js";
import { html, layout, raw } from "./html.js";

const BRYNTUM = "https://cdn.jsdelivr.net/npm/@bryntum/scheduler-trial@7.3.8";
const OPEN = ["submitted", "quoted", "funding", "funded", "dispatched", "in_review", "resolving", "part_delivered", "awaiting_replacement", "settling", "part_settling"];

async function needPerson(req: Request, res: Response): Promise<Person | null> {
  const p = await me(req);
  if (!p) {
    res.redirect(`/login?next=${encodeURIComponent(req.originalUrl.slice(0, 200))}`);
    return null;
  }
  return p;
}

const COLOR: Record<string, string> = { submitted: "gray", quoted: "cyan", funding: "yellow", funded: "blue", dispatched: "indigo", in_review: "orange", resolving: "orange", part_delivered: "violet", awaiting_replacement: "violet", settling: "lime", part_settling: "lime", closed: "green", exception: "red", cancelled: "gray" };

export async function deliveriesData(p: Person) {
  const db = await getDb();
  const col = p.org_kind === "buyer" ? "buyer_id" : "supplier_id";
  const pos = (await db.query<any>(`SELECT po.*, b.name AS buyer_name, s.name AS supplier_name FROM purchase_orders po JOIN orgs b ON b.id = po.buyer_id JOIN orgs s ON s.id = po.supplier_id WHERE po.${col} = $1 AND (po.status = ANY($2) OR po.created_at > now() - interval '14 days') ORDER BY po.deliver_by`, [p.org_id, OPEN])).rows;
  const resources = new Map<string, { id: string; name: string }>();
  const events = [];
  for (const po of pos) {
    const rid = p.org_kind === "buyer" ? po.supplier_id : po.buyer_id;
    resources.set(rid, { id: rid, name: p.org_kind === "buyer" ? po.supplier_name : po.buyer_name });
    const eta = await currentEta(db, po.id);
    const start = new Date(po.agreed_at ?? po.dispatched_at ?? po.created_at);
    const end = new Date(eta?.eta ?? po.deliver_by);
    events.push({ id: po.id, resourceId: rid, name: `${po.number} · ${String(po.status).replace(/_/g, " ")}`, startDate: start.toISOString(), endDate: (end > start ? end : new Date(start.getTime() + 36e5)).toISOString(), eventColor: COLOR[po.status] ?? "gray", poId: po.id, status: po.status, deliverBy: po.deliver_by, eta: eta?.eta ?? null, draggable: p.org_kind === "supplier" && ["funded", "dispatched", "part_delivered", "awaiting_replacement"].includes(po.status) });
  }
  const now = Date.now();
  return { start: new Date(now - 3 * 864e5).toISOString(), end: new Date(now + 11 * 864e5).toISOString(), resources: [...resources.values()], events };
}

export function deliveriesRouter() {
  const r = Router();

  r.get(
    "/deliveries",
    page(async (req, res) => {
      const p = await needPerson(req, res);
      if (!p) return;
      res.send(
        layout(
          { title: "Deliveries", who: whoOf(p), flash: flashOf(req), head: raw(`<link id="bryntum-theme" rel="stylesheet" href="${BRYNTUM}/svalbard-light.css">`), scripts: raw(`<script type="module" src="/static/deliveries.js"></script>`) },
          html`<h1>Deliveries over time</h1>
<p class="sub">Every open order from acceptance to its deadline, by ${p.org_kind === "buyer" ? "supplier" : "buyer"}, coloured by state, with the latest ETA as the bar's end. ${p.org_kind === "supplier" ? "Drag an order to a later day to record a new ETA: the server checks it first and the buyer sees a late warning if it passes the deadline." : "Suppliers record ETAs by dragging; you see the result and any late warning on the order."}</p>
<div id="bryntum-verdict" class="small" role="status"></div>
<div id="bryntum-deliveries" data-src="/deliveries/data.json" data-check="/deliveries/check" data-move="/deliveries/move" data-draggable="${p.org_kind === "supplier" ? "1" : "0"}"></div>
<p class="small muted">Bryntum Scheduler trial build from jsDelivr; a licence key swaps in the full build with no code change. If it fails to load, the <a href="/ledger">ledger</a> lists the same orders.</p>`,
        ),
      );
    }, () => "/home"),
  );

  r.get(
    "/deliveries/data.json",
    json(async (req) => {
      const p = await me(req);
      if (!p) throw new GtError("Sign in", "unauthorized", 401);
      return deliveriesData(p);
    }),
  );

  r.get(
    "/deliveries/check",
    json(async (req) => {
      const p = await me(req);
      if (!p) throw new GtError("Sign in", "unauthorized", 401);
      if (p.org_kind !== "supplier") return { ok: false, message: "Only the supplier records delivery estimates." };
      const poId = String(req.query.po ?? "");
      const when = new Date(String(req.query.when ?? ""));
      if (Number.isNaN(when.getTime())) return { ok: false, message: "That is not a valid time." };
      const db = await getDb();
      const po = (await db.query<any>("SELECT * FROM purchase_orders WHERE id = $1 AND supplier_id = $2", [poId, p.org_id])).rows[0];
      if (!po) return { ok: false, message: "Order not found." };
      if (!["funded", "dispatched", "part_delivered", "awaiting_replacement"].includes(po.status)) return { ok: false, message: `${po.number} is ${String(po.status).replace(/_/g, " ")}; estimates apply only between funding and delivery.` };
      if (when.getTime() < Date.now() - 36e5) return { ok: false, message: "An ETA in the past cannot be recorded." };
      const late = when.getTime() > new Date(po.deliver_by).getTime();
      return { ok: true, po: po.id, number: po.number, when: when.toISOString(), late, message: late ? `${po.number} would arrive ${Math.round((when.getTime() - new Date(po.deliver_by).getTime()) / 36e5)} h after its deadline; the buyer will be warned and can choose to wait or expedite.` : `${po.number} would still arrive before its deadline.` };
    }),
  );

  r.post(
    "/deliveries/move",
    page(async (req, res) => {
      const p = await needPerson(req, res);
      if (!p) return;
      const when = new Date(String(req.body.when ?? ""));
      const out = await recordEta(p, String(req.body.po ?? ""), { eta: when, observedAt: new Date(), source: "supplier", ref: `deliveries:${Date.now()}`, note: "Moved on the deliveries board" });
      back(res, "/deliveries", out.duplicate ? "That estimate was already recorded." : out.risk ? `ETA recorded; ${out.risk.status === "open" ? "the buyer has a late warning" : `late warning ${String(out.risk.status).replace(/_/g, " ")}`}.` : "ETA recorded.");
    }, () => "/deliveries"),
  );

  return r;
}
