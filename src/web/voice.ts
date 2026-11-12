/**
 * Spec A7 "voice both ways": push-to-talk on the main inputs (Ask, the receive page's docket box) through OpenAI's
 * gpt-live-1. The browser streams 24 kHz 16-bit mono PCM to this server over a WebSocket at /api/ui/voice; the
 * server holds the OpenAI key, opens a live session, forwards the audio and relays the input transcript as it
 * arrives. The model's spoken reply is discarded: this is dictation, and the person reads and sends the text
 * themselves. Typing always works. Each demo has a daily allowance of voice seconds.
 */
import type { IncomingMessage, Server } from "node:http";
import { createHash } from "node:crypto";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import { config } from "../config.js";
import { getDb, withWorkspace } from "../db.js";
import { unsign } from "../lib/crypto.js";
import { audit, hasOpenAI } from "../ai/provider.js";
import { liveWorkspace } from "../demo/workspaces.js";
import { personById, putSetting, setting } from "../store.js";
import { COOKIE } from "./auth.js";
import { WS_COOKIE } from "../demo/routes.js";

export const VOICE_MODEL = "gpt-live-1";
/** OpenAI's published price for the gpt-live-1 voice layer: $0.05 a minute. */
export const VOICE_USD_PER_MIN = 0.05;
export const MAX_SECONDS_PER_TURN = 30;
export const DAILY_SECONDS = 600;
const BYTES_PER_SECOND = 24000 * 2;

let liveUrl = "wss://api.openai.com/v1/live/sessions";
/** Tests point this at a local stand-in for OpenAI. */
export function setLiveUrl(u: string | null) {
  liveUrl = u ?? "wss://api.openai.com/v1/live/sessions";
}

function cookies(req: IncomingMessage): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of String(req.headers.cookie ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

async function whoIs(req: IncomingMessage) {
  const c = cookies(req);
  const ws = config.demoMode ? unsign(c[WS_COOKIE]) : null;
  const pid = unsign(c[COOKIE]);
  if (!pid) return null;
  if (config.demoMode) {
    const w = ws ? await liveWorkspace(ws) : null;
    if (!w) return null;
    const p = await withWorkspace(w.id, async () => personById(await getDb(), pid));
    return p ? { p, ws: w.id } : null;
  }
  const p = await withWorkspace(null, async () => personById(await getDb(), pid));
  return p ? { p, ws: null } : null;
}

const today = () => new Date().toISOString().slice(0, 10);

export function attachVoice(server: Server) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 });
  server.on("upgrade", (req, socket, head) => {
    if (!req.url?.startsWith("/api/ui/voice")) return;
    // Same-origin only: a page elsewhere can't use a visitor's cookies to spend their voice allowance.
    const origin = req.headers.origin;
    if (origin && origin !== new URL(config.appUrl).origin && !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
      socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
      return socket.destroy();
    }
    wss.handleUpgrade(req, socket, head, (client) => void session(client, req));
  });
}

