/**
 * Wave 2 live acceptance check (spec Part C, Wave 2), run against the deployed site:
 *   npx tsx scripts/wave2-live-check.mts [https://pph-stocksure.onrender.com]
 * In a fresh private demo: the 10 Nov message is held when Ana posts it and when Jordan checks it; an Ask question
 * runs at least two tool calls with PayPal's MCP server connected; /proof shows today's date; the public pages load
 * with no token in them. The judge paths themselves are timed in a browser by web/e2e/judge-live.spec.ts.
 * Never prints a key, a token or a password.
 */
import { Client } from "../test/client.ts";
import { TEN_NOV } from "../src/eval/scam-cases.ts";

const base = (process.argv[2] ?? "https://pph-stocksure.onrender.com").replace(/\/$/, "");
const results: { check: string; ok: boolean; detail: string }[] = [];
const check = (name: string, ok: boolean, detail = "") => {
  results.push({ check: name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
};
const ui = { "x-stocksure-ui": "1" };
const post = (c: Client, path: string, form: Record<string, string> = {}) => c.req("POST", path, { form, headers: ui });
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

const health = (await new Client(base).get("/healthz")).json;
check("/healthz with commit", health?.ok === true, `commit ${String(health?.commit ?? "").slice(0, 7)}`);

// A fresh demo.
const v = new Client(base);
const t0 = Date.now();
check("start a demo", (await v.postJson("/demo/start", {})).json?.ok === true);
let ws: any = null;
for (let i = 0; i < 75; i++) {
  ws = (await v.get("/api/ui/workspace")).json;
  if (ws?.seed?.done) break;
  await wait(2000);
}
check("demo seeded", ws?.seed?.done === true && !ws?.seed?.stopped, `${ws?.seed?.confirmed}/${ws?.seed?.expected} in ${Math.round((Date.now() - t0) / 1000)} s`);
const people = (await v.get("/api/ui/people")).json.people as any[];
const id = (first: string) => people.find((p) => p.first === first)?.id;

// Judge page: five paths (Wave 4 added agents and invoice), nothing ticked yet.
const j0 = (await v.get("/api/public/judge")).json;
check("judge page has the five paths, none ticked", j0?.paths?.map((p: any) => p.id).join(",") === "short,scam,agents,invoice,ask" && j0.paths.every((p: any) => p.steps.every((s: any) => !s.done)));
const scamStep = j0.paths.find((p: any) => p.id === "scam").steps[0];
const po = /\/po\/([^?#/]+)/.exec(scamStep.to)?.[1];

// 1. The 10 Nov message, posted by Ana on the order, is held.
await post(v, "/login", { person_id: id("Ana"), next: "/home" });
const posted = await post(v, `/po/${po}/message`, { body: TEN_NOV });
check("Ana posts the 10 Nov message", posted.json?.ok === true, posted.json?.message ?? "");
await post(v, "/login", { person_id: id("Jordan"), next: "/home" });
let msg: any = null;
for (let i = 0; i < 20 && !msg?.scan; i++) {
  const m = (await v.get(`/api/ui/po/${po}`)).json;
  msg = (m?.messages ?? []).find((x: any) => x.body === TEN_NOV);
  if (!msg?.scan) await wait(1500);
}
check("the 10 Nov message is held on the order (three readers)", msg?.scan?.level === "hold" && msg?.scan?.source === "three readers", `level ${msg?.scan?.level}; rules ${msg?.scan?.readers?.rules}, Decisions ${msg?.scan?.readers?.decisions}, destinations ${msg?.scan?.readers?.code}`);
const scan = (await v.req("POST", "/safety/scan", { json: { text: TEN_NOV }, headers: { accept: "application/json" } })).json;
check("the scam check holds it as Jordan, Decisions answered, never green", scan?.level === "hold" && scan?.green === false && scan?.readers?.decisions?.answered === true, `${scan?.readers?.decisions?.model}, ${scan?.readers?.decisions?.ms} ms; ${(scan?.reasons ?? [])[0] ?? ""}`);

// 2. Ask: at least two tool calls on the rail, PayPal MCP connected.
const asked = await v.req("POST", "/api/ui/ask", { json: { question: "Why can't I spend the $20 yet?" } });
check("Ask starts", asked.json?.ok === true, asked.json?.message ?? "");
const ev = await v.get(`/api/ui/ask/${asked.json?.id}/events`);
check("the AI work rail streams over SSE", /text\/event-stream/.test(ev.headers.get("content-type") ?? "") && /event: step/.test(ev.text));
let st: any = null;
for (let i = 0; i < 45; i++) {
  st = (await v.get(`/api/ui/ask/${asked.json?.id}`)).json;
  if (st?.status && st.status !== "running") break;
  await wait(2000);
}
const tools = (st?.steps ?? []).map((s: any) => s.tool).filter((t: string) => t !== "paypal_mcp.connect" && t !== "answer");
const mcp = (st?.steps ?? []).find((s: any) => s.tool === "paypal_mcp.connect");
check("Ask answered with at least 2 tool calls", st?.status === "done" && tools.length >= 2, `${st?.status}; ${tools.join(", ")}`);
check("PayPal's MCP server connected (read tools only)", Array.isArray(mcp?.detail?.read_tools) && mcp.detail.read_tools.length > 0, mcp?.detail?.read_tools ? `${mcp.detail.read_tools.length} read tools` : String(mcp?.detail?.error ?? "no connect step"));
const sentences = st?.answer?.sentences ?? [];
check("every sentence links to a tool call", sentences.length > 0 && sentences.every((s: any) => s.linked), `${sentences.filter((s: any) => s.linked).length} of ${sentences.length}`);

// 3. /proof shows today's date.
const proof = (await v.get("/api/public/proof")).json;
const today = new Date().toISOString().slice(0, 10);
for (const r of proof?.runs ?? []) check(`/proof ${r.suite}: run today, every case listed`, String(r.at).slice(0, 10) === today && r.results.length >= r.cases, `${r.passed}/${r.cases}, ${r.at}, ${r.source}`);

// 4. Public pages load, no token.
for (const p of ["/judge", "/proof", "/ai", "/paypal", "/who-can-move-money", "/accessibility", "/agents"]) check(`${p} loads with no sign-in`, (await new Client(base).get(p)).status === 200);
const pp = (await new Client(base).get("/api/public/paypal")).text;
check("/api/public/paypal has live ids and no token", /"id":"[0-9A-Z]{17}"/.test(pp) && !/payment_token|vault_id|access_token/i.test(pp));

// 5. Ticks from this script's own actions.
const j1 = (await v.get("/api/public/judge")).json;
const done = j1.paths.flatMap((p: any) => p.steps.filter((s: any) => s.done).map((s: any) => s.key));
check("the scam and Ask steps ticked themselves", done.includes("scam_flagged") && done.includes("scam_checked") && done.includes("ai_asked"), done.join(", "));

console.log(`\n${results.filter((r) => r.ok).length} of ${results.length} checks passed`);
process.exit(results.every((r) => r.ok) ? 0 : 1);
