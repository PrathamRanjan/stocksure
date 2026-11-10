import { countersignThreshold } from "../guard/dryrun.js";
import { guardCard } from "./safetyui.js";
import { icon } from "./icons.js";
import { Router, type Request, type Response } from "express";
import { config } from "../config.js";
import { currentWs, getDb, withWorkspace } from "../db.js";
import { liveWorkspace } from "../demo/workspaces.js";
import { WS_COOKIE } from "../demo/routes.js";
import { sign } from "../lib/crypto.js";
import { decideDefect, reportDefect } from "../services/aftercare.js";
import { decideRisk, recordEta, riskyPos } from "../services/supply-watch.js";
import { dispatchPart } from "../services/parts.js";
import { fmt, parseCents } from "../core/money.js";
import { formatUnits } from "../core/units.js";
import { GtError } from "../lib/util.js";
import { armFault, FAULTABLE, type FaultKind } from "../paypal/index.js";
import { recordCsv, recordJson, supplierPerformance } from "../services/records.js";
import { acceptQuote, completeConnect, createPo, dispatchPo, quotePo, quoteTotal, retryHold, startConnect, submitPo, type UploadFile } from "../services/orders.js";
import { confirmReceipt, postLineMessage, supplierReview, uploadReceivingDoc, type CountInput } from "../services/receiving.js";
import { approveResolution, reviseResolution } from "../services/resolution.js";
import { demoIds, keyWorkspace, sampleDeliveryNote, sampleInvoice } from "../services/seed.js";
import { retrySettle } from "../services/settle.js";
import { catalog, fundingOf, getPo, linesOf, orgById, personById, poFor, setting, type Person, type PO } from "../store.js";
import { authed, me, personByKey, signIn, signOut, whoOf } from "./auth.js";
import { back, flashOf } from "./common.js";
import { fmtDate, html, layout, pill, raw, type Raw } from "./html.js";
import { agentCard, actionsCard, defectsCard, supplyCard, docsCard, fundingPanel, linesTable, messagesFor, paymentsCard, receiveView, resolutionCard, thread, timeline, treeNav } from "./po-view.js";
import { readForm } from "./upload.js";

const page = (req: Request, p: Person | null, title: string, body: Raw, extra: { refresh?: number } = {}) =>
  layout({ title, who: whoOf(p), flash: flashOf(req), head: extra.refresh ? raw(`<meta http-equiv="refresh" content="${extra.refresh}">`) : undefined }, body);

