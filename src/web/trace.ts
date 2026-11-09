import { icon } from "./icons.js";
import { randomBytes } from "node:crypto";
/**
 * Trace, evidence, judge mode, channels simulator, webhooks and PWA routes (roadmap B.2, B.3, B.4, B.8, B.9, B.10).
 */
import { Router, type Request } from "express";
import { readFileSync } from "node:fs";
import { timingSafeEqual } from "node:crypto";
import { config } from "../config.js";
import { getDb } from "../db.js";
import { GtError } from "../lib/util.js";
import { newId } from "../lib/ids.js";
import { aiUsageSummary, providerLabel } from "../ai/provider.js";
import { verifyChain } from "../guard/audit.js";
import { conversation, link, receive, recentMessages, telegramReady, telegramUpdate, whatsappReady, whatsappUpdate, type Party } from "../channels/index.js";
import { pushReady, subscribe } from "../channels/push.js";
import { evalRows, latestSummary } from "../eval/runner.js";
import { loadRun, recentRuns, renderTrace, runsFor } from "../trace.js";
import type { Person } from "../store.js";
import { me, personByKey, whoOf } from "./auth.js";
import { back, flashOf, json, page } from "./common.js";
import { esc, fmtDate, html, layout, pill, raw } from "./html.js";

const safeEq = (a: string, b: string) => {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

const addressOf = (p: Person) => (p.org_kind === "buyer" ? `buyer:${p.org_id}` : `supplier:${p.org_id}`);

async function bearerOrCookie(req: Request): Promise<Person | null> {
  const m = /^Bearer\s+(\S+)$/i.exec(req.header("authorization") ?? "");
  if (m) return personByKey(m[1]);
  return me(req);
}

/** May this person see a run? Buyers see runs on their orders; suppliers see runs on theirs. */
async function canSee(p: Person, run: any): Promise<boolean> {
  if (run.entity !== "po" && run.entity !== "claim" && run.entity !== "negotiation") return true;
  const db = await getDb();
  const sql = run.entity === "po" ? "SELECT 1 FROM purchase_orders WHERE id = $1 AND (buyer_id = $2 OR supplier_id = $2)" : run.entity === "claim" ? "SELECT 1 FROM defect_claims c JOIN purchase_orders po ON po.id = c.po_id WHERE c.id = $1 AND (po.buyer_id = $2 OR po.supplier_id = $2)" : "SELECT 1 FROM negotiations n JOIN purchase_orders po ON po.id = n.po_id WHERE n.id = $1 AND (po.buyer_id = $2 OR po.supplier_id = $2)";
  return (await db.query(sql, [run.entity_id, p.org_id])).rows.length > 0;
}

export function traceRouter() {
  const r = Router();

  r.get(
    "/trace/:id",
    page(async (req, res) => {
      const p = await me(req);
      if (!p) return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl.slice(0, 200))}`);
      const t = await loadRun(req.params.id);
      if (!t) throw new GtError("Run not found", "not_found", 404);
      if (!(await canSee(p, t.run))) throw new GtError("Not your run", "forbidden", 403);
      res.send(
        layout(
          { title: `Trace ${t.run.id}`, who: whoOf(p) },
          html`<h1>Agent trace</h1><p class="sub">${t.run.subject} · ${t.run.actor}${t.run.agent_id ? html` · <span class="mono">${t.run.agent_id}</span>` : ""} · ${pill(t.run.status)} · started ${fmtDate(t.run.started_at)}${t.run.ended_at ? html` · ended ${fmtDate(t.run.ended_at)}` : ""}</p>
<p class="small muted">Every step shows who acted (model, code, guard, PayPal), what rule applied, what the gate said, and the PayPal request id so a judge can match it in the sandbox. Secrets and document bytes are redacted.</p>
<div class="card">${renderTrace(t.steps)}</div>
${t.run.entity === "po" ? html`<p class="small"><a href="/po/${t.run.entity_id}">Open order</a></p>` : t.run.entity === "negotiation" ? html`<p class="small"><a href="/negotiations/${t.run.entity_id}">Open negotiation</a></p>` : ""}`,
        ),
      );
    }, () => "/home"),
  );

  r.get(
    "/traces",
    page(async (req, res) => {
      const p = await me(req);
      if (!p) return res.redirect("/login?next=/traces");
      const db = await getDb();
      const runs = (await db.query<any>(
        `SELECT r.*, (SELECT count(*) FROM agent_trace t WHERE t.run_id = r.id) AS steps FROM agent_runs r
         WHERE (r.entity = 'po' AND r.entity_id IN (SELECT id FROM purchase_orders WHERE buyer_id = $1 OR supplier_id = $1))
            OR (r.entity = 'negotiation' AND r.entity_id IN (SELECT n.id FROM negotiations n JOIN purchase_orders po ON po.id = n.po_id WHERE po.buyer_id = $1 OR po.supplier_id = $1))
            OR (r.entity = 'claim' AND r.entity_id IN (SELECT c.id FROM defect_claims c JOIN purchase_orders po ON po.id = c.po_id WHERE po.buyer_id = $1 OR po.supplier_id = $1))
         ORDER BY r.started_at DESC LIMIT 100`,
        [p.org_id],
      )).rows;
      res.send(
        layout(
          { title: "Traces", who: whoOf(p) },
          html`<h1>Agent runs on your orders</h1><p class="sub">Every hold, capture, refund, reauthorization and negotiation round is a traced run. Open one to see the gate decisions and PayPal request ids.</p>
<div class="table-wrap"><table><thead><tr><th>Started</th><th>Actor</th><th>Subject</th><th>Steps</th><th>Status</th></tr></thead><tbody>${runs.length ? raw(runs.map((x: any) => `<tr><td>${fmtDate(x.started_at)}</td><td>${x.actor}${x.agent_id ? ` <span class="mono small">${x.agent_id}</span>` : ""}</td><td><a href="/trace/${x.id}">${String(x.subject).replace(/</g, "&lt;")}</a></td><td>${x.steps ?? ""}</td><td>${pill(x.status).value}</td></tr>`).join("")) : html`<tr><td colspan="5" class="muted">No runs yet. Accept a quote or start a negotiation.</td></tr>`}</tbody></table></div>`,
        ),
      );
    }, () => "/home"),
  );

  r.get(
    "/api/v1/runs/:id",
    json(async (req) => {
      const p = await bearerOrCookie(req);
      if (!p) throw new GtError("Unauthorized", "unauthorized", 401);
      const t = await loadRun(req.params.id);
      if (!t || !(await canSee(p, t.run))) throw new GtError("Run not found", "not_found", 404);
      return t;
    }),
  );
  r.get(
    "/api/v1/runs",
    json(async (req) => {
      const p = await bearerOrCookie(req);
      if (!p) throw new GtError("Unauthorized", "unauthorized", 401);
      const db = await getDb();
      const poId = typeof req.query.po === "string" ? req.query.po : null;
      if (poId) {
        const ok = (await db.query("SELECT 1 FROM purchase_orders WHERE id = $1 AND (buyer_id = $2 OR supplier_id = $2)", [poId, p.org_id])).rows.length;
        if (!ok) throw new GtError("Order not found", "not_found", 404);
        return { runs: await runsFor("po", poId, 50) };
      }
      const runs = (await db.query("SELECT r.* FROM agent_runs r WHERE r.entity = 'po' AND r.entity_id IN (SELECT id FROM purchase_orders WHERE buyer_id = $1 OR supplier_id = $1) ORDER BY r.started_at DESC LIMIT 50", [p.org_id])).rows;
      return { runs };
    }),
  );

  // ---- Evidence page (public) ----
  r.get(
    "/evidence",
    page(async (req, res) => {
      const p = await me(req);
      const [three, arena, ai, chain] = await Promise.all([latestSummary("receiving"), evalRows("arena", 80), aiUsageSummary(), verifyChain()]);
      const db = await getDb();
      const real = (await db.query<any>(`SELECT
        (SELECT count(*) FROM purchase_orders WHERE auth_id IS NOT NULL) AS orders_with_hold,
        (SELECT count(*) FROM payment_ops WHERE kind = 'capture' AND status = 'succeeded') AS captures,
        (SELECT coalesce(sum(amount_cents),0) FROM payment_ops WHERE kind = 'capture' AND status = 'succeeded') AS captured_cents,
        (SELECT count(*) FROM payment_ops WHERE kind = 'refund' AND status = 'succeeded') AS refunds,
        (SELECT count(*) FROM payment_ops WHERE kind = 'reauthorize' AND status = 'succeeded') AS reauths,
        (SELECT count(*) FROM receipts WHERE status = 'confirmed') AS receipts,
        (SELECT count(*) FROM resolutions WHERE (body->>'auto') = 'true') AS auto_resolutions,
        (SELECT count(*) FROM resolutions WHERE (body->>'auto') <> 'true') AS person_resolutions,
        (SELECT count(*) FROM negotiations) AS negotiations,
        (SELECT count(*) FROM negotiations WHERE status = 'agreed') AS negotiations_agreed,
        (SELECT count(*) FROM agreements WHERE supplier_signed_at IS NOT NULL) AS agreements_countersigned,
        (SELECT count(*) FROM agent_runs) AS runs,
        (SELECT count(*) FROM purchase_orders WHERE created_by_agent IS NOT NULL) AS agent_orders,
        (SELECT count(*) FROM approvals WHERE status = 'pending') AS approvals_pending,
        (SELECT count(*) FROM documents) AS documents,
        (SELECT count(*) FROM extractions WHERE jsonb_array_length(coalesce(flags,'[]'::jsonb)) > 0) AS docs_with_instruction_flags`)).rows[0];
      let labels: any[] = [];
      try {
        labels = JSON.parse(readFileSync("eval/labels.json", "utf8"));
      } catch {
        labels = [];
      }
      const latestArena = arena.length ? String(arena[0].id).split("-").slice(0, 2).join("-") : null;
      const arenaRows = arena.filter((a) => latestArena && String(a.id).startsWith(latestArena));
      res.send(
        layout(
          { title: "Evidence", who: whoOf(p) },
          html`<h1>Evidence</h1>
<p class="sub">Every row: <a href="/evidence/eval">eval explorer</a> (slices and CSV). What is real, what is simulated, and how the receiving reader and the guard perform. Numbers come from this instance's database and the eval tables, not from a README.</p>

<div class="card"><h2>Real vs simulated</h2>
<table class="small"><tbody>
<tr><th>PayPal</th><td>Sandbox REST: vault setup tokens, authorize, capture (partial and final), void, refund, reauthorize, disputes, transaction search, balances, tracking, invoices. ${config.paypal.clientId ? "Credentials present." : "No credentials in this instance: the fake client is in use."} No live money.</td></tr>
<tr><th>Models</th><td>${providerLabel()}. ${ai.calls} calls recorded (${ai.ok} ok), about $${ai.cost_usd.toFixed(3)} at list prices. Every call's input hash, model, latency and output is stored in <span class="mono">ai_calls</span>. Models read documents and write negotiation wording; they never set a price, a quantity or a payee.</td></tr>
<tr><th>Documents</th><td>${labels.length} eval delivery notes, ${labels.filter((l) => l.trap).length} traps (instruction injections, payee changes, invented lines, count drift). Production documents come from uploads, the dock camera or the supplier's dispatch.</td></tr>
<tr><th>Agents</th><td>Buyer and supplier agents negotiate under the owner's mandate and the supplier's floor; code guards every offer, and the agreement is hashed and signed by both sides before any hold. MCP at <span class="mono">/mcp</span>, merchant cart API at <span class="mono">/api/merchant</span>.</td></tr>
<tr><th>Channels</th><td>Telegram ${telegramReady() ? "live" : "not configured"} · Web push ${pushReady() ? "live" : "not configured"} · Simulator always on at <a href="/channels">/channels</a>.</td></tr>
<tr><th>Audit chain</th><td>${chain.ok ? `intact, ${chain.rows} rows` : `BROKEN at row ${chain.broken_at}`}, head <span class="mono">${chain.head.slice(0, 16)}…</span></td></tr>
</tbody></table></div>

<div class="card"><h2>This instance so far</h2>
<div class="stats"><div><b>${real.orders_with_hold}</b><span>orders with a PayPal hold</span></div><div><b>${real.captures}</b><span>captures ($${(Number(real.captured_cents) / 100).toFixed(2)})</span></div><div><b>${real.refunds}</b><span>refunds</span></div><div><b>${real.reauths}</b><span>reauthorizations</span></div><div><b>${real.receipts}</b><span>receipts confirmed</span></div><div><b>${real.auto_resolutions}</b><span>clean receipts settled by code</span></div><div><b>${real.person_resolutions}</b><span>resolutions needing people</span></div><div><b>${real.negotiations_agreed}/${real.negotiations}</b><span>negotiations agreed</span></div><div><b>${real.agreements_countersigned}</b><span>agreements countersigned</span></div><div><b>${real.agent_orders}</b><span>orders from agents</span></div><div><b>${real.runs}</b><span>agent runs traced</span></div><div><b>${real.approvals_pending}</b><span>approvals waiting</span></div><div><b>${real.docs_with_instruction_flags}/${real.documents}</b><span>documents with instruction-like lines removed</span></div></div></div>

<div class="card"><h2>Three-arm receiving eval</h2>
<p class="small muted">The same ${labels.length} labelled delivery notes through three arms: rules only (the text parser), rules + model (the production reader), and an oracle. "Dollars paid" assumes a naive system that pays what the document says; traps are notes that try to change the payee, the amount, or the count. StockSure pays from confirmed counts and quote prices, so document text cannot move money in any arm; the eval measures how many traps each reader catches and how many clean notes it reads correctly.</p>
${three.length
  ? html`<div class="table-wrap"><table><thead><tr><th>Arm</th><th>Cases</th><th>Correct</th><th>Traps</th><th>Traps that would pay naively</th><th>Dollars at risk</th><th>Dollars StockSure pays on traps</th><th>p50 latency</th></tr></thead><tbody>${raw(three.map((a) => `<tr><td><b>${a.arm}</b></td><td>${a.cases}</td><td>${a.correct} (${a.cases ? ((100 * a.correct) / a.cases).toFixed(1) : 0}%)</td><td>${a.traps}</td><td>${a.traps}</td><td>$${a.naive_usd.toFixed(2)}</td><td class="${a.traps_paid ? "bad" : "good"}">$${a.paid_usd.toFixed(2)}</td><td>${a.p50_ms} ms</td></tr>`).join(""))}</tbody></table></div><p class="small"><a href="/evidence/three-arm.md">Markdown report</a></p>`
  : html`<p class="muted">Not run yet on this instance: <span class="mono">npm run eval:three-arm</span>.</p>`}
</div>

<div class="card"><h2>Negotiation arena and adversarial agents</h2>
<p class="small muted">Buyer and supplier agents play honest, greedy and hostile strategies against each other; then an evil agent, an evil model and an evil document attack the gate. Every attack row must end denied, held or rejected.</p>
${arenaRows.length
  ? html`<div class="table-wrap"><table class="small"><thead><tr><th>Case</th><th>Kind</th><th>What happens</th><th>Outcome</th><th>Detail</th></tr></thead><tbody>${raw(arenaRows.map((a) => `<tr><td class="mono">${a.case_id}</td><td>${a.detail?.attacker ?? a.detail?.kind ?? ""}</td><td>${String(a.detail?.description ?? "").replace(/</g, "&lt;")}</td><td><span class="pill ${a.correct ? "good" : "bad"}">${a.actual}</span></td><td class="small">${String(a.detail?.detail ?? "").replace(/</g, "&lt;").slice(0, 160)}</td></tr>`).join(""))}</tbody></table></div><p class="small"><a href="/evidence/arena.md">Markdown report</a></p>`
  : html`<p class="muted">Not run yet: <span class="mono">npm run eval:arena</span>.</p>`}
</div>

<div class="card"><h2>Model usage by purpose</h2>${ai.by_purpose.length ? html`<table class="small"><thead><tr><th>Purpose</th><th>Calls</th><th>Cost</th><th>p50</th></tr></thead><tbody>${raw(ai.by_purpose.map((x) => `<tr><td>${x.purpose}</td><td>${x.calls}</td><td>$${x.cost_usd.toFixed(4)}</td><td>${x.p50_ms} ms</td></tr>`).join(""))}</tbody></table>` : html`<p class="muted">No model calls yet.</p>`}</div>

<div class="card"><h2>What this does not prove</h2><ul class="small"><li>A clean receipt settles by code; a disputed one needs two people to agree. StockSure makes the money follow the agreement; it cannot tell whether the goods in the photo are the goods on the shelf.</li><li>The reader's eval notes are synthetic (generated from the demo catalog with controlled faults); the three-arm numbers are a regression suite, not an independent benchmark.</li><li>Negotiation agents are rule-driven with model wording; the arena shows the guards hold, not that the prices they reach are good prices.</li><li>Hold, capture (partial and final), release read-back, replacement hold and refund are run on the real sandbox (IDs in the README). Reauthorize (day 3), disputes, transaction search, balances and tracking call the sandbox from this instance when their moment comes, but have no recorded sandbox run yet; they are tested on the fake client.</li></ul></div>`,
        ),
      );
    }, () => "/"),
  );
  r.get("/evidence/three-arm.md", (_req, res) => {
    try {
      res.type("text/markdown").send(readFileSync("eval/three-arm.md", "utf8"));
    } catch {
      res.status(404).type("text/plain").send("Not generated yet. Run: npm run eval:three-arm");
    }
  });
  r.get("/evidence/arena.md", (_req, res) => {
    try {
      res.type("text/markdown").send(readFileSync("eval/arena.md", "utf8"));
    } catch {
      res.status(404).type("text/plain").send("Not generated yet. Run: npm run eval:arena");
    }
  });

  // ---- Eval explorer (roadmap B.5): every eval row, sliced by suite, arm, outcome and trap, with CSV ----
  const sliceRows = async (req: Request) => {
    const suite = typeof req.query.suite === "string" ? req.query.suite : "receiving";
    const arm = typeof req.query.arm === "string" ? req.query.arm : undefined;
    const outcome = typeof req.query.outcome === "string" ? req.query.outcome : undefined;
    const trap = typeof req.query.trap === "string" ? req.query.trap : undefined;
    const all = await evalRows(suite, 3000);
    const kindOf = (x: any) => x.detail?.trap_kind ?? x.detail?.kind ?? null;
    const rows = all.filter((x) => (!arm || x.arm === arm) && (!outcome || (outcome === "correct") === Boolean(x.correct)) && (!trap || (trap === "trap" ? x.trap : trap === "plain" ? !x.trap : kindOf(x) === trap)));
    return { suite, arm, outcome, trap, all, rows, kindOf };
  };
  r.get(
    "/evidence/eval",
    page(async (req, res) => {
      const { suite, arm, outcome, trap, all, rows, kindOf } = await sliceRows(req);
      const q = (patch: Record<string, string | undefined>) => "/evidence/eval?" + new URLSearchParams(Object.entries({ suite, arm, outcome, trap, ...patch }).filter(([, v]) => v) as [string, string][]).toString();
      const chip = (label: string, patch: Record<string, string | undefined>, on: boolean) => html`<a class="chip ${on ? "on" : ""}" href="${q(patch)}">${label}</a>`;
      const kinds = [...new Set(all.map(kindOf).filter(Boolean))] as string[];
      const sums = suite === "receiving" ? await latestSummary("receiving") : [];
      res.send(
        layout(
          { title: "Eval explorer", who: whoOf(await me(req)) },
          html`<h1>Eval explorer</h1>
<p class="sub">Every recorded eval row on this instance. Slice by arm, outcome and trap; export the slice as CSV. Summaries live on <a href="/evidence">Evidence</a>.</p>
<div class="card"><div class="chips">Suite: ${chip("receiving", { suite: "receiving", arm: undefined, outcome: undefined, trap: undefined }, suite === "receiving")}${chip("arena", { suite: "arena", arm: undefined, outcome: undefined, trap: undefined }, suite === "arena")}</div>
<div class="chips">Arm: ${chip("all", { arm: undefined }, !arm)}${[...new Set(all.map((x) => String(x.arm)))].map((a) => chip(a, { arm: a }, arm === a))}</div>
<div class="chips">Outcome: ${chip("all", { outcome: undefined }, !outcome)}${chip("correct", { outcome: "correct" }, outcome === "correct")}${chip("wrong", { outcome: "wrong" }, outcome === "wrong")}</div>
<div class="chips">Traps: ${chip("all", { trap: undefined }, !trap)}${chip("traps only", { trap: "trap" }, trap === "trap")}${chip("plain", { trap: "plain" }, trap === "plain")}${kinds.map((k) => chip(k, { trap: k }, trap === k))}</div>
<p class="small"><a class="btn small" href="${q({}).replace("/evidence/eval?", "/evidence/eval.csv?")}">Download this slice as CSV</a> · ${rows.length} of ${all.length} rows</p>
${sums.length ? html`<div class="table-wrap"><table class="small"><thead><tr><th>Arm</th><th>Cases</th><th>Correct</th><th>Traps</th><th>Traps paid</th><th>$ paid</th><th>$ naive</th><th>p50</th></tr></thead><tbody>${raw(sums.map((a: any) => `<tr><td><b>${esc(a.arm)}</b></td><td>${a.cases}</td><td>${a.correct}</td><td>${a.traps}</td><td>${a.traps_paid}</td><td>${Number(a.paid_usd).toFixed(2)}</td><td>${Number(a.naive_usd).toFixed(2)}</td><td>${a.p50_ms} ms</td></tr>`).join(""))}</tbody></table></div>` : ""}
</div>
<div class="card"><div class="table-wrap"><table class="small"><thead><tr><th>Case</th><th>Arm</th><th>Expected</th><th>Actual</th><th>OK</th><th>Trap</th><th>$ naive</th><th>$ ours</th><th>ms</th><th>Detail</th></tr></thead><tbody>
${raw(rows.slice(0, 400).map((x) => `<tr><td class="mono">${esc(String(x.case_id))}</td><td>${esc(String(x.arm))}</td><td class="small">${esc(String(x.expected).slice(0, 100))}</td><td class="small">${esc(String(x.actual).slice(0, 100))}</td><td>${x.correct ? '<span class="pill good">yes</span>' : '<span class="pill bad">no</span>'}</td><td>${esc(String(kindOf(x) ?? (x.trap ? "trap" : "")))}</td><td>${(Number(x.naive_paid_cents) / 100).toFixed(2)}</td><td>${(Number(x.ours_paid_cents) / 100).toFixed(2)}</td><td>${x.latency_ms}</td><td class="small">${esc(String(x.detail?.reason ?? x.detail?.title ?? x.detail?.note ?? "").slice(0, 120))}</td></tr>`).join(""))}
</tbody></table></div>${rows.length ? "" : html`<p class="muted">Nothing recorded for this slice. Run <span class="mono">npm run eval:three-arm</span> or <span class="mono">npm run eval:arena</span>.</p>`}</div>`,
        ),
      );
    }),
  );
  r.get("/evidence/eval.csv", async (req, res) => {
    const { suite, rows } = await sliceRows(req);
    const cols = ["id", "arm", "case_id", "expected", "actual", "correct", "trap", "naive_paid_cents", "ours_paid_cents", "latency_ms", "at"];
    const cell = (v: unknown) => { const t = v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v); return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
    res.type("text/csv").set("Content-Disposition", `attachment; filename="stocksure-eval-${suite}.csv"`).send([cols.join(","), ...rows.map((x) => cols.map((c) => cell(x[c])).join(","))].join("\n"));
  });
  r.get("/llms.txt", (_req, res) => {
    res.type("text/plain").send(`# StockSure
Buying agent for a small business under the owner's PayPal mandate, and a supplier agent that quotes and dispatches; the agreed deal is one hashed agreement and one PayPal hold, captured only against what the dock received.

MCP (buyer and supplier, Streamable HTTP, stateless): ${config.appUrl}/mcp with header Authorization: Bearer <ssk_ key>.
Skill: ${config.appUrl}/skill.md
Runs API: ${config.appUrl}/api/v1/runs (Bearer key).
Evidence: ${config.appUrl}/evidence · eval explorer ${config.appUrl}/evidence/eval

Guarantees: a capture never exceeds what was received against the signed agreement; amounts come from the catalog and quotes, never from a message; above the owner's limits a move waits; the model never sets a price or quantity.
`);
  });
  r.get("/skill.md", (_req, res) => {
    try {
      res.type("text/markdown").send(readFileSync("skill/SKILL.md", "utf8").replace(/\{APP_URL\}/g, config.appUrl));
    } catch {
      res.status(404).type("text/plain").send("No skill file.");
    }
  });

  // ---- Judge mode (roadmap B.9) ----
  const BEATS = [
    { title: "An agent orders stock", body: "A shopping agent opens a cart on the merchant API or calls draft_order over MCP. The owner's mandate (plain words, compiled to rules) decides whether it may order at all and how much. Open the guard to see the mandate and the backtest.", href: "/guard" },
    { title: "Two agents negotiate, code guards every offer", body: "The buyer's agent and the supplier's agent trade offers inside the mandate and the floor. Watch the rounds; the model only writes the words, the numbers come from the guards. On agreement the quote is hashed and signed.", href: "/negotiations" },
    { title: "The money is held, not paid", body: "Accepting the quote places a PayPal authorization for the agreed total. The dry run checks the kill switch, the mandate, provenance and live PayPal state first. Nothing is captured yet; after three days the hold is reauthorized.", href: "/home" },
    { title: "Receive at the dock", body: "The receiver photographs the delivery note on a phone. The reader proposes counts (instructions in the document are quarantined), a person confirms, and the receipt is versioned.", href: "/dock" },
    { title: "Resolve and pay correctly", body: "A clean receipt settles by code: capture what was accepted, release the rest, re-plan any replacement under the same spending limit. A disputed line needs both sides to agree. Charges above the threshold wait for the owner's passkey.", href: "/ledger" },
    { title: "Try to break it", body: "The arena table on the evidence page shows hostile agents, models and documents failing to move money. Flip the kill switch and watch a request get denied before PayPal; open a dispute and send the evidence pack.", href: "/evidence" },
  ];
  r.get(
    "/judge",
    page(async (req, res) => {
      const db = await getDb();
      const p = await me(req);
      let id = typeof req.query.s === "string" ? req.query.s : null;
      let beat = 0;
      if (id) {
        const row = (await db.query<any>("SELECT * FROM judge_sessions WHERE id = $1", [id])).rows[0];
        if (row) {
          beat = Math.min(BEATS.length - 1, Math.max(0, Number(req.query.b ?? row.beat)));
          await db.query("UPDATE judge_sessions SET beat = $2, last_seen = now() WHERE id = $1", [id, beat]);
        } else id = null;
      }
      if (!id) {
        id = newId("jdg");
        await db.query("INSERT INTO judge_sessions (id, persona) VALUES ($1, $2)", [id, String(req.query.persona ?? "judge")]);
      }
      const b = BEATS[beat];
      res.send(
        layout(
          { title: "Judge mode", who: whoOf(p) },
          html`<h1>Three minutes, six beats</h1><p class="sub">A guided walk through the whole loop. Each beat opens the right page; the trace and evidence are live, not screenshots. Sign in as the demo buyer owner from <a href="/demo">/demo</a> first.</p>
<ol class="beats">${raw(BEATS.map((x, i) => `<li class="${i === beat ? "now" : i < beat ? "done" : ""}"><a href="/judge?s=${id}&b=${i}">${x.title}</a></li>`).join(""))}</ol>
<div class="card"><h2>${beat + 1}. ${b.title}</h2><p>${b.body}</p><div class="row"><a class="btn primary" href="${b.href}" target="_blank" rel="noopener">Open</a>${beat + 1 < BEATS.length ? html`<a class="btn" href="/judge?s=${id}&b=${beat + 1}">Next beat</a>` : html`<a class="btn" href="/evidence">Evidence page</a>`}</div></div>
<p class="small muted">Sandbox only. The demo buyer, supplier and receiver are seeded.</p>`,
        ),
      );
    }, () => "/"),
  );

  // ---- Channels (roadmap B.8) ----
  r.get(
    "/channels",
    page(async (req, res) => {
      const p = await me(req);
      const addr = typeof req.query.address === "string" ? req.query.address : p ? addressOf(p) : "";
      const msgs = addr ? await conversation(addr, 60) : await recentMessages(60);
      const tgLinked = p ? Number((await (await getDb()).query<any>("SELECT count(*)::int AS n FROM channel_links WHERE channel = 'telegram' AND party_id = $1", [p.org_id])).rows[0]?.n ?? 0) > 0 : false;
      res.send(
        layout(
          { title: "Messages", who: whoOf(p), flash: flashOf(req) },
          html`<div class="page-head"><div><h1>Messages and alerts</h1><p>Orders, approvals and receipts reach owners and suppliers on their phone.</p></div></div>
${p ? html`<section class="card" id="phone"><h2>Alerts on your phone</h2><p class="sub muted">${p.org_kind === "buyer" ? "Held captures and refunds arrive on Telegram with Approve and Decline buttons." : "New orders, quotes and receipts arrive on Telegram as they happen."}</p><div class="row">${tgLinked ? html`<span class="pill good">Telegram connected</span>` : html`<span class="pill">Telegram not connected</span>`}<form method="post" action="/connect/telegram" class="inline" target="_blank"><button class="btn primary" type="submit">${raw(icon("message"))}${tgLinked ? "Connect another chat" : "Connect Telegram"}</button></form><button class="btn" id="push-sub" type="button">${raw(icon("zap"))}Turn on notifications in this browser</button></div><p class="small muted">Telegram opens with a one-time code that expires in 15 minutes; press Start and you're done.</p></section><script src="/static/pwa.js" defer></script>` : ""}
<div class="section-title"><h2>Message simulator</h2><p>What the live channels would send, and your replies.</p></div>
<form class="row" method="get" action="/channels"><input type="text" name="address" value="${addr}" placeholder="buyer:<org id>, supplier:<org id> or driver:<person id>"><button class="btn small">Show</button></form>
<div class="chat">${raw(
  (msgs as any[])
    .slice()
    .reverse()
    .map((m) => `<div class="msg ${m.direction}"><div class="meta small muted">${m.channel} · ${String(m.address).replace(/</g, "&lt;")} · ${fmtDate(m.created_at)} · ${m.status}</div><div class="body">${String(m.body).replace(/</g, "&lt;")}</div>${m.buttons && m.direction === "out" ? `<div class="row">${(m.buttons as any[]).map((b) => `<form method="post" action="/channels/reply" class="inline"><input type="hidden" name="address" value="${String(m.address).replace(/"/g, "&quot;")}"><input type="hidden" name="replyTo" value="${m.id}"><input type="hidden" name="buttonId" value="${String(b.id).replace(/"/g, "&quot;")}"><button class="btn small">${String(b.label).replace(/</g, "&lt;")}</button></form>`).join("")}</div>` : ""}</div>`)
    .join(""),
)}</div>
${addr ? html`<form method="post" action="/channels/reply" class="row"><input type="hidden" name="address" value="${addr}"><input type="text" name="text" placeholder="Reply as this party (try: pending, orders, today)" required maxlength="500"><button class="btn primary small">Send</button></form>` : ""}`,
        ),
      );
    }, () => "/"),
  );
  /** One tap: a 15-minute one-time code, then straight into Telegram; the shared bot routes "stocksure-<code>" here. */
  r.post(
    "/connect/telegram",
    page(async (req, res) => {
      const p = await me(req);
      if (!p) return res.redirect("/login?next=/channels");
      const code = randomBytes(12).toString("base64url").replace(/[-_]/g, "x");
      await (await getDb()).query("INSERT INTO settings (key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [`tglink:${code}`, JSON.stringify({ party: p.org_kind === "buyer" ? "buyer" : "supplier", party_id: p.org_id, exp: Date.now() + 15 * 60_000 })]);
      res.redirect(303, `https://t.me/${config.channels.telegramBot}?start=stocksure-${code}`);
    }),
  );
  r.post(
    "/channels/reply",
    page(async (req, res) => {
      const address = String(req.body.address ?? "");
      if (!/^(buyer|supplier|driver):/.test(address)) throw new GtError("Simulator addresses look like buyer:<org id>", "validation", 422);
      await receive("simulator", address, String(req.body.text ?? req.body.buttonId ?? ""), req.body.buttonId ? String(req.body.buttonId) : null, req.body.replyTo ? String(req.body.replyTo) : null);
      back(res, `/channels?address=${encodeURIComponent(address)}`, "Sent");
    }, (req) => `/channels?address=${encodeURIComponent(String(req.body?.address ?? ""))}`),
  );
  r.post("/webhooks/telegram", async (req, res) => {
    const secret = req.header("x-telegram-bot-api-secret-token") ?? "";
    if (config.channels.telegramSecret && !safeEq(secret, config.channels.telegramSecret)) return res.status(401).end();
    try {
      await telegramUpdate(req.body);
    } catch (e) {
      console.error("[telegram]", (e as Error).message);
    }
    res.json({ ok: true });
  });
  r.get("/webhooks/whatsapp", (req, res) => {
    if (req.query["hub.mode"] === "subscribe" && typeof req.query["hub.verify_token"] === "string" && safeEq(String(req.query["hub.verify_token"]), config.channels.whatsappVerifyToken)) return res.send(String(req.query["hub.challenge"]));
    res.status(403).end();
  });
  r.post("/webhooks/whatsapp", async (req, res) => {
    try {
      await whatsappUpdate(req.body);
    } catch (e) {
      console.error("[whatsapp]", (e as Error).message);
    }
    res.json({ ok: true });
  });
  r.post(
    "/channels/link",
    json(async (req) => {
      const p = await me(req);
      if (!p) throw new GtError("Sign in", "unauthorized", 401);
      const channel = String(req.body.channel);
      if (channel !== "telegram" && channel !== "whatsapp") throw new GtError("channel must be telegram or whatsapp", "validation", 422);
      const party: Party = p.org_kind === "buyer" ? "buyer" : "supplier";
      await link(channel, String(req.body.address), party, p.org_id);
      return { linked: true };
    }),
  );

  // ---- PWA (roadmap B.10) ----
  r.get("/manifest.webmanifest", (_req, res) => {
    res.type("application/manifest+json").json({
      name: "StockSure",
      short_name: "StockSure",
      start_url: "/dock",
      display: "standalone",
      background_color: "#0f172a",
      theme_color: "#234e8a",
      icons: [{ src: "/static/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
    });
  });
  r.get("/sw.js", (_req, res) => {
    res.type("application/javascript").set("Service-Worker-Allowed", "/").send(readFileSync("public/sw.js", "utf8"));
  });
  r.get("/push/public-key", (_req, res) => res.json({ key: config.channels.vapidPublic || null }));
  r.post(
    "/push/subscribe",
    json(async (req) => {
      const p = await me(req);
      if (!p) throw new GtError("Sign in", "unauthorized", 401);
      if (!req.body?.endpoint) throw new GtError("Subscription missing", "validation", 422);
      await subscribe(p.org_kind === "buyer" ? "buyer" : "supplier", p.org_id, req.body);
      return { subscribed: true, live: pushReady() };
    }),
  );

  return r;
}
