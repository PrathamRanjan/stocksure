/**
 * Receiving dock PWA (roadmap S6, B.10) and the driver page (S9). The dock is the receiver's phone screen: today's
 * expected deliveries as big cards, the camera for the delivery note, and one tap to the receive page. The driver
 * page needs no sign-in: the link is the key; the driver marks arrival and adds a carrier tracking number, which
 * goes to PayPal's order tracking once a capture exists.
 */
import { Router, type Request, type Response } from "express";
import { getDb } from "../db.js";
import { newId } from "../lib/ids.js";
import { GtError } from "../lib/util.js";
import { paypal } from "../paypal/index.js";
import { notifyOrder } from "../channels/handlers.js";
import { logEvent, postMessage, type Person } from "../store.js";
import { me, whoOf } from "./auth.js";
import { back, flashOf, page } from "./common.js";
import { fmtDate, html, layout, pill, raw } from "./html.js";

const PWA_HEAD = raw(`<link rel="manifest" href="/manifest.webmanifest"><meta name="theme-color" content="#234e8a"><link rel="apple-touch-icon" href="/static/icon.svg">`);

async function needBuyer(req: Request, res: Response): Promise<Person | null> {
  const p = await me(req);
  if (!p) {
    res.redirect(`/login?next=${encodeURIComponent(req.originalUrl.slice(0, 200))}`);
    return null;
  }
  if (p.org_kind !== "buyer") throw new GtError("The dock is the buyer's receiving screen.", "forbidden", 403);
  return p;
}

async function driverFromToken(token: string) {
  const db = await getDb();
  const d = (await db.query<any>("SELECT p.id, p.name, p.org_id, o.name AS org_name FROM people p JOIN orgs o ON o.id = p.org_id WHERE p.driver_token = $1 AND o.kind = 'supplier'", [token])).rows[0];
  if (!d) throw new GtError("This driver link is not valid.", "not_found", 404);
  return d as { id: string; name: string; org_id: string; org_name: string };
}

