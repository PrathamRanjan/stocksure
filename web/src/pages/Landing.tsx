import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { ArrowDown, ArrowRight, Bot, ChevronDown, Code2, FileWarning, Landmark, PackageX, PlayCircle, ShieldAlert } from "lucide-react";
import { act, getJSON, useView } from "@/lib/api";
import { startDemo, type WorkspaceInfo } from "@/lib/demo";
import { useSession } from "@/lib/session";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { PublicShell } from "@/components/public-shell";
import { TryScam } from "@/components/try-scam";
import { Spinner, Stamp, TrustRow } from "@/components/brand";
import { ORDER, PEOPLE, WORDS, type PersonKey } from "@/tour/people";
import { JOURNEYS, journeyActive, resumeJourney, startJourney, type JourneyKind } from "@/tour/journey";

/* ---------------- the one delivery, as a picture ---------------- */

const STORY = [
  { k: "Ordered", v: "8 cases of almond milk × $11", n: "$88", note: "PayPal holds $88 of the café's money. Nothing is charged yet.", tone: "held" },
  { k: "Arrived", v: "6 good cases, 2 crushed", n: "6 / 8", note: "Sam counts it at the back door. AI reads the docket; Sam confirms.", tone: "stop" },
  { k: "Invoice says", v: "8 cases", n: "$88", note: "Without StockSure, this is what gets paid.", tone: "strike" },
  { k: "StockSure pays", v: "$11 × 6 accepted cases", n: "$66", note: "$22 goes back to the café. A new $22 hold covers 2 replacement cases.", tone: "paid" },
];

function StoryCard() {
  return (
    <figure className="rounded-xl border border-border bg-card p-4 shadow-[0_1px_0_var(--border),0_18px_40px_-24px_rgb(0_0_0/0.4)] sm:p-6" aria-label="One delivery, start to finish">
      <p className="mono text-xs uppercase tracking-wider text-muted-foreground">One delivery · Laneway Café ← Harbour Wholesale Co.</p>
      <ol className="mt-3 grid gap-2.5">
        {STORY.map((r, i) => (
          <li key={r.k} className="ss-rise grid grid-cols-[1fr_auto] items-start gap-x-4 rounded-lg border border-border p-3" style={{ animationDelay: `${150 + i * 220}ms` }}>
            <div className="min-w-0">
              <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{r.k}</p>
              <p className="font-semibold">{r.v}</p>
              <p className="mt-0.5 text-sm text-muted-foreground">{r.note}</p>
            </div>
            <p
              className={cn(
                "num font-heading text-2xl font-extrabold",
                r.tone === "paid" && "text-paid",
                r.tone === "held" && "text-held",
                r.tone === "stop" && "text-stop",
                r.tone === "strike" && "text-muted-foreground line-through decoration-stop decoration-2",
              )}
            >
              {r.n}
            </p>
          </li>
        ))}
      </ol>
    </figure>
  );
}

/* ---------------- the people ---------------- */

function Avatar({ k, size = "md" }: { k: PersonKey; size?: "md" | "lg" }) {
  return (
    <span className={cn("ss-j-av", size === "lg" ? "!size-14 !text-2xl" : "!size-10 !text-lg")} data-p={k} aria-hidden="true">
      {PEOPLE[k].first[0]}
    </span>
  );
}

const PROBLEMS = [
  { icon: PackageX, k: "Short and damaged deliveries get paid anyway", v: "The person at the back door notes “2 cases crushed” on a paper docket. The note gets lost, the full invoice gets paid, and a credit takes weeks if it comes at all." },
  { icon: FileWarning, k: "Invoices that don't match the delivery", v: "An extra case billed, a price above the quote, the same invoice sent twice under a new number. Small, regular leaks." },
  { icon: ShieldAlert, k: "“We've changed our bank details”", v: "A polite email or invoice asks to pay somewhere new. Now that AI tools read invoices, a hidden line can try to instruct the AI too." },
];

