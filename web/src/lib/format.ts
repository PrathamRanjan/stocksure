/** Money is integer cents everywhere; this only formats it. */
export const money = (c: number | null | undefined) => (c === null || c === undefined ? "—" : `${c < 0 ? "−" : ""}$${(Math.abs(c) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

// Spec B5: dates in the chosen language's format (the language layer sets window.ssI18n.locale).
const fmts = new Map<string, Intl.DateTimeFormat>();
const fmt = (k: string, o: Intl.DateTimeFormatOptions) => {
  const loc = (typeof window !== "undefined" && (window as any).ssI18n?.lang !== "en" ? (window as any).ssI18n?.locale : undefined) as string | undefined;
  const key = `${k}:${loc ?? ""}`;
  let f = fmts.get(key);
  if (!f) fmts.set(key, (f = new Intl.DateTimeFormat(loc, o)));
  return f;
};
const dtf = { format: (d: Date) => fmt("dt", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(d) };
const df = { format: (d: Date) => fmt("d", { weekday: "short", day: "numeric", month: "short" }).format(d) };
const tf = { format: (d: Date) => fmt("t", { hour: "numeric", minute: "2-digit" }).format(d) };

/** Dates shown in the viewer's own time zone, with the zone named once on screens that need it. */
export const when = (d: string | Date | null | undefined) => (d ? dtf.format(new Date(d)) : "—");
export const day = (d: string | Date | null | undefined) => (d ? df.format(new Date(d)) : "—");
export const time = (d: string | Date | null | undefined) => (d ? tf.format(new Date(d)) : "—");
export const zone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

export function ago(d: string | Date | null | undefined) {
  if (!d) return "";
  const s = Math.round((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 0) {
    const f = -s;
    if (f < 3600) return `in ${Math.max(1, Math.round(f / 60))} min`;
    if (f < 86400 * 2) return `in ${Math.round(f / 3600)} h`;
    return `in ${Math.round(f / 86400)} days`;
  }
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} days ago`;
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
export const titleCase = (s: string) => s.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

/** Plain-words labels for order states. */
export const STATUS: Record<string, { label: string; tone: "held" | "paid" | "stop" | "released" | "carbon" | "ink" | "quiet" }> = {
  draft: { label: "Draft", tone: "quiet" },
  submitted: { label: "Awaiting quote", tone: "quiet" },
  quoted: { label: "Quoted", tone: "carbon" },
  funding: { label: "Placing hold", tone: "held" },
  funded: { label: "Held", tone: "held" },
  dispatched: { label: "On the truck", tone: "carbon" },
  in_review: { label: "Checking counts", tone: "carbon" },
  resolving: { label: "Agreeing the fix", tone: "carbon" },
  settling: { label: "Paying", tone: "held" },
  part_settling: { label: "Paying part 1", tone: "held" },
  part_delivered: { label: "Part 1 paid", tone: "paid" },
  awaiting_replacement: { label: "Replacement due", tone: "carbon" },
  closed: { label: "Closed", tone: "paid" },
  exception: { label: "Needs a look", tone: "stop" },
  cancelled: { label: "Cancelled", tone: "released" },
};

/** PayPal object states as stamps. */
export const PP: Record<string, { label: string; tone: "held" | "paid" | "stop" | "released" | "carbon" | "quiet" }> = {
  CREATED: { label: "Held", tone: "held" },
  PENDING: { label: "Pending", tone: "held" },
  PARTIALLY_CAPTURED: { label: "Part captured", tone: "held" },
  CAPTURED: { label: "Captured", tone: "paid" },
  COMPLETED: { label: "Completed", tone: "paid" },
  VOIDED: { label: "Released", tone: "released" },
  EXPIRED: { label: "Expired", tone: "released" },
  DENIED: { label: "Denied", tone: "stop" },
  DECLINED: { label: "Declined", tone: "stop" },
  FAILED: { label: "Failed", tone: "stop" },
  REFUNDED: { label: "Refunded", tone: "carbon" },
  PARTIALLY_REFUNDED: { label: "Part refunded", tone: "carbon" },
};
