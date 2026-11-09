/** The public front door: what StockSure does when a delivery goes wrong, how payments stay safe, and a persona picker. */
import type { Request, Response } from "express";
import { config } from "../config.js";
import { getDb } from "../db.js";
import { flashOf } from "./common.js";
import { html, layout, raw } from "./html.js";
import { icon } from "./icons.js";

const ic = (n: string) => raw(icon(n));
const BLURB: Record<string, string> = {
  Jordan: "Order stock for the café inside a spending limit, see what actually arrived, and approve the corrected PayPal charge.",
  Sam: "Count the delivery at the back door: upload the delivery note and photos, confirm what's short or damaged. No access to money.",
  Ana: "The wholesaler's side: confirm quotes, agree or dispute each line the café reports, and offer a replacement.",
  Priya: "A second café on the same supplier, with its own orders, limits and PayPal.",
};

export async function landing(req: Request, res: Response, signedIn: boolean) {
  const db = await getDb();
  const people = config.demoMode ? (await db.query<any>("SELECT p.id, p.name, p.role, o.name AS org, o.kind FROM people p JOIN orgs o ON o.id = p.org_id ORDER BY CASE split_part(p.name, ' ', 1) WHEN 'Jordan' THEN 0 WHEN 'Sam' THEN 1 WHEN 'Ana' THEN 2 ELSE 3 END").catch(() => ({ rows: [] as any[] }))).rows.filter((p) => BLURB[p.name.split(" ")[0]]) : [];
  const jordan = people.find((p) => p.name.startsWith("Jordan"));
  const as = (p: any, cls: string, label: string) => html`<form method="post" action="/login"><input type="hidden" name="person_id" value="${p.id}"><input type="hidden" name="next" value="/home"><button class="btn ${cls}" type="submit">${label} ${ic("arrowRight")}</button></form>`;
  res.send(layout({ title: "receive it, resolve it, pay correctly", site: true, flash: flashOf(req) }, html`
<section class="lp-hero"><div class="wrap lp-split">
  <div>
    <span class="lp-eyebrow"><b>Wholesale deliveries</b> for cafés, shops and kitchens</span>
    <h1 class="lp-title">Pay for what <em>actually arrived</em>.</h1>
    <p class="lp-lead">When a delivery turns up short, damaged or mis-billed, StockSure gets both sides to agree what came off the truck, charges exactly that through PayPal, and gets a replacement moving within your limit.</p>
    <div class="lp-cta">${signedIn ? html`<a class="btn primary lg" href="/home">Open your orders ${ic("arrowRight")}</a>` : jordan ? as(jordan, "primary lg", "Try it as Jordan, the café owner") : html`<a class="btn primary lg" href="/demo">Load the demo</a>`}<a class="btn lg" href="#how">How it works</a></div>
    <div class="lp-trust" style="margin-top:1.5rem"><span>${ic("checkCircle")}PayPal sandbox, no real money</span><span>${ic("checkCircle")}A hold at order, a charge only for what arrived</span><span>${ic("checkCircle")}Both sides sign off</span></div>
  </div>
  <div class="mock" aria-hidden="true"><div class="mock-bar"><i></i><i></i><i></i><span>PO-1042 · Laneway Café ← Harbour Wholesale</span></div><div class="mock-body">
    <div class="hazard-strip"></div>
    <div class="mock-row"><span>Oat milk 1L × 12 · <b>ordered 6, arrived 4</b></span><span class="pill warn">2 short</span></div>
    <div class="mock-row"><span>Espresso beans 1kg · <b>1 bag split</b></span><span class="pill bad">damaged</span></div>
    <div class="mock-row"><span>Charge agreed by both sides</span><span class="amt">$214.60 of $268.00</span></div>
    <div class="guard-card hold" style="margin:0"><div class="gc-head">${ic("shieldAlert")}Capture paused</div><p class="gc-do" style="color:inherit">An email asked to pay this invoice to a new bank account. Only the agreed PayPal capture can move money.</p></div>
  </div></div>
</div></section>

<section class="lp-section alt" id="how"><div class="wrap">
  <p class="lp-kicker">How it works</p><h2 class="lp-h2">One order, one record, from the quote to the last replacement.</h2>
  <p class="lp-sub">No more arguing over a photo in a group chat. The buyer and the supplier work on the same order.</p>
  <ol class="lp-steps">
    <li><h3>Agree and hold</h3><p>The café sets quantities, acceptable substitutes and a spending limit. Accepting the quote places a PayPal hold, not a charge.</p></li>
    <li><h3>Count it in</h3><p>Receiving uploads the delivery note and photos. AI proposes counts and flags anything unclear; a person confirms.</p></li>
    <li><h3>Agree the facts</h3><p>The supplier agrees or disputes each line. Price always comes from the quote, never from document text.</p></li>
    <li><h3>Pay correctly, keep trading</h3><p>PayPal captures only what was agreed, and a compatible replacement is ordered within the limit.</p></li>
  </ol>
</div></section>

<section class="lp-section"><div class="wrap">
  <p class="lp-kicker">What's inside</p><h2 class="lp-h2">Built for the back door at 6 a.m.</h2>
  <div class="lp-features" style="margin-top:1.5rem">
    <div class="lp-feature"><span class="ic">${ic("camera")}</span><h3>Photo and note reading</h3><p>Snap the delivery note and the damage; StockSure reads them and proposes the counts.</p></div>
    <div class="lp-feature"><span class="ic">${ic("wallet")}</span><h3>Hold, then capture</h3><p>Money is held at order and captured only for what both sides agree arrived.</p></div>
    <div class="lp-feature"><span class="ic">${ic("repeat")}</span><h3>Replacements that fit</h3><p>Substitutes you pre-approved, within your budget, ordered in one step.</p></div>
    <div class="lp-feature"><span class="ic">${ic("bot")}</span><h3>Agents can deal</h3><p>A buyer's agent and a supplier's agent negotiate a fix inside limits each owner set.</p></div>
    <div class="lp-feature"><span class="ic">${ic("chart")}</span><h3>Supplier scorecard</h3><p>On-time and in-full rates, disputes and credits, from the shared record.</p></div>
    <div class="lp-feature"><span class="ic">${ic("file")}</span><h3>Evidence kept</h3><p>Every count, photo, message and PayPal id on one timeline, ready for a dispute.</p></div>
  </div>
</div></section>

<section class="lp-section alt" id="safety"><div class="wrap lp-split">
  <div><p class="lp-kicker">Scam protection</p><h2 class="lp-h2">Invoice fraud starts with “we've changed our bank details”.</h2>
  <p class="lp-sub">Fake supplier emails are the most common way small food businesses lose money. StockSure checks every capture as you approve it, and names the tactic on the message itself.</p>
  <ul class="stack" style="padding-left:1.1rem;color:var(--ui-muted-fg)"><li>A supplier message with new bank details or an off-platform payment request pauses the capture.</li><li>An invoice above what was agreed is flagged, line by line.</li><li>Money only moves through the PayPal hold on the order.</li></ul></div>
  <div class="stack"><div class="guard-card hold"><div class="gc-head">${ic("shieldAlert")}Paused for your safety</div><ul><li>A message asks you to pay to a new bank account.</li><li>It says the payment is urgent.</li></ul><p class="gc-do">Call Harbour Wholesale on a number you already have. If it's genuine, approve below.</p><div class="row"><span class="btn small primary">Approve capture</span><span class="btn small">Cancel it</span></div></div>
  <div class="guard-card clear"><div class="gc-head">${ic("shieldCheck")}Checked: matches the agreement</div><p class="gc-do">$214.60 for what both sides confirmed arrived.</p></div></div>
</div></section>

<section class="lp-section" id="access"><div class="wrap">
  <p class="lp-kicker">For everyone</p><h2 class="lp-h2">Make it comfortable before you start.</h2>
  <p class="lp-sub">These choices stay on this device and apply to every page. Change them any time from <b>Display</b> at the top.</p>
  <div class="a11y-quick"><button class="btn" type="button" data-q="textScale:1.5">${ic("type")}Bigger text</button><button class="btn" type="button" data-q="contrast:high">${ic("eye")}High contrast</button><button class="btn" type="button" data-q="font:hyperlegible">Easier-to-read font</button><button class="btn" type="button" data-q="readAloud:true">${ic("volume")}Read pages aloud</button><button class="btn" type="button" data-q="simpleWords:true">Plain words</button><button class="btn" type="button" data-q="bigTargets:true">Bigger buttons</button><button class="btn" type="button" data-q="extraTime:true">${ic("clock")}More time</button></div>
</div></section>

<section class="lp-section alt" id="try"><div class="wrap">
  <p class="lp-kicker">Try it</p><h2 class="lp-h2">Pick who you want to be.</h2>
  <p class="lp-sub">A demo wholesaler and three cafés on the PayPal sandbox. When a PayPal page opens, sign in with the sandbox buyer account.</p>
  ${people.length ? html`<div class="lp-personas">${people.map((p) => html`<div class="persona-card"><div class="who"><span class="avatar">${p.name[0]}</span><span><b>${p.name}</b><span>${p.kind === "supplier" ? "Supplier" : p.role === "owner" ? "Owner" : "Receiving"}, ${p.org}</span></span></div><p>${BLURB[p.name.split(" ")[0]]}</p>${as(p, p.name.startsWith("Jordan") ? "primary" : "", `Continue as ${p.name.split(" ")[0]}`)}</div>`)}</div>` : html`<div class="card"><p>The demo isn't loaded yet.</p><a class="btn primary" href="/demo">Load the demo</a></div>`}
</div></section>`));
}
