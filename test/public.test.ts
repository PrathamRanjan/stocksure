/**
 * Spec A3 and A5.6: the judge page's paths tick themselves from real events in the visitor's own demo; the pages
 * that need no sign-in load; /proof lists every case of each suite with the date and models. No network.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { config } from "../src/config.js";
import { openDb, setDb, withWorkspace, type Db } from "../src/db.js";
import { FakePayPal } from "../src/paypal/fake.js";
import { setPayPal } from "../src/paypal/index.js";
import { seedDemo } from "../src/services/seed.js";
import { getWorkspace, seedStatus } from "../src/demo/workspaces.js";
import { runProof } from "../src/eval/proof.js";
import { SCAM_CASES } from "../src/eval/scam-cases.js";
import { tick } from "../src/demo/checklist.js";
import { confirmReceipt } from "../src/services/receiving.js";
import { linesOf, personById } from "../src/store.js";
import { Client } from "./client.js";
import { serveTracked } from "./journey-coverage.js";

let db: Db;
let srv: Awaited<ReturnType<typeof serveTracked>>;
const saved = { ...config.demo };
const TOKEN = "TOKEN-DEMO-WALLET";

beforeEach(async () => {
  db = await openDb({ memory: true });
  setDb(db);
  const fake = new FakePayPal();
  fake.tokens.add(TOKEN);
  setPayPal(fake);
  config.demo.vaultToken = TOKEN;
  config.demo.vaultPayer = "sandbox-buyer@example.com";
  config.demo.perAddressPerHour = 50;
  await db.tx((q) => seedDemo(q));
  srv = await serveTracked(createApp());
});
afterEach(async () => {
  Object.assign(config.demo, saved);
  await srv.close();
  setPayPal(null);
  await db.close();
});

async function settled(id: string) {
  for (let i = 0; i < 200; i++) {
    const s = await seedStatus((await getWorkspace(id))!);
    if (s.done) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("seeding never finished");
}

describe("judge page", () => {
  it("three paths, steps open real screens, and a step ticks when the server records it", { timeout: 60000 }, async () => {
    const c = new Client(srv.base);
    const before = (await c.get("/api/public/judge")).json;
    expect(before.workspace).toBeNull();
    expect(before.paths).toEqual([]);
    expect(before.live.find((r: any) => /Phone calls/.test(r.area)).state).toBe("not built");
    expect((await c.get("/judge")).status).toBe(200);

    expect((await c.postJson("/demo/start", {})).json.ok).toBe(true);
    const ws = (await c.get("/api/ui/workspace")).json.workspace.id;
    await settled(ws);
    const j = (await c.get("/api/public/judge")).json;
    expect(j.paths.map((p: any) => p.id)).toEqual(["short", "scam", "ask"]);
    for (const p of j.paths) for (const s of p.steps) expect(s.done).toBe(false);
    const count = j.paths[0].steps[0];
    expect(count).toMatchObject({ key: "counted", as: "sam" });
    expect(count.to).toMatch(/^\/po\/[^/]+\/receive$/);
    expect(count.person_id).toBeTruthy();
    expect(j.paths[1].steps[0].to).toMatch(/\?say=.*outlook\.com/);
    expect(j.accounts.judge_buyer).toBeNull();
    expect(j.workspace.join_qr).toBe("/demo/join.svg");

    // The seed's own events never tick. Sam counting the target order (seconds after seeding) ticks it once, and
    // every path keeps pointing at that order afterwards, not at an order the seed counted.
    const poId = /\/po\/([^/]+)\/receive$/.exec(count.to)![1];
    await withWorkspace(ws, async () => {
      const sam = (await personById(db, count.person_id))!;
      const lines = await linesOf(db, poId);
      await confirmReceipt(sam, poId, Object.fromEntries(lines.map((l) => [l.id, { delivered: String(l.qty_packs * l.product.pack_units), damaged: "0", wrong: "0", note: "" }])));
    });
    await withWorkspace(ws, () => tick(db, "counted"));
    const after = (await c.get("/api/public/judge")).json;
    expect(after.paths[0].steps[0].done).toBe(true);
    expect(after.paths[0].steps[1].done).toBe(false);
    expect(after.paths[0].steps[1].to).toBe(`/po/${poId}`);
    expect(after.paths[1].steps[0].to).toContain(`/po/${poId}?say=`);
    // Base data (no workspace) never ticks anything.
    await tick(db, "captured");
  });
});

describe("pages that need no sign-in", () => {
  it("load without a session and never show a token", async () => {
    const c = new Client(srv.base);
    for (const p of ["/proof", "/ai", "/paypal", "/who-can-move-money", "/accessibility", "/agents"]) expect((await c.get(p)).status, p).toBe(200);
    const ai = (await c.get("/api/public/ai")).json;
    expect(["showcase", "none"]).toContain(ai.from);
    const pp = (await c.get("/api/public/paypal")).json;
    expect(["showcase", "none"]).toContain(pp.from);
    expect(JSON.stringify(pp)).not.toContain(TOKEN);
    const mcp = (await c.get("/api/public/mcp")).json;
    expect(mcp.key).toBeNull();
    expect(mcp.tools_outside.buyer).toContain("accept_quote");
    expect(mcp.agent_tools.every((t: any) => t.kind === "read" || t.kind === "propose")).toBe(true);
    const proof = (await c.get("/api/public/proof")).json;
    expect(proof.not_measured.length).toBeGreaterThan(3);
    expect(proof.thresholds.find((t: any) => t.name === "changed_payment_details")).toBeTruthy();
    const judge = (await c.get("/api/public/judge")).json;
    expect(JSON.stringify(judge)).not.toContain(TOKEN);
  });
});

describe("proof suites (spec A5.6)", () => {
  it("store every case with input, expected, answer and verdict; unbuilt cases are listed, never passed", { timeout: 60000 }, async () => {
    const runs = await runProof({ suites: ["scam", "regression"], trigger: "test" });
    const scam = runs.find((r) => r.suite === "scam")!;
    expect(scam.results).toHaveLength(SCAM_CASES.length);
    for (const c of scam.results) {
      expect(c.input.length).toBeGreaterThan(10);
      expect(["held", "not green", "not held"]).toContain(c.expected);
      expect(typeof c.pass).toBe("boolean");
    }
    // Without a model the second reader doesn't answer, so nothing is green, and every scam is still held by rules or code.
    expect(scam.results.filter((c) => c.actual === "green")).toHaveLength(0);
    expect(scam.results.find((c) => c.id === "ten-nov")).toMatchObject({ actual: "held", pass: true });
    const reg = runs.find((r) => r.suite === "regression")!;
    const byId = Object.fromEntries(reg.results.map((c) => [c.id, c]));
    expect(byId["ten-nov-message"]).toMatchObject({ pass: true });
    expect(byId["invoice-240-for-216"].pass).toBe(true);
    expect(byId["invoice-planted-instruction-new-payee"].pass).toBe(true);
    expect(byId["invoice-duplicate-new-number"]).toMatchObject({ pass: null, state: "not built" });
    expect(byId["photo-of-a-screen"]).toMatchObject({ pass: null, state: "not built" });
    expect(byId["why-cant-i-spend-20"]).toMatchObject({ pass: null, state: "not run" });
    expect(reg.cases).toBe(reg.results.filter((c) => c.pass !== null).length);

    const c = new Client(srv.base);
    const view = (await c.get("/api/public/proof")).json;
    // This server ran two suites; the third comes from the committed file and says so.
    expect(view.runs.map((r: any) => [r.suite, r.source])).toEqual([
      ["regression", "this server's run"],
      ["scam", "this server's run"],
      ["receiving", "committed file eval/proof/latest.json"],
    ]);
    expect(view.source).toMatch(/^database, with suites not yet run/);
    expect(view.runs[1].results).toHaveLength(SCAM_CASES.length);
    expect(new Date(view.runs[0].at).toDateString()).toBe(new Date().toDateString());
  });
});
