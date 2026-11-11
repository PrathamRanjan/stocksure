/**
 * Labelled supplier messages for the scam layer (spec A6.3, A5.2 calibration, A5.6 /proof). Author-written; every
 * one is synthetic and says so on /proof. Each case is its own template, so the split by template is the split by
 * case: even positions tune thresholds, odd positions are held out and never used to pick them.
 *
 * Labels:
 *   scam: a careful owner should not pay on this message without checking by phone.
 *   changed: it asks to pay to new or changed payment details.
 *   destination: it names somewhere money could be sent that is not the supplier's contact on file (an address,
 *                account, wallet or a link to pay at).
 *
 * `ten_nov` is the message the 10 Nov review found showing green on Business Desk, rebuilt from the review's quoted
 * fragments ("we've moved banks … send this month's payment to our new PayPal", an outlook.com address).
 */
export interface ScamCase {
  id: string;
  family: "ten_nov" | "bank_change" | "genuine" | "other_scam";
  text: string;
  scam: boolean;
  changed: boolean;
  destination: boolean;
  split: "tune" | "held_out";
}

/** The supplier's contact on file in the demo (seeded on Harbour Wholesale Co.). */
export const SUPPLIER_CONTACT = "accounts@harbourwholesale.example";

export const TEN_NOV = "Hi Jordan, hope you're well! Just a quick note that we've moved banks, so please send this month's payment to our new PayPal: harbourwholesale.accounts@outlook.com. Thanks so much, Ana";

const BANK_CHANGE = [
  "Hi Jordan, we've switched banks this month. Could you pay invoice INV-2291 to our new PayPal, payments.harbour@gmail.com? Cheers, Ana",
  "Quick heads up: our banking has moved. Please use the PayPal below for this month's settlement: harbour.pay@outlook.com",
  "Dear customer, our account details have been updated. Kindly remit to BSB 062-111 account 10293847 from today.",
  "Hello! Our old account is being closed at the end of the week, so please send payment to accounts-hw@proton.me instead.",
  "Hi Jordan, small admin change: our PayPal is now billing.harbourwholesale@hotmail.com. Please use this one for the next payment.",
  "We have a different bank account for remittances now. New details: IBAN GB33 BUKB 2020 1555 5555 55.",
  "Please note we're moving to a new bank. For this delivery please transfer to account 4410 2234 9981, sort code 20-00-00.",
  "Ana here. Our usual PayPal is under review, so could you pay to harbourpay@yahoo.com for now?",
  "Morning! New PayPal for Harbour Wholesale going forward: paypal.me/harbourwholesalepay. Thanks!",
  "Hi, updated remittance details below. Please pay to the following account: 0623 1182 7731.",
  "Our finance team has changed banks. This month's invoice should go to the new beneficiary, Harbour Holdings Pty, acct 55 1234 5678.",
  "Hey Jordan, can you send this week's payment to our other PayPal? It's ana.ruiz.hw@gmail.com. The old one has issues.",
  "Just letting you know our payment details changed on the 1st. Please settle to harbour.finance@outlook.com.",
  "Due to an audit, our existing account is frozen. Kindly use this account instead: account 7788 1234 5566.",
  "Hi! We moved our business banking. Pay the outstanding balance to our new account, BSB 033-222 acct 998877665.",
  "Accounts here. We switched to a new PayPal business account: payments@harbour-wholesale-billing.com.",
  "Please update your records with our new bank details before paying invoice INV-2310: account 1209 3344 5521.",
  "Our PayPal changed, it's now hw.settlements@icloud.com. Same as before otherwise!",
  "Friendly reminder: payment for order PO-1042 should now go to our new remittance address, remit@harbourwholesale-pay.net.",
  "Hello Jordan, our bank merged so the account is different now. Transfer to IBAN DE89 3704 0044 0532 0130 00 please.",
  "We are no longer using the old PayPal. Please send money to harbourwholesale2026@outlook.com from now.",
  "Hi, Ana from Harbour. Bank's changed on our end, could you redo the payment to BSB 062-000 account 1182 7732?",
  "Notice: beneficiary details updated. Kindly direct all future payments to Harbour Supplies Ltd, account no. 6612 0098 1123.",
  "So sorry for the hassle, but we've moved accounts. Please pay through paypal.me/anaruizpayments this time.",
  "Our accountant asked that this month's payment goes to a different account: hw-accounts@protonmail.com on PayPal.",
  "Hi Jordan, please don't use the PayPal on file, it's being closed. Use harbour.wholesale.pay@gmail.com.",
  "Change of bank: from Monday our account number is 3344 5566 7788 (BSB 082-001). Thanks for updating.",
  "Hope the week's going well! We're switching banks, the new PayPal is ana@harbour-payments.co. Pay there please.",
  "Payments team here: we migrated our banking, so the remittance account is now account 0099 8877 6655.",
  "Hey, our PayPal got changed after a security issue. Could you send the money to hwholesale.billing@live.com?",
];

