/**
 * Safety layer A: deterministic rules (SAFETY_ACCESSIBILITY_SPEC §4.1). Pure functions, no I/O, no PayPal.
 * Every result is a level plus plain-word reasons; nothing here can approve a payment, it can only raise the level
 * the money gate then enforces. The tactic regexes are the same weak-label seeds the text model was trained with
 * (guard-lab/scripts/prepare.py), so the server and the browser model name tactics the same way.
 */
export type Level = "clear" | "caution" | "hold";
export const TACTICS = ["impersonation", "urgency_secrecy", "changed_details", "off_platform", "gift_cards_crypto", "fee_to_release", "otp_or_link", "overpay_refund", "too_good"] as const;
export type Tactic = (typeof TACTICS)[number];

const SEEDS: Record<Tactic, RegExp> = {
  changed_details: /\b(new|updated?|changed?)\b.{0,40}\b(bank|account|acct|iban|beneficiary|payout|payment details|paypal (email|address|account)|upi id)\b|\b(bank|account) (details|number) (has|have) changed/i,
  off_platform: /\b(whatsapp|telegram|signal|outside (of )?(paypal|the app|platform)|pay (me )?directly|bank transfer instead|cash ?app|zelle|western union|moneygram)\b/i,
  gift_cards_crypto: /\b(gift ?cards?|itunes|google play card|steam card|bitcoin|btc|usdt|crypto|wallet address)\b/i,
  fee_to_release: /\b(processing|release|clearance|delivery|customs|handling|admin|unlock|activation) fee\b|pay .{0,20}\bto (release|claim|unlock|receive)\b/i,
  otp_or_link: /\b(otp|one[- ]time (code|password)|verification code|passcode|pin)\b|https?:\/\/|\bclick (here|the link|below)\b|\bbit\.ly\b|\btinyurl\b/i,
  overpay_refund: /\b(over ?pa(id|yment)|sent (you )?too much|refund (the|me the) (difference|extra|excess)|paid extra by mistake)\b/i,
  too_good: /\b(congratulations|you (have )?won|winner|lottery|prize|jackpot|guaranteed (returns?|profit)|double your|free (money|gift|iphone)|100% (profit|return))\b/i,
  impersonation: /\b(officer|police|cbi|irs|hmrc|iras|cpf|dbs|ocbc|uob|paypal (security|team|support)|customs|court|arrest warrant|your (bank|account) (team|officer)|microsoft support|amazon security|from (the )?(government|ministry)|(ceo|director|managing director|finance (head|director)) (here|asked|needs))\b/i,
  urgency_secrecy: /\b(urgent(ly)?|immediately|within (24|12|48) hours|today only|final (notice|warning)|act now|last chance|do not (tell|share|inform)|keep (this|it) (confidential|secret|between us)|expires? (today|soon|in)|suspended|blocked|blacklist|before (the )?(end of day|eod|close of business))\b/i,
};

/** Plain words for each tactic, used on screen and in the owner's notification. */
export const TACTIC_WORDS: Record<Tactic, string> = {
  impersonation: "claims to be an authority, a bank or your boss",
  urgency_secrecy: "pushes you to act fast or keep it quiet",
  changed_details: "asks you to pay to new bank or PayPal details",
  off_platform: "asks to pay outside PayPal or move the chat elsewhere",
  gift_cards_crypto: "asks for gift cards or crypto",
  fee_to_release: "asks for a fee to release money or goods",
  otp_or_link: "asks for a code or sends a link to click",
  overpay_refund: "says they overpaid and want the difference back",
  too_good: "promises a prize or guaranteed profit",
};

/** Scan one message: which tactics fire, in plain words. Used on supplier and buyer messages before they are shown. */
export function scanText(text: string | null | undefined): { fired: Tactic[]; words: string[]; level: "clear" | "caution" | "hold" } {
  const t = (text ?? "").slice(0, 4000);
  const fired = TACTICS.filter((k) => SEEDS[k].test(t));
  const hard = fired.some((k) => ["changed_details", "off_platform", "gift_cards_crypto", "fee_to_release", "otp_or_link"].includes(k));
  return { fired, words: fired.map((k) => TACTIC_WORDS[k]), level: hard ? "hold" : fired.length ? "caution" : "clear" };
}
