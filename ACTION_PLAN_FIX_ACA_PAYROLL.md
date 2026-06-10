# ACTION PLAN: Fix OliComm ACA Payroll (Eduardo Missing + $0 Amounts)

**Date:** June 10, 2026  
**Status:** 🟡 Code fixes deployed, awaiting Railway deployment + database check  
**Goal:** Patsy shows $162 with correct amounts, Eduardo appears with chargebacks

---

## ✅ WHAT I JUST FIXED (Deployed to GitHub)

### Fix #1: Column Header Detection (.trim() + Hardcoded Fallbacks)
**Problem:** Parser couldn't find "Commission", "Override", "Members" headers if they had extra spaces  
**Solution:** Added `.trim()` to header matching + hardcoded column indices as fallback

**Before:**
```javascript
const commissionIdx = headerRowData.findIndex(h => String(h).toLowerCase() === 'commission');
```

**After:**
```javascript
const commissionIdx = headerRowData.findIndex(h => String(h || '').trim().toLowerCase() === 'commission') !== -1
  ? headerRowData.findIndex(h => String(h || '').trim().toLowerCase() === 'commission')
  : 13; // Column N fallback
```

**Same for:**
- `overrideIdx` → Fallback: Column 14 (Column O)
- `membersIdx` → Fallback: Column 8 (Column I)

**Impact:** Even if header detection fails, parser will use correct NHP column positions.

---

### Fix #2: Debug Logging (First 3 ACA Records)
**Added:** Console logging for first 3 ACA records showing:
- Column indices detected (commissionIdx, overrideIdx, membersIdx)
- Raw row data (first 16 columns)
- Parsed values (agent, client, policy, members, commissionAmount, overrideAmount)
- Shift value and hasLOB flag

**Location:** Railway logs → Deployments → View Logs (after upload)

**Example output:**
```
🔍 NHP ACA DEBUG — Record 1
  Headers detected:
    commissionIdx: 13 | overrideIdx: 14 | membersIdx: 8
  Raw row data: ['ACA', 'Cigna - April 2026', 'THE HEALTH...']
  Parsed values:
    agent: Patsy Pernia | client: DE LA CRUZ JACKSON, JASME | policy: 1V8A76
    carrierRaw: Cigna - April 2026 | members: 1
    commissionAmount: 27 | overrideAmount: 0
    shift: 0 | hasLOB: true
```

---

### ✅ Already Correct (No Changes Needed)
- **statementMonth:** Line 1067 already saves `carrierRaw` before normalization
- **Negative commissions:** Change #1 from earlier today handles `commissionAmount !== 0` (includes negatives)
- **Frontend producer_payable:** Payroll.js already uses `producer_payable` for ACA records

---

## 🚀 DEPLOYMENT STATUS

**GitHub:** ✅ Pushed (commit 1c3f041)  
**Railway:** 🟡 Deploying now...  
**Netlify:** ✅ Already deployed from earlier

**Check Railway deployment:** https://railway.app

---

## 📋 STEPS YOU NEED TO FOLLOW (IN ORDER)

### ⏳ STEP 1: Wait for Railway Deployment (2-3 minutes)

1. Go to: https://railway.app
2. Click on: commission-tracker project
3. Click: Deployments tab
4. Wait for: ✅ Success (green checkmark)
5. **DON'T upload yet!** Need to check database first.

---

### 🔍 STEP 2: Check Database (BEFORE Re-Upload)

**Why:** Need to see what's currently stored to understand if bug is in parser or INSERT.

**How to access Railway SQL console:**
1. Railway dashboard → commission-tracker project
2. Click: PostgreSQL database
3. Click: "Data" or "Query" tab
4. Paste this SQL:

```sql
SELECT 
  agent_name, 
  policy_number, 
  producer_payable, 
  commission,
  statement_month, 
  members, 
  effective_date
FROM commission_records
WHERE payment_period = '202606' AND lob = 'ACA'
ORDER BY agent_name, created_at DESC;
```

**What to look for:**

| Field | Current (Wrong) | Expected (Correct) | What It Means |
|-------|-----------------|-------------------|---------------|
| `producer_payable` | 0, 0, 0, 0 | 27, 54, 27, 54 (Patsy) | ❌ Parser reading wrong column |
| `statement_month` | "Cigna" or NULL | "Cigna - April 2026" | ❌ Normalization happening too early |
| `members` | 0, 0, 0, 0 | 1, 2, 1, 2 (Patsy) | ❌ Parser reading wrong column |
| `Eduardo rows` | 0 rows | 6 rows | ❌ Filtered before INSERT |

**If ALL fields = 0/NULL:**
→ Parser is completely broken (column detection failed)

**If Eduardo has 0 rows:**
→ His records were filtered out (likely `grossCommission === 0` check on line 947)

---

### 🗑️ STEP 3: Delete Stale Jun 2026 ACA Records

**Why:** Don't layer new uploads on top of broken data.

**SQL to run in Railway:**
```sql
DELETE FROM commission_records
WHERE payment_period = '202606' AND lob = 'ACA';
```

**Expected:** Returns number of deleted rows (probably 4-10 records)

---

### 📤 STEP 4: Re-Upload NHP Statement (ONE TIME)

1. Go to: https://melodic-cendol-e1dc49.netlify.app
2. Login
3. Upload History → Find Jun 2026 batch → Delete it
4. Upload Files → Upload: `THE_HEALTH_EXPERST_INSURANCE_-_YAHOSKA_PEREZ_principal_-_KAT---04986e93-4a72-4108-b6fd-c5d258e0ae0a.xlsx`
5. Wait for: "Upload successful"

