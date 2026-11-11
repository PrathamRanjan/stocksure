/**
 * Waves 4 and 5 live acceptance check (spec Part C), run against the deployed site:
 *   npx tsx scripts/wave45-live-check.mts [base] [speech.wav]
 * In a fresh private demo: the generated door photo is counted with its damage, the photo of a screen counts
 * nothing; the phone link signs in as the receiver once only; the order shows its hold dates; "Check against
 * PayPal" reads every id back and is refused to the receiver; "Protected this month" answers for the owner only;
 * the ledger loads AG Grid Enterprise with a licence; /accessibility has dated results; the robot-judge endpoint
 * refuses an unsigned post; and, given a 24 kHz mono 16-bit WAV, voice dictation returns a transcript through
 * gpt-live-1. The /judge paths (invoice, agents) are walked in a browser by web/e2e/judge-live.spec.ts.
 * Never prints a key, a token or a password.
 */
import { readFileSync } from "node:fs";
import WebSocket from "ws";
import { Client } from "../test/client.ts";

const base = (process.argv[2] ?? "https://pph-stocksure.onrender.com").replace(/\/$/, "");
const wav = process.argv[3];
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

const v = new Client(base);
check("start a demo", (await v.postJson("/demo/start", {})).json?.ok === true);
let ws: any = null;
for (let i = 0; i < 75; i++) {
  ws = (await v.get("/api/ui/workspace")).json;
  if (ws?.seed?.done) break;
  await wait(2000);
}
check("demo seeded", ws?.seed?.done === true && !ws?.seed?.stopped, `${ws?.seed?.confirmed}/${ws?.seed?.expected}`);
const people = (await v.get("/api/ui/people")).json.people as any[];
const id = (first: string) => people.find((p) => p.first === first)?.id;
const as = async (first: string) => post(v, "/login", { person_id: id(first), next: "/home" });

