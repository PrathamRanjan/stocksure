import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { Bot, Check, Gavel, X } from "lucide-react";
import { useView } from "@/lib/api";
import { useAction } from "@/lib/useAction";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Spinner, Stamp } from "@/components/brand";

export interface TalkMove {
  round: number;
  side: "buyer" | "supplier";
  action: "offer" | "accept" | "walk_away";
  lines: { line_id: string; remedy: string }[];
  price_pct: number | null;
  cost: string | null;
  model: string | null;
  allowed: boolean;
  reasons: string[];
  attempt: number;
  message: string;
  at: string;
}

export interface TalkModel {
  id: string;
  kind: "quote" | "shortfall";
  status: "open" | "agreed" | "walked_away" | "held" | "failed";
  round: number;
  max_rounds: number;
  po: { id: string; number: string; status: string; buyer: string | null; supplier: string | null };
  agents: { buyer: string; supplier: string };
  subject: null | {
    resolution_version: number;
    limit: string;
    already_committed: string;
    needed_by: string;
    lines: { line_id: string; sku: string; name: string; short_units: number; replaceable: boolean; replacement_at_quote: string; unit_price: string }[];
    mandate: { ceiling_pct: number; goodwill_ask_pct: number };
    floor: { floor_pct: number };
  };
  outcome: any;
  run_id: string | null;
  moves: TalkMove[];
}

const STATUS: Record<TalkModel["status"], { label: string; tone: "held" | "paid" | "stop" | "quiet" }> = {
  open: { label: "Agents talking", tone: "held" },
  agreed: { label: "Agreed: waiting for both of you", tone: "paid" },
  walked_away: { label: "No deal: nothing changed", tone: "quiet" },
  held: { label: "Held", tone: "held" },
  failed: { label: "Stopped", tone: "stop" },
};

function terms(m: TalkMove, t: TalkModel) {
  const sku = (id: string) => t.subject?.lines.find((l) => l.line_id === id)?.sku ?? id;
  if (m.action === "walk_away") return "walks away";
  if (m.action === "accept") return "accepts the other side's offer";
  const parts = m.lines.map((l) => `${sku(l.line_id)}: ${l.remedy === "replace" ? "replace" : "credit"}`);
  return `${parts.join(", ")}${m.lines.some((l) => l.remedy === "replace") && m.price_pct !== null ? ` at ${m.price_pct}% of the quote${m.cost ? ` (${m.cost})` : ""}` : ""}`;
}

