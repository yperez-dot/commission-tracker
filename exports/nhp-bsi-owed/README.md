# NHP → BSI Owed Report

Generated: 2026-08-13T23:15:33.401Z

## Bottom line
- **Recommended cash still owed to BSI:** $8,246.63
  - OliComm expected BSI share **$28,220.64**
  - Minus your paid paste Override $ **$19,974.01** (220 sales)
- **Unsettled sales still needing a remittance line:** **829** (engine BSI share $19,152.48; mostly **202601 Doctors**)

Do not add unsettled BSI on top of the recommended cash figure — the cash figure already nets total expected vs what you remitted.

## Rule
MA NHP agency overrides with effective date ≥ 2025-09-01 → BSI gets 50% (after Christian/Horacio peel when applicable). ACA does not split.

## Files
- `NHP_BSI_Owed_Report.xlsx`
- `NHP_BSI_Still_Owed_Detail.csv`
- `NHP_Paid_to_BSI_User_Paste.tsv`

Regenerate:
```
node scripts/build-nhp-bsi-owed-report.js --paid exports/nhp-bsi-owed/NHP_Paid_to_BSI_User_Paste.tsv --out exports/nhp-bsi-owed
```
