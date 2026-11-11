/**
 * Spec A6 (scam layer version 2) and A5.2 (Decisions client and thresholds). No network: Decisions is answered by a
 * stand-in fetch that returns what the real API returns (shape checked live on 11 Nov 2026).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { config } from "../src/config.js";
import { openDb, setDb, type Db } from "../src/db.js";
import { setProviderFetch } from "../src/ai/provider.js";
import { clearThresholdCache, decide, levelFor, saveThreshold, thresholds } from "../src/ai/decisions.js";
import { ADVICE_DESTINATION, ADVICE_UNCHECKED, checkMessage, SCAM_QUESTIONS } from "../src/safety/check.js";
import { findDestinations } from "../src/safety/destinations.js";
import { scanText } from "../src/safety/rules.js";
import { SCAM_CASES, SUPPLIER_CONTACT, TEN_NOV } from "../src/eval/scam-cases.js";

let db: Db;
const saved = { key: config.ai.openaiKey, provider: config.ai.provider };
let calls: any[] = [];

/** A Decisions stand-in: every predicate gets `p(name)`. */
function decisionsAnswer(p: (name: string, input: string) => number | "refuse") {
  setProviderFetch((async (url: any, init: any) => {
    const body = JSON.parse(String(init.body));
    calls.push({ url: String(url), body });
    if (!String(url).endsWith("/v1/decisions")) return new Response("{}", { status: 404 });
    const input = typeof body.input === "string" ? body.input : JSON.stringify(body.input);
    return new Response(JSON.stringify({ model: "gpt-6-luna", answers: body.questions.map((q: any) => { const v = p(q.name, input); return v === "refuse" ? { type: "refusal", name: q.name } : { type: "predicate", name: q.name, probability: v }; }), usage: { input_tokens: 400 } }), { status: 200 });
  }) as typeof fetch);
}

beforeEach(async () => {
  db = await openDb({ memory: true });
  setDb(db);
  clearThresholdCache();
  calls = [];
  config.ai.openaiKey = "sk-test";
  config.ai.provider = "openai";
});
afterEach(async () => {
  setProviderFetch(null);
  config.ai.openaiKey = saved.key;
  config.ai.provider = saved.provider;
  await db.close();
});

describe("A6.3 wider bank-change rule", () => {
  it("fires on the 10 Nov message and all 30 paraphrases", () => {
    const set = SCAM_CASES.filter((c) => c.family === "ten_nov" || c.family === "bank_change");
    expect(set.length).toBe(31);
    for (const c of set) expect(scanText(c.text).tactics.changed_details, c.id).toBe(true);
    expect(scanText(TEN_NOV).level).toBe("hold");
  });
  it("does not fire on the hard genuine messages, including 'our payment details haven't changed'", () => {
    for (const c of SCAM_CASES.filter((x) => x.family === "genuine")) expect(scanText(c.text).tactics.changed_details, c.id).toBe(false);
  });
});

describe("A6.1 destinations in code", () => {
  it("finds every destination the bank-change set names, compared with the contact on file", () => {
    for (const c of SCAM_CASES.filter((x) => x.destination)) expect(findDestinations(c.text, { contactEmail: SUPPLIER_CONTACT }).names_destination, c.id).toBe(true);
    for (const c of SCAM_CASES.filter((x) => x.family === "genuine")) expect(findDestinations(c.text, { contactEmail: SUPPLIER_CONTACT }).level, c.id).toBe("clear");
  });
  it("a free-mail address for a supplier on file under its own domain is a hold; the contact on file is not a destination", () => {
    const d = findDestinations(TEN_NOV, { contactEmail: SUPPLIER_CONTACT });
    expect(d.level).toBe("hold");
    expect(d.destinations[0]).toMatchObject({ kind: "email", value: "harbourwholesale.accounts@outlook.com", on_file: false });
    expect(d.reasons[0]).toContain("free-mail");
    expect(findDestinations(`Please pay the invoice in StockSure. Questions: ${SUPPLIER_CONTACT}`, { contactEmail: SUPPLIER_CONTACT })).toMatchObject({ level: "clear", names_destination: false });
    expect(findDestinations("Please pay invoice INV-1 to billing@harbourwholesale.example", { contactEmail: SUPPLIER_CONTACT }).level).toBe("caution");
    expect(findDestinations("IBAN DE89 3704 0044 0532 0130 00 please").destinations[0].kind).toBe("iban");
    expect(findDestinations("send USDT to 0x9f3a77c1ab").destinations[0].kind).toBe("wallet");
  });
});

