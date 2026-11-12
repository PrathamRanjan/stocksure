import { useEffect, type ReactNode } from "react";
import { RefreshControl, ScrollView, View, type ViewStyle } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CloudOff, RotateCcw, ServerCrash } from "lucide-react-native";
import { WAKING } from "@/lib/client";
import { radius, space } from "@/lib/theme";
import { Button } from "./button";
import { Card } from "./card";
import { Txt } from "./text";
import { useTheme } from "./theme";

/** A scrolling screen on paper, centred and width-capped on tablets, with pull to refresh. */
export function Screen({ children, refreshing, onRefresh, top = false, bottom = 32, style }: { children: ReactNode; refreshing?: boolean; onRefresh?: () => void; top?: boolean; bottom?: number; style?: ViewStyle }) {
  const { p } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: p.paper }}
      contentContainerStyle={{ paddingTop: top ? insets.top + space.md : space.md, paddingBottom: insets.bottom + bottom, paddingHorizontal: space.lg }}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={p.ink2} colors={[p.carbon]} /> : undefined}
    >
      <View style={[{ width: "100%", maxWidth: 720, alignSelf: "center", gap: space.lg }, style]}>{children}</View>
    </ScrollView>
  );
}

function Bone({ h, w = "100%", r = radius.sm }: { h: number; w?: number | `${number}%`; r?: number }) {
  const { p, reduceMotion } = useTheme();
  const o = useSharedValue(0.55);
  useEffect(() => {
    if (!reduceMotion) o.value = withRepeat(withTiming(1, { duration: 750 }), -1, true);
  }, [o, reduceMotion]);
  const st = useAnimatedStyle(() => ({ opacity: o.value }));
  return <Animated.View style={[{ height: h, width: w, borderRadius: r, backgroundColor: p.paper2 }, st]} />;
}

/** Skeleton cards in the shape of what's coming; announced once to screen readers. */
export function Loading({ label = "Loading", cards = 3 }: { label?: string; cards?: number }) {
  return (
    <View accessible accessibilityLabel={label} accessibilityLiveRegion="polite" style={{ gap: space.lg }}>
      {Array.from({ length: cards }).map((_, i) => (
        <Card key={i}>
          <View style={{ gap: 10 }}>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <Bone h={20} w={90} />
              <Bone h={20} w={70} />
            </View>
            <Bone h={14} w="70%" />
            <Bone h={18} w="45%" />
          </View>
        </Card>
      ))}
    </View>
  );
}

export function Empty({ title, children, art, action }: { title: string; children?: ReactNode; art?: ReactNode; action?: ReactNode }) {
  const { p } = useTheme();
  return (
    <View style={{ borderWidth: 1.5, borderStyle: "dashed", borderColor: p.input, borderRadius: radius.lg, padding: space.xl, alignItems: "center", gap: 6 }}>
      {art}
      <Txt v="h3" center>{title}</Txt>
      {children ? <Txt v="small" muted center style={{ maxWidth: 420 }}>{children}</Txt> : null}
      {action ? <View style={{ marginTop: 8 }}>{action}</View> : null}
    </View>
  );
}

/** A load failed: say why in plain words and offer one way forward. */
export function ErrorState({ message, status, retry }: { message: string; status?: number; retry?: () => void }) {
  const { p } = useTheme();
  const offline = status === 0;
  const I = offline ? CloudOff : ServerCrash;
  return (
    <Card look="stop" style={{ gap: 8 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <I size={20} color={p.stop} />
        <Txt v="h3" color={p.stop}>{offline ? "Can't reach StockSure" : status === 404 ? "Not found" : "Something went wrong"}</Txt>
      </View>
      <Txt>{message}</Txt>
      {offline && <Txt v="small" muted>{WAKING}</Txt>}
      {retry && <Button variant="outline" size="sm" icon={RotateCcw} onPress={retry} style={{ marginTop: 4 }}>Try again</Button>}
    </Card>
  );
}

export function Notice({ children, tone = "carbon", icon }: { children: ReactNode; tone?: "carbon" | "held" | "stop" | "paid"; icon?: ReactNode }) {
  const { p } = useTheme();
  const c = { carbon: [p.carbonSoft, p.carbon], held: [p.heldSoft, p.held], stop: [p.stopSoft, p.stop], paid: [p.paidSoft, p.paid] }[tone];
  return (
    <View accessibilityRole="text" style={{ flexDirection: "row", gap: 10, backgroundColor: c[0], borderLeftWidth: 3, borderLeftColor: c[1], borderRadius: radius.sm, padding: space.md }}>
      {icon}
      <View style={{ flex: 1 }}>{typeof children === "string" ? <Txt v="small">{children}</Txt> : children}</View>
    </View>
  );
}
