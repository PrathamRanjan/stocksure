import { useEffect, useState } from "react";

type Fx = { date: string; source: string; rates: Record<string, number> } | null;

// Which currency each language sees an estimate in. English shows none.
const CUR: Record<string, { cur: string; locale: string; text: (amt: string, usd: string, date: string) => string }> = {
  "hi-IN": { cur: "INR", locale: "hi-IN", text: (a, u, d) => `लगभग ${a} (${u}, यूरोपियन सेंट्रल बैंक की ${d} की दर से)। PayPal US डॉलर में ही चार्ज करता है; आपके बैंक की दर अलग हो सकती है।` },
  "id-ID": { cur: "IDR", locale: "id-ID", text: (a, u, d) => `Sekitar ${a} (${u}, kurs referensi Bank Sentral Eropa tanggal ${d}). PayPal tetap menagih dalam dolar AS; kurs bank Anda bisa berbeda.` },
  "pt-BR": { cur: "BRL", locale: "pt-BR", text: (a, u, d) => `Cerca de ${a} (${u}, pela taxa de referência do Banco Central Europeu de ${d}). O PayPal cobra em dólares americanos; a taxa do seu banco pode ser diferente.` },
};

let cache: Promise<Fx> | null = null;
const loadFx = () => (cache ??= fetch("/api/public/fx").then((r) => (r.ok ? r.json() : { fx: null })).then((d) => d.fx as Fx).catch(() => null));

function useLang() {
  const [lang, setLang] = useState(() => (window as unknown as { ssI18n?: { lang: string } }).ssI18n?.lang ?? "en");
  useEffect(() => {
    const on = (e: Event) => setLang((e as CustomEvent).detail?.lang ?? "en");
    addEventListener("ssi18n:change", on);
    return () => removeEventListener("ssi18n:change", on);
  }, []);
  return lang;
}

/**
 * Spec B: what a USD amount is roughly worth in the reader's currency, at a published reference rate with its date.
 * Shown only in Hindi, Indonesian and Portuguese, and only when the rate could be fetched. Charges stay in USD.
 */
export function LocalEstimate({ cents }: { cents: number }) {
  const lang = useLang();
  const [fx, setFx] = useState<Fx>(null);
  const c = CUR[lang];
  useEffect(() => {
    if (c) void loadFx().then(setFx);
  }, [c]);
  const rate = c && fx?.rates[c.cur];
  if (!c || !rate || !cents) return null;
  const amt = new Intl.NumberFormat(c.locale, { style: "currency", currency: c.cur, maximumFractionDigits: 0 }).format((cents / 100) * rate);
  const usd = new Intl.NumberFormat(c.locale, { style: "currency", currency: "USD" }).format(cents / 100);
  const date = new Intl.DateTimeFormat(c.locale, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${fx!.date}T00:00:00Z`));
  return (
    <p className="mt-2 text-sm text-muted-foreground" data-no-i18n data-local-estimate={c.cur} lang={lang}>
      {c.text(amt, usd, date)}
    </p>
  );
}
