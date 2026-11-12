import { HandsFreeDemo, HandsFreeIntro, SnapTable } from "@/components/handsfree-demo";
import { useState, type ReactNode } from "react";
import { Link } from "react-router";
import { Check, Copy, Minus, X } from "lucide-react";
import { toast } from "sonner";
import { useView } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { PublicShell } from "@/components/public-shell";
import { ErrorBlock, LoadingBlock, Stamp } from "@/components/brand";

/** Spec A3.2: pages anyone can open. Data comes from the showcase demo or the published evaluation runs. */

function Page({ title, sub, children }: { title: string; sub: ReactNode; children: ReactNode }) {
  return (
    <PublicShell wide>
      <p className="text-sm"><Link to="/#pick" className="underline">← Guided tour</Link></p>
      <h1 className="mt-2 text-4xl">{title}</h1>
      <div className="mt-2 max-w-3xl text-muted-foreground">{sub}</div>
      <div className="mt-6">{children}</div>
    </PublicShell>
  );
}

function Load<T>({ path, title, sub, children }: { path: string; title: string; sub: ReactNode; children: (d: T) => ReactNode }) {
  const v = useView<T>(path);
  return (
    <Page title={title} sub={sub}>
      {v.error ? <ErrorBlock message={v.error.message} retry={() => v.reload()} /> : !v.data ? <LoadingBlock /> : children(v.data)}
    </Page>
  );
}

const day = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "never");
const Table = ({ head, children, min = "40rem", label = "Table" }: { head: string[]; children: ReactNode; min?: string; label?: string }) => (
  <div className="overflow-x-auto rounded-md border border-border" tabIndex={0} role="region" aria-label={label}>
    <table className="w-full text-sm" style={{ minWidth: min }}>
      <thead><tr className="border-b border-border bg-paper-2 text-left">{head.map((h) => <th key={h} className="px-3 py-2">{h}</th>)}</tr></thead>
      <tbody>{children}</tbody>
    </table>
  </div>
);
const Td = ({ children, className = "" }: { children?: ReactNode; className?: string }) => <td className={`border-b border-border px-3 py-2 align-top ${className}`}>{children}</td>;

/* ---------------- /proof ---------------- */
interface ProofCase { id: string; group: string; split?: string; input: string; expected: string; actual: string; pass: boolean | null; state?: string; detail?: any }
interface ProofRun { id: string; suite: string; models: string; cases: number; passed: number; cost_usd: number; trigger: string; at: string; source?: string; results: ProofCase[] }
interface RobotRun { ran_at: string; passed: boolean; base: string; times: Record<string, number>; steps: { path: string; key: string; done: boolean }[]; run_url: string | null }
interface ProofData { source: string; runs: ProofRun[]; calibration: any[]; thresholds: { name: string; clear_below: number; hold_above: number; source: string }[]; not_measured: string[]; data_note: string; robot_judge: RobotRun | null }

const SUITE: Record<string, { title: string; what: string }> = {
  regression: { title: "Regression set from the 10 Nov review", what: "Each off-script input a reviewer tried, kept as a permanent case." },
  scam: { title: "Scam check on supplier messages", what: "Rules, OpenAI Decisions and the destination check together. Held = payment paused until the owner reads it; green is allowed only when nothing names somewhere to pay." },
  receiving: { title: "Reading delivery notes", what: "The production reader on typed delivery notes, including notes with planted instructions, invented lines and changed amounts." },
};

function Verdict({ c }: { c: ProofCase }) {
  if (c.pass === null) return <Stamp tone="quiet">{c.state ?? "not run"}</Stamp>;
  return c.pass ? <Stamp tone="paid"><Check className="mr-1 inline size-3.5" aria-hidden="true" />pass</Stamp> : <Stamp tone="stop"><X className="mr-1 inline size-3.5" aria-hidden="true" />fail</Stamp>;
}

