# StockSure

**Receive it. Resolve it. Pay correctly. Keep trading.**

StockSure is a shared receiving and resolution workspace for a wholesaler and the cafés, shops and restaurants it supplies. When a delivery arrives short, damaged or mis-billed, StockSure:

- agrees what actually arrived,
- turns that into the correct PayPal charges,
- gets compatible replacement stock on its way within the buyer's limit,
- keeps the evidence and audit trail throughout.

Spec: https://claude.ai/artifact/MLTy7wTFHfEFKDuVjhk85W

## The scenario

Laneway Café orders 20 cases of oat milk at $10 a case, with a $210 spending limit. Barista Oat and a mill-direct oat milk are approved as substitutes.

1. **Order and hold.** Harbour Wholesale confirms the quote. Accepting it places a **$200 PayPal hold**, which is a vaulted authorization, not a charge.
2. **Dispatch.** Harbour dispatches with an invoice. The invoice hides a line telling an "assistant" to pay $500 to another address. StockSure flags the line, removes it before reading, and it changes nothing.
3. **Receive.** Receiving uploads the delivery note. AI, or the text parser if no model is configured, proposes 20 cases and an unverified damage hint from the driver's note. Sam confirms **18 accepted, 2 damaged**.
4. **Agree facts.** Harbour agrees the line, or disputes it in the line thread. A revision creates receipt v2, and only changed lines need re-review.
5. **Resolve.** The resolution pays **$180** and does not charge **$20**. The original SKU is out of stock, so it picks **2 × Barista Oat at $12 = $24**. The final total is **$204 of $210**. Both sides approve the same version, bound by its hash.
6. **Settle.** The steps are:
    - Capture $180 on the hold with `final_capture`.
    - Confirm by read-back that PayPal released the other $20. It is not spendable until then.
    - Place a $24 replacement hold.
    - The replacement is dispatched and received, then $24 is captured.

The order closes at **$204**, with stock showing 18 cases plus 2 Barista.

## Run

```bash
npm install
cp .env.example .env      # PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET (sandbox), APP_URL, PORT
npm run dev               # or: npm run build && npm start
```

Open `/demo` and choose **Reset and load demo data**, then sign in as Jordan. Connect PayPal once with a sandbox buyer, then follow the steps on `/demo`. Optional pieces:

- `ANTHROPIC_API_KEY` enables reading photo and PDF documents.
- Without it, text documents are parsed deterministically, and images are kept as evidence for a person to count.

```bash
npm test                  # 44 tests: arithmetic, extraction, flows on a fake PayPal (no model, no network)
npm run sandbox:check     # what the sandbox app can do
```

## How money stays correct

- **Payable amount = quote price × human-confirmed accepted units.** The amount is computed in integer cents with round-half-up per line (`src/core/money.ts`, `src/core/resolve.ts`). Invoice figures only raise flags such as overbilled, price above quote, or not on the PO.
- **No document can redirect payment.**
    - No PayPal call takes a payee (`src/paypal/types.ts`).
    - Model output is validated against a lines-only schema.
    - Instruction-like lines are removed before anything reads a document (`src/ai/extract.ts`).
- **Expected credits are not money.** Spendable is limit − captured + confirmed refunds − live holds − holds in flight, all taken from read-back PayPal state (`src/core/funding.ts`). The replacement hold waits until PayPal shows the original hold released.
- **Nothing is charged twice.** Settlement is a recorded saga: `capture_original → confirm_release → order_replacement → authorize_replacement → finish` (`src/services/settle.ts`).
    - A recorded step never runs again.
    - Every PayPal write carries a `PayPal-Request-Id` that retries reuse.
    - A lost response is resolved by reading the order back.
    - A new request id is used only after a definite refusal.
- **Approvals are bound to a version and hash.** Any change creates a new version, and earlier approvals become stale (`src/services/resolution.ts`).
- **AI proposes; people confirm.** Only a buyer receiving person or owner can confirm counts. Photos and notes appear as unverified hints.

## Layout

