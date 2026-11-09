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
  mark: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 9.5 12 4l9 5.5V20H3z"/><path d="M7 20v-6h10v6"/><path d="M9.5 17h5"/></svg>`,
  description: "StockSure: when a delivery arrives short, damaged or mis-billed, it agrees what arrived, charges only that on PayPal and gets replacements moving.",
  themeColor: "#1f2328",
  fonts: "family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600",
  appFoot: "PayPal sandbox: no real money moves. StockSure pays for agreed quantities at quoted prices, never for what a document claims.",
  siteLinks: [["/#how", "How it works"], ["/#safety", "Safety"], ["/#try", "Try it"], ["/demo", "Demo setup"]],
  cta: ["/#try", "Try the demo"],
  siteFoot: "StockSure · built for the PayPal AI Hackathon · PayPal sandbox only, no real money moves.",
  siteFootLinks: [["/login", "Sign in"], ["/evidence", "Evidence"], ["/llms.txt", "llms.txt"]],
  staticBase: "/static",
  legacyCss: ["app.css"],
};

function navFor(w: NonNullable<LayoutOpts["who"]>): NavGroup[] {
  const owner = w.role === "owner";
  if (w.kind === "supplier")
    return [
      { label: "Orders", items: [["/home", "Orders", "home"], ["/catalog", "Catalog", "package"], ["/deliveries", "Deliveries", "truck"], ["/disputes", "Disputes", "alert"]] },
      { label: "Money", items: [["/ledger", "Ledger", "receipt"], ["/performance", "Performance", "chart"]] },
      { label: "How it works", items: [["/negotiations", "Agent deals", "bot"], ["/channels", "Messages", "message"], ["/evidence", "Evidence", "file"], ["/demo", "Demo setup", "gauge"]] },
    ];
  return [
    { label: "Orders", items: [["/home", "Orders", "home"], ...(owner ? ([["/po/new", "New order", "cart"]] as [string, string, string][]) : []), ["/dock", "Receiving dock", "truck"], ["/stock", "Stock", "box"], ["/deliveries", "Deliveries", "package"]] },
    { label: "Money", items: [["/ledger", "Ledger", "receipt"], ...(owner ? ([["/guard", "Approvals", "shieldCheck"]] as [string, string, string][]) : [])] },
    { label: "Settings", items: [...(owner ? ([["/safety", "Scam protection", "shield"]] as [string, string, string][]) : []), ["/channels", "Messages", "message"]] },
    { label: "How it works", items: [["/negotiations", "Agent deals", "bot"], ["/evidence", "Evidence", "file"], ["/demo", "Demo setup", "gauge"]] },
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
