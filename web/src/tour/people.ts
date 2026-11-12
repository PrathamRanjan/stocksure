/**
 * The three people in every demo, in plain words: who they are, what goes wrong for them today, and what StockSure
 * changes. The landing page, the person picker and the guided tour all read from here, so they never disagree.
 */
export type PersonKey = "jordan" | "sam" | "ana";

export interface PersonInfo {
  key: PersonKey;
  name: string;
  first: string;
  role: string;
  org: string;
  side: "café" | "wholesaler";
  /** One line: what this person does in the story. */
  does: string;
  /** Their problem today, without StockSure. */
  pain: string;
  /** What changes for them. */
  gain: string;
  /** Why the story needs them: what only they can do. */
  needed: string;
  minutes: number;
}

export const PEOPLE: Record<PersonKey, PersonInfo> = {
  jordan: {
    key: "jordan",
    name: "Jordan Lee",
    first: "Jordan",
    role: "Owner",
    org: "Laneway Café",
    side: "café",
    does: "Orders stock from the wholesaler and pays for it through PayPal.",
    pain: "Pays the full invoice even when cases arrive crushed or missing, then chases credit notes for weeks. Can't be at the back door for every delivery, and gets emails asking to pay “our new bank account”.",
    gain: "Money is only held when an order is accepted, and only what was accepted at the door is charged. Anything big or unusual waits for Jordan's approval.",
    needed: "Jordan is the one paying, so Jordan sets the spending limit and approves what gets charged.",
    minutes: 4,
  },
  sam: {
    key: "sam",
    name: "Sam Ortiz",
    first: "Sam",
    role: "Receives deliveries",
    org: "Laneway Café",
    side: "café",
    does: "Meets the truck at the back door and counts what actually arrived.",
    pain: "Signs a paper docket while the driver waits. Notes like “2 cases crushed” get lost, so the café pays for them anyway.",
    gain: "Snaps the docket or a photo; AI suggests the counts, Sam checks and confirms them in a few taps. That count is what the café pays for.",
    needed: "Sam is the only one who sees the goods, so Sam's confirmed count decides what's paid.",
    minutes: 4,
  },
  ana: {
    key: "ana",
    name: "Ana Ruiz",
    first: "Ana",
    role: "Wholesaler",
    org: "Harbour Wholesale Co.",
    side: "wholesaler",
    does: "Supplies the café, sends the quote and the truck, and gets paid.",
    pain: "Waits weeks to be paid, and argues by phone about what was or wasn't on the truck.",
    gain: "The café's money is already held by PayPal before Ana ships. Once Ana agrees the count, the money arrives the same day, with no argument.",
    needed: "Ana is the one being paid, so a count only counts once Ana agrees it. Without Ana the café could claim anything was missing.",
    minutes: 4,
  },
};

export const ORDER: PersonKey[] = ["jordan", "sam", "ana"];

export const personKey = (first: string | null | undefined): PersonKey | null => {
  const k = (first ?? "").toLowerCase();
  return k === "jordan" || k === "sam" || k === "ana" ? k : null;
};

/**
 * Every page in the menus, explained for someone who has never run a café. The guided tour shows these when it
 * reaches the menu, and the landing page's word list uses the same text.
 */
export const PAGES: Record<string, { name: string; what: string }> = {
  orders: { name: "Orders", what: "Every order with the wholesaler and where it is: waiting for a quote, out for delivery, being agreed, paid." },
  deliveries: { name: "Deliveries", what: "The deliveries coming to the café, with the ones waiting to be counted at the top." },
  approvals: { name: "Approvals", what: "Payments StockSure won't make on its own: anything above the owner's limit, or anything the scam check flagged. Each one waits here with the reasons." },
  stock: { name: "Stock", what: "What's on the shelves. It goes up only by what was counted in and accepted, not by what was invoiced." },
  record: { name: "Record", what: "The wholesaler's track record with this café: on time, short, damaged, invoice mistakes. Built from confirmed counts." },
  performance: { name: "Performance", what: "Ana's own record as the cafés buying from Harbour see it: on time, short, damaged, invoice mistakes." },
  ask: { name: "Ask", what: "Ask an AI agent about your orders and PayPal records in plain words. It can look things up; it has no tool that moves money." },
  catalog: { name: "Catalog", what: "The wholesaler's products, pack sizes, prices and stock. Orders and quotes start from here." },
  dock: { name: "Dock (camera)", what: "A phone screen for the back door: point the camera at the docket or the cases and count from the photo." },
  "spending-rules": { name: "Spending rules", what: "The owner's rules for money: a limit per order and per day, and above which amount a payment needs the owner's approval." },
  "scam-check": { name: "Scam check", what: "Paste any message or invoice. Rules, AI readers and the supplier's details on file check it for “pay us somewhere new” tricks." },
  ledger: { name: "Ledger", what: "Every money movement in one table: holds, charges, releases and refunds, each with its PayPal id. Exports for the accountant." },
  "deliveries-board": { name: "Deliveries board", what: "A calendar of what's due and when, and which deliveries are running late." },
  "agent-negotiations": { name: "Agent negotiations", what: "When cases arrive damaged, two AI agents (one for each side) can bargain the fix. Every offer is checked by code against both sides' limits." },
  negotiations: { name: "Negotiations", what: "Fixes that the two AI agents bargained, with every offer and why the referee accepted or refused it." },
  "phone-alerts": { name: "Phone alerts", what: "Telegram and WhatsApp messages: “delivery counted”, “approve this payment”. You can approve from the chat." },
  evidence: { name: "Evidence", what: "How we tested it: evaluation results, every AI and PayPal call, and what's live versus simulated." },
  "paypal-disputes": { name: "PayPal disputes", what: "Disputes buyers opened on PayPal, with the agreed counts and photos ready as evidence." },
};

/** Words that show up on screens, explained once. */
export const WORDS: { k: string; v: string }[] = [
  { k: "Hold", v: "PayPal sets the money aside on the café's account when it accepts a quote. Nothing is charged yet, and a hold can be released." },
  { k: "Capture (charge)", v: "Taking money out of the hold and paying the wholesaler. StockSure only captures what was accepted at the door." },
  { k: "Release", v: "Handing the rest of the hold back to the café. No refund to wait for: it was never charged." },
  { k: "Spending limit", v: "The most an order may cost, including any replacement. Set by the owner when ordering." },
  { k: "Count it in", v: "Checking a delivery at the door: how many arrived, how many damaged, any wrong items." },
  { k: "Accepted", v: "Arrived in good condition. Only accepted cases are paid for." },
  { k: "Damaged / missing / wrong item", v: "Cases that arrived broken, never arrived, or aren't what was ordered. They're not paid for." },
  { k: "The agreement (the fix)", v: "What happens about the problem cases: credit them, or send them again. Code works it out; both sides approve the same version." },
  { k: "Replacement", v: "The wholesaler sends the missing or damaged cases again. A new hold covers them, inside the spending limit." },
  { k: "Credit", v: "The café simply isn't charged for the problem cases." },
  { k: "Waiting on you", v: "Orders where the next step is yours. Everything else is waiting on someone else." },
];
