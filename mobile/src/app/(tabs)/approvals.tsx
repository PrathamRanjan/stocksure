import { BadgeCheck, Settings2 } from "lucide-react-native";
import { View } from "react-native";
import { ApprovalCard } from "@/components/approval";
import { Button } from "@/components/button";
import { Masthead } from "@/components/masthead";
import { Empty, ErrorState, Loading, Screen } from "@/components/states";
import { Txt } from "@/components/text";
import { useTheme } from "@/components/theme";
import { useView } from "@/lib/api";
import { money } from "@/lib/format";
import { useSession } from "@/lib/session";
import type { ApprovalRow } from "@/lib/types";
import { openWeb } from "@/lib/useAction";

export default function Approvals() {
  const { p } = useTheme();
  const { session, refresh } = useSession();
  const v = useView<{ approvals: ApprovalRow[]; threshold_cents: number }>("/api/ui/approvals", { poll: 10000 });
  const owner = session?.who?.owner;
  return (
    <Screen top bottom={110} refreshing={v.refreshing} onRefresh={() => v.reload("pull")}>
      <Masthead
        title="Approvals"
        sub={v.data ? <Txt muted>Payments held for you. Anything above your spending rule, or flagged by the scam check, waits here. Above <Txt muted style={{ fontVariant: ["tabular-nums"] }}>{money(v.data.threshold_cents)}</Txt> it also needs your passkey.</Txt> : undefined}
      />
      {session?.who && !owner ? (
        <Empty title="Approvals are the owner's">Only the café owner approves held payments.</Empty>
      ) : v.error && !v.data ? (
        <ErrorState message={v.error.message} status={v.error.status} retry={() => v.reload()} />
      ) : !v.data ? (
        <Loading label="Loading approvals" cards={2} />
      ) : (
        <View style={{ gap: 14 }}>
          {v.data.approvals.length ? (
            v.data.approvals.map((a) => (
              <ApprovalCard
                key={a.id}
                a={a}
                onDone={() => {
                  v.reload("quiet");
                  void refresh();
                }}
              />
            ))
          ) : (
            <Empty title="Nothing waiting" art={<BadgeCheck size={30} color={p.ink2} />}>
              Payments inside your rules go ahead by themselves once both sides agree a delivery. Anything else shows up here first.
            </Empty>
          )}
          <Button variant="ghost" icon={Settings2} onPress={() => void openWeb("/guard")}>Spending rules</Button>
        </View>
      )}
    </Screen>
  );
}
