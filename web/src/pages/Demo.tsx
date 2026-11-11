import { useState } from "react";
import { Link } from "react-router";
import { BookOpenCheck, Copy, RotateCcw, Smartphone, Wallet, Zap } from "lucide-react";
import { toast } from "sonner";
import { seedLine, useWorkspace } from "@/lib/demo";
import { useView } from "@/lib/api";
import { money } from "@/lib/format";
import { useAction } from "@/lib/useAction";
import { Button } from "@/components/ui/button";
import { PublicShell } from "@/components/public-shell";
import { ErrorBlock, LoadingBlock, SectionTitle, Spinner, Stamp, StatusStamp } from "@/components/brand";

interface DemoData {
  demo: boolean;
  po: { id: string; number: string; status: string; limit_cents: number; buyer: string; supplier: string } | null;
  line: { sku: string; name: string; qty_packs: number; pack_label: string; price_cents: number; substitutes: number } | null;
  quote_total_cents: number | null;
  totals: { accepted_cents: number; replacement_cents: number; final_cents: number; limit_cents: number } | null;
  funding: { captured_cents: number; held_cents: number; spendable_cents: number; limit_cents: number } | null;
  driver_path: string | null;
  faults: string[];
  live: { paypal: boolean; ai: boolean; telegram: boolean; push: boolean };
  scope: "yours" | "showcase" | "local" | "none";
}

const sel = "min-h-11 rounded-md border border-input bg-card px-3";

