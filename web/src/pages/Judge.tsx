import { useEffect } from "react";
import { Link } from "react-router";
import { BookOpenCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PublicShell } from "@/components/public-shell";
import { TrustRow } from "@/components/brand";
import { JUDGE, readState, startTour } from "@/tour/tours";

/** Judge Mode: a guided walk across the landing page, three people and the live PayPal record. Starts on arrival. */
export default function Judge() {
  useEffect(() => {
    if (!readState()) void startTour("judge");
  }, []);
  return (
    <PublicShell>
      <h1 className="text-4xl">Judge mode</h1>
      <p className="mt-2 text-muted-foreground">About three minutes. It moves between pages and people by itself, and you can leave at any step with Esc. Each step points at the real screen, with live data from the PayPal sandbox.</p>
      <Button size="lg" className="mt-5" onClick={() => startTour("judge")}><BookOpenCheck aria-hidden="true" /> Start from the beginning</Button>
      <ol className="mt-8 grid gap-2">
        {JUDGE.map((s, i) => (
          <li key={i} className="grid grid-cols-[2rem_1fr] gap-3 rounded-md border border-border bg-card p-3">
            <span className="num font-heading font-bold">{i + 1}</span>
            <span><span className="font-semibold">{s.title}</span></span>
          </li>
        ))}
      </ol>
      <div className="mt-8"><TrustRow /></div>
      <p className="mt-6 text-sm text-muted-foreground">Prefer to click around? <Link to="/login" className="underline">Choose a person</Link> or open the <Link to="/demo" className="underline">demo controls</Link>. Add <span className="mono">?tour=judge</span> to any page link to start the tour there.</p>
    </PublicShell>
  );
}
