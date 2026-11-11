/** `npx tsx scripts/render-sample-photos.ts <dir>`: writes the two generated demo photos for a look. */
import { writeFileSync } from "node:fs";
import { doorPhoto, screenPhoto } from "../src/demo/sample-photos.js";
import { sampleDeliveryNote } from "../src/services/seed.js";
const dir = process.argv[2] ?? ".";
writeFileSync(`${dir}/door.jpg`, await doorPhoto([{ sku: "OAT-B12", name: "Barista Oat 12 x 1 L", cases: 6 }], 2));
writeFileSync(`${dir}/screen.jpg`, await screenPhoto(sampleDeliveryNote("PO-1042", "Laneway Café", [{ sku: "OAT-12", name: "Oat Milk 12 x 1 L", qty_packs: 20, pack_label: "case", unit_price_cents: 1000 }])));
