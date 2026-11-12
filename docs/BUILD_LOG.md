# StockSure build log (9 to 12 Nov 2026)

The dated record of what was built, checked live and fixed, kept from the earlier README. The current overview is in [../README.md](../README.md).

**Receive it. Resolve it. Pay correctly. Keep trading.**

StockSure is a shared receiving and resolution workspace for a wholesaler and the cafés, shops and restaurants it supplies. When a delivery arrives short, damaged or mis-billed, StockSure:

- agrees what actually arrived,
- turns that into the correct PayPal charges,
- gets compatible replacement stock on its way within the buyer's limit,
- keeps the evidence and audit trail throughout.

Spec: https://claude.ai/artifact/MLTy7wTFHfEFKDuVjhk85W

## For judges: try it in 60 seconds

1. Open **https://pph-stocksure.onrender.com/judge** and press **Start your own demo**. You get a private demo in under a minute (35 s when last measured), with real PayPal sandbox holds already placed from a saved sandbox wallet. No PayPal login is needed.
2. Pick a path. Each step has a button that signs you in as the right person (Sam, Ana or Jordan) and opens the exact screen. The tick appears when the server records that the step happened.
    - **A short delivery, paid for exactly** (about 3 minutes): count, agree, approve the fix, then watch PayPal capture what arrived and release the rest.
    - **Catch a bank-change scam** (about 1 minute): post the 10 Nov review's "we've moved banks" message as Ana, then check it as Jordan. Three readers check it on the server and one more runs in the browser. Nothing can show green for a message that names somewhere to pay.
    - **Let the agents settle it** (about 1 minute): the café's agent and the wholesaler's agent trade offers on two crushed cases. A referee in code refuses any offer outside either side's limit; both people still approve, and PayPal settles only the agreed version.
    - **Catch a bad invoice** (about 1 minute): Ana sends an invoice with one case billed extra, a new payee and a line written to an AI, then the same invoice under a new number. Code catches each; Jordan sees them on Protected this month.
    - **Ask the AI, and watch it work** (about 1 minute): every tool call shows on the AI work rail as it runs. The answer's sentences link to the calls they rest on. No tool can move money.
