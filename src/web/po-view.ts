import type { Queryable } from "../db.js";
import { config } from "../config.js";
import { fmt } from "../core/money.js";
import { formatUnits } from "../core/units.js";
import { quoteTotal } from "../services/orders.js";
import { lineFingerprint, proposalFor } from "../services/receiving.js";
import { claimsOf } from "../services/aftercare.js";
import { etaUpdates, riskView } from "../services/supply-watch.js";
import { deliveryContext, partCharged, shipmentsOf } from "../services/parts.js";
import { docsOf, fundingOf, latestReceipt, latestResolution, linesOf, opsOfRoot, orgById, treeOf, type Person, type PO, type PoLine } from "../store.js";
import { fmtDate, html, pill, raw, type Raw } from "./html.js";
import { scanText } from "../safety/rules.js";
import { agreementFor, verifyAgreement } from "../services/agreements.js";
import { negotiationsFor } from "../agents/runtime.js";
import { runsFor } from "../trace.js";

const FLAG_TEXT: Record<string, string> = {
  count_differs: "count differs from PO",
  unit_unclear: "unit unclear",
  identity_uncertain: "product uncertain",
  low_confidence: "low confidence",
  not_on_po: "not on PO",
  possible_damage: "possible damage",
  not_on_note: "not on delivery note",
};
export const flagChip = (f: string) => html`<span class="flag ${f === "possible_damage" || f === "not_on_po" ? "bad" : ""}">${FLAG_TEXT[f] ?? f.replace(/_/g, " ")}</span>`;

const units = (n: number | null | undefined, l: PoLine) => (n === null || n === undefined ? "—" : formatUnits(n, l.product));

export async function messagesFor(q: Queryable, poId: string) {
  return (await q.query<any>("SELECT * FROM messages WHERE po_id = $1 ORDER BY id", [poId])).rows;
}

export function thread(msgs: any[], lineId: string | null, poId: string, canPost: boolean): Raw {
  const mine = msgs.filter((m) => (m.po_line_id ?? null) === lineId);
  return html`<div class="thread" aria-label="${lineId ? "Line thread" : "Order thread"}">
${mine.length ? mine.map((m) => { const scan = scanText(m.body); return html`<p class="msg ${m.kind}">${scan.level !== "clear" ? html`<span class="banner ${scan.level === "hold" ? "bad" : "warn"}" role="alert" style="display:block;margin-bottom:6px"><b>Scam check:</b> this message ${scan.words.join(", and ")}. StockSure pays suppliers only through PayPal under the agreed order; nothing written in a message changes where or how much is paid.</span>` : ""}<b>${m.author}</b> <span class="muted small">${fmtDate(m.created_at)}</span><br>${m.body}${m.document_id ? html` <a href="/doc/${m.document_id}">evidence</a>` : ""}</p>`; }) : html`<p class="msg system">No messages yet.</p>`}
${canPost ? html`<form method="post" action="/po/${poId}/message" class="row"><input type="hidden" name="line_id" value="${lineId ?? ""}"><label class="sr" for="m-${lineId ?? "po"}">Message</label><input id="m-${lineId ?? "po"}" type="text" name="body" placeholder="${lineId ? "Reply about this line" : "Message the other side"}" required maxlength="2000"><button class="btn small" type="submit">Send</button></form>` : ""}
</div>`;
}

export async function fundingPanel(q: Queryable, po: PO): Promise<Raw> {
  const f = await fundingOf(q, po.root_id);
  const exp = f.expected.reduce((a, x) => a + x.cents, 0);
  return html`<section class="card" aria-labelledby="fund-h"><h2 id="fund-h">Funding</h2>
<p class="sub muted">Spendable is computed only from PayPal state read back after each call. Expected releases and refunds are shown but cannot be spent until PayPal confirms them.</p>
<div class="fund">
<div class="kpi"><div class="label">Limit</div><div class="value">${fmt(f.limit_cents)}</div></div>
<div class="kpi"><div class="label">Captured</div><div class="value">${fmt(f.captured_cents - f.refunded_cents)}</div><div class="hint">${f.refunded_cents ? `${fmt(f.refunded_cents)} refunded` : "charged so far"}</div></div>
<div class="kpi"><div class="label">Held on PayPal</div><div class="value">${fmt(f.held_cents + f.inflight_cents)}</div><div class="hint">${f.inflight_cents ? `${fmt(f.inflight_cents)} being placed` : "live authorizations"}</div></div>
<div class="kpi expected"><div class="label">Expected, not spendable</div><div class="value">${fmt(exp)}</div><div class="hint">${f.expected.length ? f.expected.map((x) => x.label).join("; ") : "nothing pending"}</div></div>
<div class="kpi"><div class="label">Spendable now</div><div class="value">${fmt(f.spendable_cents)}</div></div>
</div>
${f.holds.length ? html`<div class="table-wrap"><table><caption class="sr">PayPal holds</caption><thead><tr><th>Hold</th><th>PO</th><th class="num">Authorized</th><th class="num">Captured</th><th class="num">Still held</th><th>PayPal status</th></tr></thead><tbody>${f.holds.map((h) => html`<tr><td class="mono">${h.id}</td><td>${h.po_number ?? ""}</td><td class="num">${fmt(h.amount_cents)}</td><td class="num">${fmt(h.captured_cents)}</td><td class="num">${fmt(h.live_cents)}</td><td>${pill(h.status)}</td></tr>`)}</tbody></table></div>` : ""}
</section>`;
}

