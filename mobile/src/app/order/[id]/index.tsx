import { useLocalSearchParams } from "expo-router";
import Stack from "expo-router/stack";
import { useEffect, useRef, useState } from "react";
import { RefreshControl, ScrollView, View, type ScrollViewInstance } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ApprovalCard } from "@/components/approval";
import { useHomeBack } from "@/components/home-back";
import { Activity, DocsPanel, Lines, Messages, MoneyPanel, PayPalPanel, Related, ResolutionPanel } from "@/components/order/panels";
import { MOVING, NextStep } from "@/components/order/next-step";
import { Stamp, StatusStamp } from "@/components/stamp";
import { ErrorState, Loading } from "@/components/states";
import { Txt } from "@/components/text";
import { useTheme } from "@/components/theme";
import { TrustRow } from "@/components/trust";
import { useView } from "@/lib/api";
import { day, money } from "@/lib/format";
import { space } from "@/lib/theme";
import type { PoModel } from "@/lib/types";

export default function Order() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { p } = useTheme();
  const insets = useSafeAreaInsets();
  const [poll, setPoll] = useState<number | false>(false);
  const v = useView<PoModel>(`/api/ui/po/${id}`, { poll });
  const scroll = useRef<ScrollViewInstance>(null);
  const at = useRef<Record<string, number>>({});
  const m = v.data;
  const headerLeft = useHomeBack();
  const moving = !!m && (MOVING.includes(m.po.status) || m.ops.some((o) => o.status === "pending"));
  useEffect(() => setPoll(moving ? 3000 : false), [moving]);
  const reload = () => v.reload("quiet");
  const mark = (k: string) => ({ onLayout: (e: { nativeEvent: { layout: { y: number } } }) => (at.current[k] = e.nativeEvent.layout.y) });
  const jump = (k: string) => scroll.current?.scrollTo({ y: Math.max(0, (at.current[k] ?? 0) - 8), animated: true });

  return (
    <>
      <Stack.Screen options={{ title: m?.po.number ?? "Order", headerLeft }} />
      <ScrollView
        ref={scroll}
        style={{ flex: 1, backgroundColor: p.paper }}
        contentContainerStyle={{ padding: space.lg, paddingBottom: insets.bottom + 40 }}
        refreshControl={<RefreshControl refreshing={v.refreshing} onRefresh={() => v.reload("pull")} tintColor={p.ink2} />}
      >
        <View style={{ width: "100%", maxWidth: 720, alignSelf: "center", gap: space.lg }}>
          {v.error && !m ? <ErrorState message={v.error.message} status={v.error.status} retry={() => v.reload()} /> : null}
          {!m && !v.error ? <Loading label="Loading the order" /> : null}
          {m && (
            <>
              <View style={{ gap: 8 }}>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                  <StatusStamp status={m.po.status} animate />
                  {m.po.kind === "replacement" && <Stamp tone="carbon">Replacement</Stamp>}
                  {moving && <Stamp tone="held">PayPal working</Stamp>}
                </View>
                <Txt v="display" accessibilityRole="header" style={{ fontVariant: ["tabular-nums"] }}>{m.po.number}</Txt>
                <Txt muted>
                  {m.me.side === "buyer" ? m.po.supplier_name : m.po.buyer_name} · deliver by {day(m.po.deliver_by)} · limit {money(m.po.limit_cents)}
                </Txt>
              </View>
              <Related m={m} />
              <NextStep m={m} reload={reload} jump={jump} />
              {m.approvals.map((a) => <ApprovalCard key={a.id} a={a} onDone={reload} showOrder={false} />)}
              <View {...mark("lines")}><Lines m={m} reload={reload} /></View>
              <MoneyPanel m={m} />
              <View {...mark("resolution")}><ResolutionPanel m={m} reload={reload} /></View>
              <PayPalPanel m={m} reload={reload} />
              <DocsPanel m={m} />
              <Messages m={m} reload={reload} />
              <TrustRow dense />
              <Activity m={m} />
              {v.error ? <Txt v="small" color={p.stop}>Couldn't refresh: {v.error.message}</Txt> : null}
            </>
          )}
        </View>
      </ScrollView>
    </>
  );
}
