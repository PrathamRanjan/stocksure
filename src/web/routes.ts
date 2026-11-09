import { countersignThreshold } from "../guard/dryrun.js";
import { guardCard } from "./safetyui.js";
import { icon } from "./icons.js";
import { landing } from "./landing.js";
import { Router, type Request, type Response } from "express";
import { config } from "../config.js";
import { getDb } from "../db.js";
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
import { demoIds, sampleDeliveryNote, sampleInvoice, seedDemo } from "../services/seed.js";
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

  r.get("/", async (req, res) => {
    const p = await me(req);
    await landing(req, res, Boolean(p));
  });

  // ---------- Sign in ----------
  r.get("/login", async (req, res) => {
    const db = await getDb();
    const people = config.demoMode ? (await db.query<any>("SELECT p.id, p.name, p.role, o.name AS org, o.kind FROM people p JOIN orgs o ON o.id = p.org_id ORDER BY o.kind DESC, o.name, p.role")).rows : [];
    res.send(
      page(
        req,
        null,
        "Sign in",
        html`<section class="card" style="max-width:640px"><h1>Sign in</h1>
<form method="post" action="/login" class="stack"><div class="field"><label for="key">Access key</label><input id="key" type="password" name="key" autocomplete="current-password"></div><input type="hidden" name="next" value="${String(req.query.next ?? "/home")}"><button class="btn primary" type="submit">Sign in</button></form>
${people.length ? html`<h2 style="margin-top:1.5rem">Demo people</h2>${people.map((x) => html`<div class="persona"><div><b>${x.name}</b> · ${x.org}<br><span class="muted small">${x.kind === "supplier" ? "Supplier dispatch and review" : x.role === "owner" ? "Owner: orders, PayPal, approvals" : "Receiving: counts deliveries"}</span></div><form method="post" action="/login" class="inline"><input type="hidden" name="person_id" value="${x.id}"><input type="hidden" name="next" value="${String(req.query.next ?? "/home")}"><button class="btn small" type="submit">Sign in as ${x.name.split(" ")[0]}</button></form></div>`)}` : config.demoMode ? html`<p>No demo data yet. <a href="/demo">Load the demo</a>.</p>` : ""}
</section>`,
      ),
    );
  });

  r.post("/login", async (req, res) => {
    const db = await getDb();
    let p: Person | null = null;
    if (req.body.person_id && config.demoMode) p = await personById(db, String(req.body.person_id));
    else if (req.body.key) p = await personByKey(String(req.body.key));
    if (!p) return back(res, "/login", "That key is not valid.", true);
    signIn(res, p, config.appUrl.startsWith("https://"));
    const next = String(req.body.next ?? "/home");
    res.redirect(next.startsWith("/") && !next.startsWith("//") ? next : "/home");
  });

  r.post("/logout", (_req, res) => {
    signOut(res);
    res.redirect("/");
  });

  // ---------- Home ----------
  r.get(
    "/home",
    authed(async (req, res, p) => {
      const db = await getDb();
      const col = p.org_kind === "buyer" ? "buyer_id" : "supplier_id";
      const pos = (await db.query<PO & { buyer_name: string }>(`SELECT po.*, b.name AS buyer_name FROM purchase_orders po JOIN orgs b ON b.id = po.buyer_id WHERE po.${col} = $1 ORDER BY (po.status = 'closed'), po.created_at DESC LIMIT 100`, [p.org_id])).rows;
      const org = await orgById(db, p.org_id);
      const risky = await riskyPos(db, p.org_id);
      const totals = new Map<string, number>();
      for (const po of pos) totals.set(po.id, quoteTotal(await linesOf(db, po.id)));
      const needStates = p.org_kind === "supplier" ? ["submitted", "funded", "part_delivered", "in_review", "resolving", "exception"] : ["draft", "quoted", "dispatched", "in_review", "resolving", "exception"];
      const attention = pos.filter((po) => risky.has(po.id) || needStates.includes(po.status));
      const NEXT: Record<string, string> = p.org_kind === "supplier"
        ? { submitted: "Confirm the quote", funded: "Dispatch the order", part_delivered: "Send the rest", in_review: "Agree or dispute what arrived", resolving: "Approve the fix", exception: "Needs a look" }
        : { draft: "Finish and submit", quoted: "Accept the quote (places a PayPal hold)", dispatched: "Count it in at the dock", in_review: "Waiting on the supplier to agree", resolving: "Approve the fix", exception: "Needs a look" };
      const row = (po: (typeof pos)[number]) => html`<a class="r" href="/po/${po.id}"><span class="av ${po.status === "closed" ? "muted" : ""}">${raw(icon(po.kind === "replacement" ? "repeat" : po.status === "dispatched" ? "truck" : "package"))}</span><span><div class="t">${po.number}${po.kind === "replacement" ? html` <span class="pill info">replacement</span>` : ""}${po.note.startsWith("Imported") ? html` <span class="pill">history</span>` : ""}${risky.has(po.id) ? html` <span class="pill bad">late ETA</span>` : ""}</div><div class="s">${p.org_kind === "supplier" ? html`${po.buyer_name} · ` : ""}${NEXT[po.status] ?? `deliver by ${fmtDate(po.deliver_by)}`}</div></span><span class="m"><span class="amt">${totals.get(po.id) ? fmt(totals.get(po.id)!) : "—"}</span>${po.kind === "original" && po.spend_limit_cents ? `limit ${fmt(po.spend_limit_cents)}` : fmtDate(po.deliver_by)}</span><span class="act">${pill(po.status)}</span></a>`;
      const rest = pos.filter((po) => !attention.includes(po));
      res.send(
        page(
          req,
          p,
          "Orders",
          html`<div class="page-head"><div><h1>Orders</h1><p>${org?.name}${p.org_kind === "buyer" ? html` · ${org?.vault_token_id ? html`PayPal connected${org.vault_payer ? ` as ${org.vault_payer}` : ""}` : "PayPal not connected"}` : ""}</p></div>${p.org_kind === "buyer" && p.role === "owner" ? html`<a class="btn primary" href="/po/new">${raw(icon("cart"))}New order</a>` : ""}</div>
${p.org_kind === "buyer" && !org?.vault_token_id ? html`<section class="card"><h2>Connect PayPal</h2><p class="sub muted">One approval lets StockSure place a hold when you accept a quote. Nothing is charged until both sides agree what arrived.</p>${p.role === "owner" ? html`<form method="post" action="/connect-paypal"><button class="btn primary" type="submit">${raw(icon("wallet"))}Connect PayPal</button></form>` : html`<p class="muted">The owner connects PayPal.</p>`}</section>` : ""}
<div class="section-title"><h2>Needs you</h2><p>${attention.length ? `${attention.length} order${attention.length === 1 ? "" : "s"}` : ""}</p></div>
${attention.length ? html`<div class="rows">${attention.map(row)}</div>` : html`<div class="empty">Nothing waiting on you. ${p.org_kind === "buyer" && p.role === "owner" ? html`<a href="/po/new">Start a new order</a>.` : ""}</div>`}
${rest.length ? html`<div class="section-title"><h2>All orders</h2></div><div class="rows">${rest.map(row)}</div>` : ""}`,
          { refresh: pos.some((x) => x.status === "settling" || x.status === "part_settling" || x.status === "funding") ? 4 : undefined },
        ),
      );
    }),
  );

  // ---------- New order ----------
  r.get(
    "/po/new",
    authed(async (req, res, p) => {
      if (p.org_kind !== "buyer" || p.role !== "owner") return res.status(403).send("Only the buyer's owner creates orders.");
      const db = await getDb();
      const suppliers = (await db.query<{ id: string; name: string }>("SELECT id, name FROM orgs WHERE kind = 'supplier' ORDER BY name")).rows;
      const cat = suppliers[0] ? await catalog(db, suppliers[0].id) : [];
      const tomorrow = new Date(Date.now() + 864e5).toISOString().slice(0, 10) + "T06:00";
      const row = (i: number) => html`<fieldset><legend>Line ${i + 1}</legend><div class="grid g3">
<div class="field"><label for="prod${i}">Product</label><select id="prod${i}" name="product_${i}"><option value="">—</option>${cat.map((c) => html`<option value="${c.id}">${c.sku} · ${c.name} · ${fmt(c.price_cents)}/${c.pack_label}</option>`)}</select></div>
<div class="field"><label for="qty${i}">Quantity (whole packs)</label><input id="qty${i}" type="number" min="1" name="qty_${i}"></div>
<div class="field"><label class="check"><input type="checkbox" name="replace_${i}" value="1" checked> Replace any shortfall</label></div></div>
<div class="field"><span class="small">Acceptable substitutes</span><div class="row">${cat.map((c) => html`<label class="check small"><input type="checkbox" name="subs_${i}" value="${c.id}"> ${c.sku}</label>`)}</div></div></fieldset>`;
      res.send(
        page(
          req,
          p,
          "New order",
          html`<h1>New purchase order</h1><form method="post" action="/po/new" class="card stack">
<div class="grid g3"><div class="field"><label for="sup">Supplier</label><select id="sup" name="supplier_id">${suppliers.map((s) => html`<option value="${s.id}">${s.name}</option>`)}</select></div>
<div class="field"><label for="dby">Deliver by (UTC)</label><input id="dby" type="datetime-local" name="deliver_by" value="${tomorrow}" required></div>
<div class="field"><label for="lim">Spending limit ($)</label><input id="lim" type="text" inputmode="decimal" name="limit" required placeholder="210.00"><span class="help">Covers the order and any replacements.</span></div></div>
${[0, 1, 2].map(row)}
<div class="field"><label for="note">Note</label><input id="note" type="text" name="note" maxlength="200"></div>
<button class="btn primary" type="submit">Save draft</button></form>`,
        ),
      );
    }),
  );

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

  // ---------- PO page ----------
  r.get(
    "/po/:id",
    authed(async (req, res, p) => {
      const db = await getDb();
      const po = await poFor(db, p, req.params.id).catch(() => null);
      if (!po) return res.status(404).send(page(req, p, "Not found", html`<h1>Not found</h1>`));
      const msgs = await messagesFor(db, po.id);
      const lines = await linesOf(db, po.id);
      res.send(
        page(
          req,
          p,
          po.number,
          html`<p class="small"><a href="/home">← Orders</a></p><div class="page-head"><div><h1>${po.number} ${pill(po.status)}</h1><p>${po.buyer_name} → ${po.supplier_name} · deliver by ${fmtDate(po.deliver_by)}${po.kind === "original" ? ` · limit ${fmt(po.spend_limit_cents)}` : ""}${po.note ? ` · ${po.note}` : ""}</p></div>
<div class="row">${po.status !== "draft" ? html`<a class="btn small" href="/po/${po.root_id}/record.csv">${raw(icon("file"))}CSV</a><a class="btn small" href="/po/${po.root_id}/record.json">JSON</a>` : ""}</div></div>
${await treeNav(db, po)}
${po.exception && po.status !== "exception" && po.status !== "funding" ? html`<p class="banner warn">${po.exception}</p>` : ""}
${p.org_kind === "buyer" && p.role === "owner" ? (await db.query<any>("SELECT * FROM approvals WHERE owner_id = $1 AND status = 'pending' AND payload->>'entity' = 'po' AND payload->>'entity_id' = $2 ORDER BY created_at", [p.org_id, po.id])).rows.map((a) => { const pl = typeof a.payload === "string" ? JSON.parse(a.payload) : a.payload; const big = Number(pl.cents) > countersignThreshold(); return html`<div id="ap-${a.id}">${guardCard({ level: pl.safety_reasons?.length ? "hold" : "caution", reasons: pl.safety_reasons?.length ? pl.safety_reasons : [`This ${a.action} is above the amount StockSure may move without you.`] }, { approve: big ? null : `/guard/approvals/${a.id}`, next: `/po/${po.id}`, title: `${a.action === "refund" ? "Refund" : "PayPal capture"} of ${fmt(Number(pl.cents))} waits for you`, doText: pl.safety_reasons?.length ? "A message on this order looks like invoice fraud. Call the supplier on a number you already have before approving." : big ? "This amount needs your passkey: approve it on the Approvals page." : "Approve to let it go ahead, or decline and nothing moves." })}${big ? html`<p class="small"><a class="btn small primary" href="/guard#approvals">Sign with your passkey</a></p>` : ""}</div>`; }) : ""}
${await actionsCard(db, po, p)}
${lines.some((l) => l.unit_price_cents !== null) || po.auth_id ? await fundingPanel(db, po) : ""}
${await resolutionCard(db, po, p)}
${await agentCard(db, po, p)}
${await linesTable(db, po, p, msgs)}
${await supplyCard(db, po, p)}
${await defectsCard(db, po, p)}
${await docsCard(db, po)}
${await paymentsCard(db, po)}
<section class="card"><h2>Order thread</h2>${thread(msgs, null, po.id, true)}</section>
${await timeline(db, po)}`,
          { refresh: po.status === "settling" || po.status === "part_settling" || po.status === "funding" ? 3 : undefined },
        ),
      );
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

  // ---------- Receiving ----------
  r.get(
    "/po/:id/receive",
    authed(async (req, res, p) => {
      const db = await getDb();
      const po = await poFor(db, p, req.params.id).catch(() => null);
      if (!po) return res.status(404).send("Not found");
      if (p.org_kind !== "buyer") return res.redirect(`/po/${po.id}`);
      const v = await receiveView(db, po);
      const open = po.status === "dispatched" || po.status === "in_review";
      res.send(
        page(
          req,
          p,
          `Receive ${po.number}`,
          html`<p><a href="/po/${po.id}">← ${po.number}</a></p><h1>Receive ${po.number} ${pill(po.status)}</h1>
${!open ? html`<p class="banner info">This receipt is locked (${po.status.replace(/_/g, " ")}).</p>` : ""}
${open ? html`<section class="card"><h2>1 · Delivery note and photos</h2>
<form method="post" action="/po/${po.id}/receive/upload" enctype="multipart/form-data" class="stack">
<div class="grid g2"><div class="field"><label for="note">Delivery note (photo, PDF or text)</label><input id="note" type="file" name="delivery_note" accept="image/*,.pdf,.txt,.csv"></div>
<div class="field"><label for="ph">Damage photos</label><input id="ph" type="file" name="photo" accept="image/*" multiple></div></div>
<div class="field"><label for="pt">Or paste the delivery note text</label><textarea id="pt" name="note_text" rows="3"></textarea></div>
<div class="row"><button class="btn primary" type="submit">Upload and read</button>${config.demoMode ? html`<button class="btn" type="submit" name="sample" value="damaged">Use sample note: 20 cs, driver notes 2 crushed</button><button class="btn" type="submit" name="sample" value="clean">Use sample note: delivered in full</button>` : ""}</div>
<p class="small muted">AI reads the documents and proposes counts. It cannot confirm a delivery: you do, below.</p></form></section>` : ""}
${v.extractions}
<section class="card"><h2>2 · Confirm what arrived</h2>
<p class="small">Enter counts as <code>20 cs</code>, <code>19 cs + 12 ea</code>, <code>240 btl</code> or a plain number of packs. Highlighted fields have an uncertain proposal.</p>
<form method="post" action="/po/${po.id}/receive/confirm" class="stack">${v.table}
<label class="check"><input type="checkbox" name="checked" value="1" required> I checked these goods myself (photos and notes support a claim; they do not prove it).</label>
<button class="btn primary" type="submit" ${open ? "" : "disabled"}>Confirm receipt</button></form></section>`,
        ),
      );
    }),
  );

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
  r.get("/stock", authed(async (req, res, p) => {
    if (p.org_kind !== "buyer") return res.redirect("/catalog");
    const db = await getDb();
    const rows = (await db.query<any>("SELECT s.units, row_to_json(pr.*) AS product, (SELECT max(at) FROM stock_moves m WHERE m.buyer_id = s.buyer_id AND m.product_id = s.product_id) AS last FROM stock s JOIN products pr ON pr.id = s.product_id WHERE s.buyer_id = $1 ORDER BY pr.sku", [p.org_id])).rows;
    const moves = (await db.query<any>("SELECT m.*, pr.sku, row_to_json(pr.*) AS product, po.number FROM stock_moves m JOIN products pr ON pr.id = m.product_id LEFT JOIN purchase_orders po ON po.id = m.po_id WHERE m.buyer_id = $1 ORDER BY m.id DESC LIMIT 30", [p.org_id])).rows;
    const P = (x: any) => (typeof x === "string" ? JSON.parse(x) : x);
    res.send(page(req, p, "Stock", html`<h1>Stock</h1><p class="muted">On-hand from confirmed receipts. A revised receipt posts the difference, so every move is traceable.</p>
<section class="card"><div class="table-wrap"><table><thead><tr><th>Product</th><th class="num">On hand</th><th>Last move</th></tr></thead><tbody>${rows.length ? rows.map((x) => html`<tr><td><b>${P(x.product).sku}</b> ${P(x.product).name}</td><td class="num">${formatUnits(x.units, P(x.product))}</td><td>${fmtDate(x.last)}</td></tr>`) : html`<tr><td colspan="3" class="muted">No receipts yet.</td></tr>`}</tbody></table></div></section>
<section class="card"><h2>Moves</h2><div class="table-wrap"><table><thead><tr><th>When</th><th>Product</th><th class="num">Change</th><th>Reason</th></tr></thead><tbody>${moves.map((m) => html`<tr><td>${fmtDate(m.at)}</td><td>${m.sku}</td><td class="num">${m.delta > 0 ? "+" : "−"}${formatUnits(Math.abs(m.delta), P(m.product))}</td><td>${m.reason}${m.number ? html` · <a href="/po/${m.po_id}">${m.number}</a>` : ""}</td></tr>`)}</tbody></table></div></section>`));
  }));

  r.get("/catalog", authed(async (req, res, p) => {
    const db = await getDb();
    const sup = p.org_kind === "supplier" ? p.org_id : (await db.query<{ id: string }>("SELECT id FROM orgs WHERE kind = 'supplier' LIMIT 1")).rows[0]?.id;
    const cat = sup ? await catalog(db, sup) : [];
    res.send(page(req, p, "Catalog", html`<h1>Catalog</h1><section class="card"><div class="table-wrap"><table><thead><tr><th>SKU</th><th>Product</th><th>Pack</th><th class="num">Price</th><th class="num">In stock</th><th class="num">Lead time</th>${p.org_kind === "supplier" ? raw("<th></th>") : ""}</tr></thead><tbody>
${cat.map((c) => html`<tr><td><b>${c.sku}</b></td><td>${c.name}<br><span class="muted small">${c.family}</span></td><td>${c.pack_label} of ${c.pack_units} ${c.base_unit}</td><td class="num">${fmt(c.price_cents)}</td><td class="num">${c.stock_packs}</td><td class="num">${c.lead_hours} h</td>${p.org_kind === "supplier" ? html`<td><form method="post" action="/catalog/${c.id}" class="row"><label class="sr" for="s-${c.id}">Stock</label><input id="s-${c.id}" type="number" min="0" name="stock" value="${c.stock_packs}" style="width:5rem"><label class="sr" for="pr-${c.id}">Price</label><input id="pr-${c.id}" type="text" name="price" value="${(c.price_cents / 100).toFixed(2)}" style="width:6rem"><button class="btn small" type="submit">Save</button></form></td>` : ""}</tr>`)}
</tbody></table></div></section>`));
  }));

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

  r.get("/performance", authed(async (req, res, p) => {
    const db = await getDb();
    const sup = p.org_kind === "supplier" ? p.org_id : (await db.query<{ id: string }>("SELECT supplier_id AS id FROM purchase_orders WHERE buyer_id = $1 LIMIT 1", [p.org_id])).rows[0]?.id;
    if (!sup) return res.send(page(req, p, "Performance", html`<h1>Performance</h1><p>No orders yet.</p>`));
    const buyers = (await db.query<{ id: string; name: string }>("SELECT DISTINCT o.id, o.name FROM orgs o JOIN purchase_orders po ON po.buyer_id = o.id WHERE po.supplier_id = $1 ORDER BY o.name", [sup])).rows.filter((b) => p.org_kind === "supplier" || b.id === p.org_id);
    const rows: Raw[] = [];
    const show = (label: string, x: Awaited<ReturnType<typeof supplierPerformance>>) => html`<tr><td>${label}</td><td class="num">${x.orders}</td><td class="num">${x.on_time_pct ?? "—"}%</td><td class="num">${x.fill_rate_pct ?? "—"}%</td><td class="num">${x.damage_rate_pct ?? "—"}%</td><td class="num">${x.dispute_rate_pct ?? "—"}%</td><td class="num">${x.median_resolution_hours ?? "—"} h</td><td class="num">${x.invoice_accuracy_pct ?? "—"}${x.invoice_accuracy_pct === null ? "" : "%"}</td></tr>`;
    if (p.org_kind === "supplier") rows.push(show("All buyers", await supplierPerformance(db, sup)));
    for (const b of buyers) rows.push(show(b.name, await supplierPerformance(db, sup, b.id)));
    res.send(page(req, p, "Performance", html`<h1>Supplier performance</h1><p class="muted">Computed from recorded deliveries: dispatch time vs deadline, accepted vs ordered units, damage and disputes on agreed receipts, and invoices with no flags.</p>
<section class="card"><div class="table-wrap"><table><thead><tr><th>Scope</th><th class="num">Orders</th><th class="num">On time</th><th class="num">Fill rate</th><th class="num">Damage</th><th class="num">Disputed</th><th class="num">Median receipt → agreed</th><th class="num">Invoice accuracy</th></tr></thead><tbody>${rows}</tbody></table></div></section>`));
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

  // ---------- Demo ----------
  r.get("/demo", async (req, res) => {
    const p = await me(req);
    const db = await getDb();
    const ids = await demoIds(db);
    const demoPo = ids ? await getPo(db, ids.demoPo).catch(() => null) : null;
    const f = demoPo && demoPo.auth_id ? await fundingOf(db, demoPo.root_id) : null;
    const driver = ids ? (await db.query<{ driver_token: string | null }>("SELECT driver_token FROM people WHERE id = $1", [ids.people.ana])).rows[0] : null;
    res.send(page(req, p, "Demo", html`<h1>Demo setup</h1>
${!config.demoMode ? html`<p class="banner warn">Demo mode is off.</p>` : html`
<section class="card"><h2>Scenario</h2><ol>
<li>Sign in as <b>Jordan</b> (Laneway Café owner). Connect PayPal once (sandbox buyer). Open ${demoPo ? html`<a href="/po/${demoPo.id}">${demoPo.number}</a>` : "the draft order"}: 20 cases Oat Milk 12 × 1 L at $10, limit $210, Barista Oat and mill-direct approved as substitutes. Send it.</li>
<li>Sign in as <b>Ana</b> (Harbour Wholesale): confirm the quote. Jordan accepts it: a $200 PayPal hold.</li>
<li>Ana marks it dispatched with the sample invoice that hides instructions to pay $500 elsewhere.</li>
<li>Sign in as <b>Sam</b> (receiving): use the sample delivery note. The AI proposal reads 20 cases and the driver's note of 2 crushed. Sam confirms 18 accepted, 2 damaged.</li>
<li>Ana agrees the line. The resolution pays $180, credits $20 and picks 2 × Barista Oat at $24: $204 of $210. Both approve.</li>
<li>StockSure captures $180 (final capture), confirms PayPal released the other $20, then holds $24 for the replacement. Ana dispatches it; Sam receives it; $24 is captured. The order closes at $204.</li></ol>
${f ? html`<p>Current funding for ${demoPo!.number}: captured ${fmt(f.captured_cents)}, held ${fmt(f.held_cents)}, spendable ${fmt(f.spendable_cents)} of ${fmt(f.limit_cents)}.</p>` : ""}</section>
<section class="card"><h2>Agents and phones</h2><p class="small">MCP endpoint <span class="mono">${config.appUrl}/mcp</span> (Streamable HTTP, <span class="mono">Authorization: Bearer &lt;key&gt;</span>, optional <span class="mono">X-Agent-Id</span>). Merchant cart API under <span class="mono">/api/merchant</span> with the same key. Keys are printed by <span class="mono">npm run seed</span> and never shown on a page.</p>${config.demoMode && ids ? html`<p class="small">Sign in without a key (demo mode): ${Object.entries(ids.people).map(([name, id]) => html`<form method="post" action="/login" class="inline"><input type="hidden" name="person_id" value="${id}"><button class="btn small" type="submit">${name}</button></form> `)}</p>` : ""}
${driver?.driver_token ? html`<p class="small">Driver page (no sign-in): <a href="/driver/${driver.driver_token}">${config.appUrl}/driver/${driver.driver_token}</a></p>` : ""}
<p class="small">Judge mode: <a href="/judge">/judge</a>. Evidence: <a href="/evidence">/evidence</a>. Agent demo script: <span class="mono">npm run agent:demo</span>.</p></section>
<section class="card"><h2>Reset</h2><form method="post" action="/demo/reset" class="row"><label class="check"><input type="checkbox" name="keep" value="1" checked> Keep saved PayPal connections</label><button class="btn danger" type="submit">Reset and load demo data</button></form></section>
<section class="card"><h2>Inject a PayPal failure</h2><p class="small">The next call to the method fails once. Use it to show retries with the same request id, read-back after a lost response, and the release check.</p>
<form method="post" action="/demo/fault" class="row"><label class="sr" for="fm">Method</label><select id="fm" name="method">${FAULTABLE.map((m) => html`<option>${m}</option>`)}</select><label class="sr" for="fk">Fault</label><select id="fk" name="kind"><option value="fail_503">503 (retry)</option><option value="lose_response">lose the response</option><option value="fail_422">422 (refused)</option><option value="stale_read">stale read (hold still shows partially captured)</option></select><button class="btn" type="submit">Arm</button></form></section>`}`));
  });

  r.post("/demo/reset", async (req, res) => {
    if (!config.demoMode) return res.status(403).send("Demo mode is off");
    const db = await getDb();
    try {
      await db.tx((q) => seedDemo(q, { keepPayPal: req.body.keep === "1" }));
    } catch (e) {
      // Never take the server down from a demo reset; nothing was changed (the reset is one transaction).
      return back(res, "/demo", `Reset failed, nothing changed: ${(e as Error).message}`, true);
    }
    signOut(res);
    back(res, "/login", "Demo loaded. Sign in as Jordan to start.");
  });

  r.post("/demo/fault", async (req, res) => {
    if (!config.demoMode) return res.status(403).send("Demo mode is off");
    const method = String(req.body.method);
    const kind = String(req.body.kind) as FaultKind;
    if (!(FAULTABLE as readonly string[]).includes(method) || !["fail_503", "lose_response", "fail_422", "stale_read"].includes(kind)) return back(res, "/demo", "Unknown fault", true);
    await armFault(method, kind);
    back(res, "/demo", `Armed: next ${method} → ${kind}.`);
  });

  return r;
}
