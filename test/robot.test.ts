/** Spec A4/A12: the nightly robot judge posts its run; /proof shows the last one. Token-gated; 404 when unset. */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { config } from "../src/config.js";
import { openDb, setDb, type Db } from "../src/db.js";
import { Client } from "./client.js";
import { serveTracked } from "./journey-coverage.js";

let db: Db;
let srv: Awaited<ReturnType<typeof serveTracked>>;
const saved = config.robotJudgeToken;
beforeEach(async () => {
  db = await openDb({ memory: true });
  setDb(db);
  srv = await serveTracked(createApp());
});
afterEach(async () => {
  config.robotJudgeToken = saved;
  await srv.close();
  await db.close();
});

describe("robot judge", () => {
  it("accepts a run only with the token, and /proof shows it; the accessibility results are public", async () => {
    const c = new Client(srv.base);
    const run = { ran_at: "2026-11-11T03:20:00Z", base: "https://pph-stocksure.onrender.com", times: { path_a_s: 40 }, steps: [{ path: "short", key: "counted", done: true }, { path: "agents", key: "agents_agreed", done: false }], passed: true, run_url: "https://github.com/x/y/actions/runs/1" };
    config.robotJudgeToken = "";
    expect((await c.req("POST", "/api/robot-judge", { json: run })).status).toBe(404);
    config.robotJudgeToken = "robot-test-token-123";
    expect((await c.req("POST", "/api/robot-judge", { json: run, headers: { authorization: "Bearer wrong-token-xxxxxx" } })).status).toBe(401);
    const ok = await c.req("POST", "/api/robot-judge", { json: run, headers: { authorization: "Bearer robot-test-token-123" } });
    expect(ok.status).toBe(200);
    // A step not ticked means not passed, whatever the poster says.
    expect(ok.json.passed).toBe(false);
    const proof = (await c.get("/api/public/proof")).json;
    expect(proof.robot_judge).toMatchObject({ passed: false, base: run.base, run_url: run.run_url });
    const a11y = (await c.get("/api/public/accessibility")).json;
    expect(a11y.voice.model).toBe("gpt-live-1");
    expect(a11y.last.results.length).toBeGreaterThan(0);
  });
});
