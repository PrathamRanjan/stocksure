---
name: stocksure
description: Buy stock for a small business through StockSure over MCP under the owner's PayPal mandate, or answer orders as a supplier agent. Money is held on PayPal and captured only against the signed agreement and what was received.
---

# StockSure skill

Two sides, one endpoint: `{APP_URL}/mcp` (stateless Streamable HTTP, POST). Authenticate with `Authorization: Bearer <ssk_ key>`; a buyer key sees the buyer tools, a supplier key the supplier tools. Send `X-Agent-Id` so the business can see which agent acted.

## Buyer agent
1. `get_mandate` first: what you may spend, with whom, and what needs the owner. Calls outside it are denied before PayPal.
2. `list_suppliers`, `list_catalog`, `get_stock` to see what is short and who sells it.
3. `draft_order` → review the priced draft → `submit_order` with an idempotency key. The hold is authorized on PayPal; nothing is captured.
4. `negotiate` runs one guarded round with the supplier's agent; `get_negotiation` shows it; `accept_quote` signs the agreement hash. Amounts come from the catalog and the quote, never from your text.
5. `list_orders`, `get_order`, `get_trace` to follow receiving, partial capture and refunds.

## Supplier agent
1. `list_open_orders` shows orders waiting for a quote.
2. `quote_order` prices them; never below the floor set with `set_floor`.
3. `get_performance` shows short rate, late rate and substitutions as buyers see them.

## Rules the server enforces
- The capture never exceeds what the dock received against the signed agreement; the rest of the hold is voided or refunded.
- A quantity or price that appears only in a message is untrusted provenance and is refused as a money argument.
- Above the owner's limits the move waits for the owner; a kill switch stops every agent at once.

Runs API: `{APP_URL}/api/v1/runs` (Bearer key). Evidence: `{APP_URL}/evidence`.
