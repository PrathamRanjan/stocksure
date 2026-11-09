/** Loads the demo data (one wholesaler, three buyers, the oat-milk scenario) and prints sign-in keys. */
import { getDb } from "../src/db.js";
import { seedDemo } from "../src/services/seed.js";

const db = await getDb();
const { keys } = await db.tx((q) => seedDemo(q, { keepPayPal: true }));
for (const [who, key] of Object.entries(keys)) console.log(`${who.padEnd(8)} ${key}`);
await db.close();
