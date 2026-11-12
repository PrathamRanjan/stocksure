import { BlurView } from "expo-blur";
import { Redirect } from "expo-router";
import { Tabs, type BottomTabBarProps } from "expo-router/js-tabs";
import { BadgeCheck, ClipboardList, Truck, UserRound } from "lucide-react-native";
import { Platform, Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Txt } from "@/components/text";
import { useTheme } from "@/components/theme";
import { fonts } from "@/lib/theme";
import { tap } from "@/lib/haptics";
import { useSession } from "@/lib/session";

/** Paper tab bar with a frosted back on iOS; the active tab gets an ink tab-stop above it. */
function Bar({ state, descriptors, emitter, navigateToTab }: BottomTabBarProps) {
  const { p, scheme } = useTheme();
  const insets = useSafeAreaInsets();
  const routes = state.routes.filter((r) => (descriptors[r.key].options as { href?: unknown }).href !== null && !(descriptors[r.key].options.tabBarItemStyle as { display?: string } | undefined)?.display);
  return (
    <View style={{ position: "absolute", left: 0, right: 0, bottom: 0, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: p.rule, overflow: "hidden" }}>
      {Platform.OS === "ios" ? (
        <BlurView intensity={60} tint={scheme === "dark" ? "dark" : "light"} style={StyleSheet.absoluteFill} />
      ) : null}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: p.paper, opacity: Platform.OS === "ios" ? 0.82 : 0.98 }]} />
      <View accessibilityRole="tablist" style={{ flexDirection: "row", paddingBottom: Math.max(insets.bottom, 8), paddingTop: 6, maxWidth: 560, width: "100%", alignSelf: "center" }}>
        {routes.map((r) => {
          const o = descriptors[r.key].options;
          const focused = state.routes[state.index]?.key === r.key;
          const color = focused ? p.ink : p.ink2;
          const badge = o.tabBarBadge;
          return (
            <Pressable
              key={r.key}
              accessibilityRole="tab"
              accessibilityState={{ selected: focused }}
              accessibilityLabel={`${o.title}${badge ? `, ${badge} waiting` : ""}`}
              onPress={() => {
                const e = emitter.emit({ type: "tabPress", target: r.key, canPreventDefault: true });
                if (!focused && !e.defaultPrevented) {
                  tap();
                  navigateToTab(r.key);
                }
              }}
              style={{ flex: 1, alignItems: "center", gap: 3, minHeight: 50, justifyContent: "center" }}
            >
              <View style={{ position: "absolute", top: -6, width: 28, height: 3, borderRadius: 2, backgroundColor: focused ? p.ink : "transparent" }} />
              <View>
                {o.tabBarIcon?.({ focused, color, size: 23 })}
                {badge ? (
                  <View style={{ position: "absolute", top: -4, right: -10, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: p.held, alignItems: "center", justifyContent: "center", paddingHorizontal: 4 }}>
                    <Txt style={{ fontFamily: fonts.bodyBold, fontSize: 11, lineHeight: 13, color: scheme === "dark" ? p.paper : "#FFFCF5" }}>{String(badge)}</Txt>
                  </View>
                ) : null}
              </View>
              <Txt maxFontSizeMultiplier={1.3} style={{ fontFamily: focused ? fonts.bodyBold : fonts.bodySemi, fontSize: 11.5, lineHeight: 14, color }}>{o.title}</Txt>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export default function TabsLayout() {
  const { session, loading } = useSession();
  const { p } = useTheme();
  if (!loading && !session?.who) return <Redirect href="/sign-in" />;
  const who = session?.who;
  const receiving = who?.role === "receiving";
  const n = session?.counts.approvals ?? 0;
  return (
    <Tabs tabBar={(props) => <Bar {...props} />} screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: p.paper } }}>
      <Tabs.Screen
        name="index"
        options={{
          title: who?.side === "supplier" ? "Orders" : receiving ? "Deliveries" : "Orders",
          tabBarIcon: ({ color, size }) => (receiving ? <Truck color={color} size={size} /> : <ClipboardList color={color} size={size} />),
          tabBarBadge: session?.counts.needs ? session.counts.needs : undefined,
        }}
      />
      <Tabs.Screen
        name="approvals"
        options={{
          title: "Approvals",
          href: who && !who.owner ? null : undefined,
          tabBarIcon: ({ color, size }) => <BadgeCheck color={color} size={size} />,
          tabBarBadge: n ? n : undefined,
        }}
      />
      <Tabs.Screen name="account" options={{ title: "Account", tabBarIcon: ({ color, size }) => <UserRound color={color} size={size} /> }} />
    </Tabs>
  );
}
