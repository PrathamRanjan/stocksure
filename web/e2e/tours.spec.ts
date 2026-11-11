import { expect, test } from "@playwright/test";
import { as, quietContext, resetDemo } from "./helpers";

/** Spec A3.3: no tour starts by itself; a tour starts from a button, stays on its page and ends on any route change. */
const pop = (p: import("@playwright/test").Page) => p.locator(".driver-popover");

test("no tour opens by itself on the landing, judge or home page", async ({ browser }) => {
  const ctx = await quietContext(browser, { tours: true });
  const p = await ctx.newPage();
  await resetDemo(p);
  for (const path of ["/", "/judge", "/?tour=judge"]) {
    await p.goto(path);
    await p.waitForTimeout(1500);
    await expect(pop(p)).toHaveCount(0);
  }
  await ctx.close();
  const { ctx: c2, page } = await as(browser, "Jordan", { tours: true });
  await page.waitForTimeout(1800);
  await expect(pop(page)).toHaveCount(0);
  await c2.close();
});

test("the tour button tours this page; moving to another page ends it without bouncing back", async ({ browser }) => {
  const { ctx, page } = await as(browser, "Jordan");
  await page.getByRole("button", { name: /Take the tour/ }).first().click();
  await expect(pop(page)).toBeVisible();
  await expect(pop(page).locator(".driver-popover-title")).toHaveText("What needs you");
  await pop(page).getByRole("button", { name: /Next/ }).click();
  await expect(pop(page).locator(".driver-popover-progress-text")).toContainText(/^2 of/);
  await page.keyboard.press("Escape");
  await expect(pop(page)).toHaveCount(0);
  // Start again, then navigate: the tour ends and the URL stays where the person went.
  await page.getByRole("button", { name: /Take the tour/ }).first().click();
  await expect(pop(page)).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expect(pop(page).locator(".driver-popover-progress-text")).toContainText(/^2 of/);
  await page.evaluate(() => {
    history.pushState({}, "", "/approvals");
    dispatchEvent(new PopStateEvent("popstate"));
  });
  await expect(page).toHaveURL(/\/approvals$/);
  await expect(pop(page)).toHaveCount(0);
  await page.waitForTimeout(800);
  await expect(page).toHaveURL(/\/approvals$/);
  await ctx.close();
});
