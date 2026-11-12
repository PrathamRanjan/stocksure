import { nextOf } from "./safetyui.js";
/**
 * Buyer owner's guard console (roadmap B.6, S3): mandate in plain words -> compiled rules, backtest over the
 * buyer's own orders, earned autonomy, kill switch (organisation and per agent), approvals with passkey
 * countersign, hash-chained audit, recent agent runs. "The agent proposes, code decides, the owner can always stop it."
 */
import { Router, type Request, type Response } from "express";
import { config } from "../config.js";
import { getDb } from "../db.js";
import { fmt } from "../core/money.js";
import { enqueue } from "../jobs.js";
import { GtError } from "../lib/util.js";
import { recentAudit, verifyChain } from "../guard/audit.js";
import { applySuggestions, backtest, suggestAutonomy } from "../guard/backtest.js";
import { countersignThreshold, decideApproval, payloadHash, pendingApprovals } from "../guard/dryrun.js";
import { isKilled, listKills, setKill } from "../guard/kill.js";
import { finishRegistration, hasPasskey, newChallenge, PASSKEY_JS, verifyAssertion } from "../guard/passkey.js";
import { activePolicy, compilePolicy, DEFAULT_RULES, RulesSchema, savePolicy, type Rules } from "../guard/policy.js";
import { recentRuns, runsFor } from "../trace.js";
import type { Person } from "../store.js";
import { me, whoOf } from "./auth.js";
import { back, flashOf, json, page } from "./common.js";
import { fmtDate, html, layout, raw } from "./html.js";

/** The guard belongs to the buyer organisation's owner. Suppliers see their own, smaller controls on /disputes. */
async function needOwner(req: Request, res: Response): Promise<Person | null> {
  const p = await me(req);
  if (!p) {
    res.redirect(`/login?next=${encodeURIComponent(req.originalUrl.slice(0, 200))}`);
    return null;
  }
  if (p.org_kind !== "buyer" || p.role !== "owner") throw new GtError("The guard console is the buyer owner's.", "forbidden", 403);
  return p;
}
async function ownerJson(req: Request): Promise<Person> {
  const p = await me(req);
  if (!p) throw new GtError("Sign in", "unauthorized", 401);
  if (p.org_kind !== "buyer" || p.role !== "owner") throw new GtError("Owner only", "forbidden", 403);
  return p;
}

const RULE_LABELS: Record<keyof Rules, string> = {
  max_order_cents: "Most per order",
  max_daily_cents: "Most per day",
  approve_above_cents: "Ask me before charging or refunding more than",
  agents_may_order: "Agents may draft and send orders",
  agents_may_accept: "Agents may accept quotes",
  allow_substitutes: "Agents may approve listed substitutes",
  max_over_catalog_pct: "Accept quotes up to this % above catalog",
  max_concession_pct: "Concede at most this % of the gap per round",
  walk_away_pct: "Walk away above this % over catalog",
  max_rounds: "Negotiation rounds",
  allowed_suppliers: "Allowed suppliers",
  auto_reorder: "Reorder automatically when stock runs low",
  reorder_days: "Reorder when cover falls below (days)",
};

const fmtRule = (k: keyof Rules, v: unknown) => (typeof v === "boolean" ? (v ? "yes" : "no") : String(k).endsWith("_cents") ? fmt(Number(v)) : String(k).endsWith("_pct") ? `${v}%` : Array.isArray(v) ? (v.length ? v.join(", ") : "any") : String(v));

function rulesTable(rules: Rules, compare?: Rules) {
  return html`<table class="small kv"><tbody>${raw(
    (Object.keys(RULE_LABELS) as (keyof Rules)[])
      .map((k) => {
        const changed = compare && JSON.stringify(compare[k]) !== JSON.stringify(rules[k]);
        return `<tr><th>${RULE_LABELS[k]}</th><td class="${changed ? "changed" : ""}">${fmtRule(k, rules[k])}${changed ? ` <span class="muted">(was ${fmtRule(k, compare![k])})</span>` : ""}</td></tr>`;
      })
      .join(""),
  )}</tbody></table>`;
}

async function release(approvalId: string) {
  const db = await getDb();
  await enqueue(db, "release_approved", { approvalId }, new Date(), `release:${approvalId}`);
}

