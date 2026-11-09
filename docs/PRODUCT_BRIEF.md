# StockSure product brief

Labels: **[F]** sourced fact, **[E]** estimate, **[A]** assumption. Sources are listed at the end.

## The problem

A café, bakery or deli takes deliveries at the back door before opening. The person on shift signs the docket, often without counting every case. Later, an invoice arrives by email that bills the full order. If something was short, crushed or wrong, the owner has to ring or message the rep, agree a credit, and then remember to check that the credit appeared. [A, consistent with F1, F2]

- **Who has it:** independent food and beverage operators with one to three sites and a handful of regular wholesalers. The owner or manager approves payment; a shift lead or barista does the receiving. [A]
- **The moment it hurts:** about 6:30 in the morning, when a pallet arrives during opening, and again at month-end when the supplier statement doesn't match. [A]
- **What it costs:** credits agreed by email or phone are often never recorded, so there is nothing to reconcile the supplier statement against [F2]. One vendor example puts a $2.50 overcharge on a 30-case weekly line at about $3,900 a year [F2, vendor illustration]. Food businesses run on thin margins, so small leaks matter [E, F1, vendor-written].
- **Fraud on the same paper trail:** business email compromise cost US victims about $2.77 billion in 2024 across 21,442 complaints [F3]. The common pattern is a "new bank details" message during a live invoice. The standard defence is to call a number you already have [F3].

## How it's solved today

| Way | What it costs |
|---|---|
| Paper docket, photo on a phone, WhatsApp the rep, bank transfer from the invoice | Free, but there's no link between what arrived and what was paid. Credits depend on memory. [A] |
| Inventory and procurement suites (MarketMan, Supy) | Per-location subscriptions. MarketMan is listed at about $127–$339 per location per month [F4]. Supy doesn't publish prices [F5]. |
| Restaurant back office (Restaurant365) | About $435–$749 per location per month, billed quarterly [F5]. Built for multi-site groups. |
| AP automation (Ottimate, formerly Plate IQ) | Reads invoices into the books [F6]. No published price was found. It pays what the invoice says unless someone intervenes. [A] |
| Ordering marketplaces (Choco, BlueCart) | Ordering is free or cheap [F7]. Settlement and short-delivery credits stay outside the app. [A] |

## Competitors and substitutes

| Product | Positioning | Pricing | Visual convention [A] |
|---|---|---|---|
| [MarketMan](https://www.marketman.com) | Inventory, receiving, AP, credit memos | $127–$339 per location per month [F4] | Corporate SaaS blue, dashboard tiles |
| [Restaurant365](https://www.restaurant365.com) | Accounting-first back office | $435–$749 per location per month [F5] | Enterprise navy, dense tables |
| [Supy](https://supy.io) | Procurement and inventory, credit notes vs GRN | Quote only [F5] | Modern SaaS gradient |
| [Ottimate](https://www.ottimate.com) | AP automation, invoice OCR | Quote only | Fintech green and blue |
| [Choco](https://choco.com) | Chat-style ordering to suppliers | Free ordering app [F7] | Bright consumer app |
| [BlueCart](https://www.bluecart.com) | Wholesale ordering and catalog | Unclear [F7] | Marketplace blue |
| Substitute: WhatsApp + paper + spreadsheet | Everything | $0 plus time and leakage | None |

The design must not look like any of these. They share cool SaaS blues, KPI tiles and generic dashboards. StockSure's subject is the delivery docket, so its identity starts there.

## Promise

**Pay for what actually arrived.** You and your supplier agree what came off the truck, and PayPal charges exactly that. Nothing more is taken, and the rest of the hold goes back.

### Three jobs it must make effortless

1. **Count it in.** Snap or paste the docket. The reader proposes counts. A person confirms them in under a minute.
2. **Agree it once.** Both sides see the same lines and the same money. They agree or dispute a line, and both approve one fingerprinted fix.
3. **Pay exactly that.** Accepting the quote places a hold. PayPal captures only the agreed amount, releases the rest and places a replacement hold within the limit.

### What a sceptical owner needs before trusting it with money

- A hold isn't a charge, and the screen shows the difference at every step. [product fact]
- Every amount is traced to its source: quote price × counted units. The invoice is compared against that, never paid from it. [product fact]
- Nothing in an email, invoice or chat can change who gets paid. PayPal calls carry no payee. [product fact]
- Approvals are bound to a version. If anything changes, both sides approve again. [product fact]
- Live sandbox evidence with PayPal IDs, and an export of the whole record. [product fact]
- An off switch: protected mode, a kill switch and approval thresholds. [product fact]

## Who does what (shown in the UI as the trust pattern)

| AI proposes | Code decides | PayPal moves money |
|---|---|---|
| Reads the docket, invoice and photos into proposed counts and hints. Writes negotiation wording. Turns the owner's mandate into draft rules. | Payable amount = quote price × confirmed units. It checks limits, the mandate, safety rules, approval thresholds and version hashes, and runs the dry run against live PayPal state. | Authorises the hold, captures with `final_capture` and releases the rest, places the replacement hold and makes refunds. Every call has a request ID and is read back. |
| Never sets a price, quantity or payee. | Can refuse or hold any move. | Holds the money until code asks. |

## Sources

- F1 Supy blog on supplier returns and credit claims (vendor): https://supy.io/blog/learn-restaurant-supplier-returns-credit-claims
- F2 Supy blog on credit notes and receiving discrepancies (vendor, illustrative numbers): https://supy.io/blog/learn-supplier-credit-notes-receiving-discrepancies
- F3 FBI IC3 2024 report as summarised by Nacha and Proofpoint: https://www.nacha.org/news/fbis-ic3-finds-almost-85-billion-lost-business-email-compromise-last-three-years, https://www.proofpoint.com/us/blog/email-and-cloud-threats/fbis-ic3-report-financial-losses-email-fraud-increased-nearly-50-just
- F4 MarketMan pricing on TrustRadius: https://www.trustradius.com/products/marketman/pricing
- F5 Restaurant365 pricing on Capterra and TrustRadius; Supy on G2: https://www.capterra.com/p/139768/Restaurant365/pricing/, https://www.trustradius.com/products/restaurant365, https://www.g2.com/products/supy/pricing
- F6 Plate IQ (now Ottimate) background: https://techcrunch.com/2015/08/08/plate-iq/
- F7 BlueCart comparison pages (vendor, biased): https://www.bluecart.com/blog/choco, https://www.g2.com/products/bluecart/pricing

No market size, customer quote or testimonial is claimed. Validation question: in a five-café sample, what share of deliveries has at least one line short, damaged or mis-billed, and what share of the resulting credits actually lands?