/** POST handler: errors redirect back with the message. */
function act(fn: (req: Request, res: Response, p: Person) => Promise<unknown>) {
  return authed(async (req, res, p) => {
    try {
      await fn(req, res, p);
    } catch (e) {
      if (e instanceof GtError) {
        if (e.status === 404) return res.status(404).send("Not found");
        const to = (req.get("referer") ?? "/home").replace(/[?&](ok|err)=[^&#]*/g, "");
        return back(res, to.split("#")[0], e.message, true);
      }
      throw e;
    }
  });
}

async function samplesFor(po: PO) {
  const db = await getDb();
  const lines = await linesOf(db, po.id);
  return lines.map((l) => ({ sku: l.product.sku, name: l.product.name, qty_packs: l.qty_packs, pack_label: l.product.pack_label, unit_price_cents: l.unit_price_cents ?? l.product.price_cents }));
}

const textFile = (name: string, text: string): UploadFile => ({ filename: name, mime: "text/plain", body: Buffer.from(text, "utf8") });

export function routes() {
  const r = Router();

  r.post("/login", async (req, res) => {
    const db = await getDb();
    let p: Person | null = null;
    if (req.body.person_id && config.demoMode) {
      // Demo sign-in picks a person in the visitor's own workspace; there is no shared demo to sign in to.
      if (!currentWs() && !config.demo.baseSignIn) return back(res, "/login", "Start your own demo first: it takes a few seconds and nobody else can see it.", true);
      p = await personById(db, String(req.body.person_id));
      if (!p) return back(res, "/login", "That person isn't in your demo any more (it was reset). Pick again from the list.", true);
    } else if (req.body.key) {
      const key = String(req.body.key);
      const ws = keyWorkspace(key);
      if (ws && config.demoMode) {
        const w = await liveWorkspace(ws);
        if (!w || w.kind !== "visitor") return back(res, "/login", "That key belongs to a demo that has closed.", true);
        p = await withWorkspace(ws, () => personByKey(key));
        if (p) res.cookie(WS_COOKIE, sign(ws), { httpOnly: true, sameSite: "lax", secure: config.appUrl.startsWith("https://"), maxAge: 7 * 864e5, path: "/" });
      } else p = await personByKey(key);
    }
    if (!p) return back(res, "/login", "That key is not valid.", true);
    signIn(res, p, config.appUrl.startsWith("https://"));
    const next = String(req.body.next ?? "/home");
    res.redirect(next.startsWith("/") && !next.startsWith("//") ? next : "/home");
  });

  r.post("/logout", (_req, res) => {
    signOut(res);
    res.redirect("/");
  });

  r.post(
    "/po/new",
    act(async (req, res, p) => {
      const b = req.body;
      const lines = [0, 1, 2]
        .filter((i) => b[`product_${i}`])
        .map((i) => ({ product_id: String(b[`product_${i}`]), qty_packs: Number(b[`qty_${i}`]), substitutes: ([] as string[]).concat(b[`subs_${i}`] ?? []).map(String), replace_shortfall: b[`replace_${i}`] === "1" }));
      const limit = parseCents(String(b.limit ?? ""));
      if (limit === null) throw new GtError("Spending limit is not a valid amount.", "invalid");
      const id = await createPo(p, { supplier_id: String(b.supplier_id), lines, deliver_by: new Date(String(b.deliver_by) + "Z"), spend_limit_cents: limit, note: String(b.note ?? "") });
      back(res, `/po/${id}`, "Draft saved. Send it for a quote when ready.");
    }),
  );

  r.post("/po/:id/submit", act(async (req, res, p) => {
    await submitPo(p, req.params.id);
    back(res, `/po/${req.params.id}`, "Sent to the supplier for a quote.");
  }));

  r.post("/po/:id/quote", act(async (req, res, p) => {
    const db = await getDb();
    await poFor(db, p, req.params.id);
    if (p.role !== "supplier") throw new GtError("Only supplier can quote.", "forbidden", 403);
    const prices: Record<string, number> = {};
    for (const l of await linesOf(db, req.params.id)) {
      const c = parseCents(String(req.body[`price_${l.id}`] ?? ""));
      if (c === null) throw new GtError(`Price for line ${l.line_no} is not a valid amount.`, "invalid");
      prices[l.id] = c;
    }
    await quotePo(p, req.params.id, prices);
    back(res, `/po/${req.params.id}`, "Quote sent.");
  }));

  r.post("/po/:id/accept", act(async (req, res, p) => {
    await acceptQuote(p, req.params.id, Number(req.body.version));
    const after = await getPo(await getDb(), req.params.id);
    back(res, `/po/${req.params.id}`, after.status === "funded" ? "Quote accepted and PayPal hold placed." : "Quote accepted. PayPal shows the hold as pending: it isn't funded until PayPal confirms it.");
  }));

  r.post("/po/:id/retry-hold", act(async (req, res, p) => {
    await retryHold(p, req.params.id);
    back(res, `/po/${req.params.id}`, "Hold placed.");
  }));

  r.post("/po/:id/dispatch", act(async (req, res, p) => {
    const { fields, files } = await readForm(req);
    const db = await getDb();
    const po = await poFor(db, p, req.params.id);
    let invoice: UploadFile | null = files.invoice?.[0] ?? null;
    if (!invoice && fields.sample && config.demoMode) {
      const sl = await samplesFor(po);
      const opts = fields.sample === "inject" ? { inject: true } : fields.sample === "overbill" ? { overbill: { [sl[0].sku]: 1 } } : {};
      invoice = textFile(`invoice-${po.number}.txt`, sampleInvoice(po.number, po.buyer_name ?? "", sl, opts));
    }
    await dispatchPo(p, req.params.id, invoice);
    back(res, `/po/${req.params.id}`, "Marked dispatched.");
  }));

  r.post("/po/:id/reorder", act(async (req, res, p) => {
    const db = await getDb();
    const po = await poFor(db, p, req.params.id);
    const lines = await linesOf(db, po.id);
    const id = await createPo(p, { supplier_id: po.supplier_id, lines: lines.map((l) => ({ product_id: l.product_id, qty_packs: l.qty_packs, substitutes: l.substitutes, replace_shortfall: l.replace_shortfall })), deliver_by: new Date(Date.now() + 2 * 864e5), spend_limit_cents: po.spend_limit_cents, note: `Repeat of ${po.number}` });
    back(res, `/po/${id}`, `Draft created from ${po.number}. Prices are refreshed when the supplier quotes.`);
  }));

  r.post("/po/:id/receive/upload", act(async (req, res, p) => {
    const { fields, files } = await readForm(req);
    const db = await getDb();
    const po = await poFor(db, p, req.params.id);
    let n = 0;
    if (fields.sample && config.demoMode) {
      const sl = await samplesFor(po);
      await uploadReceivingDoc(p, po.id, "delivery_note", textFile(`delivery-note-${po.number}.txt`, sampleDeliveryNote(po.number, po.buyer_name ?? "", sl, fields.sample === "damaged" ? { [sl[0].sku]: 2 } : {})));
      n++;
    }
    for (const f of files.delivery_note ?? []) (await uploadReceivingDoc(p, po.id, "delivery_note", f), n++);
    if (fields.note_text?.trim()) (await uploadReceivingDoc(p, po.id, "delivery_note", textFile("pasted-delivery-note.txt", fields.note_text)), n++);
    for (const f of files.photo ?? []) (await uploadReceivingDoc(p, po.id, "photo", f), n++);
    if (!n) throw new GtError("Choose a file, paste the note or use a sample.", "invalid");
    back(res, `/po/${po.id}/receive`, `${n} document${n > 1 ? "s" : ""} stored and read. Check the proposal, then confirm.`);
  }));

  r.post("/po/:id/receive/confirm", act(async (req, res, p) => {
    if (req.body.checked !== "1") throw new GtError("Tick the box to confirm you checked the goods.", "invalid");
    const db = await getDb();
    await poFor(db, p, req.params.id);
    const counts: Record<string, CountInput> = {};
    for (const l of await linesOf(db, req.params.id)) counts[l.id] = { delivered: String(req.body[`delivered_${l.id}`] ?? ""), damaged: String(req.body[`damaged_${l.id}`] ?? "0"), wrong: String(req.body[`wrong_${l.id}`] ?? "0"), note: String(req.body[`note_${l.id}`] ?? "") };
    const r1 = await confirmReceipt(p, req.params.id, counts);
    const po = await getPo(db, req.params.id);
    back(res, `/po/${req.params.id}`, r1.unchanged ? "Nothing changed." : po.status === "in_review" ? `Receipt v${r1.version} confirmed. Waiting for the supplier to agree the flagged lines.` : `Receipt v${r1.version} confirmed and agreed.`);
  }));

  r.post("/po/:id/lines/:line/review", act(async (req, res, p) => {
    await supplierReview(p, req.params.id, req.params.line, req.body.action === "dispute" ? "dispute" : "agree", String(req.body.note ?? ""), String(req.body.seen ?? ""));
    back(res, `/po/${req.params.id}`, req.body.action === "dispute" ? "Dispute sent." : "Line agreed.");
  }));

  r.post("/po/:id/message", act(async (req, res, p) => {
    await postLineMessage(p, req.params.id, req.body.line_id ? String(req.body.line_id) : null, String(req.body.body ?? ""));
    res.redirect(`/po/${req.params.id}${req.body.line_id ? `#line-${req.body.line_id}` : ""}`);
  }));

  // ---------- Resolution ----------
  r.post("/po/:id/resolution/revise", act(async (req, res, p) => {
    const choices: Record<string, "replace" | "credit"> = {};
    for (const [k, v] of Object.entries(req.body)) if (k.startsWith("choice_")) choices[k.slice(7)] = v === "credit" ? "credit" : "replace";
    const nb = String(req.body.needed_by ?? "").trim();
    const v = await reviseResolution(p, req.params.id, { choices, needed_by: nb ? new Date(nb.length === 16 ? nb + ":00Z" : nb).toISOString() : undefined, plan_index: req.body.plan_index !== undefined ? Number(req.body.plan_index) : undefined });
    back(res, `/po/${req.params.id}#resolution`, `Resolution v${v} proposed. Both sides approve it again.`);
  }));

  r.post("/po/:id/resolution/approve", act(async (req, res, p) => {
    const out = await approveResolution(p, req.params.id, Number(req.body.version), String(req.body.hash ?? ""));
    back(res, `/po/${req.params.id}`, out === "agreed" ? "Agreed by both sides. Settling on PayPal." : out === "already" ? "Already approved." : "Approved. Waiting for the other side.");
  }));

  r.post("/po/:id/dispatch-part", act(async (req, res, p) => {
    const packs: Record<string, number> = {};
    for (const [k, v] of Object.entries(req.body ?? {})) if (k.startsWith("part_")) packs[k.slice(5)] = Number(String(v).trim() || "0");
    await dispatchPart(p, req.params.id, packs);
    back(res, `/po/${req.params.id}`, "Part 1 dispatched. Only its accepted goods are charged once the counts are agreed.");
  }));
  r.post("/po/:id/eta", act(async (req, res, p) => {
    const b = req.body;
    const out = await recordEta(p, req.params.id, { eta: new Date(String(b.eta) + "Z"), observedAt: new Date(String(b.observed_at) + "Z"), source: b.source === "carrier" ? "carrier" : "supplier", ref: String(b.ref ?? ""), note: String(b.note ?? "") });
    back(res, `/po/${req.params.id}`, out.duplicate ? "That update was already recorded." : !out.update.applied ? "Recorded, but not applied: a newer update stands." : out.risk ? "ETA recorded. It is after the deliver-by time, so the buyer was warned." : "ETA recorded.");
  }));
  r.post("/po/:id/risk", act(async (req, res, p) => {
    await decideRisk(p, req.params.id, req.body.choice === "expedite" ? "expedite" : "wait", String(req.body.note ?? ""));
    back(res, `/po/${req.params.id}`, req.body.choice === "expedite" ? "Asked the supplier to expedite." : "Noted: waiting for the delivery.");
  }));
  r.post("/po/:id/defects", act(async (req, res, p) => {
    await reportDefect(p, req.params.id, String(req.body.line_id ?? ""), Number(req.body.units), String(req.body.note ?? ""));
    back(res, `/po/${req.params.id}`, "Defect reported. The supplier will agree or dispute it.");
  }));
  r.post("/po/:id/defects/:claim", act(async (req, res, p) => {
    await decideDefect(p, req.params.claim, req.body.agree === "1", String(req.body.note ?? ""));
    back(res, `/po/${req.params.id}`, req.body.agree === "1" ? "Agreed. The refund was sent to the original PayPal payment." : "Disputed.");
  }));

  r.post("/po/:id/retry-settle", act(async (req, res, p) => {
    const db = await getDb();
    await poFor(db, p, req.params.id);
    if (!(p.role === "owner" || p.role === "supplier")) throw new GtError("Not allowed", "forbidden", 403);
    await retrySettle(req.params.id);
    back(res, `/po/${req.params.id}`, "Retrying settlement from the first unfinished step.");
  }));

  // ---------- Records, documents ----------
  r.get("/po/:id/record.csv", authed(async (req, res, p) => {
    const db = await getDb();
    const po = await poFor(db, p, req.params.id).catch(() => null);
    if (!po) return res.status(404).send("Not found");
    res.type("text/csv").setHeader("Content-Disposition", `attachment; filename="${po.number}-record.csv"`);
    res.send(await recordCsv(db, po.root_id));
  }));

  r.get("/po/:id/record.json", authed(async (req, res, p) => {
    const db = await getDb();
    const po = await poFor(db, p, req.params.id).catch(() => null);
    if (!po) return res.status(404).send("Not found");
    res.json(await recordJson(db, po.root_id));
  }));

  r.get("/doc/:id", authed(async (req, res, p) => {
    const db = await getDb();
    const d = (await db.query<any>("SELECT d.*, po.buyer_id, po.supplier_id FROM documents d JOIN purchase_orders po ON po.id = d.po_id WHERE d.id = $1", [req.params.id])).rows[0];
    if (!d || (d.buyer_id !== p.org_id && d.supplier_id !== p.org_id)) return res.status(404).send("Not found");
    res.setHeader("Content-Security-Policy", "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox");
    res.setHeader("Content-Disposition", `inline; filename="${String(d.filename).replace(/[^\w.-]/g, "_")}"`);
    res.type(d.mime === "text/plain" ? "text/plain; charset=utf-8" : d.mime).send(Buffer.from(d.body));
  }));

  // ---------- Stock, catalog, performance ----------
  r.post("/catalog/:id", act(async (req, res, p) => {
    if (p.role !== "supplier") throw new GtError("Only the supplier edits the catalog.", "forbidden", 403);
    const db = await getDb();
    const stock = Number(req.body.stock);
    const price = parseCents(String(req.body.price ?? ""));
    if (!Number.isInteger(stock) || stock < 0 || price === null || price < 0) throw new GtError("Stock must be a whole number and price a valid amount.", "invalid");
    const r1 = await db.query("UPDATE products SET stock_packs = $3, price_cents = $4 WHERE id = $1 AND supplier_id = $2 RETURNING id", [req.params.id, p.org_id, stock, price]);
    if (!r1.rows.length) throw new GtError("Not found", "not_found", 404);
    back(res, "/catalog", "Saved. Open quotes keep their quoted prices.");
  }));

  // ---------- PayPal connect ----------
  r.post("/connect-paypal", act(async (_req, res, p) => {
    res.redirect(await startConnect(p));
  }));

  r.get("/connect-paypal/return", authed(async (req, res, p) => {
    const token = String(req.query.approval_token_id ?? req.query.token ?? "");
    try {
      await completeConnect(p, token);
      back(res, "/home", "PayPal connected. Holds and captures now follow your approved orders.");
    } catch (e) {
      back(res, "/home", `PayPal connection failed: ${(e as Error).message}`, true);
    }
  }));

  return r;
}
