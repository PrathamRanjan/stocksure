# StockSure design brief

## Who it's for

An owner reading on a phone between jobs, and a receiver at the back door with wet hands and a pallet in front of them. Every screen answers three questions: what happened, what needs me, and what happens next.

## Three directions

| | A. Docket | B. Cold chain | C. Chalkboard |
|---|---|---|---|
| Mood | The carbon-copy delivery docket: warm paper, black ink, rubber stamps | A refrigerated warehouse: ice white, steel, safety orange | The café menu board: dark slate, chalk hand |
| Palette | Paper `#F4EFE4`, ink `#1B1A16`, carbon blue `#2A3F8F`, stamp red and green | `#F7FAFC`, steel greys, orange `#E5541B` | Slate `#22262A`, chalk white, pastel accents |
| Type | Archivo (expanded weights for headings), Source Sans 3 text | A neo-grotesk | A hand display face with a grotesk |
| Signature motif | **Tally strip**: each line drawn as one mark per case. Received, damaged and short read at a glance. Money states shown as stamps: HELD, CAPTURED, RELEASED, REFUNDED. | Temperature-style gauges | Hand-lettered totals |
| References outside fintech | Shipping manifests, Muji receipts, Swiss rail timetables | Lab equipment UI | Menu boards |
| Fit with the brief (out of 5) | Domain 5, trust 5, legibility 5, distinct from rivals 5 | 3, 4, 4, 2 (still too close to SaaS) | 3, 2, 2, 4 (hard to read, wrong for money) |

**Chosen: A, Docket.** The product's whole argument is "the docket and the money agree". Paper and ink make that literal. Stamps are already how kitchens mark goods-in, so money states read as an operational fact, not a fintech badge. Warm paper is also unlike every competitor's cool SaaS blue.

## Signature element

**The tally strip.** For every order line, one mark per pack is drawn: ink for accepted, red strike for damaged, hollow for short or wrong. A "20 ordered, 18 accepted, 2 crushed" line reads in half a second without numbers. It sits next to the numbers, never instead of them, and it has a text alternative. It appears on the landing preview, the receive screen, the order page and the resolution.

**The settlement bar** follows the same grammar for money. The spend limit is split into captured, still held, released (expected, hatched), credited and headroom. Each segment is labelled with tabular figures.

**Stamps** mark PayPal states: `HELD` (amber outline), `CAPTURED` (ink-green fill), `RELEASED` (slate outline), `REFUNDED` (blue), `HELD FOR YOU` (vermilion). They're rotated −2°, and flat when motion is reduced.

## Typography

- Display: **Archivo Variable** (wdth 100–125, wght 600–800) for headings, numbers in KPIs and stamps.
- Text: **Source Sans 3 Variable** for everything else. Both are OFL, self-hosted through Fontsource.
- Money, dates, counts and statuses use `font-variant-numeric: tabular-nums` (`.num`). IDs use `ui-monospace`.
- Scale (rem): 0.8125 / 0.875 / 1 / 1.125 / 1.375 / 1.75 / 2.25 / 3.25 (landing hero 2.6–4.2 clamp). Body is 16 px at 1.5. Lines are capped at 68ch.
- Weights: text 400/600, display 700/800.

## Tokens

| Token | Light | Dark | Contrast on bg |
|---|---|---|---|
| `--paper` (bg) | `#F4EFE4` | `#14130F` | — |
| `--card` | `#FFFCF5` | `#1D1C17` | — |
| `--ink` (fg) | `#1B1A16` | `#F2EDE1` | 15.6:1 / 15.1:1 |
| `--ink-2` (muted) | `#5A564C` | `#B3AD9F` | 6.4:1 / 7.9:1 |
| `--rule` | `#D9D1BF` | `#34322A` | decorative |
| `--carbon` (primary accent, links) | `#2A3F8F` | `#9DB0F2` | 8.3:1 / 8.6:1 |
| `--held` | `#8A5300` | `#F0B45A` | 5.6:1 / 9.3:1 |
| `--paid` | `#1D6B3B` | `#7FCF98` | 5.9:1 / 9.6:1 |
| `--stop` | `#B0261C` | `#FF8A7A` | 5.8:1 / 7.4:1 |
| `--released` | `#5A5F6B` | `#A9AFBC` | 5.6:1 / 7.7:1 |

All text pairs meet WCAG 2.2 AA (4.5:1). Large display text is above 7:1. Ratios were checked with the script in `web/scripts/contrast.mjs`.

- Radius: 4 px controls, 6 px cards (paper is square-ish). Pills are 999 px.
- Spacing: 4 px base; card padding 16 (mobile) / 24 (desktop).
- Elevation: none by default. Cards use a 1 px rule. Raised overlays use `0 1px 0 rule, 0 8px 24px rgb(27 26 22 / .10)`.
- Motion: 120 ms (press), 180 ms (stamp), 240 ms (sheet). Easing `cubic-bezier(.2,.7,.2,1)`. With `prefers-reduced-motion` or the in-app "Stop all motion" setting, every transition is 0 ms and stamps don't rotate in.

## Rules

- No gradients, glass, emoji icons, fake stats or logos. Icons are Lucide line icons.
- Magic UI / Aceternity effects appear only on the landing hero and empty states, never next to an approval or an amount.
- Money approvals always show what moves, to whom, why, and how to undo it, with the PayPal status and a timeline.
- The demo ribbon is a thin docket strip at the top. It says which parts are live sandbox and which are simulated, with Reset and Take the tour.