| Path | What |
| --- | --- |
| `src/core/` | Pure: units (cases, each, kg, L), money, three-way match, replacement planner, funding |
| `src/ai/extract.ts` | Instruction scan, delivery note and invoice parsing, optional model extraction (forced tool call, zod) |
| `src/services/orders.ts` | PO lifecycle, quotes, PayPal holds, dispatch with invoice, Vault connect |
| `src/services/receiving.ts` | Uploads, proposals, receipt versions, supplier agree/dispute, stock ledger |
| `src/services/resolution.ts` | Resolution bodies, revisions, hashed approvals |
| `src/services/settle.ts` | Settlement saga |
| `src/services/records.ts` | CSV and JSON exports, supplier performance |
| `src/web/` | Server-rendered pages: orders, PO page, receiving, stock, catalog, performance, demo |
| `src/ai/provider.ts`, `src/ai/grounding.ts` | OpenAI Responses API provider (strict schemas, forbidden money fields, audit), instruction quarantine |
| `src/guard/` | Mandate → rules, backtest, earned autonomy, dry run gate, provenance, kill switch, passkey, hash-chained audit |
| `src/agents/` | Buyer and supplier negotiation agents, offer guards, runtime (one round per job) |
| `src/services/agreements.ts`, `reauth.ts`, `disputes.ts` | Signed two-party agreement, reauthorize job, dispute sync and evidence |
| `src/mcp/`, `src/web/merchant.ts` | MCP tools for buyer and supplier agents; Cart-API-style merchant endpoint |
| `src/channels/` | Telegram, WhatsApp, simulator, web push; replies approve or decline held moves |
| `src/web/guard.ts`, `trace.ts`, `ledger.ts`, `deliveries.ts`, `dock.ts`, `disputes.ts`, `negotiations.ts` | Guard console, traces and evidence and judge mode and channels and PWA, AG Grid ledger, Bryntum deliveries board, receiving dock and driver page, supplier disputes, negotiation pages |
| `src/eval/` | Receiving three-arm eval fixtures and runner, negotiation arena and adversarial cases |
| `test/` | `core.test.ts` (33), `flows.test.ts` (26), `paypal-in-progress.test.ts`, `structural.test.ts` (6), `journey.test.ts` (every route, no 5xx) |

## What is real and what is not

| Part | Status |
|---|---|
| Vault connect, AUTHORIZE holds, partial and final capture, void, refund, webhooks | Real PayPal sandbox calls (see the live runs below) |
| Reauthorize after 3 days, disputes list and evidence, Transaction Search, Balances, order tracking, invoices, payouts | Implemented in the client and the fake with `PayPal-Mock-Response` support; exercised by tests; sandbox recording pending (needs credentials in this instance) |
| Document reading (delivery notes, invoices, photos) | Real OpenAI Responses API calls when `AI_PROVIDER=openai`; Anthropic optional; the text parser otherwise. Output is always a proposal a person confirms; instruction-like lines are removed before reading |
| Negotiation wording, mandate compile, ask-the-ledger | Model writes words only; prices, quantities and rules come from code and are checked verbatim |
| Agents | Buyer and supplier agents are rule-driven; every offer passes a guard; the agreement is hashed and HMAC-signed by both sides |
| Channels | Telegram and WhatsApp adapters with webhooks; live only with tokens. The simulator at `/channels` always works. Web push needs VAPID keys |
| AG Grid, Bryntum | AG Grid Community ledger with cross-filtering widgets; AG Studio mounts when `AG_STUDIO_LICENSE` is set. Bryntum Scheduler trial build from jsDelivr |

## Foundation and widening (9 and 10 Nov 2026)

The roadmap in `../ROADMAP.md` (Part B foundation, Part C.2 features S1 to S10) is implemented here as follows.

