/** What the PayPal sandbox app can do for StockSure. Creates only a setup token. */
import { config } from "../src/config.js";
import { paypal } from "../src/paypal/index.js";

const pp = paypal();
const { appId, scopes } = await pp.verifyCredentials();
console.log(`✓ OAuth (${appId ?? "?"}, ${config.paypal.env})`);
console.log(`${scopes.some((s) => s.includes("vault")) ? "✓" : "✗"} Vault scope (buyer saves PayPal once; holds are merchant-initiated)`);
const st = await pp.createSetupToken({ returnUrl: `${config.appUrl}/connect-paypal/return`, cancelUrl: `${config.appUrl}/home`, description: "check" }, `check-${Date.now()}`);
console.log(`${st.approveUrl ? "✓" : "✗"} Vault setup token ${st.id}`);
console.log(`${config.paypal.webhookId ? "✓" : "…"} PAYPAL_WEBHOOK_ID ${config.paypal.webhookId ? "set" : "not set (optional)"}`);
console.log(`${config.ai.provider === "openai" && config.ai.openaiKey ? "✓" : "…"} AI reader: ${config.ai.provider === "openai" && config.ai.openaiKey ? `OpenAI ${config.ai.models.read} (vision ${config.ai.models.vision})` : config.models.anthropicKey ? `Anthropic ${config.models.model}` : "none configured (text parser; images kept as evidence for a person)"}`);
