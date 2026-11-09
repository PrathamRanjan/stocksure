# StockSure integration and hard-coding audit

Run on 10 Nov 2026 against a local server (`redesign` branch, fresh PGlite database, real PayPal sandbox credentials, real OpenAI key) and the live service https://pph-stocksure.onrender.com. Secrets were read only by the app; none are printed here.

## 1. Integration matrix

| Integration | Status | Evidence |
|---|---|---|
| PayPal OAuth | **Live-verified** | `npm run sandbox:check`: OAuth ok for app `APP-5EG70139E4014733N` (sandbox) |
| Vault setup token + payment token | **Live-verified** | Corner Deli connected on localhost with the sandbox buyer; setup token `42Y761685V110070H` from the check script |
| Orders v2 AUTHORIZE with vault token (hold) | **Live-verified** | SS-1008 order `7KN51992N0500715H`, authorization `32090235P6968602G`, $79.80 |
| Capture, `final_capture=true` | **Live-verified** | capture `8DR45979LU675050V` $68.40 COMPLETED; authorization read back CAPTURED (rest released) |
| Replacement hold and capture | **Live-verified** | SS-1008-R1 order `502378913X147794U`, authorization `4T410321XA045561J`, capture `70B06379BB1682331` $10.00 |
| Refund | **Live-verified** | late-defect refund `7J742945YF3793447` $11.40 COMPLETED on capture `8DR45979LU675050V` |
| Buyer activity check | **Matches** | Sandbox buyer activity shows −$68.40 (Refunded), +$11.40 refund, −$10.00, all 10 Nov |
| Partial capture `final_capture=false` (two-part delivery) | Live-verified 8 Nov (README), not re-run today | capture `5MG871926F355880V` $80.00 |
| Void | Implemented, tested on the fake client | not run today |
| Reauthorize (day 3 job) | Implemented, dry-run gated; **no sandbox recording** | job fires only after 3 days |
| Disputes list, evidence; Transaction Search; Balances | Implemented; called from `/disputes` on the live instance; **no recorded sandbox result** | sandbox has no disputes on these captures |
| Order tracking | Implemented on the driver page; not run today | |
| Payouts, Invoicing | Client methods exist; **not wired** to any screen | `createPayout`, `createInvoice` unused by routes |
| Subscriptions | **Not wired** | |
| Webhooks + signature verification | Live-verified 9 Nov (verified events received on Render); not re-verified today | unverified events are stored and refused with 400 (`src/webhooks.ts`) |
| OpenAI Responses API (reader) | **Live-verified** | the fresh delivery note was read by `gpt-5.5-2026-04-23 (primary)`; invoice compared, overbill flagged ("bills 96 units, 72 accepted. Paying 72") |
| OpenAI (mandate compile, negotiation wording, ask-the-ledger, photo) | Wired; model calls recorded per purpose in `ai_calls` | three-arm eval: model arm cost $0.0439, p50 2.3 s |
| Twilio | **Not used** by this app | |
| Telegram | **Live on Render** (`/evidence`: "Telegram live"); local instance has no token, so the simulator is used | one-time connect code, shared bot |
| Web push | **Live on Render** (VAPID set) | |
| Channel3 | **Not used** | |
| AG Grid | Community grid on `/ledger`; AG Studio mounts when `AG_STUDIO_LICENSE` is set (it is) | |
| Bryntum Scheduler | Trial build from jsDelivr on `/deliveries` | trial watermark |
| MCP server | Wired at `/mcp`, keyed by `ssk_` keys; `npm run agent:demo` | |
| Render | Web service live, `/healthz` 200 (22 s cold start) | worker runs inline |

## 2. Test and eval results (10 Nov, before redesign)

- `npm run typecheck`: clean.
- `npm test`: 77/77 passed.
- `npm run sandbox:check`: OAuth, Vault scope, setup token, webhook id all ok.
- `npm run eval:three-arm`: rules 26/27 correct, model 26/27, oracle 27/27; 9/9 traps caught in every arm; $0.00 paid on traps against $1,765 at risk.
- `npm run eval:arena`: **21/22 first run**. Case n02 reported a hole; see finding H6. After the fix, 22/22.