- **Provider layer** `src/ai/provider.ts`: OpenAI Responses API with strict JSON schemas, chain primary → fallback → replay, forbidden money and PayPal id fields rejected at call time, per-call audit with cost. `src/ai/extract.ts` reads delivery notes, invoices and photos through it (Anthropic path kept as a fallback).
- **Agent trace** `src/trace.ts`: every hold, capture, refund, reauthorization and negotiation round is a traced run with actor, tool, rule, gate and PayPal request id. Pages `/traces`, `/trace/:id`; JSON at `/api/v1/runs`.
- **Guard** `src/guard/`: the owner's purchasing mandate in plain words → rules (model proposes, validator clamps and reports), 90-day backtest over the buyer's own orders with a what-if slider, earned autonomy, dry run against live PayPal state before every write, provenance of amounts, kill switch (organisation and per agent), passkey countersign above `SS_COUNTERSIGN_ABOVE_CENTS`, hash-chained audit. Console at `/guard`.
- **Agents (S2, S4)**: MCP at `/mcp` (buyer: get_mandate, list_suppliers, list_catalog, get_stock, draft_order, submit_order, negotiate, get_negotiation, accept_quote, list_orders; supplier: list_open_orders, quote_order, get_performance, set_floor; both: get_order, get_trace) keyed by `ssk_` keys from `/demo`; merchant cart API under `/api/merchant`. Buyer and supplier agents negotiate one round per job under the mandate and the supplier's floor (`src/agents/`), with model wording checked for verbatim prices; pages at `/negotiations`.
- **Signed agreement (S5)** `src/services/agreements.ts`: the accepted quote's lines, prices, deadline and total are hashed and HMAC-signed for the buyer at acceptance and countersigned by the supplier at dispatch; dispatch refuses if anything changed.
- **PayPal depth (S7)**: reauthorize job after `SS_REAUTHORIZE_AFTER_DAYS`, disputes sync and evidence pack (agreement hash, receipt, resolution, document hashes, tracking) at `/disputes`, Transaction Search and Balances, order tracking from the driver page, `PayPal-Mock-Response` in the client and fake.
- **Channels (B.8)** `src/channels/`: buyers get approval requests and order events, suppliers get new orders and receipts, drivers get their stops; replies approve or decline held moves.
- **Ledger and deliveries (S8, S9)**: `/ledger` (orders, PayPal ops, receipts, negotiations as related AG Grid tables; widgets billed versus paid, supplier reliability, hold coverage; ask-the-ledger on our model; JSON and CSV), `/deliveries` (Bryntum board; a supplier drags an order to record an ETA after a server check).
- **Dock and driver (S6, S9)**: `/dock` receiving PWA with camera capture into the existing receive flow; `/driver/:token` arrival notice and carrier tracking without sign-in.
- **Evidence (B.5)**: `/evidence` (real versus simulated, three-arm receiving eval, negotiation arena and adversarial cases, model usage), `npm run eval:three-arm`, `npm run eval:arena` (22 cases, all held), `test/structural.test.ts`.
- **Judge mode** `/judge`, **PWA** (manifest, service worker, push subscribe).
- **Eval explorer** `/evidence/eval` (every eval row, sliced by arm, outcome and trap, CSV); `/llms.txt`; skill file `skill/SKILL.md` at `/skill.md`; file map in `docs/foundation.md`.

Not done yet: the demo video; sandbox recordings for reauthorize, disputes and void (they need a 3-day-old hold or a buyer-opened dispute). The three-arm numbers on `/evidence` are a regression suite on synthetic notes built from the demo catalog, not an independent benchmark.

## Front end and tests

The signed-in app and public pages are a React + Vite + Tailwind + shadcn front end in `web/`, built into `web/dist` and served by Express. It reads `/api/ui/*` JSON views and posts to the same form handlers with `X-StockSure-UI: 1`; money is always computed on the server. Control pages (`/guard`, `/ledger`, `/deliveries`, …) stay server-rendered in the same Docket theme. Judge Mode: `/?tour=judge` or "Take the tour".

- `npm test`: 80 server tests. `npm run e2e`: Playwright against a hermetic server (fake PayPal, in-memory DB): persona journey, axe and 360 px per persona, tours.
- `cd web && E2E_BASE=https://pph-stocksure.onrender.com LIVE=1 npx playwright test e2e/live.spec.ts`: a real sandbox journey through the UI; ids land in `docs/sandbox-run.json`.
- Design, screenshots, Lighthouse and scores: [docs/REDESIGN_REPORT.md](docs/REDESIGN_REPORT.md).

## Deploy

`render.yaml` defines web, worker and Postgres. Set `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` and `APP_URL`, plus `AI_PROVIDER=openai` with `OPENAI_API_KEY`, `PAYPAL_WEBHOOK_ID`, `TELEGRAM_BOT_TOKEN`/`TELEGRAM_WEBHOOK_SECRET`, `WHATSAPP_TOKEN`/`WHATSAPP_PHONE_ID`/`WHATSAPP_VERIFY_TOKEN`, `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY` and `AG_STUDIO_LICENSE` if you want them.

## Live sandbox run (7 Nov 2026)

These runs used the real PayPal sandbox, after one buyer approval for Vault. The amounts were read back directly from `GET /v2/checkout/orders/{id}`.

