/**
 * Spec A5.3 (b): PayPal's own hosted MCP server, sandbox, as read-only tools for the agent.
 *
 * The server (`https://mcp.sandbox.paypal.com/sse`, the SSE transport; checked 11 Nov 2026) lists 47 tools, many of
 * which write (create_order, pay_order, create_refund, send_invoice …). The agent is offered only the names in
 * READ_TOOLS; everything else is dropped before the model sees the list, and `callPayPalTool` refuses any name not
 * on it. The access token is minted from this app's own client id and secret, as the app's PayPal client does.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { config, paypalBaseUrl } from "../config.js";

/** PayPal MCP tools the agent may call. Every one only reads. */
export const READ_TOOLS = ["get_order", "list_transactions", "get_refund", "list_disputes", "get_dispute", "get_invoice", "list_invoices", "get_shipment_tracking"] as const;
/** Words that mark a tool as one that changes something; a structural test checks READ_TOOLS against it. */
export const WRITE_WORDS = /^(create|pay|capture|cancel|delete|send|update|accept|record|activate|setup|generate|refund|void|authorize)/;

export interface PayPalMcp {
  tools: { name: string; description: string; inputSchema: Record<string, unknown> }[];
  call: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  close: () => Promise<void>;
}

let token: { value: string; until: number } | null = null;
async function accessToken(): Promise<string> {
  if (token && token.until > Date.now() + 60_000) return token.value;
  const r = await fetch(`${paypalBaseUrl()}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: "Basic " + Buffer.from(`${config.paypal.clientId}:${config.paypal.clientSecret}`).toString("base64"), "content-type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
    signal: AbortSignal.timeout(10_000),
  });
  if (!r.ok) throw new Error(`PayPal token ${r.status}`);
  const j = await r.json();
  token = { value: j.access_token, until: Date.now() + Number(j.expires_in ?? 3000) * 1000 };
  return token.value;
}

/** Connects for one agent run. Throws when the server cannot be reached; the caller says so on the rail. */
export async function connectPayPalMcp(timeoutMs = 8_000): Promise<PayPalMcp> {
  if (!config.ai.paypalMcpUrl) throw new Error("PayPal MCP is switched off (PAYPAL_MCP_URL is empty)");
  if (config.paypal.env !== "sandbox") throw new Error("PayPal MCP is only used with the sandbox");
  const tok = await accessToken();
  const headers = { Authorization: `Bearer ${tok}` };
  const transport = new SSEClientTransport(new URL(config.ai.paypalMcpUrl), {
    requestInit: { headers },
    eventSourceInit: { fetch: (u: any, i: any) => fetch(u, { ...i, headers: { ...(i?.headers ?? {}), ...headers } }) } as any,
  });
  const client = new Client({ name: "stocksure-agent", version: "1.0.0" });
  const timer = new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`PayPal MCP did not answer in ${timeoutMs} ms`)), timeoutMs));
  await Promise.race([client.connect(transport), timer]);
  const listed = await Promise.race([client.listTools(), timer]);
  const allowed = new Set<string>(READ_TOOLS);
  const tools = listed.tools.filter((t) => allowed.has(t.name)).map((t) => ({ name: t.name, description: (t.description ?? "").replace(/\s+/g, " ").trim().slice(0, 600), inputSchema: (t.inputSchema ?? { type: "object", properties: {} }) as Record<string, unknown> }));
  return {
    tools,
    call: async (name, args) => {
      if (!allowed.has(name)) throw new Error(`${name} is not a read tool; refused`);
      const r = await Promise.race([client.callTool({ name, arguments: args }), new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`PayPal MCP ${name} took longer than 15 s`)), 15_000))]);
      const text = ((r as any).content ?? []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n");
      try {
        return JSON.parse(text);
      } catch {
        return text.slice(0, 4000);
      }
    },
    close: () => client.close().catch(() => undefined),
  };
}
