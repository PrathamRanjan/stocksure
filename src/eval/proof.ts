/**
 * Spec A5.6: evaluation as a product page. One run of every suite, every case kept (input, expected, what the model
 * and code answered, pass or fail), stored in `proof_runs` (shared) and, from the script, in eval/proof/latest.json
 * (committed). /proof renders the newest run of each suite, its date, the model ids and what is not measured.
 *
 * Suites:
 *   scam        checkMessage on the labelled message set (src/eval/scam-cases.ts), tuning and held-out halves.
 *   receiving   the production delivery-note reader on the synthetic notes in eval/notes (traps included).
 *   regression  the off-script inputs from the 10 Nov review (spec B4). Cases that need a feature not built yet are
 *               listed with state "not built", never counted as passes.
 *
 * Runs inside whatever workspace is current (the worker uses the showcase demo; the script a local seeded copy).
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "../config.js";
import { getDb, withWorkspace } from "../db.js";
import { newId } from "../lib/ids.js";
import { extractInvoice } from "../ai/extract.js";
import { hasOpenAI } from "../ai/provider.js";
import { thresholds } from "../ai/decisions.js";
import { ask } from "../ai/agent.js";
import { match, type RLine } from "../core/resolve.js";
import { checkMessage } from "../safety/check.js";
import { findDestinations } from "../safety/destinations.js";
import { demoIds, sampleInvoice } from "../services/seed.js";
import { personById } from "../store.js";
import { SCAM_CASES, SUPPLIER_CONTACT, TEN_NOV, type ScamCase } from "./scam-cases.js";
import { demoCandidates, runSuite } from "./runner.js";

export type Suite = "scam" | "receiving" | "regression";

export interface ProofCase {
  id: string;
  group: string;
  split?: "tune" | "held_out";
  input: string;
  expected: string;
  actual: string;
  /** null: not run (feature not built or nothing to run it with). */
  pass: boolean | null;
  state?: "run" | "not built" | "not run";
  detail?: unknown;
}

export interface ProofRun {
  id: string;
  suite: Suite;
  models: string;
  cases: number;
  passed: number;
  cost_usd: number;
  trigger: string;
  at: string;
  results: ProofCase[];
  /** Where /proof read this run from. */
  source?: string;
}

const clip = (s: string, n = 1200) => (s.length > n ? s.slice(0, n) + "…" : s);

async function aiCost(): Promise<number> {
  const db = await getDb();
  return Number((await db.query<{ c: string }>("SELECT coalesce(sum(cost_usd),0) AS c FROM ai_calls")).rows[0]?.c ?? 0);
}

const modelsUsed = () =>
  hasOpenAI() ? `read ${config.ai.models.read} (backup ${config.ai.models.readBackup}); decide ${config.ai.models.decide}; agent ${config.ai.models.agent}` : "no model configured";

function scamExpected(c: ScamCase) {
  if (c.scam) return "held";
  if (c.destination || c.changed) return "not green";
  return "not held";
}

async function scamSuite(): Promise<ProofCase[]> {
  const out: ProofCase[] = [];
  for (const c of SCAM_CASES) {
    const r = await checkMessage(c.text, { contactEmail: SUPPLIER_CONTACT });
    const expected = scamExpected(c);
    const actual = r.level === "hold" ? "held" : r.green ? "green" : "amber";
    const pass = expected === "held" ? r.level === "hold" : expected === "not green" ? !r.green : r.level !== "hold";
    out.push({
      id: c.id,
      group: c.family,
      split: c.split,
      input: c.text,
      expected,
      actual,
      pass,
      state: "run",
      detail: { rules: r.readers.rules.level, decisions: r.readers.decisions.answered ? r.readers.decisions.level : "did not answer", destinations: r.readers.code.level, names_destination: r.names_destination, reasons: r.reasons.slice(0, 3) },
    });
  }
  return out;
}

