import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { useView } from "@/lib/api";
import { money } from "@/lib/format";
import { useAction } from "@/lib/useAction";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ErrorBlock, LoadingBlock, PageHeader, Spinner } from "@/components/brand";
import { localInput, toUtcInput } from "./order/sections";

interface Product { id: string; sku: string; name: string; family: string; pack_label: string; pack_units: number; price_cents: number; stock_packs: number; lead_hours: number }
interface NewData { suppliers: { id: string; name: string; catalog: Product[] }[]; default_deliver_by: string }
interface LineIn { product: string; qty: string; replace: boolean; subs: string[] }

const blank = (): LineIn => ({ product: "", qty: "1", replace: true, subs: [] });
const select = "min-h-11 w-full rounded-md border border-input bg-card px-3 text-base sm:text-sm";

export default function NewOrder() {
  const v = useView<NewData>("/api/ui/po-new");
  const { run, busy } = useAction();
  const [sup, setSup] = useState("");
  const [lines, setLines] = useState<LineIn[]>([blank()]);
  const [by, setBy] = useState(localInput(new Date(Date.now() + 864e5)));
  const [limit, setLimit] = useState("");
  const [note, setNote] = useState("");
  useEffect(() => {
    if (v.data && !sup) setSup(v.data.suppliers[0]?.id ?? "");
  }, [v.data, sup]);
  if (v.error) return <ErrorBlock message={v.error.message} retry={() => v.reload()} status={v.error.status} />;
  if (!v.data) return <LoadingBlock />;
  const cat = v.data.suppliers.find((s) => s.id === sup)?.catalog ?? [];
  const P = (id: string) => cat.find((p) => p.id === id);
  const est = lines.reduce((a, l) => a + (P(l.product)?.price_cents ?? 0) * (Number(l.qty) || 0), 0);
  const lim = Math.round(Number(limit) * 100);
  const upd = (i: number, x: Partial<LineIn>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...x } : l)));

  return (
    <>
      <PageHeader back={{ to: "/home", label: "Orders" }} title="New order" sub="A draft first. Nothing is held or charged until you accept the supplier's quote." />
      <form
        className="grid max-w-3xl gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          const data: Record<string, string | string[]> = { supplier_id: sup, deliver_by: toUtcInput(by), limit, note };
          lines.forEach((l, i) => {
            if (!l.product) return;
            data[`product_${i}`] = l.product;
            data[`qty_${i}`] = l.qty;
            if (l.replace) data[`replace_${i}`] = "1";
            if (l.subs.length) data[`subs_${i}`] = l.subs;
          });
          void run("create", "/po/new", data);
        }}
      >
        <div className="grid gap-1.5">
          <Label htmlFor="sup">Supplier</Label>
          <select id="sup" className={select} value={sup} onChange={(e) => { setSup(e.target.value); setLines([blank()]); }}>
            {v.data.suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>

        <fieldset className="grid gap-3">
          <legend className="mb-2 font-heading text-lg font-bold">What you need</legend>
          {lines.map((l, i) => {
            const p = P(l.product);
            return (
              <div key={i} className="grid gap-3 rounded-lg border border-border bg-card p-4">
                <div className="grid gap-3 sm:grid-cols-[1fr_7rem]">
                  <div className="grid gap-1.5">
                    <Label htmlFor={`prod-${i}`}>Item {i + 1}</Label>
                    <select id={`prod-${i}`} className={select} value={l.product} onChange={(e) => upd(i, { product: e.target.value, subs: [] })} required={i === 0}>
                      <option value="">Choose…</option>
                      {cat.map((c) => <option key={c.id} value={c.id}>{c.name} · {money(c.price_cents)} per {c.pack_label} · {c.stock_packs} in stock</option>)}
                    </select>
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor={`qty-${i}`}>Packs</Label>
                    <Input id={`qty-${i}`} inputMode="numeric" value={l.qty} onChange={(e) => upd(i, { qty: e.target.value })} className="num" required={!!l.product} />
                  </div>
                </div>
                {p && (
                  <>
                    <label className="flex min-h-11 items-center gap-2">
                      <input type="checkbox" className="size-5" checked={l.replace} onChange={(e) => upd(i, { replace: e.target.checked })} />
                      If any arrive short or damaged, send a replacement (otherwise credit it)
                    </label>
                    {cat.filter((c) => c.family === p.family && c.id !== p.id).length > 0 && (
                      <fieldset>
                        <legend className="text-sm font-semibold">Acceptable substitutes for a replacement</legend>
                        <div className="mt-1 flex flex-wrap gap-2">
                          {cat.filter((c) => c.family === p.family && c.id !== p.id).map((c) => (
                            <label key={c.id} className="flex min-h-11 items-center gap-2 rounded-md border border-input px-3 text-sm">
                              <input type="checkbox" checked={l.subs.includes(c.id)} onChange={(e) => upd(i, { subs: e.target.checked ? [...l.subs, c.id] : l.subs.filter((x) => x !== c.id) })} />
                              {c.name}
                            </label>
                          ))}
                        </div>
                      </fieldset>
                    )}
                  </>
                )}
                {lines.length > 1 && (
                  <Button type="button" variant="ghost" size="sm" className="w-fit" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}>
                    <Trash2 aria-hidden="true" /> Remove item {i + 1}
                  </Button>
                )}
              </div>
            );
          })}
          {lines.length < 3 && (
            <Button type="button" variant="outline" className="w-fit" onClick={() => setLines((ls) => [...ls, blank()])}>
              <Plus aria-hidden="true" /> Add an item
            </Button>
          )}
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="by">Deliver by (your time)</Label>
            <Input id="by" type="datetime-local" value={by} onChange={(e) => setBy(e.target.value)} required />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="lim">Spending limit for this order and any replacement</Label>
            <div className="flex items-center gap-1.5"><span aria-hidden="true">$</span><Input id="lim" inputMode="decimal" value={limit} onChange={(e) => setLimit(e.target.value)} placeholder={est ? (Math.ceil((est * 1.25) / 100)).toFixed(2) : "200.00"} required className="num" aria-describedby="lim-help" /></div>
            <p id="lim-help" className="text-sm text-muted-foreground">StockSure never holds or charges more than this, replacements included.</p>
          </div>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="note">Note to the supplier (optional)</Label>
          <Textarea id="note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
        </div>
        <div className="sticky bottom-20 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card p-4 lg:bottom-4">
          <p>
            Catalog estimate <span className="num font-heading text-xl font-bold">{money(est)}</span>
            {lim > 0 && est > lim && <span className="block text-sm text-stop">Above your limit: the quote couldn't be accepted.</span>}
          </p>
          <Button type="submit" size="lg" disabled={!!busy || !sup}>{busy === "create" && <Spinner />} Save draft</Button>
        </div>
      </form>
    </>
  );
}
