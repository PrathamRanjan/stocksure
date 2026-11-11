/**
 * Demo samples for the door photo (spec B4 item 4). These are generated drawings, not camera photos, and every
 * place that offers them says so. One shows the order's cases with some crushed; one shows a delivery note on a
 * laptop screen (for the photo-of-a-screen check). Drawn as SVG and rendered to JPEG with sharp.
 */
import sharp from "sharp";

export interface PhotoLine { sku: string; name: string; cases: number }

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

function caseBox(x: number, y: number, w: number, h: number, sku: string, name: string, crushed: boolean, seed: number): string {
  const label = `<rect x="${x + w * 0.12}" y="${y + h * 0.3}" width="${w * 0.76}" height="${h * 0.34}" fill="#f7f3e8" stroke="#6b5a3a" stroke-width="1.5"/>
    <text x="${x + w / 2}" y="${y + h * 0.44}" font-family="Helvetica, Arial, sans-serif" font-size="${Math.round(w * 0.12)}" font-weight="700" text-anchor="middle" fill="#1d1d1d">${esc(sku)}</text>
    <text x="${x + w / 2}" y="${y + h * 0.57}" font-family="Helvetica, Arial, sans-serif" font-size="${Math.round(w * 0.075)}" text-anchor="middle" fill="#333">${esc(name.slice(0, 22))}</text>`;
  if (!crushed) {
    return `<g><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="3" fill="#c79a5b" stroke="#7a5527" stroke-width="2.5"/>
      <line x1="${x}" y1="${y + h * 0.12}" x2="${x + w}" y2="${y + h * 0.12}" stroke="#a87a3d" stroke-width="3"/>
      <rect x="${x + w * 0.45}" y="${y}" width="${w * 0.1}" height="${h}" fill="#d9b57c" opacity="0.8"/>${label}</g>`;
  }
  // Crushed: the top caved in, a torn flap, a wet stain, the corner pushed in.
  const j = (n: number) => ((seed * 37 + n * 17) % 9) - 4;
  return `<g><path d="M${x} ${y + h * 0.18} L${x + w * 0.3} ${y + h * 0.34 + j(1)} L${x + w * 0.55} ${y + h * 0.12} L${x + w * 0.78} ${y + h * 0.4 + j(2)} L${x + w} ${y + h * 0.22} L${x + w - 6} ${y + h} L${x + 8} ${y + h} Z" fill="#b8874a" stroke="#5e3f19" stroke-width="3"/>
    <path d="M${x + w * 0.3} ${y + h * 0.34} L${x + w * 0.42} ${y + h * 0.62} L${x + w * 0.55} ${y + h * 0.12}" fill="none" stroke="#4a3010" stroke-width="2.5"/>
    <path d="M${x + w * 0.62} ${y + h * 0.3} L${x + w * 0.9} ${y + h * 0.05} L${x + w * 0.85} ${y + h * 0.32} Z" fill="#d8b27a" stroke="#5e3f19" stroke-width="2"/>
    <ellipse cx="${x + w * 0.35}" cy="${y + h * 0.82}" rx="${w * 0.26}" ry="${h * 0.12}" fill="#6b4a22" opacity="0.55"/>
    <g transform="rotate(${-7 + j(3)} ${x + w / 2} ${y + h / 2})">${label}</g>
    <path d="M${x + w * 0.1} ${y + h * 0.95} q ${w * 0.05} ${h * 0.08} ${w * 0.12} 0 q ${w * 0.04} ${h * 0.06} ${w * 0.1} 0" fill="none" stroke="#e9f1f7" stroke-width="3" opacity="0.8"/></g>`;
}