function RunTable({ r }: { r: ProofRun }) {
  const [only, setOnly] = useState<"all" | "fail" | "held_out">("all");
  const rows = r.results.filter((c) => (only === "fail" ? c.pass === false : only === "held_out" ? c.split === "held_out" : true));
  const s = SUITE[r.suite] ?? { title: r.suite, what: "" };
  const held = r.results.filter((c) => c.split === "held_out" && c.pass !== null);
  return (
    <section className="mt-10" aria-labelledby={`suite-${r.suite}`} id={r.suite}>
      <h2 id={`suite-${r.suite}`} className="text-2xl">{s.title}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{s.what}</p>
      <p className="mt-2 text-sm">
        <b className="num">{r.passed} of {r.cases}</b> passed{held.length ? <> (held-out half: <span className="num">{held.filter((c) => c.pass).length} of {held.length}</span>)</> : null}. Run <b>{day(r.at)}</b> ({r.trigger}{r.source ? `; ${r.source}` : ""}). Models: <span className="mono">{r.models}</span>. Model cost <span className="num">${r.cost_usd.toFixed(4)}</span>.
      </p>
      <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Filter cases">
        {(["all", "fail", ...(held.length ? ["held_out"] : [])] as const).map((k) => (
          <Button key={k} size="sm" variant={only === k ? "default" : "outline"} className="min-h-11" aria-pressed={only === k} onClick={() => setOnly(k as typeof only)}>{k === "all" ? "Every case" : k === "fail" ? "Failures" : "Held-out only"}</Button>
        ))}
      </div>
      <div className="mt-3">
        <Table head={["Case", "Input", "Expected", "Answer", "Result"]} min="56rem">
          {rows.map((c) => (
            <tr key={c.id} data-case={c.id}>
              <Td className="whitespace-nowrap"><span className="mono">{c.id}</span><br /><span className="text-muted-foreground">{c.group}{c.split ? ` · ${c.split === "held_out" ? "held out" : "tuning"}` : ""}</span></Td>
              <Td><details><summary className="cursor-pointer">{c.input.slice(0, 90)}{c.input.length > 90 ? "…" : ""}</summary><pre className="mt-2 max-w-xl whitespace-pre-wrap text-xs">{c.input}</pre></details></Td>
              <Td>{c.expected}</Td>
              <Td>{c.actual}{c.detail ? <details className="mt-1 text-xs text-muted-foreground"><summary className="cursor-pointer">Readers</summary><pre className="whitespace-pre-wrap">{JSON.stringify(c.detail, null, 1)}</pre></details> : null}</Td>
              <Td><Verdict c={c} /></Td>
            </tr>
          ))}
          {!rows.length && <tr><Td>No cases match.</Td><Td /><Td /><Td /><Td /></tr>}
        </Table>
      </div>
    </section>
  );
}

