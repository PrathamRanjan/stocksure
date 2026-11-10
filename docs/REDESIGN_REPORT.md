# StockSure redesign report

10 November 2026. Branch `redesign`, merged to `main` at `7f762ab` and live at https://pph-stocksure.onrender.com.

## What it is

StockSure helps a café and the wholesaler that supplies it agree what actually came off the delivery truck, so PayPal charges for that and nothing more. A short, damaged or over-billed delivery becomes a PayPal capture for the accepted goods, a released remainder, and a held replacement order within the café's spending limit.

It is for independent food and drink operators with one to three sites and a few regular wholesalers. The owner approves money, a shift lead receives goods, and the supplier's rep quotes and ships.

## 1. Integration matrix

What was verified on 10 Nov, plus what the audit found earlier the same day ([AUDIT.md](AUDIT.md)).

| Integration | Status | Evidence |
|---|---|---|
| PayPal vault (setup and payment token) | **Live-verified** | Laneway Café is connected to the sandbox buyer on Render |
| Orders v2 AUTHORIZE with vault token (hold) | **Live-verified through the new UI** | SS-1006 authorization `5MD69055VC2423637`, $200.00 ([sandbox-run.json](sandbox-run.json)) |
| Capture, `final_capture=true`, rest released | **Live-verified through the new UI** | Capture `7LA86677X48449538`, $180.00 COMPLETED. Read back: the authorization is CAPTURED with $0.00 still held. |
| Replacement hold | **Live-verified through the new UI** | SS-1006-R1 authorization `07R62181F24019456`, $24.00. Spendable afterwards: $6.00 of $210.00. |
| Refund, part capture, webhooks | Live-verified 8–10 Nov (audit), not repeated after the redesign | Refund `7J742945YF3793447` $11.40; part capture `5MG871926F355880V` $80.00 |
| Void, reauthorize, disputes, Transaction Search, balances | Implemented, **no sandbox recording** | Need a 3-day-old hold or a buyer-opened dispute |
| Payouts, invoicing, subscriptions | **Not wired** | Client methods exist; no screen uses them |
| OpenAI reader (gpt-5.5) | **Live-verified** | Live journey: the "two crushed" docket read into 20 delivered and 2 damaged, then Sam confirmed |
| Telegram, web push | Live on Render | Ribbon on Render shows "Telegram live" |
| AG Grid (`/ledger`), Bryntum Scheduler (`/deliveries`) | Live, re-themed to Docket | Bryntum runs the trial build, with its watermark |
| MCP server `/mcp`, agent negotiation | Wired | Not redesigned; reached from the Controls nav |
| Render | Web service and Postgres, auto-deploy from `main` | Three deploys today, each live in about 90 s |
| APIMatic, Channel3, Twilio | **Not used** | — |

**Buyer activity match: not done after the redesign.** The sandbox buyer is signed out in the browser, and I won't type PayPal passwords. Once you sign in at sandbox.paypal.com, the buyer's Activities page should show −$180.00 (capture `7LA86677X48449538`). The earlier audit run did match: −$68.40, +$11.40 refund and −$10.00.

## 2. Hard-coding findings and fixes

The full table is in [AUDIT.md §3](AUDIT.md). In short:

- **Fixed before the redesign:**
  - The demo page's fixed dollar amounts (H1). The new `/demo` computes every figure from the live order.
  - The fake hero card "PO-1042 $214.60" (H2) and buttons that did nothing (H3). The landing page now previews the real demo order from `/api/ui/preview`.
  - A misleading sandbox-check message (H4) and a stale evidence claim (H5).
  - An over-strict arena expectation (H6).
- **Kept and labelled:** model replay on total failure, shown as "(replay)"; demo mode defaulting to on; fault injection only in demo mode; the seed order.
- **Found and fixed during this pass:**
  - The owner's sidebar linked to `/disputes`, a supplier-only page, which answered 403. Removed.
  - On phones the ribbon said "PayPal sandbox" even when PayPal was simulated. It now says "Sandbox · no real money", which is true in both modes; the wide ribbon still names each live or simulated service.
- No literal amount, id or frozen clock changes a business result. Money is always quote price × confirmed units, in integer cents, computed on the server. The front end never computes money: it renders the server's `funding` and `resolution.totals`.

## 3. Design direction

**Docket.** The product's subject is the delivery docket, so the identity starts there:

- **Palette:** paper `#F4EFE4`, ink `#1B1A16`, carbon-copy blue `#2A3F8F`.
- **Stamps:** PayPal states are rubber stamps (HELD, CAPTURED, RELEASED, REFUNDED).
- **Tally strip:** one mark per case. Ink is accepted, a red strike is damaged, dashed is short.
- **Settlement bar:** splits the spending limit into charged, held, being released and spendable.
- **Type:** Archivo (wide display) and Source Sans 3.

The rivals in the brief (MarketMan, Restaurant365, Supy, Ottimate, Choco) all use cool SaaS blues and KPI tiles; this doesn't. Full brief: [DESIGN_BRIEF.md](DESIGN_BRIEF.md).

**Product shape:**
- One next step per order, for the person looking at it.
- Approvals that say what moves, to whom, why it waited, and what happens if you decline.
- Every PayPal call listed with its PayPal id and request id.
- The paperwork panel shows the stripped "pay $500 elsewhere" line.

**Tours:**
- Judge Mode: 13 steps, about 3 minutes. Starts from `?tour=judge`, survives navigation and reload, and signs in as Jordan halfway through.
- A first-run tour per persona (4–5 steps, "Don't show again").
- "Take the tour" is always visible in the ribbon.

### Screenshots

These are 60 files in [screenshots/](screenshots/): ten screens at 375, 768 and 1440 px, each in light and dark. They come from the self-contained test server, so the ribbon reads "PayPal sandbox simulated" and the payer is a made-up sandbox-style address.

| Screen | 375 light | 1440 light | 1440 dark |
|---|---|---|---|
| Landing | [01-375-light](screenshots/01-landing-375-light.png) | [01-1440-light (full page)](screenshots/01-landing-1440-light.png) | [01-1440-dark](screenshots/01-landing-1440-dark.png) |
| Sign in (personas) | [02-375-light](screenshots/02-sign-in-375-light.png) | [02-1440-light](screenshots/02-sign-in-1440-light.png) | [02-1440-dark](screenshots/02-sign-in-1440-dark.png) |
| Owner home | [03-375-light](screenshots/03-owner-home-375-light.png) | [03-1440-light](screenshots/03-owner-home-1440-light.png) | [03-1440-dark](screenshots/03-owner-home-1440-dark.png) |
| Receiving counts | [04-375-light](screenshots/04-receive-counts-375-light.png) | [04-1440-light](screenshots/04-receive-counts-1440-light.png) | [04-1440-dark](screenshots/04-receive-counts-1440-dark.png) |
| Order, agreed | [05-375-light](screenshots/05-order-agreed-375-light.png) | [05-1440-light](screenshots/05-order-agreed-1440-light.png) | [05-1440-dark](screenshots/05-order-agreed-1440-dark.png) |
| Money and PayPal timeline | [06-375-light](screenshots/06-order-money-paypal-375-light.png) | [06-1440-light](screenshots/06-order-money-paypal-1440-light.png) | [06-1440-dark](screenshots/06-order-money-paypal-1440-dark.png) |
| Approvals | [07-375-light](screenshots/07-approvals-375-light.png) | [07-1440-light](screenshots/07-approvals-1440-light.png) | [07-1440-dark](screenshots/07-approvals-1440-dark.png) |
| Judge tour | [08-375-light](screenshots/08-judge-tour-375-light.png) | [08-1440-light](screenshots/08-judge-tour-1440-light.png) | [08-1440-dark](screenshots/08-judge-tour-1440-dark.png) |
| Demo controls | [09-375-light](screenshots/09-demo-controls-375-light.png) | [09-1440-light](screenshots/09-demo-controls-1440-light.png) | [09-1440-dark](screenshots/09-demo-controls-1440-dark.png) |
| Supplier home | [10-375-light](screenshots/10-supplier-home-375-light.png) | [10-1440-light](screenshots/10-supplier-home-1440-light.png) | [10-1440-dark](screenshots/10-supplier-home-1440-dark.png) |

To regenerate them, run `npm --prefix web run shots`.

## 4. Test, build, Lighthouse and live QC

| Check | Result |
|---|---|
| `npm run typecheck` (server, web, e2e) | Clean |
| `npm test` (Vitest) | **80/80** (77 before). New: `test/ui-api.test.ts`, the front end's JSON contract and access control. |
| `npm run build` (as Render runs it) | Clean. Main bundle 438 kB (135 kB gzip). |
| `npm run e2e` (Playwright, hermetic server with fake PayPal and in-memory DB) | **8/8** |
| Contrast (`npm --prefix web run contrast`) | All text pairs ≥ 4.5:1, borders and focus ring ≥ 3:1, light and dark |
| Live sandbox journey (`E2E_BASE=… LIVE=1`, `e2e/live.spec.ts`) | **3 of 4 runs passed** (28–31 s each); see failures below |
| Live QC: axe and 360 px, per persona, public, dark, server pages, all tours | Pass on the final deploy |

