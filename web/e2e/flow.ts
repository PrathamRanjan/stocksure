import { expect, type Browser, type Page } from "@playwright/test";
import { as, demoPo, nextStep, resetDemo } from "./helpers";

type Opts = Parameters<typeof as>[2];
/** Drives the demo order through the UI. Each stage returns the pages so callers can look around in between. */
export async function start(browser: Browser, opts?: Opts) {
  const jordan = await as(browser, "Jordan", opts);
  await resetDemo(jordan.page);
  await jordan.ctx.close();
  const j = (await as(browser, "Jordan", opts)).page;
  const a = (await as(browser, "Ana", opts)).page;
  const s = (await as(browser, "Sam", opts)).page;
  return { j, a, s, po: await demoPo(j) };
}
export type Cast = Awaited<ReturnType<typeof start>>;

export async function toHeld({ j, a, po }: Cast) {
  await j.goto(`/po/${po.id}`);
  await expect(j.getByRole("heading", { name: po.number })).toBeVisible();
  await nextStep(j).getByRole("button", { name: "Send for a quote" }).click();
  await expect(j.getByText("Sent to the supplier for a quote.")).toBeVisible();
  await a.goto(`/po/${po.id}`);
  await nextStep(a).locator('input[id^="p-"]').first().fill("10.00");
  await nextStep(a).getByRole("button", { name: "Send quote" }).click();
  await expect(a.getByText(/Quote sent/i)).toBeVisible();
  await j.reload();
  await nextStep(j).getByRole("button", { name: /Accept and hold \$200\.00/ }).click();
  await expect(j.getByText("Quote accepted and PayPal hold placed.")).toBeVisible();
  await expect.poll(async () => (await (await j.request.get(`/api/ui/po/${po.id}`)).json()).ops.find((o: any) => o.kind === "authorize")?.status, { timeout: 20_000 }).toBe("succeeded");
}

export async function toDispatched({ a, po }: Cast) {
  await a.goto(`/po/${po.id}`);
  await nextStep(a).getByLabel(/pay \$500 elsewhere/).check();
  await nextStep(a).getByRole("button", { name: "Mark dispatched" }).click();
  await expect(a.locator("[data-tour=docs]")).toContainText(/removed|flag|instruction/i);
}

/** Sam loads the "two crushed" sample; the counts form is filled and waiting for the checkbox. */
export async function toCounting({ s, po }: Cast) {
  await s.goto(`/po/${po.id}/receive`);
  await s.getByRole("button", { name: "Driver notes two crushed" }).click();
  await expect(s.getByRole("checkbox", { name: /I checked the goods/ })).toBeVisible({ timeout: 30_000 });
}

export async function toAgreed({ j, a, s, po }: Cast) {
  await s.getByRole("checkbox", { name: /I checked the goods/ }).check();
  await s.getByRole("button", { name: "Confirm counts" }).click();
  await s.waitForURL(new RegExp(`/po/${po.id}$`));
  await expect(s.locator("[data-tour=lines]")).toContainText(/damaged/i);
  await a.goto(`/po/${po.id}`);
  await a.getByRole("button", { name: /Agree with line 1/ }).click();
  await expect(a.locator("[data-tour=resolution]")).toBeVisible();
  for (const p of [a, j] as Page[]) {
    await p.goto(`/po/${po.id}`);
    const approve = p.locator("[data-tour=resolution]").getByRole("button", { name: /Approve v\d+/ });
    await expect(approve).toBeVisible({ timeout: 20_000 });
    await approve.click();
    await expect(approve).toHaveCount(0);
  }
  await expect.poll(async () => (await (await j.request.get(`/api/ui/po/${po.id}`)).json()).ops.some((o: any) => o.kind === "capture" && o.status === "succeeded"), { timeout: 30_000 }).toBe(true);
}