/** The order's cases stacked by the back door, `crushed` of the first line's cases damaged. */
export async function doorPhoto(lines: PhotoLine[], crushed: number): Promise<Buffer> {
  const W = 1200;
  const cw = 150;
  const ch = 120;
  const gap = 14;
  const perRow = 6;
  const rows: { line: PhotoLine; i: number }[] = [];
  for (const l of lines) for (let i = 0; i < l.cases; i++) rows.push({ line: l, i });
  const nRows = Math.ceil(rows.length / perRow) + lines.length;
  const H = Math.max(520, 220 + nRows * (ch + gap) + 80);
  let y = 150;
  let body = "";
  let first = true;
  let seed = 1;
  for (const l of lines) {
    for (let i = 0; i < l.cases; i += perRow) {
      const n = Math.min(perRow, l.cases - i);
      const x0 = (W - (n * cw + (n - 1) * gap)) / 2;
      for (let k = 0; k < n; k++) body += caseBox(x0 + k * (cw + gap), y, cw, ch, l.sku, l.name, first && i + k < crushed, seed++);
      y += ch + gap;
    }
    first = false;
    y += gap * 2;
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    <defs><linearGradient id="wall" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9aa3a8"/><stop offset="1" stop-color="#7d868b"/></linearGradient>
    <linearGradient id="floor" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6f6a62"/><stop offset="1" stop-color="#4f4b45"/></linearGradient></defs>
    <rect width="${W}" height="${H}" fill="url(#floor)"/>
    <rect width="${W}" height="120" fill="url(#wall)"/>
    <rect x="80" y="0" width="300" height="118" fill="#5b6a73" stroke="#3b454b" stroke-width="4"/>
    <text x="230" y="70" font-family="Helvetica, Arial, sans-serif" font-size="26" text-anchor="middle" fill="#e8eef1">DELIVERIES</text>
    ${body}
    <rect x="0" y="${H - 44}" width="${W}" height="44" fill="#000" opacity="0.55"/>
    <text x="16" y="${H - 15}" font-family="Helvetica, Arial, sans-serif" font-size="20" fill="#fff">Generated sample photo for the StockSure demo (a drawing, not a camera photo)</text>
  </svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 86 }).toBuffer();
}

/** A delivery note shown on a laptop screen, photographed: bezel, glare and a moiré pattern. */
export async function screenPhoto(noteText: string): Promise<Buffer> {
  const W = 1200;
  const H = 900;
  const lines = noteText.split("\n").slice(0, 16);
  const text = lines.map((l, i) => `<text x="250" y="${230 + i * 30}" font-family="Menlo, Courier, monospace" font-size="20" fill="#1a1a1a">${esc(l.slice(0, 60))}</text>`).join("");
  const moire = Array.from({ length: 120 }, (_, i) => `<line x1="${200 + i * 7}" y1="150" x2="${180 + i * 7.3}" y2="690" stroke="#6a7cff" stroke-width="1" opacity="0.07"/>`).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    <defs><linearGradient id="glare" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0.35"/><stop offset="0.4" stop-color="#fff" stop-opacity="0"/></linearGradient></defs>
    <rect width="${W}" height="${H}" fill="#3a3530"/>
    <rect x="150" y="110" width="900" height="620" rx="22" fill="#111"/>
    <rect x="190" y="150" width="820" height="540" fill="#f4f6fb"/>
    <rect x="190" y="150" width="820" height="40" fill="#dfe4ee"/>
    <circle cx="215" cy="170" r="7" fill="#ff5f57"/><circle cx="238" cy="170" r="7" fill="#febc2e"/><circle cx="261" cy="170" r="7" fill="#28c840"/>
    <text x="600" y="176" font-family="Helvetica, Arial, sans-serif" font-size="16" text-anchor="middle" fill="#555">delivery-note.txt</text>
    ${text}${moire}
    <rect x="190" y="150" width="820" height="540" fill="url(#glare)"/>
    <circle cx="600" cy="130" r="5" fill="#333"/>
    <path d="M90 730 L1110 730 L1170 800 L30 800 Z" fill="#9a9ea3"/>
    <rect x="0" y="${H - 44}" width="${W}" height="44" fill="#000" opacity="0.55"/>
    <text x="16" y="${H - 15}" font-family="Helvetica, Arial, sans-serif" font-size="20" fill="#fff">Generated sample photo for the StockSure demo (a drawing, not a camera photo)</text>
  </svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 86 }).toBuffer();
}