The 8 Playwright tests:
1. Three-person journey from draft to capture. It checks that the capture equals the accepted amount and is below the quote.
2. axe (WCAG 2.2 AA) and no sideways scroll at 360 px on every persona's pages.
3. Public, error, 404 and offline states.
4. Dark-theme axe.
5. Server-rendered control pages at 360 px with axe, and every sidebar link for every persona.
6. The judge tour across pages, including a reload.
7. First-run tours, including "Don't show again".
8. Keyboard control of the tours.

**Lighthouse 12.8.2** (full numbers in [lighthouse-summary.json](lighthouse-summary.json)):

| Page | Live, mobile | Live, desktop | Local, mobile |
|---|---|---|---|
| Landing | 92 / 100 / 100 / 100 | 100 / 100 / 100 / 100 | 92 / 100 / 100 / 100 |
| Sign in | 94 / 100 / 100 / 100 | 100 / 100 / 100 / 100 | 91 / 100 / 100 / 100 |
| Owner home | 95 / 100 / 100 / 100 | 100 / 100 / 100 / 100 | 92 / 100 / 100 / 100 |
| Order page | — | — | 92 / 100 / 100 / 100 (desktop 100) |

Scores are performance / accessibility / best practices / SEO. Mobile CLS is 0 and LCP is 2.6–3.0 s.

### Failures found and fixed during verification

| Found by | Problem | Fix |
|---|---|---|
| Playwright | On a fresh browser, choosing a persona bounced back to sign-in, because the old session answer was still cached. A first-time judge would have hit this. | The session refresh is awaited, and signed-in pages wait while it runs |
| Playwright | `?tour=product` started the judge tour | The tour kind is read before the parameter is removed |
| Playwright | The order page overflowed 160–180 px at 360 px once an agreement existed | Grid tracks use `minmax(0,1fr)`; approval stamps no longer carry the name |
| axe | Sideways-scrolling tables couldn't be reached by keyboard | They are now focusable, labelled regions, in React and through `a11y.js` on server pages |
| Lighthouse | Mobile performance was 47–68: no compression, and CLS 0.44 from the font swap and a late ribbon | Gzip enabled, both fonts preloaded, ribbon renders before the session loads. Now 91–95. |
| Live QC | The real sandbox payer email (37 characters) widened `/home` by 81 px; the local seed's short email had hidden it | The email wraps; the test server now uses an email of the same length |
| Live QC | Owner sidebar → `/disputes` returned 403 | Link removed |
| Live QC | Server pages: the icon-only Display button had no name, the backtest slider had no label, toasts were 4.34:1 (red on pink), the balances table and the driver link overflowed | All fixed; `server-rendered control pages` covers them |

**Still open:** one live journey run (the second of four, started right after a deploy) timed out at 4 minutes. The next two passed in 28 s. The trace was overwritten before I read it, so the cause is unknown. It could be a cold worker after the deploy, or a slow reader call.

## 5. Scores, before and after

Scored strictly against the five criteria, out of 10. "Before" is `bf79ca8`, the graphite UI audited this morning. "After" is `7f762ab`.

| Criterion | Before | After | What a judge sees | What still costs points |
|---|---|---|---|---|
| Technological implementation | 8 | 8.5 | A real sandbox hold, final capture with the rest released, a replacement hold and a refund, all with request-id idempotency and read-back. The AI reader is bounded so the model never sets a price, quantity or payee. Also MCP agents, mandate guard, three-arm eval, and 80 + 8 tests. | Reauthorize, disputes and void have no sandbox recording. The AI's visible role is reading paperwork, which judges may find thin next to "agentic" entries. |
| Design | 5 | 8 | One coherent Docket product across landing, sign-in, three personas, money screens, approvals, demo and tours. Mobile-first, axe-clean, Lighthouse a11y 100, light and dark. | The control pages (`/guard`, `/ledger`, `/deliveries`, `/negotiations`) are re-themed server pages, not rebuilt, so the jump between them is visible. Bryntum shows its trial watermark. |
| Potential impact | 6 | 6.5 | A specific moment (6:30 a.m. delivery, month-end mismatch) and a clear promise. Fraud-safe paperwork is demonstrated. | No user evidence. Both sides must adopt it. Wholesale is usually paid on net terms or by bank transfer, not card or PayPal authorizations, and the pitch doesn't answer that. |
| Innovation | 7 | 7 | Settling by confirmed counts on the payment rail (authorize, partial or final capture, replacement hold within one limit) is different from Supy and Haddock-style invoice/GRN matching, which stops at a credit note. | Receiving-discrepancy agents are common in 2026 vendor material (Spendflo, Haddock). The novelty is the PayPal settlement, and that needs to be the headline. |
| Presentation | 3 | 5.5 | The judge tour, honest demo ribbon, `/demo` with live figures and reset, and the landing preview of the real order. | **There is no video yet.** This criterion is judged mainly on the video. |
| **Average** | **5.8** | **7.1** | | |

