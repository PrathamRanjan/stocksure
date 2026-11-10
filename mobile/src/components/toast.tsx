import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { AccessibilityInfo, Pressable, View } from "react-native";
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withSpring, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CircleAlert, CircleCheck, Info } from "lucide-react-native";
import { radius, space } from "@/lib/theme";
import { Txt } from "./text";
import { useTheme } from "./theme";

type Kind = "success" | "error" | "info";
interface T {
  id: number;
  kind: Kind;
  text: string;
}
const Ctx = createContext<(kind: Kind, text: string) => void>(() => {});

function Item({ t, onGone }: { t: T; onGone: () => void }) {
  const { p, reduceMotion } = useTheme();
  const y = useSharedValue(reduceMotion ? 0 : -24);
  const o = useSharedValue(0);
  useEffect(() => {
    y.value = withSpring(0, { damping: 16, stiffness: 220 });
    o.value = withTiming(1, { duration: 160 });
    const ms = Math.min(9000, 3200 + t.text.length * 35);
    const h = setTimeout(() => {
      o.value = withTiming(0, { duration: 200 }, (done) => done && runOnJS(onGone)());
    }, ms);
    return () => clearTimeout(h);
  }, [o, y, onGone, t.text.length]);
  const st = useAnimatedStyle(() => ({ opacity: o.value, transform: [{ translateY: y.value }] }));
  const [bg, fg, I] = t.kind === "success" ? [p.paidSoft, p.paid, CircleCheck] : t.kind === "error" ? [p.stopSoft, p.stop, CircleAlert] : [p.card, p.carbon, Info];
  return (
    <Animated.View style={[st, { alignSelf: "center", width: "100%", maxWidth: 560 }]}>
      <Pressable
        onPress={onGone}
        accessibilityRole="alert"
        accessibilityHint="Tap to dismiss"
        style={{ flexDirection: "row", gap: 10, alignItems: "flex-start", backgroundColor: bg, borderWidth: 1.5, borderColor: fg, borderRadius: radius.md, padding: space.md, shadowColor: "#000", shadowOpacity: 0.12, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 4 }}
      >
        <I size={20} color={fg} />
        <Txt v="smallSemi" style={{ flex: 1 }}>{t.text}</Txt>
      </Pressable>
    </Animated.View>
  );
}

/** Server messages after an action, said in the server's own words. Also announced to screen readers. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [list, setList] = useState<T[]>([]);
  const n = useRef(0);
  const insets = useSafeAreaInsets();
  const show = useCallback((kind: Kind, text: string) => {
    if (!text) return;
    const id = ++n.current;
    setList((l) => [...l.slice(-2), { id, kind, text }]);
    AccessibilityInfo.announceForAccessibility(text);
  }, []);
  return (
    <Ctx.Provider value={show}>
      {children}
      <View pointerEvents="box-none" style={{ position: "absolute", left: space.lg, right: space.lg, top: insets.top + 8, gap: 8 }}>
        {list.map((t) => (
          <Item key={t.id} t={t} onGone={() => setList((l) => l.filter((x) => x.id !== t.id))} />
        ))}
      </View>
    </Ctx.Provider>
  );
}

export function useToast() {
  const show = useContext(Ctx);
  return { success: (t: string) => show("success", t), error: (t: string) => show("error", t), info: (t: string) => show("info", t) };
}
