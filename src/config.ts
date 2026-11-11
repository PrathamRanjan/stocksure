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
/** Production is NODE_ENV=production or any Render deploy. Tests (vitest sets NODE_ENV=test) are never production. */
const production = process.env.NODE_ENV === "production" || (Boolean(process.env.RENDER) && process.env.NODE_ENV !== "test");
/** The rules reader and text parser exist only for tests and labelled offline evaluation arms (spec A11). */
const offlineRules = !production && (process.env.NODE_ENV === "test" || bool(process.env.SS_OFFLINE_RULES, false));

export const config = {
  port,
  production,
  offlineRules,
  /** Git commit of this build (Render sets RENDER_GIT_COMMIT). Shown by /healthz. */
  commit: process.env.RENDER_GIT_COMMIT || process.env.SS_COMMIT || "",
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
  /** Spec A5.1: one OpenAI key for every AI job. Each tier names a primary model and a backup (a second real model,
   *  never rules). Production refuses to start without the key. */
  ai: {
    provider: (process.env.AI_PROVIDER || (process.env.OPENAI_API_KEY ? "openai" : "none")) as "openai" | "none",
    openaiKey: process.env.OPENAI_API_KEY || "",
    openaiBaseUrl: (process.env.OPENAI_BASE_URL || "https://api.openai.com").replace(/\/$/, ""),
    models: {
      /** Reading delivery notes, invoices and photos. */
      read: process.env.AI_MODEL_READ || "gpt-6.1-sol",
      readBackup: process.env.AI_MODEL_READ_BACKUP || "gpt-6-sol",
      vision: process.env.AI_MODEL_VISION || "gpt-6.1-sol",
      visionBackup: process.env.AI_MODEL_VISION_BACKUP || "gpt-6-sol",
      /** Small wording jobs and short answers. */
      classify: process.env.AI_MODEL_CLASSIFY || "gpt-6-luna",
      classifyBackup: process.env.AI_MODEL_CLASSIFY_BACKUP || "gpt-6.1-sol",
      /** Spec A5.2: yes/no, routing and scoring on the Decisions API. */
      decide: process.env.AI_MODEL_DECIDE || "gpt-6-luna",
      /** Spec A5.3: the agent loop. */
      agent: process.env.AI_MODEL_AGENT || "gpt-6.1-sol",
    },
    /** Spec A5.3 / C3: caps on the agent loop and a daily allowance per workspace. */
    agentMaxSteps: num(process.env.AI_AGENT_MAX_STEPS, 8),
    agentMaxMs: num(process.env.AI_AGENT_MAX_MS, 45_000),
    agentDailyQuestions: num(process.env.AI_AGENT_DAILY_QUESTIONS, 25),
    /** PayPal's hosted MCP server (read tools only are offered to the agent). Empty disables it. */
    paypalMcpUrl: process.env.PAYPAL_MCP_URL ?? (process.env.NODE_ENV === "test" ? "" : "https://mcp.sandbox.paypal.com/sse"),
    /** Spec A5.4: extraction gets room to finish its JSON. */
    extractMaxTokens: num(process.env.AI_EXTRACT_MAX_TOKENS, 4000),
  },
  /** Spec A1/A2.1: private demo workspaces and the saved sandbox wallet they pay from. */
  demo: {
    vaultToken: process.env.PAYPAL_DEMO_VAULT_TOKEN || "",
    vaultPayer: process.env.PAYPAL_DEMO_VAULT_PAYER || "",
    idleHours: num(process.env.SS_WORKSPACE_IDLE_HOURS, 48),
    maxWorkspaces: num(process.env.SS_MAX_WORKSPACES, 300),
    perAddressPerHour: num(process.env.SS_WORKSPACES_PER_ADDRESS_HOUR, 5),
    /** Behind this key: the global reset, the wallet re-approval page and workspace housekeeping. Empty disables them. */
    adminKey: process.env.SS_ADMIN_KEY || "",
    /** One-click sign-in to the shared base demo. Tests and local runs only; in production every visitor gets a
     *  private workspace instead. */
    baseSignIn: !production && bool(process.env.SS_BASE_DEMO_SIGNIN, true),
  },
  /** Roadmap B.8: channels. Empty tokens mean the in-app simulator only. */
  channels: {
    telegramToken: process.env.TELEGRAM_BOT_TOKEN || "",
    telegramSecret: process.env.TELEGRAM_WEBHOOK_SECRET || "",
    telegramBot: process.env.TELEGRAM_BOT_USERNAME || "paypalhackathonbot",
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
  /** Shared with the nightly robot judge (GitHub Actions); unset, the robot-judge endpoint answers 404. */
  robotJudgeToken: process.env.ROBOT_JUDGE_TOKEN || "",
};

export function paypalBaseUrl(env: "sandbox" | "live" = config.paypal.env): string {
  return env === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
}

/**
 * Spec A11: in production the server will not start without its keys, so no page can quietly run on rules or show
 * a PayPal step that cannot work. Returns the missing settings (empty when ready).
 */
export function missingProductionKeys(): string[] {
  if (!config.production) return [];
  const miss: string[] = [];
  if (!config.ai.openaiKey) miss.push("OPENAI_API_KEY");
  if (config.ai.provider !== "openai") miss.push("AI_PROVIDER=openai");
  if (!config.paypal.clientId) miss.push("PAYPAL_CLIENT_ID");
  if (!config.paypal.clientSecret) miss.push("PAYPAL_CLIENT_SECRET");
  if (!process.env.SESSION_SECRET) miss.push("SESSION_SECRET");
  return miss;
}

export function assertProductionReady() {
  const miss = missingProductionKeys();
  if (miss.length) {
    console.error(`[stocksure] refusing to start in production: missing ${miss.join(", ")}`);
    process.exit(1);
  }
}
