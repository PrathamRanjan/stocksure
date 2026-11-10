import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { as, demoPo, noHorizontalScroll, quietContext } from "./helpers";
import { start, toAgreed, toCounting, toDispatched, toHeld } from "./flow";

// The whole loop, one person per browser context: Jordan orders, Ana quotes and ships, Sam counts a short
// delivery, both sides approve the fix, and PayPal (the fake, here) captures exactly what was accepted.
test.describe.configure({ mode: "serial" });

test("owner, supplier and receiver take the demo order from draft to paid", async ({ browser }) => {
  const cast = await start(browser);
  const { j, a, s, po } = cast;
  await j.goto("/home");
  await expect(j.locator("[data-tour=needs]")).toBeVisible();
  await toHeld(cast);
  // The supplier never sees the buyer's PayPal details; the buyer's timeline shows the hold.
  expect((await (await a.request.get(`/api/ui/po/${po.id}`)).json()).paypal).toBeNull();
  await j.reload();
  await expect(j.locator("[data-tour=paypal-ops]")).toContainText(/Hold placed/);
  await toDispatched(cast);
  // Receiving can't start orders.
  await expect(s.getByRole("link", { name: /New order/ })).toHaveCount(0);
  await toCounting(cast);
  await toAgreed(cast);
  // PayPal captured exactly what was accepted, never the invoice total.
  const m = await (await j.request.get(`/api/ui/po/${po.id}`)).json();
  const cap = m.ops.find((o: any) => o.kind === "capture" && o.status === "succeeded");
  expect(cap.amount_cents).toBe(m.resolution.totals.accepted_cents);
  expect(cap.amount_cents).toBeLessThan(m.quote_total_cents);
  await j.reload();
  await expect(j.locator("[data-tour=money]")).toBeVisible();
  await expect(j.locator("[data-tour=paypal-ops]")).toContainText(/Captured|Charged|Capture/);
});

test("each persona's home and order pages pass axe and fit a 360 px screen", async ({ browser }) => {
  for (const who of ["Jordan", "Sam", "Ana"] as const) {
    const { ctx, page } = await as(browser, who, { viewport: { width: 360, height: 780 } });
    const po = await demoPo(page);
    for (const path of ["/home", `/po/${po.id}`, ...(who === "Jordan" ? ["/approvals", "/stock", "/performance"] : who === "Ana" ? ["/catalog"] : [`/po/${po.id}/receive`])]) {
      await page.goto(path);
      await expect(page.getByRole("main")).toBeVisible();
      await page.waitForLoadState("networkidle");
      await noHorizontalScroll(page, `${who} ${path}`);
      const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
      expect(r.violations.map((v) => `${path} ${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(" ") + " — " + n.failureSummary?.split("\n")[1]).join(" | ")}`), `${who} ${path}`).toEqual([]);
    }
    await ctx.close();
  }
});

test("public pages, empty and error states", async ({ browser }) => {
  const ctx = await quietContext(browser, { viewport: { width: 360, height: 780 } });
  const p = await ctx.newPage();
  for (const path of ["/", "/login", "/demo", "/no-such-page"]) {
    await p.goto(path);
    await p.waitForLoadState("networkidle");
    await noHorizontalScroll(p);
    const r = await new AxeBuilder({ page: p }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
    expect(r.violations.map((v) => `${path} ${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(" ") + " — " + n.failureSummary?.split("\n")[1]).join(" | ")}`)).toEqual([]);
  }
  await expect(p.getByRole("heading", { name: "That page didn't arrive" })).toBeVisible();
  // Signed-out access to a signed-in page goes to sign-in and comes back.
  await p.goto("/approvals");
  await p.waitForURL(/\/login\?next=%2Fapprovals/);
  // An order that isn't yours shows the error state, not a crash.
  const { ctx: c2, page: s } = await as(browser, "Sam");
  await s.goto("/po/po_doesnotexist");
  await expect(s.getByRole("main")).toContainText(/not found|couldn't|can't|isn't/i);
  // Offline: the public shell says so instead of failing silently.
  await p.goto("/login");
  await ctx.setOffline(true);
  await p.evaluate(() => window.dispatchEvent(new Event("offline")));
  await expect(p.getByText(/Offline\. Reconnect/)).toBeVisible();
  await ctx.setOffline(false);
  await ctx.close();
  await c2.close();
});

test("dark theme passes axe on the busiest pages", async ({ browser }) => {
  const { ctx, page } = await as(browser, "Jordan", { theme: "dark" });
  const po = await demoPo(page);
  for (const path of ["/", "/login", "/home", `/po/${po.id}`, "/demo"]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    expect(await page.evaluate(() => document.documentElement.classList.contains("dark"))).toBe(true);
    const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
    expect(r.violations.map((v) => `${path} ${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`)).toEqual([]);
  }
  await ctx.close();
});
