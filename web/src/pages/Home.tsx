import { Link } from "react-router";
import { AlertTriangle, ArrowRight, BadgeCheck, Clock, Link2, Plus } from "lucide-react";
import { useView } from "@/lib/api";
import { day, money, plural } from "@/lib/format";
import { useSession } from "@/lib/session";
import { useAction } from "@/lib/useAction";
import { Button } from "@/components/ui/button";
import { Empty, ErrorBlock, LoadingBlock, PageHeader, SectionTitle, Spinner, Stamp, StatusStamp, Tally, TallyLegend, type TallyNums } from "@/components/brand";

export interface OrderCardData {
  id: string;
  number: string;
  kind: string;
  status: string;
  buyer: string;
  history: boolean;
  late: boolean;
  needs_you: boolean;
  next: string | null;
  total_cents: number | null;
  limit_cents: number | null;
  deliver_by: string;
  note: string;
  lines: { sku: string; name: string; qty_packs: number; pack_label: string; tally: TallyNums }[];
  moving: boolean;
}
export interface ApprovalRow {
  id: string;
  action: string;
  cents: number;
  po_id: string | null;
  po_number: string | null;
  supplier: string | null;
  safety_reasons: string[];
  reasons: string[];
  needs_passkey: boolean;
  created_at: string;
}
interface HomeData {
  org: { name: string; side: "buyer" | "supplier"; paypal_connected: boolean; payer: string | null };
  can_create: boolean;
  can_connect: boolean;
  approvals: ApprovalRow[];
  orders: OrderCardData[];
}

function OrderCard({ o, supplierView, tour }: { o: OrderCardData; supplierView: boolean; tour?: boolean }) {
  return (
    <li data-tour={tour ? "order-card" : undefined}>
      <Link
        to={`/po/${o.id}`}
        className="group block rounded-lg border border-border bg-card p-4 transition-colors hover:border-foreground focus-visible:border-foreground sm:p-5"
        aria-label={`${o.number}, ${o.kind === "replacement" ? "replacement, " : ""}${supplierView ? `for ${o.buyer}` : ""}. ${o.next ?? ""}`}
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-heading text-lg font-bold">{o.number}</span>
          {o.kind === "replacement" && <Stamp tone="carbon">Replacement</Stamp>}
          <StatusStamp status={o.status} />
          {o.late && <Stamp tone="stop"><Clock className="size-3" aria-hidden="true" /> Running late</Stamp>}
          {o.moving && <Stamp tone="held"><Spinner className="size-3" /> PayPal working</Stamp>}
          <span className="ml-auto num text-sm text-muted-foreground">{o.total_cents ? money(o.total_cents) : "not quoted"}</span>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {supplierView ? `${o.buyer} · ` : ""}deliver by {day(o.deliver_by)}
          {o.limit_cents ? ` · limit ${money(o.limit_cents)}` : ""}
        </p>
        <ul className="mt-3 space-y-1.5">
          {o.lines.map((l) => (
            <li key={l.sku} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
              <span className="min-w-0 truncate text-[0.95rem]">
                {l.qty_packs} × {l.name}
              </span>
              <Tally t={l.tally} size="sm" label={l.name} />
            </li>
          ))}
        </ul>
        {o.next && o.needs_you && (
          <p className="mt-3 flex items-center gap-2 border-t border-dashed border-input pt-3 font-semibold">
            <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden="true" /> {o.next}
          </p>
        )}
      </Link>
    </li>
  );
}

