import { useEffect, useState } from "react";
import { Hand, Languages } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type I18n = { lang: string; langs: { code: string; name: string }[]; set: (l: string) => Promise<boolean>; note: string };
declare global {
  interface Window {
    ssI18n?: I18n;
    lookAndSay?: { toggle: (on?: boolean) => Promise<void>; on: boolean };
  }
}

const FALLBACK = [
  { code: "en", name: "English" },
  { code: "hi-IN", name: "हिन्दी" },
  { code: "id-ID", name: "Bahasa Indonesia" },
  { code: "pt-BR", name: "Português (Brasil)" },
];

/** Spec B1: the language picker, names written in their own language. Switching is instant, nothing is lost. */
export function LangPicker({ className, compact = false }: { className?: string; compact?: boolean }) {
  const [lang, setLang] = useState(() => window.ssI18n?.lang ?? "en");
  useEffect(() => {
    const on = (e: Event) => setLang((e as CustomEvent).detail?.lang ?? window.ssI18n?.lang ?? "en");
    addEventListener("ssi18n:change", on);
    return () => removeEventListener("ssi18n:change", on);
  }, []);
  const langs = window.ssI18n?.langs?.filter((l) => FALLBACK.some((f) => f.code === l.code)) ?? FALLBACK;
  const short: Record<string, string> = { en: "EN", "hi-IN": "हि", "id-ID": "ID", "pt-BR": "PT" };
  return (
    <label className={cn("relative inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-md px-2 text-sm hover:bg-accent", className)} title={window.ssI18n?.note}>
      <Languages className="size-4 shrink-0" aria-hidden="true" />
      <span className="sr-only">Language</span>
      {/* On phones only a short code shows; the native select sits over it, so it still opens the full list. */}
      <span aria-hidden="true" translate="no" className="notranslate text-xs font-bold sm:hidden">{short[lang] ?? "EN"}</span>
      {/* translate="no": the language names are always shown in their own language. */}
      <select translate="no" className={cn("notranslate absolute inset-0 cursor-pointer opacity-0 sm:static sm:min-h-9 sm:rounded sm:border-0 sm:bg-transparent sm:py-1 sm:pr-1 sm:text-sm sm:font-semibold sm:opacity-100 focus-visible:outline-2", compact && "sm:absolute sm:opacity-0")} value={lang} onChange={(e) => void window.ssI18n?.set(e.target.value)}>
        {langs.map((l) => (
          <option key={l.code} value={l.code} lang={l.code}>
            {l.name}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Spec A1.1: the hands-free switch in the header (also Alt+Shift+H, and in the display settings). */
export function HandsFreeButton({ className }: { className?: string }) {
  const [on, setOn] = useState(() => !!window.lookAndSay?.on);
  useEffect(() => {
    const f = (e: Event) => setOn(!!(e as CustomEvent).detail?.on);
    addEventListener("lookandsay:change", f);
    return () => removeEventListener("lookandsay:change", f);
  }, []);
  return (
    <Button variant={on ? "carbon" : "ghost"} size="sm" className={cn("min-h-11 min-w-11", className)} data-ls-toggle aria-pressed={on} title="Hands-free mode: head, eye gaze and voice (Alt+Shift+H)">
      <Hand aria-hidden="true" />
      <span className="sr-only xl:not-sr-only">Hands-free</span>
    </Button>
  );
}
