import type { ReactNode } from "react";
import { View } from "react-native";
import { useSession } from "@/lib/session";
import { LogoMark } from "./logo";
import { Stamp } from "./stamp";
import { Txt } from "./text";
import { useTheme } from "./theme";

/** Top of each tab: the mark, who you are, the sandbox stamp, then a big expanded title. */
export function Masthead({ title, sub, right }: { title: string; sub?: ReactNode; right?: ReactNode }) {
  const { p } = useTheme();
  const { session } = useSession();
  const who = session?.who;
  return (
    <View style={{ gap: 14, marginBottom: 2 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <LogoMark size={26} />
        <Txt v="smallSemi" numberOfLines={1} style={{ flex: 1 }}>
          {who ? `${who.first} · ${who.org}` : "StockSure"}
        </Txt>
        {session && session.paypal_env !== "live" && <Stamp tone="held">Sandbox</Stamp>}
      </View>
      <View style={{ height: 1, backgroundColor: p.rule }} />
      <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 12 }}>
        <View style={{ flex: 1, gap: 4 }}>
          <Txt v="display" accessibilityRole="header">{title}</Txt>
          {sub ? typeof sub === "string" ? <Txt muted>{sub}</Txt> : sub : null}
        </View>
        {right}
      </View>
    </View>
  );
}
