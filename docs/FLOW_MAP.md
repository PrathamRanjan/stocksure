# StockSure flow map

Read from the code on the `redesign` branch (10 Nov 2026) and checked against a local run on real PayPal sandbox and the live site at https://pph-stocksure.onrender.com.

## Personas (seeded by `src/services/seed.ts`)

| Person | Organisation | Role | What they do |
|---|---|---|---|
| Jordan Lee | Laneway Café (buyer) | owner | Creates orders, connects PayPal once, accepts quotes (places the hold), approves resolutions, approves held captures and refunds, sets the mandate on `/guard` |
| Sam Ortiz | Laneway Café | receiving | Uploads the delivery note and photos, confirms counts |
| Priya Nair / Lee Chen | Bayside Bakery | owner / receiving | Second buyer with imported history (performance numbers) |
| Marco Bianchi / Tess Walker | Corner Deli | owner / receiving | Third buyer, has a second draft order (cups and beans) |
| Ana Ruiz | Harbour Wholesale Co. (supplier) | supplier | Prices quotes, dispatches with an invoice, agrees or disputes lines, approves resolutions, agrees defect claims, records ETAs, edits the catalog |
| Driver | Harbour | token link `/driver/:token` | Arrival notice and carrier tracking, no sign-in |
| Agents | Buyer or supplier | `ssk_` key over MCP `/mcp` or `/api/merchant` | Draft and submit orders, negotiate, accept quotes when the mandate allows |

## Screens

| Path | Who | What it shows | State it changes |
|---|---|---|---|
| `/` | public | Landing, persona picker | none |
| `/login` | public | Key sign-in; "Sign in as" buttons in demo mode | sets `ss_who` cookie |
| `/home` | everyone | Orders that need you, all orders, PayPal connect card | none |
| `/po/new` | buyer owner | Supplier, deliver-by, limit, up to three lines with substitutes | creates `draft` PO |
| `/po/:id` | both sides | Next step, held approvals, funding, resolution, agreement and agent runs, lines with threads, ETA and risk card, defects, documents, PayPal operations, order thread, history | every PO action below |
| `/po/:id/receive` | buyer | Upload or paste the delivery note, photos, AI proposal (unverified), counts form | receipt versions |
| `/stock` | buyer | On-hand from confirmed receipts, stock moves | none |
| `/catalog` | both | Supplier catalog; supplier edits stock and price | `products` |
| `/performance` | both | On time, fill, damage, disputes, receipt-to-agreed, invoice accuracy | none |
| `/guard` | buyer owner | Mandate text to rules, backtest, autonomy suggestions, kill switches, approvals (passkey above threshold), hash-chained audit | `policies`, `kills`, `approvals` |
| `/safety`, `/safety/model-card` | buyer owner | Browser scam model, protected mode | `settings` |
| `/ledger` | both | AG Grid ledger (orders, PayPal ops, receipts, negotiations), widgets, ask-the-ledger | none |
| `/deliveries` | both | Bryntum Scheduler board; supplier drags to set an ETA | `eta_updates` |
| `/dock`, `/driver/:token` | receiving / driver | Phone receiving PWA, arrival and tracking | documents, PayPal tracking |
| `/disputes` | supplier and buyer | PayPal disputes sync, evidence pack, balances, transaction search | dispute evidence |
| `/negotiations`, `/negotiations/:id` | both | Agent negotiation rounds | `negotiations` |
| `/traces`, `/trace/:id`, `/evidence`, `/evidence/eval` | public/signed in | Agent runs, real-vs-simulated, eval tables | none |
| `/channels` | everyone | Telegram connect, push, message simulator | `channel_links`, `messages` |
| `/demo`, `/judge` | public | Reset, fault injection, scenario, six-beat judge walk | reseeds, `demo_faults`, `judge_sessions` |
| `/llms.txt`, `/skill.md`, `/mcp` | agents | Agent instructions and MCP endpoint | via tools |

## PO state machine (`PoStatus` in `src/store.ts`)

`draft → submitted → quoted → funding → funded → (part_settling → part_delivered →) dispatched → in_review → resolving → settling → awaiting_replacement → closed`, with `exception` reachable from funding, settlement, part capture and late webhooks, and `cancelled`.

## Money movements

