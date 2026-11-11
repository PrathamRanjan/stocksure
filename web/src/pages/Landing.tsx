import { Link } from "react-router";
import { ArrowRight, BookOpenCheck, ChevronDown, FileWarning, PackageX, Receipt, Repeat2, ShieldAlert, Truck } from "lucide-react";
import { useView } from "@/lib/api";
import { money } from "@/lib/format";
import { useSession } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { PublicShell } from "@/components/public-shell";
import { TryScam } from "@/components/try-scam";
import { SettlementBar, StatusStamp, Tally, TallyLegend, TrustRow, type TallyNums } from "@/components/brand";

interface Preview {
  po: { number: string; status: string; buyer: string; supplier: string; limit_cents: number } | null;
  lines?: { sku: string; name: string; pack_label: string; unit_price_cents: number; tally: TallyNums }[];
  totals?: { accepted_cents: number; replacement_cents: number; final_cents: number; limit_cents: number } | null;
  quote_total_cents?: number;
  funding?: { captured_cents: number; held_cents: number; expected_cents: number; spendable_cents: number; limit_cents: number; held_now_cents?: number; releasing_cents?: number; released_cents?: number; refunding_cents?: number } | null;
}

/** The live demo order as it stands now. Nothing is invented: while loading it shows a placeholder frame, and
 *  with no demo order it says so. */
function Docket() {
  const { data, error } = useView<Preview>("/api/ui/preview");
  const frame = "relative rounded-lg border border-border bg-card p-4 shadow-[0_1px_0_var(--border),0_12px_30px_-18px_rgb(0_0_0/0.35)] sm:p-5";
  if (!data && !error)
    return (
      <figure className={`${frame} min-h-72`} aria-label="Loading the live demo order" aria-busy="true">
        <div className="h-4 w-32 animate-pulse rounded bg-muted motion-reduce:animate-none" />
        <div className="mt-2 h-6 w-56 animate-pulse rounded bg-muted motion-reduce:animate-none" />
        <div className="mt-6 grid gap-3">
          {[0, 1].map((i) => <div key={i} className="h-12 animate-pulse rounded bg-muted motion-reduce:animate-none" />)}
        </div>
      </figure>
    );
  if (!data?.po || !data.lines?.length)
    return (
      <figure className={`${frame} grid min-h-72 place-content-center gap-3 text-center`} aria-label="No live demo order">
        <p className="font-heading text-lg font-bold">No demo order on this server right now</p>
        <p className="text-sm text-muted-foreground">Load the demo to see a real order, its counts and its PayPal state here.</p>
        <Button asChild variant="outline" className="justify-self-center"><Link to="/demo">Open the demo controls</Link></Button>
      </figure>
    );
  const lines = data.lines;
  const f = data?.funding;
  const est = lines.reduce((a, l) => a + l.unit_price_cents * l.tally.ordered, 0);
  const quoted = data.quote_total_cents || null;
  return (
    <figure className="relative rounded-lg border border-border bg-card p-4 shadow-[0_1px_0_var(--border),0_12px_30px_-18px_rgb(0_0_0/0.35)] sm:p-5" aria-label={`Live demo order ${data.po.number}`}>
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-dashed border-input pb-3">
        <div>
          <p className="mono text-xs uppercase tracking-wider text-muted-foreground">Live demo order</p>
          <p className="font-heading text-lg font-bold">{data.po.number} · {data.po.supplier}</p>
          <p className="text-sm text-muted-foreground">to {data.po.buyer}</p>
        </div>
        <StatusStamp status={data.po.status} />
      </div>
      <ul className="divide-y divide-dashed divide-input">
        {lines.slice(0, 3).map((l) => (
          <li key={l.sku} className="grid gap-1.5 py-3 sm:grid-cols-[1fr_auto] sm:items-center">
            <div className="min-w-0">
              <p className="truncate font-semibold">{l.name}</p>
              <p className="mono text-xs text-muted-foreground">{l.sku} · {money(l.unit_price_cents)} per {l.pack_label}</p>
            </div>
            <Tally t={l.tally} label={l.name} />
          </li>
        ))}
      </ul>
      <TallyLegend className="border-t border-dashed border-input pt-3 text-xs" />
      {f ? (
        <div className="mt-4">
          <SettlementBar f={{ limit_cents: f.limit_cents, captured_cents: f.captured_cents, held_cents: f.held_cents, held_now_cents: f.held_now_cents, releasing_cents: f.releasing_cents, released_cents: f.released_cents, refunding_cents: f.refunding_cents, spendable_cents: f.spendable_cents }} compact />
          <p className="mt-2 text-sm text-muted-foreground">
            <span className="num font-semibold text-foreground">{money(f.captured_cents)}</span> charged · <span className="num">{money(f.held_cents)}</span> held · limit <span className="num">{money(f.limit_cents)}</span>
          </p>
        </div>
      ) : (
        <p className="mt-4 rounded-md bg-paper-2 px-3 py-2 text-sm">
          {quoted ? "Quoted" : "About"} <span className="num font-semibold">{money(quoted ?? est)}</span>{quoted ? "" : " at catalog prices"}. PayPal holds the quote at order, then charges only what was accepted.
        </p>
      )}
    </figure>
  );
}