export default function Demo() {
  const v = useView<DemoData>("/api/ui/demo", { poll: 15000 });
  const ws = useWorkspace(5000);
  const { run, busy } = useAction(() => {
    void ws.reload(true);
    return v.reload(true);
  });
  const [method, setMethod] = useState("");
  const [kind, setKind] = useState("fail_503");
  if (v.error) return <PublicShell><ErrorBlock message={v.error.message} retry={() => v.reload()} /></PublicShell>;
  if (!v.data) return <PublicShell><LoadingBlock /></PublicShell>;
  const d = v.data;
  const live = (on: boolean, k: string, what: string) => (
    <li className="flex items-start gap-3 py-2.5">
      <Stamp tone={on ? "paid" : "quiet"} className="mt-0.5 w-24 justify-center">{on ? "Live" : "Simulated"}</Stamp>
      <span><span className="font-semibold">{k}</span> <span className="text-muted-foreground">{what}</span></span>
    </li>
  );
  const l = d.line;
  const w = ws.data;
  const mine = w?.workspace?.kind === "visitor" ? w.workspace : null;
  const local = d.scope === "local";
  return (
    <PublicShell>
      <h1 className="text-4xl">Demo controls</h1>
      <p className="mt-2 text-muted-foreground">Everything here is the sandbox. {d.scope === "showcase" ? "The figures below come from the read-only sample demo until you start your own." : "The figures below are read from your demo's order, not typed in."}</p>
      <div className="mt-5 flex flex-wrap gap-2">
        <Button asChild size="lg"><Link to="/judge"><BookOpenCheck aria-hidden="true" /> Judge paths</Link></Button>
        {mine || local ? <Button asChild size="lg" variant="outline"><Link to="/login">Choose a person</Link></Button> : <Button asChild size="lg" variant="outline"><Link to="/start">Start your own demo</Link></Button>}
      </div>

      {w && (
        <section className="mt-8 grid gap-4 sm:grid-cols-2" aria-label="Your demo">
          <div className="rounded-lg border border-border bg-card p-4 sm:p-5">
            <h2 className="flex items-center gap-2 text-xl"><Wallet className="size-5" aria-hidden="true" /> Saved sandbox wallet</h2>
            {w.wallet.configured ? (
              <p className="mt-1 text-sm">
                <Stamp tone={w.wallet.status === "ok" ? "paid" : w.wallet.status === "unchecked" ? "quiet" : "stop"}>{w.wallet.status === "ok" ? "Working" : w.wallet.status === "unchecked" ? "Not checked yet" : w.wallet.status === "missing" ? "Gone from PayPal" : "Check failed"}</Stamp>{" "}
                Buyers in each demo pay from it{w.wallet.payer ? ` (${w.wallet.payer})` : ""}, so you need no PayPal login.{w.wallet.checked_at ? ` Checked with PayPal ${new Date(w.wallet.checked_at).toLocaleString()}.` : ""}
                {w.wallet.status === "missing" && " New demos offer PayPal's own approval page instead."}
              </p>
            ) : (
              <p className="mt-1 text-sm text-muted-foreground">None configured on this server. When you accept a quote, PayPal's own sandbox page asks the buyer to approve.</p>
            )}
            {mine && w.seed && <p className="mt-2 text-sm text-muted-foreground">{seedLine(w)}</p>}
          </div>
          {mine && (
            <div className="rounded-lg border border-border bg-card p-4 sm:p-5">
              <h2 className="flex items-center gap-2 text-xl"><Smartphone className="size-5" aria-hidden="true" /> Open it on your phone</h2>
              <p className="mt-1 text-sm text-muted-foreground">Same demo, second device: be the receiver on the phone while the owner watches here.</p>
              <div className="mt-3 flex flex-wrap items-center gap-4">
                <img src="/demo/join.svg" alt="QR code that opens this demo on another device" className="size-32 rounded-md border border-border bg-white p-1" />
                <Button
                  variant="outline"
                  onClick={() => {
                    void navigator.clipboard?.writeText(mine.join_url).then(
                      () => toast.success("Link copied"),
                      () => toast.error("Couldn't copy; select the link instead."),
                    );
                  }}
                >
                  <Copy aria-hidden="true" /> Copy the link
                </Button>
              </div>
              <p className="mt-2 break-all font-mono text-xs text-muted-foreground">{mine.join_url}</p>
            </div>
          )}
        </section>
      )}

      <section className="mt-8 rounded-lg border border-border bg-card p-4 sm:p-5" data-tour="live" aria-labelledby="live-title">
        <SectionTitle id="live-title">What's live, what's simulated</SectionTitle>
        <ul className="divide-y divide-dashed divide-input">
          {live(d.live.paypal, "PayPal sandbox", "holds, captures, releases, refunds, reauthorization and webhooks, with real sandbox ids")}
          {live(d.live.ai, "AI reader (OpenAI)", "reads dockets, invoices and photos into proposed counts; without a key a labelled text parser runs instead")}
          {live(d.live.telegram, "Telegram alerts", "approve or reply from a phone; otherwise the in-app phone simulator shows the same messages")}
          {live(d.live.push, "Web push", "browser notifications for approvals")}
          {live(false, "The café, the wholesaler and their goods", "are made up; the sandbox buyer pays with test money")}
        </ul>
      </section>

      <section className="mt-6 rounded-lg border-2 border-foreground bg-card p-4 sm:p-5" data-tour="script" aria-labelledby="script-title">
        <SectionTitle id="script-title" aside={d.po && <StatusStamp status={d.po.status} />}>The scripted delivery</SectionTitle>
        {d.po && l ? (
          <>
            <p>
              <Link to={`/po/${d.po.id}`} className="font-semibold underline underline-offset-2">{d.po.number}</Link>: {d.po.buyer} orders {l.qty_packs} × {l.name} ({money(l.price_cents)} per {l.pack_label}) from {d.po.supplier}, inside a <span className="num">{money(d.po.limit_cents)}</span> limit.
            </p>
            <ol className="mt-4 grid gap-3">
              {[
                ["Jordan", "owner", `Connect PayPal once, then accept the quote. PayPal holds ${money(d.quote_total_cents)}.`],
                ["Ana", "supplier", "Dispatch with the sample invoice that hides a “pay $500 to another account” line. Watch it get stripped."],
                ["Sam", "receiving", "Count it in with the sample docket where the driver notes two crushed cases. Confirm the counts."],
                ["Ana", "supplier", "Agree the damaged line. Both sides approve the same version."],
                ["Jordan", "owner", d.totals ? `PayPal captures ${money(d.totals.accepted_cents)}, releases the rest and holds ${money(d.totals.replacement_cents)} for the replacement.` : "PayPal captures only the accepted goods, releases the rest, and places a hold for the replacement."],
              ].map(([who, role, what], i) => (
                <li key={i} className="grid grid-cols-[2rem_1fr] gap-3">
                  <span className="num grid size-8 place-items-center rounded-md bg-foreground font-bold text-background">{i + 1}</span>
                  <span><span className="font-semibold">{who}</span> <span className="text-sm text-muted-foreground">({role})</span><br />{what}</span>
                </li>
              ))}
            </ol>
            {d.funding && <p className="mt-4 rounded-md bg-paper-2 p-3 text-sm">Now: <span className="num font-semibold">{money(d.funding.captured_cents)}</span> charged, <span className="num">{money(d.funding.held_cents)}</span> held, <span className="num">{money(d.funding.spendable_cents)}</span> of <span className="num">{money(d.funding.limit_cents)}</span> left.</p>}
          </>
        ) : (
          <p>{d.scope === "none" ? "No sample demo is built yet. Start your own to load the scripted order." : "No demo order loaded. Reset below to load it."}</p>
        )}
        <p className="mt-4 text-sm text-muted-foreground">The <a href="/evidence" className="underline">Evidence</a> page has the eval tables (rules vs model vs oracle), the injection traps and the agent arena results.</p>
      </section>

      {d.demo && (mine || local) && (
        <section className="mt-6 grid gap-4 sm:grid-cols-2" aria-label="Reset and faults">
          <div className="rounded-lg border border-border bg-card p-4 sm:p-5">
            <h2 className="text-xl">Reset my demo</h2>
            <p className="mt-1 text-sm text-muted-foreground">{local ? "Reloads the local demo data and signs everyone out." : "Gives you a fresh demo and signs you out. Your old one is closed and its open holds are released on PayPal. Nobody else's demo is touched."}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button variant="outline" disabled={!!busy} onClick={() => run("reset-keep", "/demo/reset", { keep: "1" })}>{busy === "reset-keep" ? <Spinner /> : <RotateCcw aria-hidden="true" />} Reset my demo</Button>
            </div>
          </div>
          <form
            className="rounded-lg border border-border bg-card p-4 sm:p-5"
            onSubmit={(e) => {
              e.preventDefault();
              void run("fault", "/demo/fault", { method: method || d.faults[0], kind }, { stay: true });
            }}
          >
            <h2 className="text-xl">Inject a PayPal failure</h2>
            <p className="mt-1 text-sm text-muted-foreground">In your demo only, the next call of that kind fails once, to show retries with the same request id and the read-back.</p>
            <div className="mt-3 grid gap-2">
              <label className="grid gap-1 text-sm font-semibold">Call
                <select className={sel} value={method || d.faults[0]} onChange={(e) => setMethod(e.target.value)}>{d.faults.map((f) => <option key={f} value={f}>{f}</option>)}</select>
              </label>
              <label className="grid gap-1 text-sm font-semibold">Failure
                <select className={sel} value={kind} onChange={(e) => setKind(e.target.value)}>
                  <option value="fail_503">PayPal answers 503</option>
                  <option value="lose_response">Response lost after PayPal acted</option>
                  <option value="fail_422">PayPal rejects (422)</option>
                  <option value="stale_read">Read-back is stale once</option>
                </select>
              </label>
              <Button type="submit" variant="outline" className="w-fit" disabled={!!busy}>{busy === "fault" ? <Spinner /> : <Zap aria-hidden="true" />} Arm it</Button>
            </div>
          </form>
          {d.driver_path && <p className="text-sm sm:col-span-2">Driver's phone view (no sign-in, token link): <a href={d.driver_path} className="font-semibold underline">open the driver page</a>.</p>}
        </section>
      )}
    </PublicShell>
  );
}
