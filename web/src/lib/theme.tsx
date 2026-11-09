import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

type Choice = "system" | "light" | "dark";
const KEY = "ss-theme";
const Ctx = createContext<{ choice: Choice; resolved: "light" | "dark"; set: (c: Choice) => void }>({ choice: "system", resolved: "light", set: () => {} });

const read = (): Choice => {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
};
const sys = () => (typeof matchMedia !== "undefined" && matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [choice, setChoice] = useState<Choice>(read);
  const [system, setSystem] = useState<"light" | "dark">(sys);
  useEffect(() => {
    const m = matchMedia("(prefers-color-scheme: dark)");
    const on = () => setSystem(m.matches ? "dark" : "light");
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  const resolved = choice === "system" ? system : choice;
  useEffect(() => {
    document.documentElement.classList.toggle("dark", resolved === "dark");
    document.querySelector('meta[name="theme-color"]:not([media])')?.setAttribute("content", resolved === "dark" ? "#14130F" : "#F4EFE4");
  }, [resolved]);
  const set = (c: Choice) => {
    setChoice(c);
    try {
      if (c === "system") localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, c);
    } catch {
      /* private mode: the choice lasts this visit */
    }
  };
  return <Ctx.Provider value={{ choice, resolved, set }}>{children}</Ctx.Provider>;
}

export const useTheme = () => useContext(Ctx);
