import { Text, type TextProps, type TextStyle } from "react-native";
import { fonts } from "@/lib/theme";
import { useTheme } from "./theme";

type Variant = "display" | "title" | "h1" | "h2" | "h3" | "body" | "bodySemi" | "small" | "smallSemi" | "label" | "mono" | "num";

const V: Record<Variant, TextStyle> = {
  display: { fontFamily: fonts.display, fontSize: 34, lineHeight: 36, letterSpacing: -0.6 },
  title: { fontFamily: fonts.display, fontSize: 28, lineHeight: 31, letterSpacing: -0.4 },
  h1: { fontFamily: fonts.heading, fontSize: 24, lineHeight: 28, letterSpacing: -0.3 },
  h2: { fontFamily: fonts.heading, fontSize: 19, lineHeight: 23, letterSpacing: -0.2 },
  h3: { fontFamily: fonts.headingBold, fontSize: 16, lineHeight: 20 },
  body: { fontFamily: fonts.body, fontSize: 16, lineHeight: 23 },
  bodySemi: { fontFamily: fonts.bodySemi, fontSize: 16, lineHeight: 23 },
  small: { fontFamily: fonts.body, fontSize: 14, lineHeight: 19 },
  smallSemi: { fontFamily: fonts.bodySemi, fontSize: 14, lineHeight: 19 },
  label: { fontFamily: fonts.bodyBold, fontSize: 12, lineHeight: 15, letterSpacing: 1.1, textTransform: "uppercase" },
  mono: { fontFamily: fonts.mono, fontSize: 12.5, lineHeight: 17 },
  num: { fontFamily: fonts.heading, fontSize: 20, lineHeight: 24, fontVariant: ["tabular-nums"] },
};

export interface TxtProps extends TextProps {
  v?: Variant;
  muted?: boolean;
  color?: string;
  center?: boolean;
}

/** All text in the app. Scales with Dynamic Type; display sizes are capped so headings never break the layout. */
export function Txt({ v = "body", muted, color, center, style, maxFontSizeMultiplier, ...rest }: TxtProps) {
  const { p } = useTheme();
  const cap = maxFontSizeMultiplier ?? (v === "display" || v === "title" ? 1.3 : v === "label" ? 1.6 : 2);
  return (
    <Text
      maxFontSizeMultiplier={cap}
      style={[V[v], { color: color ?? (muted ? p.ink2 : p.ink) }, center && { textAlign: "center" }, style]}
      {...rest}
    />
  );
}
