/**
 * Spec A5.3: the Ask page's API. A question starts an agent run that continues in the background; the AI work rail
 * follows it over server-sent events (each agent_trace row as it is written), and can reload it at any time.
 */
import { Router, type Request, type Response } from "express";
import { config } from "../config.js";
import { getDb } from "../db.js";
import { allowanceLeft, runQuestion, startQuestion } from "../ai/agent.js";
import { hasOpenAI } from "../ai/provider.js";
import { GtError } from "../lib/util.js";
import type { Person } from "../store.js";
import { me } from "./auth.js";

export const SUGGESTED: Record<string, string[]> = {
  buyer: ["Which supplier short-delivers most, and what did it cost?", "Why can't I spend the released money yet?", "What have I been charged this month, with the PayPal ids?", "Did any invoice bill more than we accepted?"],
  supplier: ["Which orders are waiting on me?", "What did Laneway Café accept on its last delivery?", "Which of my holds are still open on PayPal?"],
};

/** One step as the rail shows it: the tool, a one-line summary of its arguments and of its result, and the time. */
export function railStep(s: any) {
  const args = typeof s.args === "string" ? JSON.parse(s.args) : s.args ?? {};
  const result = typeof s.result === "string" ? JSON.parse(s.result) : s.result ?? {};
  const { cite_as, ...rest } = args ?? {};
  const argLine = Object.entries(rest).filter(([, v]) => v !== null && v !== "").map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`).join(", ").slice(0, 140);
  return { step: s.step, cite_as: cite_as ?? null, actor: s.actor, tool: s.tool, args: argLine, result: oneLine(s.tool, result), duration_ms: s.duration_ms, gate: s.gate, at: s.at, detail: result };
}

function oneLine(tool: string, r: any): string {
  if (!r || typeof r !== "object") return String(r ?? "").slice(0, 160);
  if (r.error) return `error: ${String(r.error).slice(0, 150)}`;
  if (tool === "paypal_mcp.connect") return r.read_tools ? `${r.read_tools.length} read tools: ${r.read_tools.join(", ")}` : "not connected";
  if (tool === "answer") return `answered in ${r.sentences} sentence${r.sentences === 1 ? "" : "s"}`;
  if (Array.isArray(r.orders)) return `${r.orders.length} orders`;
  if (Array.isArray(r.ops)) return `${r.ops.length} PayPal operations on ${r.order}`;
  if (Array.isArray(r.receipts)) return `${r.receipts.length} count${r.receipts.length === 1 ? "" : "s"} of ${r.number}`;
  if (Array.isArray(r.suppliers)) return r.suppliers.map((s: any) => `${s.supplier}: fill ${s.fill_rate_pct ?? "n/a"}%, not charged ${s.not_charged_short_or_damaged}`).join("; ").slice(0, 160);
  if (r.spendable_now !== undefined) return `charged ${r.charged}, held ${r.held_now}, releasing ${r.being_released}, spendable ${r.spendable_now}`;
  if (Array.isArray(r.lines) && r.number) return `${r.number}: ${r.lines.length} line${r.lines.length === 1 ? "" : "s"}, ${r.status ?? ""}`.trim();
  if (Array.isArray(r.deliveries)) return `${r.deliveries.length} past prices`;
  if (r.proposal_id) return `draft ${r.proposal_id}; nothing sent`;
  if (r.status && r.id) return `${r.id}: ${r.status}`;
  if (Array.isArray(r.items)) return `${r.items.length} item${r.items.length === 1 ? "" : "s"} from PayPal`;
  if (Array.isArray(r.transaction_details)) return `${r.transaction_details.length} transactions from PayPal`;
  if (r.ok === false) return `PayPal: ${String(r.message ?? r.code ?? "error").slice(0, 140)}`;
  return JSON.stringify(r).slice(0, 160);
}

async function need(req: Request): Promise<Person> {
  const p = await me(req);
  if (!p) throw new GtError("Sign in first.", "unauthorized", 401);
  return p;
}

async function state(id: string, p: Person) {
  const db = await getDb();
  const q = (await db.query<any>("SELECT * FROM agent_questions WHERE id = $1 AND org_id = $2", [id, p.org_id])).rows[0];
  if (!q) throw new GtError("Question not found", "not_found", 404);
  const steps = (await db.query<any>("SELECT step, actor, tool, args, result, gate, duration_ms, at FROM agent_trace WHERE run_id = $1 ORDER BY step", [q.run_id])).rows.map(railStep);
  const answer = typeof q.answer === "string" ? JSON.parse(q.answer) : q.answer;
  return { id: q.id, question: q.question, status: q.status, run_id: q.run_id, created_at: q.created_at, ended_at: q.ended_at, steps, answer, error: q.error };
}

const wrap = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response) =>
  fn(req, res).catch((e) => {
    const g = e instanceof GtError ? e : null;
    if (!g) console.error("[stocksure ask]", e);
    if (!res.headersSent) res.status(g?.status ?? 500).json({ error: g?.code ?? "error", message: g?.message ?? "Something went wrong." });
  });

export function askRouter() {
  const r = Router();

  r.get("/api/ui/ask", wrap(async (req, res) => {
    const p = await need(req);
    const db = await getDb();
    const recent = (await db.query<any>("SELECT id, question, status, created_at FROM agent_questions WHERE org_id = $1 ORDER BY created_at DESC LIMIT 10", [p.org_id])).rows;
    res.json({ ready: hasOpenAI(), model: config.ai.models.agent, max_steps: config.ai.agentMaxSteps, max_seconds: Math.round(config.ai.agentMaxMs / 1000), left_today: await allowanceLeft(db), per_day: config.ai.agentDailyQuestions, paypal_mcp: config.ai.paypalMcpUrl ? "PayPal MCP (sandbox), read tools only" : "off", suggested: SUGGESTED[p.org_kind ?? "buyer"] ?? [], recent });
  }));

  r.post("/api/ui/ask", wrap(async (req, res) => {
    const p = await need(req);
    const question = String(req.body?.question ?? "").trim();
    if (!question) throw new GtError("Ask a question first.", "invalid", 400);
    if (!hasOpenAI()) throw new GtError("The AI isn't configured on this server, so there's nothing to ask. The order pages show the same records.", "no_model", 503);
    const db = await getDb();
    if ((await allowanceLeft(db)) <= 0) throw new GtError(`This demo has used its ${config.ai.agentDailyQuestions} questions for today. The allowance comes back over the next 24 hours.`, "allowance_spent", 429);
    if ((await db.query("SELECT 1 FROM agent_questions WHERE org_id = $1 AND status = 'running' AND created_at > now() - interval '2 minutes'", [p.org_id])).rows.length) throw new GtError("One question at a time: the last one is still running.", "busy", 409);
    const started = await startQuestion(p, question);
    // The loop continues after this response, inside this request's workspace (AsyncLocalStorage carries it).
    void runQuestion(p, started.id).catch((e) => console.error("[stocksure ask run]", (e as Error).message));
    res.json({ ok: true, id: started.id });
  }));

  r.get("/api/ui/ask/:id", wrap(async (req, res) => {
    const p = await need(req);
    res.json(await state(req.params.id, p));
  }));

  r.get("/api/ui/ask/:id/events", wrap(async (req, res) => {
    const p = await need(req);
    await state(req.params.id, p);
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" });
    let sent = 0;
    let closed = false;
    req.on("close", () => (closed = true));
    const t0 = Date.now();
    while (!closed && Date.now() - t0 < 90_000) {
      const s = await state(req.params.id, p);
      // compression() buffers responses; flush after each event so the rail moves as the agent works.
      const flush = () => (res as unknown as { flush?: () => void }).flush?.();
      for (const st of s.steps.slice(sent)) res.write(`event: step\ndata: ${JSON.stringify(st)}\n\n`);
      flush();
      sent = s.steps.length;
      if (s.status !== "running") {
        res.write(`event: done\ndata: ${JSON.stringify({ status: s.status, answer: s.answer, error: s.error })}\n\n`);
        flush();
        break;
      }
      res.write(": tick\n\n");
      flush();
      await new Promise((r) => setTimeout(r, 400));
    }
    res.end();
  }));

  return r;
}
