import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import { ArrowRight, Check, Link2, PackageCheck, Repeat, Send, Truck } from "lucide-react";
import { useView } from "@/lib/api";
import { day, money } from "@/lib/format";
import { useAction } from "@/lib/useAction";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ErrorBlock, LoadingBlock, PageHeader, Spinner, Stamp, StatusStamp, TrustRow } from "@/components/brand";
import { ApprovalCard } from "@/components/approval";
import { Activity, AgentPanel, DefectsPanel, DocsPanel, Lines, Messages, MoneyPanel, PayPalPanel, Related, ResolutionPanel, SupplyPanel } from "./order/sections";
import type { PoModel } from "./order/types";
import { ShortfallAgents } from "@/components/talk";

const MOVING = ["funding", "settling", "part_settling"];

/** The single thing this person can do now, with what it does to money said before the button. */
function NextStep({ m, reload }: { m: PoModel; reload: () => void }) {
  const { run, busy } = useAction(reload);
  const id = m.po.id;
  const st = m.po.status;
  const buyer = m.me.side === "buyer";
  const owner = m.me.owner;
  const supplier = m.me.side === "supplier";
  const box = (title: string, body: React.ReactNode, actions?: React.ReactNode, tone: "do" | "wait" | "done" | "stop" = "do") => (
    <section
      data-tour="next-step"
      aria-labelledby="next-title"
      className={cn(
        "rounded-lg p-4 sm:p-5",
        tone === "do" && "border-2 border-foreground bg-card",
        tone === "wait" && "border border-dashed border-input bg-card/60",
        tone === "done" && "border border-paid/40 bg-paid-soft",
        tone === "stop" && "border-2 border-stop bg-stop-soft",
      )}
    >
      <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{tone === "do" ? "Your next step" : tone === "done" ? "Done" : tone === "stop" ? "Needs a look" : "Waiting"}</p>
      <h2 id="next-title" className="mt-1 text-2xl">{title}</h2>
      <div className="mt-1.5 max-w-prose">{body}</div>
      {actions && <div className="mt-4 flex flex-wrap gap-2">{actions}</div>}
    </section>
  );

  if (m.po.history) return box(m.po.sample ? "Sample history" : "Imported history", m.po.sample ? "This past delivery is sample data, loaded so the supplier record has history. It's read-only and no PayPal money moved for it." : "This past delivery was loaded for the supplier record. It's read-only.", undefined, "wait");

  // ---- buyer ----
  if (buyer && st === "draft")
    return owner
      ? box("Send it for a quote", <>{m.po.supplier_name} confirms prices and stock. Nothing is held or charged until you accept their quote.</>, <Button size="lg" disabled={!!busy} onClick={() => run("submit", `/po/${id}/submit`)}>{busy === "submit" ? <Spinner /> : <Send aria-hidden="true" />} Send for a quote</Button>)
      : box("Draft", "The owner is still putting this order together.", undefined, "wait");
  if (buyer && st === "submitted") return box(`Waiting for ${m.po.supplier_name}'s quote`, "They confirm prices and stock. You'll get a notice when it's in.", undefined, "wait");
  if (buyer && st === "quoted") {
    if (!owner) return box("Quote in", "The owner accepts the quote, which places the PayPal hold.", undefined, "wait");
    if (m.paypal && !m.paypal.connected)
      return box("Connect PayPal, then accept", <>The quote is <span className="num font-semibold">{money(m.quote_total_cents)}</span>. You approve StockSure once on PayPal; after that, accepting places a hold for exactly the quote.</>, <Button size="lg" variant="carbon" disabled={!!busy} onClick={() => run("connect", "/connect-paypal")}>{busy === "connect" ? <Spinner /> : <Link2 aria-hidden="true" />} Connect PayPal (sandbox)</Button>);
    return box(
      `Accept the quote: ${money(m.quote_total_cents)}`,
      <>
        <p>PayPal places a <strong>hold</strong> for <span className="num font-semibold">{money(m.quote_total_cents)}</span> on <span className="break-all">{m.paypal?.demo_wallet ? `the demo's saved sandbox wallet${m.paypal.payer ? ` (${m.paypal.payer})` : ""}` : (m.paypal?.payer ?? "your PayPal")}</span>. It isn't a charge: only what's accepted at delivery is captured, and the rest is released.</p>
        {m.over_limit && <p className="mt-2 font-semibold text-stop">The quote is above your {money(m.po.limit_cents)} limit, so it can't be accepted. Ask the supplier to re-quote or start a new order.</p>}
      </>,
      <Button size="lg" variant="carbon" disabled={!!busy || m.over_limit} onClick={() => run("accept", `/po/${id}/accept`, { version: String(m.po.quote_version) })}>
        {busy === "accept" ? <Spinner /> : <Check aria-hidden="true" />} Accept and hold {money(m.quote_total_cents)}
      </Button>,
    );
  }
  if (buyer && st === "funding")
    return box("PayPal is confirming the hold", "The hold shows as pending on PayPal. The order isn't funded until PayPal confirms it; this page updates by itself.", owner && <Button variant="outline" disabled={!!busy} onClick={() => run("retry", `/po/${id}/retry-hold`)}>{busy === "retry" && <Spinner />} Check again / retry the hold</Button>, "wait");
  if (buyer && st === "funded") return box(`Held. Waiting for ${m.po.supplier_name} to dispatch`, <>PayPal holds <span className="num font-semibold">{money(m.quote_total_cents)}</span>. Nothing is charged until the delivery is counted and agreed.</>, undefined, "wait");
  if (buyer && (st === "dispatched" || (st === "in_review" && m.disputed)))
    return box(
      st === "in_review" ? "The supplier disputed a count" : m.delivery.mode === "rest" ? "Count the rest in" : "Count it in",
      st === "in_review" ? "Have a look at their note on the line below, recount, and confirm again. Nothing is charged until both sides agree." : "Snap the docket and any damage. AI proposes the counts and you confirm them. You only pay for what you accept.",
      <Button asChild size="lg"><Link to={`/po/${id}/receive`}><PackageCheck aria-hidden="true" /> {st === "in_review" ? "Recount" : "Count the delivery"} <ArrowRight aria-hidden="true" /></Link></Button>,
    );
  if (buyer && st === "in_review") return box(`Waiting for ${m.po.supplier_name} to agree the counts`, "They agree or dispute each line you flagged. Nothing is charged yet.", undefined, "wait");

  // ---- supplier ----
  if (supplier && st === "submitted") return <QuoteForm m={m} reload={reload} />;
  if (supplier && st === "quoted") return box(`Waiting for ${m.po.buyer_name} to accept`, "When they accept, PayPal places a hold for your quote. You'll be told before you dispatch.", undefined, "wait");
  if (supplier && (st === "funded" || st === "part_delivered")) return <DispatchForm m={m} reload={reload} />;
  if (supplier && st === "dispatched") return box(`On the truck to ${m.po.buyer_name}`, "They count it in at the door. You'll then agree or dispute anything they flag.", undefined, "wait");
  if (supplier && st === "in_review")
    return box("Agree or dispute what they counted", "Each flagged line is below with the café's counts and photos. Agreeing locks that line's count.", <Button asChild variant="outline"><a href="#lines">Go to the lines</a></Button>);

  // ---- both ----
  if (st === "resolving") {
    const r = m.resolution;
    if (r?.can_approve) return box("Approve the agreed payment", <>Both sides approve the same version (v{r.version}). Then PayPal captures <span className="num font-semibold">{money(r.totals.accepted_cents)}</span> and releases the rest.</>, <Button asChild size="lg" variant="paid"><a href="#resolution">Review and approve <ArrowRight aria-hidden="true" /></a></Button>);
    return box("Waiting for the other side to approve", "Nothing is charged until both sides approve the same version.", undefined, "wait");
  }
  if (MOVING.includes(st)) return box(st === "funding" ? "Placing the hold" : "PayPal is settling", "Capture, release and any replacement hold run as separate steps, each read back from PayPal. This page updates by itself.", undefined, "wait");
  if (st === "awaiting_replacement") return box("Replacement on its way", "The accepted goods are paid and the replacement has its own hold. Open it from Related orders above.", undefined, "wait");
  if (st === "exception")
    return box(
      m.can_replan ? "The replacement no longer fits" : "Payment stopped partway",
      <>
        <p>{m.po.exception ?? "A PayPal step didn't finish."}</p>
        <p className="mt-1 text-sm">{m.can_replan ? "Agree a new replacement: it re-plans with today's stock and prices. The accepted goods stay charged and nothing is captured twice." : "Retrying runs again from the first unfinished step with the same request ids, so nothing is charged twice."}</p>
      </>,
      <>
        {m.can_replan && <Button size="lg" disabled={!!busy} onClick={() => run("replan", `/po/${id}/resolution/revise`, {})}>{busy === "replan" && <Spinner />} Agree a new replacement</Button>}
        {(owner || supplier) && <Button variant={m.can_replan ? "outline" : "carbon"} disabled={!!busy} onClick={() => run("retry", `/po/${id}/retry-settle`)}>{busy === "retry" && <Spinner />} Retry the payment</Button>}
      </>,
      "stop",
    );
  if (st === "closed")
    return box(
      "Settled",
      <>Paid as counted{m.resolution ? <>: <span className="num font-semibold">{money(m.resolution.totals.accepted_cents)}</span> for the accepted goods</> : ""}. The PayPal record is below.</>,
      buyer && owner && <Button variant="outline" disabled={!!busy} data-ls-action="reorder" data-ls-amount={m.resolution ? `${money(m.resolution.totals.accepted_cents)} last time; a new draft, nothing is charged until you accept a quote` : "a new draft; nothing is charged until you accept a quote"} data-ls-to={m.po.supplier_name} onClick={() => run("reorder", `/po/${id}/reorder`)}>{busy === "reorder" ? <Spinner /> : <Repeat aria-hidden="true" />} Order the same again</Button>,
      "done",
    );
  if (st === "cancelled") return box("Cancelled", "Any hold was released.", undefined, "wait");
  return box(m.copy.next ?? "Nothing to do", "", undefined, "wait");
}

function QuoteForm({ m, reload }: { m: PoModel; reload: () => void }) {
  const { run, busy } = useAction(reload);
  const [prices, setPrices] = useState<Record<string, string>>(Object.fromEntries(m.lines.map((l) => [l.id, ((l.unit_price_cents ?? l.product.price_cents) / 100).toFixed(2)])));
  const total = m.lines.reduce((a, l) => a + Math.round(Number(prices[l.id] || 0) * 100) * l.qty_packs, 0);
  return (
    <section data-tour="next-step" aria-labelledby="next-title" className="rounded-lg border-2 border-foreground bg-card p-4 sm:p-5">
      <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Your next step</p>
      <h2 id="next-title" className="mt-1 text-2xl">Confirm the quote</h2>
      <p className="mt-1.5 max-w-prose">Prices per pack, from your catalog. When {m.po.buyer_name} accepts, PayPal holds this total. You're paid for what they accept at delivery.</p>
      <form
        className="mt-4 grid gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void run("quote", `/po/${m.po.id}/quote`, Object.fromEntries(m.lines.map((l) => [`price_${l.id}`, prices[l.id]])));
        }}
      >
        {m.lines.map((l) => (
          <div key={l.id} className="grid items-center gap-2 sm:grid-cols-[1fr_9rem]">
            <Label htmlFor={`p-${l.id}`} className="text-base font-normal">
              <span className="font-semibold">{l.qty_packs} × {l.product.name}</span> <span className="text-muted-foreground">per {l.product.pack_label} · {l.product.stock_packs} in stock</span>
            </Label>
            <div className="flex items-center gap-1.5"><span aria-hidden="true">$</span><Input id={`p-${l.id}`} inputMode="decimal" value={prices[l.id]} onChange={(e) => setPrices({ ...prices, [l.id]: e.target.value })} className="num text-right" required /></div>
          </div>
        ))}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-dashed border-input pt-3">
          <p>Total <span className="num font-heading text-xl font-bold">{money(total)}</span> {total > m.po.limit_cents && <span className="text-sm text-stop">· above the buyer's limit; they won't be able to accept</span>}</p>
          <Button type="submit" size="lg" disabled={!!busy}>{busy === "quote" ? <Spinner /> : <Send aria-hidden="true" />} Send quote</Button>
        </div>
      </form>
    </section>
  );
}

