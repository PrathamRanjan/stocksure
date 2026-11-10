import { expect, test } from "@playwright/test";
import { as, quietContext, resetDemo } from "./helpers";

const pop = (p: import("@playwright/test").Page) => p.locator(".driver-popover");

test("judge tour runs end to end across pages, signs in as Jordan, and survives reloads", async ({ browser }) => {
  const ctx = await quietContext(browser);
  const p = await ctx.newPage();
  await resetDemo(p);
  await p.goto("/?tour=judge");
  await expect(pop(p).locator(".driver-popover-title")).toHaveText("Pay for what actually arrived");
  const titles = [
    "Who does what", "Three people, two companies", "What needs Jordan", "One next step at a time", "The tally strip",
    "Where the money is", "Agree once, pay exactly that", "Live PayPal sandbox", "Paperwork can't move money",
    "Held for the owner", "What's live, what's simulated", "Run the whole loop",
  ];
  for (const [i, t] of titles.entries()) {
    await pop(p).getByRole("button", { name: /Next|Finish|Sign in and continue/ }).click();
    await expect(pop(p).locator(".driver-popover-title")).toHaveText(t, { timeout: 15_000 });
    if (i === 5) {
      // Mid-tour reload keeps the step.
      await p.reload();
      await expect(pop(p).locator(".driver-popover-title")).toHaveText(t, { timeout: 15_000 });
    }
  }
  await expect(p).toHaveURL(/\/demo/);
  await pop(p).getByRole("button", { name: /Finish/ }).click();
  await expect(pop(p)).toHaveCount(0);
  // The persistent button starts it again.
  await expect(p.getByRole("button", { name: /Take the tour/ }).first()).toBeVisible();
  await ctx.close();
});

test("first-run tour shows once per persona and 'Don't show again' sticks", async ({ browser }) => {
  for (const who of ["Jordan", "Sam", "Ana"] as const) {
    const { ctx, page } = await as(browser, who, { tours: true });
    await expect(pop(page)).toBeVisible({ timeout: 10_000 });
    await expect(pop(page).locator(".driver-popover-progress-text")).toContainText(/1 of [4-8]/);
    await pop(page).getByRole("button", { name: /Don.t show again/ }).click();
    await expect(pop(page)).toHaveCount(0);
    await page.reload();
    await page.waitForTimeout(1600);
    await expect(pop(page)).toHaveCount(0);
    await ctx.close();
  }
});

test("Escape closes a tour and keyboard arrows move it", async ({ browser }) => {
  const ctx = await quietContext(browser);
  const p = await ctx.newPage();
  await p.goto("/?tour=judge");
  await expect(pop(p)).toBeVisible();
  await p.keyboard.press("ArrowRight");
  await expect(pop(p).locator(".driver-popover-title")).toHaveText("Who does what");
  await p.keyboard.press("Escape");
  await expect(pop(p)).toHaveCount(0);
  await ctx.close();
});
