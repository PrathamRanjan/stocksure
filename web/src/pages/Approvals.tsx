import { BadgeCheck } from "lucide-react";
import { useView } from "@/lib/api";
import { money } from "@/lib/format";
import { useSession } from "@/lib/session";
import { Empty, ErrorBlock, LoadingBlock, PageHeader } from "@/components/brand";
import { ApprovalCard } from "@/components/approval";
import type { ApprovalRow } from "./Home";

export default function Approvals() {
  const { session } = useSession();
  const v = useView<{ approvals: ApprovalRow[]; threshold_cents: number }>("/api/ui/approvals", { poll: 10000 });
  if (session?.who && !session.who.owner) return <Empty title="Approvals are the owner's">Only the café owner approves held payments.</Empty>;
  if (v.error && !v.data) return <ErrorBlock message={v.error.message} retry={() => v.reload()} status={v.error.status} />;
  if (!v.data) return <LoadingBlock label="Loading approvals" />;
  return (
    <>
      <PageHeader
        title="Approvals"
        sub={<>Payments held for you. Anything above your spending rule, or flagged by the scam check, waits here. Above <span className="num">{money(v.data.threshold_cents)}</span> it also needs your passkey.</>}
        actions={<a href="/guard" className="inline-flex min-h-11 items-center font-semibold underline underline-offset-2">Spending rules</a>}
      />
      <div data-tour="approvals" className="grid max-w-3xl gap-4">
        {v.data.approvals.length ? (
          v.data.approvals.map((a) => <ApprovalCard key={a.id} a={a} onDone={() => v.reload(true)} />)
        ) : (
          <Empty title="Nothing waiting" art={<BadgeCheck className="mx-auto mb-2 size-8 opacity-60" aria-hidden="true" />}>
            Payments inside your rules go ahead by themselves once both sides agree a delivery. Anything else shows up here first.
          </Empty>
        )}
      </div>
    </>
  );
}