const STEPS = [
  { icon: Receipt, k: "Order inside a limit", v: "The owner sets a spending limit. When the supplier's quote is accepted, PayPal places a hold for it. Nothing is charged yet." },
  { icon: Truck, k: "Count it in at the door", v: "Snap the docket and any damage. AI proposes the counts; the person at the door confirms or corrects them." },
  { icon: Repeat2, k: "Agree once", v: "The supplier agrees or disputes each line. Shortfalls become a credit or a replacement inside the limit. Both sides approve the same version." },
  { icon: BookOpenCheck, k: "PayPal charges exactly that", v: "Capture the accepted amount, release the rest of the hold, and place a new hold for any replacement. Every call is logged and read back." },
];

const STOPS = [
  { icon: PackageX, k: "Short and damaged deliveries", v: "You pay for what was accepted, not what was ordered or invoiced." },
  { icon: FileWarning, k: "Invoices that don't match", v: "Over-billed quantities and prices above the quote are flagged and not paid." },
  { icon: ShieldAlert, k: "\"New bank details\" scams", v: "No document, message or model can change who gets paid. Hidden instructions in paperwork are stripped before anything reads it." },
];

const FAQ = [
  { q: "Is this real money?", a: "No. This build runs on the PayPal sandbox. The holds, captures, refunds and releases are real PayPal API calls with real ids, against test accounts." },
  { q: "What does the AI decide?", a: "Nothing about money. It reads documents and photos into proposed counts and hints, which a person confirms. Code computes the amount from the accepted quote and the confirmed counts." },
  { q: "What if the supplier disagrees with our count?", a: "They dispute the line with a note. You recount or adjust, and a new version goes to both sides. Nothing is charged until both approve the same version." },
  { q: "Can a large payment go through without me?", a: "No. Above your threshold, or whenever a scam rule fires, the capture waits on your Approvals page. Larger amounts need your passkey." },
  { q: "Does my supplier need to sign up?", a: "In this demo, yes: the wholesaler has its own sign-in. Phone alerts by Telegram are there for people who'd rather not open an app." },
];

