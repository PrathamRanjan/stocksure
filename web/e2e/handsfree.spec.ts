import { expect, test, type Page } from "@playwright/test";
import { as, demoPo, nextStep, resetDemo } from "./helpers";

// Spec A6/A8: hands-free never moves money on its own. A voice command on the PayPal hold opens the confirm card;
// a script "click" on Yes, a spoken no and "stop" all leave the order untouched; only a spoken yes places the hold.
// The camera and microphone are not granted here, so hands-free falls back to voice only, as on a machine without them.
test.describe.configure({ mode: "serial" });

const heard = (p: Page, text: string) => p.evaluate((t) => (window as any).lookAndSay._heard(t), text);

test("money needs a spoken yes or a real click on the confirm card", async ({ browser }) => {
  const first = await as(browser, "Jordan");
  await resetDemo(first.page);
  await first.ctx.close();
  const j = (await as(browser, "Jordan")).page;
  const po = await demoPo(j);
  const a = (await as(browser, "Ana")).page;
  const api = async () => (await (await j.request.get(`/api/ui/po/${po.id}`)).json()) as any;
  const holds = async () => (await api()).ops.filter((o: any) => o.kind === "authorize").length;

  await j.goto(`/po/${po.id}`);
  await nextStep(j).getByRole("button", { name: "Send for a quote" }).click();
  await a.goto(`/po/${po.id}`);
  await nextStep(a).locator('input[id^="p-"]').first().fill("10.00");
  await nextStep(a).getByRole("button", { name: "Send quote" }).click();
  await expect.poll(async () => (await api()).po.status).toBe("quoted");

  await j.reload();
  await expect(nextStep(j).getByRole("button", { name: /Accept and hold/ })).toBeVisible();
  await j.locator("[data-ls-toggle]").first().click();
  await expect.poll(() => j.evaluate(() => (window as any).lookAndSay.on)).toBe(true);
  const card = j.locator("#ls-confirm");

  // 1. The command opens the card with the amount; nothing is held yet.
  await heard(j, "peek press accept and hold");
  await expect(card).toBeVisible();
  await expect(card).toContainText("$200.00");
  // 2. A script click on Yes is not a person: the card stays and nothing happens.
  await card.evaluate((c) => (c.querySelector(".ls-yes") as HTMLButtonElement).click());
  await expect(card).toBeVisible();
  // 3. "No" cancels.
  await heard(j, "no");
  await expect(card).toHaveCount(0);
  // 4. "Stop" cancels too, in another language, and pauses hands-free until the wake word.
  await heard(j, "peek press accept and hold");
  await expect(card).toBeVisible();
  await heard(j, "ruko");
  await expect(card).toHaveCount(0);
  await j.waitForTimeout(800);
  expect(await holds()).toBe(0);
  expect((await api()).po.status).toBe("quoted");
  // 5. Wake again, ask again, and a spoken yes places the hold.
  await heard(j, "peek");
  await heard(j, "peek press accept and hold");
  await expect(card).toBeVisible();
  // A "yes" heard while the card's own prompt is still being read out is treated as an echo, so wait it out.
  await expect.poll(() => j.evaluate(() => Date.now() > (window as any).lookAndSay._state.speakingUntil + 400), { timeout: 15_000 }).toBe(true);
  await heard(j, "yes");
  await expect(card).toHaveCount(0);
  await expect.poll(async () => (await api()).ops.find((o: any) => o.kind === "authorize")?.status, { timeout: 20_000 }).toBe("succeeded");
  expect(await holds()).toBe(1);

  for (const p of [j, a]) await p.context().close();
});

test("the mouse answers the card: No sends nothing, a real click on Yes sends", async ({ browser }) => {
  const j = (await as(browser, "Jordan")).page;
  const po = await demoPo(j);
  const msgs = async () => ((await (await j.request.get(`/api/ui/po/${po.id}`)).json()) as any).messages?.length ?? 0;
  await j.goto(`/po/${po.id}`);
  await j.locator("[data-ls-toggle]").first().click();
  await expect.poll(() => j.evaluate(() => (window as any).lookAndSay.on)).toBe(true);
  const box = j.getByRole("textbox", { name: /^Write to/ });
  await box.fill("Hands-free test: please confirm Thursday.");
  const before = await msgs();
  const card = j.locator("#ls-confirm");
  await heard(j, "peek press send");
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: "No" }).click();
  await expect(card).toHaveCount(0);
  await j.waitForTimeout(500);
  expect(await msgs()).toBe(before);
  await heard(j, "peek press send");
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: "Yes, go ahead" }).click();
  await expect(card).toHaveCount(0);
  await expect.poll(msgs).toBe(before + 1);
  await j.context().close();
});