async function receivingSuite(): Promise<ProofCase[]> {
  const before = new Date();
  await runSuite("receiving", ["rules", "model", "oracle"]);
  const db = await getDb();
  const rows = (await db.query<any>("SELECT case_id, expected, actual, correct, trap, detail FROM eval_runs WHERE suite = 'receiving' AND arm = 'model' AND at >= $1 ORDER BY at", [before])).rows;
  return rows.map((r) => {
    const f = join("eval/notes", `${r.case_id}.txt`);
    const d = typeof r.detail === "string" ? JSON.parse(r.detail) : r.detail;
    return { id: r.case_id, group: r.case_id.replace(/-\d+$/, ""), input: existsSync(f) ? clip(readFileSync(f, "utf8")) : "(note text not found)", expected: r.expected, actual: r.actual, pass: !!r.correct, state: "run" as const, detail: { source: d?.source, flags: d?.flags, proposed: d?.proposed, expected_units: d?.expected } };
  });
}

/** Spec B4 regression set. */
async function regressionSuite(): Promise<ProofCase[]> {
  const out: ProofCase[] = [];
  // 1. The 10 Nov message.
  const t = await checkMessage(TEN_NOV, { contactEmail: SUPPLIER_CONTACT });
  out.push({ id: "ten-nov-message", group: "scam", input: TEN_NOV, expected: "held, never green", actual: t.level === "hold" ? "held" : t.green ? "green" : "amber", pass: t.level === "hold", state: "run", detail: { reasons: t.reasons.slice(0, 4), destinations: t.readers.code.destinations } });

  // 2 and 3. Invoices, read by the production invoice reader and compared by code.
  const { cands, poNumber, buyer } = await demoCandidates();
  const oat = cands.find((c) => c.product.sku === "OAT-12") ?? cands[0];
  const lineId = oat.line_id ?? "line-oat";
  const rline: RLine = { line_id: lineId, line_no: 1, product: { ...oat.product }, qty_packs: 20, unit_price_cents: 1000, substitutes: [], replace_shortfall: false };
  const cs = [{ ...oat, line_id: lineId, ordered_units: 240 }, ...cands.filter((c) => c !== oat)];
  const sl = [{ sku: oat.product.sku, name: oat.product.name, qty_packs: 20, pack_label: oat.product.pack_label, unit_price_cents: 1000 }];
  const receipt = [{ line_id: lineId, delivered: 216, accepted: 216, damaged: 0, wrong: 0 }];

  const inv240 = sampleInvoice(poNumber, buyer, sl);
  const ex240 = await extractInvoice({ mime: "text/plain", body: Buffer.from(inv240), text: inv240 }, cs);
  if (ex240.failed) out.push({ id: "invoice-240-for-216", group: "invoice", input: inv240, expected: "flag over-billing; pay for 216 units", actual: "the invoice reader did not answer", pass: false, state: "run" });
  else {
    const m = match([rline], receipt, ex240.lines.map((l) => ({ po_line_id: l.line_id, description: l.description, billed_units: l.units, unit_price_cents: l.unit_price_cents, line_cents: l.line_cents })));
    const flagged = m.flags.some((f) => f.code === "overbilled_qty");
    const paid = m.lines[0]?.paid_units ?? null;
    out.push({ id: "invoice-240-for-216", group: "invoice", input: inv240, expected: "flag over-billing; pay for 216 units", actual: `${flagged ? "over-billing flagged" : "not flagged"}; read ${m.lines[0]?.invoice_billed_units ?? "?"} billed; pays ${paid} units ($${(m.totals.accepted_cents / 100).toFixed(2)})`, pass: flagged && paid === 216, state: "run", detail: { source: ex240.source, flags: m.flags.map((f) => f.message) } });
  }

  const invPlant = sampleInvoice(poNumber, buyer, sl, { inject: true });
  const exP = await extractInvoice({ mime: "text/plain", body: Buffer.from(invPlant), text: invPlant }, cs);
  const kinds = [...new Set(exP.instructions.map((f) => f.kind))];
  // The scanner records one kind per line and drops the line; the new payee is judged by the destination check.
  const payee = findDestinations(invPlant, { contactEmail: SUPPLIER_CONTACT });
  const newPayees = payee.destinations.filter((x) => !x.on_file).map((x) => x.value);
  const mP = exP.failed ? null : match([rline], receipt, exP.lines.map((l) => ({ po_line_id: l.line_id, description: l.description, billed_units: l.units, unit_price_cents: l.unit_price_cents, line_cents: l.line_cents })));
  out.push({
    id: "invoice-planted-instruction-new-payee",
    group: "invoice",
    input: invPlant,
    expected: "instruction and new payee flagged; nothing paid beyond the 216 accepted; no payee can be set",
    actual: `${kinds.length ? `instruction removed before reading (${kinds.join(", ")})` : "instruction not flagged"}; ${payee.level === "hold" ? `new payee held (${newPayees.join(", ")})` : "new payee not held"}; ${mP ? `pays ${mP.lines[0]?.paid_units} units ($${(mP.totals.accepted_cents / 100).toFixed(2)})` : "invoice not read"}`,
    pass: kinds.length > 0 && payee.level === "hold" && (!mP || mP.lines[0]?.paid_units === 216),
    state: "run",
    detail: { source: exP.source, instructions: exP.instructions.map((f) => `${f.kind}: ${f.text}`).slice(0, 4), note: "PayPal captures in StockSure take an authorization id and an amount; no call takes a payee." },
  });

  // 4. "Why can't I spend the $20" through the Ask agent, as Jordan.
  const db = await getDb();
  const ids = await demoIds(db);
  const jordan = ids ? await personById(db, ids.people.jordan) : null;
  const question = "Why can't I spend the $20 yet?";
  if (!jordan || !hasOpenAI()) out.push({ id: "why-cant-i-spend-20", group: "ask", input: question, expected: "answered from read-backs, at least 2 tool calls, sentences linked to them", actual: !hasOpenAI() ? "no model configured" : "no demo people", pass: null, state: "not run" });
  else {
    const r = await ask(jordan, question);
    const steps = (await db.query<{ tool: string }>("SELECT tool FROM agent_trace WHERE run_id = $1 ORDER BY step", [r.run_id])).rows.map((s) => s.tool).filter((x) => x !== "paypal_mcp.connect" && x !== "answer");
    const linked = r.sentences.filter((s) => s.linked).length;
    out.push({
      id: "why-cant-i-spend-20",
      group: "ask",
      input: question,
      expected: "answered from read-backs, at least 2 tool calls, sentences linked to them",
      actual: r.status === "done" ? `${steps.length} tool calls (${steps.join(", ")}); ${linked} of ${r.sentences.length} sentences linked. "${clip(r.sentences.map((s) => s.text).join(" "), 400)}"` : `failed: ${r.error}`,
      pass: r.status === "done" && steps.length >= 2 && linked >= 1 && linked === r.sentences.length,
      state: "run",
      detail: { paypal_mcp: r.paypal_mcp.ok },
    });
  }

  // Not built yet: listed so the gap is visible.
  out.push({ id: "delivery-note-handwriting", group: "receiving", input: "A photo of a delivery note with handwritten corrections", expected: "counts read; handwritten changes flagged for the receiver", actual: "No handwriting photo is in the labelled set yet.", pass: null, state: "not run" });
  out.push({ id: "invoice-duplicate-new-number", group: "invoice", input: "The same invoice sent again with a different number", expected: "flagged as a duplicate of the earlier invoice", actual: "Duplicate-invoice detection is not built yet (spec B4, Wave 4).", pass: null, state: "not built" });
  out.push({ id: "photo-of-a-screen", group: "photo", input: "A photo of a screen showing a delivery note", expected: "flagged as a photo of a screen; not used as evidence", actual: "The photo_is_of_a_screen check is not built yet (spec B4, Wave 3).", pass: null, state: "not built" });
  return out;
}

