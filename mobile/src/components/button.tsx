import type { ComponentType, ReactNode } from "react";
import { ActivityIndicator, Pressable, View, type ViewStyle } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import { fonts, radius, TARGET } from "@/lib/theme";
import { tap } from "@/lib/haptics";
import { Txt } from "./text";
import { useTheme } from "./theme";

export type Variant = "primary" | "carbon" | "paid" | "outline" | "ghost" | "destructive" | "soft";
type Icon = ComponentType<{ size?: number; color?: string; strokeWidth?: number }>;

export function Button({
  children,
  onPress,
  variant = "primary",
  size = "md",
  icon: I,
  trailing: T,
  loading,
  disabled,
  full,
  style,
  label,
  hint,
}: {
  children: ReactNode;
  onPress?: () => void;
  variant?: Variant;
  size?: "sm" | "md" | "lg";
  icon?: Icon;
  trailing?: Icon;
  loading?: boolean;
  disabled?: boolean;
  full?: boolean;
  style?: ViewStyle;
  label?: string;
  hint?: string;
}) {
  const { p, reduceMotion } = useTheme();
  const scale = useSharedValue(1);
  const anim = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const off = disabled || loading;
  const c = {
    primary: { bg: p.ink, fg: p.onInk, bd: p.ink },
    carbon: { bg: p.carbon, fg: p.scheme === "dark" ? p.paper : "#FFFCF5", bd: p.carbon },
    paid: { bg: p.paid, fg: p.scheme === "dark" ? p.paper : "#FFFCF5", bd: p.paid },
    destructive: { bg: p.stop, fg: p.scheme === "dark" ? p.paper : "#FFFCF5", bd: p.stop },
    outline: { bg: p.card, fg: p.ink, bd: p.ink },
    soft: { bg: p.paper2, fg: p.ink, bd: p.paper2 },
    ghost: { bg: "transparent", fg: p.ink, bd: "transparent" },
  }[variant];
  const h = size === "lg" ? 54 : size === "sm" ? TARGET : 48;
  const fs = size === "lg" ? 17 : size === "sm" ? 14.5 : 16;
  return (
    <Animated.View style={[full ? { alignSelf: "stretch", width: "100%" } : { alignSelf: "flex-start" }, style, anim]}>
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ disabled: !!off, busy: !!loading }}
      disabled={off}
      onPress={() => {
        tap();
        onPress?.();
      }}
      onPressIn={() => !reduceMotion && (scale.value = withSpring(0.97, { damping: 20, stiffness: 400 }))}
      onPressOut={() => (scale.value = withSpring(1, { damping: 14, stiffness: 300 }))}
      style={({ pressed }: { pressed: boolean }) => [
        {
          minHeight: h,
          paddingHorizontal: size === "sm" ? 14 : 18,
          borderRadius: radius.md,
          backgroundColor: c.bg,
          borderWidth: variant === "outline" ? 1.5 : 0,
          borderColor: c.bd,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          opacity: off && !loading ? 0.45 : pressed && variant === "ghost" ? 0.6 : 1,
        },
      ]}
    >
      {loading ? <ActivityIndicator size="small" color={c.fg} /> : I ? <I size={fs + 2} color={c.fg} strokeWidth={2.2} /> : null}
      <Txt style={{ fontFamily: fonts.bodyBold, fontSize: fs, lineHeight: fs + 4, color: c.fg, flexShrink: 1, textAlign: "center" }}>{children}</Txt>
      {T && !loading ? <T size={fs + 2} color={c.fg} strokeWidth={2.2} /> : null}
    </Pressable>
    </Animated.View>
  );
}

export function ButtonRow({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[{ flexDirection: "row", flexWrap: "wrap", gap: 10 }, style]}>{children}</View>;
}
