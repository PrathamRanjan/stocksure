import { useState } from "react";
import { useView } from "@/lib/api";
import { money } from "@/lib/format";
import { useAction } from "@/lib/useAction";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Empty, ErrorBlock, LoadingBlock, PageHeader, Spinner } from "@/components/brand";

interface Product { id: string; sku: string; name: string; family: string; pack_label: string; pack_units: number; base_unit: string; price_cents: number; stock_packs: number; lead_hours: number }
interface CatData { supplier: { id: string; name: string } | null; can_edit: boolean; products: Product[] }

function Row({ p, edit, reload }: { p: Product; edit: boolean; reload: () => void }) {
  const { run, busy } = useAction(reload);
  const [price, setPrice] = useState((p.price_cents / 100).toFixed(2));
  const [stock, setStock] = useState(String(p.stock_packs));
  const dirty = price !== (p.price_cents / 100).toFixed(2) || stock !== String(p.stock_packs);
  return (
    <li className="grid gap-2 rounded-lg border border-border bg-card p-4 sm:grid-cols-[1fr_auto] sm:items-center">
      <div className="min-w-0">
        <p className="font-semibold">{p.name}</p>
        <p className="text-sm text-muted-foreground"><span className="mono">{p.sku}</span> · {p.pack_label} ({p.pack_units} {p.base_unit}) · lead time {p.lead_hours} h</p>
      </div>
      {edit ? (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void run("save", `/catalog/${p.id}`, { price, stock }, { stay: true });
          }}
        >
          <label className="grid gap-1 text-sm">Price ($)<Input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" className="num w-28 text-right" /></label>
          <label className="grid gap-1 text-sm">In stock<Input value={stock} onChange={(e) => setStock(e.target.value)} inputMode="numeric" className="num w-24 text-right" /></label>
          <Button type="submit" variant="outline" disabled={!dirty || !!busy}>{busy && <Spinner />} Save</Button>
        </form>
      ) : (
        <p className="text-right"><span className="num font-heading text-lg font-bold">{money(p.price_cents)}</span><span className="block text-sm text-muted-foreground">{p.stock_packs} in stock</span></p>
      )}
    </li>
  );
}

export default function Catalog() {
  const v = useView<CatData>("/api/ui/catalog");
  if (v.error) return <ErrorBlock message={v.error.message} retry={() => v.reload()} status={v.error.status} />;
  if (!v.data) return <LoadingBlock label="Loading the catalog" />;
  const d = v.data;
  return (
    <>
      <PageHeader title="Catalog" sub={<>{d.supplier?.name ?? "No supplier"} · {d.can_edit ? "Changes apply to new quotes; open quotes keep their prices." : "Prices and stock as the supplier last set them."}</>} />
      {d.products.length ? (
        <ul className="grid gap-3">{d.products.map((p) => <Row key={p.id} p={p} edit={d.can_edit} reload={() => v.reload(true)} />)}</ul>
      ) : (
        <Empty title="No products">The supplier hasn't listed anything yet.</Empty>
      )}
    </>
  );
}