---

### 🔍 STEP 5: Check Railway Logs (Immediately After Upload)

**Why:** Debug logging will show what parser is actually reading.

**How:**
1. Railway dashboard → commission-tracker
2. Deployments → Latest deployment
3. Click: "View Logs"
4. Look for: `🔍 NHP ACA DEBUG — Record 1`

**What you should see:**
```
🔍 NHP ACA DEBUG — Record 1
  Headers detected:
    commissionIdx: 13 | overrideIdx: 14 | membersIdx: 8  ← Should NOT be -1!
  Raw row data: [...]
  Parsed values:
    carrierRaw: Cigna - April 2026  ← Full string, not just "Cigna"
    members: 1  ← Should be 1, not 0
    commissionAmount: 27  ← Should be 27, not 0
```

**If commissionIdx = -1:**
→ Header detection failed completely, using fallback (13)

**If commissionAmount = 0:**
→ Reading from wrong cell, or shift logic is broken

---

### ✅ STEP 6: Verify in Payroll Page

1. Go to: Payroll page
2. Select: Jun 2026
3. **Expected results:**

| Agent | Total | Records | Status |
|-------|-------|---------|--------|
| Patsy Pernia | $162.00 | 4 policies | ✅ Should work |
| Eduardo Pernia | $50-64 | 6 policies (with chargebacks) | ⚠️ Check if appears |
| Christian Munoz | $100.00 | 1 policy | ✅ Should work |

4. Click: "↓ Statement" for Patsy
5. **Check downloaded CSV:**
   - Commission column: $27.00, $54.00, $27.00, $54.00 (NOT $0.00)
   - Lives column: 1, 2, 1, 2 (NOT blank)
   - Statement column: "Cigna - April 2026" (NOT just "Cigna")
   - Effective Date: (should have date, NOT blank)

---

### 🚨 IF STILL BROKEN AFTER STEP 6:

**Run this SQL to see EXACTLY what was stored:**
```sql
SELECT 
  agent_name,
  policy_number,
  producer_payable,
  commission,
  statement_month,
  members,
  effective_date,
  raw_data  -- This shows the original row as JSON
FROM commission_records
WHERE payment_period = '202606' 
  AND lob = 'ACA'
  AND agent_name ILIKE '%patsy%'
ORDER BY created_at DESC
LIMIT 4;
```

**Check `raw_data` field:**
- This contains the original Excel row as JSON
- Compare to source file to see if data was correct at parse time
- If `raw_data` has correct values but fields are 0 → INSERT bug
- If `raw_data` also has 0s → Parser bug (column detection)

---

## 🎯 EXPECTED OUTCOME

### Success Criteria:

✅ **Patsy Pernia:**
- Total: $162.00
- 4 records with amounts: $27, $54, $27, $54
- Lives: 1, 2, 1, 2
- Statement: "Cigna - April 2026"

✅ **Eduardo Pernia:**
- Appears in Payroll (not missing)
- 6 records (mix of positive + negative)
- Net amount: $50.71 to $64.21 (depends on which records qualify)
- Records include chargebacks (negative values)

✅ **Statement Export:**
- All amounts show correctly (not $0.00)
- Lives column populated
- Statement column shows full "Carrier - Month Year"

---

## 🛠️ TECHNICAL DETAILS (For Developer Reference)

### Files Modified:
- `routes/files.js` (backend NHP parser)
- Commit: 1c3f041
- Lines changed: 882-884 (column detection), 959-972 (debug logging)

### Database Schema:
```sql
CREATE TABLE commission_records (
  ...
  producer_payable DECIMAL(10,2),
  commission DECIMAL(10,2),
  statement_month TEXT,
  members INTEGER DEFAULT 0,
  effective_date DATE,
  ...
);
```

### Key Functions:
- `parseNHPRows()` - Main parser (line ~850-1075)
- `normalizeNHPCarrier()` - Strips date from carrier name (line 384)
- Column indices: Commission=13, Override=14, Members=8 (0-indexed)

### Debug Logging:
- Only first 3 ACA records logged (prevents log spam)
- Shows column detection + raw values + parsed values
- Available in Railway logs after upload

---

## 📞 CONTACT

**If still broken after following all steps:**
1. Screenshot Railway logs (the debug output)
2. Screenshot Payroll page
3. Screenshot database query results
4. Share with Igor via WhatsApp

**This will help diagnose:**
- Is parser reading correct columns?
- Is data being stored correctly?
- Is frontend displaying correctly?

---

## 🔗 IMPORTANT LINKS

- **OliComm Frontend:** https://melodic-cendol-e1dc49.netlify.app
- **Railway Dashboard:** https://railway.app
- **GitHub Repo:** https://github.com/yperez-dot/commission-tracker
- **Source File:** `/home/medicare-ai-agent/.openclaw/media/inbound/THE_HEALTH_EXPERST_INSURANCE_-_YAHOSKA_PEREZ_principal_-_KAT---04986e93-4a72-4108-b6fd-c5d258e0ae0a.xlsx`
- **Previous Diagnostic Doc:** `CRITICAL_ACA_PAYROLL_ISSUE.md`

---

**Last Updated:** June 10, 2026, 8:40 AM EDT  
**Status:** 🟡 Code deployed, awaiting testing  
**Next:** Wait for Railway deployment → Check database → Delete stale records → Re-upload