// The order the judge's short path counts in (dispatched, waiting for Sam).
const judge = (await v.get("/api/public/judge")).json;
const countStep = judge.paths.find((p: any) => p.id === "short").steps.find((s: any) => s.key === "counted");
const po = /\/po\/([^?#/]+)/.exec(countStep?.to ?? "")?.[1];
check("found the order to count in", !!po);

// Door photo and photo of a screen (generated drawings, read by the vision model, judged by Decisions).
await as("Sam");
const up1 = await post(v, `/po/${po}/receive/upload`, { sample: "photo" });
const up2 = await post(v, `/po/${po}/receive/upload`, { sample: "screen" });
check("Sam uploads the door photo and the screen photo", up1.status < 400 && up2.status < 400, `${up1.status}, ${up2.status}`);
const rcv = (await v.get(`/api/ui/po/${po}/receive`)).json;
const exs = (rcv?.extractions ?? []) as any[];
const door = exs.find((e) => e.door_photo && !e.screen && /door-photo/.test(e.filename));
const screen = exs.find((e) => /screen-photo/.test(e.filename));
const damaged = (door?.damage ?? []).reduce((a: number, d: any) => a + Number(d.qty ?? d.cases ?? d.units ?? 0), 0);
check("door photo: cases counted and damage seen", !!door && door.counted.length > 0 && !door.failed && damaged > 0, door ? `${door.counted.map((c: any) => `${c.sku} ${c.qty_text}`).join("; ")}; damage ${JSON.stringify(door.damage).slice(0, 120)}` : "no door-photo extraction");
check("photo of a screen: flagged, counts nothing", !!screen && screen.screen === true && screen.counted.length === 0, screen ? `screen=${screen.screen}, lines ${screen.counted.length}` : "no screen extraction");

// Phone link: owner makes it; it signs a fresh browser in as the receiver, once.
await as("Jordan");
const link = (await v.get(`/api/ui/po/${po}/phone-link`)).json;
check("phone link with QR code", typeof link?.url === "string" && String(link?.svg ?? "").startsWith("<svg"), `as ${link?.as}, expires ${link?.expires_at}`);
if (link?.url) {
  const path = new URL(link.url).pathname;
  const phone = new Client(base);
  const first = await phone.get(path);
  const who = (await phone.get("/api/ui/session")).json;
  const again = await new Client(base).get(path);
  check("phone link signs in as the receiver", first.status < 400 && (who?.person?.first === "Sam" || who?.me?.first === "Sam" || /Sam/.test(JSON.stringify(who ?? {}))), `status ${first.status} → ${first.location ?? ""}`);
  check("phone link works once only", again.status >= 400 || !/receive/.test(again.location ?? ""), `second use ${again.status} ${again.location ?? ""}`);
}

// An order with a live hold and PayPal ids: hold dates and reconciliation.
const home = (await v.get("/api/ui/home")).json;
let held: any = null;
for (const o of home?.orders ?? []) {
  const m = (await v.get(`/api/ui/po/${o.id}`)).json;
  if (m?.hold) {
    held = m;
    break;
  }
}
check("an order shows its hold dates", !!held?.hold?.best_charged_by && !!held?.hold?.valid_until, held ? `placed ${held.hold.placed_at?.slice(0, 10)}, best by ${held.hold.best_charged_by?.slice(0, 10)}, valid to ${held.hold.valid_until?.slice(0, 10)}` : "no held order");
const target = held?.po?.id ?? held?.id;
if (target) {
  const rec = await v.postJson(`/api/ui/po/${target}/reconcile`, {});
  const r = rec.json;
  check("Check against PayPal reads every id back", rec.status === 200 && Array.isArray(r?.rows) && r.rows.length > 0, r ? `${r.summary ?? ""} ok=${r.ok}` : `status ${rec.status}`);
  await as("Sam");
  const refused = await v.postJson(`/api/ui/po/${target}/reconcile`, {});
  check("receiver can't run the PayPal check", refused.status === 403, `status ${refused.status}`);
}

// Protected this month: owner only.
await as("Jordan");
const prot = (await v.get("/api/ui/protected")).json;
check("Protected this month answers for the owner", typeof prot?.total === "string" && prot.rows?.length === 5, `${prot?.total}; ${prot?.rows?.map((r: any) => `${r.key} ${r.amount}`).join(", ")}`);
await as("Sam");
check("Protected this month refused to the receiver", (await v.get("/api/ui/protected")).status === 403);

// Ledger: AG Grid Enterprise with the licence from the environment (only whether it's there is printed).
await as("Jordan");
const ledger = await v.get("/ledger");
const data = /<script[^>]*id="ledger-data"[^>]*>([\s\S]*?)<\/script>/.exec(ledger.text)?.[1];
const parsed = data ? JSON.parse(data) : null;
check("ledger loads AG Grid Enterprise 32.3.3", /ag-grid-charts-enterprise@32\.3\.3/.test(ledger.text), `status ${ledger.status}`);
check("ledger has the licence key from the environment", !!parsed?.ag_license, `licence present: ${!!parsed?.ag_license}`);

// Accessibility and the robot judge.
const a11y = (await v.get("/api/public/accessibility")).json;
check("/accessibility has dated results", !!a11y?.last?.at && a11y.last.results?.every((r: any) => r.pass), `${a11y?.last?.results?.length} checks, ${a11y?.last?.at}`);
const rj = await new Client(base).postJson("/api/robot-judge", { steps: [] });
check("robot-judge endpoint refuses an unsigned post", rj.status === 401 || rj.status === 404, `status ${rj.status}${rj.status === 404 ? " (token not set on this server)" : ""}`);

// Voice: a short spoken clip through the relay to gpt-live-1.
if (wav) {
  const buf = readFileSync(wav);
  const pcm = buf.subarray(44);
  const cookie = [...v.cookies].map(([k, val]) => `${k}=${val}`).join("; ");
  const events: string[] = [];
  const out = await new Promise<{ text: string; error?: string }>((resolve) => {
    const sock = new WebSocket(base.replace(/^http/, "ws") + "/api/ui/voice", { headers: { cookie, origin: base } });
    const t = setTimeout(() => resolve({ text: "", error: "timed out" }), 45000);
    sock.on("open", async () => {
      for (let i = 0; i < pcm.length; i += 9600) {
        sock.send(pcm.subarray(i, Math.min(pcm.length, i + 9600)));
        await wait(100);
      }
      sock.send(JSON.stringify({ type: "stop" }));
    });
    sock.on("message", (raw) => {
      const e = JSON.parse(String(raw));
      events.push(e.type);
      if (e.type === "done") (clearTimeout(t), resolve({ text: e.text }));
      if (e.type === "error") (clearTimeout(t), resolve({ text: "", error: e.message }));
    });
    sock.on("error", (e) => (clearTimeout(t), resolve({ text: "", error: e.message })));
  });
  check("voice: gpt-live-1 transcript through the relay", !!out.text, out.error ?? `"${out.text}" (${[...new Set(events)].join(",")})`);
}

const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed} of ${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
