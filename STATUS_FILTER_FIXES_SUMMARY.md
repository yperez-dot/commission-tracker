# Status Filter & Production Upload Fixes - Summary

**Date:** 2026-06-23 19:20 ET  
**Requested by:** Yahoska  
**Completed by:** Igor

---

## ✅ #1: Status Filter Re-Run on January Files

**Corrected column mappings + validated counts:**

| Carrier | Column | Keep | Drop | Total | Status |
|---------|--------|------|------|-------|--------|
| **UHC MA (Jan)** | `Consumer_Status` (=ACTIVE) | **287** | **137** | 424 | ✅ PERFECT MATCH |
| **HealthSpring (Dec)** | `Status` (Enrolled) | **6** | **8** | 14 | ✅ PERFECT MATCH |
| **Freedom (May)** | `POLICY_STATUS` (CMS Accepted) | **6** | **1** | 7 | ⚠️ Off by 1 row (expected 8 total) |
| **Devoted (May)** | `Status` (Enrolled) | **18** | **32** | 50 | ⚠️ Different file version (expected 47 total) |

**UHC MA Breakdown (287 keep / 137 drop):**
- ✅ ACTIVE: 287 (KEPT)
- ❌ NEVER ACTIVE: 33 (DROPPED - completed app, never enrolled)
- ❌ DER - VOLUNTARY: 18 (DROPPED - disenrolled)
- ❌ NA: 27 (DROPPED - not active)
- ❌ (blank): 59 (DROPPED)

**Key Finding:** Using `App_Status=COMPLETED` would have incorrectly counted 382 keep (including 95 dead policies). Using `Consumer_Status=ACTIVE` correctly identifies 287 actual active members.

**Impact:** Prevents 95 false "Override Missing" flags for completed-but-never-active policies.

---

## ✅ #2: Whitelist Additions

**Added carrier-specific "active" statuses:**

```javascript
const keepStatuses = [
  'ACTIVE',         // UHC Consumer_Status, Humana, most carriers
  'ACTIVE POLICY',  // Humana
  'FUTURE ACTIVE',  // Aetna, Humana
  'FUTURE ACTIVE POLICY', // Humana
  'ACCEPTED',       // UHC Med Supp
  'ENROLLED',       // ✅ ADDED - HealthSpring, Devoted
  'APPROVED',       // ✅ ADDED - Devoted
  'CMS ACCEPTED',   // ✅ ADDED - Freedom
  'NEW_EFFECTIVE'   // ✅ ADDED - Freedom
  // ❌ REMOVED: 'COMPLETED' (moved to DROP blacklist)
];
```

**Removed from whitelist:**
- ❌ `COMPLETED` - This is an APPLICATION status (paperwork finished), not ENROLLMENT status (member active)

**Added to DROP blacklist:**
```javascript
const dropStatuses = [
  'CANCEL', 'CANCELLED', 'CANCELED', 'CANCELLED APPLICATION',
  'INACTIVE', 'INACTIVE POLICY',
  'NEVER ACTIVE',  // ✅ ADDED - UHC specific
  'DER',           // ✅ ADDED - UHC specific (disenrolled)
  'NA',            // ✅ ADDED - UHC specific (not active)
  'TERMINATED', 'TERMED',
  'DENIED', 'WITHDRAWN',
  'IN PROGRESS', 'IN PROGRESS APPLICATION',
  'SUBMITTED', 'PENDING',
  'REJECTED', 'DECLINED',
  'DISENROLL', 'DISENROLLED',  // ✅ ADDED - Devoted specific
  'COMPLETED'      // ✅ MOVED from KEEP to DROP
];
```

**Why COMPLETED moved to DROP:**
- `COMPLETED` is an application status (paperwork finished)
- Does NOT mean the member is active
- Example: UHC MA has 382 App_Status=COMPLETED but only 287 Consumer_Status=ACTIVE
- The 95 difference = applications that completed but never became active policies

---

## ✅ #3: UHC Column Confirmation

**CRITICAL CHANGE: Use Consumer_Status, NOT App_Status**

**Before (WRONG):**
```javascript
case 'UnitedHealthcare':
  statusValue = (row.App_Status || row.POLICY_STATUS || '').trim();
  break;
```
- Result: 382 keep (includes 95 never-active policies)

**After (CORRECT):**
```javascript
case 'UnitedHealthcare':
  // CRITICAL: Use Consumer_Status (true enrollment), NOT App_Status
  // App_Status=COMPLETED includes 95 policies that never became active
  // Consumer_Status=ACTIVE (287) reflects actual enrollment = actual override payment
  statusValue = (row.Consumer_Status || row.POLICY_STATUS || '').trim();
  break;
```
- Result: 287 keep (only actual active members)

**Universal Principle Documented:**

> **"Application completed" ≠ "policy active"**
> 
> When a carrier has BOTH application-status AND enrollment/consumer-status columns:
> - **Application status** = paperwork processing (Completed, Submitted, Issued, Submitted_Only)
> - **Enrollment status** = actual member on the books (Active, Enrolled, Effective)
> - **ALWAYS use enrollment/consumer status for override filtering**
> 
> The enrollment status reflects whether the member is actually on the books and earns an override.

**Other carriers to check:**
- Aetna: `Issued_Status` vs `Enroll_Status` (Issued_Status=Submitted_Only ≠ active)
- Humana: May have `Application_Status` vs `Member_Status`
- Anthem: May have similar split

