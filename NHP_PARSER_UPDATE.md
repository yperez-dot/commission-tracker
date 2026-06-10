# NHP Parser Update - ACA & Christian/Horacio Logic

## Changes Needed

### 1. ACA Payment Structure (LOB = "ACA")
**Current problem:** Uses carrier name matching, not LOB column
**Fix:** Use LOB column to identify ACA

**Payment rules:**
- `Comm Class = "Commission"` or `Type` contains "commission" → `producerPayable` (agent gets 100%)
- `Comm Class = "Override"` or `Type` contains "override" → `theiShare` (THEI keeps 100%)
- No BSI split for ACA regardless of effective date

### 2. Medicare Payment Structure (LOB = "MA" or blank)
**Effective date matters:**
- **Before 9/1/2025:** THEI keeps 100% (no BSI split)
- **9/1/2025 or later:** 50/50 BSI split

**Exception: Christian Munoz & Horacio Mendieta**
- Carriers: Doctors HealthCare, Solis, HealthSun
- New Business ONLY (not renewals)
- Fixed payments:
  - Doctors: $50 per app
  - Solis: $62.50 per app
  - HealthSun: $52.50 per app
- Deducted from gross override BEFORE 50/50 split

### 3. Database Schema
Already has these columns (confirmed):
- `lob` TEXT
- `gross_commission` NUMERIC
- `thei_share` NUMERIC
- `bsi_share` NUMERIC
- `producer_payable` NUMERIC
- `split_applies` BOOLEAN

Need to add (if not exists):
- `sub_agent_override` NUMERIC (for Christian/Horacio fixed payments)
- `commission_type` TEXT (to distinguish "Commission" vs "Override" for ACA)

### 4. New Reports Needed

#### A. ACA Agent Payment Report
Shows per agent:
```
Agent Name | Commission Total | Status
-----------+------------------+---------
Patsy Pernia | $567.00 | Payable
Yahoska Perez | $234.00 | Payable
```

#### B. Sub-Agent Override Payment Report  
Shows Christian/Horacio:
```
Agent | Carrier | Apps | Rate | Total
------+---------+------+------+-------
Christian Munoz | Doctors | 5 | $50 | $250
Horacio Mendieta | Solis | 3 | $62.50 | $187.50
```

#### C. Enhanced BSI Payment Statement
```
NHP Override - May 2026
━━━━━━━━━━━━━━━━━━━━━━━━━
Gross Override:           $10,000.00
  Less: Pre-9/1/2025:       -$500.00
  Less: Sub-Agent OV:       -$437.50
                          ──────────
Net Override to Split:     $9,062.50
  BSI Share (50%):          $4,531.25
  THEI Share (50%):         $4,531.25
```

## Implementation Plan

1. ✅ Update `parseNHPRows()` function
2. ✅ Add Christian/Horacio detection logic
3. ✅ Create ACA payment report endpoint
4. ✅ Create sub-agent override report endpoint
5. ✅ Enhance Agency Override Recon page with deductions display
6. ✅ Test with current NHP statement
7. ✅ Deploy to Railway + Netlify

---

**Status:** Ready to code
**ETA:** 2-3 hours
