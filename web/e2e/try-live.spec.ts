import { expect, test } from "@playwright/test";

/** Spec A6.6 on a deployed copy: the landing try-it box runs on the device and sends nothing. Run with E2E_BASE=<url> LIVE=1. */
test.skip(!process.env.LIVE || !process.env.E2E_BASE, "set LIVE=1 and E2E_BASE");
test.setTimeout(180_000);

test("landing try-it box: on-device check, nothing sent, never green for a payment destination", async ({ page }) => {
  const sent: string[] = [];
  page.on("request", (r) => {
    const body = r.postData() ?? "";
    if (/moved banks|outlook\.com/.test(body) || /moved%20banks/.test(r.url())) sent.push(r.url());
  });
  await page.goto("/");
  const box = page.locator("#try-scam");
  await box.scrollIntoViewIfNeeded();
  await box.getByRole("button", { name: /Paste the 10 Nov message/ }).click();
  const t0 = Date.now();
  await box.getByRole("button", { name: /Check on this device/ }).click();
  await expect(box.locator("[data-level]")).toBeVisible({ timeout: 150_000 });
  const level = await box.locator("[data-level]").getAttribute("data-level");
  const text = await box.locator("[data-level]").innerText();
  console.log("FIRST", Math.round((Date.now() - t0) / 1000), "s", level, text.replace(/\s+/g, " "));
  expect(level).not.toBe("clear");
  expect(text).toMatch(/nothing left your browser/);
  // Second check: model already loaded.
  await box.getByRole("textbox").fill("Thanks for the delivery this morning, all good. See you Thursday.");
  await box.getByRole("button", { name: /Check on this device/ }).click();
  await expect(box.locator("[data-level]")).toBeVisible({ timeout: 30_000 });
  console.log("SECOND", await box.locator("[data-level]").getAttribute("data-level"), (await box.locator("[data-level]").innerText()).replace(/\s+/g, " "));
  expect(sent).toEqual([]);
});
