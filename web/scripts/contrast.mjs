// WCAG 2.2 contrast check for the Docket tokens in src/index.css, light and dark. Exits 1 if any text pair is under 4.5:1
// or any non-text pair (borders of inputs, focus ring) is under 3:1. Run: node scripts/contrast.mjs
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../src/index.css", import.meta.url), "utf8");
const block = (sel) => {
  const m = css.match(new RegExp(`^${sel.replace(".", "\\.")} \\{([\\s\\S]*?)^\\}`, "m"));
  return Object.fromEntries([...(m?.[1] ?? "").matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})/g)].map((x) => [x[1], x[2]]));
};
const light = block(":root");
const dark = { ...light, ...block(".dark") };
const lum = (hex) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
const TEXT = [
  ["foreground", "background"], ["foreground", "card"], ["foreground", "paper-2"], ["muted-foreground", "background"], ["muted-foreground", "card"], ["muted-foreground", "paper-2"],
  ["primary-foreground", "primary"], ["carbon", "card"], ["carbon", "background"], ["carbon", "carbon-soft"],
  ["held", "held-soft"], ["held", "card"], ["paid", "paid-soft"], ["paid", "card"], ["stop", "stop-soft"], ["stop", "card"], ["released", "released-soft"], ["released", "card"],
  ["foreground", "held-soft"], ["foreground", "paid-soft"], ["foreground", "stop-soft"], ["foreground", "carbon-soft"],
];
const NONTEXT = [["input", "card"], ["ring", "background"], ["ring", "card"]];
let fail = 0;
for (const [name, t] of [["light", light], ["dark", dark]]) {
  console.log(`\n${name}`);
  for (const [pairs, min] of [[TEXT, 4.5], [NONTEXT, 3]])
    for (const [f, b] of pairs) {
      if (!t[f] || !t[b]) { console.log(`  ?  ${f} on ${b}: token missing`); fail++; continue; }
      const r = ratio(t[f], t[b]);
      const ok = r >= min;
      if (!ok) fail++;
      console.log(`  ${ok ? "ok" : "XX"} ${r.toFixed(2).padStart(5)}:1  ${f} on ${b} (needs ${min})`);
    }
}
console.log(fail ? `\n${fail} pair(s) below WCAG AA` : "\nAll pairs meet WCAG AA");
process.exit(fail ? 1 : 0);
