import { useView } from "@/lib/api";
import { Empty, ErrorBlock, LoadingBlock, PageHeader } from "@/components/brand";

interface Row { scope: string; orders: number; on_time_pct: number | null; fill_rate_pct: number | null; damage_rate_pct: number | null; dispute_rate_pct: number | null; median_resolution_hours: number | null; invoice_accuracy_pct: number | null }

const METRICS: { k: keyof Row; l: string; unit: string; good: "high" | "low"; help: string }[] = [
  { k: "fill_rate_pct", l: "Fill rate", unit: "%", good: "high", help: "accepted ÷ ordered" },
  { k: "on_time_pct", l: "On time", unit: "%", good: "high", help: "dispatched by the deliver-by time" },
  { k: "damage_rate_pct", l: "Damaged", unit: "%", good: "low", help: "damaged ÷ ordered" },
  { k: "dispute_rate_pct", l: "Disputed", unit: "%", good: "low", help: "orders with a disputed line" },
  { k: "invoice_accuracy_pct", l: "Invoice accuracy", unit: "%", good: "high", help: "invoices with no mismatch" },
  { k: "median_resolution_hours", l: "Time to agree", unit: " h", good: "low", help: "median, count to agreement" },
];

export default function Performance() {
  const v = useView<{ supplier: { id: string; name: string } | null; rows: Row[] }>("/api/ui/performance");
  if (v.error) return <ErrorBlock message={v.error.message} retry={() => v.reload()} status={v.error.status} />;
  if (!v.data) return <LoadingBlock label="Loading the record" />;
  const d = v.data;
  return (
    <>
      <PageHeader title={d.supplier ? `${d.supplier.name}: delivery record` : "Supplier record"} sub="From recorded outcomes only: confirmed counts, agreed resolutions and invoices. No estimates." />
      {!d.rows.length ? (
        <Empty title="No deliveries recorded yet">The record builds up as deliveries are counted and agreed.</Empty>
      ) : (
        d.rows.map((r) => (
          <section key={r.scope} className="mb-6" aria-label={r.scope}>
            <h2 className="mb-3 text-xl">{r.scope} <span className="text-base font-normal text-muted-foreground">· {r.orders} deliveries</span></h2>
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
              {METRICS.map((m) => {
                const val = r[m.k] as number | null;
                return (
                  <div key={m.k} className="rounded-lg border border-border bg-card p-4">
                    <dt className="text-sm font-semibold">{m.l}</dt>
                    <dd className="num font-heading text-3xl font-extrabold">{val === null ? "—" : `${val}${m.unit}`}</dd>
                    {m.unit === "%" && val !== null && (
                      <dd className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true"><span className={`block h-full ${m.good === "high" ? "bg-foreground" : "bg-stop"}`} style={{ width: `${Math.min(100, val)}%` }} /></dd>
                    )}
                    <dd className="mt-1 text-xs text-muted-foreground">{m.help}</dd>
                  </div>
                );
              })}
            </dl>
          </section>
        ))
      )}
    </>
  );
}