export async function linesTable(q: Queryable, po: PO, me: Person, msgs: any[]): Promise<Raw> {
  const lines = await linesOf(q, po.id);
  const rec = await latestReceipt(q, po.id);
  const byLine = new Map((rec?.lines ?? []).map((l) => [l.po_line_id, l]));
  const cat = new Map((await q.query<{ id: string; sku: string }>("SELECT id, sku FROM products WHERE supplier_id = $1", [po.supplier_id])).rows.map((p) => [p.id, p.sku]));
  const reviewing = me.role === "supplier" && po.status === "in_review";
  return html`<section class="card" aria-labelledby="lines-h"><h2 id="lines-h">Lines${rec ? html` <span class="muted small">· receipt v${rec.receipt.version} by ${rec.receipt.confirmed_by}</span>` : ""}</h2>
${lines.map((l) => {
  const r = byLine.get(l.id);
  return html`<div class="line-block" id="line-${l.id}">
<div class="table-wrap"><table><thead><tr><th>#</th><th>Product</th><th class="num">Ordered</th><th class="num">Price / ${l.product.pack_label}</th><th class="num">Quoted</th>${r ? raw(`<th class="num">Delivered</th><th class="num">Accepted</th><th class="num">Damaged</th><th class="num">Wrong</th><th>Supplier</th>`) : ""}</tr></thead>
<tbody><tr><td>${l.line_no}</td><td><b>${l.product.sku}</b> ${l.product.name}<br><span class="muted small">${l.product.pack_label} of ${l.product.pack_units} ${l.product.base_unit}${l.substitutes.length ? ` · substitutes OK: ${l.substitutes.map((s) => cat.get(s) ?? s).join(", ")}` : " · no substitutes"}${l.replace_shortfall ? "" : " · credit shortfalls"}</span></td>
<td class="num">${units(l.qty_packs * l.product.pack_units, l)}</td><td class="num">${l.unit_price_cents === null ? "not quoted" : fmt(l.unit_price_cents)}</td><td class="num">${l.unit_price_cents === null ? "—" : fmt(l.qty_packs * l.unit_price_cents)}</td>
${r ? html`<td class="num">${units(r.delivered_units, l)}</td><td class="num">${units(r.accepted_units, l)}</td><td class="num">${units(r.damaged_units, l)}</td><td class="num">${units(r.wrong_units, l)}</td><td>${pill(r.supplier_status)}${r.supplier_note ? html`<br><span class="small">${r.supplier_note}</span>` : ""}</td>` : ""}
</tr></tbody></table></div>
${r?.note ? html`<p class="small">Receiving note: ${r.note}</p>` : ""}
${reviewing && r && r.supplier_status !== "agreed" ? html`<div class="actions"><form method="post" action="/po/${po.id}/lines/${l.id}/review" class="inline"><input type="hidden" name="action" value="agree"><input type="hidden" name="seen" value="${lineFingerprint(rec!.receipt.version, r)}"><button class="btn primary small" type="submit">Agree line ${l.line_no}</button></form>
<form method="post" action="/po/${po.id}/lines/${l.id}/review" class="row"><input type="hidden" name="action" value="dispute"><input type="hidden" name="seen" value="${lineFingerprint(rec!.receipt.version, r)}"><label class="sr" for="d-${l.id}">Dispute reason</label><input id="d-${l.id}" type="text" name="note" placeholder="What do you dispute?" required maxlength="500"><button class="btn danger small" type="submit">Dispute</button></form></div>` : ""}
${thread(msgs, l.id, po.id, po.status !== "closed")}
</div>`;
})}
</section>`;
}

