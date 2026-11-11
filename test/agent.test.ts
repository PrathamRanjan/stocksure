/**
 * Spec A5.3: the agent loop. A stand-in for the Responses API asks for tools the way the real one does
 * (function_call items), then answers; the loop runs the tools, records every step, and links each sentence to the
 * tool calls it cites. No network.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { config } from "../src/config.js";
import { openDb, setDb, type Db } from "../src/db.js";
import { setProviderFetch } from "../src/ai/provider.js";
import { ask, AGENT_FAILED_MESSAGE } from "../src/ai/agent.js";
import { AGENT_TOOLS } from "../src/ai/agent-tools.js";
import { READ_TOOLS, WRITE_WORDS } from "../src/ai/paypal-mcp.js";
import { seedDemo, type DemoIds } from "../src/services/seed.js";
import { personById, type Person } from "../src/store.js";
import { createApp } from "../src/app.js";
import { Client } from "./client.js";
import type { Server } from "node:http";

let db: Db;
let ids: DemoIds;
let jordan: Person;
const saved = { key: config.ai.openaiKey, provider: config.ai.provider, steps: config.ai.agentMaxSteps };
let bodies: any[] = [];

/** Each turn of the script is either tool calls or a final answer. */
function script(turns: ({ calls: { name: string; args: Record<string, unknown> }[] } | { answer: unknown })[]) {
  let i = 0;
  setProviderFetch((async (_u: any, init: any) => {
    const body = JSON.parse(String(init.body));
    bodies.push(body);
    const t = turns[Math.min(i++, turns.length - 1)];
    const output = "calls" in t ? t.calls.map((c, j) => ({ type: "function_call", call_id: `call_${i}_${j}`, name: c.name, arguments: JSON.stringify(c.args) })) : [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(t.answer) }] }];
    return new Response(JSON.stringify({ model: "gpt-6.1-sol", output, usage: { input_tokens: 1000, output_tokens: 100 } }), { status: 200 });
  }) as typeof fetch);
}

beforeEach(async () => {
  db = await openDb({ memory: true });
  setDb(db);
  ids = (await db.tx((q) => seedDemo(q))).ids;
  jordan = (await personById(db, ids.people.jordan))!;
  bodies = [];
  config.ai.openaiKey = "sk-test";
  config.ai.provider = "openai";
});
afterEach(async () => {
  setProviderFetch(null);
  Object.assign(config.ai, { openaiKey: saved.key, provider: saved.provider, agentMaxSteps: saved.steps });
  await db.close();
});

