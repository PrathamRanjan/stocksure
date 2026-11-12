// Captures real StockSure screens from the live demo for the motion graphics videos.
// Follows the /judge paths with the page's own buttons in a private demo workspace.
import { chromium } from "/Users/prathamranjan/Documents/Codex/2026-11-02/w/stocksure/web/node_modules/playwright/index.mjs";
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = process.env.BASE ?? "https://pph-stocksure.onrender.com";
const OUT = new URL("./shots/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

const browser = await chromium.launch();
const init = () => {
  try {
    localStorage.setItem("a11y", JSON.stringify({ seen: true }));
    for (const r of ["owner", "receiving", "supplier"]) localStorage.setItem(`ss-tour-seen-${r}`, "1");
  } catch {}
};
const desk = await browser.newContext({ baseURL: BASE, viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, colorScheme: "light" });
await desk.addInitScript(init);
const p = await desk.newPage();

async function phone() {
  const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, colorScheme: "light", storageState: await desk.storageState() });
  await ctx.addInitScript(init);
  return ctx.newPage();
}
async function shot(page, name, opts = {}) {
  try {
    await page.waitForTimeout(opts.wait ?? 900);
    if (opts.sel) {
      const l = page.locator(opts.sel).first();
      await l.scrollIntoViewIfNeeded();
      await l.screenshot({ path: `${OUT}${name}.png` });
    } else {
      if (opts.scrollTo) await page.locator(opts.scrollTo).first().evaluate((e) => e.scrollIntoView({ block: "start" }));
      if (opts.scrollTo) await page.evaluate(() => window.scrollBy(0, -90));
      await page.screenshot({ path: `${OUT}${name}.png`, fullPage: !!opts.full });
    }
    log("shot", name);
  } catch (e) {
    log("SHOT FAILED", name, e.message.split("\n")[0]);
  }
}
const step = (key) => p.locator(`[data-step="${key}"]`);
async function openStep(key) {
  await p.goto("/judge");
  const b = step(key).getByRole("button");
  await b.waitFor({ state: "visible", timeout: 60_000 });
  for (let i = 0; i < 60 && !(await b.isEnabled()); i++) await p.waitForTimeout(1000);
  await Promise.all([p.waitForURL((u) => !u.pathname.startsWith("/judge"), { timeout: 30_000 }), b.click()]);
  await p.waitForLoadState("networkidle").catch(() => {});
}
async function ticked(key, timeout = 90_000) {
  const t = Date.now();
  while (Date.now() - t < timeout) {
    const j = await (await p.request.get("/api/public/judge")).json();
    const s = j.paths.flatMap((x) => x.steps).find((s) => s.key === key);
    if (s?.done) return true;
    await p.waitForTimeout(2000);
  }
  log("not ticked", key);
  return false;
}
async function approve() {
  const b = p.locator("[data-tour=resolution]").getByRole("button", { name: /Approve v\d+/ });
  await b.waitFor({ timeout: 30_000 });
  await b.click();
  await b.waitFor({ state: "detached", timeout: 30_000 }).catch(() => {});
}

// Wake the free-plan service, then start a private demo.
for (let i = 0; i < 60; i++) {
  const ok = await p.request.get("/api/public/judge", { timeout: 20_000 }).then((r) => r.ok() && (r.headers()["content-type"] ?? "").includes("json")).catch(() => false);
  if (ok) break;
  log("waiting for the service to wake");
  await p.waitForTimeout(5000);
}
await p.goto("/judge");
await shot(p, "judge-page");
await p.getByRole("link", { name: /Start your own demo/ }).click();
for (let i = 0; i < 75; i++) {
  const w = await (await p.request.get("/api/ui/workspace")).json().catch(() => null);
  if (w?.seed?.done) break;
  await p.waitForTimeout(2000);
}
log("seeded");