3. Pages that need no sign-in:
    - [`/proof`](https://pph-stocksure.onrender.com/proof): every evaluation case, with pass or fail, date and model ids
    - [`/ai`](https://pph-stocksure.onrender.com/ai): recent model calls
    - [`/paypal`](https://pph-stocksure.onrender.com/paypal): every PayPal API used, with live ids
    - [`/who-can-move-money`](https://pph-stocksure.onrender.com/who-can-move-money)
    - [`/accessibility`](https://pph-stocksure.onrender.com/accessibility)
    - [`/agents`](https://pph-stocksure.onrender.com/agents): connect your own assistant over MCP

There is no dedicated judge buyer login yet; the paths above cover every PayPal step without one. The landing page also has a scam check that runs entirely in your browser.

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

Locally, open `/demo` and sign in as Jordan (one-click sign-in to the local data is on outside production). On the live site every visitor presses **Try the live demo** and gets a private demo of their own (see Wave 1 below). Settings:

- `OPENAI_API_KEY` and `AI_PROVIDER=openai` read dockets, invoices and photos. In production the server refuses to start without them, or without the PayPal credentials and `SESSION_SECRET`.
- `PAYPAL_DEMO_VAULT_TOKEN` and `PAYPAL_DEMO_VAULT_PAYER`: the saved sandbox wallet that demo buyers pay from.
- `SS_ADMIN_KEY` guards `/admin/*` (workspaces, showcase, wallet re-approval).
- `SS_OFFLINE_RULES=1` (never in production) runs the labelled offline text parser instead of a model, for tests and the e2e server.

```bash
npm test                  # 89 tests on a fake PayPal: arithmetic, extraction, flows, workspaces (no model, no network)
npm run e2e               # Playwright, 8 browser tests on a hermetic server (port 4471)
npm run sandbox:check     # what the sandbox app can do
npx tsx scripts/wave1-live-check.mts   # Wave 1 acceptance against the live site
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
| Document reading (delivery notes, invoices, photos) | Real OpenAI Responses API calls (gpt-6.1-sol, backup gpt-6-sol; gpt-6-luna for short answers). If both fail the page says "I couldn't read that" and offers "Read it again"; no rules reader stands in. The text parser runs only in labelled offline test mode. Output is always a proposal a person confirms; instruction-like lines are removed before reading |
| Negotiation wording, mandate compile, ask-the-ledger | Model writes words only; prices, quantities and rules come from code and are checked verbatim |
| Agents | Buyer and supplier agents are rule-driven; every offer passes a guard; the agreement is hashed and HMAC-signed by both sides |
| Channels | Telegram and WhatsApp adapters with webhooks; live only with tokens. The simulator at `/channels` always works. Web push needs VAPID keys |
| AG Grid, Bryntum | AG Grid Enterprise 32.3.3 ledger (grouping, master-detail PayPal record, integrated chart, Excel export, saved view) with the licence from `AG_STUDIO_LICENSE` (a trial key, valid to 9 Dec 2026). Bryntum Scheduler trial build from jsDelivr for the deliveries board |

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

## Wave 1 (11 Nov 2026): private demos, saved wallet, no fallbacks

Done for `MASTER_IMPROVEMENT_SPEC.md` Part C, Wave 1. Deployed from `main` at `3b43763`; checked on the live site with `scripts/wave1-live-check.mts` (21 of 21 checks passed) and with `scripts/pp-check.mts` against PayPal itself.

**A2.1 Saved demo wallet.** Demo buyers pay from one saved sandbox wallet (a Vault payment token), so a judge places holds and captures with no PayPal login. It is attached only inside a demo workspace, checked with PayPal daily, and re-approvable on `/admin/paypal/wallet`. If PayPal no longer has it, new demos are created without it and the owner is offered PayPal's own approval page. Pages say "Paid from the demo's saved sandbox wallet".

**A1 Private workspaces.** Each visitor gets a Postgres schema of their own (`stocksure_ws_<id>`), chosen per request and per job. The seed runs the real order path: the almond milk order is held and dispatched; the espresso beans are held, counted in full and captured; the cups are held, one carton is agreed as crushed, the rest is captured, and a replacement is held and dispatched. That is 6 PayPal operations, counted on `/start` as "N of 6 payments confirmed by PayPal". Older closed orders are marked **Sample** and never touched PayPal. A join link and QR code put a second device in the same demo. "Reset my demo" gives you a new one and closes the old one; nobody else's is touched. Idle demos close after 48 hours, and their open holds are voided and read back first. Limits: 5 new demos per address per hour, 300 live. The landing preview reads from a read-only showcase demo rebuilt daily. Webhooks find their demo from `custom_id` (`<workspace>:<order>`), else from the PayPal ids the demo recorded. A query into a closed demo fails instead of falling through to the base data.

**A4 Hosting and decay.** `/healthz` checks the database and returns the commit. A GitHub Actions job requests it every 10 minutes (`.github/workflows/keep-warm.yml`; set the repository variable `KEEP_WARM=off` to stop it). A sweeper puts jobs left `running` by a restart back in the queue, re-queues a settlement stuck with no job using the same PayPal request ids, and surfaces it as "needs you" if it is still stuck an hour later. Seeds have no fixed dates; PayPal's 3-day honor period is handled by the existing reauthorize job, so no per-demo clock was needed here.

**A11, A5.1, A5.4, A5.5 AI and no fallbacks.** The Anthropic path and the rules stand-ins are gone. Each tier has a primary and a backup GPT-6 model with strict JSON schema; broken JSON gets one repair attempt. When every model fails, the reading is stored as failed with "I couldn't read that. Try again, or fill it in below.", the raw error goes to the audit table only, and the receiving page offers **Read it again**. Photo and invoice read failures are said on the page too. Production refuses to start without its keys. The hard-code audit (the spec's word list over `web/src` and `src/web`) found two more issues, both fixed. The Evidence page now reads eval results from where they were recorded and shows the date, instead of saying "not run yet" inside every demo. In-app simulator alerts now say "in simulator" instead of "sent". The rest of the word list is labelled demo controls (sample dockets and invoices) or "simulated" labels.

**Bugs.**
- P0 scam-hold loop: an approved scam-check hold was never found, so settlement held it again forever. Approvals now hash the move only (action, order, amount), and older rows are matched by payload.
- S4: the held message is posted once per approval.
- S1: one server-side "needs you" drives Home, its empty state and the nav badge.
- S2: the money panel shows charged, held now, being released, released and refunding, all computed on the server from PayPal state. A test uses $180, $24, $20 and $6.
- S3: every amount reads as currency, including older activity rows.
- "1 orders" is fixed.
- Found on the way:
  - A bare count for a product sold in bags ("3") was refused as an unknown unit.
  - The e2e server picked up a real OpenAI key from the shell.

**Live results (11 Nov 2026, `pph-stocksure.onrender.com`).**

| Check | Result |
|---|---|
| `/healthz` with commit | Pass: 200, `3b43763`, database 3 ms |
| No demo: nobody to sign in as, preview from the showcase | Pass |
| Two visitors get two demos; ids, people and orders don't overlap; A's person can't sign in to B | Pass |
| Seeding through the real path | Pass: 6 of 6 confirmed by PayPal in 35 s, in both demos |
| No-login hold from the saved wallet | Pass: authorization `4X4865885N4062817`, CREATED, $200.00 |
| Seeded ids read back from PayPal | Pass: captures `6D921500F08256803` ($96.00) and `1N198921MU796225A` ($85.00) COMPLETED; holds `3ER86399D87832629` and `94367020JL215953K` CAPTURED, `97F8328608403670L` and `7G262260FA170053E` CREATED. Every one carries its demo's id in `custom_id` |
| Connecting PayPal goes to PayPal's own sandbox page | Pass: `www.sandbox.paypal.com/agreements/approve` |
| An unreadable document | Pass: "I couldn't read that. Try again, or fill it in below.", source none, no raw error on the page |
| Reset gives B a new demo and leaves A alone | Pass |

**Not verified on the live site.**
- **Wallet gone.** The case where the saved wallet no longer works is covered by tests only. Removing the live token would break every judge's demo.
- **Idle wake-up.** The A4 "first byte under 2 s after 12 idle hours" check needs 12 idle hours. On Render's free plan an always-awake service uses about 730 of the workspace's 750 shared free hours a month, so the owner should move StockSure to an always-on instance.
- **Expiry timing.** The 48-hour expiry and the daily showcase rebuild have not run in production yet. Both are covered by tests.

**Owner actions.**
- Upgrade the Render instance to always-on (approved in 0.3; a dashboard purchase).
- Provide a dedicated sandbox buyer for judges who want to connect their own PayPal.
- The GPT-6 per-token prices in the cost estimates come from secondary sources.

## Wave 2 (11 Nov 2026): scam check v2, Ask, judge paths, /proof

Done for `MASTER_IMPROVEMENT_SPEC.md` Part C, Wave 2 (items 6 to 9). Deployed from `main`; checked on the live site with `scripts/wave2-live-check.mts` (HTTP) and `web/e2e/judge-live.spec.ts` (a real browser following `/judge` with the page's own buttons).

**A6 Scam check, version 2.** Three readers check every supplier message on the server as it arrives, and the strictest wins:
- **Rules:** the tactic patterns plus the payment-risk model. The bank-change patterns were widened per A6.3.
- **OpenAI Decisions** (`gpt-6-luna`): eleven yes/no questions. Code turns each probability into clear, caution or hold.
- **Destination check, in code:** every payment destination in the message, compared with the supplier's contact on file.

The browser adds the on-device model as a fourth reader on `/safety` and the landing page. A message that names somewhere to pay is never green. If Decisions doesn't answer, nothing is marked safe.

Thresholds live in the `decision_thresholds` table. Two are calibrated on the tuning half of a 66-message labelled set, with a miss counted 10 times a false hold, and scored on the held-out half:
- `changed_payment_details`: held-out precision 94%, recall 100%
- `names_a_payment_destination`: never holds on its own; it only blocks green

The committed `eval/calibration/*.json` is applied by the server at start. The `/safety` page used to say the pasted text never leaves the browser. That was no longer true, and it now says what is sent.

**A5.3 Ask.** The agent runs on the Responses API (`gpt-6.1-sol`): at most 8 steps, 45 s and 25 questions a day per demo.
- **Tools:** StockSure's read tools, PayPal's sandbox MCP server (`mcp.sandbox.paypal.com/sse`, 8 read tools on an allowlist), and one tool that drafts a message to the supplier.
- **No money tools:** nothing the agent is offered can move money. A structural test checks the tool names and the agent's imports.
- **Answers:** each sentence links to the tool calls it cites. Citations are checked against the calls that actually ran. An uncited sentence is stamped "not linked to a fact".
- **AI work rail:** streams each step over SSE.

**A3 Judge page and public pages.**
- **`/judge`:** three paths through the visitor's own demo. Each step's button signs in as the right person and opens the exact screen. Steps tick from server events (`workspaces.checklist`), never during seeding.
- **Live-or-simulated table:** built from the server's configuration.
- **No-sign-in pages:** `/proof`, `/ai`, `/paypal`, `/who-can-move-money`, `/accessibility` and `/agents` (MCP connect command; `/mcp` itself is the endpoint).
- **Tours (A3.3):** automatic tours are gone. A tour starts only from a button, covers one page, ends on any route change and never navigates. The cross-page judge tour was removed.

**A6.6 Landing try-it box.** It runs the on-device model and a browser copy of the destination check; nothing is sent. The model downloads with a progress bar and the service worker caches it.

**A5.6 `/proof`.** Every case is shown with its input, expected result, the answer, and pass or fail, plus the model ids and the date. The server runs the suites nightly in the showcase demo, per suite, so a run cut short by a deploy finishes later. `npm run eval:proof` writes `eval/proof/latest.json`. Suites not yet run on the server are filled from that file and labelled as such.

| Suite (live nightly run, 11 Nov 2026) | Result | Failures |
|---|---|---|
| Regression set from the 10 Nov review | 4 of 4 run cases pass; 3 listed, not run | not run: handwriting photo (no image in the set); not built: duplicate invoice (Wave 4), photo of a screen (Wave 3) |
| Scam check on supplier messages | 65 of 66 | `genuine-14` "Our payment details haven't changed…" was held: Decisions scored *impersonation* at 89%, and that threshold is still the default, not calibrated. A false hold, not a miss |
| Reading delivery notes | 26 of 27 | `trap-invented-2`: an invented "premium" line still reached a proposal. Money impact $0, because only PO lines are paid at quote prices |

**Live results (11 Nov 2026, `pph-stocksure.onrender.com`).**

| Check | Result |
|---|---|
| The 10 Nov message, posted by Ana on an order | Pass: held; rules, Decisions and destinations each said hold |
| The same message in the scam check as Jordan | Pass: held, Decisions answered (`gpt-6-luna`, 297 ms), never green; reason: a free-mail address while the supplier is on file at its own domain |
| Ask: the AI work rail shows at least 2 tool calls | Pass: "Why can't I spend the $20 yet?" ran 6 tool calls, streamed over SSE; PayPal MCP connected with 8 read tools |
| Every sentence linked to a tool call | **Fail** once: 1 of 2 sentences had no valid citation, and the page showed it as "not linked to a fact". That is the check doing its job; it is not a full pass |
| `/proof` lists every case with today's date | Pass: all three suites run on the server on 11 Nov |
| Public pages load with no sign-in; `/paypal` has live ids and no token | Pass |
| Judge paths, in a browser, with the page's own buttons | Pass on ec62e4e: path A (short delivery) 18 s, path B (scam) 6 s, path C (Ask) 47 s, demo seeding 25 s. Every step ticked itself; path C confirmed three orders with PayPal's own `get_order` and drafted (not sent) a note for SS-1008. These are automated clicks; a person reading each screen will take longer, but the waits are well inside 3 minutes |

**Fixed while checking live.**
- The "approve the fix" step ticked on Ana's approval. It now ticks only when both sides have agreed.
- The PayPal-ids question was answered from StockSure's own records of PayPal operations. The agent is now told to confirm ids with PayPal's own read tool, and it reads each order from PayPal's MCP server.
- The draft prompt didn't name an order. With two replacements open, the agent rightly asked which one; the prompt now names the order.
- After path A, the paths switched to a different (draft) order. They now stay on the order the visitor counted.

**Not verified.**
- `/accessibility` reports axe and the 360 px check for the new pages (the e2e suite passed), not a screen-reader session.
- The landing try-it box was checked live on a desktop browser only (`web/e2e/try-live.spec.ts`). The 10 Nov message showed caution and named the payee: "Checked on this device in 50 ms; nothing left your browser." The model loaded in 2 s, a friendly message came back clear, and no request carried the text. The download and caching were not timed on a phone.
- The nightly run has run once, after the deploy; the 24-hour repeat has not happened yet.

**Owner actions.**
- Making the repository public is the owner's call. It is private now, and `/judge` says so.
- A dedicated judge buyer login is still not provided. `/judge` says "no dedicated judge buyer login yet".


## Waves 4 and 5 (11 Nov 2026): agents, invoices, door photo, money panel, accessibility, voice, robot judge

Done for `MASTER_IMPROVEMENT_SPEC.md` Part C, Wave 4 item 14 and Wave 5 items 19 and 20 (StockSure only; Wave 3 has no StockSure item). Deployed from `main` (last commit listed under "Live results"). Checked live with `scripts/wave45-live-check.mts` (HTTP, plus a spoken clip for voice), `scripts/wave2-live-check.mts` and `web/e2e/judge-live.spec.ts` (a browser walking every `/judge` path with the page's own buttons).

**Wave 4 (B4).**
- **Agents settle a shortfall.** The café's agent and the wholesaler's agent trade offers. Each sees only its own side's limit, and a referee in code refuses any offer outside either. When they agree, the terms become a new fingerprinted version of the fix. Both people still approve it, and only then does PayPal capture, release and hold the replacement at the agreed price. Judge path "Let the agents settle it".
- **Invoice checks, code first.** Checks: duplicate under a new number, price above recent deliveries, new payee, a line written to an AI, and early-payment terms. OpenAI Decisions can only add a flag, never clear one. An early-payment discount comes off the capture. Judge path "Catch a bad invoice".
- **Protected this month** on the owner's home. It shows what wasn't charged for goods that didn't arrive, overbilling refused and discounts taken, each with order numbers and PayPal ids. Scam holds and duplicate invoices are listed apart from the total. Sample history is never counted. The owner sees it; the supplier and the receiver are refused (403).
- **Door photo count.** The vision model counts the cases in a photo taken at the door. Decisions answers three questions: does it show damage, does the label match, is it a photo of a screen. A photo of a screen counts nothing. A note that was read takes precedence over the photo; when they disagree, the line is marked `count_differs`. The demo's two sample photos are generated drawings, labelled as generated in the image and in the file name.
- **Phone link.** The owner gets a QR code that signs a phone in as the receiver only. It works once and lasts 15 minutes.
- **Money panel.** Each order shows its hold dates: best charged by day 3 (PayPal's honor period) and valid to day 29. A capture after day 3 reauthorizes first. "Check against PayPal" reads every PayPal id back from PayPal and lists matched, differs, missing, and anything PayPal has that StockSure has no record of. The receiver can't run it.

**Wave 5.**
- **A7 accessibility.**
  - Display and help: the six switches have names and descriptions, and the close button is named.
  - One live region announces payment changes on the order page.
  - No sideways scroll at 200% text or at 320 px.
  - `/accessibility` lists the recorded results of `web/e2e/a11y.spec.ts` (Playwright with axe-core, WCAG 2.2 AA) with their date, plus what was not tested.
- **Voice input.** Push-to-talk on Ask and on the receive page's docket box. The browser streams audio to StockSure's server, which relays it to OpenAI `gpt-live-1`; the key never reaches the browser. The live transcript shows as you speak and the text lands in the box for you to read and send. The model's spoken reply is discarded. Each demo gets 10 minutes of voice a day and 30 seconds a turn, and every turn is audited at $0.05 a minute.
- **A12 AG Grid Enterprise ledger** (`/ledger`). Row grouping by supplier, status or month, with sums. Each order row opens to its PayPal record (master-detail). An integrated chart draws supplier reliability. Excel export writes three sheets (orders, PayPal operations, receipts). A saved view is kept in this browser.
- **Robot judge.** `.github/workflows/robot-judge.yml` walks every `/judge` path on production each night at 03:17 UTC with `judge-live.spec.ts`. It posts the result to `/api/robot-judge` (Bearer token, timing-safe compare; 404 while the token is unset), and `/proof` shows the last run.
- **`/proof` reruns a suite after a deploy when its cases changed** (`SUITE_VERSION`), instead of waiting for the next night.

**Live results (11 Nov 2026, `pph-stocksure.onrender.com`).**

| Check | Result |
|---|---|
| Wave 4/5 live check, 20 checks (on `be9cf54`) | **20 of 20.** Door photo: ALM-12 8 cases, 2 damaged (24 units) seen. Screen photo: flagged, 0 lines. Phone link: signs in as Sam, second use 410. Hold dates: placed 11 Nov, best by 14 Nov, valid to 10 Dec. Check against PayPal: every id matched; receiver 403. Protected: $85.00 not charged; receiver 403. Ledger: Enterprise 32.3.3 with the licence. `/accessibility`: 5 dated checks, all pass. Robot-judge endpoint: 404 (token not set). Voice: "Which supplier short delivers most, and what did it cost" came back through `gpt-live-1` |
| The same check, first run (on `b79f4a8`) | 19 of 20: the receiver could read Protected this month through the API. Fixed in `4d39784` |
| Every `/judge` path in a browser (on `be9cf54`) | **14 of 14 steps.** Seed 29 s; short delivery 19 s; scam 7 s; invoice 19 s; agents 31 s; Ask 45 s. Automated clicks; a person reading each screen takes longer |
| Wave 2 live check (24 checks) | 24 of 24 twice. One earlier run had 21 of 24: the Ask question stopped after one tool call. The cause wasn't captured; the check now prints the reason |
| `/proof` rerun on the live server after the deploy (15:28 to 15:30 UTC) | Regression 7 of 7, now including the duplicate invoice, the photo of a screen and the door photo with two crushed cases. Scam 66 of 66 (`genuine-14` no longer falsely held). Receiving 27 of 27. Cost $0.07 + $0.01 + $0.03. The photos are generated drawings, and `/proof` says so |
| Ledger in a browser (local, Playwright) | Pass: chart drawn, grouped by supplier, an order row opened to its PayPal record, Excel file downloaded, no console errors |

**Fixed while checking live.**
- **Server crashes.** The live server crashed twice: once at 14:46 UTC with "Connection terminated unexpectedly", once at 15:25 with ECONNRESET. Both times the database closed a connection and the `pg` pool, or a client a request was holding, had no error listener, so Node ended the process. The second crash looped, because the `/proof` rerun restarted with each boot. Both listeners now log the error instead. A client that died mid-request is thrown away, and connections use TCP keep-alive. The first crash had also cut short a live check (4 of 16).
- **Grid defaults.** Every order's detail row opened at once, and the side bar covered the grid. Now groups open, details stay closed until asked for, and the side bar starts closed.
- **Stale check.** The Wave 2 check expected three judge paths; it now expects five.

**Not verified.**
- The robot judge has not run from GitHub Actions. Its token is not set, because writing secrets was outside what this session was allowed to do (owner action below). The same spec was run by hand against production (row above).
- No screen-reader session (VoiceOver or NVDA) and no recorded keyboard-only pass. `/accessibility` says so.
- Voice was checked with a recorded clip sent over the relay, not a person speaking into a phone's microphone.
- A stranger completing a path on a phone in under three minutes (quality gate item 4) has not been tried.
- Why Postgres on Render dropped connections twice in an hour is not known. The server now survives it.

**Not done.**
- **A6.4:** retraining the on-device scam model and shipping it to all eight apps. This needs files outside this app's folder, and work here was limited to this folder. It also needs real scam messages from the owner.
- **APIMatic portal and Channel3:** not used by StockSure.
- **Robot judge on Render:** it runs on GitHub Actions instead of as a Render cron job.
- **Plain words** on the device, and **other languages:** not done.

**Owner actions.**
- **Robot-judge token:** generate a random value. Run `gh secret set ROBOT_JUDGE_TOKEN --repo PrathamRanjan/stocksure` and paste it when asked, then set the same value as `ROBOT_JUDGE_TOKEN` on the Render service. Optional: the `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` secrets for failure alerts.
- **AG Grid licence:** the key is a trial that expires on 9 Dec 2026. After that, the ledger shows AG Grid's watermark.
- **Unchanged from Wave 2:** a public repository, a judge buyer login, an always-on Render plan, and an OpenAI budget.

## Hands-free and four languages (12 Nov 2026)

Extra features on top of the core flow. The core flow is unchanged in English; every existing test and live check was rerun (results below). Deployed from `main` at `d4e3276`.

**Look and Say (hands-free).** The hand button in the header, or Alt+Shift+H.
- **Pointing.** Point with your head (the default, steadier on a webcam) or your eyes. Google's MediaPipe face model runs in the browser tab; frames never leave the device.
- **Calibration.** Nine dots, with settings chosen by cross-validation. Four unseen dots then measure the error in pixels and show it to you. Eye gaze is used only if it comes out within 110 px.
- **Snapping.** The pointer snaps to the nearest control, without flicker. Controls grow to at least 44 px while hands-free is on.
- **Voice commands** in English, Hindi, Indonesian and Portuguese: click, press a named button, scroll, back, "reorder this", and stop. "Stop", Esc, or looking away for two seconds stops everything. Without a camera or microphone it falls back to voice only, or to dwell with the mouse.
- **The confirm card is enforced in code.** Anything that moves money, sends, cancels or disputes opens it. Only a spoken "yes" or a real click on Yes goes ahead. Looking at Yes, winking at it, or a script clicking it do nothing. An echoed "yes" from the app's own spoken prompt is dropped, while "no" and "stop" always cancel.
- **PayPal hand-over.** PayPal's approval page is a separate site that hands-free can't drive, so it says so and waits for you to approve there.
- **`/accessibility`** has a simulated-gaze demo that runs the real snapping code without a camera. Beside it is a table of how often snapping hits 30 px and 44 px controls at four noise levels, plus visitor-shared calibration results (none yet).

**Languages: English, हिन्दी (hi-IN), Bahasa Indonesia (id-ID), Português (pt-BR).** The picker is in the header; your choice is remembered (cookie, device and account).
- **Interface.** About 3000 strings, extracted from the code (`scripts/i18n-extract.mts`) and machine-translated by `gpt-6.1-sol` (`scripts/i18n-translate.mts`). The files say they are machine translations; no native speaker has reviewed them.
- **Text written at run time** (agent negotiation moves, AI summaries): translated on the server and cached. Ask and the ledger's questions are answered in your language.
- **Dates and money** are formatted for your language with `Intl`. Charges stay in USD; for example, Portuguese shows `US$ 200,00`. Hindi uses Noto Sans Devanagari.
- **PayPal's approval page** opens in your language (locale on the vault setup token; accepted by the sandbox for all four). English sends no locale, as before.
- **Telegram and WhatsApp messages** go out in the language the recipient picked. The stored copy and the in-app simulator keep the original. If the translation fails, the original is sent.
- **Push-to-talk** now also works on the dispute reason, the message to the supplier and the new-order note.

**Tests.**

| Check | Result |
|---|---|
| Unit tests (vitest), including dictionaries complete with placeholders kept, endpoints, outbound language and hands-free logic | 153 of 153 |
| `e2e/i18n.spec.ts`: 18 screens in four languages, failing on any untranslated interface English (`eval/i18n/misses.json`) | Pass, 0 untranslated. Screenshots in `docs/i18n-shots/` |
| Portuguese and Hindi at 375 px | Pass, no sideways scroll |
| Money flow (quote → hold → dispatch → count → agree → capture → receipt) driven in Hindi, Indonesian and Portuguese | 3 of 3 |
| `e2e/handsfree.spec.ts`: voice on the PayPal hold opens the card with $200.00; a script click on Yes, "no" and "ruko" (stop) leave it unheld; a spoken yes places the hold; a mouse No sends nothing and a mouse Yes sends | 2 of 2 |
| Existing e2e suite (screens, personas, tours, a11y and others) | 17 passed, 4 live-only skipped |
| Live: Wave 4/5 check | 20 of 20 |
| Live: Wave 2 check | 21 of 24. The 3 misses are the "ran today" rule on `/proof`: the suites last ran 11 Nov (7/7, 66/66, 27/27) and were not rerun |
| Live: every `/judge` path in a browser | Pass: seed 48 s, A 40 s, B 20 s, invoice 29 s, agents 33 s, Ask 60 s |

**Found while checking.**
- In Hindi, "Approve v1" had split into "v मंज़ूर करें 1". It is now one template.
- A spoken "no" said while the card's prompt was being read out was dropped as an echo. It now always cancels.

**Not verified.**
- Real camera head or eye tracking with a person. The camera and microphone are blocked in the test browsers, so the voice paths were driven through the module's command entry point.
- Calibration accuracy on real faces.
- Translation quality by a native speaker.
- PayPal's approval page actually rendering in each language (the sandbox accepted the locale; nobody signed in to look).
- Telegram in another language on a real phone.

**Not done.**
- Multiparty payments: needs a PayPal Platform sandbox app the owner creates.
- A QR code that opens the mobile app on a phone: needs an Expo (EAS) project the owner creates (see below).

**Added later on 12 Nov.**
- **Mobile app merged into `main`** (`mobile/`, Expo SDK 58). Render builds only `src/` and `web/`, so it does not affect the server. Since private demos arrived (11 Nov), the live server lists nobody until a demo is started, so the app showed an empty sign-in. Its sign-in screen now starts a private demo and shows the sample holds being placed. Checked through the app's web build against the live server: started a demo, Jordan and then Ana approved the agreed fix on SS-1011, and PayPal captured $48.00 (`0YN32826KY5191239`) and placed the $24.00 replacement hold (`0KC69606SG8132332`). The app's own checks pass (typecheck, 15 of 15 tests). Not run on a real phone or a native simulator.
- **Local-currency estimate.** In Hindi, Indonesian or Portuguese, the order's money panel adds one line: the quote in rupees, rupiah or reais, at the European Central Bank reference rate with its date (`/api/public/fx`, via frankfurter.dev, cached for six hours). For example: "Cerca de R$ 489 (US$ 88,00 … de 11 de nov. de 2026). O PayPal cobra em dólares americanos." If the rate can't be fetched, the line doesn't appear. Nothing changes in English.
- **Recordings** in `docs/recordings/`, made by `web/e2e/record.spec.ts` (`RECORD=1`):
  - `handsfree-confirm-card.webm` (33 s): voice on the PayPal hold. The voice is simulated and the captions say so; the hold is on the test server's fake PayPal.
  - `handsfree-simulated-gaze.webm` (29 s).
  - `mobile-app.webm` (18 s).

**Owner actions.**
- **Shared database.** The shared Render Postgres (free plan, 256 MB) was OOM-killed four times on 12 Nov (06:09, 06:19, 06:48, 06:50 UTC) while all eight apps were deploying and testing. Each time StockSure returned errors for about 10 seconds and then recovered. The free database also expires on 9 Dec 2026. Upgrading the plan fixes both.
- **Mobile QR code:** in `mobile/`, run `npx eas init` and then `npx eas update`. Expo then gives a link and QR code that open the app in Expo Go.
- **Unchanged:** `ROBOT_JUDGE_TOKEN`, a public repository, an OpenAI budget.
