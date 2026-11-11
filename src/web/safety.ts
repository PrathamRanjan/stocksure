/**
 * Scam and fraud protection for the buyer owner (SAFETY_ACCESSIBILITY_SPEC §4, §6 StockSure row): check a supplier
 * email or invoice text (rules on the server, the fine-tuned text model in this browser), see the supplier messages on
 * open orders with their scan, see the holds the safety layer created and why, and switch protected mode on so every
 * capture and refund waits for the owner.
 */
import { TEN_NOV } from "../eval/scam-cases.js";
import { Router, type Request, type Response } from "express";
import { getDb } from "../db.js";
import { GtError } from "../lib/util.js";
import { assessMessage, protectedMode, safetyHolds, setProtectedMode } from "../safety/index.js";
import { checkMessage, type MessageCheck } from "../safety/check.js";
import { tick } from "../demo/checklist.js";
import { scanText, TACTIC_WORDS, TACTICS } from "../safety/rules.js";
import type { Person } from "../store.js";
import { me, whoOf } from "./auth.js";
import { back, flashOf, json, page } from "./common.js";
import { fmtDate, html, jsonBlock, layout, pill, raw } from "./html.js";

/** The message the demo button pastes: a supplier "we changed our bank details" email before settlement. */
export const DEMO_SUPPLIER_CHANGE = "Dear Jordan, please note our banking details have changed with immediate effect. Kindly settle invoice INV-2291 to the new account (BSB 062-000, acct 1182 7731) by bank transfer today rather than PayPal, as our PayPal is under review. Treat this as confidential until the changeover is complete. Regards, Accounts, Harbour Fresh Produce";

async function needOwner(req: Request, res: Response): Promise<Person | null> {
  const p = await me(req);
  if (!p) {
    res.redirect(`/login?next=${encodeURIComponent(req.originalUrl.slice(0, 200))}`);
    return null;
  }
  if (p.org_kind !== "buyer" || p.role !== "owner") throw new GtError("Scam and fraud protection is the buyer owner's page.", "forbidden", 403);
  return p;
}

/** Each scan makes one model call: 20 a minute per address keeps a pasted loop from spending the key (spec C3). */
const SCANS = new Map<string, number[]>();
function limitScans(ip: string) {
  const now = Date.now();
  const hits = (SCANS.get(ip) ?? []).filter((t) => now - t < 60_000);
  if (hits.length >= 20) throw new GtError("That's a lot of checks in a minute. Wait a moment and try again.", "rate_limited", 429);
  hits.push(now);
  SCANS.set(ip, hits);
}