// Path A: short delivery. Door photo first (phone), then the docket.
await openStep("counted");
const receiveUrl = p.url();
await shot(p, "receive-desktop");
const ph = await phone();
await ph.goto(receiveUrl);
await shot(ph, "phone-receive-top", { wait: 2000 });
await ph.locator('[data-sample="photo"]').click();
await ph.locator("[data-door-photo]").first().waitFor({ timeout: 120_000 }).catch(() => log("no door photo result"));
await shot(ph, "phone-door-photo-result", { scrollTo: "[data-door-photo]" });
await ph.context().close();
await p.reload();
await p.getByRole("button", { name: "Driver notes two crushed" }).click();
await p.getByText(/line read/).first().waitFor({ timeout: 120_000 }).catch(() => log("no line read"));
await p.waitForTimeout(2000);
await shot(p, "receive-read");
await shot(p, "receive-read-full", { full: true });
await p.getByRole("checkbox", { name: /I checked the goods/ }).check({ timeout: 60_000 });
await p.getByRole("button", { name: "Confirm counts" }).click();
await p.waitForURL(/\/po\/[^/]+$/, { timeout: 60_000 });
const poA = p.url();
await shot(p, "order-counted");
await ticked("counted");
await openStep("supplier_agreed");
await p.getByRole("button", { name: /Agree with line 1/ }).click();
await p.waitForTimeout(2500);
await shot(p, "resolution-card", { sel: "[data-tour=resolution]" });
await shot(p, "order-resolution-page", { scrollTo: "[data-tour=resolution]" });
await approve();
await ticked("supplier_agreed");
await openStep("resolution_approved");
const ph2 = await phone();
await ph2.goto(p.url());
await shot(ph2, "phone-order-approve", { wait: 2500, scrollTo: "[data-tour=resolution]" });
await ph2.context().close();
await approve();
await ticked("resolution_approved");
await ticked("captured", 150_000);
await p.goto(poA);
await p.waitForTimeout(3000);
await shot(p, "order-settled-top");
await shot(p, "money-panel", { sel: "[data-tour=money]" });
await shot(p, "paypal-ops", { sel: "[data-tour=paypal-ops]" });
try {
  await p.getByRole("button", { name: /Check against PayPal/ }).click();
  await p.locator("[data-reconcile-summary]").waitFor({ timeout: 60_000 });
  await shot(p, "reconcile", { sel: "[data-reconcile]" });
  await shot(p, "money-panel-reconciled", { sel: "[data-tour=money]" });
} catch (e) {
  log("reconcile failed", e.message.split("\n")[0]);
}
const ph3 = await phone();
await ph3.goto(poA);
await shot(ph3, "phone-money", { wait: 3000, scrollTo: "[data-tour=money]" });
await ph3.context().close();

// Path: bad invoice and the duplicate.
await openStep("invoice_caught");
const poInv = p.url();
await p.getByRole("button", { name: "Send a bad invoice" }).click();
await ticked("invoice_caught", 150_000);
await p.goto(poInv);
await p.waitForTimeout(3000);
await shot(p, "invoice-order-top");
await shot(p, "invoice-flags", { scrollTo: "#inv" });
await shot(p, "invoice-full", { full: true });
await openStep("duplicate_caught");
await p.getByRole("button", { name: /Send the last invoice again/ }).click();
await ticked("duplicate_caught", 150_000);
await p.goto(poInv);
await p.waitForTimeout(3000);
await shot(p, "invoice-dup", { scrollTo: "#inv" });
await shot(p, "invoice-dup-full", { full: true });

// Path: the agents settle a shortfall.
await openStep("agents_agreed");
const poAg = p.url();
const agId = new URL(poAg).pathname.split("/")[2];
await shot(p, "agents-before", { scrollTo: "#agent-runs" });
await p.getByRole("button", { name: /Send the agents in/ }).click();
let talk;
for (let i = 0; i < 70; i++) {
  talk = (await (await p.request.get(`/api/ui/po/${agId}/agents`)).json()).latest;
  if (/^(agreed|failed|walked_away)$/.test(talk?.status ?? "")) break;
  await p.waitForTimeout(3000);
}
writeFileSync(`${OUT}agents.json`, JSON.stringify(talk, null, 1));
log("agents", talk?.status);
await p.goto(poAg);
await p.waitForTimeout(3000);
await shot(p, "agents-moves", { scrollTo: "#agent-runs" });
await shot(p, "agents-section", { sel: "#agent-runs" });
await shot(p, "agents-full", { full: true });
await ticked("agents_agreed", 30_000);
for (const key of ["agents_supplier_ok", "agents_settled"]) {
  await openStep(key);
  await approve();
  await ticked(key, 150_000);
}
await p.goto(poAg);
await p.waitForTimeout(3000);
await shot(p, "agents-settled-money", { sel: "[data-tour=money]" });
await p.goto("/negotiations");
await shot(p, "negotiations-list", { wait: 2500 });

// Owner home with Protected this month, the guard console and the ledger.
await p.goto("/");
await shot(p, "home-protected", { wait: 3000 });
await shot(p, "protected-card", { sel: "#protected-title >> xpath=ancestor::section[1]" });
for (const [path, name] of [["/guard", "guard"], ["/ledger", "ledger"], ["/deliveries", "deliveries"], ["/proof", "proof"]]) {
  await p.goto(path);
  await shot(p, name, { wait: 4000 });
}
await browser.close();
log("done");
