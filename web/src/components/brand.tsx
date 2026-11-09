import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { AlertTriangle, Bot, Code2, Landmark, Loader2, RefreshCw, WifiOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { money, PP, STATUS } from "@/lib/format";
import { Button } from "@/components/ui/button";

export function Logo({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2 font-heading font-extrabold tracking-tight", className)}>
      <svg viewBox="0 0 28 28" width="26" height="26" aria-hidden="true" className="shrink-0">
        <rect x="1" y="1" width="26" height="26" rx="4" fill="currentColor" />
        <g fill="var(--background)">
          <rect x="6" y="7" width="2.6" height="14" rx="0.8" />
          <rect x="10.4" y="7" width="2.6" height="14" rx="0.8" />
          <rect x="14.8" y="7" width="2.6" height="14" rx="0.8" />
        </g>
        <path d="M19.4 21 L23 7" stroke="var(--background)" strokeWidth="2.4" strokeLinecap="round" />
      </svg>
      {!compact && <span style={{ fontVariationSettings: '"wdth" 118' }}>StockSure</span>}
    </span>
  );
}

type Tone = "held" | "paid" | "stop" | "released" | "carbon" | "ink" | "quiet";
export function Stamp({ tone, children, className, animate = false, title }: { tone: Tone; children: ReactNode; className?: string; animate?: boolean; title?: string }) {
  return (
    <span className={cn("stamp", animate && "stamp-in", className)} data-tone={tone} title={title}>
      {children}
    </span>
  );
}

export function StatusStamp({ status, className }: { status: string; className?: string }) {
  const s = STATUS[status] ?? { label: status.replace(/_/g, " "), tone: "quiet" as const };
  return <Stamp tone={s.tone} className={className}>{s.label}</Stamp>;
}

export function PayPalStamp({ status }: { status: string | null | undefined }) {
  if (!status) return null;
  const s = PP[status] ?? { label: status.replace(/_/g, " ").toLowerCase(), tone: "quiet" as const };
  return <Stamp tone={s.tone} title={`PayPal reports ${status}`}>{s.label}</Stamp>;
}

export interface TallyNums {
  ordered: number;
  accepted: number | null;
  damaged: number | null;
  wrong: number | null;
  short: number | null;
}

/** The signature: one mark per pack. Ink = accepted, struck red = damaged, dashed = short or wrong, grey = ordered, not yet counted. */
export function Tally({ t, size = "md", label, className }: { t: TallyNums; size?: "sm" | "md"; label?: string; className?: string }) {
  const r = (n: number | null) => Math.max(0, Math.round(n ?? 0));
  const counted = t.accepted !== null;
  const marks: string[] = [];
  if (!counted) for (let i = 0; i < t.ordered; i++) marks.push("ordered");
  else {
    for (let i = 0; i < r(t.accepted); i++) marks.push("accepted");
    for (let i = 0; i < r(t.damaged); i++) marks.push("damaged");
    for (let i = 0; i < r(t.wrong); i++) marks.push("wrong");
    for (let i = 0; i < r(t.short); i++) marks.push("short");
  }
  const text = !counted
    ? `${t.ordered} ordered, not counted yet`
    : [`${fmtN(t.accepted)} accepted`, t.damaged ? `${fmtN(t.damaged)} damaged` : "", t.wrong ? `${fmtN(t.wrong)} wrong` : "", t.short ? `${fmtN(t.short)} short` : "", `of ${t.ordered} ordered`].filter(Boolean).join(", ");
  const too = marks.length > 48;
  return (
    <span className={cn("inline-flex items-center", className)} role="img" aria-label={label ? `${label}: ${text}` : text} title={text}>
      {too ? (
        <span className="sbar w-40" aria-hidden="true">
          {(["accepted", "damaged", "wrong", "short", "ordered"] as const).map((k) => {
            const n = marks.filter((m) => m === k).length;
            return n ? <span key={k} style={{ width: `${(n / marks.length) * 100}%`, background: k === "accepted" ? "var(--foreground)" : k === "damaged" ? "var(--stop)" : k === "ordered" ? "var(--input)" : "var(--paper-2)" }} /> : null;
          })}
        </span>
      ) : (
        <span className={cn("tally", size === "sm" && "sm")} aria-hidden="true">
          {marks.map((k, i) => (
            <i key={i} data-k={k} style={i > 0 && i % 5 === 0 ? { marginLeft: 4 } : undefined} />
          ))}
        </span>
      )}
    </span>
  );
}
const fmtN = (n: number | null) => (n === null ? "—" : Number.isInteger(n) ? String(n) : n.toFixed(1));

export function TallyLegend({ className }: { className?: string }) {
  const item = (k: string, l: string) => (
    <span className="inline-flex items-center gap-1.5">
      <span className="tally sm" aria-hidden="true"><i data-k={k} /></span>
      {l}
    </span>
  );
  return (
    <p className={cn("flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground", className)}>
      {item("accepted", "accepted")}
      {item("damaged", "damaged")}
      {item("short", "short or wrong")}
      {item("ordered", "not counted yet")}
    </p>
  );
}

export interface FundingNums {
  limit_cents: number;
  captured_cents: number;
  refunded_cents?: number;
  held_cents: number;
  inflight_cents?: number;
  expected?: { label: string; cents: number }[];
  spendable_cents: number;
}

/** The spend limit split into captured, still held, released-but-not-confirmed and headroom. */
export function SettlementBar({ f, className, compact = false }: { f: FundingNums; className?: string; compact?: boolean }) {
  const lim = Math.max(1, f.limit_cents);
  const captured = Math.max(0, f.captured_cents - (f.refunded_cents ?? 0));
  const held = f.held_cents + (f.inflight_cents ?? 0);
  const exp = (f.expected ?? []).reduce((a, x) => a + x.cents, 0);
  const heldOnly = Math.max(0, held - exp);
  const pct = (c: number) => `${Math.min(100, (c / lim) * 100)}%`;
  const label = `Limit ${money(f.limit_cents)}: ${money(captured)} charged, ${money(heldOnly)} held, ${money(exp)} being released, ${money(f.spendable_cents)} spendable now.`;
  return (
    <div className={className}>
      <div className="sbar" role="img" aria-label={label}>
        <span data-k="captured" style={{ width: pct(captured) }} />
        <span data-k="held" style={{ width: pct(heldOnly) }} />
        <span data-k="expected" style={{ width: pct(exp) }} />
      </div>
      {!compact && (
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
          <Fig k="Charged" v={captured} dot="var(--paid)" hint={f.refunded_cents ? `${money(f.refunded_cents)} refunded` : undefined} />
          <Fig k="Held on PayPal" v={heldOnly} dot="var(--held)" />
          <Fig k="Being released" v={exp} dot="var(--released)" hint="not spendable until PayPal confirms" />
          <Fig k="Spendable now" v={f.spendable_cents} hint={`of ${money(f.limit_cents)} limit`} />
        </dl>
      )}
    </div>
  );
}
function Fig({ k, v, dot, hint }: { k: string; v: number; dot?: string; hint?: string }) {
  return (
    <div>
      <dt className="flex items-center gap-1.5 text-muted-foreground">
        {dot && <span className="inline-block size-2.5 rounded-[2px]" style={{ background: dot }} aria-hidden="true" />}
        {k}
      </dt>
      <dd className="num font-heading text-lg font-bold">{money(v)}</dd>
      {hint && <dd className="text-xs text-muted-foreground">{hint}</dd>}
    </div>
  );
}

/** The trust pattern, shown wherever money is about to move. */
export function TrustRow({ className, dense = false }: { className?: string; dense?: boolean }) {
  const cells = [
    { icon: Bot, k: "AI proposes", v: "Reads the docket, invoice and photos into suggested counts. Never sets a price or a payee." },
    { icon: Code2, k: "Code decides", v: "Pay = quote price × counted units. Checks limits, your rules and the agreed version." },
    { icon: Landmark, k: "PayPal moves money", v: "Holds at order, captures only the agreed amount, releases the rest." },
  ];
  return (
    <ol className={cn("grid gap-px overflow-hidden rounded-lg border border-border bg-border", !dense && "sm:grid-cols-3", className)}>
      {cells.map((c, i) => (
        <li key={c.k} className={cn("bg-card", dense ? "p-3" : "p-4 sm:p-5")}>
          <p className="flex items-center gap-2 font-heading font-bold">
            <span className="num grid size-6 place-items-center rounded-sm bg-foreground text-xs text-background">{i + 1}</span>
            <c.icon className="size-4" aria-hidden="true" />
            {c.k}
          </p>
          {!dense && <p className="mt-1.5 text-sm text-muted-foreground">{c.v}</p>}
        </li>
      ))}
    </ol>
  );
}

export function PageHeader({ title, sub, actions, back, kicker }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode; back?: { to: string; label: string }; kicker?: ReactNode }) {
  return (
    <header className="mb-5 sm:mb-7">
      {back && (
        <Link to={back.to} className="mb-2 inline-flex min-h-11 items-center text-sm font-semibold text-muted-foreground hover:text-foreground sm:min-h-8">
          ← {back.label}
        </Link>
      )}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          {kicker && <div className="mb-1">{kicker}</div>}
          <h1 className="text-[1.75rem] leading-tight sm:text-4xl">{title}</h1>
          {sub && <div className="mt-1.5 text-muted-foreground">{sub}</div>}
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
    </header>
  );
}

