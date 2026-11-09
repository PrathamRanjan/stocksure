import { Link, useLocation } from "react-router";
import { ArrowRight, Fingerprint, ShieldAlert, Undo2 } from "lucide-react";
import { ago, money } from "@/lib/format";
import { useAction } from "@/lib/useAction";
import { Button } from "@/components/ui/button";
import { Spinner, Stamp } from "@/components/brand";
import type { ApprovalRow } from "@/pages/Home";

const VERB: Record<string, string> = { capture: "Charge", refund: "Refund", reauthorize: "Renew hold", authorize: "Place hold" };

/** One held payment: what moves, to whom, why it waited, and what each choice does. */
export function ApprovalCard({ a, onDone, showOrder = true }: { a: ApprovalRow; onDone: () => void; showOrder?: boolean }) {
  const loc = useLocation();
  const { run, busy } = useAction(onDone);
  const refund = a.action === "refund";
  const to = refund ? "back to your PayPal account" : `to ${a.supplier ?? "the supplier"}`;
  return (
    <article className="rounded-lg border-2 border-held bg-card p-4 sm:p-5" aria-label={`${VERB[a.action] ?? a.action} ${money(a.cents)} waiting for approval`}>
      <div className="flex flex-wrap items-center gap-2">
        <Stamp tone="held">Waiting for you</Stamp>
        {a.safety_reasons.length > 0 && <Stamp tone="stop"><ShieldAlert className="size-3" aria-hidden="true" /> Scam check</Stamp>}
        <span className="ml-auto text-sm text-muted-foreground">{ago(a.created_at)}</span>
      </div>
      <p className="mt-3 font-heading text-2xl font-extrabold">
        {VERB[a.action] ?? a.action} <span className="num">{money(a.cents)}</span>
      </p>
      <dl className="mt-2 grid gap-x-6 gap-y-2 text-[0.95rem] sm:grid-cols-[auto_1fr]">
        <dt className="font-semibold">What moves</dt>
        <dd>
          <span className="num">{money(a.cents)}</span> {refund ? "returned" : "captured from the PayPal hold"} {to}
          {showOrder && a.po_id && (
            <> · <Link to={`/po/${a.po_id}`} className="font-semibold underline underline-offset-2">{a.po_number}</Link></>
          )}
        </dd>
        <dt className="font-semibold">Why it waited</dt>
        <dd>
          <ul className="list-disc pl-5">
            {a.reasons.map((r) => <li key={r}>{r}</li>)}
          </ul>
        </dd>
        <dt className="font-semibold">If you decline</dt>
        <dd className="flex gap-1.5"><Undo2 className="mt-1 size-4 shrink-0" aria-hidden="true" /> Nothing moves and the PayPal hold stays in place. You can retry the payment from the order later, which asks you again.</dd>
        <dt className="font-semibold">If you approve</dt>
        <dd>PayPal runs it now with the same request id, so a retry can't charge twice. {refund ? "" : "A later problem with the goods is refunded to the same PayPal payment."}</dd>
      </dl>
      <div className="mt-4 flex flex-wrap gap-2">
        {a.needs_passkey ? (
          <Button asChild variant="carbon">
            <a href="/guard#approvals"><Fingerprint aria-hidden="true" /> Approve with passkey <ArrowRight aria-hidden="true" /></a>
          </Button>
        ) : (
          <Button variant="paid" disabled={!!busy} onClick={() => run("approve", `/guard/approvals/${a.id}/approve`, { next: loc.pathname }, { stay: true })}>
            {busy === "approve" && <Spinner />} Approve {money(a.cents)}
          </Button>
        )}
        <Button variant="outline" disabled={!!busy} onClick={() => run("decline", `/guard/approvals/${a.id}/decline`, { next: loc.pathname }, { stay: true })}>
          {busy === "decline" && <Spinner />} Decline
        </Button>
      </div>
      {a.needs_passkey && <p className="mt-2 text-sm text-muted-foreground">Amounts this size need your passkey. It opens on the Spending rules page and signs this exact payment.</p>}
    </article>
  );
}
