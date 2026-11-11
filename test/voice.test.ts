/**
 * Spec A7: push-to-talk dictation. The browser streams PCM to /api/ui/voice; the server opens a gpt-live-1 session
 * (here a local stand-in for OpenAI), forwards the audio and relays the input transcript. Signed-out sockets are
 * refused, the daily allowance is enforced, and the model's spoken reply never reaches the browser.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket, WebSocketServer } from "ws";
import type { AddressInfo } from "node:net";
import { createApp } from "../src/app.js";
import { config } from "../src/config.js";
import { openDb, setDb, withWorkspace, type Db } from "../src/db.js";
import { FakePayPal } from "../src/paypal/fake.js";
import { setPayPal } from "../src/paypal/index.js";
import { getWorkspace, seedStatus } from "../src/demo/workspaces.js";
import { attachVoice, DAILY_SECONDS, setLiveUrl } from "../src/web/voice.js";
import { demoIds } from "../src/services/seed.js";
import { putSetting } from "../src/store.js";
import { Client } from "./client.js";
import { serveTracked } from "./journey-coverage.js";

let db: Db;
let srv: Awaited<ReturnType<typeof serveTracked>>;
let fakeLive: WebSocketServer;
const got: { start?: any; audioBytes: number } = { audioBytes: 0 };
const saved = { demo: { ...config.demo }, key: config.ai.openaiKey, provider: config.ai.provider };

beforeEach(async () => {
  db = await openDb({ memory: true });
  setDb(db);
  const fake = new FakePayPal();
  fake.tokens.add("TOKEN-DEMO-WALLET");
  setPayPal(fake);
  config.demo.vaultToken = "TOKEN-DEMO-WALLET";
  config.demo.vaultPayer = "sandbox-buyer@example.com";
  config.demo.perAddressPerHour = 50;
  config.ai.openaiKey = "sk-test";
  config.ai.provider = "openai";
  got.start = undefined;
  got.audioBytes = 0;
  // A stand-in for wss://api.openai.com/v1/live/sessions.
  fakeLive = new WebSocketServer({ port: 0 });
  fakeLive.on("connection", (s, req) => {
    expect(req.headers.authorization).toBe("Bearer sk-test");
    s.on("message", (raw) => {
      const e = JSON.parse(raw.toString());
      if (e.type === "session.start") {
        got.start = e;
        s.send(JSON.stringify({ type: "session.started" }));
      } else if (e.type === "session.input_audio.append") {
        got.audioBytes += Buffer.from(e.audio, "base64").length;
        if (got.audioBytes >= 9600 && got.audioBytes < 9600 + 48000) {
          s.send(JSON.stringify({ type: "session.output_audio.delta", delta: "AAAA" }));
          s.send(JSON.stringify({ type: "session.input_transcript.delta", delta: "Which supplier " }));
          s.send(JSON.stringify({ type: "session.input_transcript.delta", delta: "short-delivers most?" }));
        }
      }
    });
  });
  await new Promise((r) => fakeLive.on("listening", r));
  setLiveUrl(`ws://127.0.0.1:${(fakeLive.address() as AddressInfo).port}`);
  srv = await serveTracked(createApp());
  attachVoice(srv.server as any);
});
afterEach(async () => {
  Object.assign(config.demo, saved.demo);
  config.ai.openaiKey = saved.key;
  config.ai.provider = saved.provider;
  setLiveUrl(null);
  fakeLive.close();
  await srv.close();
  setPayPal(null);
  await db.close();
});

function talk(cookie: string | null, pcm: Buffer | null): Promise<any[]> {
  return new Promise((resolve) => {
    const out: any[] = [];
    const ws = new WebSocket(srv.base.replace("http", "ws") + "/api/ui/voice", { headers: cookie ? { cookie } : {} });
    ws.on("open", () => {
      if (pcm) ws.send(pcm);
      ws.send(JSON.stringify({ type: "stop" }));
    });
    ws.on("message", (m) => out.push(JSON.parse(m.toString())));
    ws.on("close", () => resolve(out));
  });
}

describe("push-to-talk voice", () => {
  it("relays the gpt-live-1 transcript for a signed-in person, never the spoken reply, and counts the allowance", { timeout: 60000 }, async () => {
    expect((await talk(null, null)).at(-1)).toMatchObject({ type: "error", message: "Sign in first." });
    const c = new Client(srv.base);
    expect((await c.postJson("/demo/start", {})).json.ok).toBe(true);
    const ws = (await c.get("/api/ui/workspace")).json.workspace.id;
    for (let i = 0; i < 400 && !(await seedStatus((await getWorkspace(ws))!)).done; i++) await new Promise((r) => setTimeout(r, 25));
    const ids = await withWorkspace(ws, async () => (await demoIds(db))!);
    expect((await c.post("/login", { person_id: ids.people.jordan, next: "/home" })).status).toBe(302);
    const cookie = [...c.cookies].map(([k, v]) => `${k}=${v}`).join("; ");

    const events = await talk(cookie, Buffer.alloc(9600));
    expect(got.start.session.model).toBe("gpt-live-1");
    expect(got.start.session.audio.format).toEqual({ type: "audio/pcm", rate: 24000 });
    expect(got.audioBytes).toBe(9600 + 48000); // the speech, then a second of silence
    expect(events.map((e) => e.type)).toEqual(["ready", "delta", "delta", "done"]);
    expect(events.at(-1)).toMatchObject({ text: "Which supplier short-delivers most?", model: "gpt-live-1" });
    const call = await withWorkspace(ws, async () => (await db.query<any>("SELECT purpose, model, ok, cost_usd FROM ai_calls WHERE purpose = 'voice_input'")).rows[0]);
    expect(call).toMatchObject({ purpose: "voice_input", model: "gpt-live-1", ok: true });

    // The allowance: a demo that has used today's voice minutes is told so, and nothing is opened upstream.
    await withWorkspace(ws, () => putSetting(db, `voice_seconds:${new Date().toISOString().slice(0, 10)}`, String(DAILY_SECONDS)));
    got.start = undefined;
    expect((await talk(cookie, Buffer.alloc(9600))).at(-1).message).toMatch(/minutes of voice for today/);
    expect(got.start).toBeUndefined();
  });
});