type Actor = PersonKey | "paypal" | "code";
const FLOW: { who: Actor[]; k: string; v: string }[] = [
  { who: ["jordan", "ana"], k: "Order and quote", v: "Jordan orders inside a spending limit. Ana quotes. When Jordan accepts, PayPal holds $88: set aside, not charged." },
  { who: ["ana"], k: "Ship it", v: "Ana sends the truck, with an invoice if Harbour sends one. The invoice is only ever compared, never paid from." },
  { who: ["sam"], k: "Count it in", v: "Sam snaps the docket or the cases. AI suggests “8 arrived, 2 damaged”. Sam checks and confirms: 6 accepted." },
  { who: ["ana"], k: "Agree the count", v: "Ana sees Sam's count and photos and agrees, or disputes it with a note. No phone calls." },
  { who: ["code", "jordan", "ana"], k: "Agree the fix", v: "Code works it out: $11 × 6 = $66, and the 2 crushed cases are sent again. Jordan and Ana approve the same version." },
  { who: ["paypal"], k: "PayPal settles", v: "PayPal charges $66 and pays Ana, gives $22 back to the café, and holds $22 for the replacement. Every step is read back from PayPal." },
];

function WhoChip({ w }: { w: Actor }) {
  if (w === "paypal" || w === "code") {
    const Icon = w === "paypal" ? Landmark : Code2;
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-paper-2 px-2 py-0.5 text-xs font-semibold">
        <Icon className="size-3.5" aria-hidden="true" /> {w === "paypal" ? "PayPal" : "Code"}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-paper-2 py-0.5 pl-0.5 pr-2 text-xs font-semibold">
      <span className="ss-j-av !size-5 !text-[0.65rem]" data-p={w} aria-hidden="true">{PEOPLE[w].first[0]}</span>
      {PEOPLE[w].first}
    </span>
  );
}

const FAQ = [
  { q: "Is this real money?", a: "No. This build runs on the PayPal sandbox. The holds, charges, refunds and releases are real PayPal API calls with real ids, against test accounts." },
  { q: "What does the AI decide?", a: "Nothing about money. It reads documents and photos into suggested counts and warnings, which a person confirms. Code works out the amount from the accepted quote and the confirmed counts." },
  { q: "What if the wholesaler disagrees with the count?", a: "The wholesaler disputes the line with a note. The café recounts or adjusts, and a new version goes to both sides. Nothing is charged until both approve the same version." },
  { q: "Can a large payment go through without the owner?", a: "No. Above the owner's threshold, or whenever the scam check fires, the charge waits on the Approvals page." },
  { q: "Do I need a PayPal login to try it?", a: "No. Your private demo pays from a saved sandbox wallet, so every PayPal step works without signing in to PayPal." },
];

interface JudgeLite {
  live: { area: string; state: string; detail: string }[];
  pages: { to: string; title: string; what: string }[];
  repo: { url: string; public: boolean };
}

/* ---------------- page ---------------- */

