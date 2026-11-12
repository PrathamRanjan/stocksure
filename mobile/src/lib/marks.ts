import type { FundingNums, TallyNums } from "./types";

export type MarkKind = "accepted" | "damaged" | "wrong" | "short" | "ordered";
const fmtN = (n: number | null) => (n === null ? "—" : Number.isInteger(n) ? String(n) : n.toFixed(1));

/** One mark per pack: ordered marks until counted, then accepted, damaged, wrong and short. */
export function tallyMarks(t: TallyNums): MarkKind[] {
  const r = (n: number | null) => Math.max(0, Math.round(n ?? 0));
  const marks: MarkKind[] = [];
  if (t.accepted === null) for (let i = 0; i < t.ordered; i++) marks.push("ordered");
  else {
    for (let i = 0; i < r(t.accepted); i++) marks.push("accepted");
    for (let i = 0; i < r(t.damaged); i++) marks.push("damaged");
    for (let i = 0; i < r(t.wrong); i++) marks.push("wrong");
    for (let i = 0; i < r(t.short); i++) marks.push("short");
  }
  return marks;
}

export function tallyText(t: TallyNums) {
  if (t.accepted === null) return `${t.ordered} ordered, not counted yet`;
  return [`${fmtN(t.accepted)} accepted`, t.damaged ? `${fmtN(t.damaged)} damaged` : "", t.wrong ? `${fmtN(t.wrong)} wrong` : "", t.short ? `${fmtN(t.short)} short` : "", `of ${t.ordered} ordered`].filter(Boolean).join(", ");
}

/** Split of the spend limit for the bar widths, from the server's numbers only. */
export function settlementParts(f: FundingNums) {
  const lim = Math.max(1, f.limit_cents);
  const captured = Math.max(0, f.captured_cents - (f.refunded_cents ?? 0));
  const held = f.held_cents + (f.inflight_cents ?? 0);
  const expected = (f.expected ?? []).reduce((a, x) => a + x.cents, 0);
  const heldOnly = Math.max(0, held - expected);
  const frac = (c: number) => Math.min(1, c / lim);
  return { lim, captured, heldOnly, expected, frac };
}
