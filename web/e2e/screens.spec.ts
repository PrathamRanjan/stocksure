import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { as, quietContext } from "./helpers";
import { start, toAgreed, toCounting, toDispatched, toHeld } from "./flow";

// Screenshots for docs/screenshots: 375, 768 and 1440 wide, light and dark. Run with SHOTS=1.
test.skip(!process.env.SHOTS, "set SHOTS=1 to write screenshots");
test.setTimeout(300_000);

const OUT = new URL("../../docs/screenshots/", import.meta.url).pathname;
const SIZES = [
  { w: 375, h: 812 },
  { w: 768, h: 1024 },
  { w: 1440, h: 900 },
];
const THEMES = ["light", "dark"] as const;
const combos = SIZES.flatMap((v) => THEMES.map((t) => ({ ...v, t })));

async function shot(p: Page, name: string, w: number, t: string, full = false) {
  await p.waitForLoadState("networkidle");
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(350);
  await p.screenshot({ path: `${OUT}${name}-${w}-${t}.png`, fullPage: full, animations: "disabled" });
}

test("screenshots", async ({ browser }) => {
  mkdirSync(OUT, { recursive: true });
  const cast = await start(browser);
  await toHeld(cast);
  await toDispatched(cast);
  await toCounting(cast);
  const { po } = cast;

  for (const c of combos) {
    const vp = { width: c.w, height: c.h };
    // Signed out: landing, sign-in, the judge tour's first step, the demo page.
    const ctx = await quietContext(browser, { viewport: vp, theme: c.t });
    const p = await ctx.newPage();
    await p.goto("/");
    await shot(p, "01-landing", c.w, c.t, c.w === 1440 && c.t === "light");
    await p.goto("/login");
    await shot(p, "02-sign-in", c.w, c.t);
    await p.goto("/?tour=judge");
    await expect(p.locator(".driver-popover")).toBeVisible();
    await shot(p, "08-judge-tour", c.w, c.t);
    await ctx.close();
    // Sam counting the delivery.
    const sam = await as(browser, "Sam", { viewport: vp, theme: c.t });
    await sam.page.goto(`/po/${po.id}/receive`);
    await expect(sam.page.getByRole("checkbox", { name: /I checked the goods/ })).toBeVisible({ timeout: 30_000 });
    await shot(sam.page, "04-receive-counts", c.w, c.t);
    await sam.ctx.close();
  }

  await toAgreed(cast);
  for (const c of combos) {
    const vp = { width: c.w, height: c.h };
    const jordan = await as(browser, "Jordan", { viewport: vp, theme: c.t });
    const j = jordan.page;
    await j.goto("/home");
    await shot(j, "03-owner-home", c.w, c.t);
    await j.goto(`/po/${po.id}`);
    await expect(j.locator("[data-tour=resolution]")).toBeVisible();
    await shot(j, "05-order-agreed", c.w, c.t);
    await j.locator("[data-tour=money]").scrollIntoViewIfNeeded();
    await shot(j, "06-order-money-paypal", c.w, c.t);
    await j.goto("/approvals");
    await shot(j, "07-approvals", c.w, c.t);
    await j.goto("/demo");
    await shot(j, "09-demo-controls", c.w, c.t);
    await jordan.ctx.close();
    const ana = await as(browser, "Ana", { viewport: vp, theme: c.t });
    await ana.page.goto("/home");
    await shot(ana.page, "10-supplier-home", c.w, c.t);
    await ana.ctx.close();
  }
});
