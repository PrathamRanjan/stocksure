import { Link } from "react-router";
import { ShieldCheck } from "lucide-react";
import { useView } from "@/lib/api";

interface Item { po_id?: string | null; po_number?: string | null; amount: string; why: string; paypal?: { kind: string; id: string; amount: string }[]; invoice?: string; status?: string }
interface Row { key: string; title: string; amount: string; cents: number; items: Item[]; in_total: boolean; note?: string }
interface Protected { month: string; total: string; total_cents: number; rows: Row[]; basis: string }

/** Spec B4/A9: the café's home leads with what StockSure kept from being paid this month, each figure traceable. */
export function ProtectedThisMonth() {
  const v = useView<Protected>("/api/ui/protected", { poll: 15000 });
  if (!v.data) return null;
  const d = v.data;
  const any = d.rows.some((r) => r.items.length);
  return (
    <section aria-labelledby="protected-title" data-protected className="mb-6 rounded-lg border-2 border-foreground bg-card p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <ShieldCheck className="size-6 shrink-0 self-center" aria-hidden="true" />
        <h2 id="protected-title" className="font-heading text-lg font-bold">Protected this month</h2>
        <span className="num ml-auto font-heading text-2xl font-bold" data-protected-total>{d.total}</span>
      </div>
      {!any ? (
        <p className="mt-2 text-sm text-muted-foreground">Nothing yet this month. When a delivery is short, an invoice overbills, a payment looks like a scam or an early discount is taken, it is counted here with the order and PayPal ids.</p>
      ) : (
        <ul className="mt-3 divide-y divide-dashed divide-input">
          {d.rows.filter((r) => r.items.length).map((r) => (
            <li key={r.key} className="py-2" data-protected-row={r.key}>
              <details>
                <summary className="flex min-h-11 cursor-pointer flex-wrap items-center gap-x-3">
                  <span className="flex-1 font-semibold">{r.title} <span className="font-normal text-muted-foreground">({r.items.length})</span></span>
                  <span className="num">{r.amount}{r.in_total ? "" : " *"}</span>
                </summary>
                {r.note && <p className="mt-1 text-sm text-muted-foreground">* {r.note}</p>}
                <ul className="mt-2 space-y-2 text-sm">
                  {r.items.map((it, i) => (
                    <li key={i} className="rounded border border-border p-2">
                      <span className="num font-semibold">{it.amount}</span>
                      {it.po_id && <> on <Link className="font-semibold underline" to={`/po/${it.po_id}`}>{it.po_number ?? "the order"}</Link></>}
                      {it.invoice && <> · invoice {it.invoice}</>}
                      {it.status && <> · {it.status}</>}
                      <span className="block text-muted-foreground">{it.why}</span>
                      {!!it.paypal?.length && <span className="block break-all font-mono text-xs">{it.paypal.map((p) => `${p.kind} ${p.id} (${p.amount})`).join(" · ")}</span>}
                    </li>
                  ))}
                </ul>
              </details>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-xs text-muted-foreground">{d.basis}</p>
    </section>
  );
}
