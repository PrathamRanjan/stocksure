import { useEffect, useRef, useState } from "react";
import { Hand, Play, Square } from "lucide-react";
import { Button } from "@/components/ui/button";

type Core = {
  Snapper: new () => { sample: (p: { x: number; y: number }, j: number, t: number, ts: { id: string; rect: DOMRectLike }[]) => string | null; confirm: (p: { x: number; y: number }, r: DOMRectLike) => void; clear: () => void };
  simulate: (o: { size: number; noisePx: number; trials?: number }) => number;
};
type DOMRectLike = { left: number; top: number; right: number; bottom: number };
const coreOf = () => (window as unknown as { lookAndSay?: { core: Core } }).lookAndSay?.core;

function useCore() {
  const [core, setCore] = useState<Core | undefined>(coreOf);
  useEffect(() => {
    if (core) return;
    const t = setInterval(() => {
      const c = coreOf();
      if (c) (setCore(c), clearInterval(t));
    }, 200);
    return () => clearInterval(t);
  }, [core]);
  return core;
}

const NAMES = ["Approve", "Count in", "Ask", "Ledger", "Reorder", "Dispute", "Stock", "Help"];

/** Spec A9: hands-free without a camera. A simulated gaze, with the noise a webcam gives, drives the real snapping code. */
export function HandsFreeDemo() {
  const core = useCore();
  const box = useRef<HTMLDivElement>(null);
  const [running, setRunning] = useState(false);
  const [noise, setNoise] = useState(45);
  const [state, setState] = useState<{ p: { x: number; y: number } | null; hl: string | null; goal: string | null; dwell: number; hits: number; tries: number; log: string[] }>({ p: null, hl: null, goal: null, dwell: 0, hits: 0, tries: 0, log: [] });
  const run = useRef(0);

  useEffect(() => {
    if (!running || !core || !box.current) return;
    const id = ++run.current;
    const snap = new core.Snapper();
    const el = box.current;
    const targets = () => [...el.querySelectorAll<HTMLButtonElement>("[data-demo-target]")].map((b) => {
      const r = b.getBoundingClientRect(), o = el.getBoundingClientRect();
      return { id: b.dataset.demoTarget!, rect: { left: r.left - o.left, top: r.top - o.top, right: r.right - o.left, bottom: r.bottom - o.top } };
    });
    let goal = targets()[0];
    let since = performance.now(), hlSince = since, hl: string | null = null, hits = 0, tries = 0;
    const log: string[] = [];
    const gauss = () => Math.sqrt(-2 * Math.log(Math.random() + 1e-12)) * Math.cos(2 * Math.PI * Math.random());
    const drift = { x: 16, y: -10 };
    const tick = () => {
      if (run.current !== id) return;
      const t = performance.now();
      const ts = targets();
      if (t - since > 2600) {
        goal = ts[Math.floor(Math.random() * ts.length)];
        since = t;
        tries++;
      }
      const g = ts.find((x) => x.id === goal.id) ?? ts[0];
      const p = { x: (g.rect.left + g.rect.right) / 2 + drift.x + gauss() * noise, y: (g.rect.top + g.rect.bottom) / 2 + drift.y + gauss() * noise };
      const now = snap.sample(p, noise, t, ts);
      if (now !== hl) (hl = now), (hlSince = t);
      let dwell = hl ? Math.min(1, (t - hlSince) / 1100) : 0;
      if (dwell >= 1 && hl) {
        const ok = hl === g.id;
        if (ok) hits++;
        log.unshift(`${new Date().toLocaleTimeString()} dwell on ${hl}${ok ? "" : ` (wanted ${g.id})`}`);
        log.length = Math.min(log.length, 5);
        snap.confirm(p, ts.find((x) => x.id === hl)!.rect);
        hlSince = t + 1e9; // one click per fixation
        dwell = 0;
      }
      setState({ p, hl, goal: g.id, dwell, hits, tries: Math.max(tries, 1), log: [...log] });
      setTimeout(tick, 33);
    };
    tick();
    return () => void (run.current = id + 1);
  }, [running, core, noise]);

  const rect = (id: string | null) => {
    const b = id && box.current?.querySelector<HTMLElement>(`[data-demo-target="${id}"]`);
    if (!b || !box.current) return null;
    const r = b.getBoundingClientRect(), o = box.current.getBoundingClientRect();
    return { left: r.left - o.left - 4, top: r.top - o.top - 4, width: r.width + 8, height: r.height + 8 };
  };
  const hr = rect(state.hl);

  return (
    <div className="mt-3 rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => setRunning((r) => !r)} disabled={!core} aria-pressed={running}>
          {running ? <Square aria-hidden="true" /> : <Play aria-hidden="true" />} {running ? "Stop the simulated gaze" : "Start the simulated gaze (no camera)"}
        </Button>
        <label className="flex items-center gap-2 text-sm">
          Webcam noise
          <input type="range" min={15} max={90} step={5} value={noise} onChange={(e) => setNoise(Number(e.target.value))} aria-valuetext={`${noise} pixels`} />
          <span className="num w-14">{noise} px</span>
        </label>
        {!core && <span className="text-sm text-muted-foreground">Loading the hands-free code…</span>}
      </div>
      <div ref={box} className="relative mt-4 grid grid-cols-2 gap-3 overflow-hidden rounded-md border border-dashed border-border p-4 sm:grid-cols-4" aria-label="Simulated gaze demo" data-ls-skip>
        {NAMES.map((n, i) => (
          <button key={n} type="button" tabIndex={-1} data-demo-target={n} className={`rounded-md border border-input bg-background px-2 text-sm font-semibold ${i < 4 ? "h-[30px]" : "h-[44px]"} ${state.goal === n && running ? "outline outline-2 outline-dashed outline-muted-foreground" : ""}`}>
            {n} <span className="text-xs font-normal text-muted-foreground">{i < 4 ? "30 px" : "44 px"}</span>
          </button>
        ))}
        {running && hr && <span aria-hidden="true" className="pointer-events-none absolute rounded-[10px] border-[3px] border-[#f2b705]" style={{ ...hr, background: state.dwell > 0 ? `conic-gradient(rgb(242 183 5 / .35) ${state.dwell * 360}deg, transparent 0)` : undefined }} />}
        {running && state.p && <span aria-hidden="true" className="pointer-events-none absolute size-2.5 rounded-full bg-[#f2b705]/70" style={{ left: state.p.x - 5, top: state.p.y - 5 }} />}
      </div>
      <p className="mt-2 text-sm" aria-live="polite">
        {running ? <>Dashed outline: where the simulated person looks. Yellow ring: what the snapping code picked. {state.hits} of {state.tries} fixations clicked the right button.</> : <>The same snapping code as the real hands-free mode, fed a simulated gaze instead of a camera. Nothing is uploaded either way.</>}
      </p>
      {state.log.length > 0 && <ul className="mono mt-1 text-xs text-muted-foreground">{state.log.map((l) => <li key={l}>{l}</li>)}</ul>}
    </div>
  );
}