export function Proof() {
  return (
    <Load<ProofData> path="/api/public/proof" title="Proof" sub={<>Every evaluation case, with its input, what was expected, what the models and code answered, and pass or fail. The suites run nightly on the server; <span className="mono">npm run eval:proof</span> runs them anywhere.</>}>
      {(d) => (
        <>
          <p className="rounded-md border border-border bg-card p-3 text-sm">{d.data_note} Shown from: {d.source}.</p>
          <section className="mt-6 rounded-md border border-border bg-card p-3" aria-labelledby="robot-title" data-robot-judge>
            <h2 id="robot-title" className="text-xl">Robot judge</h2>
            {d.robot_judge ? (
              <>
                <p className="mt-1 text-sm"><span className={d.robot_judge.passed ? "font-semibold text-paid" : "font-semibold text-stop"}>{d.robot_judge.passed ? "Every path completed" : "Not every path completed"}</span> · {new Date(d.robot_judge.ran_at).toLocaleString()} on {d.robot_judge.base}{d.robot_judge.run_url && <> · <a className="underline" href={d.robot_judge.run_url}>the run</a></>}</p>
                <p className="mt-1 text-sm text-muted-foreground">{Object.entries(d.robot_judge.times).map(([k, v]) => `${k.replace(/_s$/, "").replace(/_/g, " ")} ${v} s`).join(" · ")}</p>
                {d.robot_judge.steps.some((s) => !s.done) && <p className="mt-1 text-sm text-stop">Not ticked: {d.robot_judge.steps.filter((s) => !s.done).map((s) => `${s.path}/${s.key}`).join(", ")}</p>}
              </>
            ) : <p className="mt-1 text-sm">A browser walks every judge path on this site each night and reports here. No run has been reported yet.</p>}
          </section>
          {!d.runs.length && <p className="mt-6">No run has been recorded yet.</p>}
          {d.runs.map((r) => <RunTable key={r.id} r={r} />)}
          <section className="mt-10" aria-labelledby="cal-title" id="calibration">
            <h2 id="cal-title" className="text-2xl">Thresholds, and how they were set</h2>
            <p className="mt-1 text-sm text-muted-foreground">OpenAI Decisions returns a probability for each question. Code turns it into clear, caution or hold using these thresholds. Calibrated ones were picked on the tuning half (a miss counted 10× a false hold) and scored on the held-out half.</p>
            <div className="mt-3">
              <Table head={["Question", "Clear below", "Hold above", "Set by"]}>
                {d.thresholds.map((t) => <tr key={t.name}><Td className="mono">{t.name}</Td><Td className="num">{t.clear_below}</Td><Td className="num">{t.hold_above > 1 ? "never on its own" : t.hold_above}</Td><Td>{t.source === "calibrated" ? "calibration" : "default in code"}</Td></tr>)}
              </Table>
            </div>
            {d.calibration.map((c) => (
              <p key={c.question} className="mt-3 text-sm"><b className="mono">{c.question}</b>: {c.threshold.calibrated_on}. Held-out: {c.held_out.n} cases, {c.held_out.positives} positive; precision {pct(c.held_out.precision)}, recall {pct(c.held_out.recall)}{c.held_out.fp !== undefined ? ` (${c.held_out.fp} false hold, ${c.held_out.fn} missed)` : ""}.</p>
            ))}
          </section>
          <section className="mt-10" aria-labelledby="nm-title">
            <h2 id="nm-title" className="text-2xl">What has not been measured</h2>
            <ul className="mt-2 list-disc pl-6">{d.not_measured.map((x) => <li key={x} className="mt-1">{x}</li>)}</ul>
          </section>
        </>
      )}
    </Load>
  );
}
const pct = (x: number | null | undefined) => (typeof x === "number" ? `${Math.round(x * 100)}%` : "n/a");

/* ---------------- /ai ---------------- */
interface AiData { from: string; built_at: string | null; note: string; data: { id: number; purpose: string; model: string; via: string; ok: boolean; tokens_in: number; tokens_out: number; cost_usd: number; latency_ms: number; at: string; output: string; tools: string[] }[] | null }

export function AiCalls() {
  return (
    <Load<AiData> path="/api/public/ai" title="AI calls" sub="The last 20 model calls in the showcase demo: what each was for, the model, its tool calls, the structured answer, latency and cost. The showcase is a demo rebuilt daily through the real order path.">
      {(d) => !d.data ? <p>The showcase demo isn't built yet.</p> : (
        <>
          <p className="text-sm text-muted-foreground">{d.note} Showcase built {day(d.built_at)}.</p>
          <div className="mt-3">
            <Table head={["When", "Purpose", "Model", "Tools", "Output", "ms", "Cost"]} min="60rem">
              {d.data.map((c) => (
                <tr key={c.id}>
                  <Td className="whitespace-nowrap">{day(c.at)}</Td>
                  <Td className="mono">{c.purpose}{!c.ok && <Stamp tone="stop" className="ml-1">failed</Stamp>}</Td>
                  <Td className="mono">{c.model}{c.via === "fallback" ? " (backup)" : ""}</Td>
                  <Td className="text-xs">{c.tools.length ? c.tools.join(", ") : <Minus className="size-4" aria-label="none" />}</Td>
                  <Td><code className="block max-w-md whitespace-pre-wrap break-words text-xs">{c.output || "–"}</code></Td>
                  <Td className="num">{c.latency_ms}</Td>
                  <Td className="num">${c.cost_usd.toFixed(5)}</Td>
                </tr>
              ))}
            </Table>
          </div>
        </>
      )}
    </Load>
  );
}

