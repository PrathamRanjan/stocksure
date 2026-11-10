import { useRouter } from "expo-router";
import { ArrowRight, Clock } from "lucide-react-native";
import { Pressable, View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import { day, money } from "@/lib/format";
import { tap } from "@/lib/haptics";
import { radius, space } from "@/lib/theme";
import type { OrderCardData } from "@/lib/types";
import { Stamp, StatusStamp } from "./stamp";
import { Tally } from "./tally";
import { Txt } from "./text";
import { useTheme } from "./theme";

/** One order as a docket: number, state, money, and a tally strip per line. */
export function OrderCard({ o, supplierView }: { o: OrderCardData; supplierView: boolean }) {
  const { p, reduceMotion } = useTheme();
  const router = useRouter();
  const s = useSharedValue(1);
  const st = useAnimatedStyle(() => ({ transform: [{ scale: s.value }] }));
  const needs = o.needs_you && !!o.next;
  return (
    <Animated.View style={st}>
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${o.number}${o.kind === "replacement" ? ", replacement" : ""}${supplierView ? `, for ${o.buyer}` : ""}. ${o.total_cents ? money(o.total_cents) : "Not quoted"}. ${o.next ?? ""}`}
      onPress={() => {
        tap();
        router.push(`/order/${o.id}`);
      }}
      onPressIn={() => !reduceMotion && (s.value = withSpring(0.985, { damping: 20, stiffness: 400 }))}
      onPressOut={() => (s.value = withSpring(1))}
      style={({ pressed }: { pressed: boolean }) => [
        {
          backgroundColor: p.card,
          borderRadius: radius.lg,
          borderWidth: needs ? 2 : 1,
          borderColor: needs ? p.ink : pressed ? p.ink : p.rule,
          overflow: "hidden",
        },
      ]}
    >
      <View style={{ padding: space.lg, gap: 10 }}>
        <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
          <View style={{ flexShrink: 1, gap: 6 }}>
            <Txt v="h2" style={{ fontVariant: ["tabular-nums"] }}>{o.number}</Txt>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
              <StatusStamp status={o.status} />
              {o.kind === "replacement" && <Stamp tone="carbon">Replacement</Stamp>}
              {o.late && <Stamp tone="stop" icon={<Clock size={11} color={p.stop} />}>Running late</Stamp>}
              {o.moving && <Stamp tone="held">PayPal working</Stamp>}
            </View>
          </View>
          <View style={{ alignItems: "flex-end" }}>
            {o.total_cents ? <Txt v="num">{money(o.total_cents)}</Txt> : null}
            <Txt v="small" muted>{o.total_cents ? "quoted" : "not quoted yet"}</Txt>
          </View>
        </View>
        <Txt v="small" muted>
          {supplierView ? `${o.buyer} · ` : ""}deliver by {day(o.deliver_by)}
          {o.limit_cents ? ` · limit ${money(o.limit_cents)}` : ""}
        </Txt>
        <View style={{ gap: 8, marginTop: 2 }}>
          {o.lines.map((l) => (
            <View key={l.sku} style={{ gap: 5 }}>
              <Txt v="small" numberOfLines={1}>
                <Txt v="smallSemi">{l.qty_packs} ×</Txt> {l.name}
              </Txt>
              <Tally t={l.tally} sm label={l.name} />
            </View>
          ))}
        </View>
      </View>
      {needs && (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: p.ink, paddingHorizontal: space.lg, paddingVertical: 12 }}>
          <Txt v="bodySemi" color={p.onInk} style={{ flex: 1 }}>{o.next}</Txt>
          <ArrowRight size={18} color={p.onInk} />
        </View>
      )}
    </Pressable>
    </Animated.View>
  );
}