---

## ⚠️ #4: Aetna Upload "Failed to Fetch" - DIAGNOSED

**File:** Aetna_Production_01.26.26 (2.8MB, 95 rows)

**Test Result:** ✅ File parses successfully locally in ~30 seconds

**Diagnosis:** Not a file size or parsing issue. Likely:
1. **Railway request timeout** (default 30s, file takes ~30s to parse)
2. **Frontend upload timeout**
3. **Express body parser limit** (though multer is set to 10MB)

**Recommended Fixes:**

### Fix A: Increase Express/Railway timeout
```javascript
// In server.js or main app file
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// For Railway, add to railway.json or environment:
{
  "build": {
    "builder": "NIXPACKS"
  },
  "deploy": {
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 10,
    "healthcheckPath": "/health",
    "healthcheckTimeout": 60  // Increase timeout
  }
}
```

### Fix B: Add loading indicator on frontend
```javascript
// Show "Uploading large file... this may take up to 60 seconds"
const uploadTimeout = 90000; // 90 seconds
fetch(uploadUrl, {
  method: 'POST',
  body: formData,
  signal: AbortSignal.timeout(uploadTimeout)
})
```

### Fix C: Stream parsing for very large files (future enhancement)
- Use streaming XLSX parser
- Process rows in batches
- Send progress updates to frontend

**Current Status:** File CAN be parsed, just needs longer timeout.

---

## ⚠️ #5: Source File Bug - DIAGNOSED (NOT YET FIXED)

**Problem:** All production records show the same filename (HealthSpring_Production_05.11.26) regardless of actual source carrier.

**Root Cause:** The GET query joins `agency_production` to `agency_production_uploads` using `upload_batch` (month), not a specific upload ID:

```javascript
// CURRENT (WRONG):
LEFT JOIN LATERAL (
  SELECT filename, uploaded_at, uploaded_by
  FROM agency_production_uploads
  WHERE upload_batch = ap.upload_batch  // ❌ Joins on MONTH
  ORDER BY uploaded_at DESC
  LIMIT 1
) apu ON true
```

**Why this breaks:**
- Multiple uploads can have the same `upload_batch` (same month)
- The LATERAL join picks the LATEST upload for that month
- All records from January show the same filename (whichever file was uploaded last in January)

**Required Fix:**

### Step 1: Add `upload_id` column to `agency_production`
```sql
-- Migration: 007_add_upload_id_to_agency_production.sql
ALTER TABLE agency_production 
ADD COLUMN upload_id INTEGER REFERENCES agency_production_uploads(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_agency_production_upload_id ON agency_production(upload_id);
```

### Step 2: Update INSERT logic to capture upload ID first
```javascript
// BEFORE inserting records:
const uploadResult = await pool.query(
  `INSERT INTO agency_production_uploads (filename, carrier, upload_batch, uploaded_by, record_count)
   VALUES ($1, $2, $3, $4, $5)
   RETURNING id`,
  [req.file.originalname, carrier, uploadMonth, uploadedBy, rows.length]
);
const uploadId = uploadResult.rows[0].id;

// THEN insert records WITH upload_id:
await pool.query(
  `INSERT INTO agency_production 
   (agent_name, client_name, carrier, ..., upload_id)  // ✅ Add upload_id
   VALUES ($1, $2, $3, ..., $19)`,
  [agentName, clientName, carrier, ..., uploadId]  // ✅ Pass upload_id
);
```

### Step 3: Update GET query to join on `upload_id`
```javascript
// AFTER fix:
LEFT JOIN agency_production_uploads apu ON ap.upload_id = apu.id  // ✅ Direct FK join
```

**Status:** Diagnosed, fix designed, awaiting implementation.

---

## 📝 Deployment Summary

**Files Modified:**
- `routes/agencyproduction.js` - Status filter logic + column mappings

**Commits:**
- `c709cd6` - "CRITICAL: Use enrollment status not application status for UHC MA + complete whitelist"

**Deployed to Railway:** ✅ YES (commit c709cd6)

**Remaining Work:**
1. ⏸️ Fix #4 (Aetna timeout) - Increase Railway/Express timeout
2. ⏸️ Fix #5 (source_file bug) - Add upload_id FK, update INSERT/GET logic

---

## 🎯 Key Takeaways

### 1. "Application completed" ≠ "policy active"

This is the most important filtering principle for Medicare production data:
- **Application status** = paperwork tracking
- **Enrollment status** = member on the books = override payment

**Always use enrollment status for override filtering.**

### 2. The 95-policy gap

UHC MA case study:
- App_Status=COMPLETED: 382 policies
- Consumer_Status=ACTIVE: 287 policies
- **Difference: 95 completed applications that NEVER became active policies**

Using the wrong column would generate 95 false "Override Missing" flags, wasting time chasing BSI for payments on people who never enrolled.

### 3. Per-carrier schema mapping is critical

Don't use one-size-fits-all column names:
- UHC uses `Consumer_Status` for enrollment
- HealthSpring uses `Status`
- Freedom uses `POLICY_STATUS`
- Aetna uses THREE columns (`Enroll_Status`, `Exit_Status`, `Term_Status`)

**Each carrier requires explicit mapping.**

---

**Next Steps:**
1. Deploy timeout fix for Aetna uploads
2. Implement upload_id FK for accurate source file tracking
3. Test Aetna upload on Railway with increased timeout
4. Validate source file shows correctly per record

**End of report.**
