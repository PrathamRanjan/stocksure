# StockSure foundation and widening (roadmap Part B and C.2 / E.5), November 2026

- **B.1 Model path** `src/ai/provider.ts`, `src/ai/extract.ts` (delivery notes, invoices, photos; strict schemas, no money or id fields, replay cache, `ai_calls`), grounding and quarantine.
- **B.2 Traces** `src/trace.ts`; `/traces`, `/trace/:id`, `/api/v1/runs`.
- **B.3 Agents** `/mcp` for buyer and supplier agents (`ssk_` keys from `/demo`); merchant cart API under `/api/merchant`; `scripts/agent-demo.ts`; skill `skill/SKILL.md` at `/skill.md`; `/llms.txt`.
- **B.4 Adversarial / arena** `src/eval/arena.ts` (hostile agents, models and documents), `npm run eval:arena` → `eval/arena.md`.
- **B.5 Measured** `src/eval/runner.ts` three-arm receiving eval over synthetic notes from the demo catalog, `npm run eval:three-arm` → `eval/three-arm.md`; explorer `/evidence/eval` with slices and CSV.
- **B.6 Owner trust** `src/guard/` (purchasing mandate in plain words → rules, 90-day backtest, earned autonomy, dry run against live PayPal state, provenance, kill switch, passkey countersign, hash-chained audit); console `/guard`.
- **B.7 PayPal depth** authorize, partial capture, void, refund, reauthorize job, disputes with evidence packs (`/disputes`), Transaction Search and Balances, order tracking, `PayPal-Mock-Response`.
- **B.8 Channels** `src/channels/` (buyers, suppliers, drivers; simulator; web push), PWA, `/dock` receiving PWA, `/driver/:token`.
- **B.9 Structural tests** `test/structural.test.ts`.
- **B.10 Evidence and judge mode** `/evidence`, `/judge`.
- **C.2 / E.5 Counterparty** signed agreements (`src/services/agreements.ts`), negotiation rounds between buyer and supplier agents with the guard between them, the arena, `/ledger` (AG Grid tables and widgets), `/deliveries` (Bryntum board).

Simulated or not built: chat delivery without tokens; AG Studio widgets and agent (licence); per-judge isolation; WebAuthn attestation. Three-arm numbers are a regression suite on synthetic notes, not an independent benchmark.