function DispatchForm({ m, reload }: { m: PoModel; reload: () => void }) {
  const { run, busy } = useAction(reload);
  const file = useRef<HTMLInputElement>(null);
  const [sample, setSample] = useState(m.demo.samples ? "clean" : "");
  const [part, setPart] = useState(false);
  const [packs, setPacks] = useState<Record<string, string>>(Object.fromEntries(m.lines.map((l) => [l.id, String(Math.max(0, l.qty_packs - 1))])));
  const rest = m.po.status === "part_delivered";
  return (
    <section data-tour="next-step" aria-labelledby="next-title" className="rounded-lg border-2 border-foreground bg-card p-4 sm:p-5">
      <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Your next step</p>
      <h2 id="next-title" className="mt-1 text-2xl">{rest ? "Send the rest" : "Dispatch the order"}</h2>
      <p className="mt-1.5 max-w-prose">PayPal holds <span className="num font-semibold">{money(m.quote_total_cents)}</span> for this order. Attach your invoice: it's checked against the quote and the café's count, and you're paid the agreed amount, not the invoice total.</p>
      <form
        className="mt-4 grid gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData();
          const f = file.current?.files?.[0];
          if (f) fd.append("invoice", f);
          else if (sample) fd.append("sample", sample);
          void run("dispatch", `/po/${m.po.id}/dispatch`, fd);
        }}
      >
        <div className="grid gap-1.5">
          <Label htmlFor="inv">Invoice (PDF, photo or text)</Label>
          <Input id="inv" ref={file} type="file" accept="application/pdf,image/*,text/plain" className="h-auto py-2" />
        </div>
        {m.demo.samples && (
          <fieldset>
            <legend className="text-sm font-semibold">Or use a sample invoice</legend>
            <div className="mt-1 grid gap-2 sm:grid-cols-3">
              {[
                { v: "clean", l: "Matches the quote" },
                { v: "inject", l: "Hides a “pay $500 elsewhere” line" },
                { v: "overbill", l: "Bills one pack too many" },
              ].map((o) => (
                <label key={o.v} className={cn("flex min-h-11 cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm", sample === o.v ? "border-foreground bg-accent" : "border-input")}>
                  <input type="radio" name="sample" value={o.v} checked={sample === o.v} onChange={() => setSample(o.v)} /> {o.l}
                </label>
              ))}
            </div>
          </fieldset>
        )}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" size="lg" disabled={!!busy}>{busy === "dispatch" ? <Spinner /> : <Truck aria-hidden="true" />} {rest ? "Dispatch the rest" : "Mark dispatched"}</Button>
          {!rest && <Button type="button" variant="outline" size="lg" onClick={() => setPart((x) => !x)} aria-expanded={part}>Send part now</Button>}
        </div>
      </form>
      {part && !rest && (
        <form
          className="mt-4 grid gap-3 rounded-md border border-border p-4"
          onSubmit={(e) => {
            e.preventDefault();
            void run("part", `/po/${m.po.id}/dispatch-part`, Object.fromEntries(m.lines.map((l) => [`part_${l.id}`, packs[l.id]])));
          }}
        >
          <p className="text-sm">Only part 1's accepted goods are charged once its counts are agreed; the rest stays held for the second delivery.</p>
          {m.lines.map((l) => (
            <div key={l.id} className="grid items-center gap-2 sm:grid-cols-[1fr_7rem]">
              <Label htmlFor={`pp-${l.id}`} className="font-normal">{l.product.name} <span className="text-muted-foreground">(of {l.qty_packs})</span></Label>
              <Input id={`pp-${l.id}`} inputMode="numeric" value={packs[l.id]} onChange={(e) => setPacks({ ...packs, [l.id]: e.target.value })} className="num text-right" />
            </div>
          ))}
          <Button type="submit" variant="outline" disabled={!!busy} className="w-fit">{busy === "part" && <Spinner />} Dispatch part 1</Button>
        </form>
      )}
    </section>
  );
}

