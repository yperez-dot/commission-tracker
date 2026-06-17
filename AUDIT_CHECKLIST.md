# OliComm Parser & Feature Audit Checklist

Run through each item below and report back: ✅ or ❌ with notes.

**DO NOT FIX ANYTHING YET — AUDIT FIRST.**

---

## 1. Parser Inventory

List every parser function currently in `files.js` and confirm:
- [ ] Each parser has a matching detection function (`is*File`)
- [ ] No two detection functions match the same filename pattern
- [ ] List all parser/detection pairs found

**Expected parsers:**
- parseTHEStatementPDF / isTHEStatementPDF
- parseBSIConsolidatedPDF / isBSIConsolidatedPDF
- parseBSIPDF / isBSIPDF
- parseHealthSunRows / isHealthSunFile
- parseSolisRows / isSolisFile + isDoctorsFile
- parseAPLRows / isAPLFile
- parseNHPRows / isNHPFile
- parseAetnaRows / isAetnaFile
- parseMutualOmahaPDF / isMutualOmahaPDF
- parseYourFMORows / isYourFMOFile
- parseHumanaRows / isHumanaFile
- parseDevotedRows / isDevotedFile
- parseMOOExcel / isMOOExcel

---

## 2. THE Statement Parser Test

**Upload:** `Medicare_Statement-THE-April (3).pdf`

**Expected Railway logs:**
```
[THE] parsed 340 records: { UnitedHealthcare: 165, Humana: 142, Aetna: 33 }
```

**Result:** ✅ or ❌

---

## 3. BSI Consolidated Parser Test (Large Statement)

**Upload:** `Statement-health_experts (2).pdf`

**Expected Railway logs:**
```
[BSI-CONSOLIDATED] parsed 1014 records: { UnitedHealthcare: 465, Devoted: 19, Humana: 426, Aetna: 102 }
```

**Result:** ✅ or ❌

---

## 4. BSI March Parser Test

**Upload:** `Health_Experts-March.pdf`

**Expected Railway logs:**
```
[BSI-CONSOLIDATED] parsed 140 records: { UnitedHealthcare: 57, Humana: 64, Aetna: 19 }
```

**Result:** ✅ or ❌

---

## 5. THE March Parser Test

**Upload:** `Medicare_Statement_-THE-March_(2).pdf`

**Expected Railway logs:**
```
[BSI-CONSOLIDATED] parsed 141 records: { UnitedHealthcare: 57, Humana: 64, Aetna: 20 }
```

**Note:** This file uses BSI consolidated parser with THE payee

**Result:** ✅ or ❌

---

## 6. HealthSun Parser Test

**Upload:** `Commission_Report.csv`

**Expected results:**
- [ ] 115 records imported
- [ ] Total: $3,666.72
- [ ] All periods show as YYYYMM format (e.g., `202605`, NOT `Unknown`)
- [ ] All effective dates show as MM/DD/YYYY (e.g., `01/01/2026`, NOT serial numbers like `44136`)

**Result:** ✅ or ❌

**If periods show "Unknown":** The parser needs to handle Excel serial dates in Compensation Month column.

**If effective dates show as serial numbers:** The parser needs to use `formatDate()` or convert Excel serial dates.

---

## 7. Duplicate Detection Test

**Upload:** Any statement file that's already been uploaded to the DB (e.g., re-upload `Medicare_Statement-THE-April (3).pdf`)

**Expected behavior:**
- [ ] API returns status `409` (not 200 or 500)
- [ ] Response body has `duplicateWarning: true`
- [ ] Response has `duplicateCount` and `totalCount` fields
- [ ] `duplicates` array contains objects with: `client`, `carrier`, `date`, `amount`, `agent`, `period`, `type`
- [ ] Frontend modal appears showing duplicate rows
- [ ] Modal has checkboxes per row
- [ ] Modal has "Import X records" button with live count
- [ ] Selecting rows and clicking Import re-submits with `skipDuplicates=true` and `selectedDuplicates=[...]`

**Result:** ✅ or ❌

---

## 8. Debug Logs Cleanup Check

Search `routes/files.js` for any remaining debug logs with these prefixes:

```bash
grep -E "\[THE\]|\[THE-DEBUG\]|\[THE-LINES\]|\[THE-HUMANA\]|\[UHC-MISS\]|\[HUMANA-MISS\]|\[BSI-LINES\]|\[BSI-BALANCE\]|\[BSI-HUMANA\]|\[BSI-AETNA\]" routes/files.js
```

**Expected result:** Only production logs should remain:
- `[THE] parsed X records:` ✅ (production log)
- `[BSI-CONSOLIDATED] parsed X records:` ✅ (production log)

**All debug logs should be removed:**
- `[THE-DEBUG]`, `[THE-LINES]`, `[THE-HUMANA]` ❌
- `[UHC-MISS]`, `[HUMANA-MISS]`, `[HUMANA-MISS-NEXT]` ❌
- `[BSI-LINES]`, `[BSI-BALANCE-IDX]`, `[BSI-HUMANA-START]` ❌
- `[BSI-AETNA]`, `[BSI-AETNA-LINES]`, `[BSI-DEDUCTIONS]` ❌

**Result:** ✅ or ❌

---

## 9. isBSIPDF Routing Check

**Verify** that `isBSIPDF()` function:
- [ ] Does NOT match `medicare_statement-the` patterns
- [ ] Does NOT match `medicare_statement_the` patterns
- [ ] Does NOT match `medicare_statement_-the-` patterns
- [ ] ONLY matches: `bsi`, `broker_society`, `brokersociety`

**Check the code:**
```javascript
function isBSIPDF(filename) {
  const f = filename.toLowerCase().replace(/\s+/g, '_');
  if (!f.endsWith('.pdf')) return false;
  // Exclude THE upline statements — those have their own parser
  if (isTHEStatementPDF(filename)) return false;
  return f.includes('bsi') ||
         f.includes('broker_society') ||
         f.includes('brokersociety');
}
```

**Result:** ✅ or ❌

---

## 10. Agent Name Normalization Check

Spot check these agents appear consistently across uploads (no duplicates from name variations):

**Test queries:**
```sql
-- Check Katy variations
SELECT DISTINCT agent_name 
FROM commission_records 
WHERE agent_name ILIKE '%katy%robles%' 
ORDER BY agent_name;

-- Check Yahoska variations
SELECT DISTINCT agent_name 
FROM commission_records 
WHERE agent_name ILIKE '%yahoska%' 
ORDER BY agent_name;

-- Check Edgar variations
SELECT DISTINCT agent_name 
FROM commission_records 
WHERE agent_name ILIKE '%edgar%piloto%' 
ORDER BY agent_name;
```

**Expected results:**
- Katy Robles / Katy Jullie Robles → Should normalize to ONE name
- Yahoska Perez / Yahoska G Perez → Should normalize to ONE name
- Edgar Piloto / Mr. Edgar Piloto → Should normalize to ONE name

**Actual results:**
- Katy: _______________
- Yahoska: _______________
- Edgar: _______________

**Result:** ✅ or ❌

---

## Summary

**Total checks:** 10  
**Passed:** _____  
**Failed:** _____

**Issues found:**
1. 
2. 
3. 

**Notes:**