| Moment | PayPal call (`src/paypal/client.ts`) | Amount | Who approves | Code |
|---|---|---|---|---|
| Connect PayPal | `POST /v3/vault/setup-tokens`, buyer approves on PayPal, `POST /v3/vault/payment-tokens` | none | buyer owner on PayPal | `services/orders.ts` startConnect/completeConnect |
| Accept quote | `POST /v2/checkout/orders` intent AUTHORIZE with the vault token, then read back | quote total (Σ qty × quoted price) | buyer owner click; dry-run gate first | `acceptQuote` |
| Retry hold | same request id | same | owner | `retryHold` |
| Part delivery | `POST /v2/payments/authorizations/{id}/capture` `final_capture=false` | accepted value of part 1 | both sides agreed counts | `services/parts.ts` |
| Settle | capture with `final_capture=true`, then `GET` authorization until released | Σ accepted units × quote price − part already charged | both sides approve the same resolution hash; held for owner if above `approve_above_cents` or a safety rule fires; passkey above `SS_COUNTERSIGN_ABOVE_CENTS` | `services/settle.ts` |
| Replacement | new vaulted AUTHORIZE order, later capture | planner's chosen substitutes at catalog price | inside the same resolution approval | `settle.ts` order_replacement / authorize_replacement |
| Void | `POST …/authorizations/{id}/void` | whole hold | when a PO is cancelled or nothing accepted | `settle.ts` |
| Reauthorize | `POST …/authorizations/{id}/reauthorize` | hold amount | job after 3 days, dry-run gate | `services/reauth.ts` |
| Late defect | `POST /v2/payments/captures/{id}/refund`, spread over every capture | units × quote price | supplier agrees the claim | `services/aftercare.ts` |
| Tracking | `POST /v2/checkout/orders/{id}/track` | none | driver page | `web/dock.ts` |
| Disputes | `GET /v1/customer/disputes`, evidence upload | none | supplier | `services/disputes.ts` |
| Webhooks | `POST /v1/notifications/verify-webhook-signature`; unverified events are stored and refused | none | none; events only trigger read-back | `src/webhooks.ts` |

No call takes a payee; money goes only to the merchant behind the app's credentials.

## AI calls (`src/ai/provider.ts`, OpenAI Responses API with strict JSON schemas)

| Purpose | Model (default) | Input | Output | What code does with it |
|---|---|---|---|---|
| `extract_delivery` | `gpt-5.5` (read) | delivery note text after the instruction scan removed suspect lines | lines with quantity text, confidence, damage hints | proposal shown as "unverified"; a person types the counts; units parsed by `core/units.ts` |
| `extract_invoice` | `gpt-5.5` | invoice text after the scan | lines, total | compared only; raises `overbilled_qty`, `price_above_quote`, `not_on_po`; never paid from |
| `observe_photo` | `gpt-5.6-luna` (vision) | damage photo | damage hints | shown as hints |
| `compile_policy` | `gpt-5.5` | owner's mandate in plain words | rules JSON | validator clamps, reports what it could not express; owner adopts |
| `negotiate` | `gpt-5.4-mini` | numbers chosen by code | wording only | rejected unless the prices appear verbatim |
| `owner_question` | `gpt-5.5` | ledger rows | answer with cited rows | display only |

Money fields and PayPal ids are rejected in model output at call time. When every model fails, the provider may replay the last real answer to the identical input (labelled `replay` in the source column), then falls back to the text parser or a person.

## Message channels

Telegram (shared bot, one-time code from `/connect/telegram`; live on Render), web push (VAPID, live on Render), the in-app simulator at `/channels`, WhatsApp adapter present but removed from screens. Held captures arrive with Approve and Decline buttons; a reply runs the same `decideApproval` as the web.

## Main journey

```mermaid
sequenceDiagram
  actor J as Jordan (owner)
  actor A as Ana (supplier)
  actor S as Sam (receiving)
  participant SS as StockSure code
  participant AI as OpenAI reader
  participant PP as PayPal sandbox
  J->>PP: Connect once (Vault setup token, approve)
  J->>SS: Draft PO, limit, substitutes; send for quote
  A->>SS: Price lines (quote v1)
  J->>SS: Accept quote
  SS->>PP: AUTHORIZE vaulted order (hold = quote total)
  A->>SS: Dispatch + invoice
  SS->>AI: Invoice text (instruction lines removed)
  AI-->>SS: Lines (compare only)
  S->>SS: Delivery note
  SS->>AI: Note text
  AI-->>SS: Proposed counts (unverified)
  S->>SS: Confirms counts (receipt v1)
  A->>SS: Agrees or disputes each flagged line
  SS->>SS: Resolution = quote price × accepted units; plan replacement within limit; hash
  J->>SS: Approve resolution hash
  A->>SS: Approve same hash
  SS->>PP: Capture accepted (final_capture) — held for owner if a rule fires
  SS->>PP: Read back until the rest is released
  SS->>PP: AUTHORIZE replacement hold
  A->>SS: Dispatch replacement; S receives
  SS->>PP: Capture replacement; order closes
```