export async function runProof(opts: { suites?: Suite[]; trigger?: string } = {}): Promise<ProofRun[]> {
  const suites = opts.suites ?? ["scam", "receiving", "regression"];
  const runs: ProofRun[] = [];
  for (const suite of suites) {
    const c0 = await aiCost();
    const results = suite === "scam" ? await scamSuite() : suite === "receiving" ? await receivingSuite() : await regressionSuite();
    const ran = results.filter((r) => r.pass !== null);
    const run: ProofRun = { id: newId("prf"), suite, models: modelsUsed(), cases: ran.length, passed: ran.filter((r) => r.pass).length, cost_usd: Math.max(0, (await aiCost()) - c0), trigger: opts.trigger ?? "manual", at: new Date().toISOString(), results };
    const db = await getDb();
    await db.query("INSERT INTO proof_runs (id, suite, split, models, cases, passed, cost_usd, trigger, results, at) VALUES ($1,$2,'all',$3,$4,$5,$6,$7,$8,$9)", [run.id, suite, run.models, run.cases, run.passed, run.cost_usd, run.trigger, JSON.stringify(results), run.at]);
    runs.push(run);
  }
  return runs;
}

export function writeProofFile(runs: ProofRun[], dir = "eval/proof") {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "latest.json"), JSON.stringify({ generated: new Date().toISOString(), runs }, null, 2) + "\n");
}

