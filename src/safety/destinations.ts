/**
 * Spec A6.1, reader 3: code. Finds every payment destination a message names (email addresses, PayPal handles and
 * links, bank account numbers, IBANs, sort codes and BSBs, other links) and compares it with the record.
 *
 * StockSure never pays to a destination written in a message: every PayPal call settles to the merchant account
 * PayPal already knows for the order. So a destination in a supplier message that is not the supplier's contact on
 * file is a hold on its own, and so is a free-mail address for a supplier on file under its own domain.
 *
 * Pure functions; no I/O. The same patterns run in the browser for the landing page's "try it" box
 * (web/src/lib/destinations.ts is a hand copy).
 */
import type { Level } from "./rules.js";

export type DestinationKind = "email" | "paypal" | "account_number" | "iban" | "bank_code" | "wallet" | "link";

export interface Destination {
  kind: DestinationKind;
  value: string;
  /** True when it matches the supplier's contact on file. */
  on_file: boolean;
  why: string;
}

export interface DestinationCheck {
  level: Level;
  destinations: Destination[];
  reasons: string[];
  /** True when the message names anywhere money could be sent (the never-green rule uses it). */
  names_destination: boolean;
}

export const FREE_MAIL = new Set(["gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "msn.com", "yahoo.com", "ymail.com", "icloud.com", "me.com", "aol.com", "proton.me", "protonmail.com", "gmx.com", "gmx.net", "mail.com", "yandex.com", "zoho.com", "qq.com", "163.com"]);

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const PAYPAL_LINK = /\b(?:https?:\/\/)?(?:www\.)?paypal\.me\/[A-Za-z0-9._-]+/gi;
const PAYPAL_HANDLE = /(?:^|\s)@([A-Za-z0-9_]{3,30})\b(?=[^@]{0,40}\bpaypal\b|\s+on\s+paypal)/gi;
const IBAN = /\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){2,7}(?:\s?[A-Z0-9]{1,4})?\b/g;
const BANK_CODE = /\b(?:bsb|sort code|routing(?: number)?|aba|swift|bic)\s*(?:no\.?|number|:)?\s*((?:[A-Z0-9]{2,4}[ -]?){1,3}[A-Z0-9]{2,4})\b/gi;
const WALLET = /\b0x[a-fA-F0-9]{6,40}\b|\b(?:bc1|[13])[a-km-zA-HJ-NP-Z1-9]{25,39}\b/g;
// Account numbers: 6 or more digits, optionally grouped by spaces or dashes, after a word that says what it is.
const ACCOUNT = /\b(?:acct|account|a\/c|acc)\.?\s*(?:no\.?|number|#|:)?\s*((?:\d[\s-]?){6,20}\d)\b/gi;
const LINK = /\bhttps?:\/\/[^\s<>"')]+|\b(?:bit\.ly|tinyurl\.com|t\.co|goo\.gl|rb\.gy)\/[A-Za-z0-9]+/gi;

const domainOf = (email: string) => email.split("@")[1]?.toLowerCase() ?? "";
/** Words that make an email address or link a place to send money rather than a contact. */
const PAY_WORDS = /\b(pay|paid|paying|payment|payments|remit|remittance|transfer|settle|settlement|send (the )?(money|funds|payment)|deposit|paypal|invoice|refund|balance|zelle|venmo|wallet)\b/i;

export function findDestinations(text: string, onFile: { contactEmail?: string | null } = {}): DestinationCheck {
  const t = (text ?? "").slice(0, 6000);
  const file = (onFile.contactEmail ?? "").toLowerCase().trim();
  const fileDomain = file ? domainOf(file) : "";
  const out: Destination[] = [];
  const seen = new Set<string>();
  const add = (d: Omit<Destination, "on_file"> & { on_file?: boolean }) => {
    const key = `${d.kind}:${d.value.toLowerCase().replace(/\s+/g, "")}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ on_file: false, ...d });
  };
  for (const m of t.matchAll(PAYPAL_LINK)) add({ kind: "paypal", value: m[0], why: "a PayPal.me link" });
  for (const m of t.matchAll(PAYPAL_HANDLE)) add({ kind: "paypal", value: `@${m[1]}`, why: "a PayPal handle" });
  for (const m of t.matchAll(EMAIL)) {
    const e = m[0].toLowerCase();
    const d = domainOf(e);
    if (file && e === file) add({ kind: "email", value: e, on_file: true, why: "the supplier's contact on file" });
    else if (fileDomain && FREE_MAIL.has(d) && !FREE_MAIL.has(fileDomain)) add({ kind: "email", value: e, why: `a free-mail address; this supplier is on file at ${fileDomain}` });
    else if (fileDomain && d === fileDomain) add({ kind: "email", value: e, why: `an address at ${fileDomain} that is not the contact on file` });
    else add({ kind: "email", value: e, why: file ? `not the supplier's contact on file (${file})` : "no contact is on file for this supplier" });
  }
  for (const m of t.matchAll(IBAN)) if (/\d{4}/.test(m[0].replace(/\s/g, "").slice(4))) add({ kind: "iban", value: m[0], why: "an IBAN" });
  for (const m of t.matchAll(BANK_CODE)) add({ kind: "bank_code", value: m[1].trim(), why: "a bank code (BSB, sort code, routing or SWIFT)" });
  for (const m of t.matchAll(ACCOUNT)) add({ kind: "account_number", value: m[1].trim(), why: "a bank account number" });
  for (const m of t.matchAll(WALLET)) add({ kind: "wallet", value: m[0], why: "a crypto wallet address" });
  for (const m of t.matchAll(LINK)) if (!/paypal\.me\//i.test(m[0])) add({ kind: "link", value: m[0].replace(/[.,;:]+$/, ""), why: "a link" });

  // An email or link is a payment destination only when the message talks about money; otherwise it is a contact.
  const aboutMoney = PAY_WORDS.test(t);
  for (const d of out) if ((d.kind === "email" || d.kind === "link") && !aboutMoney && !d.on_file) d.why = `${d.why} (a contact, not a place to pay)`;
  const isDest = (d: Destination) => !d.on_file && (d.kind === "paypal" || d.kind === "account_number" || d.kind === "iban" || d.kind === "bank_code" || d.kind === "wallet" || ((d.kind === "email" || d.kind === "link") && aboutMoney));
  const off = out.filter((d) => !d.on_file && (isDest(d) || d.kind === "link"));
  // A link to pay at is a destination (amber); a shortened one hides where it goes, so it holds.
  const SHORT = /\b(bit\.ly|tinyurl\.com|t\.co|goo\.gl|rb\.gy)\//i;
  const money = off.filter((d) => isDest(d) && (d.kind !== "link" || SHORT.test(d.value)));
  const payLinks = off.filter((d) => isDest(d) && d.kind === "link" && !SHORT.test(d.value));
  const reasons: string[] = [];
  for (const d of off) reasons.push(`It names ${d.why}: ${d.value}.`);
  // A destination for money that is not on file holds on its own, except another mailbox at the supplier's own
  // domain, which is a caution; a link is a caution.
  const sameDomainOnly = money.length > 0 && money.every((d) => d.kind === "email" && fileDomain && domainOf(d.value) === fileDomain);
  const level: Level = money.length && !sameDomainOnly ? "hold" : off.length ? "caution" : "clear";
  return { level, destinations: out, reasons, names_destination: money.length + payLinks.length > 0 };
}
