// Phone-size screenshots of the app's web build through the preview proxy (scripts/web-preview.mjs).
// Signs in through the server's own demo login, the same request the app's sign-in screen sends.
//   BASE  preview URL (default http://localhost:8471)
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(fileURLToPath(new URL("../../web/package.json", import.meta.url)));
const { chromium } = require("playwright");
const BASE = process.env.BASE || "http://localhost:8471";
const out = (n) => fileURLToPath(new URL(`../docs/screenshots/${n}.png`, import.meta.url));

const browser = await chromium.launch();
async function phone(scheme) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: scheme, reducedMotion: "reduce", hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/sign-in`);
  return { ctx, page };
}
async function as(page, first) {
  await page.evaluate(async (first) => {
    const h = { "X-StockSure-UI": "1" };
    const ppl = (await (await fetch("/api/ui/people")).json()).people;
    const p = ppl.find((x) => x.first === first);
    await fetch("/logout", { method: "POST", headers: h });
    await fetch("/login", { method: "POST", headers: { ...h, "Content-Type": "application/x-www-form-urlencoded" }, body: `person_id=${p.id}` });
  }, first);
}
async function shot(page, path, name, { full = false, settle = 1800 } = {}) {
  await page.goto(`${BASE}${path}`);
  await page.waitForTimeout(settle);
  await page.screenshot({ path: out(name), fullPage: full });
  console.log("saved", name);
}
const orders = async (page) => page.evaluate(async () => (await (await fetch("/api/ui/home")).json()).orders);

for (const scheme of ["light", "dark"]) {
  const { ctx, page } = await phone(scheme);
  await page.evaluate(() => fetch("/logout", { method: "POST", headers: { "X-StockSure-UI": "1" } }));
  await shot(page, "/sign-in", `${scheme}-01-sign-in`);
  await as(page, "Jordan");
  await shot(page, "/", `${scheme}-02-orders-owner`);
  const o = (await orders(page)).filter((x) => !x.history);
  const main = o.find((x) => x.kind !== "replacement") ?? o[0];
  const rep = o.find((x) => x.kind === "replacement");
  if (main) {
    await shot(page, `/order/${main.id}`, `${scheme}-03-order-top`);
    // Scroll the order's own ScrollView to the agreement and the PayPal record.
    for (const [label, name] of [["The agreement", "04-order-agreement"], ["PayPal activity", "05-order-paypal"]]) {
      await page.getByText(label, { exact: true }).first().scrollIntoViewIfNeeded();
      await page.waitForTimeout(400);
      await page.screenshot({ path: out(`${scheme}-${name}`) });
      console.log("saved", `${scheme}-${name}`);
    }
  }
  if (rep) await shot(page, `/order/${rep.id}`, `${scheme}-06-replacement`);
  await shot(page, "/approvals", `${scheme}-07-approvals`);
  await shot(page, "/account", `${scheme}-08-account`);
  await as(page, "Sam");
  await shot(page, "/", `${scheme}-09-deliveries-receiving`);
  if (rep) await shot(page, `/order/${rep.id}/receive`, `${scheme}-10-receive`);
  await as(page, "Ana");
  await shot(page, "/", `${scheme}-11-orders-supplier`);
  await ctx.close();
}
await browser.close();
