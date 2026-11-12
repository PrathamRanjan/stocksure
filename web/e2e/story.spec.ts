import { expect, test, type Page } from "@playwright/test";
import { quietContext } from "./helpers";

/**
 * The guided tour as a judge meets it: the landing page explains the problem and the people, "Pick who you are"
 * opens a private demo, and the tour follows one delivery across Jordan, Sam and Ana, switching person with a card,
 * explaining each page, and clicking the real buttons when asked to. Runs against the hermetic server (fake PayPal,
 * offline docket reader, no AI model), so the agents and Ask journeys are not walked here.
 */
test.setTimeout(240_000);

const pop = (p: Page) => p.locator(".driver-popover.ss-journey");

interface Seen {
  title: string;
  progress: string;
  path: string;
  el: string | null;
  did: string | null;
}

/** Walks the journey on screen until its last card, pressing "Do it for me" buttons and Next. */
async function walk(p: Page, max = 45): Promise<Seen[]> {
  const seen: Seen[] = [];
  for (let n = 0; n < max; n++) {
    await expect(pop(p)).toBeVisible({ timeout: 60_000 });
    const title = (await pop(p).locator(".driver-popover-title").innerText()).trim();
    const progress = (await pop(p).locator(".driver-popover-progress-text").innerText()).trim();
    const el = await p.evaluate(() => {
      const e = document.querySelector<HTMLElement>(".driver-active-element");
      return e ? e.dataset.tour ?? (e.dataset.scan ? `scan:${e.dataset.scan}` : null) ?? (e.dataset.po ? "order-card" : e.tagName.toLowerCase()) : null;
    });
    const doIt = pop(p).locator(".ss-j-do");
    const did = (await doIt.count()) ? (await doIt.innerText()).trim() : null;
    seen.push({ title, progress, path: new URL(p.url()).pathname, el, did });
    if (did) {
      await doIt.click();
      // The step moves on by itself once the page shows the result.
      await expect(pop(p).locator(".driver-popover-title")).not.toHaveText(title, { timeout: 60_000 });
      continue;
    }
    const next = pop(p).locator(".driver-popover-next-btn");
    if (/Finish/.test(await next.innerText())) break;
    await next.click();
    await expect(pop(p).locator(".driver-popover-progress-text")).not.toHaveText(progress, { timeout: 60_000 });
  }
  return seen;
}

async function checklist(p: Page) {
  const j = await (await p.request.get("/api/public/judge")).json();
  return Object.fromEntries((j.paths as { steps: { key: string; done: boolean }[] }[]).flatMap((x) => x.steps.map((s) => [s.key, s.done])));
}

