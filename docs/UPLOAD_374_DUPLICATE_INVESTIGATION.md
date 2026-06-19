# Upload 374 Duplicate Investigation

## Problem
Upload 374 created 330 duplicate records where the same client+carrier+period+classification appears multiple times.

## Root Cause Analysis

### Issue: No Within-Batch Duplicate Detection

**Current duplicate detection (`findDuplicates()`):**
- Checks new records against EXISTING database records
- Does NOT check for duplicates WITHIN the current upload batch
- Match key: `client + carrier + effective_date + payment_period + classification`

**Scenario that causes duplicates:**
1. NHP Excel file contains the same record twice (or parser reads same row multiple times)
2. Parser creates 2 identical record objects
3. `findDuplicates()` checks against database (no existing match)
4. Both records pass validation
5. Both get inserted → database now has duplicates

### NHP Parser Analysis

**Code location:** `routes/files.js` line 1197 - `parseNHPRows()`

**Potential issues:**
1. **Column shift logic:** NHP files have inconsistent alignment when LOB is blank
   - Parser applies `shift = hasLOB ? 0 : -1`
   - If shift logic is wrong, same row could be parsed twice with different values
   - Example: Row 5 parsed as LOB="MA" + correct data, then again as LOB="" + shifted data

2. **Header detection:** Parser searches for "override" header within first 20 rows
   - If multiple "override" cells exist, could process same section twice
   - Current code breaks after first match (should be safe)

3. **Row iteration:** Parser uses `rows.slice(1)` after finding header
   - Should only process each row once
   - No obvious loop duplication

**Likely cause:**
- NHP Excel file itself contains duplicate rows (human error or carrier export bug)
- Parser is working correctly but source file has duplicates

### Duplicate Detection Gap

**Missing safeguard:**
```javascript
// After parsing, BEFORE checking database duplicates
const internalDuplicates = findInternalDuplicates(records);
if (internalDuplicates.length > 0) {
  // Alert user: "This file contains X duplicate records internally"
  // Show preview + allow skip/abort
}
```

## Solution

### 1. Add Within-Batch Duplicate Detection

**New function:** `findInternalDuplicates(records)`
- Checks for duplicates WITHIN the parsed records array
- Same match key as `findDuplicates()`: client+carrier+date+period+classification
- Runs BEFORE database duplicate check

**Integration:**
- Upload route calls after parsing: `const internalDups = findInternalDuplicates(records);`
- If found: Return 409 with warning before ANY insertion
- User can review and choose to skip duplicates

### 2. Investigation Steps for Upload 374

**To determine root cause:**
1. Check upload 374 filename: `SELECT original_name FROM uploads WHERE id = 374;`
2. Get the original NHP file (if still available)
3. Open Excel and check if rows are actually duplicated
4. If not duplicated in Excel: Parser bug (column shift or header detection)
5. If duplicated in Excel: Carrier export issue or manual paste error

**SQL to identify duplicate patterns:**
```sql
SELECT 
  client_full_name,
  carrier,
  payment_period,
  classification,
  COUNT(*) as occurrences,
  ARRAY_AGG(id ORDER BY id) as record_ids,
  ARRAY_AGG(commission ORDER BY id) as commission_amounts
FROM commission_records
WHERE upload_id = 374
GROUP BY client_full_name, carrier, payment_period, classification
HAVING COUNT(*) > 1
ORDER BY COUNT(*) DESC;
```

### 3. Cleanup Process

**Option A: API endpoint (temporary)**
- `DELETE /api/admin/cleanup-upload-374`
- Removes duplicates (keeps first occurrence by ID)
- Logs count of deleted records
- Remove endpoint after running once

**Option B: SQL script**
- `scripts/cleanup-upload-374-duplicates.sql`
- 4-step process: preview, count, delete, verify
- Run manually in Railway PostgreSQL console

### 4. Prevention (Future Uploads)

**Post-upload duplicate check:**
```javascript
// After ALL records inserted
const postUploadDuplicates = await checkPostUploadDuplicates(pool, uploadId);
if (postUploadDuplicates.length > 0) {
  // Log warning
  console.warn(`[UPLOAD] WARNING: ${postUploadDuplicates.length} internal duplicates detected in upload ${uploadId}`);
  // Could auto-cleanup or alert admin
}
```

## Recommended Actions

1. ✅ Add `findInternalDuplicates()` function to `routes/files.js`
2. ✅ Integrate into upload route (before DB duplicate check)
3. ✅ Create cleanup endpoint for upload 374
4. ✅ Add SQL cleanup script as backup
5. ⏳ Test with problematic NHP files
6. ⏳ If issue persists, add debug logging to NHP parser

## Files Modified

- `routes/files.js` - Add within-batch duplicate detection
- `server.js` - Add temporary cleanup endpoint
- `scripts/cleanup-upload-374-duplicates.sql` - Manual cleanup option
- `docs/UPLOAD_374_DUPLICATE_INVESTIGATION.md` - This file

---
**Investigation Date:** 2026-06-19  
**Status:** Solution implemented, awaiting testing
