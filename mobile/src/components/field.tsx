import { useState, type ReactNode } from "react";
import { Pressable, TextInput, View, type KeyboardTypeOptions, type ViewStyle } from "react-native";
import { Check } from "lucide-react-native";
import { fonts, radius, TARGET } from "@/lib/theme";
import { tap } from "@/lib/haptics";
import { Txt } from "./text";
import { useTheme } from "./theme";

export function Field({
  label,
  value,
  onChange,
  placeholder,
  keyboardType,
  multiline,
  mono,
  align,
  prefix,
  hint,
  style,
  autoCapitalize = "sentences",
  testID,
  secure,
  a11yLabel,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  keyboardType?: KeyboardTypeOptions;
  multiline?: boolean;
  mono?: boolean;
  align?: "left" | "right";
  prefix?: string;
  hint?: string;
  style?: ViewStyle;
  autoCapitalize?: "none" | "sentences";
  testID?: string;
  secure?: boolean;
  a11yLabel?: string;
}) {
  const { p } = useTheme();
  const [focus, setFocus] = useState(false);
  return (
    <View style={[{ gap: 5 }, style]}>
      <Txt v="smallSemi">{label}</Txt>
      <View style={{ flexDirection: "row", alignItems: "center", minHeight: TARGET + 4, borderWidth: focus ? 2 : 1.5, borderColor: focus ? p.carbon : p.input, borderRadius: radius.md, backgroundColor: p.card, paddingHorizontal: focus ? 11.5 : 12 }}>
        {prefix && <Txt muted style={{ marginRight: 4 }}>{prefix}</Txt>}
        <TextInput
          testID={testID}
          accessibilityLabel={a11yLabel ?? label}
          accessibilityHint={hint}
          value={value}
          secureTextEntry={secure}
          onChangeText={onChange}
          placeholder={placeholder}
          placeholderTextColor={p.input}
          keyboardType={keyboardType}
          multiline={multiline}
          autoCapitalize={autoCapitalize}
          autoCorrect={!mono}
          onFocus={() => setFocus(true)}
          onBlur={() => setFocus(false)}
          style={{
            flexGrow: 1,
            flexShrink: 1,
            flexBasis: 0,
            minWidth: 0,
            color: p.ink,
            fontFamily: mono ? fonts.heading : fonts.body,
            fontSize: mono ? 17 : 16,
            paddingVertical: multiline ? 10 : 8,
            minHeight: multiline ? 84 : undefined,
            textAlign: align ?? "left",
            textAlignVertical: multiline ? "top" : "center",
            fontVariant: mono ? ["tabular-nums"] : undefined,
          }}
        />
      </View>
      {hint && <Txt v="small" muted>{hint}</Txt>}
    </View>
  );
}

export function CheckRow({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  const { p } = useTheme();
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      onPress={() => {
        tap();
        onChange(!checked);
      }}
      style={{ flexDirection: "row", gap: 12, alignItems: "flex-start", backgroundColor: p.paper2, borderRadius: radius.md, padding: 14, minHeight: TARGET }}
    >
      <View style={{ width: 24, height: 24, borderRadius: 5, borderWidth: 2, borderColor: p.ink, backgroundColor: checked ? p.ink : p.card, alignItems: "center", justifyContent: "center", marginTop: 1 }}>
        {checked && <Check size={16} color={p.onInk} strokeWidth={3} />}
      </View>
      <View style={{ flex: 1 }}>{typeof children === "string" ? <Txt>{children}</Txt> : children}</View>
    </Pressable>
  );
}

/** Single choice as large tappable rows (radio semantics). */
export function Choices<V extends string>({ label, value, onChange, options }: { label: string; value: V; onChange: (v: V) => void; options: { v: V; l: string; sub?: string }[] }) {
  const { p } = useTheme();
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={label} style={{ gap: 8 }}>
      <Txt v="smallSemi">{label}</Txt>
      {options.map((o) => {
        const on = o.v === value;
        return (
          <Pressable
            key={o.v}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            onPress={() => {
              tap();
              onChange(o.v);
            }}
            style={{ flexDirection: "row", alignItems: "center", gap: 12, minHeight: TARGET + 4, paddingHorizontal: 14, paddingVertical: 10, borderRadius: radius.md, borderWidth: on ? 2 : 1.5, borderColor: on ? p.ink : p.rule, backgroundColor: on ? p.paper2 : p.card }}
          >
            <View style={{ width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: on ? p.ink : p.input, alignItems: "center", justifyContent: "center" }}>
              {on && <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: p.ink }} />}
            </View>
            <View style={{ flex: 1 }}>
              <Txt v={on ? "bodySemi" : "body"}>{o.l}</Txt>
              {o.sub && <Txt v="small" muted>{o.sub}</Txt>}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Segmented control for two to four short options. */
export function Segmented<V extends string>({ label, value, onChange, options }: { label: string; value: V; onChange: (v: V) => void; options: { v: V; l: string }[] }) {
  const { p } = useTheme();
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={label} style={{ flexDirection: "row", backgroundColor: p.paper2, borderRadius: radius.md, padding: 3, gap: 3 }}>
      {options.map((o) => {
        const on = o.v === value;
        return (
          <Pressable
            key={o.v}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            accessibilityLabel={o.l}
            onPress={() => {
              tap();
              onChange(o.v);
            }}
            style={{ flex: 1, minHeight: TARGET - 4, borderRadius: radius.md - 2, alignItems: "center", justifyContent: "center", backgroundColor: on ? p.card : "transparent", borderWidth: on ? 1 : 0, borderColor: p.rule }}
          >
            <Txt v={on ? "smallSemi" : "small"} muted={!on}>{o.l}</Txt>
          </Pressable>
        );
      })}
    </View>
  );
}
