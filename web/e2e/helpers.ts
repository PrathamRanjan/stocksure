import { expect, type Browser, type BrowserContext, type Page } from "@playwright/test";

export type Who = "Jordan" | "Sam" | "Ana";
const NAMES: Record<Who, string> = { Jordan: "Jordan Lee", Sam: "Sam Ortiz", Ana: "Ana Ruiz" };

/** A fresh browser context with the first-run tours and the display prompt already dismissed. */
export async function quietContext(browser: Browser, opts: { tours?: boolean; viewport?: { width: number; height: number }; theme?: "light" | "dark" } = {}) {
  const ctx = await browser.newContext({ viewport: opts.viewport ?? { width: 1280, height: 900 }, colorScheme: opts.theme ?? "light" });
  await ctx.addInitScript(([tours, theme]) => {
    try {
      if (theme) localStorage.setItem("ss-theme", String(theme));
      if (!tours) for (const r of ["owner", "receiving", "supplier"]) localStorage.setItem(`ss-tour-seen-${r}`, "1");
      localStorage.setItem("a11y", JSON.stringify({ seen: true }));
    } catch {}
  }, [!!opts.tours, opts.theme ?? ""] as const);
  return ctx;
}

export async function signIn(page: Page, who: Who) {
  await page.goto("/login");
  await page.getByRole("list", { name: "People in the demo" }).getByRole("button", { name: new RegExp(NAMES[who]) }).click();
  await page.waitForURL(/\/home/);
  await expect(page.getByRole("main")).toBeVisible();
}

export async function as(browser: Browser, who: Who, opts?: Parameters<typeof quietContext>[1]): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await quietContext(browser, opts);
  const page = await ctx.newPage();
  await signIn(page, who);
  return { ctx, page };
}

export async function resetDemo(page: Page) {
  const r = await page.request.post("/demo/reset", { form: { keep: "1" }, headers: { "x-stocksure-ui": "1" } });
  expect(r.ok()).toBeTruthy();
}

export async function demoPo(page: Page): Promise<{ id: string; number: string }> {
  const r = await page.request.get("/api/ui/demo");
  const j = await r.json();
  return { id: j.po.id, number: j.po.number };
}

export const nextStep = (page: Page) => page.locator("[data-tour=next-step]");

/** No element pushes the page wider than the viewport. On failure, names the element that does. */
export async function noHorizontalScroll(page: Page, label = page.url()) {
  const r = await page.evaluate(() => {
    const de = document.documentElement;
    const over = de.scrollWidth - de.clientWidth;
    if (over <= 0) return { over, culprit: "" };
    // Hide each child in turn; the deepest element whose removal fixes it is the culprit.
    let culprit = "";
    const walk = (el: Element) => {
      for (const c of [...el.children] as HTMLElement[]) {
        const prev = c.style.display;
        c.style.display = "none";
        const fixed = de.scrollWidth - de.clientWidth <= 0;
        c.style.display = prev;
        if (fixed) {
          culprit = `${c.tagName}.${String(c.className).slice(0, 80)} “${(c.textContent || "").slice(0, 60)}”`;
          walk(c);
          return;
        }
      }
    };
    walk(document.body);
    return { over, culprit };
  });
  expect(r.over, `${label} scrolls sideways by ${r.over}px; culprit: ${r.culprit}`).toBeLessThanOrEqual(0);
}