export default function Home() {
  const { session } = useSession();
  const v = useView<HomeData>("/api/ui/home", { poll: 8000 });
  const { run, busy } = useAction(() => v.reload(true));
  if (v.error && !v.data) return <ErrorBlock message={v.error.message} retry={() => v.reload()} status={v.error.status} />;
  if (!v.data) return <LoadingBlock label="Loading orders" />;
  const d = v.data;
  const supplierView = d.org.side === "supplier";
  const live = d.orders.filter((o) => !o.history);
  const needs = live.filter((o) => o.needs_you);
  const rest = live.filter((o) => !o.needs_you);
  const history = d.orders.filter((o) => o.history);
  const role = session?.who?.role;

  return (
    <>
      <PageHeader
        title={supplierView ? "Orders from your buyers" : role === "receiving" ? "Deliveries" : "Orders"}
        sub={<>{d.org.name}{d.orders.length ? ` · ${plural(live.length, "order")}` : ""}</>}
        actions={
          d.can_create && (
            <Button asChild>
              <Link to="/po/new"><Plus aria-hidden="true" /> New order</Link>
            </Button>
          )
        }
      />

      {d.can_connect && !d.org.paypal_connected && (
        <div className="mb-6 flex flex-col gap-3 rounded-lg border-2 border-held bg-held-soft p-4 sm:flex-row sm:items-center">
          <div className="flex-1">
            <p className="font-heading text-lg font-bold">Connect PayPal to place holds</p>
            <p className="text-sm">You approve once on PayPal. After that, each accepted quote places a hold for exactly the quote, and nothing is charged until a delivery is agreed.</p>
          </div>
          <Button variant="carbon" disabled={busy === "connect"} onClick={() => run("connect", "/connect-paypal")}>
            {busy === "connect" ? <Spinner /> : <Link2 aria-hidden="true" />} Connect PayPal (sandbox)
          </Button>
        </div>
      )}
      {d.can_connect && d.org.paypal_connected && (
        <p className="mb-5 flex items-center gap-2 text-sm text-muted-foreground">
          <Stamp tone="paid">PayPal connected</Stamp> {d.org.payer ? `as ${d.org.payer}` : ""} · sandbox
        </p>
      )}

      {d.approvals.length > 0 && (
        <Link to="/approvals" className="mb-6 flex items-center gap-3 rounded-lg border-2 border-foreground bg-card p-4 hover:bg-accent">
          <BadgeCheck className="size-6 shrink-0" aria-hidden="true" />
          <span className="flex-1">
            <span className="block font-heading text-lg font-bold">{plural(d.approvals.length, "payment")} waiting for you</span>
            <span className="text-sm text-muted-foreground">
              {d.approvals.map((a) => `${a.action} ${money(a.cents)}${a.po_number ? ` on ${a.po_number}` : ""}`).join(" · ")}
            </span>
          </span>
          <ArrowRight aria-hidden="true" />
        </Link>
      )}

      <section aria-labelledby="needs-title" data-tour="needs">
        <SectionTitle id="needs-title" aside={needs.length ? plural(needs.length, "order") : undefined}>
          Needs you
        </SectionTitle>
        {needs.length ? (
          <ul className="grid gap-3 lg:grid-cols-2">
            {needs.map((o, i) => <OrderCard key={o.id} o={o} supplierView={supplierView} tour={i === 0} />)}
          </ul>
        ) : (
          <Empty title={live.length ? "Nothing needs you right now" : "No orders yet"}>
            {live.length ? "Everything below is waiting on someone else or already settled." : d.can_create ? "Start one from your supplier's catalog. A PayPal hold is placed only when you accept the quote." : supplierView ? "Orders appear here when a buyer sends one for a quote." : "Deliveries appear here once the owner orders."}
            {!live.length && session?.demo && <> In the demo, <Link to="/demo" className="font-semibold underline">reset the data</Link> to load the scripted order.</>}
          </Empty>
        )}
      </section>

      {rest.length > 0 && (
        <section aria-labelledby="rest-title">
          <SectionTitle id="rest-title" aside={plural(rest.length, "order")}>Everything else</SectionTitle>
          <ul className="grid gap-3 lg:grid-cols-2">
            {rest.map((o, i) => <OrderCard key={o.id} o={o} supplierView={supplierView} tour={!needs.length && i === 0} />)}
          </ul>
        </section>
      )}

      {live.some((o) => o.lines.some((l) => l.tally.accepted !== null)) && <TallyLegend className="mt-4" />}

      {history.length > 0 && (
        <details className="mt-8 rounded-lg border border-border bg-card px-4">
          <summary className="flex min-h-12 cursor-pointer items-center font-semibold">Imported history ({history.length} orders)</summary>
          <p className="text-sm text-muted-foreground">Past deliveries loaded for the supplier record. They're read-only.</p>
          <ul className="grid gap-2 py-4 lg:grid-cols-2">
            {history.map((o) => <OrderCard key={o.id} o={o} supplierView={supplierView} />)}
          </ul>
        </details>
      )}
      {v.error && v.data && (
        <p role="status" className="mt-4 flex items-center gap-2 text-sm text-stop"><AlertTriangle className="size-4" aria-hidden="true" /> Couldn't refresh: {v.error.message}</p>
      )}
    </>
  );
}
