# THEI Override Statements — January–July 2026

Payable = `thei_share` on:
- Agency Override rows (house 50/50 with BSI)
- Alba/Lina rate-peeled production shares

Lina agent commissions are **not** on these files (see `exports/lina-statements-jan-jul-2026`).

| Period | THEI lines | THEI Balance |
|--------|----------:|-------------:|
| 202601 | 1627 | $42,567.99 |
| 202602 | 455 | $4,125.22 |
| 202603 | 71 | $1,583.96 |
| 202604 | 81 | $1,878.91 |
| 202605 | 292 | $3,497.65 |
| 202606 | 319 | $3,109.68 |
| 202607 | 141 | $4,643.17 |

BSI twin files (`BSI_Override_Statement_YYYYMM.xlsx`) are included for the 50/50 pair.

Historical months may be messy — reconcile before paying. Going forward, BSI upload rate peel + Agency Override rows feed these statements.

Regenerate: `node scripts/generate-thei-override-statements.js --also-bsi --out exports/thei-override-statements-jan-jul-2026`
