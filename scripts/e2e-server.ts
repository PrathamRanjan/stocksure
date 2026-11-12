// Hermetic server for the Playwright suite: in-memory database, the fake PayPal, the demo seed, no .env.
// The payer email is as long as a real sandbox one, so layouts are tested with it.
// Nothing here talks to PayPal, OpenAI or any channel. Laneway starts connected to a fake vault so the money flow runs.
import { createApp } from "../src/app.js";
import { openDb, setDb } from "../src/db.js";
import { FakePayPal } from "../src/paypal/fake.js";
import { setPayPal } from "../src/paypal/index.js";
import { seedDemo } from "../src/services/seed.js";
import { startWorker } from "../src/worker.js";

import { config } from "../src/config.js";

const port = Number(process.env.E2E_PORT || 4471);
// Belt and braces: never call a real model from the e2e server, whatever the environment says.
config.ai.openaiKey = "";
config.ai.provider = "none";
if (!config.offlineRules) throw new Error("e2e server needs SS_OFFLINE_RULES=1 (the labelled offline text parser)");
const db = await openDb({ memory: true });
setDb(db);
const fake = new FakePayPal();
setPayPal(fake);

async function connect() {
  const { ids } = await db.tx((q) => seedDemo(q));
  const st = await fake.createSetupToken({ returnUrl: "x" }, `st-${Date.now()}`);
  fake.approveSetup(st.id);
  const t = await fake.createPaymentToken(st.id, `pt-${Date.now()}`);
  await db.query("UPDATE orgs SET vault_token_id = $2, vault_payer = 'sb-a1b2c3d4e5f6g7@personal.example.com' WHERE id = $1", [ids.laneway, t.id]);
  // The same fake token is the "saved demo wallet", so a private demo opened here gets paid orders, as on production.
  config.demo.vaultToken = t.id;
  config.demo.vaultPayer = "sb-a1b2c3d4e5f6g7@personal.example.com";
  // Every spec that opens a private demo comes from 127.0.0.1; production keeps its own per-address limit.
  config.demo.perAddressPerHour = 1000;
}
await connect();
const app = createApp();
startWorker(500);
app.listen(port, () => console.log(`[e2e] http://127.0.0.1:${port}`));
