import type { ReactNode } from "react";
import { View, type ViewStyle } from "react-native";
import { radius, space } from "@/lib/theme";
import { Txt } from "./text";
import { useTheme } from "./theme";

type Look = "plain" | "do" | "wait" | "done" | "stop" | "held" | "ink" | "sunk";

/** A docket card. "do" is the one heavy ink frame on a screen: the next thing to do. */
export function Card({ children, look = "plain", style, pad = space.lg }: { children: ReactNode; look?: Look; style?: ViewStyle; pad?: number }) {
  const { p } = useTheme();
  const L: Record<Look, ViewStyle> = {
    plain: { backgroundColor: p.card, borderWidth: 1, borderColor: p.rule },
    do: { backgroundColor: p.card, borderWidth: 2, borderColor: p.ink },
    wait: { backgroundColor: p.card, borderWidth: 1.5, borderColor: p.input, borderStyle: "dashed" },
    done: { backgroundColor: p.paidSoft, borderWidth: 1, borderColor: p.paid },
    stop: { backgroundColor: p.stopSoft, borderWidth: 2, borderColor: p.stop },
    held: { backgroundColor: p.card, borderWidth: 2, borderColor: p.held },
    ink: { backgroundColor: p.ink },
    sunk: { backgroundColor: p.paper2 },
  };
  return (
    <View
      style={[
        { borderRadius: radius.lg, padding: pad },
        L[look],
        look === "do" && { shadowColor: p.ink, shadowOpacity: p.scheme === "dark" ? 0 : 0.9, shadowRadius: 0, shadowOffset: { width: 3, height: 3 }, elevation: 0 },
        style,
      ]}
    >
      {children}
    </View>
  );
}

/** Section heading with an optional aside on the right, ruled underneath like a docket. */
export function SectionTitle({ children, aside, style }: { children: ReactNode; aside?: ReactNode; style?: ViewStyle }) {
  const { p } = useTheme();
  return (
    <View style={[{ flexDirection: "row", flexWrap: "wrap", alignItems: "baseline", justifyContent: "space-between", gap: 8, paddingBottom: 10, marginBottom: 12, borderBottomWidth: 1, borderBottomColor: p.rule }, style]}>
      <Txt v="h2" accessibilityRole="header" style={{ flexShrink: 1 }}>{children}</Txt>
      {typeof aside === "string" ? <Txt v="small" muted>{aside}</Txt> : aside}
    </View>
  );
}

export function Kicker({ children, color }: { children: ReactNode; color?: string }) {
  return <Txt v="label" muted={!color} color={color}>{children}</Txt>;
}

export function Rule({ dashed, style }: { dashed?: boolean; style?: ViewStyle }) {
  const { p } = useTheme();
  return <View style={[{ borderTopWidth: 1, borderColor: dashed ? p.input : p.rule, borderStyle: dashed ? "dashed" : "solid", marginVertical: 12 }, style]} />;
}

/** Label / value pair, stacked. */
export function Fact({ k, v, strong }: { k: string; v: ReactNode; strong?: boolean }) {
  return (
    <View style={{ minWidth: 0 }}>
      <Txt v="small" muted>{k}</Txt>
      {typeof v === "string" ? <Txt v={strong ? "bodySemi" : "body"} style={{ fontVariant: ["tabular-nums"] }}>{v}</Txt> : v}
    </View>
  );
}
