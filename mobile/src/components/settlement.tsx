import { useEffect, useState } from "react";
import { View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withTiming, Easing } from "react-native-reanimated";
import Svg, { Defs, Pattern, Rect, Line } from "react-native-svg";
import { money } from "@/lib/format";
import { settlementParts } from "@/lib/marks";
import type { FundingNums } from "@/lib/types";
import { Txt } from "./text";
import { useTheme } from "./theme";

function Seg({ to, color, delay, children }: { to: number; color: string; delay: number; children?: React.ReactNode }) {
  const { reduceMotion } = useTheme();
  const w = useSharedValue(reduceMotion ? to : 0);
  useEffect(() => {
    w.value = reduceMotion ? to : withTiming(to, { duration: 650, easing: Easing.out(Easing.cubic) });
  }, [to, reduceMotion, w]);
  const st = useAnimatedStyle(() => ({ width: `${w.value * 100}%` }));
  void delay;
  return <Animated.View style={[{ height: "100%", backgroundColor: color, overflow: "hidden" }, st]}>{children}</Animated.View>;
}

function Stripes({ color, bg }: { color: string; bg: string }) {
  return (
    <Svg width="100%" height="100%" style={{ position: "absolute" }}>
      <Defs>
        <Pattern id="rel" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <Rect width="6" height="6" fill={bg} />
          <Line x1="0" y1="0" x2="0" y2="6" stroke={color} strokeWidth="2.4" />
        </Pattern>
      </Defs>
      <Rect width="100%" height="100%" fill="url(#rel)" />
    </Svg>
  );
}

/** The spend limit split into charged, still held, being released and headroom, with a 2×2 legend. */
export function SettlementBar({ f, compact = false }: { f: FundingNums; compact?: boolean }) {
  const { p } = useTheme();
  const s = settlementParts(f);
  const [wide, setWide] = useState(false);
  const label = `Limit ${money(f.limit_cents)}: ${money(s.captured)} charged, ${money(s.heldOnly)} held, ${money(s.expected)} being released, ${money(f.spendable_cents)} spendable now.`;
  const fig = (k: string, v: number, dot?: string, hint?: string) => (
    <View key={k} style={{ width: wide ? "25%" : "50%", paddingRight: 10, paddingTop: 12 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        {dot && <View style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: dot }} />}
        <Txt v="small" muted>{k}</Txt>
      </View>
      <Txt v="num" style={{ marginTop: 2 }}>{money(v)}</Txt>
      {hint && <Txt v="small" muted style={{ fontSize: 12.5, lineHeight: 16 }}>{hint}</Txt>}
    </View>
  );
  return (
    <View onLayout={(e) => setWide(e.nativeEvent.layout.width > 520)}>
      <View accessible accessibilityRole="image" accessibilityLabel={label} style={{ height: 14, borderRadius: 4, overflow: "hidden", flexDirection: "row", backgroundColor: p.paper2, borderWidth: 1, borderColor: p.rule }}>
        <Seg to={s.frac(s.captured)} color={p.paid} delay={0} />
        <Seg to={s.frac(s.heldOnly)} color={p.held} delay={80} />
        <Seg to={s.frac(s.expected)} color={p.releasedSoft} delay={160}>
          <Stripes color={p.released} bg={p.releasedSoft} />
        </Seg>
      </View>
      {!compact && (
        <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
          {fig("Charged", s.captured, p.paid, f.refunded_cents ? `${money(f.refunded_cents)} refunded` : undefined)}
          {fig("Held on PayPal", s.heldOnly, p.held)}
          {fig("Being released", s.expected, p.released, "not spendable until PayPal confirms")}
          {fig("Spendable now", f.spendable_cents, undefined, `of ${money(f.limit_cents)} limit`)}
        </View>
      )}
    </View>
  );
}
