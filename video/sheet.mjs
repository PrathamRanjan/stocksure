// node sheet.mjs out.jpg a.jpg b.jpg ... -> 2-column contact sheet
import { chromium } from "/Users/prathamranjan/Documents/Codex/2026-11-02/w/stocksure/web/node_modules/playwright/index.mjs";
import { readFileSync } from "node:fs";
const [out, ...imgs] = process.argv.slice(2);
const html = `<body style="margin:0;background:#333;display:grid;grid-template-columns:1fr 1fr;gap:6px;width:1926px">${imgs.map((i) => `<div style="position:relative"><img style="width:960px;display:block" src="data:image/jpeg;base64,${readFileSync(i).toString("base64")}"><span style="position:absolute;left:8px;top:6px;background:#000c;color:#fff;font:600 18px monospace;padding:2px 6px">${i.split("-").pop()}</span></div>`).join("")}</body>`;
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1926, height: 400 } });
await p.setContent(html); await p.screenshot({ path: out, fullPage: true, type: "jpeg", quality: 70 }); await b.close();
