import { useEffect, type ReactNode } from "react";
import { View, type ViewStyle } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import { fonts, toneColors, type Tone } from "@/lib/theme";
import { PP, STATUS } from "@/lib/format";
import { Txt } from "./text";
import { useTheme } from "./theme";

/**
 * The rubber stamp: uppercase expanded type in a 1.5 pt border, tipped −2°. Released is dashed, quiet sits flat.
 * `animate` stamps it down once when it first appears (skipped with Reduce Motion).
 */
export function Stamp({ tone, children, animate = false, icon, style }: { tone: Tone; children: ReactNode; animate?: boolean; icon?: ReactNode; style?: ViewStyle }) {
  const { p, reduceMotion } = useTheme();
  const c = toneColors(p, tone);
  const quiet = tone === "quiet";
  const rot = quiet ? 0 : -2;
  const go = animate && !reduceMotion;
  const s = useSharedValue(go ? 1.18 : 1);
  const r = useSharedValue(go ? -6 : rot);
  useEffect(() => {
    if (!go) return;
    s.value = withSpring(1, { damping: 11, stiffness: 260 });
    r.value = withSpring(rot, { damping: 11, stiffness: 260 });
  }, [go, rot, s, r]);
  const anim = useAnimatedStyle(() => ({ transform: [{ rotate: `${r.value}deg` }, { scale: s.value }] }));
  return (
    <Animated.View
      style={[
        {
          flexDirection: "row",
          alignItems: "center",
          alignSelf: "flex-start",
          gap: 4,
          borderWidth: quiet ? 1 : 1.5,
          borderStyle: c.dashed ? "dashed" : "solid",
          borderColor: quiet ? p.rule : c.fg,
          backgroundColor: quiet ? "transparent" : c.bg,
          borderRadius: 3,
          paddingHorizontal: 6,
          paddingVertical: 2,
          transformOrigin: "left center",
        },
        anim,
        style,
      ]}
    >
      {icon}
      <Txt
        maxFontSizeMultiplier={1.5}
        style={{ fontFamily: fonts.display, fontSize: 10.5, lineHeight: 14, letterSpacing: 0.9, textTransform: "uppercase", color: c.fg }}
      >
        {children}
      </Txt>
    </Animated.View>
  );
}

export function StatusStamp({ status, animate }: { status: string; animate?: boolean }) {
  const s = STATUS[status] ?? { label: status.replace(/_/g, " "), tone: "quiet" as const };
  return <Stamp tone={s.tone} animate={animate}>{s.label}</Stamp>;
}

export function PayPalStamp({ status }: { status: string | null | undefined }) {
  if (!status) return null;
  const s = PP[status] ?? { label: status.replace(/_/g, " ").toLowerCase(), tone: "quiet" as const };
  return (
    <View accessible accessibilityLabel={`PayPal reports ${status}`}>
      <Stamp tone={s.tone}>{s.label}</Stamp>
    </View>
  );
}
