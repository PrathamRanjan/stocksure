import { randomBytes } from "node:crypto";

function bool(v: string | undefined, dflt: boolean): boolean {
  if (v === undefined || v === "") return dflt;
  return ["1", "true", "yes", "on"].includes(v.toLowerCase());
}
function num(v: string | undefined, dflt: number): number {
  const n = Number(v);
  return v === undefined || v === "" || !Number.isFinite(n) ? dflt : n;
}

const port = num(process.env.PORT, 3300);

export const config = {
  port,
  appUrl: (process.env.APP_URL || process.env.RENDER_EXTERNAL_URL || `http://localhost:${port}`).replace(/\/$/, ""),
  databaseUrl: process.env.DATABASE_URL || "",
  pglitePath: process.env.PGLITE_PATH || "./data/pglite",
  paypal: {
    env: (process.env.PAYPAL_ENV || "sandbox") as "sandbox" | "live",
    clientId: process.env.PAYPAL_CLIENT_ID || "",
    clientSecret: process.env.PAYPAL_CLIENT_SECRET || "",
    webhookId: process.env.PAYPAL_WEBHOOK_ID || "",
  },
  currency: (process.env.SS_CURRENCY || "USD").toUpperCase(),
  sessionSecret: process.env.SESSION_SECRET || randomBytes(32).toString("hex"),
  demoMode: bool(process.env.SS_DEMO_MODE, true),
  inlineWorker: bool(process.env.SS_INLINE_WORKER, true),
  workerIntervalMs: num(process.env.SS_WORKER_INTERVAL_MS, 2000),
  maxUploadBytes: num(process.env.SS_MAX_UPLOAD_BYTES, 5 * 1024 * 1024),
  models: {
    anthropicKey: process.env.ANTHROPIC_API_KEY || "",
    anthropicBaseUrl: (process.env.SS_ANTHROPIC_BASE_URL || "https://api.anthropic.com").replace(/\/$/, ""),
    model: process.env.SS_MODEL || "claude-haiku-5-5",
  },
  /** Roadmap B.1: provider layer. "openai" uses the Responses API; "none" falls back to the Anthropic path or the text parser. */
  ai: {
    provider: (process.env.AI_PROVIDER || (process.env.OPENAI_API_KEY ? "openai" : "none")) as "openai" | "none",
    openaiKey: process.env.OPENAI_API_KEY || "",
    openaiBaseUrl: (process.env.OPENAI_BASE_URL || "https://api.openai.com").replace(/\/$/, ""),
    models: {
      vision: process.env.AI_MODEL_VISION || "gpt-5.6-luna",
      read: process.env.AI_MODEL_READ || "gpt-5.5",
      classify: process.env.AI_MODEL_CLASSIFY || "gpt-5.4-mini",
    },
  },
  /** Roadmap B.8: channels. Empty tokens mean the in-app simulator only. */
  channels: {
    telegramToken: process.env.TELEGRAM_BOT_TOKEN || "",
    telegramSecret: process.env.TELEGRAM_WEBHOOK_SECRET || "",
    whatsappToken: process.env.WHATSAPP_TOKEN || "",
    whatsappPhoneId: process.env.WHATSAPP_PHONE_ID || "",
    whatsappVerifyToken: process.env.WHATSAPP_VERIFY_TOKEN || "stocksure-verify",
    vapidPublic: process.env.VAPID_PUBLIC_KEY || "",
    vapidPrivate: process.env.VAPID_PRIVATE_KEY || "",
  },
  /** Roadmap B.6: approvals above this need a passkey countersign, not a click or a chat reply. */
  guard: {
    countersignAboveCents: num(process.env.SS_COUNTERSIGN_ABOVE_CENTS, 50000),
    reauthorizeAfterDays: num(process.env.SS_REAUTHORIZE_AFTER_DAYS, 3),
  },
  agStudioLicense: process.env.AG_STUDIO_LICENSE || "",
};

export function paypalBaseUrl(env: "sandbox" | "live" = config.paypal.env): string {
  return env === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
}
