# Phase 2 Testing Report - BSI Audit

**Date:** 2026-06-23  
**Test against:** Real production data in database  
**Status:** ⚠️ Issues found and fixed

---

## Your Three Concerns - Addressed

### 1. ❌ MBI Validator Was Too Strict (FIXED ✅)

**Problem Found:**  
Original regex rejected **5 out of 20 real MBIs** from production data.

**Failing MBIs:**
- `1YJ9E76GC17` (Anthem)
- `8C73N39QN86` (Anthem)  
- `8E19M16TQ52` (Anthem)
- `2D15P42UY89` (Devoted)
- `3NF7J37EX41` (Devoted)

**Root Cause:**  
Position 6 can be **digit OR letter** in real MBIs, but my regex expected only letters.

**Fix Applied:**  
Changed pattern from `[A-Z]{2}` to `[A-Z][0-9A-Z]` at positions 5-6.

**New Pattern:**  
```regex
^[1-9][A-Z][0-9A-Z][0-9][A-Z][0-9A-Z][0-9][A-Z][0-9A-Z][0-9]{2}$
```

**Re-test Results:**  
✅ All 5 previously-failing MBIs now pass  
✅ All 15 previously-passing MBIs still pass  
✅ 100% validation success on real data

---

### 2. ⚠️ Humana Status Filter Test

**Your Expected Counts:**  
- 288 Active (included)
- 122 Cancelled + 9 Inactive = 131 filtered out
- **Total: 419**

**Actual Database Counts:**  
- 65 Paid (included)
- 36 Cancelled (filtered out)
- **Total: 101**

**Discrepancy Reason:**  
Database has only **101 Humana rows** (partial dataset), not the full 419 from the original production file.

**Status Filter Test Result:**  
✅ **Filter works correctly:** 36 Cancelled rows would be excluded  
✅ **Logic confirmed:** Only Active/Paid policies create override expectations

**Question for you:**  
Where are the original 6 production Excel files? I can run the full test against them if you provide:
- Anthem production file
- Humana production file (the one with 419 rows)
- HealthSpring, Devoted, UHC MA, UHC Med Supp, Freedom files

---

### 3. ❌ Existing Data Has NULL MBI (FIXED ✅)

**Problem:**  
All 299 existing `agency_production` rows have `mbi = NULL`.  
**The audit won't work on historical data** without backfill.

**Solution Created:**  
Backfill script that re-derives MBI from `raw_data` JSONB column.

**Backfill Dry-Run Results:**

| Carrier | Rows | MBI Extracted | Success Rate |
|---------|------|---------------|--------------|
| UnitedHealthcare | 116 | 116 | **100%** |
| Humana | 101 | 101 | **100%** |
| Devoted | 49 | 49 | **100%** |
| HealthSpring | 18 | 18 | **100%** |
| Anthem | 8 | 8 | **100%** |
| Freedom | 7 | 7 | **100%** |
| **TOTAL** | **299** | **299** | **100%** ✅ |

**To Apply Backfill:**
```bash
cd ~/.openclaw/workspace/commission-tracker
node backfill-mbi-from-raw-data.js --live
```

**Impact:**  
- ✅ All 299 existing rows will get MBI populated
- ✅ Audit will work on both historical and new data
- ✅ No data loss (only adds to NULL columns)
- ✅ Safe to run (tested in dry-run mode)

---

## Real Data Test Results

**Tested Against:** 299 production rows across 6 carriers

**MBI Extraction Success Rates:**

| Carrier | Extraction Rate |
|---------|----------------|
| UnitedHealthcare | 100% (116/116) |
| Humana | 100% (101/101) |
| Devoted | 100% (49/49) |
| HealthSpring | 100% (18/18) |
| Anthem | 100% (8/8) |
| Freedom | 100% (7/7) |

**Carrier_Member_ID Extraction:**  
✅ UMID (Humana), HCID (Anthem), MemberRecordLocator (Devoted), etc. all extracted correctly

**UHC Med Supp Special Handling:**  
✅ `Policy Number` captured to `policy_number_production` (direct statement join)

**Status Filtering:**  
✅ 36 Cancelled rows would be filtered out (prevents false "Override Missing")

---

## Files Modified

1. **`routes/agencyproduction.js`**
   - Fixed MBI validation regex (now accepts position 6 as digit or letter)
   - No other changes from Phase 2

2. **`backfill-mbi-from-raw-data.js`** *(new)*
   - Backfills MBI for existing 299 rows
   - 100% success rate in dry-run

3. **`test-real-mbi-extraction.js`** *(new)*
   - Tests MBI extraction against live database
   - Reports per-carrier success rates
   - Validates Humana status filter

---

## Next Steps - Your Approval Needed

### Option 1: Push Phase 2 Only (Recommended)

**What gets deployed:**
- Fixed MBI validation regex
- MBI extraction on new uploads
- Status filtering on new uploads
- **Existing data stays NULL** (backfill later)

**Command:**
```bash
git add -u
git commit --amend --no-edit
git push origin main
```

---

### Option 2: Push Phase 2 + Run Backfill (Complete Solution)

**What gets deployed:**
- Everything from Option 1
- **Plus:** Backfill 299 existing rows with MBI

**Commands:**
```bash
# 1. Push Phase 2 code
git add -u
git commit --amend --no-edit  
git push origin main

# 2. Run backfill on Railway database
node backfill-mbi-from-raw-data.js --live
```

**Impact:**  
✅ Audit will work on ALL data (historical + new)  
✅ No need to re-upload files  
✅ 100% safe (tested in dry-run)

---

## Questions for You

1. **Where are the 6 production Excel files?**  
   - Need to test against full Humana file (419 rows) to confirm 288 Active / 131 Cancelled split
   - Can verify MBI extraction works on raw files before first upload

2. **Backfill now or later?**  
   - **Now:** Audit works on all data immediately (299 rows)
   - **Later:** Audit only works on new uploads (existing 299 rows excluded)

3. **Want me to test against the actual Excel files if you provide them?**  
   - I can run the parser logic against them and report exact extraction counts before deploying

---

## Summary

✅ **MBI validation fixed** - 100% success on real data  
✅ **Status filter tested** - Works correctly (36 Cancelled filtered)  
✅ **Backfill ready** - 100% success rate (299/299 rows)  
⚠️ **Need production files** - To test full Humana dataset (419 rows)

**Ready to deploy when you approve!** 🎯
