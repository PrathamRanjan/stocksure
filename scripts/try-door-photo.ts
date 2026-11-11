/** `npx tsx --env-file=.env scripts/try-door-photo.ts`: reads both generated demo photos with the real models. Writes nothing. */
import { openDb, setDb } from "../src/db.js";
import { readDoorPhoto } from "../src/ai/door-photo.js";
import { doorPhoto, screenPhoto } from "../src/demo/sample-photos.js";
import { sampleDeliveryNote } from "../src/services/seed.js";
setDb(await openDb({ memory: true }));
const product = { id: "p1", sku: "OAT-B12", name: "Barista Oat 12 x 1 L", family: "plant-milk", base_unit: "ea", pack_units: 12, pack_label: "case", case_units: 12 } as any;
const cands = [{ line_id: "l1", ordered_units: 72, product }];
for (const [name, img] of [["door", await doorPhoto([{ sku: "OAT-B12", name: product.name, cases: 6 }], 2)], ["screen", await screenPhoto(sampleDeliveryNote("PO-1042", "Laneway Café", [{ sku: "OAT-B12", name: product.name, qty_packs: 6, pack_label: "case", unit_price_cents: 1200 }]))]] as const) {
  const t0 = Date.now();
  const r = await readDoorPhoto({ mime: "image/jpeg", body: img }, cands);
  console.log(name, `${Date.now() - t0} ms`, JSON.stringify({ source: r.source, screen: r.screen, failed: r.failed, lines: r.lines.map((l) => ({ qty: l.qty_text, units: l.units, line: l.line_id, flags: l.flags })), damage: r.damage.map((d) => ({ units: d.units, text: d.text })), notes: r.notes, decisions: r.decisions }, null, 1));
}
process.exit(0);
