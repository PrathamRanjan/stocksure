import { useState, type ReactNode } from "react";
import { Link } from "react-router";
import { AlertTriangle, Check, CircleDashed, FileText, MessageSquare, RotateCcw, ShieldAlert, X } from "lucide-react";
import { ago, day, money, plural, when } from "@/lib/format";
import { useAction } from "@/lib/useAction";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PushToTalk } from "@/components/push-to-talk";
import { LocalEstimate } from "@/components/local-estimate";
import { Empty, PayPalStamp, SectionTitle, SettlementBar, Spinner, Stamp, Tally, TallyLegend } from "@/components/brand";
import type { Op, PoModel, Resolution } from "./types";

/** datetime-local values are the viewer's local time; the server reads "YYYY-MM-DDTHH:mm" as UTC, so convert first. */
export const toUtcInput = (local: string) => (local ? new Date(local).toISOString().slice(0, 16) : "");
export const localInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);

export function Panel({ children, className, tour, id, label }: { children: ReactNode; className?: string; tour?: string; id?: string; label?: string }) {
  return (
    <section id={id} data-tour={tour} aria-labelledby={label} className={cn("scroll-mt-20 rounded-lg border border-border bg-card p-4 sm:p-5", className)}>
      {children}
    </section>
  );
}

/* ---------------- Lines: the tally strip per line, receipt texts and the supplier's review ---------------- */
export function Lines({ m, reload }: { m: PoModel; reload: () => void }) {
  const { run, busy } = useAction(reload);
  const [dispute, setDispute] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const counted = m.lines.some((l) => l.receipt);
  return (
    <Panel tour="lines" label="lines-title" id="lines">
      <SectionTitle id="lines-title" aside={m.receipt ? `counted v${m.receipt.version} by ${m.receipt.confirmed_by}` : "not counted yet"}>What was ordered{counted ? " and what arrived" : ""}</SectionTitle>
      <ol className="divide-y divide-border">
        {m.lines.map((l) => (
          <li key={l.id} id={`line-${l.id}`} className="py-4 first:pt-0 last:pb-0">
            <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
              <div className="min-w-0">
                <p className="font-semibold">
                  <span className="mono mr-1.5 text-xs text-muted-foreground">{l.line_no}</span>
                  {l.product.name}
                </p>
                <p className="text-sm text-muted-foreground">
                  <span className="mono">{l.product.sku}</span> · {l.qty_packs} × {l.product.pack_label} ({l.ordered_text})
                  {l.unit_price_cents !== null && <> · <span className="num">{money(l.unit_price_cents)}</span> each = <span className="num font-semibold text-foreground">{money(l.quoted_cents)}</span></>}
                </p>
                <p className="text-sm text-muted-foreground">
                  Shortfall: {l.replace_shortfall ? "replace" : "credit"}
                  {l.substitutes.length > 0 && <> · substitutes allowed: <span className="mono">{l.substitutes.join(", ")}</span></>}
                </p>
              </div>
              <Tally t={l.tally} label={`Line ${l.line_no}`} />
            </div>
            {l.receipt && (
              <div className="mt-3 rounded-md bg-paper-2 p-3 text-sm">
                <dl className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
                  <div><dt className="text-muted-foreground">Delivered</dt><dd className="num font-semibold">{l.receipt.delivered}</dd></div>
                  <div><dt className="text-muted-foreground">Accepted</dt><dd className="num font-semibold">{l.receipt.accepted}</dd></div>
                  <div><dt className="text-muted-foreground">Damaged</dt><dd className="num">{l.receipt.damaged}</dd></div>
                  <div><dt className="text-muted-foreground">Wrong item</dt><dd className="num">{l.receipt.wrong}</dd></div>
                </dl>
                {l.receipt.note && <p className="mt-2">“{l.receipt.note}”</p>}
                <p className="mt-2 flex flex-wrap items-center gap-2">
                  <span className="text-muted-foreground">Supplier:</span>
                  {l.receipt.supplier_status === "agreed" ? <Stamp tone="paid">Agreed</Stamp> : l.receipt.supplier_status === "disputed" ? <Stamp tone="stop">Disputed</Stamp> : <Stamp tone="quiet">Not reviewed</Stamp>}
                  {l.receipt.supplier_note && <span>“{l.receipt.supplier_note}”</span>}
                </p>
              </div>
            )}
            {l.can_review && (
              <div className="mt-3">
                {dispute === l.id ? (
                  <form
                    className="grid gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void run(`d${l.id}`, `/po/${m.po.id}/lines/${l.id}/review`, { action: "dispute", note, seen: l.receipt!.fingerprint }).then((r) => r.ok && setDispute(null));
                    }}
                  >
                    <Label htmlFor={`dn-${l.id}`}>What's wrong with this count? The café sees your note.</Label>
                    <Textarea id={`dn-${l.id}`} required value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Driver's photo shows 7 cases at the door" /><PushToTalk label="Hold to speak" onText={(t) => setNote((x) => (x.trim() ? `${x.trim()} ${t}` : t))} />
                    <div className="flex gap-2">
                      <Button type="submit" variant="destructive" disabled={!!busy}>{busy === `d${l.id}` && <Spinner />} Send dispute</Button>
                      <Button type="button" variant="ghost" onClick={() => setDispute(null)}>Cancel</Button>
                    </div>
                  </form>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    <Button variant="paid" disabled={!!busy} onClick={() => run(`a${l.id}`, `/po/${m.po.id}/lines/${l.id}/review`, { action: "agree", note: "", seen: l.receipt!.fingerprint })}>
                      {busy === `a${l.id}` ? <Spinner /> : <Check aria-hidden="true" />} Agree with line {l.line_no}
                    </Button>
                    <Button variant="outline" onClick={() => { setNote(""); setDispute(l.id); }}>
                      <X aria-hidden="true" /> Dispute
                    </Button>
                  </div>
                )}
              </div>
            )}
          </li>
        ))}
      </ol>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-dashed border-input pt-3">
        <TallyLegend />
        <p className="text-sm">
          Quote total <span className="num font-heading text-lg font-bold">{money(m.quote_total_cents || null)}</span> · limit <span className="num">{money(m.po.limit_cents)}</span>
        </p>
      </div>
    </Panel>
  );
}