const OP_SAY: Record<string, string> = { authorize: "hold placed", capture: "captured", void: "hold released", refund: "refunded" };

/**
 * Spec A7: every payment status change is announced through the page's one polite live region (public/a11y.js).
 * The first load is not announced; only changes while the page is open.
 */
function usePaymentAnnouncer(m: PoModel | null) {
  const seen = useRef<Map<string, string> | null>(null);
  const status = useRef<string | null>(null);
  useEffect(() => {
    if (!m) return;
    const now = new Map(m.ops.map((o) => [o.id, `${o.status}:${o.paypal_status ?? ""}`]));
    const say: string[] = [];
    if (seen.current) {
      for (const o of m.ops) {
        const was = seen.current.get(o.id);
        if (was === now.get(o.id)) continue;
        if (o.status === "succeeded") say.push(`PayPal ${OP_SAY[o.kind] ?? o.kind} ${money(o.amount_cents)}.`);
        else if (o.status === "failed") say.push(`PayPal ${OP_SAY[o.kind] ?? o.kind} of ${money(o.amount_cents)} failed.`);
        else if (!was) say.push(`PayPal ${OP_SAY[o.kind] ?? o.kind} of ${money(o.amount_cents)} started.`);
      }
      if (status.current && status.current !== m.po.status) say.push(`${m.po.number} is now ${m.po.status.replace(/_/g, " ")}.`);
    }
    seen.current = now;
    status.current = m.po.status;
    if (say.length) window.a11yKit?.announce?.(say.join(" "));
  }, [m]);
}

