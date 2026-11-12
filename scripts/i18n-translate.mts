/**
 * Machine-translates public/i18n/en.json into hi-IN, id-ID and pt-BR with OpenAI, keeping placeholders, brand,
 * merchant and product names, and amounts as they are, with one glossary per language so key terms stay
 * consistent. Only strings missing from a language's file are sent. The key is read from .env and never printed.
 *   npx tsx scripts/i18n-translate.mts [hi-IN id-ID pt-BR]
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const root = new URL("..", import.meta.url).pathname;
const env = Object.fromEntries(
  readFileSync(root + ".env", "utf8")
    .split("\n")
    .map((l) => /^([A-Z0-9_]+)=(.*)$/.exec(l.trim()))
    .filter(Boolean)
    .map((m) => [m![1], m![2].replace(/^["']|["']$/g, "")]),
);
const KEY = process.env.OPENAI_API_KEY || env.OPENAI_API_KEY;
const MODEL = process.env.I18N_MODEL || env.AI_MODEL_READ || "gpt-6.1-sol";
if (!KEY) throw new Error("OPENAI_API_KEY is not set");

const NAMES: Record<string, string> = { "hi-IN": "Hindi (Devanagari script, everyday Hindi as used in Indian shopping and banking apps; common English loanwords such as ऑर्डर, पेमेंट are fine)", "id-ID": "Indonesian (Bahasa Indonesia, everyday app wording)", "pt-BR": "Brazilian Portuguese" };
const GLOSSARY: Record<string, Record<string, string>> = {
  "hi-IN": { hold: "होल्ड", "place a hold": "होल्ड लगाएँ", capture: "कैप्चर", release: "रिलीज़", order: "ऑर्डर", supplier: "सप्लायर", wholesaler: "थोक विक्रेता", owner: "मालिक", receiver: "माल लेने वाला", receipt: "रसीद", count: "गिनती", dispute: "विवाद", refund: "रिफ़ंड", invoice: "इनवॉइस", quote: "कोटेशन", approve: "मंज़ूर करें", "spend limit": "खर्च सीमा", café: "कैफ़े", delivery: "डिलीवरी", damaged: "खराब", short: "कम आया", agent: "एजेंट", demo: "डेमो", "sign in": "साइन इन" },
  "id-ID": { hold: "dana ditahan", "place a hold": "tahan dana", capture: "tarik dana", release: "lepaskan", order: "pesanan", supplier: "pemasok", wholesaler: "grosir", owner: "pemilik", receiver: "penerima barang", receipt: "tanda terima", count: "hitungan", dispute: "sengketa", refund: "pengembalian dana", invoice: "faktur", quote: "penawaran harga", approve: "setujui", "spend limit": "batas belanja", café: "kafe", delivery: "pengiriman", damaged: "rusak", short: "kurang", agent: "agen", demo: "demo", "sign in": "masuk" },
  "pt-BR": { hold: "reserva", "place a hold": "fazer a reserva", capture: "captura", release: "liberar", order: "pedido", supplier: "fornecedor", wholesaler: "atacadista", owner: "dono", receiver: "recebedor", receipt: "recibo", count: "contagem", dispute: "disputa", refund: "reembolso", invoice: "fatura", quote: "orçamento", approve: "aprovar", "spend limit": "limite de gastos", café: "café", delivery: "entrega", damaged: "avariado", short: "faltando", agent: "agente", demo: "demo", "sign in": "entrar" },
};
const KEEP = "StockSure, PayPal, Harbour Wholesale, Harbour, Corner Café, Jordan, Sam, Ana, Alex, AG Grid, Bryntum, MCP, OpenAI, gpt-live-1, Decisions, Telegram, QR, API, JSON, CSV, Excel, SKU codes (like ALM-12), order numbers, ids, emails and URLs";

async function translate(lang: string, batch: string[]): Promise<string[]> {
  const system = `You translate the user interface of StockSure, an app where a café and its wholesaler agree what arrived on a delivery and PayPal then charges only for that. Translate each English string into ${NAMES[lang]}.
Rules:
- Return exactly one translation per input, in the same order.
- Keep placeholders such as {0} and {1} exactly, and move them where the grammar needs them.
- Keep these untranslated: ${KEEP}. Keep amounts, numbers, units, dates and punctuation marks such as →, ·, …, ✓.
- Use this glossary for consistency: ${JSON.stringify(GLOSSARY[lang])}.
- Short labels stay short (buttons, tabs, column headers). Use plain, friendly words; address the person politely.
- A string may be a fragment of a sentence; translate it so it still reads naturally when joined.
- Never add explanations.`;
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${KEY}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        instructions: system,
        input: JSON.stringify({ strings: batch }),
        text: { format: { type: "json_schema", name: "t", strict: true, schema: { type: "object", additionalProperties: false, required: ["t"], properties: { t: { type: "array", items: { type: "string" } } } } } },
        store: false,
      }),
      signal: AbortSignal.timeout(180_000),
    });
    if (!r.ok) {
      const body = (await r.text()).slice(0, 200);
      console.error(`  ${lang}: OpenAI ${r.status} ${body}`);
      await new Promise((s) => setTimeout(s, 2000 * (attempt + 1)));
      continue;
    }
    const j = await r.json();
    const text = j.output?.flatMap((o: any) => o.content ?? []).find((c: any) => c.type === "output_text")?.text;
    const t = JSON.parse(text).t as string[];
    if (t.length === batch.length) return t;
    console.error(`  ${lang}: got ${t.length} for ${batch.length}, retrying`);
  }
  throw new Error(`${lang}: batch failed`);
}

const en = JSON.parse(readFileSync(root + "public/i18n/en.json", "utf8")).strings as Record<string, string>;
const langs = process.argv.slice(2).length ? process.argv.slice(2) : ["hi-IN", "id-ID", "pt-BR"];
await Promise.all(
  langs.map(async (lang) => {
    const file = `${root}public/i18n/${lang}.json`;
    const have: Record<string, string> = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")).strings : {};
    const todo = Object.keys(en).filter((k) => !have[k]);
    console.log(`${lang}: ${todo.length} to translate`);
    const size = 100;
    const batches: string[][] = [];
    for (let i = 0; i < todo.length; i += size) batches.push(todo.slice(i, i + size));
    let done = 0;
    const work = async () => {
      for (let b = batches.shift(); b; b = batches.shift()) {
        const t = await translate(lang, b);
        b.forEach((k, i) => {
          const v = t[i];
          // A translation that dropped or invented a placeholder is not kept.
          const ph = (s: string) => (s.match(/\{\d\}/g) ?? []).sort().join();
          if (v && ph(v) === ph(k)) have[k] = v;
        });
        done += b.length;
        writeFileSync(file, JSON.stringify({ v: 1, lang, machine: true, model: MODEL, at: new Date().toISOString().slice(0, 10), strings: Object.fromEntries(Object.entries(have).filter(([k]) => en[k])) }, null, 1) + "\n");
        console.log(`  ${lang}: ${done}/${todo.length}`);
      }
    };
    await Promise.all([work(), work(), work()]);
  }),
);
