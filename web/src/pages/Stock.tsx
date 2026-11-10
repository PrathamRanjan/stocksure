import { Link } from "react-router";
import { useView } from "@/lib/api";
import { ago, when } from "@/lib/format";
import { Empty, ErrorBlock, LoadingBlock, PageHeader, SectionTitle } from "@/components/brand";

interface StockData {
  stock: { product: { id: string; sku: string; name: string; pack_label: string }; units: number; text: string; last: string | null }[];
  moves: { id: number; at: string; sku: string; delta: number; text: string; reason: string; po_id: string | null; po_number: string | null }[];
}

export default function Stock() {
  const v = useView<StockData>("/api/ui/stock");
  if (v.error) return <ErrorBlock message={v.error.message} retry={() => v.reload()} status={v.error.status} />;
  if (!v.data) return <LoadingBlock label="Loading stock" />;
  const d = v.data;
  return (
    <>
      <PageHeader title="Stock" sub="What's on your shelves, from confirmed counts only. Ordered isn't stock until it's counted in." />
      {d.stock.length ? (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {d.stock.map((s) => (
            <li key={s.product.id} className="rounded-lg border border-border bg-card p-4">
              <p className="font-semibold">{s.product.name}</p>
              <p className="mono text-xs text-muted-foreground">{s.product.sku}</p>
              <p className="num mt-2 font-heading text-2xl font-bold">{s.text}</p>
              <p className="text-sm text-muted-foreground">{s.last ? `updated ${ago(s.last)}` : "no moves yet"}</p>
            </li>
          ))}
        </ul>
      ) : (
        <Empty title="No stock recorded">Stock appears after the first delivery is counted in.</Empty>
      )}
      <SectionTitle>Recent moves</SectionTitle>
      {d.moves.length ? (
        <div className="overflow-x-auto rounded-lg border border-border bg-card focus-visible:outline-2 focus-visible:outline-ring" tabIndex={0} role="region" aria-label="Recent stock moves, scrolls sideways">
          <table className="w-full min-w-[32rem] text-sm">
            <caption className="sr-only">Recent stock moves</caption>
            <thead className="text-left text-muted-foreground">
              <tr className="border-b border-border">
                <th scope="col" className="px-4 py-2.5 font-semibold">When</th>
                <th scope="col" className="px-4 py-2.5 font-semibold">Item</th>
                <th scope="col" className="px-4 py-2.5 text-right font-semibold">Change</th>
                <th scope="col" className="px-4 py-2.5 font-semibold">Why</th>
              </tr>
            </thead>
            <tbody>
              {d.moves.map((m) => (
                <tr key={m.id} className="border-b border-dashed border-input last:border-0">
                  <td className="num px-4 py-2.5">{when(m.at)}</td>
                  <td className="mono px-4 py-2.5">{m.sku}</td>
                  <td className={`num px-4 py-2.5 text-right font-semibold ${m.delta < 0 ? "text-stop" : ""}`}>{m.text}</td>
                  <td className="px-4 py-2.5">{m.reason}{m.po_id && <> · <Link to={`/po/${m.po_id}`} className="underline">{m.po_number}</Link></>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-muted-foreground">No moves yet.</p>
      )}
    </>
  );
}