/* ---------------- /paypal ---------------- */
interface PayPalRow { api: string; call: string; when: string; id: string | null; status?: string | null; note?: string }
export function PayPalApis() {
  return (
    <Load<{ from: string; built_at: string | null; data: PayPalRow[] | null }> path="/api/public/paypal" title="PayPal APIs" sub="Every PayPal API StockSure calls, the moment it calls it, and a live sandbox id from the showcase demo where one exists. Every write carries a PayPal-Request-Id and is read back before StockSure shows its result.">
      {(d) => !d.data ? <p>The showcase demo isn't built yet.</p> : (
        <>
          <p className="text-sm text-muted-foreground">Ids from the showcase demo, built {day(d.built_at)}. An empty id means the showcase hasn't needed that call yet.</p>
          <div className="mt-3">
            <Table head={["API", "Call", "When StockSure uses it", "Live sandbox id"]} min="56rem">
              {d.data.map((r) => (
                <tr key={r.api}>
                  <Td className="font-semibold">{r.api}</Td>
                  <Td className="mono text-xs">{r.call}</Td>
                  <Td>{r.when}{r.note ? <span className="block text-xs text-muted-foreground">{r.note}</span> : null}</Td>
                  <Td className="mono text-xs">{r.id ?? "–"}{r.status ? <span className="block text-muted-foreground">{r.status}</span> : null}</Td>
                </tr>
              ))}
            </Table>
          </div>
        </>
      )}
    </Load>
  );
}

/* ---------------- /who-can-move-money ---------------- */
const ROLES: { who: string; can: string[]; cannot: string[] }[] = [
  { who: "Café owner (Jordan)", can: ["Accept a quote: PayPal places a hold for the quote total, inside the order's spend limit", "Approve or decline a capture or refund held for them (at or above their approval threshold, or paused by the scam check)", "Approve the fix for a short delivery (credit or replacement)", "Turn on protected mode, so every capture and refund waits for them"], cannot: ["Pay more than both sides agreed arrived", "Send money to any payee: no StockSure PayPal call takes one"] },
  { who: "Receiver (Sam)", can: ["Count a delivery in and confirm the counts", "Attach photos as evidence"], cannot: ["Accept quotes, approve captures or approve fixes"] },
  { who: "Wholesaler (Ana)", can: ["Quote, dispatch, agree or dispute the counts, approve the fix", "Message the café (each message is checked for scam signs)"], cannot: ["Capture, refund or change where money goes. Settlement goes to the account PayPal already holds for the order"] },
  { who: "Code (the money gate)", can: ["Work out every amount: quote price × accepted units, in whole cents", "Capture only what both sides signed, release the rest, re-authorize a hold before PayPal's honor period ends", "Hold a capture for the owner when a rule, the risk model or the scam check says so"], cannot: ["Skip the owner's threshold, the kill switch or a scam hold"] },
  { who: "Reading model (OpenAI)", can: ["Propose counts and flags from a delivery note, invoice or photo"], cannot: ["Set a price, a quantity, an amount or a payee. A person confirms every count"] },
  { who: "Scam check (OpenAI Decisions)", can: ["Score a message on eleven questions; code turns the scores into clear, caution or hold"], cannot: ["Release money, or mark a message safe on its own"] },
  { who: "Ask (the agent)", can: ["Read your orders, receipts, price history and PayPal records (StockSure's read tools and PayPal's MCP server, read tools only)", "Draft a message for you to send yourself"], cannot: ["Capture, refund, void, accept or send anything: it is offered no tool that can"] },
  { who: "An outside agent over MCP", can: ["Buyer side: draft, submit, negotiate and accept orders inside the owner's mandate (accepting places a PayPal hold)", "Supplier side: quote, never below the supplier's floor"], cannot: ["Capture or refund, exceed the mandate, or act after the owner's kill switch"] },
];

