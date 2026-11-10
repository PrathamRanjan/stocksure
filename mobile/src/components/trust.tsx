import { Bot, Code2, Landmark } from "lucide-react-native";
import { View } from "react-native";
import { radius } from "@/lib/theme";
import { Txt } from "./text";
import { useTheme } from "./theme";

const CELLS = [
  { icon: Bot, k: "AI proposes", v: "Reads the docket, invoice and photos into suggested counts. Never sets a price or a payee." },
  { icon: Code2, k: "Code decides", v: "Pay = quote price × counted units. Checks limits, your rules and the agreed version." },
  { icon: Landmark, k: "PayPal moves money", v: "Holds at order, captures only the agreed amount, releases the rest." },
];

/** The trust pattern, shown wherever money is about to move. */
export function TrustRow({ dense }: { dense?: boolean }) {
  const { p } = useTheme();
  return (
    <View style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: p.rule, overflow: "hidden", backgroundColor: p.card }}>
      {CELLS.map((c, i) => (
        <View key={c.k} style={{ flexDirection: "row", gap: 12, padding: dense ? 12 : 16, borderTopWidth: i ? 1 : 0, borderTopColor: p.rule }}>
          <View style={{ width: 26, height: 26, borderRadius: 4, backgroundColor: p.ink, alignItems: "center", justifyContent: "center" }}>
            <Txt v="h3" color={p.onInk} style={{ fontSize: 13, lineHeight: 16 }}>{i + 1}</Txt>
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <c.icon size={16} color={p.ink} />
              <Txt v="h3">{c.k}</Txt>
            </View>
            {!dense && <Txt v="small" muted>{c.v}</Txt>}
          </View>
        </View>
      ))}
    </View>
  );
}
