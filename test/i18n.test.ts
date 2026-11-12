// Language: the dictionaries are complete and keep their placeholders; the endpoints remember the language,
// translate only for signed-in people, and accept a shared calibration result of two numbers.
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { config } from "../src/config.js";
import { openDb, setDb, withWorkspace, type Db } from "../src/db.js";
import { FakePayPal } from "../src/paypal/fake.js";
import { setPayPal } from "../src/paypal/index.js";
import { getWorkspace, seedStatus } from "../src/demo/workspaces.js";
import { demoIds } from "../src/services/seed.js";
import { Client } from "./client.js";
import { serveTracked } from "./journey-coverage.js";
import { langOf, replyIn, withLang, currentLang, PAYPAL_LOCALE } from "../src/lib/lang.js";
import { setFxFetch } from "../src/web/i18n.js";

const en = JSON.parse(readFileSync("public/i18n/en.json", "utf8")).strings as Record<string, string>;
const ph = (s: string) => (s.match(/\{\d\}/g) ?? []).sort().join();

describe("dictionaries", () => {
  for (const lang of ["hi-IN", "id-ID", "pt-BR"]) {
    const d = JSON.parse(readFileSync(`public/i18n/${lang}.json`, "utf8"));
    it(`${lang}: every English string is translated (the CI check for untranslated strings)`, () => {
      const missing = Object.keys(en).filter((k) => !d.strings[k]);
      expect(missing.slice(0, 10)).toEqual([]);
    });
    it(`${lang}: placeholders are kept, and the file says it is machine-translated`, () => {
      const bad = Object.entries(d.strings as Record<string, string>).filter(([k, v]) => ph(k) !== ph(v));
      expect(bad).toEqual([]);
      expect(d.machine).toBe(true);
    });
    it(`${lang}: brand names stay as they are`, () => {
      for (const [k, v] of Object.entries(d.strings as Record<string, string>)) {
        if (/\bPayPal\b/.test(k)) expect(v, k).toMatch(/PayPal/);
        if (/\bStockSure\b/.test(k)) expect(v, k).toMatch(/StockSure/);
      }
    });
  }
  it("Hindi is in Devanagari", () => {
    const d = JSON.parse(readFileSync("public/i18n/hi-IN.json", "utf8")).strings;
    expect(d["Sign out"]).toMatch(/[ऀ-ॿ]/);
  });
});

describe("language on the server", () => {
  it("normalises tags, and English adds nothing to a prompt", () => {
    expect(langOf("hi")).toBe("hi-IN");
    expect(langOf("pt-PT")).toBe("pt-BR");
    expect(langOf("id")).toBe("id-ID");
    expect(langOf("fr")).toBe("en");
    expect(replyIn("en")).toBe("");
    expect(replyIn("hi-IN")).toMatch(/Hindi/);
    expect(PAYPAL_LOCALE["hi-IN"]).toBe("en-IN");
    expect(withLang("id-ID", () => currentLang())).toBe("id-ID");
  });
});

describe("endpoints", () => {
  let db: Db;
  let srv: Awaited<ReturnType<typeof serveTracked>>;
  const saved = { demo: { ...config.demo }, key: config.ai.openaiKey };
  beforeEach(async () => {
    db = await openDb({ memory: true });
    setDb(db);
    const fake = new FakePayPal();
    fake.tokens.add("TOKEN-DEMO-WALLET");
    setPayPal(fake);
    config.ai.openaiKey = "";
    config.demo.vaultToken = "TOKEN-DEMO-WALLET";
    config.demo.vaultPayer = "sandbox-buyer@example.com";
    config.demo.perAddressPerHour = 50;
    srv = await serveTracked(createApp());
  });
  afterEach(async () => {
    Object.assign(config.demo, saved.demo);
    config.ai.openaiKey = saved.key;
    await srv.close();
    setPayPal(null);
    await db.close();
  });

  it("remembers the language, translates only when signed in, records a shared calibration", { timeout: 60000 }, async () => {
    const c = new Client(srv.base);
    const r = await c.postJson("/api/ui/lang", { lang: "pt-BR" });
    expect(r.status).toBe(200);
    expect(r.json.lang).toBe("pt-BR");
    expect(c.cookies.get("ss-lang")).toBe("pt-BR");
    expect((await c.postJson("/api/ui/translate", { lang: "pt-BR", texts: ["hello"] })).status).toBe(401);
    expect((await c.postJson("/demo/start", {})).json.ok).toBe(true);
    const ws = (await c.get("/api/ui/workspace")).json.workspace.id;
    for (let i = 0; i < 400 && !(await seedStatus((await getWorkspace(ws))!)).done; i++) await new Promise((res) => setTimeout(res, 25));
    const ids = await withWorkspace(ws, async () => (await demoIds(db))!);
    expect((await c.post("/login", { person_id: ids.people.sam, next: "/home" })).status).toBe(302);
    await c.postJson("/api/ui/lang", { lang: "hi-IN" });
    const saved = await withWorkspace(ws, async () => (await db.query<{ lang: string }>("SELECT lang FROM people WHERE id = $1", [ids.people.sam])).rows[0]?.lang);
    expect(saved).toBe("hi-IN");
    // No model in tests: the text comes back unchanged rather than failing.
    const t = await c.postJson("/api/ui/translate", { lang: "pt-BR", texts: ["The supplier offers a credit."] });
    expect(t.status).toBe(200);
    expect(t.json.texts).toEqual(["The supplier offers a credit."]);
    expect((await c.postJson("/api/public/handsfree", { mode: "head", head_px: 48, gaze_px: 130 })).status).toBe(200);
    expect((await c.postJson("/api/public/handsfree", {})).status).toBe(400);
    // Local-currency estimate: the published rate with its date, or nothing at all when the source fails.
    setFxFetch((async () => new Response(JSON.stringify({ date: "2026-11-11", rates: { INR: 93.69, IDR: 18175, BRL: 5.5565, EUR: 0.9 } }))) as typeof fetch);
    const fx = (await c.get("/api/public/fx")).json.fx;
    expect(fx.date).toBe("2026-11-11");
    expect(fx.rates).toEqual({ INR: 93.69, IDR: 18175, BRL: 5.5565 });
    expect(fx.source).toMatch(/European Central Bank/);
    setFxFetch((async () => { throw new Error("offline"); }) as typeof fetch);
    expect((await c.get("/api/public/fx")).json.fx).toBeNull();
    setFxFetch(null);
    const a = (await c.get("/api/public/accessibility")).json;
    expect(a.handsfree.shared_runs).toBe(1);
    expect(a.handsfree.median_head_px).toBe(48);
  });
});