export function dockRouter() {
  const r = Router();

  r.get(
    "/dock",
    page(async (req, res) => {
      const p = await needBuyer(req, res);
      if (!p) return;
      const db = await getDb();
      const expected = (await db.query<any>("SELECT po.*, s.name AS supplier_name, (SELECT eta FROM eta_updates e WHERE e.po_id = po.id AND e.applied ORDER BY observed_at DESC LIMIT 1) AS eta, (SELECT count(*) FROM documents d WHERE d.po_id = po.id AND d.kind = 'delivery_note') AS notes FROM purchase_orders po JOIN orgs s ON s.id = po.supplier_id WHERE po.buyer_id = $1 AND po.status IN ('dispatched','part_delivered','funded','in_review') ORDER BY po.deliver_by LIMIT 30", [p.org_id])).rows;
      res.send(
        layout(
          { title: "Dock", who: whoOf(p), flash: flashOf(req), head: PWA_HEAD, scripts: raw(`<script src="/static/pwa.js" defer></script>`) },
          html`<h1>Receiving dock</h1>
<p class="sub">What is on its way. Tap an order when the truck is here: photograph the note, check the proposal, confirm the counts. Add this page to your home screen; it works as an app. <button class="btn small" id="push-sub" type="button">Enable notifications</button></p>
${expected.length
  ? raw(expected.map((po: any) => `<a class="dock-card" href="/po/${po.id}/receive"><div class="spread"><b>${po.number}</b> ${pill(po.status).value}</div><div>${String(po.supplier_name).replace(/</g, "&lt;")} · deliver by ${fmtDate(po.deliver_by)}${po.eta ? ` · ETA ${fmtDate(po.eta)}` : ""}</div><div class="small muted">${po.notes > 0 ? `${po.notes} delivery note(s) stored` : po.status === "dispatched" ? "Dispatched; no note yet" : po.status === "funded" ? "Not dispatched yet" : String(po.status).replace(/_/g, " ")}</div>${["dispatched", "part_delivered"].includes(po.status) ? `<form method="post" action="/po/${po.id}/receive/upload" enctype="multipart/form-data" class="row" onclick="event.stopPropagation()"><label class="btn primary small">Photograph the note <input type="file" name="delivery_note" accept="image/*" capture="environment" hidden onchange="this.form.submit()"></label></form>` : ""}</a>`).join(""))
  : html`<p class="muted">Nothing expected right now.</p>`}
<p class="small"><a href="/stock">Stock</a> · <a href="/home">All orders</a></p>`,
        ),
      );
    }, () => "/home"),
  );

  r.get(
    "/driver/:token",
    page(async (req, res) => {
      const d = await driverFromToken(req.params.token);
      const db = await getDb();
      const stops = (await db.query<any>("SELECT po.id, po.number, po.status, po.deliver_by, b.name AS buyer, (SELECT tracking_number FROM shipments s WHERE s.po_id = po.id AND s.tracking_number IS NOT NULL ORDER BY seq DESC LIMIT 1) AS tracking, (SELECT carrier FROM shipments s WHERE s.po_id = po.id AND s.carrier IS NOT NULL ORDER BY seq DESC LIMIT 1) AS carrier FROM purchase_orders po JOIN orgs b ON b.id = po.buyer_id WHERE po.supplier_id = $1 AND po.status IN ('dispatched','part_delivered') ORDER BY po.deliver_by", [d.org_id])).rows;
      res.send(
        layout(
          { title: "Driver", who: null, flash: flashOf(req), head: PWA_HEAD },
          html`<h1>${d.org_name}: today's stops</h1><p class="sub">Hello ${d.name}. Tap "Arrived" when you reach the dock so the receiver is told; add the carrier tracking number if the parcel went by courier.</p>
${stops.length
  ? raw(stops.map((s: any) => `<div class="dock-card"><div class="spread"><b>${s.number}</b> ${pill(s.status).value}</div><div>${String(s.buyer).replace(/</g, "&lt;")} · by ${fmtDate(s.deliver_by)}</div>
<form method="post" action="/driver/${encodeURIComponent(req.params.token)}/arrive" class="row"><input type="hidden" name="po" value="${s.id}"><button class="btn primary small">Arrived</button></form>
<form method="post" action="/driver/${encodeURIComponent(req.params.token)}/tracking" class="row"><input type="hidden" name="po" value="${s.id}"><input type="text" name="carrier" placeholder="Carrier" value="${String(s.carrier ?? "").replace(/"/g, "&quot;")}" maxlength="40" required><input type="text" name="tracking_number" placeholder="Tracking number" value="${String(s.tracking ?? "").replace(/"/g, "&quot;")}" maxlength="60" required><button class="btn small">Save tracking</button></form></div>`).join(""))
  : html`<p class="muted">No dispatched orders right now.</p>`}`,
        ),
      );
    }, () => "/"),
  );

  r.post(
    "/driver/:token/arrive",
    page(async (req, res) => {
      const d = await driverFromToken(req.params.token);
      const db = await getDb();
      const po = (await db.query<any>("SELECT * FROM purchase_orders WHERE id = $1 AND supplier_id = $2", [String(req.body.po), d.org_id])).rows[0];
      if (!po) throw new GtError("Order not found", "not_found", 404);
      await postMessage(db, po.id, null, d.name, "supplier", `Driver ${d.name} has arrived with ${po.number}.`, "system");
      await logEvent(db, po, "delivery.arrived", `Driver ${d.name} arrived with ${po.number}`, null, `driver:${d.id}`);
      await notifyOrder("buyer", po.buyer_id, `${po.number} is at your dock: ${d.name} from ${d.org_name} has arrived. Open the dock to receive it.`, po.id);
      back(res, `/driver/${encodeURIComponent(req.params.token)}`, `Told ${po.number}'s receiver you are here`);
    }, (req) => `/driver/${encodeURIComponent(String(req.params.token))}`),
  );

  r.post(
    "/driver/:token/tracking",
    page(async (req, res) => {
      const d = await driverFromToken(req.params.token);
      const db = await getDb();
      const po = (await db.query<any>("SELECT * FROM purchase_orders WHERE id = $1 AND supplier_id = $2", [String(req.body.po), d.org_id])).rows[0];
      if (!po) throw new GtError("Order not found", "not_found", 404);
      const carrier = String(req.body.carrier ?? "").trim().slice(0, 40);
      const tracking = String(req.body.tracking_number ?? "").trim().slice(0, 60);
      if (!carrier || !tracking) throw new GtError("Carrier and tracking number are needed", "validation", 422);
      const ship = (await db.query<any>("SELECT * FROM shipments WHERE po_id = $1 ORDER BY seq DESC LIMIT 1", [po.id])).rows[0];
      if (ship) await db.query("UPDATE shipments SET tracking_number = $2, carrier = $3 WHERE id = $1", [ship.id, tracking, carrier]);
      else await db.query("INSERT INTO shipments (id, po_id, seq, kind, packs, status, dispatched_by, tracking_number, carrier) VALUES ($1,$2,1,'rest','{}','dispatched',$3,$4,$5) ON CONFLICT (po_id, seq) DO UPDATE SET tracking_number = EXCLUDED.tracking_number, carrier = EXCLUDED.carrier", [newId("shp"), po.id, `driver:${d.id}`, tracking, carrier]);
      // PayPal order tracking needs a capture; before that the number is kept and sent at settlement.
      const cap = (await db.query<any>("SELECT paypal_id, paypal_order_id FROM payment_ops WHERE po_id = $1 AND kind = 'capture' AND status = 'succeeded' ORDER BY created_at DESC LIMIT 1", [po.id])).rows[0];
      let sent = false;
      if (cap?.paypal_id && cap?.paypal_order_id) {
        try {
          await paypal().addTracking({ orderId: cap.paypal_order_id, captureId: cap.paypal_id, carrier, trackingNumber: tracking }, `track-${po.id}-${tracking}`.slice(0, 100));
          await db.query("UPDATE shipments SET tracked_at = now() WHERE po_id = $1 AND tracking_number = $2", [po.id, tracking]);
          sent = true;
        } catch (e) {
          await logEvent(db, po, "tracking.failed", `PayPal tracking not added: ${(e as Error).message.slice(0, 120)}`, null, `driver:${d.id}`);
        }
      }
      await logEvent(db, po, "tracking.recorded", `${carrier} ${tracking} recorded by driver ${d.name}${sent ? " and sent to PayPal" : ""}`, { carrier, tracking }, `driver:${d.id}`);
      back(res, `/driver/${encodeURIComponent(req.params.token)}`, sent ? "Tracking saved and sent to PayPal" : "Tracking saved; it goes to PayPal when the order is captured");
    }, (req) => `/driver/${encodeURIComponent(String(req.params.token))}`),
  );

  return r;
}
