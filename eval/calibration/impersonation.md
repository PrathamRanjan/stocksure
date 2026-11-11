# Calibration: impersonation

Generated 2026-11-11T13:39:35.291Z by `npx tsx scripts/calibrate.ts impersonation` on gpt-6-luna (OpenAI Decisions). Cost about $0.01276 for all questions together.

Labelled set: `src/eval/scam-cases.ts` (66 author-written messages; synthetic). Tuning half 33 cases (20 positive); held-out half 33 (21 positive).

Cost of a miss = 10 false holds.

| | Value |
|---|---|
| clear_below | 0.25 |
| hold_above | 0.5 |
| Held-out precision at hold | 95% |
| Held-out recall at hold | 100% |
| Held-out positives at or above clear_below | 100% |
| Held-out confusion (tp / fp / fn / tn) | 21 / 1 / 0 / 11 |

## Every case

| Case | Split | Label | Probability |
|---|---|---|---:|
| ten-nov | held_out | yes | 0.91 |
| bank-change-1 | tune | yes | 0.89 |
| bank-change-2 | held_out | yes | 0.95 |
| bank-change-3 | tune | yes | 0.95 |
| bank-change-4 | held_out | yes | 0.96 |
| bank-change-5 | tune | yes | 0.95 |
| bank-change-6 | held_out | yes | 0.93 |
| bank-change-7 | tune | yes | 0.92 |
| bank-change-8 | held_out | yes | 0.93 |
| bank-change-9 | tune | yes | 0.83 |
| bank-change-10 | held_out | yes | 0.89 |
| bank-change-11 | tune | yes | 0.95 |
| bank-change-12 | held_out | yes | 0.95 |
| bank-change-13 | tune | yes | 0.94 |
| bank-change-14 | held_out | yes | 0.95 |
| bank-change-15 | tune | yes | 0.95 |
| bank-change-16 | held_out | yes | 0.93 |
| bank-change-17 | tune | yes | 0.95 |
| bank-change-18 | held_out | yes | 0.89 |
| bank-change-19 | tune | yes | 0.94 |
| bank-change-20 | held_out | yes | 0.95 |
| bank-change-21 | tune | yes | 0.95 |
| bank-change-22 | held_out | yes | 0.94 |
| bank-change-23 | tune | yes | 0.95 |
| bank-change-24 | held_out | yes | 0.92 |
| bank-change-25 | tune | yes | 0.96 |
| bank-change-26 | held_out | yes | 0.95 |
| bank-change-27 | tune | yes | 0.80 |
| bank-change-28 | held_out | yes | 0.95 |
| bank-change-29 | tune | yes | 0.97 |
| bank-change-30 | held_out | yes | 0.96 |
| genuine-1 | tune | no | 0.05 |
| genuine-2 | held_out | no | 0.00 |
| genuine-3 | tune | no | 0.08 |
| genuine-4 | held_out | no | 0.13 |
| genuine-5 | tune | no | 0.22 |
| genuine-6 | held_out | no | 0.03 |
| genuine-7 | tune | no | 0.01 |
| genuine-8 | held_out | no | 0.06 |
| genuine-9 | tune | no | 0.07 |
| genuine-10 | held_out | no | 0.01 |
| genuine-11 | tune | no | 0.11 |
| genuine-12 | held_out | no | 0.08 |
| genuine-13 | tune | no | 0.06 |
| genuine-14 | held_out | no | 0.35 |
| genuine-15 | tune | no | 0.11 |
| genuine-16 | held_out | no | 0.64 |
| genuine-17 | tune | no | 0.01 |
| genuine-18 | held_out | no | 0.11 |
| genuine-19 | tune | no | 0.05 |
| genuine-20 | held_out | no | 0.02 |
| genuine-21 | tune | no | 0.17 |
| genuine-22 | held_out | no | 0.09 |
| genuine-23 | tune | no | 0.81 |
| genuine-24 | held_out | no | 0.03 |
| genuine-25 | tune | no | 0.12 |
| other-1 | tune | yes | 0.98 |
| other-2 | held_out | yes | 1.00 |
| other-3 | tune | yes | 0.95 |
| other-4 | held_out | yes | 0.95 |
| other-5 | tune | yes | 1.00 |
| other-6 | held_out | yes | 0.91 |
| other-7 | tune | yes | 0.95 |
| other-8 | held_out | yes | 0.96 |
| other-9 | tune | yes | 0.98 |
| other-10 | held_out | yes | 0.96 |
