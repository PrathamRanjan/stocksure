/** Minimal safe HTML templating: every interpolated value is escaped unless wrapped in raw(). */
export class Raw {
  constructor(readonly value: string) {}
  toString() {
    return this.value;
  }
}

export const raw = (s: string) => new Raw(s);

export function esc(v: unknown): string {
  if (v === null || v === undefined || v === false) return "";
  if (v instanceof Raw) return v.value;
  if (Array.isArray(v)) return v.map(esc).join("");
  return String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export function html(strings: TemplateStringsArray, ...values: unknown[]): Raw {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) out += esc(values[i]) + strings[i + 1];
  return new Raw(out);
}

/** JSON for an inline <script type="application/json"> block. */
export function jsonBlock(id: string, data: unknown): Raw {
  return raw(`<script type="application/json" id="${esc(id)}">${JSON.stringify(data).replace(/</g, "\\u003c")}</script>`);
}

export interface LayoutOpts {
  title: string;
  who?: { name: string; org: string; kind: "buyer" | "supplier"; role: string } | null;
  head?: Raw;
  scripts?: Raw;
  flash?: { ok?: string; err?: string };
}

export const AGGRID = raw(`<script src="https://cdn.jsdelivr.net/npm/ag-grid-community@32.3.3/dist/ag-grid-community.min.js" defer></script><link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/ag-grid-community@32.3.3/styles/ag-grid.css"><link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/ag-grid-community@32.3.3/styles/ag-theme-quartz.css">`);

export function layout(o: LayoutOpts, body: Raw): string {
  const nav = o.who
    ? (o.who.kind === "buyer"
        ? [["/home", "Orders"], ...(o.who.role === "owner" ? [["/po/new", "New order"], ["/guard", "Guard"], ["/safety", "Safety"]] : []), ["/stock", "Stock"], ["/dock", "Dock"], ["/ledger", "Ledger"], ["/deliveries", "Deliveries"], ["/negotiations", "Agents"], ["/channels", "Channels"]]
        : [["/home", "Orders"], ["/catalog", "Catalog"], ["/performance", "Performance"], ["/ledger", "Ledger"], ["/deliveries", "Deliveries"], ["/negotiations", "Agents"], ["/disputes", "Disputes"], ["/channels", "Channels"]]
      )
        .concat([["/evidence", "Evidence"], ["/demo", "Demo"]])
        .map(([href, label]) => `<a href="${href}">${esc(label)}</a>`)
        .join("")
    : `<a href="/login">Sign in</a>`;
  const signout = o.who ? `<span class="muted small">${esc(o.who.name)} · ${esc(o.who.org)}</span><form method="post" action="/logout" class="inline"><button class="btn small" type="submit">Sign out</button></form>` : "";
  const flash = o.flash?.ok ? `<div class="banner good" role="status">${esc(o.flash.ok)}</div>` : o.flash?.err ? `<div class="banner bad" role="alert">${esc(o.flash.err)}</div>` : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(o.title)} · StockSure</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='8' fill='%23234e8a'/%3E%3Ctext x='16' y='22' font-size='17' text-anchor='middle' fill='white' font-family='Arial' font-weight='700'%3ES%3C/text%3E%3C/svg%3E">
<link rel="stylesheet" href="/static/app.css">
<link rel="manifest" href="/manifest.webmanifest">
<meta name="theme-color" content="#234e8a">
${o.head ? o.head.value : ""}
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<header class="topbar"><div class="wrap"><a class="brand" href="/"><span class="dot">S</span>StockSure</a><nav class="nav" aria-label="Main">${nav}${signout}</nav></div></header>
<main id="main"><div class="wrap">${flash}${body.value}</div></main>
<footer><div class="wrap">StockSure · PayPal sandbox only: no real money moves. Payments follow agreed quantities and quote prices, never document text.</div></footer>
<link rel="stylesheet" href="/static/a11y.css"><script src="/static/a11y.js" defer></script>
${o.scripts ? o.scripts.value : ""}
</body>
</html>`;
}

export function fmtDate(d: Date | string | null | undefined, withTime = true): string {
  if (!d) return "—";
  const date = new Date(d);
  return (
    date.toLocaleString("en-US", withTime ? { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" } : { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) +
    (withTime ? " UTC" : "")
  );
}

export const STATE_CLASS: Record<string, string> = {
  draft: "muted",
  submitted: "info",
  quoted: "warn",
  funding: "warn",
  funded: "info",
  dispatched: "info",
  in_review: "warn",
  resolving: "warn",
  settling: "info",
  awaiting_replacement: "info",
  closed: "good",
  exception: "bad",
  cancelled: "muted",
  agreed: "good",
  disputed: "bad",
  pending: "warn",
  proposed: "warn",
  superseded: "muted",
  settled: "good",
  succeeded: "good",
  failed: "bad",
  planned: "info",
  confirmed: "good",
  CREATED: "info",
  CAPTURED: "good",
  PARTIALLY_CAPTURED: "warn",
  VOIDED: "muted",
  COMPLETED: "good",
  open: "info",
  walked_away: "warn",
  held: "warn",
  done: "good",
  live: "good",
  "not configured": "muted",
  part_delivered: "info",
  part_settling: "info",
  waiting_for_seller_response: "warn",
  resolved: "good",
  checked_out: "good",
};

export const pill = (state: string) => html`<span class="pill ${STATE_CLASS[state] ?? ""}">${state.replace(/_/g, " ").toLowerCase()}</span>`;
