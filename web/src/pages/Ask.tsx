import { useEffect, useRef, useState } from "react";
import { Bot, CircleAlert, Clock, Database, Link2, ListChecks, Send, Wrench } from "lucide-react";
import { getJSON, useView } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ErrorBlock, LoadingBlock, PageHeader, Spinner, Stamp } from "@/components/brand";

/**
 * Spec A5.3: ask the agent about your own records, and watch it work. The AI work rail (right on a laptop, a sheet
 * on a phone) lists every tool call as it happens: its name, a one-line summary of the arguments and the result, and
 * how long it took. Each sentence of the answer links to the tool calls it rests on.
 */

interface Info { ready: boolean; model: string; max_steps: number; max_seconds: number; left_today: number; per_day: number; paypal_mcp: string; suggested: string[]; recent: { id: string; question: string; status: string; created_at: string }[] }
interface Step { step: number; cite_as: string | null; actor: string; tool: string; args: string; result: string; duration_ms: number | null; gate: string | null; detail: unknown }
interface Answer { status: string; sentences: { text: string; cites: string[]; linked: boolean }[]; could_not_answer: string | null; proposals: { id: string; po_id: string; po_number: string; text: string }[]; tools_offered: string[]; paypal_mcp: { ok: boolean; note: string }; cost_usd: number; error: string | null }
interface State { id: string; question: string; status: string; steps: Step[]; answer: Answer | null; error: string | null }

const ACTOR: Record<string, { label: string; icon: typeof Bot }> = {
  code: { label: "StockSure records", icon: Database },
  paypal: { label: "PayPal MCP", icon: Link2 },
  model: { label: "Model", icon: Bot },
  agent: { label: "Draft", icon: Wrench },
};

function Rail({ steps, running, focus, onFocus }: { steps: Step[]; running: boolean; focus: string | null; onFocus: (id: string | null) => void }) {
  return (
    <ol className="grid gap-2" aria-live="polite" aria-label="What the AI did">
      {steps.map((s) => {
        const a = ACTOR[s.actor] ?? ACTOR.code;
        const Icon = a.icon;
        const err = s.result.startsWith("error") || s.result.startsWith("PayPal:");
        return (
          <li key={s.step} id={s.cite_as ? `call-${s.cite_as}` : undefined} className={cn("rounded-md border bg-card p-3 text-sm transition-colors", focus && s.cite_as === focus ? "border-foreground ring-2 ring-foreground/30" : "border-border")}>
            <button type="button" className="w-full text-left" onClick={() => onFocus(s.cite_as)} aria-label={`Step ${s.step}: ${s.tool}`}>
              <p className="flex flex-wrap items-center gap-2">
                <Icon className="size-4 shrink-0" aria-hidden="true" />
                <span className="mono font-semibold">{s.tool}</span>
                {s.cite_as && <Stamp tone="quiet">{s.cite_as}</Stamp>}
                <span className="ml-auto flex items-center gap-1 text-xs text-muted-foreground"><Clock className="size-3" aria-hidden="true" />{s.duration_ms ?? 0} ms</span>
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">{a.label}{s.args ? ` · ${s.args}` : ""}</p>
              <p className={cn("mt-1", err && "text-stop")}>{s.result}</p>
            </button>
          </li>
        );
      })}
      {running && (
        <li className="flex items-center gap-2 rounded-md border border-dashed border-input p-3 text-sm text-muted-foreground"><Spinner className="size-4" /> Working…</li>
      )}
    </ol>
  );
}