async function session(client: WebSocket, req: IncomingMessage) {
  const send = (o: unknown) => client.readyState === WebSocket.OPEN && client.send(JSON.stringify(o));
  const fail = (message: string) => {
    send({ type: "error", message });
    client.close();
  };
  const who = await whoIs(req).catch(() => null);
  if (!who) return fail("Sign in first.");
  if (!hasOpenAI()) return fail("Voice needs the AI, which isn't configured on this server. Type instead.");
  const key = `voice_seconds:${today()}`;
  const used = await withWorkspace(who.ws, async () => Number((await setting(await getDb(), key)) ?? 0));
  if (used >= DAILY_SECONDS) return fail(`This demo has used its ${DAILY_SECONDS / 60} minutes of voice for today. Type instead.`);

  const t0 = Date.now();
  let bytes = 0;
  let transcript = "";
  let lastDelta = 0;
  let stopped = false;
  let finished = false;
  const pending: Buffer[] = [];
  const up = new WebSocket(liveUrl, { headers: { Authorization: `Bearer ${config.ai.openaiKey}` } });
  let started = false;

  const finish = async (error: string | null) => {
    if (finished) return;
    finished = true;
    const seconds = Math.ceil(Math.max(bytes / BYTES_PER_SECOND, (Date.now() - t0) / 1000));
    try {
      if (up.readyState === WebSocket.OPEN) up.send(JSON.stringify({ type: "session.close" }));
      up.close();
    } catch {
      /* already closed */
    }
    await withWorkspace(who.ws, async () => {
      const db = await getDb();
      await putSetting(db, key, String(used + seconds));
      await audit({ purpose: "voice_input", model: VOICE_MODEL, via: "primary", inputHash: createHash("sha256").update(String(bytes)).digest("hex"), outputHash: createHash("sha256").update(transcript).digest("hex"), tokensIn: 0, tokensOut: 0, costUsd: (seconds / 60) * VOICE_USD_PER_MIN, latencyMs: Date.now() - t0, ok: !error, error, output: error ? null : { transcript: transcript.slice(0, 500), audio_seconds: Math.round(bytes / BYTES_PER_SECOND) }, runId: null });
    }).catch(() => undefined);
    if (error) send({ type: "error", message: error });
    else send({ type: "done", text: transcript.trim(), model: VOICE_MODEL, seconds });
    client.close();
  };

  const forward = (b: Buffer) => up.send(JSON.stringify({ type: "session.input_audio.append", audio: b.toString("base64") }));
  up.on("open", () => up.send(JSON.stringify({ type: "session.start", event_id: "event_start", session: { model: VOICE_MODEL, instructions: "You are a dictation transcriber for a café's ordering app. The speaker may use English, Hindi, Indonesian or Brazilian Portuguese, or mix Hindi and English; transcribe in the language spoken (Hindi in Devanagari). Never answer; stay silent.", audio: { format: { type: "audio/pcm", rate: 24000 } } } })));
  up.on("message", (raw: RawData) => {
    let e: any;
    try {
      e = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (e.type === "session.started") {
      started = true;
      send({ type: "ready", model: VOICE_MODEL });
      for (const b of pending.splice(0)) forward(b);
    } else if (e.type === "session.input_transcript.delta" && typeof e.delta === "string") {
      transcript += e.delta;
      lastDelta = Date.now();
      send({ type: "delta", text: e.delta });
    } else if (e.type === "error" || e.type === "session.error") {
      void finish(`The voice service said: ${String(e.error?.message ?? e.message ?? "error").slice(0, 160)}. Type instead.`);
    }
    // session.output_audio.* (the model's spoken reply) is ignored: this is dictation only.
  });
  up.on("error", () => void finish("The voice service couldn't be reached. Type instead."));
  up.on("close", () => void finish(stopped ? null : "The voice service closed early. Type instead."));

  client.on("message", (raw: RawData, isBinary: boolean) => {
    if (finished) return;
    if (isBinary) {
      const b = Buffer.isBuffer(raw) ? raw : Buffer.from(raw as ArrayBuffer);
      if (b.length % 2) return; // 16-bit samples only
      bytes += b.length;
      if (bytes > MAX_SECONDS_PER_TURN * BYTES_PER_SECOND) return void stop();
      if (started) forward(b);
      else pending.push(b);
      return;
    }
    try {
      if (JSON.parse(raw.toString()).type === "stop") stop();
    } catch {
      /* ignore */
    }
  });
  client.on("close", () => {
    if (!finished) void finish(null);
  });

  // After the person lets go: a second of silence so the model hears the end, then wait for the transcript to
  // settle (no new words for 1.2 s), at most 8 s.
  function stop() {
    if (stopped) return;
    stopped = true;
    const silence = Buffer.alloc(BYTES_PER_SECOND);
    if (started) forward(silence);
    else pending.push(silence);
    const until = Date.now() + 8000;
    const tick = () => {
      if (finished) return;
      if ((lastDelta && Date.now() - lastDelta > 1200) || Date.now() > until) return void finish(null);
      setTimeout(tick, 200);
    };
    setTimeout(tick, 600);
  }
}