test("the landing page explains the problem and the people, then the tour follows one delivery across all three", async ({ browser }) => {
  const ctx = await quietContext(browser);
  // Record every "You are now" card, to prove the person switches are shown, not just done.
  await ctx.addInitScript(() => {
    (window as unknown as { __switches: string[] }).__switches = [];
    new MutationObserver(() => {
      const c = document.querySelector(".ss-switch:not([data-seen])");
      if (c) {
        c.setAttribute("data-seen", "1");
        (window as unknown as { __switches: string[] }).__switches.push((c.textContent ?? "").replace(/\s+/g, " "));
      }
    }).observe(document, { childList: true, subtree: true });
  });
  const p = await ctx.newPage();

  // The old judge page now lands on the picker; the page above it explains the story first.
  await p.goto("/judge");
  await expect(p).toHaveURL(/\/#pick$/);
  await expect(p.getByRole("heading", { name: "Pick who you are" })).toBeVisible();
  for (const h of ["The problem", "Who's involved, and why it takes all of them", "One delivery, step by step", "Words you'll see in the app"]) {
    await expect(p.getByRole("heading", { name: h })).toBeVisible();
  }
  for (const name of ["Jordan Lee", "Sam Ortiz", "Ana Ruiz"]) await expect(p.locator("#people").getByText(name)).toBeVisible();
  await expect(p.locator("#words").getByText("Waiting on you")).toBeVisible();
  // No stamps or tally marks on the landing page.
  await expect(p.locator(".tally")).toHaveCount(0);

  await p.getByRole("button", { name: "Start as Jordan" }).click();
  const seen = await walk(p);
  const titles = seen.map((s) => s.title);
  console.log(seen.map((s) => `${s.progress.padEnd(9)} ${s.title}  [${s.el ?? "card"}]${s.did ? ` did: ${s.did}` : ""}`).join("\n"));

  // The story, in order, from each person's side.
  const order = [
    "You're Jordan Lee, owner of Laneway Café",
    "Waiting on you",
    "Approvals",
    "Stock",
    "Record",
    "Ask",
    "You're Sam Ortiz, who receives deliveries",
    "Use a sample docket",
    "The AI's suggestion",
    "Sam confirms the count",
    "You're Ana Ruiz at Harbour Wholesale Co.",
    "Ana agrees the count",
    "The agreement: what gets paid",
    "Jordan approves the same version",
    "Where the money is",
    "Every PayPal call, with its id",
    "That's one delivery, start to finish",
  ];
  let at = -1;
  for (const t of order) {
    const i = titles.indexOf(t, at + 1);
    expect(i, `"${t}" after step ${at + 1}`).toBeGreaterThan(at);
    at = i;
  }
  // Each page and term is pointed at, not just described.
  const el = (t: string) => seen.find((s) => s.title === t)?.el;
  expect(el("Waiting on you")).toBe("needs");
  expect(el("Approvals")).toBe("nav-approvals");
  expect(el("Stock")).toBe("nav-stock");
  expect(el("Record")).toBe("nav-record");
  expect(el("Ask")).toBe("nav-ask");
  expect(el("Sam confirms the count")).toBe("confirm");
  expect(el("Where the money is")).toBe("money");
  // The last card says where we are: n of n.
  const last = seen.at(-1)!.progress.match(/(\d+) of (\d+)/)!;
  expect(last[1]).toBe(last[2]);

  // The switches were shown as cards: to Sam, to Ana, back to Jordan.
  const switches = await p.evaluate(() => (window as unknown as { __switches: string[] }).__switches);
  expect(switches.some((s) => /Sam Ortiz/.test(s))).toBe(true);
  expect(switches.some((s) => /Ana Ruiz/.test(s))).toBe(true);
  expect(switches.filter((s) => /Jordan Lee/.test(s)).length).toBeGreaterThan(0);

  // The real thing happened: the order was counted, agreed, approved by both and charged on PayPal. (Read from the
  // order itself: the checklist ignores events while a brand-new demo is still placing its first holds, which on
  // production can outlast the walk to the count.)
  // The order is the one the tour showed the money on (the checklist's "count" link moves on to the next delivery).
  const poId = seen.find((s) => s.title === "Where the money is")!.path.match(/\/po\/([^/?#]+)/)![1];
  // PayPal settles in the background; on the live sandbox it can still be in flight when the tour reaches the money.
  await expect
    .poll(async () => (await (await p.request.get(`/api/ui/po/${poId}`)).json()).funding.captured_cents, { message: "captured on PayPal", timeout: 120_000, intervals: [3000] })
    .toBeGreaterThan(0);
  const po = await (await p.request.get(`/api/ui/po/${poId}`)).json();
  expect(po.lines.some((l: { tally?: { damaged?: number } }) => (l.tally?.damaged ?? 0) > 0), "damage recorded").toBe(true);

  // Finish leaves you free to roam, signed in, with no tour reopening.
  await pop(p).locator(".driver-popover-next-btn").click();
  await expect(pop(p)).toHaveCount(0);
  await p.goto("/stock");
  await p.waitForTimeout(1200);
  await expect(pop(p)).toHaveCount(0);
  await expect(p.locator(".ss-j-pill")).toHaveCount(0);
  await ctx.close();
});

test("Back goes back a step; leaving the tour's page pauses it and Resume returns", async ({ browser }) => {
  const ctx = await quietContext(browser);
  const p = await ctx.newPage();
  await p.goto("/#pick");
  await p.getByRole("button", { name: "Start as Jordan" }).click();
  await expect(pop(p).locator(".driver-popover-title")).toHaveText("You're Jordan Lee, owner of Laneway Café", { timeout: 90_000 });
  await pop(p).locator(".driver-popover-next-btn").click();
  await expect(pop(p).locator(".driver-popover-title")).toHaveText("Waiting on you");
  await pop(p).locator(".driver-popover-prev-btn").click();
  await expect(pop(p).locator(".driver-popover-title")).toHaveText("You're Jordan Lee, owner of Laneway Café");
  await pop(p).locator(".driver-popover-next-btn").click();
  await expect(pop(p).locator(".driver-popover-title")).toHaveText("Waiting on you");

  // Wander off: the tour waits in a pill at the bottom.
  // (The tour's overlay blocks the page behind it, so leave by the address bar, as a judge might.)
  await p.goto("/stock");
  await expect(p).toHaveURL(/\/stock$/);
  await expect(pop(p)).toHaveCount(0);
  await expect(p.locator(".ss-j-pill")).toContainText("Guided tour paused");
  await p.locator(".ss-j-pill").getByRole("button", { name: "Resume" }).click();
  await expect(p).toHaveURL(/\/home$/);
  await expect(pop(p).locator(".driver-popover-title")).toHaveText("Waiting on you");

  // Closing ends the tour for good: no pill, nothing comes back on the next page.
  await pop(p).locator(".driver-popover-close-btn").click();
  await expect(p.locator(".ss-j-pill")).toHaveCount(0);
  await expect(pop(p)).toHaveCount(0);
  await ctx.close();
});

test("the invoice and scam journeys catch what they promise", async ({ browser }) => {
  const ctx = await quietContext(browser);
  const p = await ctx.newPage();
  await p.goto("/#pick");
  await p.getByRole("button", { name: /Catch a bad invoice/ }).click();
  const inv = await walk(p, 12);
  expect(inv.map((s) => s.title)).toEqual(expect.arrayContaining(["Send a bad invoice", "What the checks found", "Send it again, new number", "Jordan sees what was stopped", "That's the journey"]));

  await pop(p).locator("[data-journey=scam]").click();
  const scam = await walk(p, 10);
  expect(scam.map((s) => s.title)).toEqual(expect.arrayContaining(["A polite message asking to be paid somewhere new", "Checked as it arrived", "Jordan sees the warning, not just the message", "Scam check: paste anything"]));
  expect(scam.find((s) => s.title === "Checked as it arrived")?.el).toMatch(/^scan:/);

  const done = await checklist(p);
  for (const k of ["invoice_caught", "duplicate_caught", "scam_flagged"]) expect(done[k], k).toBe(true);
  await ctx.close();
});
