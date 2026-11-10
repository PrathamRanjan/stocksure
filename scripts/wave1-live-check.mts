/**
 * Wave 1 live acceptance check (spec Part C, Wave 1), run against the deployed site:
 *   npx tsx scripts/wave1-live-check.mts [https://pph-stocksure.onrender.com]
 * Two separate visitors (two cookie jars) each start a private demo; the script checks isolation, the seeded PayPal
 * operations, a hold placed from the saved wallet with no PayPal login, PayPal's own approval page for connecting,
 * and the honest failure for a document the model cannot read. It prints PayPal ids so they can be read back with
 * scripts/pp-check.mts. It never prints a key, a token or a password.
 */
import { Client } from "../test/client.ts";

const base = (process.argv[2] ?? "https://pph-stocksure.onrender.com").replace(/\/$/, "");
const results: { check: string; ok: boolean; detail: string }[] = [];
const check = (name: string, ok: boolean, detail = "") => {
  results.push({ check: name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
};
const ui = { "x-stocksure-ui": "1" };
const post = (c: Client, path: string, form: Record<string, string> = {}) => c.req("POST", path, { form, headers: ui });

// 1. Health: database answers, the commit is shown.
const anon = new Client(base);
const h0 = Date.now();
const health = await anon.get("/healthz");
check("/healthz answers ok with the commit", health.status === 200 && health.json?.ok === true && /^[0-9a-f]{7,40}$/.test(String(health.json?.commit ?? "")), `HTTP ${health.status}, commit ${String(health.json?.commit ?? "").slice(0, 7)}, db ${health.json?.db_ms} ms, first byte ${Date.now() - h0} ms`);

// 2. Without a demo, nobody can sign in and nothing from the base data shows.
const people0 = (await anon.get("/api/ui/people")).json;
check("no workspace: no people to sign in as", Array.isArray(people0?.people) && people0.people.length === 0 && people0.needs_workspace === true);
const prev = (await anon.get("/api/ui/preview")).json;
check("landing preview comes from the showcase (or is empty)", prev?.po === null || prev?.from === "showcase", `from ${prev?.from ?? "none"}`);

// 3. Two visitors, two private demos.
const a = new Client(base);
const b = new Client(base);
const t0 = Date.now();
const sa = (await a.postJson("/demo/start", {})).json;
const sb = (await b.postJson("/demo/start", {})).json;
check("both visitors start a demo", !!sa?.ok && !!sb?.ok, `${sa?.message} / ${sb?.message}`);
const wa = (await a.get("/api/ui/workspace")).json;
const wb = (await b.get("/api/ui/workspace")).json;
check("the two demos are different workspaces", !!wa?.workspace?.id && !!wb?.workspace?.id && wa.workspace.id !== wb.workspace.id);
check("the saved wallet is configured and attached", wa?.wallet?.configured === true && wa?.seed?.wallet === true, `wallet ${wa?.wallet?.status}`);

async function seeded(c: Client) {
  for (let i = 0; i < 90; i++) {
    const w = (await c.get("/api/ui/workspace")).json;
    if (w?.seed?.done) return w;
    await new Promise((r) => setTimeout(r, 2000));
  }
  return (await c.get("/api/ui/workspace")).json;
}
const da = await seeded(a);
const db = await seeded(b);
check("demo A: 6 of 6 payments confirmed by PayPal", da?.seed?.confirmed === 6 && da?.seed?.expected === 6 && !da?.seed?.stopped, `${da?.seed?.confirmed}/${da?.seed?.expected} in ${Math.round((Date.now() - t0) / 1000)} s${da?.seed?.stopped ? `, stopped: ${da.seed.stopped}` : ""}`);
check("demo B: 6 of 6 payments confirmed by PayPal", db?.seed?.confirmed === 6 && db?.seed?.expected === 6 && !db?.seed?.stopped, `${db?.seed?.confirmed}/${db?.seed?.expected}`);

// 4. Sign in inside each demo; the people and orders are each demo's own.
const pa = (await a.get("/api/ui/people")).json.people as any[];
const pb = (await b.get("/api/ui/people")).json.people as any[];
const jordanA = pa.find((p) => p.first === "Jordan");
const jordanB = pb.find((p) => p.first === "Jordan");
check("each demo has its own people", !!jordanA && !!jordanB && jordanA.id !== jordanB.id);
const crossLogin = await post(b, "/login", { person_id: jordanA.id, next: "/home" });
check("A's person id does not sign in to B", crossLogin.json?.ok === false, crossLogin.json?.message ?? "");
check("Jordan signs in to A", (await post(a, "/login", { person_id: jordanA.id, next: "/home" })).json?.ok === true);
check("Jordan signs in to B", (await post(b, "/login", { person_id: jordanB.id, next: "/home" })).json?.ok === true);
const homeA = (await a.get("/api/ui/home")).json;
const homeB = (await b.get("/api/ui/home")).json;
const idsA = new Set((homeA.orders as any[]).map((o) => o.id));
check("A and B see no common orders", (homeB.orders as any[]).every((o) => !idsA.has(o.id)), `${idsA.size} / ${homeB.orders.length} orders`);
check("Home says the buyer pays from the saved sandbox wallet", homeA.org?.paypal_connected === true && homeA.org?.demo_wallet === true);
check("Sample history is marked", (homeA.orders as any[]).some((o) => o.sample === true));

// 5. The seeded money: real PayPal ids on every seeded operation.
const ids: string[] = [];
for (const o of homeA.orders as any[]) {
  if (o.sample) continue;
  const v = (await a.get(`/api/ui/po/${o.id}`)).json;
  for (const op of v?.ops ?? []) if (op.paypal_id && op.status === "succeeded") ids.push(`${op.kind}:${op.paypal_id}:${o.number}`);
}
check("seeded operations carry PayPal ids", ids.length >= 6, ids.join(" "));

// 6. No-login money loop: Jordan sends the draft for a quote, Ana quotes, Jordan accepts; the hold comes from the saved wallet.
const draft = (homeA.orders as any[]).find((o) => o.status === "draft" && !o.sample);
const anaA = new Client(base);
anaA.cookies = new Map(a.cookies);
const ana = pa.find((p) => p.first === "Ana");
if (draft && ana) {
  await post(a, `/po/${draft.id}/submit`);
  await post(anaA, "/login", { person_id: ana.id, next: "/home" });
  const v0 = (await anaA.get(`/api/ui/po/${draft.id}`)).json;
  const form: Record<string, string> = {};
  for (const l of v0?.lines ?? []) form[`price_${l.id}`] = ((l.unit_price_cents ?? l.product?.price_cents) / 100).toFixed(2);
  const q = await post(anaA, `/po/${draft.id}/quote`, form);
  const v1 = (await a.get(`/api/ui/po/${draft.id}`)).json;
  const acc = await post(a, `/po/${draft.id}/accept`, { version: String(v1?.po?.quote_version ?? 1) });
  let hold: any = null;
  for (let i = 0; i < 20 && !hold; i++) {
    const v = (await a.get(`/api/ui/po/${draft.id}`)).json;
    hold = (v?.ops ?? []).find((o: any) => o.kind === "authorize" && o.status === "succeeded");
    if (!hold) await new Promise((r) => setTimeout(r, 1500));
  }
  check("a judge's hold is placed from the saved wallet with no PayPal login", !!hold?.paypal_id, `${q.json?.message ?? ""} / ${acc.json?.message ?? ""}${hold ? ` / authorization ${hold.paypal_id}` : ""}`);
  if (hold?.paypal_order_id) ids.push(`order:${hold.paypal_order_id}:${draft.number}`);
} else check("a judge's hold is placed from the saved wallet with no PayPal login", false, "no draft order or no Ana in the demo");

// 7. PayPal's own page is still offered for connecting a PayPal account (never a password typed by StockSure).
const conn = await post(a, "/connect-paypal");
const to = String(conn.json?.to ?? conn.location ?? "");
check("connecting PayPal sends you to PayPal's own sandbox page", /^https:\/\/(www\.)?sandbox\.paypal\.com\//.test(to), to.replace(/token=[^&]+/, "token=…").slice(0, 80));

// 8. A document the model cannot read gets the honest failure and a retry, not an invented reading.
const dispatched = (homeA.orders as any[]).find((o) => o.status === "dispatched" && !o.sample && o.kind !== "replacement");
const samA = new Client(base);
samA.cookies = new Map(a.cookies);
const sam = pa.find((p) => p.first === "Sam");
if (dispatched && sam) {
  await post(samA, "/login", { person_id: sam.id, next: "/home" });
  const fd = new FormData();
  fd.append("delivery_note", new Blob([Buffer.from("89504e470d0a1a0a0000000d49484452deadbeef", "hex")], { type: "image/png" }), "broken-photo.png");
  const r = await fetch(`${base}/po/${dispatched.id}/receive/upload`, { method: "POST", body: fd, headers: { ...ui, cookie: [...samA.cookies].map(([k, v]) => `${k}=${v}`).join("; ") } });
  const j = await r.json().catch(() => null);
  const v = (await samA.get(`/api/ui/po/${dispatched.id}/receive`)).json;
  const ex = (v?.extractions ?? []).find((e: any) => e.filename === "broken-photo.png");
  check("an unreadable document shows the honest failure", !!ex && ex.failed === true && ex.lines.length === 0 && /couldn't read/i.test(ex.notes.join(" ")), `${j?.message ?? r.status}; source ${ex?.source}; note "${ex?.notes?.[0] ?? ""}"`);
  check("no raw model error reaches the page", !JSON.stringify(v ?? {}).match(/OpenAI \d{3}|invalid_request|Traceback/));
} else check("an unreadable document shows the honest failure", false, "no dispatched order in the demo");

// 9. Reset closes only your own demo.
const r = await post(b, "/demo/reset");
const wb2 = (await b.get("/api/ui/workspace")).json;
const wa2 = (await a.get("/api/ui/workspace")).json;
check("reset gives B a new demo and leaves A alone", r.json?.ok === true && wb2?.workspace?.id && wb2.workspace.id !== wb.workspace.id && wa2?.workspace?.id === wa.workspace.id);

console.log("\nPayPal ids to read back:", ids.join(" "));
console.log(`\n${results.filter((x) => x.ok).length} of ${results.length} checks passed`);
process.exit(results.every((x) => x.ok) ? 0 : 1);