export function guardRouter() {
  const r = Router();

  r.get(
    "/guard",
    page(async (req, res) => {
      const p = await needOwner(req, res);
      if (!p) return;
      const db = await getDb();
      const policy = await activePolicy(p.org_id);
      const rules = policy?.rules ?? DEFAULT_RULES;
      const [approvals, kills, chain, audit, passkey, runs, drafts] = await Promise.all([
        pendingApprovals(p.org_id),
        listKills(),
        verifyChain(),
        recentAudit(40),
        hasPasskey(p.org_id),
        runsFor("po", "%", 0).catch(() => []),
        db.query<any>("SELECT * FROM policies WHERE owner_id = $1 ORDER BY created_at DESC LIMIT 8", [p.org_id]),
      ]);
      const orgRuns = (await db.query<any>("SELECT r.*, (SELECT count(*) FROM agent_trace t WHERE t.run_id = r.id) AS steps FROM agent_runs r WHERE r.entity = 'po' AND r.entity_id IN (SELECT id FROM purchase_orders WHERE buyer_id = $1) ORDER BY r.started_at DESC LIMIT 15", [p.org_id])).rows;
      void runs;
      const orgKill = await isKilled(`org:${p.org_id}`);
      const suggestions = await suggestAutonomy(p.org_id, rules);
      const bt = await backtest(p.org_id, rules, 90);
      const agentKills = kills.filter((k: any) => k.scope.startsWith("agent:"));
      res.send(
        layout(
          { title: "Spending rules", who: whoOf(p), flash: flashOf(req), scripts: raw(`<script>${PASSKEY_JS}</script><script src="/static/guard.js" defer></script>`) },
          html`
<h1>Spending rules</h1>
<p class="sub">The owner's rules for money: how much an order may cost, how much per day, and above what amount a payment waits for the owner's approval. Write them in your own words; code turns them into rules and checks every PayPal request against them. One switch stops all payments.</p>

<div class="grid g2">
<div class="card">
  <h2>Mandate</h2>
  <form method="post" action="/guard/policy">
    <div class="field"><label for="ptext">In plain words</label><textarea id="ptext" name="text" rows="5" maxlength="2000" placeholder="No more than $800 per order and $2,000 per day. Ask me before charging more than $400. Agents may order and accept quotes up to 5% above catalog. Walk away above 12%. 6 rounds. No substitutes.">${policy?.text ?? ""}</textarea></div>
    <div class="row"><button class="btn primary" name="mode" value="preview">Compile and preview</button> <button class="btn" name="mode" value="adopt">Compile and adopt</button></div>
  </form>
  ${policy ? html`<p class="small muted">Active since ${fmtDate(drafts.rows.find((d: any) => d.active)?.created_at)} · compiled by ${policy.compiler}${policy.unexpressed.length ? html` · <strong>could not express:</strong> ${policy.unexpressed.join("; ")}` : ""}</p>` : html`<p class="small muted">No mandate yet: the defaults below apply.</p>`}
  ${rulesTable(rules)}
</div>

<div class="card">
  <h2>Backtest: your last 90 days under this mandate</h2>
  <p class="small muted">Your own orders replayed through the rules. Nothing moves; this only says what would have happened.</p>
  <div class="stats"><div><b>${bt.orders}</b><span>orders</span></div><div><b>${bt.run}</b><span>would run</span></div><div><b>${bt.wait}</b><span>would wait for you</span></div><div><b>${bt.deny}</b><span>would be denied</span></div></div>
  <div class="stats"><div><b>${fmt(bt.auto_cents)}</b><span>moves without you</span></div><div><b>${fmt(bt.held_cents)}</b><span>waits for you</span></div></div>
  <form method="post" action="/guard/backtest" class="row" id="bt-form">
    <label class="small" for="bt-slider">Try an approval threshold: <output id="bt-out">${fmt(rules.approve_above_cents)}</output></label>
    <input type="range" name="approve_above_cents" min="5000" max="500000" step="5000" value="${rules.approve_above_cents}" id="bt-slider">
    <input type="hidden" name="base" value="${policy?.id ?? ""}">
    <button class="btn small">Re-run backtest</button>
  </form>
  ${bt.rows.length ? html`<details><summary class="small">Rows (${bt.rows.length})</summary><div class="table-wrap"><table class="small"><thead><tr><th>When</th><th>Order</th><th>Supplier</th><th>Total</th><th>Over catalog</th><th>Outcome</th><th>Why</th></tr></thead><tbody>${raw(bt.rows.slice(0, 60).map((x) => `<tr><td>${fmtDate(x.at, false)}</td><td class="mono">${x.number}</td><td>${x.supplier}</td><td>${fmt(x.total_cents)}</td><td>${x.over_catalog_pct}%</td><td><span class="pill ${x.outcome === "run" ? "good" : x.outcome === "wait" ? "warn" : "bad"}">${x.outcome}</span></td><td>${x.reason}</td></tr>`).join(""))}</tbody></table></div></details>` : ""}
</div>
</div>

<div class="grid g2">
<div class="card">
  <h2>Earned autonomy</h2>
  <p class="small muted">Limits your own decisions already support. We never suggest past anything you declined.</p>
  ${suggestions.length
    ? html`<form method="post" action="/guard/suggestions">${raw(suggestions.map((s, i) => `<label class="check"><input type="checkbox" name="pick" value="${i}" checked> <b>${RULE_LABELS[s.field]}</b>: ${fmtRule(s.field, s.current)} → ${fmtRule(s.field, s.suggested)}<br><span class="small muted">${s.basis}</span></label>`).join(""))}<input type="hidden" name="payload" value="${JSON.stringify(suggestions)}"><button class="btn">Adopt selected</button></form>`
    : html`<p class="muted">Nothing to suggest yet. Approve a few charges by hand and come back.</p>`}
</div>

<div class="card">
  <h2>Kill switch</h2>
  <p class="small muted">Engaged: every agent request and every PayPal write for your organisation is refused before it reaches PayPal. Holds stay as they are; nothing is charged.</p>
  <form method="post" action="/guard/kill" class="row">
    <input type="hidden" name="scope" value="org:${p.org_id}">
    ${orgKill ? html`<span class="pill bad">ENGAGED</span> <span class="small">${orgKill.reason ?? ""}</span> <button class="btn" name="engaged" value="0">Release</button>` : html`<span class="pill good">clear</span> <input type="text" name="reason" placeholder="why (optional)" maxlength="120"> <button class="btn danger" name="engaged" value="1">Stop everything</button>`}
  </form>
  ${agentKills.length ? html`<h3>Per-agent</h3><ul class="small">${raw(agentKills.map((k: any) => `<li class="mono">${k.scope} <span class="pill ${k.engaged ? "bad" : "good"}">${k.engaged ? "stopped" : "clear"}</span> <form method="post" action="/guard/kill" class="inline"><input type="hidden" name="scope" value="${k.scope}"><button class="btn small" name="engaged" value="${k.engaged ? 0 : 1}">${k.engaged ? "release" : "stop"}</button></form></li>`).join(""))}</ul>` : ""}
  <form method="post" action="/guard/kill" class="row small"><input type="text" name="scope" placeholder="agent:<id>" required pattern="agent:.+"><input type="hidden" name="engaged" value="1"><button class="btn small">Stop one agent</button></form>
</div>
</div>

<div class="grid g2">
<div class="card" id="approvals">
  <h2>Waiting for you (${approvals.length})</h2>
  <p class="small muted">Charges and refunds above ${fmt(countersignThreshold())} need your passkey; the signature covers the exact amount and order, so nothing can be swapped after you sign. ${passkey ? "Passkey registered." : html`<button class="btn small" id="pk-register" type="button">Register a passkey</button>`}</p>
  ${approvals.length
    ? html`<ul class="approvals">${raw(approvals.map((a: any) => `<li><div><b>${a.action}</b> ${fmt(a.payload.cents)} · <span class="mono small">${a.payload.entity} ${a.payload.entity_id}</span><br><span class="small muted">asked ${fmtDate(a.created_at)}</span></div><div class="row">${a.payload.cents > countersignThreshold() ? `<button class="btn primary small" data-countersign="${a.id}" type="button">Sign and approve</button>` : `<form method="post" action="/guard/approvals/${a.id}/click" class="inline"><button class="btn primary small" name="approve" value="1">Approve</button></form>`}<form method="post" action="/guard/approvals/${a.id}/click" class="inline"><button class="btn small" name="approve" value="0">Decline</button></form></div></li>`).join(""))}</ul>`
    : html`<p class="muted">Nothing waiting.</p>`}
</div>

<div class="card">
  <h2>Audit chain <span class="pill ${chain.ok ? "good" : "bad"}">${chain.ok ? `intact · ${chain.rows} rows` : `BROKEN at ${chain.broken_at}`}</span></h2>
  <p class="small muted">Every money decision is hashed over the previous row. Head <span class="mono">${chain.head.slice(0, 16)}…</span>. <a href="/guard/audit.json">Export</a></p>
  <div class="table-wrap"><table class="small"><thead><tr><th>#</th><th>When</th><th>Kind</th><th>Entity</th><th>Hash</th></tr></thead><tbody>${raw(audit.map((a: any) => `<tr><td>${a.seq}</td><td>${fmtDate(a.at)}</td><td>${a.kind}</td><td class="mono">${a.entity} ${a.entity_id}</td><td class="mono">${String(a.hash).slice(0, 12)}…</td></tr>`).join(""))}</tbody></table></div>
</div>
</div>

<div class="card">
  <h2>Recent agent runs on your orders</h2>
  ${orgRuns.length ? html`<ul class="small">${raw(orgRuns.map((x: any) => `<li><a href="/trace/${x.id}">${x.subject}</a> · ${x.actor}${x.agent_id ? ` <span class="mono">${x.agent_id}</span>` : ""} · ${x.steps} steps · <span class="pill ${x.status === "done" ? "good" : x.status === "failed" ? "bad" : "warn"}">${x.status}</span> · ${fmtDate(x.started_at)}</li>`).join(""))}</ul>` : html`<p class="muted">No runs yet.</p>`}
</div>
${drafts.rows.length > 1 ? html`<div class="card"><h2>Mandate history</h2><ul class="small">${raw(drafts.rows.map((d: any) => `<li>${fmtDate(d.created_at)} · ${d.active ? "<b>active</b>" : `<form method="post" action="/guard/policy/${d.id}/activate" class="inline"><button class="btn small">make active</button></form>`} · ${d.compiler} · <span class="muted">${String(d.text).replace(/</g, "&lt;").slice(0, 100)}</span></li>`).join(""))}</ul></div>` : ""}
`,
        ),
      );
    }, () => "/home"),
  );

  r.post(
    "/guard/policy",
    page(async (req, res) => {
      const p = await needOwner(req, res);
      if (!p) return;
      const text = String(req.body.text ?? "").slice(0, 2000);
      if (!text.trim()) throw new GtError("Write the mandate first", "validation", 422);
      const compiled = await compilePolicy(text);
      const adopt = req.body.mode === "adopt";
      const id = await savePolicy(p.org_id, text, compiled, adopt);
      if (adopt) return back(res, "/guard", `Mandate adopted (${compiled.compiler})${compiled.unexpressed.length ? `; could not express: ${compiled.unexpressed.join("; ")}` : ""}`);
      const current = (await activePolicy(p.org_id))?.rules ?? DEFAULT_RULES;
      res.send(
        layout(
          { title: "Mandate preview", who: whoOf(p) },
          html`<h1>Mandate preview</h1><p class="sub">Compiled by ${compiled.compiler}. Nothing is active until you adopt it.</p>
<div class="card"><blockquote>${text}</blockquote>${rulesTable(compiled.rules, current)}
${compiled.unexpressed.length ? html`<p class="banner warn"><b>Could not express:</b> ${compiled.unexpressed.join("; ")}. These sentences have no rule behind them; write them differently or accept that they are not enforced.</p>` : ""}
<form method="post" action="/guard/policy/${id}/activate" class="row"><button class="btn primary">Adopt this mandate</button> <a class="btn" href="/guard">Back</a></form></div>`,
        ),
      );
    }, () => "/guard"),
  );

  r.post(
    "/guard/policy/:id/activate",
    page(async (req, res) => {
      const p = await needOwner(req, res);
      if (!p) return;
      const db = await getDb();
      const row = (await db.query<any>("SELECT * FROM policies WHERE id = $1 AND owner_id = $2", [req.params.id, p.org_id])).rows[0];
      if (!row) throw new GtError("Mandate not found", "not_found", 404);
      await db.tx(async (t) => {
        await t.query("UPDATE policies SET active = false WHERE owner_id = $1", [p.org_id]);
        await t.query("UPDATE policies SET active = true WHERE id = $1", [row.id]);
      });
      back(res, "/guard", "Mandate adopted");
    }, () => "/guard"),
  );

  r.post(
    "/guard/backtest",
    page(async (req, res) => {
      const p = await needOwner(req, res);
      if (!p) return;
      const current = (await activePolicy(p.org_id))?.rules ?? DEFAULT_RULES;
      const candidate = RulesSchema.parse({ ...current, approve_above_cents: Number(req.body.approve_above_cents) });
      const [a, b] = await Promise.all([backtest(p.org_id, current, 90), backtest(p.org_id, candidate, 90)]);
      res.send(
        layout(
          { title: "Backtest", who: whoOf(p) },
          html`<h1>Backtest</h1><p class="sub">Current mandate against a candidate with approval threshold ${fmt(candidate.approve_above_cents)}.</p>
<div class="grid g2"><div class="card"><h2>Current</h2><div class="stats"><div><b>${a.run}</b><span>run</span></div><div><b>${a.wait}</b><span>wait</span></div><div><b>${a.deny}</b><span>deny</span></div></div><p>${fmt(a.auto_cents)} moves without you; ${fmt(a.held_cents)} waits.</p></div>
<div class="card"><h2>Candidate</h2><div class="stats"><div><b>${b.run}</b><span>run</span></div><div><b>${b.wait}</b><span>wait</span></div><div><b>${b.deny}</b><span>deny</span></div></div><p>${fmt(b.auto_cents)} moves without you; ${fmt(b.held_cents)} waits.</p>
<form method="post" action="/guard/adopt-rules"><input type="hidden" name="rules" value="${JSON.stringify(candidate)}"><button class="btn primary">Adopt candidate</button> <a class="btn" href="/guard">Back</a></form></div></div>`,
        ),
      );
    }, () => "/guard"),
  );

  r.post(
    "/guard/adopt-rules",
    page(async (req, res) => {
      const p = await needOwner(req, res);
      if (!p) return;
      const rules = RulesSchema.parse(JSON.parse(String(req.body.rules)));
      const prev = await activePolicy(p.org_id);
      await savePolicy(p.org_id, `${prev?.text ?? "(defaults)"} [edited from backtest]`, { rules, unexpressed: prev?.unexpressed ?? [], compiler: "backtest" }, true);
      back(res, "/guard", "Rules adopted");
    }, () => "/guard"),
  );

  r.post(
    "/guard/suggestions",
    page(async (req, res) => {
      const p = await needOwner(req, res);
      if (!p) return;
      const all = JSON.parse(String(req.body.payload ?? "[]"));
      const picks = (Array.isArray(req.body.pick) ? req.body.pick : req.body.pick ? [req.body.pick] : []).map((i: string) => all[Number(i)]).filter(Boolean);
      if (!picks.length) throw new GtError("Pick at least one suggestion", "validation", 422);
      const prev = await activePolicy(p.org_id);
      const rules = applySuggestions(prev?.rules ?? DEFAULT_RULES, picks);
      await savePolicy(p.org_id, `${prev?.text ?? "(defaults)"} [earned autonomy: ${picks.map((x: any) => x.field).join(", ")}]`, { rules, unexpressed: prev?.unexpressed ?? [], compiler: "earned-autonomy" }, true);
      back(res, "/guard", `Adopted ${picks.length} suggestion(s)`);
    }, () => "/guard"),
  );

  r.post(
    "/guard/kill",
    page(async (req, res) => {
      const p = await needOwner(req, res);
      if (!p) return;
      const scope = String(req.body.scope ?? "");
      if (scope !== `org:${p.org_id}` && !scope.startsWith("agent:")) throw new GtError("Scope must be your organisation or agent:<id>", "validation", 422);
      const engaged = String(req.body.engaged) === "1";
      await setKill(scope, engaged, engaged ? String(req.body.reason ?? "").slice(0, 200) || null : null, p.org_id);
      back(res, "/guard", engaged ? `Kill switch engaged for ${scope}` : `Kill switch released for ${scope}`);
    }, () => "/guard"),
  );

  // In-place decisions from the order page (guard card): same checks as the Approvals page, back to where you were.
  for (const op of ["approve", "decline"] as const)
    r.post(
      `/guard/approvals/:id/${op}`,
      page(async (req, res) => {
        const p = await needOwner(req, res);
        if (!p) return;
        const db = await getDb();
        const a = (await db.query<any>("SELECT * FROM approvals WHERE id = $1 AND owner_id = $2", [req.params.id, p.org_id])).rows[0];
        if (!a) throw new GtError("Approval not found", "not_found", 404);
        if (op === "approve" && a.payload.cents > countersignThreshold()) throw new GtError("This amount needs your passkey", "passkey_required", 403);
        const payload = await decideApproval(a.id, p.org_id, op === "approve", "click");
        if (payload && op === "approve") await release(a.id);
        back(res, nextOf(req.body?.next, "/guard"), op === "approve" ? "Approved. The capture goes ahead now." : "Declined. Nothing moves.");
      }, (req) => nextOf(req.body?.next, "/guard")),
    );

  r.post(
    "/guard/approvals/:id/click",
    page(async (req, res) => {
      const p = await needOwner(req, res);
      if (!p) return;
      const approve = String(req.body.approve) === "1";
      const db = await getDb();
      const a = (await db.query<any>("SELECT * FROM approvals WHERE id = $1 AND owner_id = $2", [req.params.id, p.org_id])).rows[0];
      if (!a) throw new GtError("Approval not found", "not_found", 404);
      if (approve && a.payload.cents > countersignThreshold()) throw new GtError("This amount needs your passkey", "passkey_required", 403);
      const payload = await decideApproval(a.id, p.org_id, approve, "click");
      if (payload && approve) await release(a.id);
      back(res, "/guard", approve ? "Approved; the held step is back in the queue" : "Declined");
    }, () => "/guard"),
  );

  r.post(
    "/guard/passkey/register/start",
    json(async (req) => {
      const p = await ownerJson(req);
      const c = newChallenge(p.org_id, null);
      return { id: c.id, challenge: c.challenge, rpName: "StockSure", userId: Buffer.from(p.org_id).toString("base64url"), userName: p.org_name ?? p.name };
    }),
  );
  r.post(
    "/guard/passkey/register/finish",
    json(async (req) => {
      const p = await ownerJson(req);
      try {
        return await finishRegistration(p.org_id, String(req.body.chalId), req.body);
      } catch (e) {
        throw new GtError((e as Error).message, "passkey_failed", 400);
      }
    }),
  );
  r.post(
    "/guard/passkey/sign/start",
    json(async (req) => {
      const p = await ownerJson(req);
      const db = await getDb();
      const a = (await db.query<any>("SELECT * FROM approvals WHERE id = $1 AND owner_id = $2 AND status = 'pending'", [String(req.body.approvalId), p.org_id])).rows[0];
      if (!a) throw new GtError("Approval not found", "not_found", 404);
      const c = newChallenge(p.org_id, a.payload_hash);
      return { id: c.id, challenge: c.challenge, payloadHash: a.payload_hash, summary: `${a.action} ${fmt(a.payload.cents)} ${a.payload.entity_id}` };
    }),
  );
  r.post(
    "/guard/passkey/sign/finish",
    json(async (req) => {
      const p = await ownerJson(req);
      const db = await getDb();
      const a = (await db.query<any>("SELECT * FROM approvals WHERE id = $1 AND owner_id = $2 AND status = 'pending'", [String(req.body.approvalId), p.org_id])).rows[0];
      if (!a) throw new GtError("Approval not found", "not_found", 404);
      const ok = await verifyAssertion(p.org_id, String(req.body.chalId), a.payload_hash, req.body);
      if (!ok) throw new GtError("Signature did not verify", "passkey_failed", 400);
      const payload = await decideApproval(a.id, p.org_id, true, "passkey");
      if (payload) await release(a.id);
      return { approved: true, payload_hash: a.payload_hash, hashed: payloadHash(a.payload) === a.payload_hash };
    }),
  );

  r.get(
    "/guard/audit.json",
    json(async (req) => {
      await ownerJson(req);
      return { chain: await verifyChain(), rows: await recentAudit(1000) };
    }),
  );
  r.get(
    "/guard/runs.json",
    json(async (req) => {
      await ownerJson(req);
      return { runs: await recentRuns(50), threshold_cents: config.guard.countersignAboveCents };
    }),
  );

  return r;
}