export function WhoCanMoveMoney() {
  return (
    <Page title="Who can move money" sub="Every person, model and agent in StockSure, what each can do with money and what each cannot. These limits are enforced in code on the server; the tests in the repository check them.">
      <div className="grid gap-4 md:grid-cols-2">
        {ROLES.map((r) => (
          <section key={r.who} className="rounded-lg border border-border bg-card p-4" aria-label={r.who}>
            <h2 className="text-lg">{r.who}</h2>
            <p className="mt-2 text-sm font-semibold">Can</p>
            <ul className="mt-1 grid gap-1 text-sm">{r.can.map((x) => <li key={x} className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-paid" aria-hidden="true" />{x}</li>)}</ul>
            <p className="mt-3 text-sm font-semibold">Cannot</p>
            <ul className="mt-1 grid gap-1 text-sm">{r.cannot.map((x) => <li key={x} className="flex gap-2"><X className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />{x}</li>)}</ul>
          </section>
        ))}
      </div>
    </Page>
  );
}

/* ---------------- /accessibility ---------------- */
interface A11yData { last: { at: string; runner: string; results: { check: string; pass: boolean; detail: string }[] } | null; voice: { model: string; ready: boolean; where: string[] }; handsfree?: { shared_runs: number; median_gaze_px: number | null; median_head_px: number | null; last_at: string | null } }
export function Accessibility() {
  return (
    <Load<A11yData> path="/api/public/accessibility" title="Accessibility" sub="What StockSure offers, what was tested and how, and what was not tested.">
      {(d) => (
        <>
          <section aria-labelledby="a-offer"><h2 id="a-offer" className="text-2xl">On every page</h2>
            <ul className="mt-2 list-disc pl-6">
              <li>Display and help: bigger text (up to 200%), high contrast, a clearer font, read-aloud, voice typing, plain words, bigger buttons and more time (pauses automatic refreshes). Choices stay on the device. Every switch is announced with its name and what it does.</li>
              <li>Push-to-talk by voice on the Ask box and on the receive page ("say what arrived"): OpenAI {d.voice.model}, through StockSure's server, with the transcript shown as you speak. {d.voice.ready ? "On for this server." : "Off on this server: the AI isn't configured."} Typing always works.</li>
              <li>Payment changes on an order (hold placed, captured, released, failed) are announced through one polite live region.</li>
              <li>Every action works from the keyboard; a skip link on every page.</li>
              <li>Layouts work from 320 px wide and at 200% text without sideways scrolling; touch targets are at least 44 px on phones.</li>
              <li>Tours start only from a button, cover one page, and end when you move to another page.</li>
            </ul>
          </section>
          <section className="mt-8" aria-labelledby="a-hands"><h2 id="a-hands" className="text-2xl">Hands-free: head, eye gaze and voice</h2>
            <HandsFreeIntro />
            <ul className="mt-2 list-disc pl-6 text-sm">
              <li>The camera is read in this browser tab by Google's MediaPipe face model. Frames never leave the device; a red dot and “Camera on” show while it runs, with a one-tap off switch.</li>
              <li>Calibration: nine dots, settings chosen by cross-validation, then four check dots it has not seen; you are shown the error in pixels. If eye gaze is rougher than 110 px, head pointing becomes the default. Calibration is kept on this device, with a three-dot top-up when your head moves.</li>
              <li>Voice commands in English, हिन्दी, Bahasa Indonesia and Português: “Peek” to wake, “click”, “scroll down”, “go back”, “press …”, “reorder this”, and “stop” (stop / ruko / berhenti / pare). Stop is decided in code and never goes through an AI. A noise gate learns the room's level and ignores what the app says itself.</li>
              <li>With no camera, voice alone works; with no network, the pointer and dwell click still work and voice says it is unavailable.</li>
            </ul>
            <h3 className="mt-4 text-lg">Try it without a camera</h3>
            <HandsFreeDemo />
            <h3 className="mt-4 text-lg">How often snapping picks the right control (simulated)</h3>
            <p className="text-sm text-muted-foreground">300 simulated fixations per cell, the person's gaze scattered by the noise shown plus a fixed drift that each confirmed click corrects. These are simulations of the code, not measurements of people.</p>
            <SnapTable />
            <p className="mt-2 text-sm">The 30 px limit: below about 44 px, a webcam's noise makes neighbouring controls hard to tell apart. Hands-free mode therefore raises every control to at least 44 px and spreads out tight lists while it is on.</p>
            <h3 className="mt-4 text-lg">Measured by visitors</h3>
            <p className="text-sm">{d.handsfree && d.handsfree.shared_runs > 0 ? <>{d.handsfree.shared_runs} calibration{d.handsfree.shared_runs === 1 ? "" : "s"} shared (only the two numbers): median eye-gaze error {d.handsfree.median_gaze_px ?? "—"} px, head pointing {d.handsfree.median_head_px ?? "—"} px, on check dots. Last {d.handsfree.last_at ? new Date(d.handsfree.last_at).toLocaleDateString() : "—"}.</> : "No visitor has shared a calibration result yet, so there is no measured accuracy to publish. It is shown here once someone ticks “share” after calibrating."}</p>
            <h3 className="mt-4 text-lg">Enforced in code, not by asking the AI</h3>
            <ul className="mt-1 list-disc pl-6 text-sm">
              <li>Anything that pays, approves, captures, releases, refunds, cancels, deletes, sends or disputes opens a confirm card with the amount and recipient. Only a spoken “yes” or a real click on Yes goes ahead; looking at Yes, dwelling or winking does not.</li>
              <li>Stop, Esc and looking away for two seconds stop everything at once and cancel any open confirm card.</li>
              <li>A button's state is read before pressing it: a turned-off button is not pressed, an already selected one is not pressed again.</li>
              <li>Voice commands are a fixed list matched in code. No free-form browser or shell actions; each command is one step.</li>
              <li>Spoken names (“press Ledger”) are matched to buttons by spelling, in code.</li>
              <li>What the AI does: it writes Ask answers and negotiation messages, in your language. It never decides whether an action runs or is confirmed.</li>
            </ul>
            <h3 className="mt-4 text-lg">PayPal's own page</h3>
            <p className="text-sm">PayPal's approval page is a separate site that this page can't drive. Hands-free brings you to the PayPal button and then says “Approve on PayPal's page; I'll wait here.” For hands-free control on PayPal's page too, a desktop tool such as Peek (macOS) works across every app.</p>
          </section>
          <section className="mt-8" aria-labelledby="a-tested"><h2 id="a-tested" className="text-2xl">Tested</h2>
            {d.last ? (
              <>
                <p className="mt-1 text-sm text-muted-foreground">Last run {new Date(d.last.at).toLocaleString()} · {d.last.runner}</p>
                <p className="mt-1 text-sm text-muted-foreground">Test names and details below are written by the test run, in English.</p>
                <ul className="mt-2 space-y-2" data-a11y-results lang="en" translate="no">
                  {d.last.results.map((r) => (
                    <li key={r.check} className="rounded-md border border-border p-3"><span className={r.pass ? "font-semibold text-paid" : "font-semibold text-stop"}>{r.pass ? "Passed" : "Failed"}</span> · {r.check}<span className="block text-sm text-muted-foreground">{r.detail}</span></li>
                  ))}
                </ul>
              </>
            ) : <p className="mt-1">The automated accessibility checks have not been recorded on this server yet.</p>}
            <ul className="mt-3 list-disc pl-6 text-sm">
              <li>Also in the Playwright suite: axe (WCAG 2.2 AA) and no sideways scroll at 360 px on each person's home and order pages, light and dark, and on every public page.</li>
              <li>Lighthouse 12.8.2 on the live site, 10 Nov 2026: accessibility 100 for the landing, sign-in and owner home pages. Not repeated since.</li>
              <li>Push-to-talk: one live run with a synthetic voice clip (macOS speech) through gpt-live-1; the relay itself is covered by a test with a stand-in for OpenAI.</li>
            </ul>
          </section>
          <section className="mt-8" aria-labelledby="a-not"><h2 id="a-not" className="text-2xl">Not tested</h2>
            <ul className="mt-2 list-disc pl-6">
              <li>No session with screen-reader users, and no full manual pass with VoiceOver, TalkBack or NVDA.</li>
              <li>No recorded keyboard-only pass of the whole money flow; keyboard use is covered piece by piece in the tests.</li>
              <li>Push-to-talk has not been tried by people with speech differences, or on Safari on a phone.</li>
              <li>The server-rendered control pages (Guard, Safety, Ledger) are covered by fewer automated checks than the React pages; the ledger's grids and chart come from AG Grid and were not checked with a screen reader.</li>
              <li>The phone app is a separate, unreleased branch and is not covered here.</li>
              <li>Hands-free mode has been tested with the simulated gaze and in a headless browser with a fake camera, not yet by a person with a motor impairment or on a real webcam session recorded here.</li>
            </ul>
          </section>
        </>
      )}
    </Load>
  );
}

/* ---------------- /agents ---------------- */
interface McpData { endpoint: string; transport: string; auth: string; key: string | null; key_note: string; command: string; tools_outside: { buyer: string[]; supplier: string[] }; tools_outside_note: string; agent_tools: { name: string; kind: string; what: string }[]; paypal_read_tools: string[] }
export function Agents() {
  return (
    <Load<McpData> path="/api/public/mcp" title="Agents and MCP" sub="Connect your own assistant to StockSure, and see the tools StockSure's own Ask agent is given.">
      {(d) => (
        <>
          <section aria-labelledby="m-connect"><h2 id="m-connect" className="text-2xl">Connect an assistant</h2>
            <p className="mt-1 text-sm">{d.transport} at <span className="mono">{d.endpoint}</span>. {d.auth}</p>
            <p className="mt-1 text-sm text-muted-foreground">{d.key_note}</p>
            <div className="mt-3 flex items-start gap-2 rounded-md border border-border bg-card p-3">
              <code className="mono block flex-1 whitespace-pre-wrap break-all text-xs">{d.command}</code>
              <Button size="sm" variant="outline" className="min-h-11" onClick={() => navigator.clipboard.writeText(d.command).then(() => toast.success("Command copied"), () => toast.error("Couldn't copy"))}><Copy aria-hidden="true" /> Copy</Button>
            </div>
            {!d.key && <p className="mt-2 text-sm"><Link to="/start" className="underline">Start your own demo</Link> to get a key.</p>}
          </section>
          <section className="mt-8" aria-labelledby="m-tools"><h2 id="m-tools" className="text-2xl">Tools an outside assistant gets</h2>
            <p className="mt-1 text-sm">{d.tools_outside_note}</p>
            <p className="mt-2 text-sm"><b>Buyer:</b> <span className="mono">{d.tools_outside.buyer.join(", ")}</span></p>
            <p className="mt-1 text-sm"><b>Supplier:</b> <span className="mono">{d.tools_outside.supplier.join(", ")}</span></p>
          </section>
          <section className="mt-8" aria-labelledby="m-ask"><h2 id="m-ask" className="text-2xl">Tools the Ask agent gets</h2>
            <div className="mt-3"><Table head={["Tool", "Kind", "What it does"]}>{d.agent_tools.map((t) => <tr key={t.name}><Td className="mono">{t.name}</Td><Td>{t.kind === "propose" ? "draft only" : "read"}</Td><Td>{t.what}</Td></tr>)}</Table></div>
            <p className="mt-3 text-sm">From PayPal's own MCP server (sandbox), read tools only: <span className="mono">{d.paypal_read_tools.join(", ")}</span>.</p>
          </section>
        </>
      )}
    </Load>
  );
}
