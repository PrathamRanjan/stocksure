import { expect, test, type Page } from "@playwright/test";
import { writeFileSync } from "node:fs";

/**
 * Spec Part C, Wave 2 acceptance on a deployed copy: a judge follows the /judge paths in one browser, using only the
 * page's own buttons, and each step ticks. Times each path. Run with E2E_BASE=<url> LIVE=1.
 */
test.skip(!process.env.LIVE || !process.env.E2E_BASE, "set LIVE=1 and E2E_BASE");
test.setTimeout(900_000);

const step = (p: Page, key: string) => p.locator(`[data-step="${key}"]`);
async function openStep(p: Page, key: string) {
  await p.goto("/checklist");
  const b = step(p, key).getByRole("button");
  await expect(b).toBeEnabled({ timeout: 60_000 });
  await Promise.all([p.waitForURL((u) => !u.pathname.startsWith("/checklist"), { timeout: 30_000 }), b.click()]);
}
async function ticked(p: Page, key: string, timeout = 60_000) {
  await p.goto("/checklist");
  await expect(step(p, key)).toHaveAttribute("data-done", "1", { timeout });
}

test("a judge completes every path from /judge", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem("a11y", JSON.stringify({ seen: true }));
    } catch {}
  });
  const p = await ctx.newPage();
  const times: Record<string, number> = {};

  // Start a private demo from the checklist page.
  await p.goto("/checklist");
  await p.getByRole("link", { name: /Start your own demo/ }).click();
  await expect(p).toHaveURL(/\/start/);
  const t0 = Date.now();
  await expect.poll(async () => (await (await p.request.get("/api/ui/workspace")).json())?.seed?.done, { timeout: 150_000, intervals: [2000] }).toBe(true);
  times.seed_s = Math.round((Date.now() - t0) / 1000);
  console.log("SEED", times.seed_s, "s");

  // Path A: a short delivery.
  const a0 = Date.now();
  await openStep(p, "counted");
  await expect(p).toHaveURL(/\/receive$/);
  await p.getByRole("button", { name: "Driver notes two crushed" }).click();
  await expect(p.getByText(/line read/).first()).toBeVisible({ timeout: 90_000 });
  await p.waitForTimeout(1500);
  await p.getByRole("checkbox", { name: /I checked the goods/ }).check({ timeout: 60_000 });
  await p.getByRole("button", { name: "Confirm counts" }).click();
  await p.waitForURL(/\/po\/[^/]+$/, { timeout: 60_000 });
  await ticked(p, "counted");
  await openStep(p, "supplier_agreed");
  await p.getByRole("button", { name: /Agree with line 1/ }).click();
  const approveA = p.locator("[data-tour=resolution]").getByRole("button", { name: /Approve v\d+/ });
  await expect(approveA).toBeVisible({ timeout: 30_000 });
  await approveA.click();
  await expect(approveA).toHaveCount(0, { timeout: 30_000 });
  await ticked(p, "supplier_agreed");
  await openStep(p, "resolution_approved");
  const approveJ = p.locator("[data-tour=resolution]").getByRole("button", { name: /Approve v\d+/ });
  await expect(approveJ).toBeVisible({ timeout: 30_000 });
  await approveJ.click();
  await expect(approveJ).toHaveCount(0, { timeout: 30_000 });
  await ticked(p, "resolution_approved");
  await ticked(p, "captured", 120_000);
  times.path_a_s = Math.round((Date.now() - a0) / 1000);
  console.log("PATH A", times.path_a_s, "s");

  // Path B: the bank-change scam.
  const b0 = Date.now();
  await openStep(p, "scam_flagged");
  const box = p.locator("#msg");
  await expect(box).toHaveValue(/moved banks/);
  await p.locator("#messages").getByRole("button", { name: /Send/ }).click();
  await expect(box).toHaveValue("", { timeout: 30_000 });
  await ticked(p, "scam_flagged", 60_000);
  await openStep(p, "scam_checked");
  await p.locator("#scan-demo").click();
  await p.locator("#scan-btn").click();
  await expect(p.locator("#scan-result")).toContainText(/Hold|Don't pay|do not pay/i, { timeout: 90_000 });
  await ticked(p, "scam_checked");
  times.path_b_s = Math.round((Date.now() - b0) / 1000);
  console.log("PATH B", times.path_b_s, "s");

  // Path: catch a bad invoice (on an order not yet settled).
  const i0 = Date.now();
  await openStep(p, "invoice_caught");
  await p.getByRole("button", { name: "Send a bad invoice" }).click();
  await ticked(p, "invoice_caught", 120_000);
  await openStep(p, "duplicate_caught");
  await p.getByRole("button", { name: /Send the last invoice again/ }).click();
  await ticked(p, "duplicate_caught", 120_000);
  times.path_invoice_s = Math.round((Date.now() - i0) / 1000);
  console.log("PATH INVOICE", times.path_invoice_s, "s");

  // Path: the agents settle the barista-oat shortfall; both people approve; PayPal settles.
  const g0 = Date.now();
  await openStep(p, "agents_agreed");
  const agentsPo = new URL(p.url()).pathname.split("/")[2];
  await p.getByRole("button", { name: /Send the agents in/ }).click();
  await expect.poll(async () => (await (await p.request.get(`/api/ui/po/${agentsPo}/agents`)).json()).latest?.status ?? "not started", { timeout: 180_000, intervals: [3000] }).toMatch(/^(agreed|failed|walked_away)$/);
  const talk = (await (await p.request.get(`/api/ui/po/${agentsPo}/agents`)).json()).latest;
  console.log("AGENTS", talk.status, JSON.stringify(talk.outcome), talk.moves.map((m: any) => `${m.side}:${m.action}:${m.price_pct}:${m.allowed ? "ok" : "refused"}`).join(" "));
  await ticked(p, "agents_agreed", 30_000);
  for (const key of ["agents_supplier_ok", "agents_settled"]) {
    await openStep(p, key);
    const approve = p.locator("[data-tour=resolution]").getByRole("button", { name: /Approve v\d+/ });
    await expect(approve).toBeVisible({ timeout: 30_000 });
    await approve.click();
    await expect(approve).toHaveCount(0, { timeout: 30_000 });
    await ticked(p, key, 120_000);
  }
  times.path_agents_s = Math.round((Date.now() - g0) / 1000);
  console.log("PATH AGENTS", times.path_agents_s, "s");

  // Path C: Ask.
  const c0 = Date.now();
  for (const key of ["ai_asked", "ai_paypal", "ai_drafted"]) {
    await openStep(p, key);
    await expect(p).toHaveURL(/\/ask\?q=/);
    const q = new URL(p.url()).searchParams.get("q");
    await p.getByRole("button", { name: /^Ask$/ }).click();
    // The question runs on the server; wait for this one to finish before the next (one at a time per demo).
    await expect.poll(async () => {
      const r = (await (await p.request.get("/api/ui/ask")).json()).recent?.[0];
      return r?.question === q ? r.status : "not started";
    }, { timeout: 90_000, intervals: [2000] }).toMatch(/^(done|failed|refused)$/);
    const r = (await (await p.request.get("/api/ui/ask")).json()).recent?.[0];
    const st = await (await p.request.get(`/api/ui/ask/${r.id}`)).json();
    console.log(key, st.status, (st.steps ?? []).map((s: any) => s.tool).join(","), (st.answer?.sentences ?? []).map((s: any) => s.text).join(" ").slice(0, 300), st.answer?.proposals?.length ?? st.proposals?.length ?? 0);
    await ticked(p, key, 20_000);
  }
  times.path_c_s = Math.round((Date.now() - c0) / 1000);

  const j = await (await p.request.get("/api/public/judge")).json();
  const run = { base: process.env.E2E_BASE, ran_at: new Date().toISOString(), times, steps: j.paths.flatMap((x: any) => x.steps.map((s: any) => ({ path: x.id, key: s.key, done: s.done, at: s.done_at }))) };
  writeFileSync(process.env.ROBOT_OUT ?? new URL("../../docs/judge-live-run.json", import.meta.url), JSON.stringify(run, null, 1));
  expect(run.steps.filter((x: any) => !x.done).map((x: any) => `${x.path}/${x.key}`)).toEqual([]);
  console.log(JSON.stringify(times));
  await ctx.close();
});