export default function Order() {
  const { id } = useParams();
  const [poll, setPoll] = useState<number | false>(false);
  const v = useView<PoModel>(`/api/ui/po/${id}`, { poll });
  const reload = () => v.reload(true);
  const moving = !!v.data && (MOVING.includes(v.data.po.status) || v.data.ops.some((o) => o.status === "pending"));
  useEffect(() => setPoll(moving ? 3000 : false), [moving]);
  usePaymentAnnouncer(v.data);
  if (v.error && !v.data) return <ErrorBlock message={v.error.message} retry={() => v.reload()} status={v.error.status} />;
  if (!v.data) return <LoadingBlock label="Loading the order" />;
  const m = v.data;
  return (
    <>
      <PageHeader
        back={{ to: "/home", label: "Orders" }}
        kicker={
          <span className="flex flex-wrap items-center gap-2">
            <StatusStamp status={m.po.status} />
            {m.po.kind === "replacement" && <Stamp tone="carbon">Replacement order</Stamp>}
            {m.po.sample && <Stamp tone="carbon">Sample</Stamp>}
            {moving && <Stamp tone="held"><Spinner className="size-3" /> PayPal working</Stamp>}
          </span>
        }
        title={<span className="num">{m.po.number}</span>}
        sub={<>{m.me.side === "buyer" ? m.po.supplier_name : m.po.buyer_name} · deliver by {day(m.po.deliver_by)} · limit <span className="num">{money(m.po.limit_cents)}</span></>}
      />
      <div className="mb-4"><Related m={m} /></div>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-5">
          <NextStep m={m} reload={reload} />
          {m.approvals.map((a) => <ApprovalCard key={a.id} a={a} onDone={reload} showOrder={false} />)}
          <Lines m={m} reload={reload} />
          <ResolutionPanel m={m} reload={reload} />
          <ShortfallAgents poId={m.po.id} onSettled={reload} />
          <SupplyPanel m={m} reload={reload} />
          <DefectsPanel m={m} reload={reload} />
          <Messages m={m} reload={reload} />
        </div>
        <aside className="grid min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-5" aria-label="Money and records">
          <MoneyPanel m={m} />
          <PayPalPanel m={m} reload={reload} />
          <DocsPanel m={m} reload={reload} />
          <AgentPanel m={m} />
          <TrustRow dense />
          <Activity m={m} />
        </aside>
      </div>
      {v.error && <p role="status" className="mt-4 text-sm text-stop">Couldn't refresh: {v.error.message}</p>}
    </>
  );
}
