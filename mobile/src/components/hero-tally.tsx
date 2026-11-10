import { useEffect } from "react";
import { View } from "react-native";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDelay, withTiming } from "react-native-reanimated";
import Svg, { Line } from "react-native-svg";
import { useTheme } from "./theme";

type K = "accepted" | "damaged" | "short";
const MARKS: K[] = ["accepted", "accepted", "accepted", "accepted", "accepted", "accepted", "accepted", "damaged", "short", "short"];

function Mark({ k, i }: { k: K; i: number }) {
  const { p, reduceMotion } = useTheme();
  const s = useSharedValue(reduceMotion ? 1 : 0);
  useEffect(() => {
    if (!reduceMotion) s.value = withDelay(120 + i * 70, withTiming(1, { duration: 380, easing: Easing.out(Easing.back(1.6)) }));
  }, [i, reduceMotion, s]);
  const st = useAnimatedStyle(() => ({ transform: [{ scaleY: s.value }], opacity: s.value }));
  const base = { width: 14, height: 56, borderRadius: 3 } as const;
  return (
    <Animated.View style={[{ marginLeft: i === 0 ? 0 : i % 5 === 0 ? 16 : 7 }, st]}>
      {k === "accepted" ? (
        <View style={[base, { backgroundColor: p.ink }]} />
      ) : k === "damaged" ? (
        <View style={[base, { borderWidth: 2.5, borderColor: p.stop, backgroundColor: p.stopSoft }]}>
          <Svg width={22} height={56} style={{ position: "absolute", left: -6.5, top: -2.5 }}>
            <Line x1={1} y1={46} x2={21} y2={10} stroke={p.stop} strokeWidth={3} strokeLinecap="round" />
          </Svg>
        </View>
      ) : (
        <View style={[base, { borderWidth: 2.5, borderStyle: "dashed", borderColor: p.input }]} />
      )}
    </Animated.View>
  );
}

/** Decorative: ten packs ordered, seven accepted, one crushed, two short. */
export function HeroTally() {
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ flexDirection: "row", alignItems: "flex-end" }}>
      {MARKS.map((k, i) => <Mark key={i} k={k} i={i} />)}
    </View>
  );
}
