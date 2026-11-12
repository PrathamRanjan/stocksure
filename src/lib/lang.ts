/**
 * The language a person chose (English, Hindi, Indonesian, Brazilian Portuguese). The browser keeps it in the
 * ss-lang cookie; each request carries it in AsyncLocalStorage, so AI replies written during that request (and
 * the background work it starts) come back in that language. Code never checks translated words: model outputs
 * that code reads stay codes and enums; only the sentences meant for a person change language.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import type { NextFunction, Request, Response } from "express";

export const LANGS = ["en", "hi-IN", "id-ID", "pt-BR"] as const;
export type Lang = (typeof LANGS)[number];

export const LANG_NAME: Record<Lang, string> = {
  en: "English",
  "hi-IN": "Hindi (हिन्दी, in Devanagari script)",
  "id-ID": "Indonesian (Bahasa Indonesia)",
  "pt-BR": "Brazilian Portuguese (português do Brasil)",
};

/** PayPal's page locale per language; PayPal has no Hindi page, so Hindi uses English (India). */
export const PAYPAL_LOCALE: Record<Lang, string> = { en: "en-US", "hi-IN": "en-IN", "id-ID": "id-ID", "pt-BR": "pt-BR" };

export function langOf(v: unknown): Lang {
  const s = String(v ?? "").toLowerCase();
  if (s.startsWith("hi")) return "hi-IN";
  if (s.startsWith("id")) return "id-ID";
  if (s.startsWith("pt")) return "pt-BR";
  return "en";
}

const store = new AsyncLocalStorage<{ lang: Lang }>();
export const currentLang = (): Lang => store.getStore()?.lang ?? "en";
export const withLang = <T>(lang: Lang, fn: () => T): T => store.run({ lang }, fn);

export function langMiddleware(req: Request, _res: Response, next: NextFunction) {
  const raw = (req.cookies?.["ss-lang"] as string | undefined) ?? (req.headers["x-stocksure-lang"] as string | undefined);
  store.run({ lang: langOf(raw) }, next);
}

/** A line for a system prompt: write for the person in their language. Empty for English, so English is unchanged. */
export function replyIn(lang: Lang = currentLang()): string {
  if (lang === "en") return "";
  return `Write every sentence meant for the person in ${LANG_NAME[lang]}. Keep names of people, companies and products, SKU codes, order numbers, PayPal ids and amounts exactly as they are. The person may write in English, Hindi, Indonesian or Portuguese, or mix Hindi and English; understand any of them.`;
}
