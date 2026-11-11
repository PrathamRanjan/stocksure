# Calibration: changed_payment_details

Generated 2026-11-11T00:49:48.501Z by `npx tsx scripts/calibrate.ts changed_payment_details` on gpt-6-luna (OpenAI Decisions). Cost about $0.01259 for all questions together.

Labelled set: `src/eval/scam-cases.ts` (66 author-written messages; synthetic). Tuning half 33 cases (17 positive); held-out half 33 (17 positive).

Cost of a miss = 10 false holds.

| | Value |
|---|---|
| clear_below | 0.25 |
| hold_above | 0.5 |
| Held-out precision at hold | 94% |
| Held-out recall at hold | 100% |
| Held-out positives at or above clear_below | 100% |
| Held-out confusion (tp / fp / fn / tn) | 17 / 1 / 0 / 15 |

## Every case

| Case | Split | Label | Probability |
|---|---|---|---:|
| ten-nov | held_out | yes | 1.00 |
| bank-change-1 | tune | yes | 1.00 |
| bank-change-2 | held_out | yes | 1.00 |
| bank-change-3 | tune | yes | 1.00 |
| bank-change-4 | held_out | yes | 1.00 |
| bank-change-5 | tune | yes | 1.00 |
| bank-change-6 | held_out | yes | 1.00 |
| bank-change-7 | tune | yes | 1.00 |
| bank-change-8 | held_out | yes | 1.00 |
| bank-change-9 | tune | yes | 1.00 |
| bank-change-10 | held_out | yes | 1.00 |
| bank-change-11 | tune | yes | 1.00 |
| bank-change-12 | held_out | yes | 1.00 |
| bank-change-13 | tune | yes | 1.00 |
| bank-change-14 | held_out | yes | 1.00 |
| bank-change-15 | tune | yes | 1.00 |
| bank-change-16 | held_out | yes | 1.00 |
| bank-change-17 | tune | yes | 1.00 |
| bank-change-18 | held_out | yes | 1.00 |
| bank-change-19 | tune | yes | 1.00 |
| bank-change-20 | held_out | yes | 1.00 |
| bank-change-21 | tune | yes | 1.00 |
| bank-change-22 | held_out | yes | 1.00 |
| bank-change-23 | tune | yes | 1.00 |
| bank-change-24 | held_out | yes | 1.00 |
| bank-change-25 | tune | yes | 1.00 |
| bank-change-26 | held_out | yes | 1.00 |
| bank-change-27 | tune | yes | 1.00 |
| bank-change-28 | held_out | yes | 1.00 |
| bank-change-29 | tune | yes | 1.00 |
| bank-change-30 | held_out | yes | 1.00 |
| genuine-1 | tune | no | 0.00 |
| genuine-2 | held_out | no | 0.00 |
| genuine-3 | tune | no | 0.00 |
| genuine-4 | held_out | no | 0.00 |
| genuine-5 | tune | no | 0.00 |
| genuine-6 | held_out | no | 0.00 |
| genuine-7 | tune | no | 0.00 |
| genuine-8 | held_out | no | 0.00 |
| genuine-9 | tune | no | 0.00 |
| genuine-10 | held_out | no | 0.00 |
| genuine-11 | tune | no | 0.00 |
| genuine-12 | held_out | no | 0.00 |
| genuine-13 | tune | no | 0.00 |
| genuine-14 | held_out | no | 0.00 |
| genuine-15 | tune | no | 0.00 |
| genuine-16 | held_out | no | 0.00 |
| genuine-17 | tune | no | 0.00 |
| genuine-18 | held_out | no | 0.00 |
| genuine-19 | tune | no | 0.00 |
| genuine-20 | held_out | no | 0.00 |
| genuine-21 | tune | no | 0.00 |
| genuine-22 | held_out | no | 0.00 |
| genuine-23 | tune | no | 0.00 |
| genuine-24 | held_out | no | 0.00 |
| genuine-25 | tune | no | 0.00 |
| other-1 | tune | no | 0.00 |
| other-2 | held_out | no | 0.00 |
| other-3 | tune | yes | 1.00 |
| other-4 | held_out | no | 0.00 |
| other-5 | tune | no | 0.00 |
| other-6 | held_out | yes | 1.00 |
| other-7 | tune | no | 0.00 |
| other-8 | held_out | no | 0.89 |
| other-9 | tune | yes | 1.00 |
| other-10 | held_out | no | 0.01 |
