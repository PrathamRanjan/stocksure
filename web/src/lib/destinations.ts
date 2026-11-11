/**
 * Browser copy of the server's payment-destination finder (src/safety/destinations.ts), for the landing page's
 * try-it box, which never sends the text anywhere. There is no supplier on file here, so every place to pay counts.
 * Keep the patterns in step with the server file.
 */
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const PAYPAL_LINK = /\b(?:https?:\/\/)?(?:www\.)?paypal\.me\/[A-Za-z0-9._-]+/gi;
const IBAN = /\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){2,7}(?:\s?[A-Z0-9]{1,4})?\b/g;
const BANK_CODE = /\b(?:bsb|sort code|routing(?: number)?|aba|swift|bic)\s*(?:no\.?|number|:)?\s*((?:[A-Z0-9]{2,4}[ -]?){1,3}[A-Z0-9]{2,4})\b/gi;
const WALLET = /\b0x[a-fA-F0-9]{6,40}\b|\b(?:bc1|[13])[a-km-zA-HJ-NP-Z1-9]{25,39}\b/g;
const ACCOUNT = /\b(?:acct|account|a\/c|acc)\.?\s*(?:no\.?|number|#|:)?\s*((?:\d[\s-]?){6,20}\d)\b/gi;
const LINK = /\bhttps?:\/\/[^\s<>"')]+|\b(?:bit\.ly|tinyurl\.com|t\.co|goo\.gl|rb\.gy)\/[A-Za-z0-9]+/gi;
const PAY_WORDS = /\b(pay|paid|paying|payment|payments|remit|remittance|transfer|settle|settlement|send (the )?(money|funds|payment)|deposit|paypal|invoice|refund|balance|zelle|venmo|wallet)\b/i;

export interface FoundDestination { kind: string; value: string }

export function paymentDestinations(text: string): FoundDestination[] {
  const t = text.slice(0, 6000);
  const money = PAY_WORDS.test(t);
  const out: FoundDestination[] = [];
  const seen = new Set<string>();
  const add = (kind: string, value: string) => {
    const k = `${kind}:${value.toLowerCase().replace(/\s+/g, "")}`;
    if (!seen.has(k)) (seen.add(k), out.push({ kind, value }));
  };
  for (const m of t.matchAll(PAYPAL_LINK)) add("PayPal link", m[0]);
  if (money) for (const m of t.matchAll(EMAIL)) add("email address", m[0]);
  for (const m of t.matchAll(IBAN)) if (/\d{4}/.test(m[0].replace(/\s/g, "").slice(4))) add("IBAN", m[0]);
  for (const m of t.matchAll(BANK_CODE)) add("bank code", m[1].trim());
  for (const m of t.matchAll(ACCOUNT)) add("account number", m[1].trim());
  for (const m of t.matchAll(WALLET)) add("crypto wallet", m[0]);
  if (money) for (const m of t.matchAll(LINK)) if (!/paypal\.me\//i.test(m[0])) add("link", m[0].replace(/[.,;:]+$/, ""));
  return out;
}
