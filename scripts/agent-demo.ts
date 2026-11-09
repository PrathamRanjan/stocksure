/**
 * Agent demo: a buyer agent talks to StockSure over MCP (Streamable HTTP) with the demo owner's key, drafts an
 * order, submits it, starts a negotiation and polls it. Run the app first (npm run dev), then: npm run agent:demo.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { getDb } from "../src/db.js";
import { setting } from "../src/store.js";
import { demoIds } from "../src/services/seed.js";

const base = process.env.APP_URL || `http://localhost:${process.env.PORT || 3300}`;
const db = await getDb();
const ids = await demoIds(db);
const keys = JSON.parse((await setting(db, "demo_keys")) ?? "{}");
if (!ids || !keys.jordan) throw new Error("Demo not seeded: open /demo and reset first");

const transport = new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { authorization: `Bearer ${keys.jordan}`, "x-agent-id": "agent-demo" } } });
const client = new Client({ name: "stocksure-agent-demo", version: "0.1.0" });
await client.connect(transport);
const call = async (name: string, args: Record<string, unknown> = {}) => {
  const r: any = await client.callTool({ name, arguments: args });
  const text = r.content?.[0]?.text ?? "";
  console.log(`\n> ${name}(${JSON.stringify(args)})\n${text.slice(0, 1200)}`);
  return JSON.parse(text);
};
const mandate = await call("get_mandate");
const cat = await call("list_catalog", { supplier_id: ids.supplier });
const first = cat.items[0];
const draft = await call("draft_order", { supplier_id: ids.supplier, lines: [{ sku: first.sku, qty_packs: 4 }], deliver_by: new Date(Date.now() + 2 * 864e5).toISOString(), spend_limit: (Number(first.price) * 4 * 1.1).toFixed(2), idempotency_key: `demo-${Date.now()}` });
if (draft.error) process.exit(1);
await call("submit_order", { po_id: draft.po_id });
if (mandate.rules?.agents_may_order) {
  const neg = await call("negotiate", { po_id: draft.po_id });
  if (!neg.error) {
    for (let i = 0; i < 12; i++) {
      await new Promise((r) => setTimeout(r, 2500));
      const st = await call("get_negotiation", { negotiation_id: neg.negotiation_id });
      if (st.status !== "open") break;
    }
  }
}
await call("get_order", { po_id: draft.po_id });
await client.close();
process.exit(0);