export async function resolutionCard(q: Queryable, po: PO, me: Person): Promise<Raw> {
  const r = await latestResolution(q, po.id);
  if (!r) return html``;
  const b = r.body;
  const lines = await linesOf(q, po.id);
  const L = new Map(lines.map((l) => [l.id, l]));
  const owner = me.org_kind === "buyer" && me.role === "owner";
  const open = r.status === "proposed" && po.status === "resolving";
  const mySide = me.org_kind === "buyer" ? r.buyer_approved_hash : r.supplier_approved_hash;
  const canApprove = open && (me.org_kind === "supplier" || owner) && mySide !== r.hash;
  const t = b.totals;
  const already = await partCharged(q, po.id);
  return html`<section class="card" aria-labelledby="res-h" id="resolution"><h2 id="res-h">Resolution v${r.version} ${pill(r.status)}</h2>
${already ? html`<p class="banner info">Delivered in two parts. Part 1 already charged ${fmt(already)} on the same hold. Settlement captures the remaining ${fmt(Math.max(0, t.accepted_cents - already))} as the final capture, and PayPal releases the rest. The two captures add up to the ${fmt(t.accepted_cents)} below.</p>` : ""}
<p class="sub">${b.auto ? "Delivery matched the accepted quote, so it settles without changes." : html`Proposed from agreed receipt v${b.receipt_version} and quote v${b.quote_version}. Paid amounts use quote prices × agreed accepted quantities. The invoice is compared, never paid from.`}</p>
<div class="table-wrap"><table><thead><tr><th>#</th><th>Product</th><th class="num">Ordered</th><th class="num">Accepted</th><th class="num">Short</th><th class="num">Quoted</th><th class="num">Pay</th><th class="num">Not charged</th><th class="num">Invoiced</th><th>Remedy</th></tr></thead><tbody>
${b.lines.map((x: any) => {
  const l = L.get(x.line_id)!;
  return html`<tr><td>${x.line_no}</td><td><b>${x.sku}</b> ${x.name}<br><span class="muted small">${x.reason}</span></td><td class="num">${units(x.ordered, l)}</td><td class="num">${units(x.paid_units, l)}</td><td class="num">${units(x.shortfall, l)}</td><td class="num">${fmt(x.quoted_cents)}</td><td class="num"><b>${fmt(x.accepted_cents)}</b></td><td class="num">${fmt(x.not_charged_cents)}</td><td class="num">${x.invoice_cents === null ? "—" : fmt(x.invoice_cents)}</td><td>${x.remedy === "none" ? "—" : x.remedy}</td></tr>`;
})}
</tbody></table></div>
${b.flags.length ? html`<h3>Invoice and delivery checks</h3><ul>${b.flags.map((f: any) => html`<li><span class="flag ${f.code === "invoice_not_on_po" || f.code === "price_above_quote" ? "bad" : ""}">${f.code.replace(/_/g, " ")}</span> ${f.message}</li>`)}</ul>` : ""}
${b.needs.length || b.plan.alternatives.length ? html`<h3>Replacement</h3>
<p>Needed by <b>${fmtDate(b.needed_by)}</b>. Budget for replacements: <b>${fmt(b.plan.budget_cents)}</b> (limit ${fmt(t.limit_cents)} − accepted ${fmt(t.accepted_cents)}${t.other_spend_cents ? ` − other committed ${fmt(t.other_spend_cents)}` : ""}).</p>
${b.plan.chosen ? html`<div class="table-wrap"><table><thead><tr><th>Chosen</th><th class="num">Packs</th><th class="num">Units</th><th class="num">Price</th><th class="num">Cost</th><th>Arrives by</th></tr></thead><tbody>${b.plan.chosen.picks.map((p: any) => html`<tr><td><b>${p.sku}</b> ${p.name}</td><td class="num">${p.packs}</td><td class="num">${p.units}${p.over_units ? ` (+${p.over_units} extra)` : ""}</td><td class="num">${fmt(p.pack_price_cents)}</td><td class="num">${fmt(p.cents)}</td><td>${fmtDate(p.eta)}</td></tr>`)}</tbody></table></div>${b.plan.chosen.unfilled_units ? html`<p class="banner warn">${b.plan.chosen.unfilled_units} units cannot be replaced within the limits and are credited instead.</p>` : ""}` : html`<p class="banner warn">No replacement fits: shortfall is credited (not charged).</p>`}
${b.plan.blocked.length ? html`<details><summary>Why other products were not chosen (${b.plan.blocked.length})</summary><ul>${b.plan.blocked.map((x: any) => html`<li><b>${x.sku}</b> ${x.name}: ${x.reason}</li>`)}</ul></details>` : ""}` : ""}
<h3>Money</h3>
<div class="table-wrap"><table class="ledger"><tbody>
<tr><td>Accepted goods (this PO)</td><td class="num">${fmt(t.accepted_cents)}</td></tr>
${t.replacement_cents ? html`<tr><td>Replacement goods</td><td class="num">${fmt(t.replacement_cents)}</td></tr>` : ""}
${t.other_spend_cents ? html`<tr><td>Already committed elsewhere in this order</td><td class="num">${fmt(t.other_spend_cents)}</td></tr>` : ""}
<tr><td><b>Final spending</b></td><td class="num"><b>${fmt(t.final_cents)}</b></td></tr>
<tr><td>Limit</td><td class="num">${fmt(t.limit_cents)}</td></tr>
<tr><td>Headroom</td><td class="num">${fmt(t.headroom_cents)}</td></tr>
${t.invoice_cents !== null ? html`<tr><td class="muted">Supplier invoice said</td><td class="num muted">${fmt(t.invoice_cents)}</td></tr>` : ""}
</tbody></table></div>
${b.funding.hold_cents ? html`<p class="small">Funding sequence: capture ${fmt(t.accepted_cents)} on the ${fmt(b.funding.hold_cents)} hold with final capture, which releases ${fmt(b.funding.release_expected_cents)}. That release is <b>not spendable</b> until PayPal confirms it; the replacement hold${t.replacement_cents ? ` of ${fmt(t.replacement_cents)}` : ""} is placed only after. Spendable right now: ${fmt(b.funding.spendable_now_cents)}.</p>` : ""}
<p class="small">Buyer: ${r.buyer_approved_by ? html`${pill("agreed")} ${r.buyer_approved_by}` : pill("pending")} · Supplier: ${r.supplier_approved_by ? html`${pill("agreed")} ${r.supplier_approved_by}` : pill("pending")}</p>
<p class="hash">v${r.version} sha256 ${r.hash}</p>
${canApprove ? html`<form method="post" action="/po/${po.id}/resolution/approve"><input type="hidden" name="version" value="${r.version}"><input type="hidden" name="hash" value="${r.hash}"><button class="btn primary" type="submit" ${t.final_cents > t.limit_cents ? "disabled" : ""}>Approve v${r.version}: pay ${fmt(t.accepted_cents)}${t.replacement_cents ? ` + ${fmt(t.replacement_cents)} replacement` : ""}</button></form>` : open && mySide === r.hash ? html`<p class="muted">You approved v${r.version}. Waiting for the other side.</p>` : ""}
${open && owner ? html`<details><summary>Change the proposal (creates v${r.version + 1}; approvals reset)</summary>
<form method="post" action="/po/${po.id}/resolution/revise" class="stack">
${b.lines.filter((x: any) => x.shortfall > 0).map((x: any) => html`<div class="field"><label for="c-${x.line_id}">Line ${x.line_no} shortfall</label><select id="c-${x.line_id}" name="choice_${x.line_id}"><option value="replace" ${x.remedy === "replace" ? "selected" : ""}>Replace it</option><option value="credit" ${x.remedy === "credit" ? "selected" : ""}>Credit only (do not replace)</option></select></div>`)}
<div class="field"><label for="nb">Replacement needed by (UTC)</label><input id="nb" type="text" name="needed_by" value="${String(b.needed_by).slice(0, 16)}" pattern="\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}"></div>
${b.plan.alternatives.length > 1 ? html`<fieldset class="plans"><legend>Replacement plan</legend>${b.plan.alternatives.map((p: any, i: number) => html`<label class="option choice"><input type="radio" name="plan_index" value="${i}" ${i === b.plan.chosen_index ? "checked" : ""}> ${p.picks.length ? p.picks.map((x: any) => `${x.packs} × ${x.sku}`).join(" + ") : "No replacement (credit)"} · ${fmt(p.cost_cents)}${p.unfilled_units ? ` · ${p.unfilled_units} units unfilled` : ""}</label>`)}</fieldset>` : ""}
<button class="btn" type="submit">Update proposal</button></form></details>` : ""}
</section>`;
}

