import { mkdirSync, renameSync } from "node:fs";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { demoPo, nextStep, resetDemo, signIn } from "./helpers";

// Screen recordings for the README and judges (RECORD=1 only). Each video is one browser context, saved to
// docs/recordings/. The voice in the hands-free video is simulated through the module's command entry point (the
// camera and microphone are not available here), and a caption on screen says so at every step.
test.skip(!process.env.RECORD, "set RECORD=1");
test.describe.configure({ mode: "serial" });
test.setTimeout(240_000);
const OUT = "../docs/recordings";

async function recorded(browser: Browser, name: string, size: { width: number; height: number }, mobile = false) {
  mkdirSync(`${OUT}/raw`, { recursive: true });
  const ctx = await browser.newContext({ viewport: size, recordVideo: { dir: `${OUT}/raw`, size }, isMobile: mobile, hasTouch: mobile, colorScheme: "light" });
  await ctx.addInitScript(() => {
    try {
      for (const r of ["owner", "receiving", "supplier"]) localStorage.setItem(`ss-tour-seen-${r}`, "1");
      localStorage.setItem("a11y", JSON.stringify({ seen: true }));
    } catch {}
  });
  const page = await ctx.newPage();
  return {
    page,
    done: async () => {
      const v = page.video();
      await ctx.close();
      if (v) renameSync(await v.path(), `${OUT}/${name}.webm`);
    },
  };
}

async function caption(p: Page, text: string, ms = 2200) {
  await p.evaluate((t) => {
    let el = document.getElementById("rec-caption");
    if (!el) {
      el = document.createElement("div");
      el.id = "rec-caption";
      el.setAttribute("data-ls-ui", "");
      el.style.cssText = "pointer-events:none;position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:2147483647;background:#111;color:#fff;font:600 16px/1.35 system-ui;padding:10px 16px;border-radius:10px;max-width:90vw;box-shadow:0 4px 20px rgb(0 0 0/.35)";
      document.body.append(el);
    }
    el.textContent = t;
  }, text);
  await p.waitForTimeout(ms);
}
const heard = (p: Page, text: string) => p.evaluate((t) => (window as any).lookAndSay._heard(t), text);

test("hands-free: the confirm card on a PayPal hold", async ({ browser }) => {
  const setup = await browser.newContext();
  const sp = await setup.newPage();
  await signIn(sp, "Jordan");
  await resetDemo(sp);
  await setup.close();
  const ana = await browser.newContext();
  const a = await ana.newPage();
  const { page: j, done } = await recorded(browser, "handsfree-confirm-card", { width: 1280, height: 800 });
  await signIn(j, "Jordan");
  const po = await demoPo(j);
  await j.goto(`/po/${po.id}`);
  await nextStep(j).getByRole("button", { name: "Send for a quote" }).click();
  await signIn(a, "Ana");
  await a.goto(`/po/${po.id}`);
  await nextStep(a).locator('input[id^="p-"]').first().fill("10.00");
  await nextStep(a).getByRole("button", { name: "Send quote" }).click();
  await expect.poll(async () => ((await (await j.request.get(`/api/ui/po/${po.id}`)).json()) as any).po.status).toBe("quoted");
  await j.reload();
  await expect(nextStep(j).getByRole("button", { name: /Accept and hold/ })).toBeVisible();
  await caption(j, "The supplier has quoted $200.00. Jordan turns on hands-free (no camera here, so voice only).");
  await j.locator("[data-ls-toggle]").first().click();
  await j.waitForTimeout(1500);
  await caption(j, "Simulated voice: “Peek, press accept and hold”");
  await heard(j, "peek press accept and hold");
  await caption(j, "Money needs a confirm card. Nothing is held yet.", 3000);
  await caption(j, "Simulated voice: “no”. Cancelled, nothing was done.");
  await heard(j, "no");
  await j.waitForTimeout(1500);
  await caption(j, "Simulated voice: “Peek, press accept and hold” again");
  await heard(j, "peek press accept and hold");
  await j.waitForTimeout(1500);
  await expect.poll(() => j.evaluate(() => Date.now() > (window as any).lookAndSay._state.speakingUntil + 400), { timeout: 15_000 }).toBe(true);
  await caption(j, "Simulated voice: “yes”. Only a spoken yes or a real click on Yes goes ahead.");
  await heard(j, "yes");
  await expect.poll(async () => ((await (await j.request.get(`/api/ui/po/${po.id}`)).json()) as any).ops.find((o: any) => o.kind === "authorize")?.status, { timeout: 20_000 }).toBe("succeeded");
  await j.reload();
  await expect(j.locator("[data-tour=money]")).toBeVisible({ timeout: 15_000 });
  await j.waitForTimeout(1200);
  await caption(j, "The PayPal hold for $200.00 is placed (test server, fake PayPal).", 4000);
  await ana.close();
  await done();
});

test("hands-free: the simulated gaze demo on /accessibility", async ({ browser }) => {
  const { page, done } = await recorded(browser, "handsfree-simulated-gaze", { width: 1280, height: 800 });
  await page.goto("/accessibility");
  const start = page.getByRole("button", { name: /Start the simulated gaze/ });
  await start.scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollBy(0, -120));
  await expect(start).toBeEnabled({ timeout: 15_000 });
  await caption(page, "No camera: a simulated gaze, with webcam-like noise, drives the real snapping code.");
  await start.click();
  await page.waitForTimeout(14_000);
  await caption(page, "Top row: 30 px buttons. Bottom row: 44 px, the hands-free minimum.", 6000);
  await page.getByRole("button", { name: /Stop the simulated gaze/ }).click();
  await page.getByRole("table").first().scrollIntoViewIfNeeded();
  await caption(page, "Simulated hit rates by button size and noise. These are simulations, not measurements of people.", 4000);
  await done();
});

test("mobile app: sign in and an order at phone size", async ({ browser }) => {
  const base = process.env.MOBILE_BASE ?? "http://localhost:8471";
  const up = await fetch(`${base}/api/ui/people`).then((r) => r.ok).catch(() => false);
  test.skip(!up, `mobile web preview not running at ${base}`);
  const { page, done } = await recorded(browser, "mobile-app", { width: 390, height: 844 }, true);
  await page.goto(`${base}/sign-in`);
  await page.waitForTimeout(2500);
  await page.getByRole("button", { name: /Sign in as Jordan/ }).click();
  await page.waitForTimeout(3000);
  await page.mouse.wheel(0, 600);
  await page.waitForTimeout(1500);
  await page.mouse.wheel(0, -600);
  await page.getByRole("button", { name: /^SS-\d+/ }).first().click();
  await page.waitForTimeout(2500);
  for (let i = 0; i < 4; i++) {
    await page.mouse.wheel(0, 500);
    await page.waitForTimeout(1200);
  }
  await page.goto(`${base}/approvals`);
  await page.waitForTimeout(2500);
  await done();
});