describe("agent loop", () => {
  it("runs the tools it asks for, records every step and links each sentence to a tool call", async () => {
    const number = (await db.query<{ number: string }>("SELECT number FROM purchase_orders WHERE id = $1", [ids.demoPo])).rows[0].number;
    script([
      { calls: [{ name: "spendable", args: { po: number } }, { name: "payment_ops", args: { po: number } }] },
      { answer: { sentences: [{ text: "Nothing is held yet.", cites: ["t1"] }, { text: "A guess with no source.", cites: ["t9"] }], could_not_answer: null } },
    ]);
    const r = await ask(jordan, "Why can't I spend the $20 yet?");
    expect(r.status).toBe("done");
    expect(r.sentences).toEqual([
      { text: "Nothing is held yet.", cites: ["t1"], linked: true },
      { text: "A guess with no source.", cites: [], linked: false },
    ]);
    const steps = (await db.query<any>("SELECT tool, actor, args FROM agent_trace WHERE run_id = $1 ORDER BY step", [r.run_id])).rows;
    // The unlinked sentence was sent back once; the model sent the same answer, so it stays marked "not linked".
    expect(steps.map((s) => s.tool)).toEqual(["paypal_mcp.connect", "spendable", "payment_ops", "answer", "answer.check_links"]);
    expect(steps[4].args).toMatchObject({ unlinked: 1 });
    expect(bodies[2].tool_choice).toBe("none");
    expect(bodies[2].input.at(-1).content[0].text).toMatch(/A guess with no source/);
    expect(steps[1].args.cite_as).toBe("t1");
    // The second request carries the tool outputs back, tagged with their citation ids.
    const outputs = bodies[1].input.filter((x: any) => x.type === "function_call_output");
    expect(outputs).toHaveLength(2);
    expect(JSON.parse(outputs[0].output).cite_as).toBe("t1");
    expect(JSON.parse(outputs[0].output).result.rule).toMatch(/read-back/);
    expect(bodies[0].tools.map((t: any) => t.name)).toContain("propose_message_to_supplier");
    // PayPal MCP is off in tests: the rail says so instead of hiding it.
    expect(r.paypal_mcp.ok).toBe(false);
    const q = (await db.query<any>("SELECT status, cost_usd FROM agent_questions WHERE id = $1", [r.id])).rows[0];
    expect(q.status).toBe("done");
    expect(Number(q.cost_usd)).toBeGreaterThan(0);
  });

  it("an unlinked sentence is sent back once and the repaired answer is kept only when it links more", async () => {
    const number = (await db.query<{ number: string }>("SELECT number FROM purchase_orders WHERE id = $1", [ids.demoPo])).rows[0].number;
    script([
      { calls: [{ name: "spendable", args: { po: number } }] },
      { answer: { sentences: [{ text: "Nothing is held yet.", cites: ["t1"] }, { text: "Hope that helps!", cites: [] }], could_not_answer: null } },
      { answer: { sentences: [{ text: "Nothing is held yet.", cites: ["t1"] }], could_not_answer: null } },
    ]);
    const r = await ask(jordan, "Why can't I spend the $20 yet?");
    expect(r.sentences).toEqual([{ text: "Nothing is held yet.", cites: ["t1"], linked: true }]);
    const last = (await db.query<any>("SELECT tool, result FROM agent_trace WHERE run_id = $1 ORDER BY step DESC LIMIT 1", [r.run_id])).rows[0];
    expect(last.tool).toBe("answer.check_links");
    expect(last.result).toMatchObject({ resent: true, unlinked_after: 0, kept: "repaired answer" });
  });

  it("a draft message is recorded, not sent", async () => {
    const number = (await db.query<{ number: string }>("SELECT number FROM purchase_orders WHERE id = $1", [ids.demoPo])).rows[0].number;
    const before = (await db.query<{ n: string }>("SELECT count(*) AS n FROM messages")).rows[0].n;
    script([{ calls: [{ name: "propose_message_to_supplier", args: { po: number, text: "Could you send the 2 cases on Thursday?" } }] }, { answer: { sentences: [{ text: "I drafted it.", cites: ["t1"] }], could_not_answer: null } }]);
    const r = await ask(jordan, "Draft a note asking for the replacement on Thursday");
    expect(r.proposals).toMatchObject([{ id: "prp_1", text: "Could you send the 2 cases on Thursday?" }]);
    expect((await db.query<{ n: string }>("SELECT count(*) AS n FROM messages")).rows[0].n).toBe(before);
  });

  it("stops at the step cap and shows the plain failure, never the raw error", async () => {
    config.ai.agentMaxSteps = 2;
    script([{ calls: [{ name: "list_orders", args: { status: null } }] }]);
    const r = await ask(jordan, "loop forever");
    expect(r.status).toBe("failed");
    expect(r.error).toBe(AGENT_FAILED_MESSAGE);
    setProviderFetch((async () => new Response("rate limited", { status: 400 })) as typeof fetch);
    const r2 = await ask(jordan, "anything");
    expect(r2.error).toBe(AGENT_FAILED_MESSAGE);
    expect(JSON.stringify(r2)).not.toMatch(/OpenAI 400/);
  });

  it("records of another organisation are not reachable", async () => {
    const other = (await db.query<{ number: string }>("SELECT number FROM purchase_orders WHERE buyer_id <> $1 LIMIT 1", [jordan.org_id])).rows[0];
    if (!other) return;
    script([{ calls: [{ name: "order", args: { po: other.number } }] }, { answer: { sentences: [{ text: "Not found.", cites: ["t1"] }], could_not_answer: null } }]);
    const r = await ask(jordan, `Show me ${other.number}`);
    const step = (await db.query<any>("SELECT result FROM agent_trace WHERE run_id = $1 AND tool = 'order'", [r.run_id])).rows[0];
    expect(step.result.error).toMatch(/No order/);
  });
});

