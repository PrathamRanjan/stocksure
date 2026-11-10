import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { ArrowRight, CheckCircle2, Wallet } from "lucide-react";
import { seedLine, startDemo, useWorkspace } from "@/lib/demo";
import { useSession } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { PublicShell } from "@/components/public-shell";
import { ErrorBlock, LoadingBlock, Spinner, Stamp } from "@/components/brand";

/**
 * "Try the live demo" lands here (spec A1.2). It opens a private demo for this browser: its own café, wholesaler
 * and orders, seeded through the real order path. Holds and captures for the seeded orders are made on the PayPal
 * sandbox from the saved demo wallet while you watch; the count below is read back from PayPal, not assumed.
 */
export default function Start() {
  const { refresh } = useSession();
  const ws = useWorkspace(2500);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tried = useRef(false);

  async function begin(fresh = false) {
    setStarting(true);
    setError(null);
    const r = await startDemo(fresh);
    setStarting(false);
    if (!r.ok) return setError(r.message);
    await refresh();
    await ws.reload(true);
  }

  // Open one automatically the first time; never more than once per visit.
  useEffect(() => {
    if (tried.current || !ws.data) return;
    tried.current = true;
    if (ws.data.demo && ws.data.workspace?.kind !== "visitor") void begin();
  }, [ws.data]); // eslint-disable-line react-hooks/exhaustive-deps

  if (ws.error && !ws.data) return <PublicShell><ErrorBlock message={ws.error.message} retry={() => ws.reload()} /></PublicShell>;
  if (!ws.data) return <PublicShell><LoadingBlock label="Checking for your demo" /></PublicShell>;
  const d = ws.data;
  const mine = d.workspace?.kind === "visitor" ? d.workspace : null;
  const s = d.seed;
  const pct = s && s.expected ? Math.round((s.confirmed / s.expected) * 100) : 0;

  return (
    <PublicShell>
      <h1 className="text-4xl">Your private demo</h1>
      <p className="mt-2 text-muted-foreground">
        A café, its wholesaler and a few orders, only for this browser. Nobody else sees what you do here, and you can't break anyone else's demo.
      </p>

      {!d.demo && <p className="mt-6 rounded-lg border border-dashed border-input p-5">Demo mode is off on this server.</p>}

      {error && (
        <div className="mt-6">
          <ErrorBlock message={error} retry={() => void begin()} />
        </div>
      )}

      {d.demo && !mine && !error && (
        <div className="mt-6 flex items-center gap-3 rounded-lg border border-border bg-card p-5" role="status">
          <Spinner /> {starting ? "Opening your demo…" : "Getting ready…"}
        </div>
      )}

      {mine && s && (
        <section className="mt-6 rounded-lg border-2 border-foreground bg-card p-5" aria-labelledby="seed-title" aria-live="polite">
          <h2 id="seed-title" className="flex flex-wrap items-center gap-2 text-xl">
            {s.done && !s.stopped ? <CheckCircle2 className="size-5" aria-hidden="true" /> : <Spinner className="size-5" />}
            {s.done && !s.stopped ? "Ready" : "Setting up the sample orders"}
          </h2>
          <p className="mt-2">{seedLine(d)}</p>
          {s.wallet && s.expected > 0 && (
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label="Payments confirmed by PayPal" aria-valuemin={0} aria-valuemax={s.expected} aria-valuenow={s.confirmed}>
              <div className="h-full bg-foreground transition-[width]" style={{ width: `${pct}%` }} />
            </div>
          )}
          <p className="mt-3 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <Wallet className="size-4" aria-hidden="true" />
            {s.wallet ? (
              <>The buyer pays from the demo's saved sandbox wallet{d.wallet.configured && d.wallet.payer ? ` (${d.wallet.payer})` : ""}: test money, no PayPal login needed.</>
            ) : (
              <>No saved wallet: you'll approve on PayPal's own sandbox page.</>
            )}
            <Stamp tone="quiet">sandbox</Stamp>
          </p>
          <p className="mt-2 text-sm text-muted-foreground">You can start now; the rest finishes in the background. Idle demos close after {mine.idle_hours} hours, and any holds still open are released on PayPal.</p>
          <div className="mt-5 flex flex-wrap gap-2">
            <Button asChild size="lg">
              <Link to="/login">Pick who you are <ArrowRight aria-hidden="true" /></Link>
            </Button>
            <Button asChild size="lg" variant="outline"><Link to="/demo">Demo controls</Link></Button>
          </div>
        </section>
      )}
    </PublicShell>
  );
}
