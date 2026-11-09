import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { toast } from "sonner";
import { ArrowRight, KeyRound } from "lucide-react";
import { act, useView } from "@/lib/api";
import { useSession } from "@/lib/session";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PublicShell } from "@/components/public-shell";
import { ErrorBlock, Spinner, Stamp } from "@/components/brand";

interface Person {
  id: string;
  name: string;
  first: string;
  role: string;
  org: string;
  side: "buyer" | "supplier";
  job: string;
  tag: string;
}

const safeNext = (n: string | null) => (n && n.startsWith("/") && !n.startsWith("//") ? n : "/home");

export default function Login() {
  const [q] = useSearchParams();
  const next = safeNext(q.get("next"));
  const nav = useNavigate();
  const { refresh, session } = useSession();
  const people = useView<{ people: Person[] }>("/api/ui/people");
  const [busy, setBusy] = useState<string | null>(null);
  const [key, setKey] = useState("");

  async function go(data: Record<string, string>, k: string) {
    setBusy(k);
    const r = await act("/login", { ...data, next });
    setBusy(null);
    if (!r.ok) return toast.error(r.message || "That didn't work.");
    refresh();
    nav(r.to ?? next);
  }

  const main = (people.data?.people ?? []).filter((p) => ["Jordan", "Sam", "Ana"].includes(p.first));
  const more = (people.data?.people ?? []).filter((p) => !["Jordan", "Sam", "Ana"].includes(p.first));

  return (
    <PublicShell>
      <h1 className="text-4xl">Sign in</h1>
      <p className="mt-2 text-muted-foreground">
        {session?.who ? <>You're signed in as {session.who.name}. Pick someone else to switch.</> : <>This is a demo: pick a person to see StockSure from their side. No password needed.</>}
      </p>

      {people.error && <div className="mt-6"><ErrorBlock message={people.error.message} retry={() => people.reload()} status={people.error.status} /></div>}

      {people.loading && !people.data && (
        <div className="mt-6 grid gap-3" role="status" aria-label="Loading people">
          {[0, 1, 2].map((i) => <div key={i} className="h-28 animate-pulse rounded-lg bg-muted" />)}
        </div>
      )}

      {people.data && !people.data.people.length && (
        <p className="mt-6 rounded-lg border border-dashed border-input p-5">Demo sign-in is off on this server. Use your access key below.</p>
      )}

      {main.length > 0 && (
        <ul className="mt-6 grid gap-3" data-tour="personas" aria-label="People in the demo">
          {main.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => go({ person_id: p.id }, p.id)}
                disabled={!!busy}
                className={cn(
                  "group flex w-full items-start gap-4 rounded-lg border border-border bg-card p-4 text-left transition-colors hover:border-foreground focus-visible:border-foreground disabled:opacity-60 sm:p-5",
                  session?.who?.id === p.id && "border-foreground border-2",
                )}
              >
                <span className="grid size-12 shrink-0 place-items-center rounded-md bg-foreground font-heading text-xl font-extrabold text-background" aria-hidden="true">
                  {p.first[0]}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-heading text-xl font-bold">{p.name}</span>
                    <Stamp tone={p.side === "supplier" ? "carbon" : p.role === "owner" ? "ink" : "quiet"}>{p.tag}</Stamp>
                  </span>
                  <span className="block text-sm font-semibold text-muted-foreground">{p.org}</span>
                  <span className="mt-1 block">{p.job}</span>
                </span>
                <span className="self-center">{busy === p.id ? <Spinner className="size-5" /> : <ArrowRight className="size-5 opacity-60 group-hover:opacity-100" aria-hidden="true" />}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {more.length > 0 && (
        <details className="mt-4 rounded-lg border border-border bg-card px-4">
          <summary className="flex min-h-12 cursor-pointer items-center font-semibold">Other people ({more.length}): a bakery and a deli on the same supplier</summary>
          <ul className="grid gap-2 pb-4">
            {more.map((p) => (
              <li key={p.id}>
                <button type="button" disabled={!!busy} onClick={() => go({ person_id: p.id }, p.id)} className="flex min-h-12 w-full items-center gap-3 rounded-md px-2 text-left hover:bg-accent">
                  <span className="font-semibold">{p.name}</span>
                  <span className="text-sm text-muted-foreground">{p.tag} · {p.org}</span>
                  {busy === p.id && <Spinner className="ml-auto" />}
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}

      <form
        className="mt-8 rounded-lg border border-border bg-card p-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (key.trim()) go({ key: key.trim() }, "key");
        }}
      >
        <Label htmlFor="key" className="flex items-center gap-2 text-base font-semibold"><KeyRound className="size-4" aria-hidden="true" /> Access key</Label>
        <p id="key-help" className="mt-1 text-sm text-muted-foreground">Outside the demo, each person signs in with the key their organisation gave them.</p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <Input id="key" name="key" type="password" autoComplete="current-password" aria-describedby="key-help" value={key} onChange={(e) => setKey(e.target.value)} className="a11y-skip" />
          <Button type="submit" variant="outline" disabled={!key.trim() || !!busy}>
            {busy === "key" && <Spinner />} Sign in with key
          </Button>
        </div>
      </form>
      <p className="mt-6 text-sm text-muted-foreground">
        Want the walk-through instead? <Link to="/judge" className="font-semibold text-foreground underline underline-offset-2">Judge mode</Link> signs you in and shows each step.
      </p>
    </PublicShell>
  );
}
