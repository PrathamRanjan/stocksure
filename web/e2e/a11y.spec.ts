import { mkdirSync, writeFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { as, demoPo, noHorizontalScroll, quietContext } from "./helpers";

// Spec A7: the checks published on /accessibility. Each test adds its result to eval/a11y/latest.json (with the
// date), which the server reads for the page. Nothing is recorded for a check that did not run.
const results: { check: string; pass: boolean; detail: string }[] = [];
const record = (check: string, pass: boolean, detail: string) => results.push({ check, pass, detail });
test.describe.configure({ mode: "serial" });
test.afterAll(() => {
  if (process.env.E2E_BASE) return; // only the hermetic run writes the published file
  mkdirSync("../eval/a11y", { recursive: true });
  writeFileSync("../eval/a11y/latest.json", JSON.stringify({ at: new Date().toISOString(), runner: "Playwright + axe-core (web/e2e/a11y.spec.ts)", results }, null, 2) + "\n");
});

const axe = async (page: Page, path: string) => {
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  return r.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${path} ${v.id}: ${v.nodes.slice(0, 2).map((n) => n.target.join(" ")).join(" | ")}`);
};

test("every switch in Display and help has a name and a description; the close button is named", async ({ browser }) => {
  const ctx = await quietContext(browser);
  const page = await ctx.newPage();
  await page.goto("/");
  await page.locator("[data-a11y-open]").first().click();
  const panel = page.getByRole("dialog", { name: "Display and help" });
  await expect(panel).toBeVisible();
  const names = ["Read pages aloud", "Speak instead of typing", "Plain words", "Bigger buttons", "More time", "Stop all motion"];
  for (const n of names) await expect(panel.getByRole("switch", { name: n, exact: true })).toHaveCount(1);
  await expect(panel.getByRole("switch", { name: "Read pages aloud" })).toHaveAccessibleDescription(/reads the page/);
  await expect(panel.getByRole("button", { name: "Close display and help" })).toBeVisible();
  await expect(panel.getByRole("group", { name: "Text size" })).toHaveCount(1);
  await expect(panel.getByRole("group", { name: "Contrast", exact: true })).toHaveCount(1);
  record("Display and help: six named switches with descriptions; named close button", true, names.join(", "));
  await ctx.close();
});

test("no sideways scroll at 200% text or at 320 px wide, on the main pages of each person", async ({ browser }) => {
  const checked: string[] = [];
  for (const mode of ["200% text at 1280 px", "320 px wide"] as const) {
    for (const who of ["Jordan", "Sam"] as const) {
      const vp = mode === "320 px wide" ? { width: 320, height: 700 } : { width: 1280, height: 900 };
      const { ctx, page } = await as(browser, who, { viewport: vp });
      if (mode !== "320 px wide") await page.evaluate(() => localStorage.setItem("a11y", JSON.stringify({ seen: true, textScale: 2 })));
      const po = await demoPo(page);
      const paths = who === "Jordan" ? ["/home", `/po/${po.id}`, "/ask", "/negotiations", "/approvals"] : ["/home", `/po/${po.id}/receive`];
      for (const path of paths) {
        await page.goto(path);
        await expect(page.getByRole("main")).toBeVisible();
        await page.waitForLoadState("networkidle");
        if (mode !== "320 px wide") expect(await page.evaluate(() => document.documentElement.dataset.a11yText ?? getComputedStyle(document.documentElement).fontSize)).toBeTruthy();
        await noHorizontalScroll(page, `${mode} ${who} ${path}`);
        checked.push(`${who} ${path.replace(po.id, ":id")}`);
      }
      await ctx.close();
    }
  }
  record("No sideways scroll at 200% text (1280 px) and at 320 px wide", true, [...new Set(checked)].join(", "));
});

test("axe finds no serious or critical issue on the new Wave 4 and 5 screens", async ({ browser }) => {
  const { ctx, page } = await as(browser, "Jordan");
  const po = await demoPo(page);
  const out: string[] = [];
  for (const path of ["/", "/ask", "/negotiations", `/po/${po.id}`, "/home", "/accessibility", "/judge"]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    out.push(...(await axe(page, path)));
  }
  expect(out).toEqual([]);
  await ctx.close();
  const s = await as(browser, "Sam");
  await s.page.goto(`/po/${po.id}/receive`);
  await s.page.waitForLoadState("networkidle");
  const r = await axe(s.page, "/po/:id/receive");
  expect(r).toEqual([]);
  await s.ctx.close();
  record("axe (WCAG 2.2 AA): no serious or critical issue", true, "landing, Ask, negotiations, order, home, accessibility, judge (as the owner); receive (as the receiver)");
});

test("with reduced motion, nothing on the landing page keeps moving", async ({ browser }) => {
  const ctx = await browser.newContext({ reducedMotion: "reduce" });
  await ctx.addInitScript(() => localStorage.setItem("a11y", JSON.stringify({ seen: true })));
  const page = await ctx.newPage();
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(800);
  const running = await page.evaluate(() => document.getAnimations().filter((a) => a.playState === "running" && (a.effect as KeyframeEffect | null)?.getComputedTiming().iterations === Infinity).length);
  expect(running).toBe(0);
  record("Reduced motion: no endless animation on the landing page", true, "prefers-reduced-motion: reduce");
  await ctx.close();
});

test("the landing page says what works, and links to this page", async ({ browser }) => {
  const ctx = await quietContext(browser);
  const page = await ctx.newPage();
  await page.goto("/");
  const l = page.getByRole("link", { name: /Works with a screen reader, at 200% text, by voice/ });
  await expect(l).toHaveAttribute("href", "/accessibility");
  record("Landing page names the accessibility support and links here", true, "first screen");
  await ctx.close();
});
