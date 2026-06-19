# BOB Name Cleanup Script

Fixes BOB client names that don't match commission_records format.

## Problem

Humana/BSI parser stores client names as "Last, First" but BOB entries may have "First Last" format. This causes BOB clients to show $0 commission even when they have payments in commission_records.

## Solution

This script:
1. Finds all BOB clients where `last_commission_amount = 0`
2. Searches commission_records for fuzzy name matches (same carrier + agent)
3. Updates BOB `client_full_name` to match commission_records format
4. **Automatically recalculates `last_commission_amount` and `last_commission_date`** for updated clients
5. Logs all changes with policy numbers for verification

## Usage

### Dry run (preview changes, no database updates):
```bash
node scripts/cleanup-bob-names.js
```

### Apply changes to database:
```bash
node scripts/cleanup-bob-names.js --apply
```

### Filter by carrier:
```bash
node scripts/cleanup-bob-names.js --carrier=Humana
node scripts/cleanup-bob-names.js --carrier=Humana --apply
```

## Match Types

1. **Exact match**: Name matches exactly (case-insensitive)
2. **Reversed match**: "First Last" ↔ "Last, First" conversion
3. **Fuzzy match**: Levenshtein distance < 20% (e.g., typos, middle initials)

## Example Output

```
🔍 BOB Name Cleanup Script

Mode: 🔎 DRY RUN (no changes)

Found 47 BOB clients with $0 commission

Checking: "John Smith" (Humana, Yahoska Perez)
  ✓ Found: "Smith, John" in commission_records
    Policy: H9UY3E86YV04
    Commission: $28.92
    Match type: reversed
    UPDATE: "John Smith" → "Smith, John"

Checking: "Maria Garcia" (UnitedHealthcare, Katy Robles)
  ✗ No match found in commission_records

============================================================
RECALCULATING COMMISSION AMOUNTS
============================================================
Updating last_commission_amount and last_commission_date...

✓ Recalculated commission amounts for 32 clients

============================================================
SUMMARY
============================================================
Total clients checked: 47
Matches found: 32
No matches: 15
Names updated: 32

✅ Changes applied to database
✅ Commission amounts recalculated for updated clients
```

## Safety Features

- **Dry run by default** - Must explicitly use `--apply` to modify database
- **Matches by carrier + agent** - Ensures correct client context
- **Only updates active clients** - Leaves termed/deceased clients untouched
- **Only updates clients with $0 commission** - Prevents overwriting valid data
- **Detailed logging** - Every change shows old/new name + policy number
- **Automatic commission recalculation** - After name updates, automatically updates `last_commission_amount` and `last_commission_date` from commission_records

## When to Run

- After importing Humana/BSI statements
- After uploading new BOB exports
- When BOB shows "Never paid" clients that actually have commissions
- As part of monthly data cleanup routine

## Requirements

- PostgreSQL connection via `DATABASE_URL` environment variable
- Node.js with pg package installed

## Author

Igor (AI Agent) - 2026-06-19
