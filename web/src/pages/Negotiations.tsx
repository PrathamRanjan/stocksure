import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { useView } from "@/lib/api";
import { day } from "@/lib/format";
import { Empty, ErrorBlock, LoadingBlock, PageHeader, Stamp } from "@/components/brand";
import { TalkMoves, type TalkModel } from "@/components/talk";

interface ListModel {
  negotiations: { id: string; kind: "quote" | "shortfall"; status: string; round: number; max_rounds: number; po: { id: string; number: string }; outcome: any; created_at: string }[];
  can_start: { id: string; number: string }[];
  ready: boolean;
  rules: { mandate: { ceiling_pct: number; goodwill_ask_pct: number }; floor: { floor_pct: number }; max_rounds: number };
}

export function NegotiationList() {
  const v = useView<ListModel>("/api/ui/negotiations");
  if (v.error) return <ErrorBlock message={v.error.message} retry={() => v.reload()} status={v.error.status} />;
  if (!v.data) return <LoadingBlock label="Loading negotiations" />;
  const d = v.data;
  return (
    <>
      <PageHeader title="Agent negotiations" sub="Two agents trade offers: the café's, inside the owner's mandate, and the wholesaler's, inside its floor. A referee in code checks every move. Nothing they agree is paid until both people approve it." />
      {d.can_start.length > 0 && (
        <section className="mb-6 rounded-lg border border-border bg-card p-4 text-sm" aria-labelledby="start-title">
          <h2 id="start-title" className="mb-1 text-lg">Shortfalls waiting for a fix</h2>
          <p className="mb-2 text-muted-foreground">Open the order and choose “Send the agents in”.</p>
          <ul className="flex flex-wrap gap-2">
            {d.can_start.map((o) => (
              <li key={o.id}><Link className="rounded-md border border-input px-2.5 py-1.5 hover:border-foreground" to={`/po/${o.id}#agents`}>{o.number}</Link></li>
            ))}
          </ul>
        </section>
      )}
      {!d.negotiations.length ? (
        <Empty title="No negotiations yet">When an order arrives short, the owner can send the agents in from the order page.</Empty>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border" tabIndex={0} role="region" aria-label="Negotiations">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-border text-left"><th className="p-3">Order</th><th className="p-3">About</th><th className="p-3">Status</th><th className="p-3">Rounds</th><th className="p-3">Outcome</th><th className="p-3">Started</th></tr></thead>
            <tbody>
              {d.negotiations.map((n) => (
                <tr key={n.id} className="border-b border-border last:border-0">
                  <td className="p-3"><Link className="font-semibold underline underline-offset-2" to={`/negotiations/${n.id}`}>{n.po.number}</Link></td>
                  <td className="p-3">{n.kind === "shortfall" ? "A shortfall" : "A quote"}</td>
                  <td className="p-3"><Stamp tone={n.status === "agreed" ? "paid" : n.status === "open" ? "held" : "quiet"}>{n.status.replace(/_/g, " ")}</Stamp></td>
                  <td className="p-3">{n.round} of {n.max_rounds}</td>
                  <td className="p-3">{n.outcome?.terms ?? n.outcome?.note ?? "—"}</td>
                  <td className="p-3">{day(n.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

export function NegotiationDetail() {
  const { id } = useParams();
  const [poll, setPoll] = useState<number | false>(false);
  const v = useView<TalkModel>(id ? `/api/ui/negotiations/${id}` : null, { poll });
  const status = v.data?.status;
  useEffect(() => setPoll(status === "open" ? 1500 : false), [status]);
  if (v.error) return <ErrorBlock message={v.error.message} retry={() => v.reload()} status={v.error.status} />;
  if (!v.data) return <LoadingBlock label="Loading the negotiation" />;
  const t = v.data;
  return (
    <>
      <PageHeader back={{ to: "/negotiations", label: "Negotiations" }} title={`${t.po.number}: ${t.kind === "shortfall" ? "settling a shortfall" : "negotiating a quote"}`} sub={<>{t.agents.buyer} for {t.po.buyer ?? "the café"} · {t.agents.supplier} for {t.po.supplier ?? "the wholesaler"} · <Link className="underline underline-offset-2" to={`/po/${t.po.id}#resolution`}>open the order</Link></>} />
      {t.kind === "shortfall" ? (
        <TalkMoves t={t} />
      ) : (
        <ol className="space-y-2 text-sm">
          {t.moves.map((m, i) => (
            <li key={i} className="rounded-md border border-border p-3"><b>Round {m.round} · {m.side}</b> {m.message} <span className="text-muted-foreground">({m.allowed ? "within the rules" : `adjusted: ${m.reasons.join("; ")}`})</span></li>
          ))}
        </ol>
      )}
    </>
  );
}