describe("Ask over HTTP", () => {
  it("starts a question, streams its steps and ends with the stored answer", async () => {
    const server: Server = createApp().listen(0);
    const base = `http://127.0.0.1:${(server.address() as any).port}`;
    try {
      const c = new Client(base);
      expect((await c.get("/api/ui/ask")).status).toBe(401);
      expect((await c.req("POST", "/login", { form: { person_id: jordan.id, next: "/ask" } })).status).toBe(302);
      expect((await c.get("/ask")).status).toBe(200);
      const info = (await c.get("/api/ui/ask")).json;
      expect(info).toMatchObject({ ready: true, left_today: config.ai.agentDailyQuestions });
      script([{ calls: [{ name: "list_orders", args: { status: null } }] }, { answer: { sentences: [{ text: "You have orders.", cites: ["t1"] }], could_not_answer: null } }]);
      const start = await c.req("POST", "/api/ui/ask", { json: { question: "How many orders do I have?" } });
      expect(start.json).toMatchObject({ ok: true });
      const ev = await c.get(`/api/ui/ask/${start.json.id}/events`);
      expect(ev.headers.get("content-type")).toMatch(/text\/event-stream/);
      expect(ev.text).toMatch(/event: step/);
      expect(ev.text).toMatch(/event: done/);
      const st = (await c.get(`/api/ui/ask/${start.json.id}`)).json;
      expect(st.status).toBe("done");
      expect(st.steps.find((s: any) => s.tool === "list_orders")).toMatchObject({ cite_as: "t1", actor: "code" });
      expect(st.answer.sentences[0]).toMatchObject({ linked: true });
      expect((await c.req("POST", "/api/ui/ask", { json: { question: "" } })).status).toBe(400);
      config.ai.agentDailyQuestions = 1;
      expect((await c.req("POST", "/api/ui/ask", { json: { question: "again?" } })).json.message).toMatch(/used its 1 questions/);
    } finally {
      config.ai.agentDailyQuestions = 25;
      server.close();
    }
  });
});

describe("structural: no tool the agent is offered can move money (spec A5.3)", () => {
  it("own tools are reads or drafts only", () => {
    for (const t of AGENT_TOOLS) {
      expect(["read", "propose"]).toContain(t.kind);
      if (t.kind === "propose") expect(t.name.startsWith("propose_")).toBe(true);
      expect(t.name).not.toMatch(/^(capture|refund|void|authorize|pay_|send|create|update|delete|accept|approve)/);
    }
  });
  it("PayPal MCP tools are an allowlist of reads", () => {
    for (const n of READ_TOOLS) expect(n, n).not.toMatch(WRITE_WORDS);
    for (const n of ["create_order", "pay_order", "create_refund", "send_invoice", "cancel_sent_invoice", "accept_dispute_claim", "update_subscription"]) expect(READ_TOOLS as readonly string[]).not.toContain(n);
  });
  it("the agent module never imports the PayPal client or the money services", async () => {
    const { readFileSync } = await import("node:fs");
    for (const f of ["src/ai/agent.ts", "src/ai/agent-tools.ts", "src/ai/paypal-mcp.ts"]) {
      const src = readFileSync(f, "utf8");
      expect(src, f).not.toMatch(/from "\.\.\/paypal\/|from "\.\.\/services\/(settle|aftercare|funding|executor)|from "\.\.\/guard\/(release|executor)/);
    }
  });
});
