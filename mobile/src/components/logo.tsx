import Svg, { Line, Rect } from "react-native-svg";
import { View } from "react-native";
import { Txt } from "./text";
import { useTheme } from "./theme";

/** The mark: a tally of four strokes and a fifth across, on an ink tile. */
export function LogoMark({ size = 32 }: { size?: number }) {
  const { p } = useTheme();
  return (
    <Svg width={size} height={size} viewBox="0 0 32 32" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Rect width="32" height="32" rx="7" fill={p.ink} />
      {[9, 14, 19, 24].map((x) => (
        <Rect key={x} x={x - 1.5} y="8" width="3" height="16" rx="1.5" fill={p.paper} />
      ))}
      <Line x1="6" y1="21" x2="27" y2="11" stroke={p.paper} strokeWidth="2.6" strokeLinecap="round" />
    </Svg>
  );
}

export function Logo({ size = 28 }: { size?: number }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }} accessible accessibilityRole="header" accessibilityLabel="StockSure">
      <LogoMark size={size} />
      <Txt v="h2" style={{ fontFamily: "ArchivoExpanded-ExtraBold", fontSize: size * 0.68, lineHeight: size }}>StockSure</Txt>
    </View>
  );
}
