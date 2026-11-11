import { useState } from "react";
import { Link } from "react-router";
import { ArrowRight, Check, Circle, QrCode } from "lucide-react";
import { toast } from "sonner";
import { act, useView } from "@/lib/api";
import { useSession } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { PublicShell } from "@/components/public-shell";
import { ErrorBlock, LoadingBlock, Stamp } from "@/components/brand";

interface Step { key: string; title: string; as: string | null; person_id: string | null; to: string; help: string; done: boolean; done_at: string | null }
interface Path { id: string; title: string; minutes: number; paypal_login: boolean; note: string; steps: Step[] }
interface JudgeData {
  workspace: { id: string; state: string; join_qr: string; join_url: string } | null;
  signed_in: { name: string; role: string } | null;
  accounts: { wallet: { payer: string; note: string } | null; judge_buyer: null | { email: string }; judge_buyer_note: string };
  paths: Path[];
  live: { area: string; state: string; detail: string }[];
  pages: { to: string; title: string; what: string }[];
  repo: { url: string; public: boolean };
}

const PEOPLE: Record<string, string> = { sam: "Sam", ana: "Ana", jordan: "Jordan" };

/** Spec A3.1: three paths through the visitor's own demo. Each step opens the exact screen and ticks itself when the server records it. */
export default function Judge() {
  const v = useView<JudgeData>("/api/public/judge", { poll: 4000 });
  const { session, refresh } = useSession();
  const [going, setGoing] = useState<string | null>(null);
  if (v.error) return <PublicShell><ErrorBlock message={v.error.message} retry={() => v.reload()} /></PublicShell>;
  if (!v.data) return <PublicShell><LoadingBlock /></PublicShell>;
  const d = v.data;
  const me = session?.who?.name?.split(" ")[0]?.toLowerCase() ?? null;

  const open = async (s: Step) => {
    setGoing(s.key);
    try {
      if (s.as && s.person_id && me !== s.as) {
        const r = await act("/login", { person_id: s.person_id, next: s.to });
        if (!r.ok) {
          toast.error(r.message);
          return;
        }
        refresh();
      }
      location.assign(s.to);
    } finally {
      setGoing(null);
    }
  };

  return (
    <PublicShell wide>
      <h1 className="text-4xl">For judges</h1>
      <p className="mt-2 max-w-3xl text-muted-foreground">Three short paths through your own private demo. Each step opens the exact screen as the right person; the tick appears when the server records that it happened. No PayPal login is needed: holds and captures use the demo's saved sandbox wallet.</p>

      {!d.workspace ? (
        <div className="mt-6 rounded-lg border-2 border-foreground bg-card p-5">
          <p className="font-semibold">Start a private demo first. It takes under a minute: real sandbox holds are placed for its orders.</p>
          <Button asChild size="lg" className="mt-3"><Link to="/start">Start your own demo <ArrowRight aria-hidden="true" /></Link></Button>
        </div>
      ) : d.workspace.state !== "ready" ? (
        <p className="mt-6 rounded-lg border border-border bg-card p-4">Your demo is still being set up ({d.workspace.state}). This page updates by itself.</p>
      ) : null}

      <div className="mt-8 grid gap-6 lg:grid-cols-3">
        {d.paths.map((p) => {
          const done = p.steps.filter((s) => s.done).length;
          return (
            <section key={p.id} aria-labelledby={`path-${p.id}`} className="rounded-lg border-2 border-foreground bg-card p-4 sm:p-5">
              <div className="flex items-baseline justify-between gap-2">
                <h2 id={`path-${p.id}`} className="text-xl">{p.title}</h2>
                <span className="num shrink-0 text-sm text-muted-foreground">about {p.minutes} min</span>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">{p.note}</p>
              <p className="mt-2 text-sm font-semibold" aria-live="polite">{done} of {p.steps.length} done</p>
              <ol className="mt-3 grid gap-3">
                {p.steps.map((s, i) => (
                  <li key={s.key} className="grid grid-cols-[1.75rem_1fr] gap-2" data-step={s.key} data-done={s.done ? "1" : "0"}>
                    <span aria-hidden="true" className="mt-0.5">{s.done ? <Check className="size-5 text-paid" /> : <Circle className="size-5 text-muted-foreground" />}</span>
                    <div>
                      <p className="font-semibold"><span className="sr-only">{s.done ? "Done: " : "Not done: "}</span>{i + 1}. {s.title}</p>
                      <p className="text-sm text-muted-foreground">{s.help}</p>
                      <Button size="sm" variant={s.done ? "outline" : "default"} className="mt-1.5 min-h-11" disabled={!d.workspace || d.workspace.state !== "ready" || going === s.key} onClick={() => void open(s)}>
                        {s.as && me !== s.as ? `Sign in as ${PEOPLE[s.as] ?? s.as} and open` : "Open"} <ArrowRight aria-hidden="true" />
                      </Button>
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          );
        })}
      </div>

      {d.workspace && (
        <section className="mt-8 grid gap-4 rounded-lg border border-border bg-card p-4 sm:grid-cols-[auto_1fr] sm:p-5" aria-labelledby="phone-title">
          <img src={d.workspace.join_qr} alt="QR code that opens this demo on a phone" className="size-36 rounded bg-white p-2" width={144} height={144} />
          <div>
            <h2 id="phone-title" className="text-xl"><QrCode className="mr-1.5 inline size-5" aria-hidden="true" />Open it on your phone</h2>
            <p className="mt-1 text-sm text-muted-foreground">Scan to join the same private demo on a phone, for counting a delivery at the back door. The link closes with the demo.</p>
          </div>
        </section>
      )}

      <section className="mt-8" aria-labelledby="accounts-title">
        <h2 id="accounts-title" className="text-2xl">Accounts</h2>
        <ul className="mt-2 grid gap-1 text-sm">
          <li><b>Saved sandbox wallet:</b> {d.accounts.wallet ? `${d.accounts.wallet.payer}. ${d.accounts.wallet.note}` : "not configured; buyers approve on PayPal's own sandbox page."}</li>
          <li><b>Judge buyer login:</b> {d.accounts.judge_buyer ? d.accounts.judge_buyer.email : "no dedicated judge buyer login yet."} {d.accounts.judge_buyer_note}</li>
          <li><b>People in your demo:</b> Jordan (café owner), Sam (receives deliveries), Ana (wholesaler). Sign in as any of them from <Link to="/login" className="underline">Choose a person</Link>; no passwords.</li>
        </ul>
      </section>

      <section className="mt-8" aria-labelledby="live-title">
        <h2 id="live-title" className="text-2xl">What's live and what's simulated</h2>
        <p className="mt-1 text-sm text-muted-foreground">Built from this server's settings when the page loads, not typed by hand.</p>
        <div className="mt-3 overflow-x-auto" tabIndex={0} role="region" aria-label="What is live and what is simulated">
          <table className="w-full min-w-[36rem] text-sm">
            <thead><tr className="border-b border-border text-left"><th className="py-2 pr-3">Area</th><th className="py-2 pr-3">State</th><th className="py-2">Detail</th></tr></thead>
            <tbody>
              {d.live.map((r) => (
                <tr key={r.area} className="border-b border-border align-top">
                  <td className="py-2 pr-3 font-semibold">{r.area}</td>
                  <td className="py-2 pr-3"><Stamp tone={r.state === "live" ? "paid" : r.state === "not built" ? "quiet" : "held"}>{r.state}</Stamp></td>
                  <td className="py-2 text-muted-foreground">{r.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-8" aria-labelledby="pages-title">
        <h2 id="pages-title" className="text-2xl">Pages that need no sign-in</h2>
        <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {d.pages.map((p) => (
            <li key={p.to}><Link to={p.to} className="block min-h-11 rounded-md border border-border bg-card p-3 hover:bg-accent"><span className="font-semibold underline underline-offset-2">{p.title}</span><span className="mt-0.5 block text-sm text-muted-foreground">{p.what}</span></Link></li>
          ))}
        </ul>
        <p className="mt-4 text-sm text-muted-foreground">Source: {d.repo.public ? <a className="underline" href={d.repo.url}>{d.repo.url}</a> : "the repository is private for now."}</p>
      </section>
    </PublicShell>
  );
}