describe("A5.2 Decisions client", () => {
  it("sends every question in one request and logs the call", async () => {
    decisionsAnswer(() => 0.7);
    const d = await decide("hello", SCAM_QUESTIONS, { purpose: "scam_check" });
    expect(calls).toHaveLength(1);
    expect(calls[0].body).toMatchObject({ model: config.ai.models.decide });
    expect(calls[0].body.questions).toHaveLength(11);
    expect(d.answers.changed_payment_details.probability).toBe(0.7);
    const row = (await db.query<any>("SELECT purpose, ok, model, cost_usd FROM ai_calls")).rows[0];
    expect(row).toMatchObject({ purpose: "decide:scam_check", ok: true, model: "gpt-6-luna" });
  });
  it("a refusal is 'not decided', never clear; choices need an 'other' option", async () => {
    decisionsAnswer((n) => (n === "impersonation" ? "refuse" : 0));
    const d = await decide("x", SCAM_QUESTIONS, { purpose: "t" });
    expect(d.answers.impersonation.refused).toBe(true);
    expect(levelFor(d.answers.impersonation, { clear_below: 0.3, hold_above: 0.8 })).toBe("unknown");
    await expect(decide("x", [{ type: "choice", name: "c", instructions: "i", choices: [{ value: "a", description: "a" }] }], { purpose: "t" })).rejects.toThrow(/other/);
  });
  it("thresholds come from the table once calibrated, from code defaults before", async () => {
    expect((await thresholds()).get("changed_payment_details")).toMatchObject({ source: "default" });
    await saveThreshold({ name: "changed_payment_details", clear_below: 0.1, hold_above: 0.5, calibrated_on: "test", n: 10, precision_at_hold: 1, recall_at_hold: 1 });
    expect((await thresholds()).get("changed_payment_details")).toMatchObject({ source: "calibrated", hold_above: 0.5 });
  });
  it("no key: decide refuses instead of standing in with rules", async () => {
    config.ai.openaiKey = "";
    await expect(decide("x", SCAM_QUESTIONS, { purpose: "t" })).rejects.toThrow(/OPENAI_API_KEY/);
  });
});

describe("A6.2 never a false all-clear", () => {
  it("the 10 Nov message is held by all three readers", async () => {
    decisionsAnswer((n) => (["changed_payment_details", "asks_for_payment", "names_a_payment_destination"].includes(n) ? 0.99 : 0.05));
    const c = await checkMessage(TEN_NOV, { contactEmail: SUPPLIER_CONTACT });
    expect(c.level).toBe("hold");
    expect(c.green).toBe(false);
    expect(c.readers.rules.level).toBe("hold");
    expect(c.readers.decisions.level).toBe("hold");
    expect(c.readers.code.level).toBe("hold");
  });
  it("held by the destination check even when the model says it is fine", async () => {
    decisionsAnswer(() => 0.01);
    const c = await checkMessage("Thanks for the order! For this one please use payments@harbour-pay.net on PayPal.", { contactEmail: SUPPLIER_CONTACT });
    expect(c.readers.decisions.level).toBe("clear");
    expect(c.level).toBe("hold");
  });
  it("green only when every reader answered clear and no destination is named", async () => {
    decisionsAnswer(() => 0.02);
    expect(await checkMessage("The delivery is running 30 minutes late, sorry!", { contactEmail: SUPPLIER_CONTACT })).toMatchObject({ level: "clear", green: true, advice: null });
    // The model alone says this names a destination: amber, with the phone advice.
    decisionsAnswer((n) => (n === "names_a_payment_destination" ? 0.9 : 0.02));
    expect(await checkMessage("Please pay the usual way.", { contactEmail: SUPPLIER_CONTACT })).toMatchObject({ level: "caution", green: false, advice: ADVICE_DESTINATION });
  });
  it("when Decisions does not answer, nothing is marked safe", async () => {
    setProviderFetch((async () => new Response("down", { status: 400 })) as typeof fetch);
    const c = await checkMessage("The delivery is running late.", { contactEmail: SUPPLIER_CONTACT });
    expect(c).toMatchObject({ level: "caution", green: false, advice: ADVICE_UNCHECKED });
    expect(c.readers.decisions.answered).toBe(false);
    expect(JSON.stringify(c)).not.toMatch(/Decisions 400/);
  });
});