const GENUINE = [
  "Hi Jordan, the delivery is running 30 minutes late today, sorry! Driver is on the way.",
  "Your order PO-1042 has been dispatched. 20 cases of oat milk, arriving about 9am.",
  "Thanks for the payment, all received. See you next week.",
  "Reminder: invoice INV-2291 is due Friday. Pay through StockSure as usual.",
  "We've updated our delivery schedule: drops are now Tuesdays and Fridays.",
  "New product: we now stock an almond barista blend. Want me to add it to the next order?",
  "Our new account manager, Priya, will look after Laneway from next month.",
  "Hi Jordan, two cartons of cups were crushed in transit; we'll send replacements with Thursday's delivery.",
  "Price update: oat milk goes up 3% from 1 December. Your current quote stays as agreed.",
  "Can you confirm the counts for today's delivery? Sam signed for 18 good, 2 damaged.",
  "We moved our warehouse to 12 Dock Road. Nothing changes for your deliveries.",
  "Happy holidays from Harbour Wholesale! We're closed on the bank holiday Monday.",
  "The replacement cases are on the truck. Tracking number 1Z999AA10123456784.",
  "Our payment details haven't changed. Please keep paying through PayPal in StockSure as always.",
  "Invoice INV-2295 is attached for last week's delivery; the total matches the agreed quote.",
  "Hi Jordan, could you approve the revised quote in StockSure? It now includes the extra 2 cases.",
  "Please send any delivery questions to orders@harbourwholesale.example.",
  "Thanks Jordan! Payment for PO-1038 came through on PayPal this morning.",
  "We can do a credit of $20 for the short case instead of a replacement, if you prefer.",
  "Heads up: road works on Laneway, the driver will park on Bourke St.",
  "Your monthly statement is ready in StockSure. No action needed.",
  "We're switching to recyclable cartons next month, same price and pack size.",
  "Could you update the delivery contact to Sam? He'll be receiving from now on.",
  "Ana here, I've updated the quote: cups are now 50 per sleeve, not 40.",
  "Pay the invoice in StockSure when the counts are agreed, there's no rush.",
];

const OTHER: { text: string; changed: boolean; destination: boolean }[] = [
  { text: "Jordan, it's Mia (director). I need you to buy 5 Apple gift cards for a client today and send me the codes. Keep this between us.", changed: false, destination: false },
  { text: "PayPal Security: your account is limited. Verify at http://paypal-secure-check.co/login within 24 hours.", changed: false, destination: false },
  { text: "We accidentally overpaid our refund by $400, please send the difference back to our PayPal ana.refunds@gmail.com.", changed: true, destination: true },
  { text: "Your delivery is held at customs. Pay a $35 release fee at bit.ly/hwcustoms to receive it.", changed: false, destination: true },
  { text: "Please read me the 6-digit code PayPal just texted you so I can confirm your order.", changed: false, destination: false },
  { text: "Let's settle outside the app to save fees. WhatsApp me on +61 400 111 222 and pay by bank transfer instead.", changed: true, destination: false },
  { text: "Congratulations! Laneway Café has won a $1,000 supplier loyalty prize. Claim it by paying the $25 admin fee.", changed: false, destination: false },
  { text: "URGENT: final notice. Pay invoice INV-9921 in USDT to wallet address 0x9f3a77c1 today or your account will be suspended.", changed: false, destination: true },
  { text: "Hi it's Ana, I'm locked out, can you pay this month by Zelle to my personal number? Don't mention it to the office.", changed: true, destination: false },
  { text: "Your supplier account will be blocked. Click here to confirm your payment details: https://stocksure-verify.help", changed: false, destination: false },
];

export const SCAM_CASES: ScamCase[] = (() => {
  const out: ScamCase[] = [{ id: "ten-nov", family: "ten_nov", text: TEN_NOV, scam: true, changed: true, destination: true, split: "held_out" }];
  BANK_CHANGE.forEach((text, i) => out.push({ id: `bank-change-${i + 1}`, family: "bank_change", text, scam: true, changed: true, destination: true, split: i % 2 ? "held_out" : "tune" }));
  GENUINE.forEach((text, i) => out.push({ id: `genuine-${i + 1}`, family: "genuine", text, scam: false, changed: false, destination: false, split: i % 2 ? "held_out" : "tune" }));
  OTHER.forEach((c, i) => out.push({ id: `other-${i + 1}`, family: "other_scam", text: c.text, scam: true, changed: c.changed, destination: c.destination, split: i % 2 ? "held_out" : "tune" }));
  return out;
})();
