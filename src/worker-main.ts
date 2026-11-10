import { assertProductionReady } from "./config.js";
import { getDb } from "./db.js";
import { startWorker } from "./worker.js";
import { installChannelHandlers } from "./channels/handlers.js";

assertProductionReady();
await getDb();
installChannelHandlers();
startWorker();