| Order | What happened | PayPal result |
| --- | --- | --- |
| SS-1006 | $200 hold, then 2 of 20 cases damaged and agreed, then $180 captured with `final_capture` | Authorization `6G2458228E067772E` CAPTURED; capture `0G475721WJ2805001` $180.00, final |
| SS-1006-R1 | 2 × Barista Oat replacement held for $24 only after the release read-back, then received and captured | Authorization `57E258221K8998630` CAPTURED; capture `8TU31716686846135` $24.00 |
| SS-1006 total | — | **$204.00** captured of the $210 limit. Payee is the app's own sandbox merchant; the injected invoice line had no effect |
| SS-1008 (repeat order) | Injected faults: the capture response was lost, then the hold read back as stale | One capture `8E472802H43466828` $200.00, found by reading the order back. The release step waited 13 s until PayPal showed CAPTURED |

Notes from the run:

- After a partial capture with `final_capture: true`, the sandbox reports the authorization as `CAPTURED`, not `PARTIALLY_CAPTURED`. StockSure treats that status as release confirmed.
- The sandbox business account settles in USD for these captures. For example, the $180 capture had $173.58 net after fees.

## Changes on 8 Nov 2026

From the six-product review and implementation plan (https://claude.ai/artifact/5sDaBKUfMziPvxnTwDfswc). 55 tests pass; each change below has a test on the fake PayPal, and the live reruns below exercised them on the sandbox.

- A capture PayPal reports as PENDING is recorded and waited on (no limit on checks); release spending, the replacement and closing wait until it completes. DECLINED or a later reversal on an already-closed PO becomes an owner exception (webhooks now recheck captures after settlement).
- A supplier's line agreement carries the receipt version and counts it was given for; an agreement sent from an older version is refused.
- Agreed replacement stock is held (`stock_holds`) so other orders can't ship it; stock, price and deadline are rechecked before the replacement is ordered, and a failed recheck releases the hold and raises an exception without ordering.
- The planner offers an affordable partial replacement (e.g. 5 of 10 packs on a $50 budget) with the remaining shortage stated, ranks shortfalls as a share of each line's need, and reports whether the search was complete.
- New: late-defect claims after delivery. The buyer reports, the supplier agrees or disputes, and an agreed claim is refunded on the original capture (recorded before sending, retried with the same request id). The signed receipt is never edited.
- New: early warning on a late supplier. The supplier records an ETA, its own or a forwarded carrier event, with the time it was observed. The newest observation wins: a duplicate reference is one update, and an older observation is kept but not applied. An ETA after deliver-by opens a risk card (slack, stock on hand, other connected suppliers, evidence chain, what isn't known). The owner can wait or ask to expedite; neither creates a payment, hold or order. An on-time update or the delivery closes it. Not built: ordering a replacement from the risk card, so the duplicate-arrival case doesn't arise yet.
- New: delivery in two parts on one hold. From a funded PO the supplier can **ship part now**. Once both sides agree that part's counts, StockSure captures just its accepted value with `final_capture=false`, so the rest of the hold stays live. The supplier then ships the rest; the buyer counts only that delivery and the receipt adds the agreed part to it, so the normal resolution sees the whole order. Settlement captures the total less what the part already charged, as the final capture, and PayPal releases what is left. The two captures always add up to the agreed payable. The part charge uses its own request id, reads back a lost response by invoice id, and waits on PENDING. A part with nothing accepted charges nothing.
- Fixed while building it: the spend-limit check counted a part capture on the PO's own hold as "other spend" on top of the accepted total (it said $260 for a $180 order).
- Fixed live: demo reset did not clear the newer tables (defect claims, shipments, ETA updates, risks, stock holds); a leftover defect claim made the reset fail and the unhandled error stopped the server. The reset now clears them, and a failed reset reports an error instead (regression test).
- Fixed during the live rerun: a demo reset kept the same invoice-id tag, so PayPal refused the next hold with `DUPLICATE_INVOICE_ID`. The reset now rotates the tag (regression test added).

## Live sandbox rerun (8 Nov 2026; every ID checked with `scripts/pp-check.mts`)

Saved PayPal connection kept across the reset, so no new buyer approval was needed.

| Step | PayPal result |
| --- | --- |
| SS-1006 accepted: $200 hold | Order `5PF1443829003771S`, authorization `3D670449SK341620J` |
| Late carrier ETA (`TRK-88123-EV4`, 8 h after deliver-by) → early warning; owner asked to expedite | No PayPal call (the card creates no money) |
| 20 delivered, 2 damaged, agreed with the version fingerprint; both approved resolution v1 | Capture `28731825JA6336927` $180.00 final (fee $6.42); the injected invoice line was flagged and ignored |
| Replacement SS-1006-R1: 2 × Barista Oat held only after the release read-back, received, captured | Order `2JK41895AS504251S`, capture `9FJ339870B534851G` $24.00 (fee $1.12) |
| Total | **$204.00** of the $210 limit |
| Late defect: 1 case spoiled after closing; supplier agreed | Refund `8BR82929HA123440Y` $10.00 COMPLETED on the original capture (now PARTIALLY_REFUNDED); receipt v1 unchanged |

### Live run: delivery in two parts (8 Nov 2026; checked with the PayPal API)

| Step | PayPal result |
| --- | --- |
| SS-1006 accepted: $200 hold | Order `34B61764V7910614Y`, authorization `71C37892DK606914H` |
| Part 1: 8 of 20 cases shipped, received complete, agreed | Capture `5MG871926F355880V` **$80.00 COMPLETED, not final** (fee $3.02); $120 still held |
| The rest: 12 cases shipped; 12 received, 2 crushed; agreed; both approved resolution v1 ($180) | Capture `4DC0640679882434K` **$100.00 COMPLETED, final** (fee $3.70); authorization now CAPTURED (rest released) |
| Replacement SS-1006-R1 for the 2 crushed cases | Hold `1J717576F0757221E` $24.00 placed after the release read-back |
| Total on the original hold | $80 + $100 = **$180.00**, exactly the agreed payable |

The hold's status now refreshes to PARTIALLY_CAPTURED right after a part capture. That was added after this run and is tested on the fake PayPal only.

## Review fixes (9 Nov 2026)

From the 8 Nov independent review: each defect its probes reproduced is fixed, and each probe is now a regression test that checks the correct behaviour (test/flows.test.ts and test/core.test.ts). 62 tests pass. These fixes are tested on the fake PayPal; they have not been re-run live on the sandbox yet.

- Only a CREATED authorization funds an order. PENDING waits (rechecked by a job) and can't ship; DENIED or VOIDED returns the order to its quote.
- A late-defect refund is spread across every capture of the order (a two-part delivery has two), each part with its own request id.
- Our own refunds never raise the "may be unpaid" alarm when PayPal's webhook reports the capture REFUNDED.
- A replacement that stopped working can be re-planned and agreed again from the exception, without capturing the accepted goods twice.
- The late-ETA warning stays open after a first part arrives, and closes when the rest is delivered.
- An agreed defect removes the spoiled units from the buyer's stock.
- The budget-limited planner can split a tight budget across lines (for example A4 + B2 rather than all on one line).
- A declined part capture becomes an exception, and retry places a new capture request.

## Scam and fraud protection (9 Nov 2026)

StockSure's PayPal calls never take a payee, so a message or invoice cannot redirect settlement. The tampering risk is in the paper and the thread, and that is what the layer checks (`SAFETY_ACCESSIBILITY_SPEC.md` §4, StockSure row of §6). Three layers, strictest wins, none can approve a payment:

- **Rules in the gate** (`src/safety/index.ts`, called from `src/guard/dryrun.ts` before the approval threshold): a supplier message on the order that announces new bank or PayPal details, or asks to be paid outside PayPal, holds the capture or refund (`supplier_details_changed_in_message`, `supplier_asks_off_platform`) with the reasons in the approval payload; an invoice that bills more than the settlement computed from accepted quantities is noted and the difference is not paid; documents whose instruction-like lines were removed are counted; the amount against the buyer's history with that supplier is a caution. Protected mode (per buyer organisation) holds every capture and refund.
- **Scam text model in the browser** (`public/safety/`, 23 MB int8 ONNX, fine-tuned MiniLM) scores a pasted supplier email or invoice text on the owner's device at `/safety`. Advisory; its score never reaches the gate. Supplier messages on the order thread carry a red or amber scam banner from the rules.
- **Payment-risk model** (`public/safety/risk_lgbm.json`): monotone LightGBM, **trained on synthetic data**, a ranking signal shown with the rule reasons.

Tests: `test/safety.test.ts`; the model's measured results are on `/safety/model-card`.

## Accessibility (9 Nov 2026)

`public/a11y.js` and `public/a11y.css` on every page: a **Display and help** button with text size, high contrast, Atkinson Hyperlegible, read-aloud, voice input (on-device where the browser supports it), plain words, bigger targets, more time (removes the dock page's auto-refresh) and no motion. A first-visit card offers the same choices. The profile stays in this browser's `localStorage`; typing and buttons always work without it. AG Grid keeps its own keyboard navigation and ARIA grid roles.