export default function Landing() {
  const { session } = useSession();
  const who = session?.who;
  return (
    <PublicShell wide>
      <section className="grid items-center gap-8 lg:grid-cols-[1.05fr_1fr] lg:gap-12" data-tour="hero" aria-labelledby="hero-title">
        <div>
          <p className="mb-3 inline-flex items-center gap-2 text-sm font-semibold text-muted-foreground">
            <span className="tally sm" aria-hidden="true"><i data-k="accepted" /><i data-k="accepted" /><i data-k="accepted" /><i data-k="damaged" /></span>
            For cafés and the wholesalers who supply them
          </p>
          <h1 id="hero-title" className="text-[2.6rem] leading-[1.02] sm:text-6xl" style={{ fontVariationSettings: '"wdth" 118' }}>
            Pay for what actually arrived.
          </h1>
          <p className="mt-4 max-w-xl text-lg text-muted-foreground">
            When a delivery turns up short, damaged or over-billed, StockSure gets both sides to agree what came off the truck. Then PayPal charges exactly that, releases the rest, and holds money for any replacement.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Button asChild size="lg">
              <Link to={who ? "/home" : "/start"}>
                {who ? "Open your orders" : "Try the live demo"} <ArrowRight aria-hidden="true" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link to="/judge"><BookOpenCheck aria-hidden="true" /> Judge paths, 3 minutes</Link>
            </Button>
          </div>
          <div className="a11y-quick mt-6 flex flex-wrap items-center gap-2 text-sm" role="group" aria-label="Make this easier to use">
            <span className="text-muted-foreground">Make it easier:</span>
            <button type="button" className="min-h-10 rounded-md border border-input bg-card px-3 font-semibold aria-pressed:bg-foreground aria-pressed:text-background" data-q="textScale:1.25">Bigger text</button>
            <button type="button" className="min-h-10 rounded-md border border-input bg-card px-3 font-semibold aria-pressed:bg-foreground aria-pressed:text-background" data-q="contrast:high">High contrast</button>
            <button type="button" className="min-h-10 rounded-md border border-input bg-card px-3 font-semibold aria-pressed:bg-foreground aria-pressed:text-background" data-q="readAloud:true">Read aloud</button>
          </div>
          <p className="mt-3 text-sm"><Link to="/accessibility" className="font-semibold underline underline-offset-4">Works with a screen reader, at 200% text, by voice</Link></p>
        </div>
        <Docket />
      </section>

      <section className="mt-14 sm:mt-20" aria-labelledby="trust-title" data-tour="trust">
        <h2 id="trust-title" className="mb-1 text-2xl sm:text-3xl">Who does what</h2>
        <p className="mb-4 max-w-2xl text-muted-foreground">The line that matters: a model can read the paperwork, but it can't set a price, a quantity or who gets paid.</p>
        <TrustRow />
      </section>

      <section id="how" className="mt-14 scroll-mt-20 sm:mt-20" aria-labelledby="how-title">
        <h2 id="how-title" className="mb-5 text-2xl sm:text-3xl">How it works</h2>
        <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s, i) => (
            <li key={s.k} className="rounded-lg border border-border bg-card p-5">
              <p className="mono text-xs text-muted-foreground">Step {i + 1}</p>
              <s.icon className="mt-2 size-6" aria-hidden="true" />
              <h3 className="mt-2 text-lg">{s.k}</h3>
              <p className="mt-1 text-muted-foreground">{s.v}</p>
            </li>
          ))}
        </ol>
      </section>

      <div className="mt-14 sm:mt-20"><TryScam /></div>

      <section className="mt-14 sm:mt-20" aria-labelledby="stops-title">
        <h2 id="stops-title" className="mb-5 text-2xl sm:text-3xl">What it stops</h2>
        <ul className="grid gap-4 md:grid-cols-3">
          {STOPS.map((s) => (
            <li key={s.k} className="flex gap-3 border-l-4 border-foreground pl-4">
              <s.icon className="mt-1 size-5 shrink-0" aria-hidden="true" />
              <div>
                <h3 className="text-lg">{s.k}</h3>
                <p className="text-muted-foreground">{s.v}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>


      <section className="mt-14 sm:mt-20" aria-labelledby="faq-title">
        <h2 id="faq-title" className="mb-4 text-2xl sm:text-3xl">Questions</h2>
        <div className="divide-y divide-border rounded-lg border border-border bg-card">
          {FAQ.map((f) => (
            <details key={f.q} className="group px-5">
              <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 py-3 font-heading text-lg font-bold">
                {f.q}
                <ChevronDown className="size-5 shrink-0 transition-transform group-open:rotate-180" aria-hidden="true" />
              </summary>
              <p className="pb-4 text-muted-foreground">{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="mt-14 rounded-lg bg-foreground p-6 text-background sm:mt-20 sm:p-10">
        <h2 className="text-2xl sm:text-3xl">See a whole delivery settle</h2>
        <p className="mt-2 max-w-xl opacity-85">Sign in as the café owner, the person who receives deliveries, or the wholesaler. The demo resets any time.</p>
        <div className="mt-5 flex flex-wrap gap-3">
          <Button asChild size="lg" variant="secondary">
            <Link to="/start">Start your own demo <ArrowRight aria-hidden="true" /></Link>
          </Button>
          <Button asChild size="lg" variant="outline" className="border-background/40 bg-transparent text-background hover:bg-background/10 hover:text-background">
            <Link to="/judge">Judge paths</Link>
          </Button>
        </div>
      </section>
    </PublicShell>
  );
}
