import { renderShell, type Brand, type NavGroup } from "./shell.js";
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
  /** Public landing page: full-width sections. */
  site?: boolean;
}

export const AGGRID = raw(`<script src="https://cdn.jsdelivr.net/npm/ag-grid-community@32.3.3/dist/ag-grid-community.min.js" defer></script><link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/ag-grid-community@32.3.3/styles/ag-grid.css"><link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/ag-grid-community@32.3.3/styles/ag-theme-quartz.css">`);

export const BRAND: Brand = {
  name: "StockSure",
  // The tally mark: three strokes and a slash, one mark per pack.
  mark: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M5 5v14M9.5 5v14M14 5v14M18.5 19 21 5"/></svg>`,
  description: "StockSure: when a delivery arrives short, damaged or mis-billed, both sides agree what arrived and PayPal charges exactly that.",
  themeColor: "#1B1A16",
  fonts: "family=Archivo:wdth,wght@62..125,400..900&family=Source+Sans+3:wght@400;600;700",
  appFoot: "PayPal sandbox: no real money moves. StockSure pays for agreed quantities at quoted prices, never for what a document claims.",
  siteLinks: [["/#how", "How it works"], ["/#pricing", "Pricing"], ["/demo", "Demo"], ["/evidence", "Evidence"]],
  cta: ["/login", "Sign in"],
  siteFoot: "StockSure · built for the PayPal hackathon · PayPal sandbox only, no real money moves.",
  siteFootLinks: [["/login", "Sign in"], ["/evidence", "Evidence"], ["/llms.txt", "llms.txt"]],
  staticBase: "/static",
  legacyCss: ["app.css"],
};

/** Same pages, labels and order as the app's sidebar (web/src/components/shell.tsx navFor). */
function navFor(w: NonNullable<LayoutOpts["who"]>): NavGroup[] {
  const owner = w.role === "owner";
  if (w.kind === "supplier")
    return [
      { label: "Main", items: [["/home", "Orders", "home"], ["/catalog", "Catalog", "package"], ["/performance", "Performance", "chart"], ["/deliveries", "Deliveries", "calendar"]] },
      { label: "Controls and records", items: [["/disputes", "PayPal disputes", "alert"], ["/negotiations", "Negotiations", "bot"], ["/ledger", "Ledger", "receipt"], ["/channels", "Phone alerts", "message"], ["/evidence", "Evidence", "file"]] },
    ];
  if (!owner)
    return [
      { label: "Main", items: [["/home", "Deliveries", "home"], ["/dock", "Dock (camera)", "truck"], ["/stock", "Stock", "box"], ["/catalog", "Catalog", "package"]] },
      { label: "Controls and records", items: [["/channels", "Phone alerts", "message"], ["/evidence", "Evidence", "file"]] },
    ];
  return [
    { label: "Main", items: [["/home", "Orders", "home"], ["/approvals", "Approvals", "checkCircle"], ["/stock", "Stock", "box"], ["/performance", "Record", "chart"]] },
    {
      label: "Controls and records",
      items: [["/guard", "Spending rules", "gauge"], ["/safety", "Scam check", "shieldCheck"], ["/catalog", "Catalog", "package"], ["/ledger", "Ledger", "receipt"], ["/deliveries", "Deliveries board", "calendar"], ["/negotiations", "Agent negotiations", "bot"], ["/channels", "Phone alerts", "message"], ["/evidence", "Evidence", "file"]],
    },
  ];
}

const ROLE: Record<string, string> = { owner: "Owner", receiving: "Receiving", supplier: "Supplier" };

export function layout(o: LayoutOpts, body: Raw): string {
  const common = { title: o.title, body: body.value, flash: o.flash, head: `<link rel="manifest" href="/manifest.webmanifest">${o.head?.value ?? ""}`, scripts: o.scripts?.value };
  if (o.who) return renderShell(BRAND, { ...common, mode: "app", nav: navFor(o.who), homeHref: "/home", workspace: o.who.org, user: { name: o.who.name, sub: `${ROLE[o.who.role] ?? o.who.role} · ${o.who.org}`, logout: "/logout", settings: "/channels#phone" } });
  return renderShell(BRAND, { ...common, mode: o.site ? "site" : "plain" });
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
