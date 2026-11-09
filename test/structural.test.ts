/**
 * Structural safety tests (roadmap B.3).
 *  1. AI modules never import the PayPal client; PayPal code never imports AI.
 *  2. Every schema handed to the provider is free of money and PayPal id fields.
 *  3. No configured secret reaches a model input.
 *  4. Every PayPal write in the services runs behind the gate.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { assertSafeSchema, hashInput, setProviderFetch, structured } from "../src/ai/provider.js";
import { config } from "../src/config.js";

function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".ts")) out.push(p);
  }
  return out;
}

describe("structural safety", () => {
  it("AI modules never import payment code and payment code never imports AI", () => {
    for (const f of walk("src/ai").concat(walk("src/agents"))) {
      const src = readFileSync(f, "utf8");
      expect(src, `${f} imports paypal`).not.toMatch(/from "\.\.?\/(\.\.\/)?paypal\//);
    }
    for (const f of walk("src/paypal")) {
      const src = readFileSync(f, "utf8");
      expect(src, `${f} imports ai`).not.toMatch(/from "\.\.?\/ai\//);
    }
  });

  it("rejects schemas with money or PayPal id fields", () => {
    expect(() => assertSafeSchema({ type: "object", properties: { amount_cents: { type: "integer" } } })).toThrow(/money/);
    expect(() => assertSafeSchema({ type: "object", properties: { capture_id: { type: "string" } } })).toThrow();
    expect(() => assertSafeSchema({ type: "object", properties: { nested: { type: "object", properties: { refund_amount: { type: "number" } } } } })).toThrow();
    expect(() => assertSafeSchema({ type: "object", properties: { unit_price: { type: "string" }, quantity_text: { type: "string" } } })).not.toThrow();
  });

  it("every schema used in src passes the safety check", () => {
    let found = 0;
    for (const f of walk("src")) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(/properties:\s*\{/g)) {
        found++;
        const slice = src.slice(m.index!, m.index! + 4000);
        expect(slice, `${f} has a forbidden field name in a schema`).not.toMatch(/\b(amount_cents|capture_id|refund_id|authorization_id|payout_amount|payment_token_id|receiver_email)\s*:\s*\{/);
      }
    }
    expect(found).toBeGreaterThan(0);
  });

  it("no configured secret reaches the model", async () => {
    const sentinel = "SENTINEL-" + Math.random().toString(36).slice(2);
    const saved = { ...config.paypal };
    const savedAi = { provider: config.ai.provider, key: config.ai.openaiKey };
    (config.paypal as any).clientSecret = sentinel;
    (config as any).ai.provider = "openai";
    (config as any).ai.openaiKey = "sk-test";
    let body = "";
    setProviderFetch((async (_i: any, init: any) => {
      body = String(init?.body ?? "");
      return new Response(JSON.stringify({ model: "m", output: [{ type: "message", content: [{ type: "output_text", text: '{"ok":true}' }] }], usage: { input_tokens: 1, output_tokens: 1 } }), { status: 200 });
    }) as any);
    try {
      await structured<any>({ purpose: "eval", tier: "classify", system: "test", parts: [{ type: "text", text: "hello" }], schemaName: "t", schema: { type: "object", properties: { ok: { type: "boolean" } } }, allowReplay: false });
      expect(body).not.toContain(sentinel);
      expect(body).not.toContain(config.sessionSecret);
    } finally {
      setProviderFetch(null);
      Object.assign(config.paypal, saved);
      (config as any).ai.provider = savedAi.provider;
      (config as any).ai.openaiKey = savedAi.key;
    }
  });

  it("input hashing is stable and content-sensitive", () => {
    const a = hashInput({ system: "s", parts: [{ type: "text", text: "x" }], schemaName: "n" });
    const b = hashInput({ system: "s", parts: [{ type: "text", text: "x" }], schemaName: "n" });
    const c = hashInput({ system: "s", parts: [{ type: "text", text: "y" }], schemaName: "n" });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it("every PayPal write in the services is preceded by the gate", () => {
    const writes = ["createVaultedAuthorizeOrder", "captureAuthorization", "refundCapture", "reauthorize"];
    const files = ["src/services/orders.ts", "src/services/settle.ts", "src/services/aftercare.ts", "src/services/reauth.ts"];
    let seen = 0;
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      for (const w of writes) {
        for (const m of src.matchAll(new RegExp(`\\.${w}\\(`, "g"))) {
          seen++;
          const before = src.slice(Math.max(0, m.index! - 2500), m.index!);
          expect(before, `${f}: ${w} is called without dryRun() before it`).toMatch(/dryRun\(/);
        }
      }
    }
    expect(seen).toBeGreaterThan(0);
  });
});
