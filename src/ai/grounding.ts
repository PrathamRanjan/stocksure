/**
 * Grounding and quarantine helpers (roadmap B.1). A model may only report a value it can point at in the
 * source; anything it cannot quote is dropped and flagged. Instruction-shaped text found inside a document
 * is quarantined: shown to people, never forwarded to any tool.
 */
export interface Grounded<T> {
  value: T | null;
  /** The exact source span the model quoted, when the value survived. */
  quote: string | null;
  grounded: boolean;
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").replace(/[“”"']/g, "").trim();

/** Keeps `value` only when `quote` (the model's own citation) appears in the source text. */
export function ground<T>(value: T | null, quote: string | null | undefined, sourceText: string): Grounded<T> {
  if (value === null || value === undefined) return { value: null, quote: null, grounded: false };
  if (!quote || !quote.trim()) return { value: null, quote: null, grounded: false };
  const ok = norm(sourceText).includes(norm(quote));
  return ok ? { value, quote, grounded: true } : { value: null, quote, grounded: false };
}

/** Numbers tolerate formatting differences: "12,50" and "12.50" and "$12.50" all ground to 12.5. */
export function groundNumber(value: number | null, quote: string | null | undefined, sourceText: string): Grounded<number> {
  const g = ground(value, quote, sourceText);
  if (g.grounded) return g;
  if (value === null || value === undefined) return g;
  const nums = (sourceText.match(/\d+(?:[.,]\d{1,3})?/g) ?? []).map((n) => Number(n.replace(",", ".")));
  const hit = nums.some((n) => Math.abs(n - value) < 0.005);
  return hit ? { value, quote: quote ?? String(value), grounded: true } : { value: null, quote: quote ?? null, grounded: false };
}

const INSTRUCTION_PATTERNS = [
  /\b(ignore|disregard|forget)\b.{0,40}\b(instructions?|rules?|above|previous)\b/i,
  /\b(approve|accept|pay|release|refund|capture|transfer|send)\b.{0,40}\b(full|all|immediately|now|without|regardless)\b/i,
  /\b(you are|act as|pretend|system prompt|assistant|as an ai|language model)\b/i,
  /\b(mark|set|treat|consider)\b.{0,30}\b(as (verified|accepted|delivered|approved|complete))\b/i,
  /\b(substitution|change|price) (approved|agreed|confirmed) by (buyer|customer|brand|owner)\b/i,
];

/** Lines of a document that read as instructions to a reader or a machine rather than as data. */
export function quarantine(text: string): { clean: string; quarantined: string[] } {
  const quarantined: string[] = [];
  const kept: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (INSTRUCTION_PATTERNS.some((re) => re.test(line))) quarantined.push(line.trim());
    else kept.push(line);
  }
  return { clean: kept.join("\n"), quarantined };
}