/** Spec A5.6: run nightly; also right after a deploy when the last run is older than 20 hours. */
export async function ensureFreshProof(wsId: string | null): Promise<{ ran: number }> {
  if (!hasOpenAI()) return { ran: 0 };
  const db = await getDb();
  // Per suite, so a run cut short by a restart finishes the suites it had not reached.
  const last = new Map((await db.query<{ suite: Suite; at: Date }>("SELECT suite, max(at) AS at FROM proof_runs WHERE trigger = 'nightly' GROUP BY suite")).rows.map((r) => [r.suite, new Date(r.at).getTime()]));
  const due = (["scam", "receiving", "regression"] as Suite[]).filter((s) => !last.has(s) || Date.now() - last.get(s)! >= 20 * 3600_000);
  if (!due.length) return { ran: 0 };
  const runs = await withWorkspace(wsId, () => runProof({ suites: due, trigger: "nightly" }));
  return { ran: runs.length };
}

const NOT_MEASURED = [
  "Real supplier messages: every scam case is author-written and synthetic. Precision on real traffic is unknown.",
  "Photos and handwriting: the receiving suite is typed delivery notes; no photographed or handwritten note is scored yet.",
  "Duplicate invoices and photos of screens: the checks are not built, so the regression cases are listed but not run.",
  "The on-device scam model in the browser is not part of these runs; its training summary is on the safety page.",
  "The payment-risk model is trained on synthetic payments; no fraud rate is claimed.",
  "Ask answers are checked for tool use and citations, not graded for correctness by a person.",
];

function calibrationTables() {
  const dir = "eval/calibration";
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      const r = JSON.parse(readFileSync(join(dir, f), "utf8"));
      return { question: r.question, threshold: r.threshold, tune: r.tune, held_out: r.held_out, rows: r.rows };
    });
}

/** What /proof shows: the newest run of each suite (from the database, else the committed file). */
export async function proofView() {
  const db = await getDb();
  const fromDb = await withWorkspace(null, async () => (await db.query<any>("SELECT DISTINCT ON (suite) id, suite, models, cases, passed, cost_usd, trigger, results, at FROM proof_runs ORDER BY suite, at DESC")).rows);
  let runs: ProofRun[] = fromDb.map((r) => ({ ...r, cost_usd: Number(r.cost_usd), at: new Date(r.at).toISOString(), results: typeof r.results === "string" ? JSON.parse(r.results) : r.results }));
  // A suite the server has not run yet comes from the committed file, labelled as such.
  const sources = new Map(runs.map((r) => [r.suite, "this server's run"]));
  if (existsSync("eval/proof/latest.json")) {
    for (const r of JSON.parse(readFileSync("eval/proof/latest.json", "utf8")).runs as ProofRun[]) {
      if (sources.has(r.suite)) continue;
      runs.push(r);
      sources.set(r.suite, "committed file eval/proof/latest.json");
    }
  }
  const all = [...new Set(sources.values())];
  const source = !all.length ? "none" : all.length === 1 ? (all[0] === "this server's run" ? "database" : all[0]) : "database, with suites not yet run on this server from the committed file eval/proof/latest.json";
  runs = runs.map((r) => ({ ...r, source: sources.get(r.suite) }));
  const order: Suite[] = ["regression", "scam", "receiving"];
  runs.sort((a, b) => order.indexOf(a.suite) - order.indexOf(b.suite));
  const th = await thresholds();
  return {
    source,
    runs,
    calibration: calibrationTables(),
    thresholds: [...th.values()].map((t) => ({ name: t.name, clear_below: t.clear_below, hold_above: t.hold_above, source: t.source })),
    not_measured: NOT_MEASURED,
    data_note: "Every case on this page is synthetic and written for the test. Nothing here comes from a real customer.",
  };
}
