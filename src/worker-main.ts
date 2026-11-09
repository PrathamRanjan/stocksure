import { getDb } from "./db.js";
import { startWorker } from "./worker.js";
import { installChannelHandlers } from "./channels/handlers.js";

await getDb();
installChannelHandlers();
startWorker();
