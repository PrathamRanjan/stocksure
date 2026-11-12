import AsyncStorage from "@react-native-async-storage/async-storage";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { AccessibilityInfo, useColorScheme } from "react-native";
import { dark, light, type Palette } from "@/lib/theme";

export type Mode = "system" | "light" | "dark";
interface Ctx {
  p: Palette;
  scheme: "light" | "dark";
  mode: Mode;
  setMode: (m: Mode) => void;
  reduceMotion: boolean;
}

const ThemeCtx = createContext<Ctx>({ p: light, scheme: "light", mode: "system", setMode: () => {}, reduceMotion: false });
const KEY = "stocksure.theme";

export function ThemeProvider({ children }: { children: ReactNode }) {
  const system = useColorScheme();
  const [mode, setModeState] = useState<Mode>("system");
  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    AsyncStorage.getItem(KEY)
      .then((v) => v === "light" || v === "dark" || v === "system" ? setModeState(v) : null)
      .catch(() => {});
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion).catch(() => {});
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduceMotion);
    return () => sub.remove();
  }, []);
  const scheme = mode === "system" ? (system === "dark" ? "dark" : "light") : mode;
  const value = useMemo(
    () => ({
      p: scheme === "dark" ? dark : light,
      scheme,
      mode,
      reduceMotion,
      setMode: (m: Mode) => {
        setModeState(m);
        AsyncStorage.setItem(KEY, m).catch(() => {});
      },
    }),
    [scheme, mode, reduceMotion],
  );
  return <ThemeCtx.Provider value={value}>{children}</ThemeCtx.Provider>;
}

export const useTheme = () => useContext(ThemeCtx);
