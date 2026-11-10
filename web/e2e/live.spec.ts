import { expect, test } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { start, toAgreed, toCounting, toDispatched, toHeld } from "./flow";

// A real PayPal sandbox journey on a deployed copy, through the UI. Run with E2E_BASE=<url> LIVE=1.
// Writes the PayPal ids it saw so they can be matched against the sandbox buyer's activity.
test.skip(!process.env.LIVE || !process.env.E2E_BASE, "set LIVE=1 and E2E_BASE");
test.setTimeout(240_000);

test("live sandbox: hold, count, agree, capture, replacement hold", async ({ browser }) => {
  const cast = await start(browser);
  await toHeld(cast);
  await toDispatched(cast);
  await toCounting(cast);
  await toAgreed(cast);
  const { j, po } = cast;
  const m = await (await j.request.get(`/api/ui/po/${po.id}`)).json();
  const cap = m.ops.find((o: any) => o.kind === "capture" && o.status === "succeeded");
  expect(cap.amount_cents).toBe(m.resolution.totals.accepted_cents);
  const kids = await Promise.all(m.children.map(async (c: any) => (await (await j.request.get(`/api/ui/po/${c.id}`)).json())));
  const rows = [m, ...kids].flatMap((x: any) => x.ops.map((o: any) => ({ po: x.po.number, kind: o.kind, status: o.status, paypal_status: o.paypal_status, amount: (o.amount_cents / 100).toFixed(2), final_capture: o.final_capture, paypal_id: o.paypal_id, request_id: o.request_id, at: o.updated_at })));
  const out = { base: process.env.E2E_BASE, ran_at: new Date().toISOString(), po: po.number, accepted_cents: m.resolution.totals.accepted_cents, quote_cents: m.quote_total_cents, funding: m.funding, ops: rows };
  writeFileSync(new URL("../../docs/sandbox-run.json", import.meta.url), JSON.stringify(out, null, 1));
  console.log(JSON.stringify(rows));
});
