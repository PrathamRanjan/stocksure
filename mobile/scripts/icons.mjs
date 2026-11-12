// Render the app icon set from the StockSure tally mark (same geometry as src/components/logo.tsx).
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(fileURLToPath(new URL("../../web/package.json", import.meta.url)));
const { chromium } = require("playwright");
const out = (n) => fileURLToPath(new URL(`../assets/${n}`, import.meta.url));
const INK = "#1B1A16";
const PAPER = "#F4EFE4";

// Marks only, on a 32-unit grid; `pad` shrinks them into the platform's safe zone.
const marks = (fg, pad) => {
  const s = (32 - pad * 2) / 32;
  const g = `<g transform="translate(${pad} ${pad}) scale(${s})">${[9, 14, 19, 24].map((x) => `<rect x="${x - 1.5}" y="8" width="3" height="16" rx="1.5" fill="${fg}"/>`).join("")}<line x1="6" y1="21" x2="27" y2="11" stroke="${fg}" stroke-width="2.6" stroke-linecap="round"/></g>`;
  return g;
};
const svg = (size, body, bg) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 32 32">${bg ? `<rect width="32" height="32" fill="${bg}"/>` : ""}${body}</svg>`;

const set = [
  ["icon.png", 1024, svg(1024, marks(PAPER, 4), INK)],
  ["android-icon-foreground.png", 1024, svg(1024, marks(PAPER, 8))],
  ["android-icon-background.png", 1024, svg(1024, "", INK)],
  ["android-icon-monochrome.png", 1024, svg(1024, marks("#000000", 8))],
  ["splash-icon.png", 512, svg(512, `<rect width="32" height="32" rx="7" fill="${INK}"/>${marks(PAPER, 0)}`)],
  ["favicon.png", 96, svg(96, `<rect width="32" height="32" rx="7" fill="${INK}"/>${marks(PAPER, 0)}`)],
];

const browser = await chromium.launch();
const page = await browser.newPage();
for (const [name, size, s] of set) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${s}</body></html>`);
  await page.locator("svg").screenshot({ path: out(name), omitBackground: true });
  console.log("wrote", name);
}
await browser.close();
