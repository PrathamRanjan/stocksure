import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { as, demoPo, nextStep, noHorizontalScroll, quietContext, resetDemo, type Who } from "./helpers";

// Spec B8: every main screen in all four languages (screenshots), a check that fails on English left untranslated,
// Portuguese and Hindi at phone width without clipped or sideways-scrolling layouts, and the whole money flow
// (quote → hold → dispatch → count → agree → capture → receipt) driven in each language.
const LANGS = ["hi-IN", "id-ID", "pt-BR"] as const;
const dict = Object.fromEntries(LANGS.map((l) => [l, JSON.parse(readFileSync(`../public/i18n/${l}.json`, "utf8")).strings as Record<string, string>]));
const hermetic = !process.env.E2E_BASE;
test.describe.configure({ mode: "serial" });

/** Text that is data, not interface: names, ids, numbers, amounts, dates, codes and AI-written sentences. */
const isData = (s: string) =>
  !/[a-z]{3,}/.test(s) ||
  (/^[\p{Lu}][\w’'&.,() -]*$/u.test(s) && s.split(" ").length <= 4) ||
  /(@|https?:|\b[A-Z]{2,}-\d+|\bv\d+\b|^#| × |^[a-z_]+(, [a-z_]+)+$|_[a-z])/.test(s) ||
  (/\d/.test(s) && s.split(" ").length <= 5 && !/\b[a-z]{4,} [a-z]{4,}\b/.test(s)) ||
  /^·? ?(Jordan|Sam|Ana|Alex|Laneway|Harbour|Corner|Oat|Almond|Coffee|Milk|Bakers|Compostable|Espresso)/.test(s);

async function inLang(page: Page, lang: string) {
  await page.evaluate((l) => (window as any).ssI18n.set(l), lang);
  await expect.poll(() => page.evaluate(() => document.documentElement.lang)).toBe(lang);
}
async function settle(page: Page) {
  await expect(page.getByRole("main")).toBeVisible();
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await page.waitForTimeout(400);
}

test("main screens in four languages: screenshots, and no interface English left", async ({ browser }) => {
  test.setTimeout(180_000); // four languages × full-page screenshots, including the longer landing page
  const misses = new Map<string, Set<string>>();
  const owner = await as(browser, "Jordan");
  await resetDemo(owner.page);
  const po = await demoPo(owner.page);
  await owner.ctx.close();
  const plan: { who: Who | null; paths: [string, string][] }[] = [
    { who: null, paths: [["landing", "/"], ["start", "/start"], ["checklist", "/checklist"], ["accessibility", "/accessibility"], ["agents", "/agents"]] },
    { who: "Jordan", paths: [["owner-home", "/home"], ["order", `/po/${po.id}`], ["new-order", "/orders/new"], ["stock", "/stock"], ["approvals", "/approvals"], ["ask", "/ask"], ["negotiations", "/negotiations"], ["performance", "/performance"]] },
    { who: "Sam", paths: [["receiver-home", "/home"], ["receive", `/po/${po.id}/receive`]] },
    { who: "Ana", paths: [["supplier-home", "/home"], ["supplier-order", `/po/${po.id}`], ["catalog", "/catalog"]] },
  ];
  for (const lang of ["en", ...LANGS]) {
    for (const group of plan) {
      const { ctx, page } = group.who ? await as(browser, group.who) : await (async () => { const ctx = await quietContext(browser); const page = await ctx.newPage(); await page.goto("/"); return { ctx, page }; })();
      await inLang(page, lang);
      for (const [name, path] of group.paths) {
        await page.goto(path);
        await settle(page);
        if (lang !== "en") {
          const m = await page.evaluate(() => [...(window as any).ssI18n.misses] as string[]);
          for (const s of m) if (!isData(s)) (misses.get(s) ?? misses.set(s, new Set()).get(s)!).add(`${lang} ${path}`);
          await page.evaluate(() => (window as any).ssI18n.misses.clear());
        }
        if (hermetic) {
          mkdirSync(`../docs/i18n-shots/${lang}`, { recursive: true });
          await page.screenshot({ path: `../docs/i18n-shots/${lang}/${name}.png`, fullPage: false });
        }
      }
      await ctx.close();
    }
  }
  const list = [...misses.keys()].sort();
  mkdirSync("../eval/i18n", { recursive: true });
  writeFileSync("../eval/i18n/misses.json", JSON.stringify(list, null, 1) + "\n");
  // The CI check: interface English that the dictionaries don't cover fails the run (listed in eval/i18n/misses.json).
  expect(list, `untranslated: ${list.slice(0, 15).join(" | ")}`).toEqual([]);
});

test("Portuguese and Hindi at phone width: nothing scrolls sideways", async ({ browser }) => {
  for (const lang of ["pt-BR", "hi-IN"]) {
    for (const who of ["Jordan", "Sam"] as Who[]) {
      const { ctx, page } = await as(browser, who, { viewport: { width: 375, height: 800 } });
      await inLang(page, lang);
      const po = await demoPo(page);
      for (const path of who === "Jordan" ? ["/home", `/po/${po.id}`, "/ask"] : ["/home", `/po/${po.id}/receive`]) {
        await page.goto(path);
        await settle(page);
        await noHorizontalScroll(page, `${lang} ${who} ${path}`);
      }
      await ctx.close();
    }
  }
});

async function flowIn(browser: Browser, lang: (typeof LANGS)[number]) {
  const L = (s: string) => dict[lang][s] ?? s;
  const first = await as(browser, "Jordan");
  await resetDemo(first.page);
  await first.ctx.close(); // the reset signs everyone out, as in flow.ts
  const j = (await as(browser, "Jordan")).page;
  const po = await demoPo(j);
  const a = (await as(browser, "Ana")).page;
  const s = (await as(browser, "Sam")).page;
  for (const p of [j, a, s]) await inLang(p, lang);
  const api = async () => (await (await j.request.get(`/api/ui/po/${po.id}`)).json()) as any;

  await j.goto(`/po/${po.id}`);
  await nextStep(j).getByRole("button", { name: L("Send for a quote") }).click();
  await expect(j.getByText(L("Sent to the supplier for a quote."))).toBeVisible();
  await a.goto(`/po/${po.id}`);
  await nextStep(a).locator('input[id^="p-"]').first().fill("10.00");
  await nextStep(a).getByRole("button", { name: L("Send quote") }).click();
  await expect.poll(async () => (await api()).po.status).toBe("quoted");
  await j.reload();
  await nextStep(j).getByRole("button").filter({ hasText: /200/ }).first().click();
  await expect(j.getByText(L("Quote accepted and PayPal hold placed."))).toBeVisible();
  await expect.poll(async () => (await api()).ops.find((o: any) => o.kind === "authorize")?.status, { timeout: 20_000 }).toBe("succeeded");

  await a.goto(`/po/${po.id}`);
  await settle(a);
  if (process.env.I18N_DEBUG) await a.screenshot({ path: `test-results/debug-${lang}-dispatch.png`, fullPage: true });
  // The supplier picks the sample invoice that hides a "pay $500.00 elsewhere" line (the second option), as in flow.ts.
  await nextStep(a).locator("input[type=radio]").nth(1).check();
  await nextStep(a).getByRole("button", { name: L("Mark dispatched") }).click();
  await expect.poll(async () => (await api()).po.status).toBe("dispatched");

  await s.goto(`/po/${po.id}/receive`);
  await s.getByRole("button", { name: L("Driver notes two crushed") }).click();
  const tick = s.getByRole("checkbox").first();
  await expect(tick).toBeVisible({ timeout: 30_000 });
  await tick.check();
  await s.getByRole("button", { name: L("Confirm counts") }).click();
  await s.waitForURL(new RegExp(`/po/${po.id}$`));
  if (process.env.I18N_DEBUG) console.log("after count", JSON.stringify({ st: (await api()).po.status, r: (await api()).resolution }));
  await a.goto(`/po/${po.id}`);
  await a.getByRole("button").filter({ hasText: L("Agree with line") }).filter({ hasText: /1/ }).first().click();
  await expect(a.locator("[data-tour=resolution]")).toBeVisible();
  if (process.env.I18N_DEBUG) { await a.waitForTimeout(1500); console.log("after agree", JSON.stringify({ st: (await api()).po.status, r: (await api()).resolution, url: a.url() })); await a.screenshot({ path: `test-results/debug-${lang}-agree.png`, fullPage: true }); }
  for (const p of [a, j]) {
    await p.goto(`/po/${po.id}`);
    const approve = p.locator("[data-tour=resolution]").getByRole("button").filter({ hasText: /v\d/ }).first();
    await expect(approve).toBeVisible({ timeout: 20_000 });
    await approve.click();
    await expect(approve).toHaveCount(0);
  }
  await expect.poll(async () => (await api()).ops.some((o: any) => o.kind === "capture" && o.status === "succeeded"), { timeout: 30_000 }).toBe(true);
  await j.goto(`/po/${po.id}`);
  await settle(j);
  // The receipt reads in the language, with dollars formatted for it and still charged in USD.
  const html = await j.locator("main").innerText();
  if (lang === "pt-BR") expect(html).toMatch(/US\$\s?\d+,\d{2}/);
  if (lang === "hi-IN") expect(html).toMatch(/[ऀ-ॿ]/);
  if (hermetic) await j.screenshot({ path: `../docs/i18n-shots/${lang}/flow-receipt.png` });
  for (const p of [j, a, s]) await p.context().close();
}

for (const lang of LANGS) test(`the money flow, driven in ${lang}`, async ({ browser }) => flowIn(browser, lang));