/* ---------------- Money: the settlement bar ---------------- */
export function MoneyPanel({ m }: { m: PoModel }) {
  return (
    <Panel tour="money" label="money-title" id="money">
      <SectionTitle id="money-title" aside={m.po.kind === "replacement" ? "shared with the original order's limit" : undefined}>Where the money is</SectionTitle>
      {m.funding ? (
        <>
          <SettlementBar f={m.funding} />
          <LocalEstimate cents={m.quote_total_cents ?? 0} />
          {m.hold?.live && (
            <p className="mt-3 text-sm" data-hold-dates>
              {m.hold.reauthorized_at ? (
                <>Hold <span className="mono">{m.hold.authorization_id}</span> was refreshed {day(m.hold.reauthorized_at)}; PayPal keeps it valid until {day(m.hold.valid_until)}.</>
              ) : (
                <>Best charged by <strong>{day(m.hold.best_charged_by)}</strong>: PayPal guarantees the held amount for {m.hold.honor_days} days and keeps the hold valid until {day(m.hold.valid_until)}. If the count is agreed later, StockSure refreshes the hold before charging.</>
              )}
            </p>
          )}
        </>
      ) : (
        <Empty title="Nothing held yet" art={<div className="sbar mx-auto mb-3 w-40 opacity-50" aria-hidden="true" />}>
          {m.quote_total_cents ? <>Accepting the quote places a PayPal hold for <span className="num font-semibold">{money(m.quote_total_cents)}</span>. A hold isn't a charge.</> : "Once the supplier quotes, accepting places a PayPal hold for the quote. A hold isn't a charge."}
        </Empty>
      )}
    </Panel>
  );
}

/* ---------------- Resolution: the agreed version, what moves, approvals ---------------- */
export function ResolutionPanel({ m, reload }: { m: PoModel; reload: () => void }) {
  const r = m.resolution;
  const { run, busy } = useAction(reload);
  const [revise, setRevise] = useState(false);
  if (!r)
    return (
      <Panel tour="resolution" label="res-title" id="resolution">
        <SectionTitle id="res-title">The agreement</SectionTitle>
        <Empty title="Appears after the count" art={<CircleDashed className="mx-auto mb-2 size-8 opacity-50" aria-hidden="true" />}>
          Once the delivery is counted and the supplier agrees, StockSure works out the payment: quote price × accepted units. Both sides approve the same version before PayPal charges anything.
        </Empty>
      </Panel>
    );
  const t = r.totals;
  const short = r.lines.filter((l) => l.shortfall > 0);
  const release = r.funding.release_expected_cents;
  return (
    <Panel tour="resolution" label="res-title" id="resolution" className={r.open ? "border-2 border-foreground" : undefined}>
      <SectionTitle id="res-title" aside={<span className="mono">v{r.version} · {r.hash.slice(0, 10)}</span>}>The agreement</SectionTitle>
      <div className="flex flex-wrap gap-2">
        {r.status === "agreed" || r.status === "settled" ? <Stamp tone="paid">Agreed by both</Stamp> : r.status === "proposed" ? <Stamp tone="held">Proposed</Stamp> : <Stamp tone="quiet">{r.status}</Stamp>}
        {r.auto && <Stamp tone="carbon">Clean delivery: agreed automatically</Stamp>}
        {r.negotiated && <Stamp tone="carbon">Terms from the agents: replacement at {r.negotiated.replacement_price_pct}% of the quote</Stamp>}
      </div>
      {r.negotiated && r.open && <p className="mt-2 text-sm">The two agents agreed these terms (<a className="underline underline-offset-2" href={`/negotiations/${r.negotiated.negotiation_id}`}>see every move</a>). They are only a proposal: nothing is paid until both of you approve this version.</p>}

      <div className="mt-4 overflow-x-auto focus-visible:outline-2 focus-visible:outline-ring" tabIndex={0} role="region" aria-label="Line by line, scrolls sideways">
        <table className="w-full min-w-[30rem] text-sm">
          <caption className="sr-only">Payment per line</caption>
          <thead className="text-left text-muted-foreground">
            <tr className="border-b border-border">
              <th scope="col" className="py-2 pr-3 font-semibold">Line</th>
              <th scope="col" className="py-2 pr-3 font-semibold">Ordered</th>
              <th scope="col" className="py-2 pr-3 font-semibold">Paid for</th>
              <th scope="col" className="py-2 pr-3 font-semibold">Short</th>
              <th scope="col" className="py-2 text-right font-semibold">Charge</th>
            </tr>
          </thead>
          <tbody>
            {r.lines.map((l) => (
              <tr key={l.line_id} className="border-b border-dashed border-input align-top">
                <th scope="row" className="py-2 pr-3 text-left font-semibold">{l.line_no}. {l.sku}</th>
                <td className="num py-2 pr-3">{l.ordered_text}</td>
                <td className="num py-2 pr-3">{l.paid_text}</td>
                <td className="py-2 pr-3">{l.shortfall > 0 ? <><span className="num">{l.short_text}</span> <Stamp tone={l.remedy === "replace" ? "carbon" : "quiet"} className="ml-1">{l.remedy}</Stamp></> : "—"}</td>
                <td className="num py-2 text-right font-semibold">{money(l.accepted_cents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">Charge = quote price × accepted units, in whole cents. The invoice is compared, never paid from.</p>

      {r.flags.filter((f) => f.code !== "invoice_missing").length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {r.flags.filter((f) => f.code !== "invoice_missing").map((f, i) => (
            <li key={i} className="flex gap-2 rounded-md bg-stop-soft px-3 py-2 text-sm"><AlertTriangle className="mt-0.5 size-4 shrink-0 text-stop" aria-hidden="true" /> {f.message}</li>
          ))}
        </ul>
      )}

      {short.length > 0 && (
        <div className="mt-4 rounded-md border border-border p-3">
          <p className="font-semibold">Replacement</p>
          {r.plan.chosen ? (
            <ul className="mt-1 text-sm">
              {r.plan.chosen.picks.map((p, i) => (
                <li key={i}>{p.packs} × <span className="mono">{p.sku}</span> {p.name} · <span className="num">{money(p.cents)}</span> · arrives {when(p.eta)}</li>
              ))}
              {r.plan.chosen.unfilled_units > 0 && <li className="text-stop">Some of the shortfall can't be filled within the limit; it is credited.</li>}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">{short.some((l) => l.remedy === "replace") ? "No replacement fits the limit and the deadline; the shortfall is credited." : "Shortfall is credited: you simply don't pay for it."}</p>
          )}
          {r.plan.blocked.length > 0 && <p className="mt-1 text-sm text-muted-foreground">Not used: {r.plan.blocked.map((b) => `${b.sku} (${b.reason})`).join("; ")}</p>}
        </div>
      )}

      <div className="mt-4 rounded-md bg-foreground p-4 text-background" aria-label="What PayPal will do">
        <p className="font-heading font-bold">What moves when both approve</p>
        <ul className="mt-2 space-y-1 text-[0.95rem]">
          <li>Capture <span className="num font-bold">{money((t.payable_cents ?? t.accepted_cents) - (r.part_charged_cents || 0))}</span> from the hold to {m.po.supplier_name}{r.part_charged_cents ? ` (part 1 already charged ${money(r.part_charged_cents)})` : ""}{t.early_discount_cents ? ` (${money(t.early_discount_cents)} early-payment discount taken off, per the invoice's terms)` : ""}</li>
          {release > 0 && <li>Release <span className="num font-bold">{money(release)}</span> back to {m.po.buyer_name}'s PayPal (the rest of the hold)</li>}
          {t.replacement_cents > 0 && <li>Place a new hold of <span className="num font-bold">{money(t.replacement_cents)}</span> for the replacement</li>}
          <li className="opacity-85">Total committed <span className="num">{money(t.final_cents)}</span> of the <span className="num">{money(t.limit_cents)}</span> limit · <span className="num">{money(t.headroom_cents)}</span> left</li>
        </ul>
      </div>

      <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1"><dt className="text-muted-foreground">{m.po.buyer_name}</dt><dd className="flex min-w-0 flex-wrap items-center gap-x-2">{r.buyer_approved_by ? <><Stamp tone="paid">Approved</Stamp><span className="min-w-0 break-words">{r.buyer_approved_by}</span></> : <Stamp tone="quiet">Not yet</Stamp>}</dd></div>
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1"><dt className="text-muted-foreground">{m.po.supplier_name}</dt><dd className="flex min-w-0 flex-wrap items-center gap-x-2">{r.supplier_approved_by ? <><Stamp tone="paid">Approved</Stamp><span className="min-w-0 break-words">{r.supplier_approved_by}</span></> : <Stamp tone="quiet">Not yet</Stamp>}</dd></div>
      </dl>

      {r.open && (
        <div className="mt-4 flex flex-wrap gap-2 border-t border-dashed border-input pt-4">
          {r.can_approve && (
            <Button variant="paid" size="lg" disabled={!!busy} onClick={() => run("approve", `/po/${m.po.id}/resolution/approve`, { version: String(r.version), hash: r.hash })}>
              {busy === "approve" ? <Spinner /> : <Check aria-hidden="true" />} {`Approve v${r.version}`}
            </Button>
          )}
          {r.i_approved && <p className="self-center text-sm font-semibold">You approved this version. Waiting for the other side.</p>}
          {r.can_revise && (
            <Button variant="outline" size="lg" onClick={() => setRevise((x) => !x)} aria-expanded={revise}>
              <RotateCcw aria-hidden="true" /> Change the fix
            </Button>
          )}
          <p className="w-full text-sm text-muted-foreground">Until both approve, nothing is charged. Changing the fix makes a new version and both sides approve again.</p>
        </div>
      )}
      {revise && r.can_revise && <Revise m={m} r={r} onDone={() => { setRevise(false); reload(); }} />}
    </Panel>
  );
}

function Revise({ m, r, onDone }: { m: PoModel; r: Resolution; onDone: () => void }) {
  const { run, busy } = useAction(onDone);
  const short = r.lines.filter((l) => l.shortfall > 0);
  const [choices, setChoices] = useState<Record<string, string>>(Object.fromEntries(short.map((l) => [l.line_id, l.remedy])));
  const [nb, setNb] = useState(localInput(new Date(r.needed_by)));
  const [plan, setPlan] = useState(String(r.plan.chosen_index ?? 0));
  return (
    <form
      className="mt-4 grid gap-4 rounded-md border border-border p-4"
      onSubmit={(e) => {
        e.preventDefault();
        const data: Record<string, string> = { needed_by: toUtcInput(nb), plan_index: plan };
        for (const [k, v] of Object.entries(choices)) data[`choice_${k}`] = v;
        void run("revise", `/po/${m.po.id}/resolution/revise`, data);
      }}
    >
      {short.map((l) => (
        <fieldset key={l.line_id}>
          <legend className="font-semibold">Line {l.line_no} ({l.sku}): {l.short_text} short</legend>
          <div className="mt-1 flex flex-wrap gap-2">
            {(["replace", "credit"] as const).map((c) => (
              <label key={c} className={cn("flex min-h-11 cursor-pointer items-center gap-2 rounded-md border px-3", choices[l.line_id] === c ? "border-foreground bg-accent" : "border-input")}>
                <input type="radio" name={`choice_${l.line_id}`} value={c} checked={choices[l.line_id] === c} onChange={() => setChoices({ ...choices, [l.line_id]: c })} />
                {c === "replace" ? "Send a replacement" : "Credit it (don't pay)"}
              </label>
            ))}
          </div>
        </fieldset>
      ))}
      <div className="grid gap-1.5 sm:max-w-xs">
        <Label htmlFor="nb">Replacement needed by (your time)</Label>
        <Input id="nb" type="datetime-local" value={nb} onChange={(e) => setNb(e.target.value)} />
      </div>
      {r.plan.alternatives.length > 1 && (
        <fieldset>
          <legend className="font-semibold">Replacement plan</legend>
          <div className="mt-1 grid gap-2">
            {r.plan.alternatives.slice(0, 4).map((p, i) => (
              <label key={i} className={cn("flex min-h-11 cursor-pointer items-start gap-2 rounded-md border p-3 text-sm", plan === String(i) ? "border-foreground bg-accent" : "border-input")}>
                <input type="radio" name="plan_index" value={i} checked={plan === String(i)} onChange={() => setPlan(String(i))} className="mt-1" />
                <span>
                  <span className="num font-semibold">{money(p.cost_cents)}</span> · {p.picks.map((x) => `${x.packs} × ${x.sku}`).join(", ")}
                  {p.eta_max && <> · by {when(p.eta_max)}</>}
                  {p.unfilled_units > 0 && <span className="text-stop"> · leaves some unfilled</span>}
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      )}
      <div className="flex gap-2">
        <Button type="submit" disabled={!!busy}>{busy === "revise" && <Spinner />} Propose a new version</Button>
      </div>
    </form>
  );
}

/* ---------------- PayPal timeline ---------------- */
const OP_LABEL: Record<Op["kind"], string> = { authorize: "Hold placed", capture: "Captured", void: "Hold released", refund: "Refunded" };
export function PayPalPanel({ m, reload }: { m: PoModel; reload: () => void }) {
  const { run, busy } = useAction(reload);
  const ops = [...m.ops].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const failed = ops.some((o) => o.status === "failed");
  const canRetry = (m.me.owner || m.me.side === "supplier") && (m.po.status === "exception" || m.po.status === "settling" || m.po.status === "part_settling") && failed;
  return (
    <Panel tour="paypal-ops" label="pp-title" id="paypal">
      <SectionTitle id="pp-title" aside="PayPal sandbox">PayPal activity</SectionTitle>
      {ops.length ? (
        <ol className="relative ml-2 border-l-2 border-border">
          {ops.map((o) => (
            <li key={o.id} className="relative pb-4 pl-5 last:pb-0">
              <span className={cn("absolute -left-[7px] top-1.5 size-3 rounded-full border-2 border-card", o.status === "succeeded" ? "bg-paid" : o.status === "failed" ? "bg-stop" : "bg-held")} aria-hidden="true" />
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{OP_LABEL[o.kind]}{o.final_capture ? " (final)" : ""}</span>
                <span className="num font-heading font-bold">{money(o.amount_cents)}</span>
                {o.status === "failed" ? <Stamp tone="stop">Failed</Stamp> : o.status !== "succeeded" ? <Stamp tone="held">{o.status}</Stamp> : <PayPalStamp status={o.paypal_status} />}
                {m.tree.length > 1 && <span className="text-sm text-muted-foreground">{o.po_number}</span>}
              </div>
              <p className="mt-0.5 break-all text-xs text-muted-foreground">
                {o.paypal_id && <>PayPal id <span className="mono text-foreground">{o.paypal_id}</span> · </>}
                request <span className="mono">{o.request_id.slice(0, 22)}</span>
                {o.attempts > 1 && <> · {o.attempts} attempts, same request id</>} · {when(o.updated_at)}
              </p>
              {o.error && <p className="mt-1 text-sm text-stop">{o.error}</p>}
            </li>
          ))}
        </ol>
      ) : (
        <Empty title="No PayPal calls yet" art={<div className="mx-auto mb-2 w-fit"><Stamp tone="quiet">Nothing held</Stamp></div>}>
          The first call is the hold, when the quote is accepted. Every call is listed here with its PayPal id.
        </Empty>
      )}
      {ops.some((o) => o.paypal_id) && (m.me.owner || m.me.side === "supplier") && <Reconcile poId={m.po.id} />}
      {canRetry && (
        <Button className="mt-4" variant="carbon" disabled={!!busy} onClick={() => run("retry", `/po/${m.po.id}/retry-settle`)}>
          {busy === "retry" ? <Spinner /> : <RotateCcw aria-hidden="true" />} Retry from the first unfinished step
        </Button>
      )}
    </Panel>
  );
}

interface Recon { summary: string; ok: boolean; checked_at: string; rows: { paypal_id: string; kind: string; ours_cents: number; paypal_cents: number | null; paypal_status: string | null; verdict: "matched" | "differs" | "missing"; note: string | null }[]; extra: { kind: string; paypal_id: string; cents: number | null; status: string | null }[] }

/** Spec B4 item 5: read every PayPal id back from PayPal and compare. GET calls only. */
function Reconcile({ poId }: { poId: string }) {
  const [r, setR] = useState<Recon | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function check() {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/ui/po/${poId}/reconcile`, { method: "POST", headers: { "X-StockSure-UI": "1", Accept: "application/json" }, credentials: "same-origin" });
      const j = await res.json();
      if (!res.ok) throw new Error(j.message ?? "PayPal couldn't be checked.");
      setR(j);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mt-4 border-t border-dashed border-input pt-3" data-reconcile>
      <Button size="sm" variant="outline" disabled={busy} onClick={check}>{busy ? <Spinner /> : <RotateCcw aria-hidden="true" />} Check against PayPal</Button>
      <p className="mt-1 text-xs text-muted-foreground">Reads each PayPal id back from PayPal and compares amounts. Moves no money.</p>
      <div aria-live="polite">
        {err && <p className="mt-2 text-sm text-stop">{err}</p>}
        {r && (
          <div className="mt-2 text-sm">
            <p className={cn("font-semibold", r.ok ? "text-paid" : "text-stop")} data-reconcile-summary>{r.summary}</p>
            <ul className="mt-1 space-y-1">
              {r.rows.map((x) => (
                <li key={x.paypal_id} className="break-all">
                  <Stamp tone={x.verdict === "matched" ? "paid" : "stop"}>{x.verdict}</Stamp> {(OP_LABEL as Record<string, string>)[x.kind] ?? x.kind} <span className="mono">{x.paypal_id}</span> · ours {money(x.ours_cents)} · PayPal {x.paypal_cents === null ? "—" : money(x.paypal_cents)} {x.paypal_status ?? ""}
                  {x.note && <span className="block text-xs text-muted-foreground">{x.note}</span>}
                </li>
              ))}
              {r.extra.map((x) => (
                <li key={x.paypal_id} className="break-all"><Stamp tone="stop">extra</Stamp> {x.kind} <span className="mono">{x.paypal_id}</span> {x.cents === null ? "" : money(x.cents)} {x.status ?? ""}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------------- Documents ---------------- */
const FLAG: Record<string, string> = { agent_instruction: "Instruction to an assistant", payment_redirect: "Tries to change who gets paid", amount_override: "Tries to change the amount", hidden_characters: "Hidden characters" };
const CHECK: Record<string, string> = { duplicate_of_earlier_invoice: "Duplicate of an earlier invoice", price_above_recent: "Price above the last deliveries", asks_to_change_payee: "Asks to pay somewhere new", contains_instruction: "Written to an AI reader", early_payment_terms: "Early-payment discount" };
export function DocsPanel({ m, reload }: { m: PoModel; reload?: () => void }) {
  const { run, busy } = useAction(reload);
  return (
    <Panel tour="docs" label="docs-title" id="documents">
      <SectionTitle id="docs-title" aside={m.docs.length ? plural(m.docs.length, "file") : undefined}>Paperwork</SectionTitle>
      {m.docs.length ? (
        <ul className="divide-y divide-border">
          {m.docs.map((d) => (
            <li key={d.id} className="py-3 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-center gap-2">
                <FileText className="size-4" aria-hidden="true" />
                <a href={`/doc/${d.id}`} target="_blank" rel="noopener" className="font-semibold underline underline-offset-2">{d.filename}</a>
                <Stamp tone="quiet">{d.kind.replace("_", " ")}</Stamp>
                <span className="text-sm text-muted-foreground">by {d.uploaded_by} · {ago(d.created_at)}</span>
              </div>
              <p className="mono mt-0.5 text-xs text-muted-foreground">sha256 {d.sha256.slice(0, 16)}…</p>
              {d.checks && (
                <div className={cn("mt-2 rounded-md border p-3 text-sm", d.checks.flags.some((f) => f.code !== "early_payment_terms") ? "border-stop/40 bg-stop-soft" : "border-border")} data-invoice-checks={d.checks.flags.map((f) => f.code).join(" ")}>
                  <p className="font-semibold">Invoice checks{d.checks.number ? ` · ${d.checks.number}` : ""}: {d.checks.flags.length ? `${plural(d.checks.flags.length, "finding")}` : "nothing found"}</p>
                  <ul className="mt-1 space-y-1">
                    {d.checks.flags.map((f, i) => (
                      <li key={i}><span className={cn("font-semibold", f.code !== "early_payment_terms" && "text-stop")}>{CHECK[f.code] ?? f.code}</span>: {f.message} <span className="text-xs text-muted-foreground">({f.by === "decisions" ? `OpenAI Decisions${d.checks!.decisions_model ? `, ${d.checks!.decisions_model}` : ""}` : "code"})</span></li>
                    ))}
                  </ul>
                  <p className="mt-1 text-muted-foreground">Checked in code against your past deliveries and the supplier's details on file{d.checks.decisions_model ? `, with ${d.checks.decisions_model} as a second reader` : ""}. The payment is always the agreed counts at the quoted price.</p>
                </div>
              )}
              {d.flags.length > 0 && (
                <div className="mt-2 rounded-md border border-stop/40 bg-stop-soft p-3 text-sm">
                  <p className="flex items-center gap-2 font-semibold text-stop"><ShieldAlert className="size-4" aria-hidden="true" /> Removed before anything read it</p>
                  <ul className="mt-1 space-y-1">
                    {d.flags.map((f, i) => (
                      <li key={i}>
                        <span className="font-semibold">{FLAG[f.kind ?? ""] ?? f.kind ?? f.code}</span>
                        {f.text && <>: <q className="break-words">{f.text.slice(0, 140)}</q></>}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-1 text-muted-foreground">No PayPal call takes a payee, so paperwork can't redirect money.</p>
                </div>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <Empty title="No paperwork yet" art={<FileText className="mx-auto mb-2 size-8 opacity-50" aria-hidden="true" />}>
          The supplier's invoice arrives with dispatch; the café adds the delivery docket and photos when counting.
        </Empty>
      )}
      {m.can_send_invoice && (
        <div className="mt-4 rounded-md border border-dashed border-input p-3 text-sm" id="send-invoice">
          <p className="font-semibold">Send an invoice for {m.po.number}</p>
          <p className="text-muted-foreground">StockSure checks every invoice: duplicates, prices above your last three deliveries, a new payee, lines written to an AI. Sample invoices for the demo:</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button size="sm" variant="outline" disabled={!!busy} onClick={() => run("inv-bad", `/po/${m.po.id}/invoice`, { sample: "bad" })}>{busy === "inv-bad" && <Spinner />} Send a bad invoice</Button>
            <Button size="sm" variant="outline" disabled={!!busy} onClick={() => run("inv-dup", `/po/${m.po.id}/invoice`, { sample: "duplicate" })}>{busy === "inv-dup" && <Spinner />} Send the last invoice again, new number</Button>
            <Button size="sm" variant="outline" disabled={!!busy} onClick={() => run("inv-early", `/po/${m.po.id}/invoice`, { sample: "discount" })}>{busy === "inv-early" && <Spinner />} Send one with a 2% early-payment discount</Button>
          </div>
          <form className="mt-2 flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); run("inv-file", `/po/${m.po.id}/invoice`, f); }}>
            <label className="text-sm" htmlFor="inv-file">Or upload your own</label>
            <input id="inv-file" name="invoice" type="file" accept=".txt,.pdf,image/*" className="text-sm" required />
            <Button size="sm" type="submit" variant="outline" disabled={!!busy}>Send</Button>
          </form>
        </div>
      )}
    </Panel>
  );
}

/* ---------------- Messages with the scam check ---------------- */
export function Messages({ m, reload }: { m: PoModel; reload: () => void }) {
  const { run, busy } = useAction(reload);
  // The judge page links here with ?say= to prefill a message; the person still presses Send.
  const [body, setBody] = useState(() => new URLSearchParams(location.search).get("say")?.slice(0, 2000) ?? "");
  const [line, setLine] = useState("");
  return (
    <Panel label="msg-title" id="messages">
      <SectionTitle id="msg-title" aside={m.messages.length ? plural(m.messages.length, "message") : undefined}>Messages</SectionTitle>
      {m.messages.length ? (
        <ol className="space-y-3">
          {m.messages.map((x) => {
            const l = m.lines.find((y) => y.id === x.line_id);
            return (
              <li key={x.id} className={cn("rounded-md p-3", x.role === "supplier" ? "bg-paper-2" : "border border-border")}>
                <p className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-semibold">{x.author}</span>
                  {l && <Stamp tone="quiet">line {l.line_no}</Stamp>}
                  {x.kind !== "text" && <Stamp tone="carbon">{x.kind}</Stamp>}
                  <span className="text-muted-foreground">{ago(x.created_at)}</span>
                </p>
                <p className="mt-1 whitespace-pre-wrap break-words">{x.body}</p>
                {x.scan && (
                  <div className={cn("mt-2 flex gap-2 rounded-md px-3 py-2 text-sm", x.scan.level === "hold" ? "bg-stop-soft" : "bg-held-soft")} role="note">
                    <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                    <div>
                      <p><span className="font-semibold">{x.scan.level === "hold" ? "Scam check: don't pay on this." : "Scam check: check first."}</span> {x.scan.advice ?? "This reads like a common payment scam. Bank details can't change here; check by calling a number you already have."}</p>
                      {x.scan.words.length > 0 && <ul className="mt-1 list-disc pl-5">{x.scan.words.slice(0, 3).map((w, i) => <li key={i}>{w}</li>)}</ul>}
                      <p className="mt-1 text-xs text-muted-foreground">
                        {x.scan.readers ? `Rules: ${x.scan.readers.rules} · Decisions: ${x.scan.readers.decisions} · Destinations in code: ${x.scan.readers.code}` : "Rules only; this message has not had the full check."}
                      </p>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="text-muted-foreground"><MessageSquare className="mr-1.5 inline size-4" aria-hidden="true" />No messages. Use this for anything about the delivery; both sides see it.</p>
      )}
      {m.can_post && (
        <form
          className="mt-4 grid gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!body.trim()) return;
            void run("post", `/po/${m.po.id}/message`, { body, line_id: line || undefined }, { stay: true, quiet: true }).then((r) => r.ok && setBody(""));
          }}
        >
          <Label htmlFor="msg">Write to {m.me.side === "buyer" ? m.po.supplier_name : m.po.buyer_name}</Label>
          <Textarea id="msg" value={body} onChange={(e) => setBody(e.target.value)} rows={2} maxLength={2000} /><PushToTalk label="Hold to speak" onText={(t) => setBody((x) => (x.trim() ? `${x.trim()} ${t}` : t))} />
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 text-sm">
              About
              <select className="min-h-11 rounded-md border border-input bg-card px-2" value={line} onChange={(e) => setLine(e.target.value)}>
                <option value="">the whole order</option>
                {m.lines.map((l) => <option key={l.id} value={l.id}>line {l.line_no}: {l.product.sku}</option>)}
              </select>
            </label>
            <Button type="submit" className="ml-auto" disabled={!body.trim() || !!busy}>{busy === "post" && <Spinner />} Send</Button>
          </div>
        </form>
      )}
    </Panel>
  );
}

/* ---------------- Activity ---------------- */
export function Activity({ m }: { m: PoModel }) {
  const [all, setAll] = useState(false);
  const ev = all ? m.events : m.events.slice(0, 8);
  return (
    <Panel label="act-title" id="activity">
      <SectionTitle id="act-title" aside={<a href={`/po/${m.po.id}/record.csv`} className="font-semibold text-foreground underline underline-offset-2">Download record (CSV)</a>}>Activity</SectionTitle>
      <ol className="space-y-2">
        {ev.map((e) => (
          <li key={e.id} className="grid grid-cols-[5.5rem_1fr] gap-3 text-sm">
            <time className="num text-muted-foreground" dateTime={e.at}>{when(e.at)}</time>
            <span>{e.summary}</span>
          </li>
        ))}
      </ol>
      {m.events.length > 8 && (
        <Button variant="link" className="mt-2 px-0" onClick={() => setAll((x) => !x)}>{all ? "Show fewer" : `Show all ${m.events.length}`}</Button>
      )}
      <p className="mt-3 text-sm text-muted-foreground">
        Also: <a href={`/po/${m.po.id}/record.json`} className="underline">record as JSON</a> · <a href={`/traces?po=${m.po.id}`} className="underline">agent and AI traces</a> · times in your zone
      </p>
    </Panel>
  );
}

/* ---------------- Running late, defects, agents ---------------- */
export function SupplyPanel({ m, reload }: { m: PoModel; reload: () => void }) {
  const s = m.supply;
  const { run, busy } = useAction(reload);
  const [eta, setEta] = useState(localInput(new Date(Date.now() + 3 * 3600e3)));
  const [ref, setRef] = useState("");
  const [src, setSrc] = useState("supplier");
  if (!s || (!s.updates.length && !s.risk && !s.can_record)) return null;
  return (
    <Panel label="sup-title" id="supply">
      <SectionTitle id="sup-title">Delivery timing</SectionTitle>
      {s.risk && (
        <div className={cn("rounded-md p-3", s.risk.status === "open" ? "bg-stop-soft" : "bg-paper-2")}>
          <p className="font-semibold">{s.risk.status === "open" ? "Running late" : `Late: ${s.risk.decision ?? s.risk.status}`}</p>
          <p className="text-sm">ETA {when(s.risk.eta)}, deliver-by {when(s.risk.deliver_by)} ({Math.abs(s.risk.slack_minutes)} min {s.risk.slack_minutes < 0 ? "late" : "spare"}).</p>
          {s.risk.on_hand.length > 0 && (
            <ul className="mt-1 text-sm">{s.risk.on_hand.map((x) => <li key={x.line_no}>{x.sku}: {x.on_hand} on hand, {x.ordered} ordered</li>)}</ul>
          )}
          {s.risk.unknowns.length > 0 && <p className="mt-1 text-sm text-muted-foreground">Not known: {s.risk.unknowns.join("; ")}</p>}
          {s.risk.can_decide && (
            <div className="mt-3 flex flex-wrap gap-2">
              <Button variant="carbon" disabled={!!busy} onClick={() => run("exp", `/po/${m.po.id}/risk`, { choice: "expedite", note: "" })}>Ask them to expedite</Button>
              <Button variant="outline" disabled={!!busy} onClick={() => run("wait", `/po/${m.po.id}/risk`, { choice: "wait", note: "" })}>We'll wait</Button>
            </div>
          )}
        </div>
      )}
      {s.updates.length > 0 && (
        <ol className="mt-3 space-y-1 text-sm">
          {s.updates.map((u) => (
            <li key={u.id}>ETA {when(u.eta)} · {u.source} · ref <span className="mono">{u.ref}</span>{!u.applied && <span className="text-muted-foreground"> · not applied ({u.ignored_reason})</span>}</li>
          ))}
        </ol>
      )}
      {s.can_record && (
        <form
          className="mt-4 grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            void run("eta", `/po/${m.po.id}/eta`, { eta: toUtcInput(eta), observed_at: new Date().toISOString().slice(0, 16), source: src, ref: ref || `upd-${Date.now()}`, note: "" });
          }}
        >
          <div className="grid gap-1.5"><Label htmlFor="eta">New ETA (your time)</Label><Input id="eta" type="datetime-local" value={eta} onChange={(e) => setEta(e.target.value)} required /></div>
          <div className="grid gap-1.5">
            <Label htmlFor="eref">Reference</Label>
            <div className="flex gap-2">
              <select aria-label="Source" className="min-h-11 rounded-md border border-input bg-card px-2" value={src} onChange={(e) => setSrc(e.target.value)}><option value="supplier">supplier</option><option value="carrier">carrier</option></select>
              <Input id="eref" value={ref} onChange={(e) => setRef(e.target.value)} placeholder="tracking or note id" />
            </div>
          </div>
          <Button type="submit" variant="outline" disabled={!!busy}>{busy === "eta" && <Spinner />} Record ETA</Button>
        </form>
      )}
    </Panel>
  );
}

export function DefectsPanel({ m, reload }: { m: PoModel; reload: () => void }) {
  const d = m.defects;
  const { run, busy } = useAction(reload);
  const [line, setLine] = useState(m.lines[0]?.id ?? "");
  const [units, setUnits] = useState("1");
  const [note, setNote] = useState("");
  if (!d) return null;
  const L = m.lines.find((l) => l.id === line);
  return (
    <Panel label="def-title" id="defects">
      <SectionTitle id="def-title">Problems found later</SectionTitle>
      {d.claims.length > 0 ? (
        <ul className="space-y-2">
          {d.claims.map((c) => (
            <li key={c.id} className="rounded-md border border-border p-3 text-sm">
              <p className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">Line {c.line_no} · {c.sku} · {c.units} units</span>
                <span className="num">{money(c.amount_cents)}</span>
                <Stamp tone={c.status === "refunded" ? "paid" : c.status === "disputed" || c.status === "failed" ? "stop" : "held"}>{c.status}</Stamp>
              </p>
              <p className="mt-1">“{c.note}”</p>
              {c.decision_note && <p className="text-muted-foreground">Supplier: {c.decision_note}</p>}
              {d.can_decide && c.status === "reported" && (
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button size="sm" variant="paid" disabled={!!busy} onClick={() => run(`ok${c.id}`, `/po/${m.po.id}/defects/${c.id}`, { agree: "1", note: "" })}>Agree and refund {money(c.amount_cents)}</Button>
                  <Button size="sm" variant="outline" disabled={!!busy} onClick={() => run(`no${c.id}`, `/po/${m.po.id}/defects/${c.id}`, { agree: "0", note: "Disputed" })}>Dispute</Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground">Nothing reported. If something turns out bad after delivery, report it here; an agreed claim is refunded to the original PayPal payment.</p>
      )}
      {d.can_report && (
        <form
          className="mt-4 grid gap-3 sm:grid-cols-[1fr_8rem] sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            void run("def", `/po/${m.po.id}/defects`, { line_id: line, units, note }).then((r) => r.ok && setNote(""));
          }}
        >
          <div className="grid gap-1.5">
            <Label htmlFor="dline">Line</Label>
            <select id="dline" className="min-h-11 rounded-md border border-input bg-card px-2" value={line} onChange={(e) => setLine(e.target.value)}>
              {m.lines.map((l) => <option key={l.id} value={l.id}>{l.line_no}. {l.product.name}</option>)}
            </select>
          </div>
          <div className="grid gap-1.5"><Label htmlFor="dunits">Units ({L?.product.base_unit ?? "each"})</Label><Input id="dunits" inputMode="numeric" value={units} onChange={(e) => setUnits(e.target.value)} required /></div>
          <div className="grid gap-1.5 sm:col-span-2"><Label htmlFor="dnote">What's wrong</Label><Textarea id="dnote" value={note} onChange={(e) => setNote(e.target.value)} required rows={2} /><PushToTalk label="Hold to speak" onText={(t) => setNote((x) => (x.trim() ? `${x.trim()} ${t}` : t))} /></div>
          <Button type="submit" variant="outline" className="sm:w-fit" disabled={!!busy}>{busy === "def" && <Spinner />} Report a problem</Button>
        </form>
      )}
    </Panel>
  );
}

export function AgentPanel({ m }: { m: PoModel }) {
  const a = m.agent;
  if (!a.agreement && !a.negotiations.length && !a.can_negotiate && !a.runs.length) return null;
  return (
    <Panel label="ag-title" id="agent-runs">
      <SectionTitle id="ag-title">Agents on this order</SectionTitle>
      {a.agreement && (
        <p className="flex flex-wrap items-center gap-2 text-sm">
          {a.agreement.ok ? <Stamp tone="paid">Signed agreement verifies</Stamp> : <Stamp tone="stop">Agreement doesn't verify</Stamp>}
          <span className="mono">{a.agreement.hash.slice(0, 12)}</span> · quote v{a.agreement.quote_version}
          {a.agreement.buyer_signed_by && <> · signed by {a.agreement.buyer_signed_by} {ago(a.agreement.buyer_signed_at)}</>}
        </p>
      )}
      {a.negotiations.length > 0 && (
        <ul className="mt-2 space-y-1 text-sm">
          {a.negotiations.map((n) => (
            <li key={n.id}><a href={`/negotiations/${n.id}`} className="font-semibold underline underline-offset-2">Negotiation</a> · {n.status} · round {n.round} of {n.max_rounds} · {n.buyer_agent} vs {n.supplier_agent}</li>
          ))}
        </ul>
      )}
      {a.can_negotiate && <NegotiateButton poId={m.po.id} />}
      {a.runs.length > 0 && <p className="mt-2 text-sm text-muted-foreground">{plural(a.runs.length, "agent run")} recorded · <a href={`/traces?po=${m.po.id}`} className="underline">traces</a></p>}
    </Panel>
  );
}

function NegotiateButton({ poId }: { poId: string }) {
  const { run, busy } = useAction();
  return (
    <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
      <span>A buying agent can negotiate this quote inside your limits. You still accept the result.</span>
      <Button size="sm" variant="outline" disabled={!!busy} onClick={() => run("neg", "/negotiations/start", { po: poId })}>
        {busy === "neg" && <Spinner />} Let the agents negotiate
      </Button>
    </div>
  );
}

export const Related =({ m }: { m: PoModel }) =>
  m.tree.length > 1 ? (
    <nav aria-label="Related orders" className="flex flex-wrap items-center gap-2 text-sm">
      <span className="text-muted-foreground">Related:</span>
      {m.tree.map((t) => (
        <Link key={t.id} to={`/po/${t.id}`} aria-current={t.id === m.po.id ? "page" : undefined} className={cn("rounded-md border px-2.5 py-1.5", t.id === m.po.id ? "border-foreground font-semibold" : "border-input hover:border-foreground")}>
          {t.number} {t.kind === "replacement" ? "(replacement)" : ""}
        </Link>
      ))}
    </nav>
  ) : null;

export { day };