export async function docsCard(q: Queryable, po: PO): Promise<Raw> {
  const docs = await docsOf(q, po.id);
  if (!docs.length) return html``;
  return html`<section class="card" aria-labelledby="docs-h"><h2 id="docs-h">Documents and evidence</h2>
<div class="table-wrap"><table><thead><tr><th>Kind</th><th>File</th><th>By</th><th>sha256</th><th></th></tr></thead><tbody>
${docs.map((d) => html`<tr><td>${d.kind.replace("_", " ")}</td><td><a href="/doc/${d.id}">${d.filename}</a> <span class="muted small">${Math.ceil(d.size / 1024)} KB</span></td><td class="small">${d.uploaded_by}</td><td class="hash">${d.sha256.slice(0, 16)}…</td><td>${d.flags.length ? html`<span class="flag bad">${d.flags.length} instruction${d.flags.length > 1 ? "s" : ""} removed</span>` : ""}</td></tr>
${d.flags.length ? html`<tr><td colspan="5"><div class="doc-flag"><b>Ignored text in ${d.filename}.</b> These lines read like instructions to an automated system. They were removed before extraction and have no effect on counts, payee or amounts:${d.flags.map((f: any) => html`<br><span class="flag bad">${f.kind.replace(/_/g, " ")}</span> line ${f.line}: <code>${f.text}</code>`)}</div></td></tr>` : ""}`)}
</tbody></table></div></section>`;
}

export async function paymentsCard(q: Queryable, po: PO): Promise<Raw> {
  const ops = await opsOfRoot(q, po.root_id);
  if (!ops.length) return html``;
  return html`<section class="card" aria-labelledby="pay-h"><h2 id="pay-h">PayPal operations</h2>
<p class="sub muted">Every call carries a PayPal-Request-Id; retries reuse it, so PayPal applies each operation once. Payee is never set: funds go to the merchant behind this app's credentials.</p>
<div class="table-wrap"><table><thead><tr><th>PO</th><th>Kind</th><th class="num">Amount</th><th>Status</th><th>PayPal id</th><th>Request id</th><th class="num">Tries</th></tr></thead><tbody>
${ops.map((o) => html`<tr><td>${o.po_number}</td><td>${o.kind}${o.final_capture ? " (final)" : ""}</td><td class="num">${fmt(o.amount_cents)}</td><td>${pill(o.status)}${o.paypal_status ? html` ${pill(o.paypal_status)}` : ""}${o.error ? html`<br><span class="small">${o.error}</span>` : ""}</td><td class="mono small">${o.paypal_id ?? "—"}</td><td class="mono small">${o.request_id}</td><td class="num">${o.attempts}</td></tr>`)}
</tbody></table></div></section>`;
}

export async function timeline(q: Queryable, po: PO): Promise<Raw> {
  const ev = (await q.query<any>("SELECT * FROM events WHERE root_id = $1 ORDER BY id DESC LIMIT 60", [po.root_id])).rows;
  return html`<section class="card" aria-labelledby="tl-h"><h2 id="tl-h">History</h2><ul class="timeline">${ev.map((e) => html`<li><span class="muted small">${fmtDate(e.at)}</span> ${e.summary}${e.actor !== "system" ? html` <span class="muted small">· ${e.actor}</span>` : ""}</li>`)}</ul></section>`;
}

export async function treeNav(q: Queryable, po: PO): Promise<Raw> {
  const tree = await treeOf(q, po.root_id);
  if (tree.length < 2) return html``;
  return html`<p class="small">Order tree: ${tree.map((p, i) => html`${i ? " → " : ""}<a href="/po/${p.id}" ${p.id === po.id ? 'aria-current="page"' : ""}>${p.number}</a> ${pill(p.status)}`)}</p>`;
}