/** The limits each side works inside, and every move with the referee's verdict. */
export function TalkMoves({ t }: { t: TalkModel }) {
  const s = STATUS[t.status] ?? STATUS.failed;
  return (
    <div className="space-y-4">
      <p className="flex flex-wrap items-center gap-2 text-sm">
        <Stamp tone={s.tone}>{s.label}</Stamp>
        <span>round {Math.min(t.round, t.max_rounds)} of {t.max_rounds}</span>
        {t.run_id && <a className="underline underline-offset-2" href={`/trace/${t.run_id}`}>trace</a>}
      </p>
      {t.subject && (
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-md border border-border p-3 text-sm">
            <p className="font-semibold">On the table</p>
            <ul className="mt-1 space-y-0.5">
              {t.subject.lines.map((l) => (
                <li key={l.line_id}>{l.sku}: {l.short_units} short · replacement {l.replaceable ? `${l.replacement_at_quote} at the quote` : "can't arrive in time"}</li>
              ))}
            </ul>
            <p className="mt-1 text-muted-foreground">Order limit {t.subject.limit}; {t.subject.already_committed} already committed.</p>
          </div>
          <div className="rounded-md border border-border p-3 text-sm">
            <p className="font-semibold">The café's agent (owner's mandate)</p>
            <p>Never above {t.subject.mandate.ceiling_pct}% of the quote; asks up to {t.subject.mandate.goodwill_ask_pct}% off; a replacement only if it arrives in time.</p>
          </div>
          <div className="rounded-md border border-border p-3 text-sm">
            <p className="font-semibold">The wholesaler's agent (its floor)</p>
            <p>Never below {t.subject.floor.floor_pct}% of the quote; prefers a replacement to a credit.</p>
          </div>
        </div>
      )}
      <p className="text-xs text-muted-foreground">Each agent sees only its own side's limit. Both are shown here so you can check the referee. The referee is code: it refuses any move outside either limit, any line that isn't short, and anything over the order's limit.</p>
      <ol className="space-y-2" aria-live="polite" aria-label="Moves">
        {t.moves.map((m, i) => (
          <li key={i} data-allowed={m.allowed} className={cn("rounded-md border p-3 text-sm", m.side === "buyer" ? "sm:mr-12" : "sm:ml-12", m.allowed ? "border-border" : "border-stop")}>
            <div className="flex flex-wrap items-center gap-2">
              <Bot className="size-4" aria-hidden="true" />
              <b>Round {m.round} · {m.side === "buyer" ? "café's agent" : "wholesaler's agent"}</b>
              <span>{terms(m, t)}</span>
            </div>
            {m.message && <p className="mt-1">“<span data-i18n-ai>{m.message}</span>”</p>}
            <p className={cn("mt-1 flex items-start gap-1.5 text-xs", m.allowed ? "text-muted-foreground" : "font-semibold text-stop")}>
              <Gavel className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              {m.allowed ? <span>Referee: allowed{m.model ? ` · written by ${m.model}` : ""}</span> : <span>Referee refused it{m.attempt > 1 ? " (second try)" : ""}: {m.reasons.join("; ")}</span>}
            </p>
          </li>
        ))}
        {t.status === "open" && (
          <li className="flex items-center gap-2 text-sm text-muted-foreground"><Spinner /> The next agent is thinking…</li>
        )}
      </ol>
      {t.status === "agreed" && t.outcome && (
        <p className="flex items-start gap-2 rounded-md border border-foreground p-3 text-sm">
          <Check className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>Agreed: {t.outcome.terms}. That is resolution v{t.outcome.resolution_version} of the fix. <b>Nothing is paid until both people approve it.</b></span>
        </p>
      )}
      {(t.status === "walked_away" || t.status === "failed") && t.outcome && (
        <p className="flex items-start gap-2 rounded-md border border-border p-3 text-sm">
          <X className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>{t.outcome.note ?? t.outcome.error ?? "No agreement."}</span>
        </p>
      )}
    </div>
  );
}

/** The order page's panel: send the agents in on a shortfall, then watch the moves live. */
export function ShortfallAgents({ poId, onSettled }: { poId: string; onSettled?: () => void }) {
  const [poll, setPoll] = useState<number | false>(false);
  const v = useView<{ can_start: boolean; ready: boolean; latest: TalkModel | null }>(`/api/ui/po/${poId}/agents`, { poll });
  const status = v.data?.latest?.status;
  const prev = useRef(status);
  useEffect(() => {
    setPoll(status === "open" ? 1500 : false);
    // When the agents finish, the order's resolution has a new version: reload the order page too.
    if (prev.current === "open" && status && status !== "open") onSettled?.();
    prev.current = status;
  }, [status, onSettled]);
  const { run, busy } = useAction(() => v.reload());
  const d = v.data;
  if (!d) return null;
  const t = d.latest;
  if (!t && !d.can_start) return null;
  return (
    <section id="agents" aria-labelledby="sa-title" className="scroll-mt-20 rounded-lg border border-border bg-card p-4 sm:p-5">
      <h2 id="sa-title" className="mb-2 text-xl">Let the agents settle it</h2>
      {d.can_start && (!t || t.status !== "open") && (
        <div className="mb-3 flex flex-wrap items-center gap-3 text-sm">
          <span>Instead of choosing the fix yourself, send in two agents: yours, inside your mandate, and the wholesaler's, inside its floor. You both still approve what they agree.</span>
          <Button size="sm" disabled={!!busy} onClick={async () => { const r = await run("agents", `/api/ui/po/${poId}/agents`, {}, { stay: true, quiet: true }); if (r.ok) { setPoll(1500); v.reload(); } }}>
            {busy === "agents" && <Spinner />} Send the agents in
          </Button>
        </div>
      )}
      {!d.ready && <p className="text-sm text-muted-foreground">The AI isn't configured on this server, so the agents can't run.</p>}
      {t && <TalkMoves t={t} />}
      {t && <p className="mt-2 text-sm"><Link className="underline underline-offset-2" to={`/negotiations/${t.id}`}>Open this negotiation on its own page</Link></p>}
    </section>
  );
}
