import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb, setDb, type Db } from "../src/db.js";
import { dryRun } from "../src/guard/dryrun.js";
import { FakePayPal } from "../src/paypal/fake.js";
import { setPayPal } from "../src/paypal/index.js";
import { assessMessage, assessSettlement, setProtectedMode } from "../src/safety/index.js";
import { loadRiskModel, riskScore } from "../src/safety/risk.js";
import { payeeRules, scanText } from "../src/safety/rules.js";
import { seedDemo, type DemoIds } from "../src/services/seed.js";
import { postMessage } from "../src/store.js";
import { DEMO_SUPPLIER_CHANGE } from "../src/web/safety.js";

// The safety layer for supplier settlement (SAFETY_ACCESSIBILITY_SPEC §4, §6 StockSure row): a supplier message that
// announces new bank details or asks to be paid off PayPal holds the capture; a clean order is clear; protected mode
// holds every capture; the risk model is monotone.
describe("messages", () => {
  it("the demo 'our bank details changed' email holds and names the tactics in plain words", () => {
    const s = scanText(DEMO_SUPPLIER_CHANGE);
    expect(s.fired).toContain("changed_details");
    expect(s.level).toBe("hold");
    const m = assessMessage(DEMO_SUPPLIER_CHANGE);
    expect(m.level).toBe("hold");
    expect(m.words.join(" ")).toMatch(/new bank or PayPal details/);
  });
  it("a normal supplier note is clear", () => {
    expect(assessMessage("Hi Jordan, the Tuesday delivery is confirmed for 7am, 12 crates as ordered. Thanks, Ana").level).toBe("clear");
  });
  it("the risk model is monotone in the scam features", () => {
    expect(loadRiskModel().features).toContain("t_changed_details");
    const clean = payeeRules({ payeeAgeDays: null, detailsChangedDaysAgo: null, detailsChangeSource: null, amountCents: 50000, historyMedianCents: 48000, velocity10m: 0, velocity24hSumRatio: 1, requestChannelUntrusted: false, hourLocal: 12 }).features;
    expect(riskScore({ ...clean, request_channel_untrusted: 1, t_changed_details: 1, t_off_platform: 1 })).toBeGreaterThan(riskScore(clean));
  });
});

describe("settlement gate", () => {
  let db: Db;
  let ids: DemoIds;
  beforeEach(async () => {
    db = await openDb({ memory: true });
    setDb(db);
    setPayPal(new FakePayPal());
    ids = (await db.tx((q) => seedDemo(q))).ids;
  });
  afterEach(async () => {
    setPayPal(null);
    await db.close();
  });
  const po = async () => (await db.query<any>("SELECT id, buyer_id, supplier_id FROM purchase_orders WHERE id = $1", [ids.demoPo])).rows[0];

  it("the demo order with no supplier messages is clear", async () => {
    const p = await po();
    const a = await assessSettlement(p.id, "capture", 20000, db);
    expect(a.level).toBe("clear");
  });
  it("a supplier message announcing new bank details holds the capture with the reason in the approval", async () => {
    const p = await po();
    await postMessage(db, p.id, null, "Ana Ruiz", "supplier", DEMO_SUPPLIER_CHANGE);
    const a = await assessSettlement(p.id, "capture", 20000, db);
    expect(a.level).toBe("hold");
    expect(a.rule).toBe("supplier_details_changed_in_message");
    const d = await dryRun({ action: "capture", ownerId: p.buyer_id, agentScope: `org:${p.buyer_id}`, entity: "po", entityId: p.id, cents: 2000, trustedCents: [2000] }, null, db);
    expect(d.gate).toBe("held");
    if (d.gate === "held") {
      expect(d.reason).toMatch(/paused by the scam check/);
      const row = (await db.query<any>("SELECT payload FROM approvals WHERE id = $1", [d.approvalId])).rows[0];
      const payload = typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload;
      expect(payload.safety_rule).toBe("supplier_details_changed_in_message");
    }
  });
  it("protected mode holds every capture, even a small one", async () => {
    const p = await po();
    await setProtectedMode(p.buyer_id, true, ["telegram:1"], db);
    const a = await assessSettlement(p.id, "capture", 500, db);
    expect(a.level).toBe("hold");
    expect(a.rule).toBe("protected_settlement");
  });
});