/** The next action for this person, given the PO state. Server routes re-check everything. */
export async function actionsCard(q: Queryable, po: PO, me: Person): Promise<Raw> {
  const lines = await linesOf(q, po.id);
  const total = quoteTotal(lines);
  const buyer = me.org_kind === "buyer";
  const owner = buyer && me.role === "owner";
  const supplier = me.org_kind === "supplier";
  const parts: Raw[] = [];
  const s = po.status;
  if (s === "draft") parts.push(owner ? html`<form method="post" action="/po/${po.id}/submit"><button class="btn primary" type="submit">Send ${po.number} to ${po.supplier_name} for a quote</button></form>` : html`<p class="muted">Draft. The buyer has not sent it yet.</p>`);
  if (s === "submitted" || s === "quoted") {
    if (supplier)
      parts.push(html`<form method="post" action="/po/${po.id}/quote" class="stack"><p>${s === "quoted" ? `Quote v${po.quote_version} sent. You can revise it until the buyer accepts.` : "Price each line to confirm the quote."}</p>
${lines.map((l) => html`<div class="field"><label for="p-${l.id}">Line ${l.line_no} · ${l.product.sku}, ${l.qty_packs} × ${l.product.pack_label} — price per ${l.product.pack_label} ($)</label><input id="p-${l.id}" type="text" inputmode="decimal" name="price_${l.id}" value="${((l.unit_price_cents ?? l.product.price_cents) / 100).toFixed(2)}" required></div>`)}
<button class="btn primary" type="submit">${s === "quoted" ? "Send revised quote" : "Confirm quote"}</button></form>`);
    else if (s === "submitted") parts.push(html`<p class="muted">Waiting for ${po.supplier_name} to confirm the quote.</p>`);
  }
  if (s === "quoted" && buyer) {
    const org = await orgById(q, po.buyer_id);
    const over = total > po.spend_limit_cents;
    parts.push(html`<p>Quote v${po.quote_version}: <b>${fmt(total)}</b> against your ${fmt(po.spend_limit_cents)} limit.${over ? html` <span class="flag bad">over limit</span>` : ""}</p>`);
    if (owner && !org?.vault_token_id) parts.push(html`<form method="post" action="/connect-paypal"><input type="hidden" name="next" value="/po/${po.id}"><button class="btn primary" type="submit">Connect PayPal to place holds</button></form><p class="small muted">One approval on PayPal. StockSure then places holds and captures only amounts both sides agreed.</p>`);
    else if (owner) parts.push(html`<form method="post" action="/po/${po.id}/accept"><input type="hidden" name="version" value="${po.quote_version}"><button class="btn primary" type="submit" ${over ? "disabled" : ""}>Accept quote v${po.quote_version} and place a ${fmt(total)} PayPal hold</button></form><p class="small muted">A hold is an authorization: nothing is charged until the delivery is received and agreed. PayPal: ${org?.vault_payer ?? "saved"}.</p>`);
  }
  if (s === "funding") parts.push(owner ? html`<p class="banner warn">${po.exception ?? "Placing the PayPal hold…"}</p><form method="post" action="/po/${po.id}/retry-hold"><button class="btn" type="submit">Retry the hold (same request, no double hold)</button></form>` : html`<p class="muted">Placing the PayPal hold…</p>`);
  if (s === "funded") {
    if (supplier)
      parts.push(html`<form method="post" action="/po/${po.id}/dispatch" enctype="multipart/form-data" class="stack"><p>Funded: a ${fmt(total)} hold is in place. Ship the goods and attach the invoice.</p>
<div class="field"><label for="inv">Invoice (PDF, photo or text)</label><input id="inv" type="file" name="invoice" accept=".pdf,.txt,.csv,image/*"></div>
${config.demoMode ? html`<div class="field"><label for="sample">Or use a sample invoice</label><select id="sample" name="sample"><option value="">None</option><option value="inject" selected>Sample: billed in full, with hidden instructions</option><option value="clean">Sample: billed in full</option><option value="overbill">Sample: overbilled by 1 ${lines[0]?.product.pack_label ?? "case"}</option></select></div>` : ""}
<button class="btn primary" type="submit">Mark dispatched</button></form>
<details style="margin-top:10px"><summary>Ship part now, the rest later</summary><form method="post" action="/po/${po.id}/dispatch-part" class="stack"><p class="small muted">Only the accepted goods of this part are charged once its counts are agreed; the rest of the hold stays in place for the remaining delivery.</p>
${lines.map((l) => html`<div class="field"><label for="pt-${l.id}">Line ${l.line_no} · ${l.product.sku}: ${l.product.pack_label}s to ship now (of ${l.qty_packs})</label><input id="pt-${l.id}" type="number" min="0" max="${l.qty_packs}" name="part_${l.id}" value="${Math.floor(l.qty_packs / 2)}" required></div>`)}
<button class="btn" type="submit">Dispatch part 1</button></form></details>`);
    else parts.push(html`<p class="muted">Funded: ${fmt(total)} held on PayPal. Waiting for dispatch.</p>`);
  }
  if (s === "part_settling") parts.push(html`<p class="banner info">Part 1 counts are agreed. Charging its accepted goods on the hold (not the final capture). This page refreshes.</p>`);
  if (s === "part_delivered") {
    const part = (await shipmentsOf(q, po.id)).find((x) => x.kind === "part");
    const restPacks = lines.map((l) => `${l.qty_packs - (part?.packs[l.id] ?? 0)} × ${l.product.sku}`).join(", ");
    parts.push(html`<p>Part 1 received and charged ${fmt(part?.accepted_cents ?? 0)}. The rest of the hold is still in place.</p>`);
    if (supplier)
      parts.push(html`<form method="post" action="/po/${po.id}/dispatch" enctype="multipart/form-data" class="stack"><p>Ship the rest: ${restPacks}. Attach the invoice for the whole order.</p>
<div class="field"><label for="inv2">Invoice (PDF, photo or text)</label><input id="inv2" type="file" name="invoice" accept=".pdf,.txt,.csv,image/*"></div>
${config.demoMode ? html`<div class="field"><label for="sample2">Or use a sample invoice</label><select id="sample2" name="sample"><option value="">None</option><option value="clean" selected>Sample: billed in full</option><option value="inject">Sample: billed in full, with hidden instructions</option></select></div>` : ""}
<button class="btn primary" type="submit">Dispatch the rest</button></form>`);
    else parts.push(html`<p class="muted">Waiting for ${po.supplier_name} to ship the rest (${restPacks}).</p>`);
  }
  if ((s === "dispatched" || s === "in_review") && buyer) {
    const rec = await latestReceipt(q, po.id);
    const disputed = rec?.lines.some((l) => l.supplier_status === "disputed");
    const ctxMode = (await deliveryContext(q, po, lines)).mode;
    parts.push(html`<p><a class="btn primary" href="/po/${po.id}/receive">${s === "dispatched" ? (ctxMode === "part" ? "Receive part 1" : ctxMode === "rest" ? "Receive the rest" : "Receive this delivery") : disputed ? "Review the dispute and revise the receipt" : "Revise the receipt"}</a></p>${s === "in_review" ? html`<p class="muted">Waiting for ${po.supplier_name} to agree the counts.${disputed ? " A line is disputed: reply in its thread or revise." : ""}</p>` : ""}`);
  }
  if (s === "dispatched" && supplier) parts.push(html`<p class="muted">Dispatched ${fmtDate(po.dispatched_at)}. Waiting for the buyer to receive.</p>`);
  if (s === "in_review" && supplier) parts.push(html`<p>Review each line the buyer reported below: agree it or dispute it with a reason.</p>`);
  if (s === "resolving") parts.push(html`<p>Facts are agreed. Review the resolution below; both sides approve the same version.</p>`);
  if (s === "settling") parts.push(html`<p class="banner info">Settling with PayPal. This page refreshes.</p>`);
  if (s === "awaiting_replacement") {
    const kids = (await q.query<{ id: string; number: string; status: string }>("SELECT id, number, status FROM purchase_orders WHERE parent_id = $1", [po.id])).rows;
    parts.push(html`<p>Settled. Waiting for replacement ${kids.map((k) => html`<a href="/po/${k.id}">${k.number}</a> ${pill(k.status)}`)}.</p>`);
  }
  if (s === "exception") parts.push(html`<p class="banner bad">${po.exception ?? "Needs attention."}</p>${owner || supplier ? html`<form method="post" action="/po/${po.id}/retry-settle"><button class="btn" type="submit">Retry settlement (completed steps are not repeated)</button></form>` : ""}${owner && /replacement no longer works/.test(po.exception ?? "") ? html`<form method="post" action="/po/${po.id}/resolution/revise" style="margin-top:8px"><button class="btn primary" type="submit">Agree a new replacement (re-plans with today's stock and prices)</button></form><p class="small muted">The accepted goods stay charged; nothing is captured twice.</p>` : ""}`);
  if (s === "closed") parts.push(html`<p>Closed ${fmtDate(po.closed_at)}.</p><p class="actions"><a class="btn" href="/po/${po.root_id}/record.csv">Export record (CSV)</a><a class="btn" href="/po/${po.root_id}/record.json">Full audit (JSON)</a>${owner && po.kind === "original" ? html`<form method="post" action="/po/${po.id}/reorder" class="inline"><button class="btn" type="submit">Repeat this order</button></form>` : ""}</p>`);
  return html`<section class="card" aria-labelledby="next-h"><h2 id="next-h">Next step</h2>${parts}</section>`;
}

export async function receiveView(q: Queryable, po: PO): Promise<{ table: Raw; extractions: Raw }> {
  const lines = await linesOf(q, po.id);
  const prop = await proposalFor(q, po);
  const prev = await latestReceipt(q, po.id);
  const prevBy = new Map((prev?.lines ?? []).map((l) => [l.po_line_id, l]));
  const exs = (await q.query<any>("SELECT e.*, d.filename, d.kind FROM extractions e JOIN documents d ON d.id = e.document_id WHERE d.po_id = $1 AND d.kind IN ('delivery_note','photo') ORDER BY e.created_at DESC", [po.id])).rows.map((e) => ({ ...e, lines: typeof e.lines === "string" ? JSON.parse(e.lines) : e.lines, flags: typeof e.flags === "string" ? JSON.parse(e.flags) : e.flags }));
  const ctx = await deliveryContext(q, po, lines);
  // After a charged part the stored receipt is cumulative; people see and enter this delivery only.
  const partVersion = ctx.part?.receipt_version ?? null;
  if (ctx.mode === "rest") {
    if (!prev || prev.receipt.version === partVersion) prevBy.clear();
    else for (const [k, o] of prevBy) {
      const b = ctx.base.get(k);
      if (b) prevBy.set(k, { ...o, delivered_units: o.delivered_units - b.delivered, damaged_units: o.damaged_units - b.damaged, wrong_units: o.wrong_units - b.wrong, accepted_units: o.accepted_units - b.accepted });
    }
  }
  const val = (n: number | null | undefined, l: PoLine) => (n === null || n === undefined ? "" : formatUnits(n, l.product).replace(/ cases?$/, " cs").replace(/ \+ /g, " + "));
  const intro = ctx.mode === "part" ? html`<p class="banner info">This is <b>part 1</b> of a delivery in two parts. Count only what arrived; it is compared with what was shipped in this part.</p>` : ctx.mode === "rest" ? html`<p class="banner info">This is <b>the rest</b> of the order. Part 1 was already received and charged; count only what arrived in this delivery. StockSure adds part 1 to it.</p>` : html``;
  const table = html`${intro}<div class="table-wrap counts"><table><thead><tr><th>Line</th><th>${ctx.mode === "whole" ? "Ordered" : "In this delivery"}</th><th>AI proposal (unverified)</th><th>Delivered</th><th>Damaged</th><th>Wrong item</th><th>Note</th></tr></thead><tbody>
${lines.map((l) => {
  const p = prop.lines.get(l.id)!;
  const o = prevBy.get(l.id);
  const unsure = p.flags.length > 0;
  const d = o ? o.delivered_units : p.delivered;
  const dm = o ? o.damaged_units : p.damaged;
  const w = o ? o.wrong_units : p.wrong;
  return html`<tr><td><b>${l.product.sku}</b><br><span class="small">${l.product.name}</span></td><td>${units(ctx.expected.get(l.id) ?? l.qty_packs * l.product.pack_units, l)}${ctx.mode === "rest" && ctx.base.get(l.id) ? html`<br><span class="small muted">part 1: ${units(ctx.base.get(l.id)!.accepted, l)} accepted</span>` : ""}</td>
<td class="small">${p.delivered === null ? html`<span class="muted">No proposal</span>` : html`delivered ${units(p.delivered, l)}${p.damaged ? html`, damaged ${units(p.damaged, l)}` : ""}${p.confidence !== null ? html` · ${Math.round(p.confidence * 100)}%` : ""}`}<br>${p.flags.map(flagChip)}${p.hints.length ? html`<br>${p.hints.map((h) => html`<span class="muted">${h}</span><br>`)}` : ""}${o?.supplier_status === "disputed" ? html`<br><span class="flag bad">disputed</span> ${o.supplier_note}` : ""}</td>
<td><label class="sr" for="d-${l.id}">Delivered</label><input id="d-${l.id}" type="text" name="delivered_${l.id}" value="${val(d, l)}" class="${unsure ? "uncertain" : ""}" required placeholder="e.g. 20 cs"></td>
<td><label class="sr" for="g-${l.id}">Damaged</label><input id="g-${l.id}" type="text" name="damaged_${l.id}" value="${dm ? val(dm, l) : "0"}" class="${p.flags.includes("possible_damage") ? "uncertain" : ""}"></td>
<td><label class="sr" for="w-${l.id}">Wrong item</label><input id="w-${l.id}" type="text" name="wrong_${l.id}" value="${w ? val(w, l) : "0"}"></td>
<td><label class="sr" for="n-${l.id}">Note</label><input id="n-${l.id}" type="text" name="note_${l.id}" value="${o?.note ?? ""}" maxlength="500"></td></tr>`;
})}
</tbody></table></div>`;
  const extractions = html`${exs.map((e) => html`<div class="card"><h3>${e.filename} <span class="muted small">· ${e.kind.replace("_", " ")} · read by ${e.source}</span></h3>
${e.flags.length ? html`<div class="doc-flag"><b>${e.flags.length} instruction-like line(s) ignored:</b>${e.flags.map((f: any) => html`<br><code>${f.text}</code>`)}</div>` : ""}
${(e.lines.lines ?? []).length ? html`<ul>${e.lines.lines.map((x: any) => html`<li>${x.sku ?? ""} ${x.description}: “${x.qty_text}” → ${x.units ?? "?"} units · ${Math.round(x.confidence * 100)}% ${x.flags.map(flagChip)}${x.notes.length ? html` <span class="muted small">${x.notes.join("; ")}</span>` : ""}</li>`)}</ul>` : ""}
${(e.lines.damage ?? []).length ? html`<p class="small">${e.lines.damage.map((d: any) => html`<span class="flag bad">${d.source === "photo" ? "photo" : "note"}: ${d.kind}</span> ${d.text}<br>`)}</p>` : ""}
${(e.lines.notes ?? []).map((n: string) => html`<p class="small muted">${n}</p>`)}
</div>`)}`;
  return { table, extractions };
}

/** After delivery: late-defect claims against accepted stock, refunded on the original PayPal capture. */
export async function defectsCard(q: Queryable, po: PO, me: Person): Promise<Raw> {
  const cap = (await q.query<any>("SELECT paypal_id FROM payment_ops WHERE po_id = $1 AND kind = 'capture' AND status = 'succeeded' LIMIT 1", [po.id])).rows[0];
  const claims = await claimsOf(q, po.id);
  if (!cap && !claims.length) return raw("");
  const lines = await linesOf(q, po.id);
  const buyer = me.org_kind === "buyer";
  return html`<section class="card" aria-labelledby="defects-h"><h2 id="defects-h">After delivery</h2>
<p class="small muted">Stock that spoils or turns out damaged after it was accepted. The signed receipt is not changed; an agreed claim is refunded on the original PayPal payment.</p>
${claims.length ? html`<div class="table-wrap"><table><thead><tr><th>Line</th><th class="num">Units</th><th class="num">Refund</th><th>What happened</th><th>Status</th><th></th></tr></thead><tbody>${claims.map((c) => html`<tr><td>${c.line_no} · ${c.sku}</td><td class="num">${c.units}</td><td class="num">${fmt(c.amount_cents)}</td><td class="small">${c.note}${c.decision_note ? html`<br><span class="muted">Supplier: ${c.decision_note}</span>` : ""}</td><td>${pill(c.status)}</td><td>${!buyer && c.status === "reported" ? html`<form method="post" action="/po/${po.id}/defects/${c.id}" class="row"><input name="note" placeholder="Note" aria-label="Note" maxlength="300"><button class="btn primary small" name="agree" value="1" type="submit">Agree, refund</button><button class="btn danger small" name="agree" value="0" type="submit">Dispute</button></form>` : ""}</td></tr>`)}</tbody></table></div>` : ""}
${buyer && cap ? html`<form method="post" action="/po/${po.id}/defects" class="row" style="margin-top:10px"><label for="dl">Line</label><select id="dl" name="line_id">${lines.map((l) => html`<option value="${l.id}">${l.line_no} · ${l.product.sku}</option>`)}</select><label for="du">Units</label><input id="du" type="number" name="units" min="1" required style="width:6rem"><label class="sr" for="dn">What happened</label><input id="dn" name="note" required placeholder="e.g. spoiled two days before its date" maxlength="500"><button class="btn small" type="submit">Report a defect</button></form>` : ""}
</section>`;
}

/** Delivery estimates and the early-warning card. Recording an ETA is the supplier's; deciding is the owner's. */
export async function supplyCard(q: Queryable, po: PO, me: Person): Promise<Raw> {
  const updates = await etaUpdates(q, po.id);
  const view = await riskView(q, po);
  const watched = ["funded", "dispatched"].includes(po.status);
  if (!updates.length && !watched) return raw("");
  const supplier = me.org_kind === "supplier";
  const owner = me.org_kind === "buyer" && me.role === "owner";
  const r = view?.risk;
  const late = r && r.status !== "closed";
  const h = (m: number) => `${Math.round(Math.abs(m) / 60)}h`;
  return html`<section class="card" aria-labelledby="eta-h"><h2 id="eta-h">Delivery estimate</h2>
${late ? html`<div class="banner bad"><b>Early warning:</b> latest ETA ${fmtDate(r.eta)} is ${h(r.slack_minutes)} after deliver-by ${fmtDate(r.deliver_by)}.${r.status === "waiting" ? ` ${r.decided_by} chose to wait.` : r.status === "expedite_asked" ? ` ${r.decided_by} asked the supplier to expedite.` : ""}</div>
<div class="table-wrap"><table><thead><tr><th>Line</th><th>Ordered</th><th>On hand now</th><th>Other connected suppliers in stock</th></tr></thead><tbody>${view!.onHand.map((x) => html`<tr><td>${x.line.line_no} · ${x.line.product.sku}</td><td>${x.ordered}</td><td>${x.on_hand}</td><td class="small">${x.alternatives.length ? x.alternatives.map((a: any) => `${a.supplier}: ${a.sku} (${a.stock_packs} packs, ${a.lead_hours}h lead)`).join("; ") : "None connected. Ordering elsewhere is outside StockSure."}</td></tr>`)}</tbody></table></div>
<p class="small"><b>Evidence:</b> ${view!.evidence.map((e: any) => `${e.source} ${e.ref} (observed ${fmtDate(e.observed_at)}, ETA ${fmtDate(e.eta)})`).join(" → ")}</p>
<p class="small muted"><b>Not known:</b> ${view!.unknowns.join(" ")}</p>
${owner && r.status === "open" ? html`<form method="post" action="/po/${po.id}/risk" class="row"><label class="sr" for="rn">Note</label><input id="rn" name="note" maxlength="300" placeholder="Note (optional)"><button class="btn small" name="choice" value="wait" type="submit">Wait for it</button><button class="btn primary small" name="choice" value="expedite" type="submit">Ask the supplier to expedite</button></form><p class="small muted">Neither choice creates a payment, a hold or another order.</p>` : ""}` : r ? html`<p class="small">${r.closed_reason ?? "Closed"}.</p>` : ""}
${updates.length ? html`<div class="table-wrap"><table><thead><tr><th>Source</th><th>Reference</th><th>Observed</th><th>ETA</th><th>Applied</th></tr></thead><tbody>${updates.map((u: any) => html`<tr><td>${u.source}</td><td class="small mono">${u.ref}</td><td>${fmtDate(u.observed_at)}</td><td>${fmtDate(u.eta)}</td><td class="small">${u.applied ? "yes" : html`no: ${u.ignored_reason}`}</td></tr>`)}</tbody></table></div>` : html`<p class="small muted">No estimate recorded; expected by ${fmtDate(po.deliver_by)}.</p>`}
${supplier && watched ? html`<form method="post" action="/po/${po.id}/eta" class="row" style="margin-top:10px"><label for="ee">New ETA (UTC)</label><input id="ee" type="datetime-local" name="eta" required><label for="eo">Observed (UTC)</label><input id="eo" type="datetime-local" name="observed_at" required><label for="es">Source</label><select id="es" name="source"><option value="supplier">Our estimate</option><option value="carrier">Carrier event</option></select><label for="er">Reference</label><input id="er" name="ref" placeholder="e.g. tracking event id" maxlength="80"><button class="btn small" type="submit">Record ETA</button></form>` : ""}
</section>`;
}

/** S4/S5/B.2: the signed agreement, negotiations and traced agent runs on this order. */
export async function agentCard(q: Queryable, po: PO, me: Person): Promise<Raw> {
  const [agreement, negs, runs] = await Promise.all([agreementFor(po.id, q), negotiationsFor(po.id), runsFor("po", po.id, 8)]);
  if (!agreement && !negs.length && !runs.length && !(me.org_kind === "buyer" && me.role === "owner" && ["submitted", "quoted"].includes(po.status))) return raw("");
  const v = agreement ? verifyAgreement(agreement) : null;
  return html`<section class="card"><h2>Agents, agreement and trace</h2>
${agreement ? html`<p>Agreement on quote v${agreement.quote_version}: <span class="mono small">${agreement.hash.slice(0, 16)}…</span> ${v?.hash_ok && v?.hmac_ok ? pill("confirmed") : pill("failed")} · buyer signed ${agreement.buyer_signed_at ? fmtDate(agreement.buyer_signed_at) : "—"}${agreement.buyer_signed_by ? ` (${agreement.buyer_signed_by})` : ""} · supplier countersigned ${agreement.supplier_signed_at ? fmtDate(agreement.supplier_signed_at) : "not yet (at dispatch)"}</p><p class="small muted">The hash covers the lines, quantities, prices, deadline and total. Dispatch refuses if anything changed since the buyer signed.</p>` : ""}
${negs.length ? html`<ul class="small">${negs.map((n: any) => html`<li><a href="/negotiations/${n.id}">Negotiation</a> ${pill(n.status)} · round ${n.round}/${n.max_rounds} · ${n.buyer_agent} vs ${n.supplier_agent}</li>`)}</ul>` : ""}
${me.org_kind === "buyer" && me.role === "owner" && ["submitted", "quoted"].includes(po.status) && !negs.some((n: any) => n.status === "open") ? html`<form method="post" action="/negotiations/start" class="row"><input type="hidden" name="po" value="${po.id}"><button class="btn small">Let the agents negotiate the price</button><span class="small muted">Under your mandate and the supplier's floor; you still accept unless the mandate lets agents accept.</span></form>` : ""}
${runs.length ? html`<details><summary class="small">Agent runs (${runs.length})</summary><ul class="small">${runs.map((x: any) => html`<li><a href="/trace/${x.id}">${x.subject}</a> · ${x.actor}${x.agent_id ? html` <span class="mono">${x.agent_id}</span>` : ""} · ${pill(x.status)} · ${fmtDate(x.started_at)}</li>`)}</ul></details>` : ""}
</section>`;
}