## 3. Hard-coding hunt

| # | Where | Finding | Verdict | Action |
|---|---|---|---|---|
| H1 | `src/web/routes.ts` `/demo` | Scenario text states $200, $180, $24, $204, $500 as fixed numbers | Demo scaffolding, labelled as the scripted scenario, but it goes stale as soon as a judge changes a price or count | Replaced: the new demo page computes every figure from the live order |
| H2 | `src/web/landing.ts` hero | Mock card shows "PO-1042 … $214.60 of $268.00", numbers that exist nowhere in the product | Fake, decorative, presented as a product screen | Replaced: the new landing previews the real demo order from `/api/ui/preview` |
| H3 | `src/web/landing.ts` safety section | `<span class="btn">Approve capture</span>` styled as buttons that do nothing | Fake controls | Removed with the old landing |
| H4 | `scripts/sandbox-check.ts` | Reported "ANTHROPIC_API_KEY not set (text parser…)" while the OpenAI reader is configured, so the check under-stated the AI path | Misleading | Fixed: reports the configured reader |
| H5 | `src/web/trace.ts` evidence card | Said reauthorize, disputes, etc. "need credentials in this instance" while credentials are present | Stale claim | Fixed: states what has a sandbox recording and what does not |
| H6 | `src/eval/arena.ts` n02 | Hole reported, but the agents agreed exactly at catalog ($264.00); the agent's auto-accept was then held because the eval buyer had no PayPal connection | Eval expectation too strict, not a product defect | Fixed: the case checks the price property it names and accepts "held: connect PayPal" |
| H7 | `src/ai/provider.ts` | When every model fails, the last real answer to the identical input may be replayed | Legitimate resilience; labelled `(replay)` in the reader column | Kept; the new UI shows the reader and how it ran |
| H8 | `src/config.ts` | `SS_DEMO_MODE` defaults to true, which enables "Sign in as" without a key | Demo scaffolding; Render sets it explicitly | Kept; listed as a production risk |
| H9 | `src/paypal/index.ts` | Fault injection only in demo mode; the fake client is reachable only from tests and the arena (`setPayPal`) | Legitimate | Kept |
| H10 | `src/services/seed.ts` | Demo PO pre-filled (20 cases, $10, limit $210) | Seed data, resettable; the app works without it (fresh order above) | Kept |

No literal money amount, id or frozen clock was found in route or service code that changes a business result. All settlement amounts are computed from confirmed counts × quoted prices in integer cents.

## 4. Fresh-data test (values not in the seed)

Corner Deli (Marco, Tess) ordered **7 cases ALM-12 almond milk**, limit **$95.00**, deliver by **13 Nov 09:30 UTC**, OAT-12 approved as substitute. Ana quoted **$11.40/case**. Ana dispatched with an **overbilled** sample invoice. Tess pasted a new delivery note ("1 cs leaking") and confirmed 7 delivered, 1 damaged.

| Step | Result |
|---|---|
| Hold | $79.80 (7 × $11.40) on PayPal |
| Reader | gpt-5.5 proposed the counts; overbill flagged, only 72 units paid |
| Resolution | pay $68.40 (6 × $11.40), credit $11.40, replace 1 case with OAT-12 at $10.00; $78.40 of $95.00 |
| Settlement | capture $68.40 final; release read back; replacement hold $10.00; replacement received; capture $10.00; both orders closed |
| Late defect | 12 units (1 case) spoiled, supplier agreed, refund $11.40 completed |

Every screen and the record export used the new values.

## 5. P0 check before redesign

No crash, dead end, wrong amount or fake result presented as real was found in the working flow. The fakes found (H2, H3) are on the marketing page only and are removed in the redesign.

## 6. What stays simulated, and why

- Payouts, invoicing and subscriptions are not part of this product's flow.
- Reauthorize, disputes, balances and transaction search have code paths that call the sandbox, but no recorded run: they need a 3-day-old hold or a buyer-opened dispute.
- Local runs use the channel simulator; Telegram and push are live only on Render.
- The browser scam model and the payment-risk model are advisory and trained partly on synthetic data (stated on `/safety/model-card`).
