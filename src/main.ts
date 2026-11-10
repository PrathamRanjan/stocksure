import { createApp } from "./app.js";
import { assertProductionReady, config } from "./config.js";
import { getDb } from "./db.js";
import { startWorker } from "./worker.js";
import { installChannelHandlers } from "./channels/handlers.js";
import { providerLabel } from "./ai/provider.js";

assertProductionReady();
const db = await getDb();
installChannelHandlers();
createApp().listen(config.port, () => {
  console.log(`[stocksure] ${config.appUrl} (db: ${db.kind}, paypal: ${config.paypal.env}, model: ${providerLabel()}, commit: ${config.commit || "local"})`);
});
if (config.inlineWorker) startWorker();