export default function Ask() {
  const info = useView<Info>("/api/ui/ask");
  // ?q= prefills the box (judge page links); nothing is asked until the person presses Ask.
  const [question, setQuestion] = useState(() => new URLSearchParams(location.search).get("q")?.slice(0, 500) ?? "");
  const [state, setState] = useState<State | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const [sheet, setSheet] = useState(false);
  const es = useRef<EventSource | null>(null);

  useEffect(() => () => es.current?.close(), []);

  async function follow(id: string, q: string) {
    es.current?.close();
    setState({ id, question: q, status: "running", steps: [], answer: null, error: null });
    const src = new EventSource(`/api/ui/ask/${id}/events`);
    es.current = src;
    src.addEventListener("step", (e) => {
      const st = JSON.parse((e as MessageEvent).data) as Step;
      setState((s) => (s && s.id === id && !s.steps.some((x) => x.step === st.step) ? { ...s, steps: [...s.steps, st] } : s));
    });
    src.addEventListener("done", async () => {
      src.close();
      try {
        setState(await getJSON<State>(`/api/ui/ask/${id}`));
      } catch {
        /* the next reload shows it */
      }
      info.reload();
      setBusy(false);
    });
    src.onerror = async () => {
      src.close();
      // The stream dropped (a proxy, a sleep): read the stored state instead, and keep reading until it ends.
      for (let i = 0; i < 60; i++) {
        try {
          const s = await getJSON<State>(`/api/ui/ask/${id}`);
          setState(s);
          if (s.status !== "running") break;
        } catch {
          break;
        }
        await new Promise((r) => setTimeout(r, 1500));
      }
      setBusy(false);
    };
  }

  async function ask(q: string) {
    const text = q.trim();
    if (!text) return;
    setBusy(true);
    setErr(null);
    setFocus(null);
    try {
      const r = await fetch("/api/ui/ask", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ question: text }) });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) {
        setErr(j?.message ?? `The server answered ${r.status}.`);
        setBusy(false);
        return;
      }
      void follow(j.id, text);
    } catch {
      setErr("You're offline or the server didn't answer. Nothing was asked; try again.");
      setBusy(false);
    }
  }

  async function open(id: string) {
    try {
      const s = await getJSON<State>(`/api/ui/ask/${id}`);
      setState(s);
      if (s.status === "running") void follow(id, s.question);
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  if (info.error) return <ErrorBlock message={info.error.message} retry={() => info.reload()} status={info.error.status} />;
  if (!info.data) return <LoadingBlock label="Loading" />;
  const d = info.data;
  const running = state?.status === "running";
  const a = state?.answer;
  const calls = state?.steps.filter((s) => s.cite_as).length ?? 0;

  const rail = state ? <Rail steps={state.steps} running={running} focus={focus} onFocus={setFocus} /> : <p className="text-sm text-muted-foreground">Each tool call the AI makes shows here as it happens.</p>;

  return (
    <>
      <PageHeader
        title="Ask about your records"
        sub={`The AI looks things up in your orders and in PayPal's sandbox before it answers. It can't move money or change an order. ${d.model}, at most ${d.max_steps} steps and ${d.max_seconds} s; ${d.paypal_mcp}.`}
      />
      {!d.ready && <ErrorBlock message="The AI isn't configured on this server, so there's nothing to ask. The order pages show the same records." />}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_24rem]">
        <section aria-labelledby="ask-title">
          <h2 id="ask-title" className="sr-only">Your question</h2>
          <form
            className="grid gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void ask(question);
            }}
          >
            <label htmlFor="ask-q" className="font-semibold">Question</label>
            <Textarea id="ask-q" rows={3} value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Which supplier short-delivers most, and what did it cost?" maxLength={600} />
            <div className="flex flex-wrap items-center gap-2">
              <Button type="submit" disabled={busy || !d.ready || d.left_today <= 0}>{busy ? <Spinner className="size-4" /> : <Send aria-hidden="true" />} Ask</Button>
              <span className="text-sm text-muted-foreground">{d.left_today} of {d.per_day} questions left today in this demo</span>
              <Button type="button" variant="outline" className="ml-auto lg:hidden" onClick={() => setSheet(true)} disabled={!state}><ListChecks aria-hidden="true" /> AI work ({calls})</Button>
            </div>
          </form>
          {err && <p className="mt-3 flex gap-2 rounded-md bg-stop-soft px-3 py-2 text-sm" role="alert"><CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />{err}</p>}
          <div className="mt-3 flex flex-wrap gap-2" aria-label="Suggested questions">
            {d.suggested.map((s) => (
              <Button key={s} type="button" size="sm" variant="outline" disabled={busy || !d.ready} onClick={() => { setQuestion(s); void ask(s); }}>{s}</Button>
            ))}
          </div>

          {state && (
            <article className="mt-6 rounded-lg border-2 border-foreground bg-card p-5" aria-live="polite" aria-labelledby="answer-title">
              <p className="text-sm text-muted-foreground">You asked</p>
              <h2 id="answer-title" className="text-xl">{state.question}</h2>
              {running && <p className="mt-3 flex items-center gap-2"><Spinner className="size-4" /> Looking it up ({calls} tool call{calls === 1 ? "" : "s"} so far)…</p>}
              {state.status === "failed" && <p className="mt-3 flex gap-2 rounded-md bg-stop-soft px-3 py-2" role="alert"><CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />{state.error ?? "I couldn't answer that just now. Try again."} <Button size="sm" variant="outline" className="ml-auto" onClick={() => void ask(state.question)}>Try again</Button></p>}
              {a && a.sentences.length > 0 && (
                <ul className="mt-3 grid gap-2">
                  {a.sentences.map((s, i) => (
                    <li key={i}>
                      {s.text}{" "}
                      {s.linked ? (
                        s.cites.map((c) => (
                          <a key={c} href={`#call-${c}`} className="mono rounded bg-muted px-1 text-xs underline" onClick={(e) => { e.preventDefault(); setFocus(c); if (window.matchMedia("(max-width: 1023px)").matches) setSheet(true); else document.getElementById(`call-${c}`)?.scrollIntoView({ block: "nearest" }); }} aria-label={`From tool call ${c}`}>{c}</a>
                        ))
                      ) : (
                        <Stamp tone="quiet" title="This sentence does not cite a tool call that ran.">not linked to a fact</Stamp>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {a?.could_not_answer && <p className="mt-3 text-muted-foreground">What's missing: {a.could_not_answer}</p>}
              {a && a.proposals.length > 0 && (
                <div className="mt-4 grid gap-2">
                  {a.proposals.map((p) => (
                    <div key={p.id} className="rounded-md border border-dashed border-input p-3">
                      <p className="text-sm font-semibold">Draft message to the supplier on {p.po_number} (not sent)</p>
                      <p className="mt-1 whitespace-pre-wrap">{p.text}</p>
                      <Button asChild size="sm" variant="outline" className="mt-2"><a href={`/po/${p.po_id}#messages`}>Open the order to send it yourself</a></Button>
                    </div>
                  ))}
                </div>
              )}
              {a && <p className="mt-4 text-xs text-muted-foreground">{a.paypal_mcp.note} · {a.tools_offered.length} tools offered, none can move money · about ${a.cost_usd.toFixed(4)}</p>}
            </article>
          )}

          {d.recent.length > 0 && (
            <section className="mt-8" aria-labelledby="recent-title">
              <h2 id="recent-title" className="mb-2 text-lg">Asked before in this demo</h2>
              <ul className="grid gap-1">
                {d.recent.map((r) => (
                  <li key={r.id}><button type="button" className="text-left underline" onClick={() => void open(r.id)}>{r.question}</button> <span className="text-xs text-muted-foreground">{r.status}</span></li>
                ))}
              </ul>
            </section>
          )}
        </section>

        <aside className="hidden lg:block" aria-labelledby="rail-title">
          <h2 id="rail-title" className="mb-2 flex items-center gap-2 text-lg"><ListChecks className="size-5" aria-hidden="true" /> AI work</h2>
          {rail}
        </aside>
      </div>

      <Sheet open={sheet} onOpenChange={setSheet}>
        <SheetContent side="bottom" className="max-h-[80vh] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>AI work</SheetTitle>
            <SheetDescription>Every tool call the AI made for this answer.</SheetDescription>
          </SheetHeader>
          <div className="px-4 pb-6">{rail}</div>
        </SheetContent>
      </Sheet>
    </>
  );
}
