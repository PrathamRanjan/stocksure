import { createApp } from "./app.js";
import { config } from "./config.js";
import { getDb } from "./db.js";
import { startWorker } from "./worker.js";
import { installChannelHandlers } from "./channels/handlers.js";
import { providerLabel } from "./ai/provider.js";

const db = await getDb();
installChannelHandlers();
createApp().listen(config.port, () => {
  console.log(`[stocksure] ${config.appUrl} (db: ${db.kind}, paypal: ${config.paypal.env}, model: ${providerLabel()}${config.models.anthropicKey ? ` + anthropic ${config.models.model}` : ""})`);
});
if (config.inlineWorker) startWorker();