/** Published numbers: how often the snapped highlight lands on the intended control, by size and webcam noise. */
export function SnapTable() {
  const core = useCore();
  if (!core) return <p className="text-sm text-muted-foreground">Computing…</p>;
  const noises = [30, 45, 60, 90];
  return (
    <div className="table-wrap mt-2 overflow-x-auto">
      <table className="w-full text-sm">
        <caption className="sr-only">Share of simulated fixations where snapping picked the intended control</caption>
        <thead><tr className="border-b border-border text-left"><th className="p-2">Control height</th>{noises.map((n) => <th key={n} className="p-2">Noise {n} px</th>)}</tr></thead>
        <tbody>
          {[30, 44].map((s) => (
            <tr key={s} className="border-b border-border">
              <th className="p-2 text-left font-semibold">{s} px{s === 30 ? " (Peek's weak spot)" : " (hands-free minimum)"}</th>
              {noises.map((n) => <td key={n} className="num p-2">{core.simulate({ size: s, noisePx: n, trials: 300 })}%</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function HandsFreeIntro() {
  return (
    <p className="mt-2 flex items-start gap-2">
      <Hand className="mt-1 size-4 shrink-0" aria-hidden="true" />
      <span>Turn it on with the hand button in the header, or Alt+Shift+H. Point with your head (steadier on a webcam) or your eyes, then say “click”, dwell, or wink. Say “stop”, press Esc, or look away for two seconds to stop it at once. The mouse, keyboard and touch take over the moment they move.</span>
    </p>
  );
}
