import { View } from "react-native";
import Svg, { Line } from "react-native-svg";
import { tallyMarks, tallyText, type MarkKind } from "@/lib/marks";
import type { TallyNums } from "@/lib/types";
import { Txt } from "./text";
import { useTheme } from "./theme";

type Kind = MarkKind;

function Mark({ k, sm }: { k: Kind; sm?: boolean }) {
  const { p } = useTheme();
  const w = sm ? 5 : 7;
  const h = sm ? 13 : 18;
  const base = { width: w, height: h, borderRadius: 1.5 } as const;
  if (k === "accepted") return <View style={[base, { backgroundColor: p.ink }]} />;
  if (k === "ordered") return <View style={[base, { backgroundColor: p.input, opacity: 0.55 }]} />;
  if (k === "damaged")
    return (
      <View style={[base, { borderWidth: 1.5, borderColor: p.stop, backgroundColor: p.stopSoft, overflow: "visible" }]}>
        <Svg width={w + 4} height={h} style={{ position: "absolute", left: -3.5, top: -1.5 }}>
          <Line x1={0} y1={h * 0.78} x2={w + 4} y2={h * 0.22} stroke={p.stop} strokeWidth={1.8} strokeLinecap="round" />
        </Svg>
      </View>
    );
  return <View style={[base, { borderWidth: 1.5, borderStyle: "dashed", borderColor: p.input }]} />;
}

/** The signature: one mark per pack. Ink = accepted, struck red = damaged, dashed = short or wrong, grey = not counted yet. */
export function Tally({ t, sm, label }: { t: TallyNums; sm?: boolean; label?: string }) {
  const { p } = useTheme();
  const marks = tallyMarks(t);
  const text = tallyText(t);
  const a11y = label ? `${label}: ${text}` : text;
  if (marks.length > 48) {
    const parts: [Kind, string][] = [["accepted", p.ink], ["damaged", p.stop], ["wrong", p.paper2], ["short", p.paper2], ["ordered", p.input]];
    return (
      <View accessible accessibilityRole="image" accessibilityLabel={a11y} style={{ flexDirection: "row", width: 150, height: sm ? 10 : 14, borderRadius: 3, overflow: "hidden", backgroundColor: p.paper2, borderWidth: 1, borderColor: p.rule }}>
        {parts.map(([k, c]) => {
          const n = marks.filter((m) => m === k).length;
          return n ? <View key={k} style={{ flex: n, backgroundColor: c }} /> : null;
        })}
      </View>
    );
  }
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={a11y} style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", rowGap: 4, maxWidth: "100%" }}>
      {marks.map((k, i) => (
        <View key={i} style={{ marginLeft: i === 0 ? 0 : i % 5 === 0 ? (sm ? 6 : 7) : sm ? 2 : 3 }}>
          <Mark k={k} sm={sm} />
        </View>
      ))}
    </View>
  );
}

export function TallyLegend() {
  const item = (k: Kind, l: string) => (
    <View key={k} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
      <Mark k={k} sm />
      <Txt v="small" muted>{l}</Txt>
    </View>
  );
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", columnGap: 14, rowGap: 6 }} accessible accessibilityLabel="Tally key: solid is accepted, struck red is damaged, dashed is short or wrong, grey is not counted yet">
      {item("accepted", "accepted")}
      {item("damaged", "damaged")}
      {item("short", "short or wrong")}
      {item("ordered", "not counted")}
    </View>
  );
}