export default function Landing() {
  const { session, refresh } = useSession();
  const nav = useNavigate();
  const who = session?.who;
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const judge = useView<JudgeLite>("/api/public/judge");
  const resumable = journeyActive();
  const { hash } = useLocation();

  // "/#pick" (where /judge and every "Guided tour" link land) scrolls straight to the picker.
  useEffect(() => {
    if (!hash) return;
    const t = setTimeout(() => document.getElementById(decodeURIComponent(hash.slice(1)))?.scrollIntoView({ block: "start" }), 60);
    return () => clearTimeout(t);
  }, [hash]);

  /** Makes sure this browser has its own demo (a café and a wholesaler with live orders), then returns its people. */
  async function ensureDemo(): Promise<{ id: string; first: string }[]> {
    let people = await getJSON<{ people: { id: string; first: string }[]; needs_workspace?: boolean }>("/api/ui/people");
    const ws = await getJSON<WorkspaceInfo>("/api/ui/workspace").catch(() => null);
    // The tour follows this browser's own orders, so open a private demo whenever the server offers one.
    if (people.needs_workspace || (ws?.demo && ws.workspace?.kind !== "visitor")) {
      setStatus("Opening your private demo: a café, its wholesaler and live orders on the PayPal sandbox…");
      const r = await startDemo();
      if (!r.ok) throw new Error(r.message);
      await refresh();
      people = await getJSON("/api/ui/people");
    }
    return people.people;
  }

  async function begin(kind: JourneyKind) {
    setBusy(kind);
    setError(null);
    try {
      await ensureDemo();
      setStatus("Getting the first order ready…");
      await startJourney(kind);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
      setStatus(null);
    }
  }

  async function lookAround(k: PersonKey) {
    setBusy(`look-${k}`);
    setError(null);
    try {
      const people = await ensureDemo();
      const p = people.find((x) => x.first === PEOPLE[k].first);
      if (!p) throw new Error("That person isn't in this demo.");
      const r = await act("/login", { person_id: p.id, next: "/home" });
      if (!r.ok) throw new Error(r.message);
      await refresh();
      nav("/home");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
      setStatus(null);
    }
  }

  return (
    <PublicShell wide>
      {/* 1. What it is */}
      <section className="grid items-center gap-8 lg:grid-cols-[1.05fr_1fr] lg:gap-12" data-tour="hero" aria-labelledby="hero-title">
        <div>
          <p className="mb-3 text-sm font-semibold text-muted-foreground">For cafés and the wholesalers who supply them</p>
          <h1 id="hero-title" className="text-[2.6rem] leading-[1.02] sm:text-6xl" style={{ fontVariationSettings: '"wdth" 118' }}>
            Pay for what actually arrived.
          </h1>
          <p className="mt-4 max-w-xl text-lg text-muted-foreground">
            Deliveries turn up short or damaged, and the invoice still bills everything. StockSure gets the café and its wholesaler to agree what came off the truck. Then PayPal charges exactly that, gives back the rest, and holds money for anything sent again.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            {resumable ? (
              <Button size="lg" onClick={() => void resumeJourney()}>
                <PlayCircle aria-hidden="true" /> Resume the guided tour
              </Button>
            ) : (
              <Button asChild size="lg">
                <a href="#pick">
                  Try it: pick who you are <ArrowDown aria-hidden="true" />
                </a>
              </Button>
            )}
            <Button asChild size="lg" variant="outline">
              <a href="#problem">What problem does it solve?</a>
            </Button>
          </div>
          {who && (
            <p className="mt-4 text-sm text-muted-foreground">
              You're signed in as {who.name}.{" "}
              <Link to="/home" className="font-semibold text-foreground underline underline-offset-2">Open {who.first}'s orders</Link>
            </p>
          )}
          <div className="a11y-quick mt-6 flex flex-wrap items-center gap-2 text-sm" role="group" aria-label="Make this easier to use">
            <span className="text-muted-foreground">Make it easier:</span>
            <button type="button" className="min-h-10 rounded-md border border-input bg-card px-3 font-semibold aria-pressed:bg-foreground aria-pressed:text-background" data-q="textScale:1.25">Bigger text</button>
            <button type="button" className="min-h-10 rounded-md border border-input bg-card px-3 font-semibold aria-pressed:bg-foreground aria-pressed:text-background" data-q="contrast:high">High contrast</button>
            <button type="button" className="min-h-10 rounded-md border border-input bg-card px-3 font-semibold aria-pressed:bg-foreground aria-pressed:text-background" data-q="readAloud:true">Read aloud</button>
          </div>
          <p className="mt-3 text-sm"><Link to="/accessibility" className="font-semibold underline underline-offset-4">Works with a screen reader, at 200% text, by voice</Link></p>
        </div>
        <StoryCard />
      </section>

      {/* 2. The problem */}
      <section id="problem" className="mt-16 scroll-mt-20 sm:mt-24" aria-labelledby="problem-title">
        <h2 id="problem-title" className="text-2xl sm:text-3xl">The problem</h2>
        <p className="mt-2 max-w-3xl text-muted-foreground">
          A café runs on deliveries: milk, beans, cups, several times a week. Margins are thin (the median full-service restaurant keeps about 2.8% of sales as profit, per the National Restaurant Association), so paying for stock that never arrived adds up fast.
        </p>
        <ul className="mt-6 grid gap-4 md:grid-cols-3">
          {PROBLEMS.map((s) => (
            <li key={s.k} className="rounded-lg border border-border bg-card p-5">
              <s.icon className="size-6" aria-hidden="true" />
              <h3 className="mt-2 text-lg">{s.k}</h3>
              <p className="mt-1 text-muted-foreground">{s.v}</p>
            </li>
          ))}
        </ul>
      </section>

      {/* 3. The people */}
      <section id="people" className="mt-16 scroll-mt-20 sm:mt-24" aria-labelledby="people-title">
        <h2 id="people-title" className="text-2xl sm:text-3xl">Who's involved, and why it takes all of them</h2>
        <p className="mt-2 max-w-3xl text-muted-foreground">
          Money should only move when the people who know what happened agree: the one who saw the goods, the one who pays, and the one who gets paid. Each person below sees and does only their part.
        </p>
        <ul className="mt-6 grid gap-4 lg:grid-cols-3">
          {ORDER.map((k) => {
            const p = PEOPLE[k];
            return (
              <li key={k} className="flex flex-col rounded-lg border border-border bg-card p-5">
                <div className="flex items-center gap-3">
                  <Avatar k={k} size="lg" />
                  <div>
                    <p className="font-heading text-xl font-bold">{p.name}</p>
                    <p className="text-sm text-muted-foreground">{p.role} · {p.org}</p>
                  </div>
                </div>
                <dl className="mt-4 grid gap-3 text-[0.95rem]">
                  <div><dt className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Does</dt><dd>{p.does}</dd></div>
                  <div><dt className="text-xs font-bold uppercase tracking-wider text-stop">Today</dt><dd>{p.pain}</dd></div>
                  <div><dt className="text-xs font-bold uppercase tracking-wider text-paid">With StockSure</dt><dd>{p.gain}</dd></div>
                  <div><dt className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Why the story needs {p.first}</dt><dd>{p.needed}</dd></div>
                </dl>
              </li>
            );
          })}
        </ul>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div className="flex gap-3 rounded-lg border border-dashed border-input p-4">
            <Landmark className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
            <p><b>PayPal sits in the middle.</b> It holds the café's money from the moment a quote is accepted, so the wholesaler knows it's there. It only charges what both sides approved, and gives the rest back.</p>
          </div>
          <div className="flex gap-3 rounded-lg border border-dashed border-input p-4">
            <Bot className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
            <p><b>AI reads; it never decides.</b> It turns dockets, photos and invoices into suggestions and warnings. A person confirms every count; code works out every amount.</p>
          </div>
        </div>
      </section>

      {/* 4. How one delivery flows */}
      <section id="how" className="mt-16 scroll-mt-20 sm:mt-24" aria-labelledby="how-title">
        <h2 id="how-title" className="text-2xl sm:text-3xl">One delivery, step by step</h2>
        <ol className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {FLOW.map((s, i) => (
            <li key={s.k} className="rounded-lg border border-border bg-card p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="num grid size-7 place-items-center rounded-full bg-foreground text-sm font-bold text-background" aria-hidden="true">{i + 1}</span>
                <h3 className="text-lg">{s.k}</h3>
              </div>
              <p className="mt-2 text-muted-foreground">{s.v}</p>
              <p className="mt-3 flex flex-wrap gap-1.5">{s.who.map((w) => <WhoChip key={w} w={w} />)}</p>
            </li>
          ))}
        </ol>
        <div className="mt-8" data-tour="trust">
          <h3 className="mb-1 text-xl">Who can do what</h3>
          <p className="mb-4 max-w-2xl text-muted-foreground">The line that matters: a model can read the paperwork, but it can't set a price, a quantity or who gets paid.</p>
          <TrustRow />
        </div>
      </section>

      {/* 5. Pick who you are */}
      <section id="pick" className="mt-16 scroll-mt-20 rounded-xl border-2 border-foreground bg-card p-5 sm:mt-24 sm:p-8" aria-labelledby="pick-title">
        <h2 id="pick-title" className="text-2xl sm:text-3xl">Pick who you are</h2>
        <p className="mt-2 max-w-3xl text-muted-foreground">
          You get your own private copy, already running: the café, the wholesaler and live orders on the PayPal sandbox. You don't add anything. The guided tour follows one real delivery and switches you between the three people as the story needs them, explaining every page and every word on the way. Leave the tour and look around whenever you like.
        </p>
        {(status || error) && (
          <p role={error ? "alert" : "status"} className={cn("mt-4 flex items-center gap-2 rounded-md px-3 py-2 text-sm", error ? "bg-stop-soft text-stop" : "bg-paper-2")}>
            {!error && <Spinner />} {error ?? status}
          </p>
        )}
        <ul className="mt-6 grid gap-4 lg:grid-cols-3" aria-label="Start the guided tour as">
          {ORDER.map((k) => {
            const p = PEOPLE[k];
            return (
              <li key={k} className="flex flex-col rounded-lg border border-border p-5" data-person={k}>
                <div className="flex items-center gap-3">
                  <Avatar k={k} />
                  <div>
                    <p className="font-heading text-lg font-bold">{p.name}</p>
                    <p className="text-sm text-muted-foreground">{p.role} · {p.org}</p>
                  </div>
                </div>
                <p className="mt-3 flex-1">{p.does}</p>
                <p className="mt-2 text-sm text-muted-foreground">Guided, about {p.minutes} minutes. Starts on {p.first}'s screen, then switches to the others.</p>
                <Button size="lg" className="mt-4" disabled={!!busy} onClick={() => void begin(k)}>
                  {busy === k ? <Spinner /> : <PlayCircle aria-hidden="true" />} Start as {p.first}
                </Button>
                <button type="button" className="mt-2 min-h-11 text-sm font-semibold underline underline-offset-2 disabled:opacity-50" disabled={!!busy} onClick={() => void lookAround(k)}>
                  {busy === `look-${k}` ? "Signing in…" : <>Skip the tour: look around as {p.first}</>}
                </button>
              </li>
            );
          })}
        </ul>
        <h3 className="mt-8 text-xl">More guided journeys</h3>
        <ul className="mt-3 grid gap-3 md:grid-cols-2">
          {JOURNEYS.map((j) => (
            <li key={j.kind}>
              <button type="button" disabled={!!busy} onClick={() => void begin(j.kind)} className="flex h-full w-full items-start gap-3 rounded-lg border border-border p-4 text-left hover:border-foreground disabled:opacity-60">
                {busy === j.kind ? <Spinner className="mt-1" /> : <PlayCircle className="mt-0.5 size-5 shrink-0" aria-hidden="true" />}
                <span>
                  <span className="block font-heading text-lg font-bold">{j.title}</span>
                  <span className="block text-muted-foreground">{j.what}</span>
                  <span className="mt-1 block text-sm text-muted-foreground">Guided, about {j.minutes} minutes</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      {/* 6. Words */}
      <section id="words" className="mt-16 scroll-mt-20 sm:mt-24" aria-labelledby="words-title">
        <h2 id="words-title" className="text-2xl sm:text-3xl">Words you'll see in the app</h2>
        <dl className="mt-5 grid gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
          {WORDS.map((w) => (
            <div key={w.k} className="border-l-4 border-foreground pl-3">
              <dt className="font-heading font-bold">{w.k}</dt>
              <dd className="text-muted-foreground">{w.v}</dd>
            </div>
          ))}
        </dl>
      </section>

      <div className="mt-16 sm:mt-24"><TryScam /></div>

      {/* 7. For engineers */}
      <section id="real" className="mt-16 scroll-mt-20 sm:mt-24" aria-labelledby="real-title">
        <h2 id="real-title" className="text-2xl sm:text-3xl">For engineers: what's real</h2>
        <p className="mt-2 max-w-3xl text-muted-foreground">Built from this server's settings when the page loads, not typed by hand.</p>
        {judge.data ? (
          <>
            <div className="mt-4 overflow-x-auto rounded-lg border border-border bg-card" tabIndex={0} role="region" aria-label="What is live and what is simulated">
              <table className="w-full min-w-[36rem] text-sm">
                <thead>
                  <tr className="border-b border-border text-left"><th className="px-3 py-2">Area</th><th className="px-3 py-2">State</th><th className="px-3 py-2">Detail</th></tr>
                </thead>
                <tbody>
                  {judge.data.live.map((r) => (
                    <tr key={r.area} className="border-b border-border align-top last:border-0">
                      <td className="px-3 py-2 font-semibold">{r.area}</td>
                      <td className="px-3 py-2"><Stamp tone={r.state === "live" ? "paid" : r.state === "not built" ? "quiet" : "held"}>{r.state}</Stamp></td>
                      <td className="px-3 py-2 text-muted-foreground">{r.detail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <h3 className="mt-6 text-lg">Pages that need no sign-in</h3>
            <ul className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {judge.data.pages.map((p) => (
                <li key={p.to}>
                  <Link to={p.to} className="block min-h-11 rounded-md border border-border bg-card p-3 hover:bg-accent">
                    <span className="font-semibold underline underline-offset-2">{p.title}</span>
                    <span className="mt-0.5 block text-sm text-muted-foreground">{p.what}</span>
                  </Link>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-sm text-muted-foreground">
              Source: {judge.data.repo.public ? <a className="underline" href={judge.data.repo.url}>{judge.data.repo.url}</a> : "the repository is private for now."}
            </p>
          </>
        ) : (
          <p className="mt-4 text-sm text-muted-foreground">{judge.error ? "Couldn't load this right now." : "Loading…"}</p>
        )}
      </section>

      <section className="mt-16 sm:mt-24" aria-labelledby="faq-title">
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

      <section className="mt-16 rounded-lg bg-foreground p-6 text-background sm:mt-24 sm:p-10">
        <h2 className="text-2xl sm:text-3xl">See a whole delivery settle</h2>
        <p className="mt-2 max-w-xl opacity-85">Pick a person and the guided tour takes you through it in about four minutes.</p>
        <Button asChild size="lg" variant="secondary" className="mt-5">
          <a href="#pick">Pick who you are <ArrowRight aria-hidden="true" /></a>
        </Button>
      </section>
    </PublicShell>
  );
}
