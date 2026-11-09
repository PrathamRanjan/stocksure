/** Integer-cent arithmetic. Nothing here uses floating point on money. */

/** round_half_up(units x packPriceCents / packUnits), plus the signed remainder in (cents x packUnits) so it can be audited. */
export function lineCents(units: number, packUnits: number, packPriceCents: number): { cents: number; remainder: number } {
  if (!Number.isInteger(units) || !Number.isInteger(packUnits) || !Number.isInteger(packPriceCents)) throw new Error("lineCents takes integers");
  if (units < 0 || packUnits <= 0 || packPriceCents < 0) throw new Error("lineCents takes non-negative values");
  const num = units * packPriceCents;
  const cents = Math.floor((2 * num + packUnits) / (2 * packUnits));
  return { cents, remainder: num - cents * packUnits };
}

export const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

export const fmt = (cents: number | null | undefined) => (cents === null || cents === undefined ? "—" : `${cents < 0 ? "−" : ""}$${(Math.abs(cents) / 100).toFixed(2)}`);

/** Parses "$12.50", "12.5", "1,204.00" to cents; null when unreadable. Exact: no float multiply. */
export function parseCents(text: string | null | undefined): number | null {
  if (text === null || text === undefined) return null;
  const m = String(text).replace(/[,\s]/g, "").match(/^-?\$?(\d+)(?:\.(\d{1,2}))?$/);
  if (!m) return null;
  const cents = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
  return String(text).trim().startsWith("-") ? -cents : cents;
}
