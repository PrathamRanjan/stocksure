// Crops real UI fragments out of the 2x/3x captures (coords in CSS px; scale = capture DPR).
import { chromium } from "/Users/prathamranjan/Documents/Codex/2026-11-02/w/stocksure/web/node_modules/playwright/index.mjs";
import { readFileSync, writeFileSync } from "node:fs";
const D = "capture/shots/";
const C = [
  ["f-doorphoto", "phone-door-photo-result", 3, 34, 88, 344, 84],
  ["f-suggest", "receive-read", 2, 832, 400, 486, 346],
  ["f-money", "money-panel-reconciled", 1, 0, 0, 704, 562],
  ["f-paypal", "paypal-ops", 1, 0, 0, 704, 600],
  ["f-reconcile", "reconcile", 1, 0, 180, 620, 224],
  ["f-moves", "order-resolution-page", 2, 360, 516, 588, 180],
  ["f-agreement", "order-resolution-page", 2, 360, 186, 588, 196],
  ["f-signed", "agents-section", 1, 16, 128, 688, 290],
  ["f-invoice", "invoice-dup-full", 2, 992, 1068, 346, 352],
  ["f-removed", "invoice-order-top", 2, 360, 372, 586, 110],
  ["split-left", "order-resolution-page", 2, 360, 186, 588, 520],
];
const b = await chromium.launch(); const p = await b.newPage();
for (const [name, src, k, x, y, w, h] of C) {
  const url = `data:image/png;base64,${readFileSync(D + src + ".png").toString("base64")}`;
  const data = await p.evaluate(async ({ url, k, x, y, w, h }) => {
    const img = new Image(); img.src = url; await img.decode();
    const c = document.createElement("canvas"); c.width = Math.round(w * k); c.height = Math.round(h * k);
    c.getContext("2d").drawImage(img, x * k, y * k, w * k, h * k, 0, 0, w * k, h * k);
    return c.toDataURL("image/png").split(",")[1];
  }, { url, k: k === 1 ? 1 : k, x, y, w, h });
  writeFileSync(`public/crops/${name}.png`, Buffer.from(data, "base64"));
  console.log(name, Math.round(w * k), Math.round(h * k));
}
await b.close();