### Tracks

| Track | Odds | Why | Single best change |
|---|---|---|---|
| 1st place | Long shot | A strong build, but the field is large and the presentation is unfinished | A 3-minute video that shows money changing because of a count |
| 2nd / 3rd place | Long shot, a realistic contender if the video lands | Tech and design are now both above the typical entry | Same video |
| Most Creative | Long shot | The tally strip and stamps are memorable, but the concept is practical rather than surprising | Open the video on the tally strip turning into a capture |
| Most Impactful | Long shot | No real user and the B2B payment-rail question is unanswered | One real café or wholesaler quote, plus an answer to "why PayPal for wholesale" |
| Best Demo Delivery | Long shot | Judge Mode is strong, but this prize is about the video | Record the judge tour path live, with the PayPal sandbox ids on screen |
| **Best Use of PayPal + AI** | **Realistic contender** | Deep PayPal use (vault, authorize, final capture, release, replacement hold, refund, idempotency, webhooks) with AI reading paperwork inside hard limits, all verified live | Show buyer-activity matching in the video |
| Best Use of Agentic Commerce | Long shot | The MCP server, negotiating agents and mandate guard exist, but the UI and story barely mention them | Show one MCP agent drafting and negotiating an order that stops at the owner's approval |
| AG Grid (1st/2nd/3rd) | Long shot | The ledger uses AG Grid and AG Studio, but it's secondary | Make `/ledger` the month-end reconciliation screen in the video |
| APIMatic | Not eligible | Not used | — |
| Bryntum | Long shot | Scheduler on `/deliveries` with drag-to-ETA, but trial watermark | Remove the watermark (licence) and show the ETA risk flow |
| Channel3 | Not eligible | Not used | — |
| Render (1st/2nd/3rd) | Long shot | Web service and Postgres with auto-deploy; no Render Workflows, worker runs inline | Move the job worker to a Render background worker or Workflow |

**Rivals compared:**
- Supy, Haddock and Spendflo's receiving-discrepancy agent: match documents and raise credits or claims, but don't move the payment.
- MarketMan and Restaurant365: back-office suites at $127–$749 per location per month.
- The hackathon gallery isn't public before the deadline, so I couldn't compare against other entries. The odds above are relative to the published rules and sponsor list, not to seen rivals.

### Top three changes before submission

1. **Record the video (about 3 minutes).** Follow the judge tour:
   - Jordan accepts, and the hold appears.
   - Ana ships with the poisoned invoice, and the paperwork panel strips it.
   - Sam counts 2 crushed.
   - Both approve, PayPal captures $180 and releases $20, and the replacement holds $24.
   - Finish on the sandbox buyer's activity page.
2. **Answer "why PayPal for wholesale" in one line** on the landing page and in the pitch. For example: small suppliers already take PayPal from cafés, and authorization lets them ship against a guaranteed hold instead of offering net-30 terms. This is the biggest impact gap.
3. **Give agentic commerce one visible screen.** Show an MCP agent's draft order waiting in Approvals with the mandate check, or cut the claim from the pitch.

## 6. What I couldn't do, and why

- **Buyer-activity check after the redesign.** It needs the sandbox buyer to sign in, and I don't enter PayPal passwords. Run IDs are in [sandbox-run.json](sandbox-run.json).
- **Video.** Out of scope for this pass, and it needs your voice.
- **Rebuilding the server-rendered control pages in React.** They're re-themed, labelled and pass axe and the 360 px check, but they're still a second UI.
- **The 4-minute timeout on one live run.** The cause wasn't found (see §4).
- **Comparing against other hackathon entries.** The gallery isn't public before the deadline.

## How to run the checks

```bash
npm run typecheck && npm test
npm --prefix web run build && npm run e2e
npm --prefix web run shots
cd web && E2E_BASE=https://pph-stocksure.onrender.com LIVE=1 npx playwright test e2e/live.spec.ts
```

`npm --prefix web run shots` regenerates the screenshots. The last command runs a real sandbox journey and writes `docs/sandbox-run.json`.