export function safetyRouter() {
  const r = Router();

  r.get("/safety", page(async (req, res) => {
    const p = await needOwner(req, res);
    if (!p) return;
    const db = await getDb();
    const msgs = (await db.query<any>("SELECT m.*, po.number FROM messages m JOIN purchase_orders po ON po.id = m.po_id WHERE po.buyer_id = $1 AND m.author_role = 'supplier' ORDER BY m.created_at DESC LIMIT 20", [p.org_id])).rows;
    const holds = await safetyHolds(p.org_id, db);
    const prot = await protectedMode(p.org_id, db);
    res.send(layout({ title: "Scam and fraud protection", who: whoOf(p), flash: flashOf(req), scripts: raw(`<script src="https://cdnjs.cloudflare.com/ajax/libs/onnxruntime-web/1.22.0/ort.min.js"></script><script type="module" src="/static/safety.js"></script>`) }, html`<h1>Scam and fraud protection</h1>
<p class="muted">Rules in code, a scam text model that runs in your browser, and a payment-risk model. Strictest wins; none of them can approve a payment. Anything held waits for you on <a href="/guard">Guard</a>. <a href="/safety/model-card">How it was tested</a>.</p>
<div class="grid2">
<div class="card" id="how"><h3>What is checked before money moves</h3><ul>
<li><b>No payee, ever.</b> StockSure's PayPal calls never take a payee: settlement goes to the account PayPal already knows for the order. A message or invoice cannot redirect it.</li>
<li><b>Supplier messages on the order.</b> A message that announces new bank or PayPal details, or asks to be paid outside PayPal, holds the capture until you have read the thread.</li>
<li><b>Invoice against settlement.</b> Settlement is computed from accepted quantities at quote prices; an invoice that bills more is noted and the difference is not paid.</li>
<li><b>Documents.</b> Instruction-like lines in delivery notes and invoices are removed before reading and counted here.</li></ul></div>
<div class="card" id="protected"><h3>Protected mode ${prot.on ? pill("paid") : pill("void")}</h3><p class="small muted">Every capture and refund waits for you, holds are explained calmly with no timers, and a trusted contact is told about every hold.</p>
<form method="post" action="/safety/protected" class="stack"><label for="pc1">Trusted contact (Telegram chat id, optional)</label><input id="pc1" name="contact1" value="${prot.contacts[0] ?? ""}" placeholder="telegram:123456789"><label for="pc2">Second contact</label><input id="pc2" name="contact2" value="${prot.contacts[1] ?? ""}"><button class="btn primary" type="submit" name="on" value="${prot.on ? "0" : "1"}">${prot.on ? "Turn protected mode off" : "Turn protected mode on"}</button></form></div></div>
<div class="card" id="check"><h3>Check a message or invoice text</h3><p class="small muted">Paste a supplier email, a thread message or the text of an invoice. A small model scores it in your browser; the text is also sent to StockSure for the rules, the payment-destination check and OpenAI Decisions. Only a fingerprint of the text is logged.</p>
<form id="scan-form" class="stack"><label for="scan-text" class="sr">Text to check</label><textarea id="scan-text" name="text" rows="6" placeholder="Paste the text here" style="width:100%"></textarea>
<div class="row"><button class="btn primary" type="submit" id="scan-btn">Check this text</button><button class="btn" type="button" id="scan-demo">Paste the demo scam</button><span class="small muted" id="scan-status" aria-live="polite"></span></div></form>
<div id="scan-result" aria-live="polite"></div>${jsonBlock("demo-bec", { text: TEN_NOV })}</div>
<div class="card" id="messages"><h3>Supplier messages on your orders</h3>${msgs.length ? html`<ul class="feed">${msgs.map((m) => { const c = (typeof m.scam_check === "string" ? JSON.parse(m.scam_check) : m.scam_check) as MessageCheck | null; const s = scanText(m.body); const lv = c?.version === 2 ? c.level : s.level; const words = c?.version === 2 ? c.reasons.slice(0, 2).join(" ") : `this message ${s.words.join(", and ")} (rules only; not yet fully checked).`; return html`<li>${lv !== "clear" ? html`<div class="banner ${lv === "hold" ? "bad" : "warn"}" role="alert"><b>Scam check:</b> ${words} ${c?.advice ?? ""}</div>` : ""}<span class="small muted">${m.number} · ${m.author} · ${fmtDate(m.created_at)}</span><br>${m.body}</li>`; })}</ul>` : html`<p class="muted">No supplier messages yet.</p>`}</div>
<div class="card" id="holds"><h3>Holds the safety layer created</h3>${holds.length ? html`<ul class="feed">${holds.map((h) => html`<li><b>${h.action} $${(Number(h.payload.cents ?? 0) / 100).toFixed(2)}</b> ${pill(h.status)}${h.payload.safety_reasons?.length ? html`<details class="small"><summary>Why we paused this</summary><ul>${h.payload.safety_reasons.map((x: string) => html`<li>${x}</li>`)}</ul></details>` : ""}</li>`)}</ul>` : html`<p class="muted">None yet.</p>`}</div>
<div class="card" id="a11y"><h3>Accessibility</h3><p class="small muted">Text size, contrast, a clearer font, read-aloud, voice input, plain words, bigger buttons and more time: open <button class="btn small" type="button" data-a11y-open>Display and help</button> on any page. Choices stay on this device.</p></div>`));
  }));

  r.get("/safety/model-card", page(async (req, res) => {
    const p = await needOwner(req, res);
    if (!p) return;
    res.send(layout({ title: "How the scam check was tested", who: whoOf(p), flash: flashOf(req) }, html`<h1>How the scam check was tested</h1>
<p class="muted">Numbers come from frozen test sets the model never trained on. Everything synthetic is marked. Full card in the repository at <span class="mono">guard-lab/MODEL_CARD.md</span>.</p>
<div class="card"><h3>Text model (runs in your browser, 23 MB)</h3><table><thead><tr><th>Test set</th><th>Messages</th><th>AUC</th><th>Caught at 1% genuine held</th><th>What it is</th></tr></thead><tbody>
<tr><td>ScamShield SMS test</td><td>8,188</td><td>0.988</td><td>75%</td><td>real Singapore SMS, in-distribution</td></tr>
<tr><td>ScamShield eval sets</td><td>1,574</td><td>0.979</td><td>67%</td><td>real and hand-written</td></tr>
<tr><td>Singlish genuine</td><td>600</td><td>—</td><td>1.0% held</td><td>real everyday messages: the false-alarm check</td></tr>
<tr><td>Business templates</td><td>200</td><td>0.85</td><td>11%</td><td>author-written, held-out templates</td></tr>
<tr><td>Business email (BEC) seed</td><td>200</td><td>0.58</td><td>25%</td><td>hand-written; the model is weak here, which is why changed bank details are also a rule</td></tr>
</tbody></table><p class="small muted">Browser and Python agree on the hold decision for 197 of 200 messages; the three differ because int8 arithmetic differs between runtimes.</p></div>
<div class="card"><h3>Payment-risk model</h3><p>LightGBM, 300 trees, monotone: a scam signal can only raise the score. <b>Trained on synthetic data</b>; there is no real payment-fraud data in this project. Its score is a ranking signal shown with the rule reasons, never a fraud rate.</p></div>
<div class="card"><h3>Tactics the model names</h3><ul>${TACTICS.map((t) => html`<li><b>${t.replace(/_/g, " ")}</b>: ${TACTIC_WORDS[t]}</li>`)}</ul></div>`));
  }));

  // Spec A6.1: rules, Decisions and the destination check on the server; the page adds the on-device model.
  r.post("/safety/scan", json(async (req) => {
    const text = String(req.body?.text ?? "").slice(0, 4000);
    if (!text.trim()) throw new GtError("Paste a message first.", "bad_request", 400);
    limitScans(req.ip ?? "anon");
    const db = await getDb();
    const contact = (await db.query<{ contact_email: string | null }>("SELECT contact_email FROM orgs WHERE kind = 'supplier' AND contact_email IS NOT NULL ORDER BY created_at LIMIT 1")).rows[0]?.contact_email ?? null;
    const c = await checkMessage(text, { contactEmail: contact });
    if (c.level === "hold") await tick(db, "scam_checked");
    const legacy = assessMessage(text);
    return { ...c, risk: legacy.risk, tactics: legacy.tactics, contact_on_file: contact };
  }));

  r.post("/safety/protected", page(async (req, res) => {
    const p = await needOwner(req, res);
    if (!p) return;
    const on = String(req.body.on) === "1";
    await setProtectedMode(p.org_id, on, [String(req.body.contact1 ?? "").trim(), String(req.body.contact2 ?? "").trim()]);
    back(res, "/safety#protected", on ? "Protected mode is on." : "Protected mode is off.");
  }));

  return r;
}