export function SectionTitle({ children, aside, id }: { children: ReactNode; aside?: ReactNode; id?: string }) {
  return (
    <div className="mb-3 mt-8 flex items-baseline justify-between gap-3 first:mt-0">
      <h2 id={id} className="text-xl">{children}</h2>
      {aside && <div className="text-sm text-muted-foreground">{aside}</div>}
    </div>
  );
}

export function Empty({ title, children, action, art }: { title: string; children?: ReactNode; action?: ReactNode; art?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-input bg-card/60 px-5 py-8 text-center">
      {art ?? (
        <div className="mx-auto mb-3 w-fit opacity-60">
          <Tally t={{ ordered: 5, accepted: null, damaged: null, wrong: null, short: null }} />
        </div>
      )}
      <p className="font-heading text-lg font-bold">{title}</p>
      {children && <div className="mx-auto mt-1 max-w-prose text-muted-foreground">{children}</div>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

export function LoadingBlock({ label = "Loading" }: { label?: string }) {
  return (
    <div role="status" aria-live="polite" className="space-y-3">
      <span className="sr-only">{label}…</span>
      <div className="h-9 w-2/3 animate-pulse rounded-md bg-muted" />
      <div className="h-4 w-1/2 animate-pulse rounded-md bg-muted" />
      <div className="h-40 animate-pulse rounded-lg bg-muted" />
      <div className="h-24 animate-pulse rounded-lg bg-muted" />
    </div>
  );
}

export function ErrorBlock({ message, retry, status }: { message: string; retry?: () => void; status?: number }) {
  const offline = status === 0 || (typeof navigator !== "undefined" && !navigator.onLine);
  return (
    <div role="alert" className="rounded-lg border border-stop/40 bg-stop-soft p-5">
      <p className="flex items-center gap-2 font-heading text-lg font-bold text-stop">
        {offline ? <WifiOff className="size-5" aria-hidden="true" /> : <AlertTriangle className="size-5" aria-hidden="true" />}
        {offline ? "You're offline" : status === 404 ? "Not found" : "That didn't load"}
      </p>
      <p className="mt-1">{offline ? "Nothing was changed. Reconnect and try again." : message}</p>
      {retry && (
        <Button variant="outline" className="mt-3" onClick={retry}>
          <RefreshCw aria-hidden="true" /> Try again
        </Button>
      )}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn("size-4 animate-spin", className)} aria-hidden="true" />;
}

export function Money({ c, className, strong = false }: { c: number | null | undefined; className?: string; strong?: boolean }) {
  return <span className={cn("num", strong && "font-heading font-bold", className)}>{money(c)}</span>;
}

/** Network state for the offline banner. */
export function useOnline() {
  const [on, setOn] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  useEffect(() => {
    const a = () => setOn(true);
    const b = () => setOn(false);
    addEventListener("online", a);
    addEventListener("offline", b);
    return () => {
      removeEventListener("online", a);
      removeEventListener("offline", b);
    };
  }, []);
  return on;
}
