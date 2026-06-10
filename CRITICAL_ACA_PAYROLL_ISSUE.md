# CRITICAL: OliComm ACA Payroll System Broken

**Date:** June 10, 2026  
**Severity:** 🔴 CRITICAL - Production blocking  
**Impact:** Cannot pay ACA agents - all amounts showing $0.00  
**Reporter:** Yahoska Perez (COO, The Health Experts Insurance)

---

## 🎯 GOAL

**Upload NHP commission statement → See correct ACA agent payouts in Payroll**

### Success Criteria:
1. ✅ Upload `THE_HEALTH_EXPERST_INSURANCE_-_YAHOSKA_PEREZ_principal_-_KAT---04986e93-4a72-4108-b6fd-c5d258e0ae0a.xlsx`
2. ✅ Go to Payroll → Select "Jun 2026"
3. ✅ See **Patsy Pernia: $162.00** (4 policies: $27, $54, $27, $54)
4. ✅ See **Eduardo Pernia: $50-64** (6 policies with chargebacks)
5. ✅ Click "↓ Statement" → Download shows correct amounts
6. ✅ Statement shows: Lives (1, 2), Statement Month ("Cigna - April 2026"), Effective Date

---

## ❌ CURRENT STATE (BROKEN)

### What User Sees:

**Payroll Page:**
- Patsy Pernia: Shows $162.00 total ✅
- Eduardo Pernia: MISSING ❌
- Christian Munoz: Shows $100.00 ✅

**Downloaded Statement (Patsy):**
```csv
"Policy #","Client","Statement","Lives","Effective Date","Commission","Type"
"1V8A76","DE LA CRUZ JACKSON, JASME","Cigna",""," ","$0.00","ACA Agent Commission"
"9V590P","SANSEVERE, LONI","Cigna",""," ","$0.00","ACA Agent Commission"
"1WX480","DE LA CRUZ JACKSON, JASME","Cigna",""," ","$0.00","ACA Agent Commission"
"3W9G92","SANSEVERE, LONI","Cigna",""," ","$0.00","ACA Agent Commission"
```

**Problems:**
1. ❌ **Commission = $0.00** (should be $27, $54, $27, $54)
2. ❌ **Statement = "Cigna"** (should be "Cigna - April 2026")
3. ❌ **Lives = blank** (should be 1, 2, 1, 2)
4. ❌ **Effective Date = blank** (should show date)
5. ❌ **Eduardo completely missing** (should show with chargebacks)

---

## ✅ EXPECTED STATE

### Database Records (Patsy - 4 records):

| Field | Expected Value | Current Value |
|-------|---------------|---------------|
| `agent_name` | "Patsy Pernia" | ✅ Correct |
| `lob` | "ACA" | ✅ Correct |
| `classification` | "ACA Agent Commission" | ✅ Correct |
| `producer_payable` | 27, 54, 27, 54 | ❌ **0, 0, 0, 0** |
| `commission` | 0 or NULL | ✅ Correct |
| `statement_month` | "Cigna - April 2026" | ❌ **"Cigna" or NULL** |
| `members` | 1, 2, 1, 2 | ❌ **0, 0, 0, 0** |
| `effective_date` | (actual date) | ❌ **NULL** |
| `payment_period` | "202606" | ✅ Correct |

### Database Records (Eduardo - 6 records):

| Policy | Client | Classification | producer_payable | Expected |
|--------|--------|----------------|------------------|----------|
| H69246723 | JORGE RAMIREZ | ACA Agent Commission | 612.00 | ✅ |
| H69246723 | JORGE RAMIREZ | ACA Agency Override | 0 (THEI keeps) | ✅ |
| H69246723 | JORGE RAMIREZ | ACA Agent Chargeback | -561.00 | ❌ Likely 0 |
| H69827052 | PRAJWAL CHUMMAR | ACA Agent Chargeback | -16.29 | ❌ Likely 0 |
| OSC75522291-01 | Michelle Day | ACA Agent Commission | 7.00 | ❌ Likely 0 |
| OSC75522291-01 | Michelle Day | ACA Agent Commission | 9.00 | ❌ Likely 0 |

**Eduardo's Net:** $50.71 to $64.21 (depends on which records qualify)

**Why Eduardo missing:** If `producer_payable = 0` for all his records, Payroll filter excludes him.

---

## 🔍 EVIDENCE - Raw Source Data

### From NHP Excel (Column Headers):
```
A: LOB
B: Carrier-Statement Month
C: Agency
D: Agent NPN
E: Agent Name
F: Policy Number
G: Subscriber / Member Name
H: State
I: Members        ← LIVES COUNT
J: Policy Effective Date
K: Commission /Coverage Date
L: Commission Type
M: Comm Class
N: Commission     ← MONEY COLUMN 1
O: Override       ← MONEY COLUMN 2
P: Fee
```

### Patsy's Raw Data (Rows 18-25 in Excel):

**Row 18:**
- LOB: "ACA"
- Carrier-Statement Month: **"Cigna - April 2026"**
- Agent Name: "PATSY PERNIA"
- Policy: "1V8A76"
- Client: "DE LA CRUZ JACKSON, JASME"
- State: "FL-N"
- **Members: 1** ← Should be in `members` field
- Comm Class: **"Medical, HOAPIN"** (NOT "Commission"!)
- **Commission: 27** ← Should be in `producer_payable`
- Override: NULL

**Row 19:**
- Same policy
- Comm Class: **"Overrides"** (NOT "Override"!)
- Commission: NULL
- **Override: 2.5** ← THEI keeps this (producer_payable = 0)

**Row 20:**
- Policy: "9V590P"
- Client: "SANSEVERE, LONI"
- **Members: 2** ← Should be in `members` field
- Comm Class: **"Medical, HOAPIN"**
- **Commission: 54** ← Should be in `producer_payable`
- Override: NULL

### Eduardo's Raw Data (Rows with issues):

**Florida Blue - February 2026:**
- Policy: "H69246723"
- Client: "JORGE RAMIREZ"
- Comm Class: **"Commission"**
- **Commission: -561** ← NEGATIVE (chargeback), should be in `producer_payable`

**Oscar - April 2026:**
- Policy: "OSC75522291-01"
- Comm Class: **"Override"**
- **Commission: 7** ← Money in Commission column, NOT Override!
- Override: NULL

---

## 🛠️ CHANGES MADE TODAY (All Deployed)

### Backend Changes (Railway)

#### Change #1: NHP Parser - Handle Negative Commissions
**File:** `routes/files.js` parseNHPRows function (line ~950)

**Before:**
```javascript
if (commissionAmount > 0) {
  producerPayable = commissionAmount;
  recordType = 'ACA Agent Commission';
} else if (overrideAmount > 0) {
  producerPayable = 0;
  recordType = 'ACA Agency Override';
} else {
  producerPayable = 0;
  recordType = 'ACA Agency Override';
}
```

**After:**
```javascript
if (commissionAmount !== 0) {
  producerPayable = commissionAmount;
  recordType = commissionAmount < 0 ? 'ACA Agent Chargeback' : 'ACA Agent Commission';
} else if (overrideAmount !== 0) {
  producerPayable = 0;
  recordType = overrideAmount < 0 ? 'ACA Override Chargeback' : 'ACA Agency Override';
} else {
  producerPayable = 0;
  recordType = 'ACA Zero Amount';
}
```

**Commit:** `be81c25` (June 10, 2026)  
**Status:** ✅ Deployed to Railway

---

#### Change #2: Use Upload Date as Period
**File:** `routes/files.js` (line ~873, ~1957)

**Before:**
```javascript
const rawPeriod = row[commDateIdx + shift];
const period = normalizePeriod(rawPeriod);  // Uses Commission Date column (broken)
```

**After:**
```javascript
// At call site (line 1957):
const now = new Date();
const uploadPeriod = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
records = parseNHPRows(wb, uploadPeriod);

// In parser (line 910):
const period = uploadPeriod || 'Unknown';  // All records get upload month
```

**Commit:** `378582e` (June 10, 2026)  
**Status:** ✅ Deployed to Railway

---

#### Change #3: Add statement_month Field
**File:** `routes/files.js` (line ~1044)

**Added:**
```javascript
records.push({
  // ... other fields
  statementMonth: carrierRaw,  // Full string like "Cigna - April 2026"
  // ... other fields
});
```

**Also Added:** Database column creation + INSERT parameter
- Line 2076: `ALTER TABLE ... ADD COLUMN statement_month TEXT`
- Line 2083: Added to INSERT column list
- Line 2115: Added to VALUES list

**Commit:** `16ae2f1` (June 10, 2026)  
**Status:** ✅ Deployed to Railway

---

#### Change #4: Add members Field
**File:** `routes/files.js` (line ~877, ~905, ~1044)

**Added:**
```javascript
// Parse Members column (line 877):
const membersIdx = headerRowData.findIndex(h => String(h).toLowerCase() === 'members');

// Extract value (line 905):
const members = membersIdx >= 0 ? (parseInt(row[membersIdx + shift]) || 0) : 0;

// Add to record (line 1048):
records.push({
  // ... other fields
  members,
  // ... other fields
});
```

**Also Added:** Database column + INSERT parameter
- Line 2077: `ALTER TABLE ... ADD COLUMN members INTEGER`
- Line 2084: Added to INSERT column list
- Line 2116: Added to VALUES list

**Commit:** `cf6e754` (June 10, 2026)  
**Status:** ✅ Deployed to Railway

---

### Frontend Changes (Netlify)

#### Change #5: Payroll Filter - Use producer_payable for Negative Values
**File:** `src/pages/Payroll.js` (line ~210, ~120)

**Before:**
```javascript
const commission = parseFloat(r.producer_payable) > 0 
  ? parseFloat(r.producer_payable)
  : parseFloat(r.commission);
```

**After:**
```javascript
const hasProducerPayable = r.producer_payable != null;
const commission = hasProducerPayable
  ? parseFloat(r.producer_payable)  // Use even if negative
  : parseFloat(r.commission);
```

**Commit:** `b0cb310` → `6422d10` (June 10, 2026)  
**Status:** ✅ Deployed to Netlify

---

#### Change #6: Statement Export - Use producer_payable
**File:** `src/pages/Payroll.js` generateStatement and exportAll functions

**Before:**
```javascript
fmtCsv(r.commission)  // Always used commission field
```

**After:**
```javascript
const getAmount = r => {
  const hasProducerPayable = r.producer_payable != null;
  return hasProducerPayable ? parseFloat(r.producer_payable) : parseFloat(r.commission) || 0;
};
fmtCsv(getAmount(r))  // Use producer_payable for ACA, commission otherwise
```

**Commit:** `cc1605b` (June 10, 2026)  
**Status:** ✅ Deployed to Netlify

---

#### Change #7: Add Lives Column to Payroll Table
**File:** `src/pages/Payroll.js` (line ~113-145)

**Added "Lives" column header and data:**
```javascript
{['Policy #','Client','Statement','Lives','Effective','Period','Type','Amount'].map(...)}
...
<td>{r.members || '—'}</td>
```

**Commit:** `cf6e754` (June 10, 2026)  
**Status:** ✅ Deployed to Netlify

---

## 🚨 ROOT CAUSE ANALYSIS

### Primary Hypothesis: NHP Parser Column Detection Is Wrong

**The problem:** Parser is reading from WRONG columns or data is shifted.

#### Evidence:
1. ✅ `classification` field is correct ("ACA Agent Commission")
2. ✅ `payment_period` is correct ("202606")
3. ❌ `producer_payable` = 0 (should be 27, 54, etc.)
4. ❌ `statement_month` = "Cigna" (should be "Cigna - April 2026")
5. ❌ `members` = 0 (should be 1, 2)

**What this tells us:**
- Parser IS running (we have ACA records with correct classification)
- Parser IS detecting columns (got "ACA" from LOB, got "Cigna" somewhere)
- Parser is NOT reading the right column indices for Commission, Members, or full Carrier string

---

### Theory #1: Shift Logic Is Broken

**The Issue:** NHP format has conditional shift:
```javascript
const hasLOB = lobValue && String(lobValue).trim() !== '';
const shift = hasLOB ? 0 : -1;  // If LOB blank, data shifts left 1
```

**For ACA rows:** LOB column = "ACA" → `hasLOB = true` → `shift = 0`

**But what if:**
- Some ACA rows have blank LOB? (Parser would shift incorrectly)
- Column indices are wrong to begin with?

**Check:** Do ALL ACA rows have LOB = "ACA" in Column A?

---

### Theory #2: Column Headers Don't Match

**Current Code (line ~874-885):**
```javascript
const commissionIdx = headerRowData.findIndex(h => String(h).toLowerCase() === 'commission');
const overrideIdx = headerRowData.findIndex(h => String(h).toLowerCase() === 'override');
const membersIdx = headerRowData.findIndex(h => String(h).toLowerCase() === 'members');
```

**Actual NHP Headers:**
- Column N: **"Commission"** ✅ Should match
- Column O: **"Override"** ✅ Should match
- Column I: **"Members"** ✅ Should match

**But check:** Are these headers EXACTLY "Commission", "Override", "Members" with no extra spaces/characters?

---

### Theory #3: carrierRaw Is Being Normalized Too Early

**Current Code (line ~902):**
```javascript
const carrierRaw = String(row[carrierIdx + shift] || '').trim();
const carrier = normalizeNHPCarrier(carrierRaw);  // Strips to just "Cigna"
...
statementMonth: carrierRaw,  // Should be full string
```

**normalizeNHPCarrier function:**
```javascript
function normalizeNHPCarrier(carrierMonth) {
  const c = String(carrierMonth || '').toLowerCase();
  if (c.includes('cigna')) return 'Cigna';  // ❌ STRIPS OUT " - April 2026"!
  ...
}
```

**BINGO!** The `carrier` field is normalized, but we're saving `carrierRaw` to `statementMonth` **before** normalization. BUT if `carrierRaw` is already just "Cigna" from the database...

**Check:** Is the raw Excel cell value "Cigna" or "Cigna - April 2026"?

---

### Theory #4: Column Index Detection Fails Silently

**What if `commissionIdx = -1` (not found)?**

```javascript
const commissionAmount = commissionIdx >= 0 ? (parseFloat(row[commissionIdx + shift]) || 0) : 0;
```

If `commissionIdx = -1`:
- `commissionIdx + shift = -1 + 0 = -1`
- `row[-1]` in JavaScript = `undefined`
- `parseFloat(undefined) = NaN`
- `NaN || 0 = 0`
- `commissionAmount = 0` ✅ This matches what we see!

**Check:** Is the header row actually being found? Is "Commission" header spelled correctly?

---

## 🔬 DEBUGGING STEPS

### Step 1: Verify Deployment Status

**Railway:**
```bash
# Check latest commit deployed
git log -1 --oneline
# Should show: cc1605b or later

# Check Railway dashboard
# URL: https://railway.app/project/[project-id]
# Verify: "✅ Success" status on latest deployment
```

**Netlify:**
```bash
# Check Netlify dashboard
# URL: https://app.netlify.com/sites/[site-name]
# Verify: "✅ Published" status
```

---

### Step 2: Add Debug Logging to Parser

**File:** `routes/files.js` parseNHPRows function

**Add BEFORE the row loop (line ~890):**
```javascript
console.log('🔍 NHP PARSER DEBUG');
console.log('Headers:', headerRowData);
console.log('Column Indices:');
console.log('  lobIdx:', lobIdx);
console.log('  carrierIdx:', carrierIdx);
console.log('  membersIdx:', membersIdx);
console.log('  commissionIdx:', commissionIdx);
console.log('  overrideIdx:', overrideIdx);
console.log('  effectiveDateIdx:', effectiveDateIdx);
```

**Add INSIDE the row loop for first 5 ACA rows (line ~918):**
```javascript
if (lob === 'ACA' && records.length < 5) {
  console.log(`\n🔍 ACA Row ${records.length + 1}:`);
  console.log('  Raw row:', row);
  console.log('  hasLOB:', hasLOB, '| shift:', shift);
  console.log('  lobRaw:', lobRaw);
  console.log('  carrierRaw:', carrierRaw);
  console.log('  agent:', agent);
  console.log('  client:', client);
  console.log('  members (raw):', row[membersIdx + shift]);
  console.log('  members (parsed):', members);
  console.log('  commissionAmount (raw):', row[commissionIdx + shift]);
  console.log('  commissionAmount (parsed):', commissionAmount);
  console.log('  overrideAmount (raw):', row[overrideIdx + shift]);
  console.log('  overrideAmount (parsed):', overrideAmount);
  console.log('  grossCommission:', grossCommission);
  console.log('  producerPayable:', producerPayable);
  console.log('  recordType:', recordType);
}
```

**Deploy and check Railway logs after upload.**

---

### Step 3: Query Database Immediately After Upload

**SQL Query:**
```sql
SELECT 
  id,
  agent_name,
  client_full_name,
  policy_number,
  lob,
  classification,
  producer_payable,
  commission,
  statement_month,
  members,
  effective_date,
  payment_period,
  raw_data,
  created_at
FROM commission_records
WHERE payment_period = '202606'
  AND lob = 'ACA'
  AND agent_name ILIKE '%patsy%'
ORDER BY created_at DESC
LIMIT 4;
```

**Expected:**
- 4 records
- `producer_payable`: 27, 54, 27, 54
- `statement_month`: "Cigna - April 2026"
- `members`: 1, 2, 1, 2

**If ALL fields are 0/NULL:**
→ Parser is completely broken or not running

**If SOME fields correct:**
→ Column index detection is wrong for specific columns

**Check `raw_data` column:**
→ Should contain the original row as JSON
→ Verify the source data is correct

---

### Step 4: Test Parser Locally

**Create minimal test:**

```javascript
const XLSX = require('xlsx');
const wb = XLSX.readFile('./THE_HEALTH_EXPERST_INSURANCE_-_YAHOSKA_PEREZ_principal_-_KAT---04986e93-4a72-4108-b6fd-c5d258e0ae0a.xlsx');
const ws = wb.Sheets[wb.SheetNames[0]];

// Read header row
const range = XLSX.utils.decode_range(ws['!ref']);
console.log('Range:', range);

// Find header row
for (let r = 0; r < 20; r++) {
  const row = [];
  for (let c = 0; c <= 15; c++) {
    const cell = ws[XLSX.utils.encode_cell({ r, c })];
    row.push(cell ? cell.v : null);
  }
  console.log(`Row ${r}:`, row);
  if (row.includes('Override')) {
    console.log('✅ Found header row:', r);
    break;
  }
}

// Read first ACA row (row 18)
const row18 = [];
for (let c = 0; c <= 15; c++) {
  const cell = ws[XLSX.utils.encode_cell({ r: 17, c })];  // 0-indexed
  row18.push(cell ? cell.v : null);
}
console.log('\nRow 18 (first Patsy ACA):', row18);
console.log('  A (LOB):', row18[0]);
console.log('  B (Carrier-Statement):', row18[1]);
console.log('  E (Agent Name):', row18[4]);
console.log('  I (Members):', row18[8]);
console.log('  N (Commission):', row18[13]);
console.log('  O (Override):', row18[14]);
```

**Run this and verify:**
- Row 18, Column B = "Cigna - April 2026" (not just "Cigna")
- Row 18, Column I = 1 (not 0 or NULL)
- Row 18, Column N = 27 (not 0 or NULL)

---

### Step 5: Check for Caching Issues

**Railway might be serving old code:**

```bash
# Force Railway to rebuild
# Option 1: Add dummy commit
echo "# Force rebuild $(date)" >> routes/files.js
git add routes/files.js
git commit -m "Force Railway rebuild"
git push origin main

# Option 2: Trigger manual deploy in Railway dashboard
# Settings → Deployments → "Redeploy"
```

---

## 🎯 RECOMMENDED FIX PATH

### Phase 1: Verify What's Actually in Database RIGHT NOW

1. **SSH into Railway or use Railway dashboard SQL console**
2. **Run this query:**
   ```sql
   SELECT agent_name, policy_number, producer_payable, commission, 
          statement_month, members, effective_date, raw_data
   FROM commission_records
   WHERE payment_period = '202606' AND lob = 'ACA'
   ORDER BY agent_name, created_at DESC;
   ```
3. **Check the `raw_data` JSON field** - contains original parsed data
4. **Compare to source Excel** - is data wrong at parse time or INSERT time?

---

### Phase 2: Add Debug Logging

1. **Add console.log statements to parseNHPRows** (see Step 2 above)
2. **Deploy to Railway**
3. **Upload test file**
4. **Check Railway logs** - see exactly what values are being read

**Railway logs location:**
- Dashboard → Project → Deployments → Latest → "View Logs"
- Look for console.log output during upload

---

### Phase 3: Fix Column Detection

**Most likely issue:** Column indices are wrong.

**Test hypothesis:**
```javascript
// Instead of searching for exact "commission", try case-insensitive contains:
const commissionIdx = headerRowData.findIndex(h => 
  String(h || '').toLowerCase().includes('commission')
);
```

**Or hardcode for NHP format:**
```javascript
// NHP has fixed column layout:
const commissionIdx = 13;  // Column N (0-indexed)
const overrideIdx = 14;    // Column O
const membersIdx = 8;      // Column I
```

---

### Phase 4: Fix statement_month

**Problem:** `normalizeNHPCarrier()` strips the date part.

**Solution:** Save raw value BEFORE normalization:
```javascript
const carrierRaw = String(row[carrierIdx + shift] || '').trim();
const statementMonth = carrierRaw;  // Save FIRST
const carrier = normalizeNHPCarrier(carrierRaw);  // Normalize AFTER
```

**Then in records.push():**
```javascript
records.push({
  carrier,           // Normalized: "Cigna"
  statementMonth,    // Raw: "Cigna - April 2026"
  // ...
});
```

---

### Phase 5: Test End-to-End

1. **Delete all Jun 2026 uploads**
2. **Upload test file**
3. **Query database immediately**
4. **Verify:**
   - producer_payable has values
   - statement_month has full string
   - members has counts
5. **Check Payroll page**
6. **Download statement**

---

## 📋 QUICK CHECKLIST FOR NEXT DEVELOPER

- [ ] Verify Railway deployment succeeded (check dashboard)
- [ ] Verify Netlify deployment succeeded (check dashboard)
- [ ] Check if database has `producer_payable`, `statement_month`, `members` columns
- [ ] Query database to see current state of Jun 2026 ACA records
- [ ] Add debug logging to parseNHPRows function
- [ ] Upload test file and check Railway logs
- [ ] Verify column indices are detecting correct headers
- [ ] Verify values are being read from correct cells
- [ ] Test parser locally with XLSX library
- [ ] Check if `normalizeNHPCarrier` is stripping too much
- [ ] Deploy fixes incrementally and test after each
- [ ] Don't upload again until database check confirms data is correct

---

## 🔗 IMPORTANT FILES & LOCATIONS

**Source File:**
- Name: `THE_HEALTH_EXPERST_INSURANCE_-_YAHOSKA_PEREZ_principal_-_KAT---04986e93-4a72-4108-b6fd-c5d258e0ae0a.xlsx`
- Sheet: "May 30th, 2026"
- Location: `/home/medicare-ai-agent/.openclaw/media/inbound/`

**Backend (Railway):**
- Repo: `https://github.com/yperez-dot/commission-tracker.git`
- Main file: `routes/files.js`
- Function: `parseNHPRows()` (line ~850-1065)
- Database: PostgreSQL on Railway
- Table: `commission_records`

**Frontend (Netlify):**
- Repo: Same as backend
- Main file: `src/pages/Payroll.js`
- URL: `https://melodic-cendol-e1dc49.netlify.app`

**Diagnostic Docs:**
- Full diagnostic: `OLICOMM_ACA_PAYROLL_DIAGNOSTIC.md`
- This document: `CRITICAL_ACA_PAYROLL_ISSUE.md`
- Database check: `check-database.md`

---

## ⚠️ DO NOT

- ❌ Upload again without checking database first
- ❌ Make multiple changes at once
- ❌ Assume deployments worked without verification
- ❌ Test in production without logging
- ❌ Ignore Railway/Netlify deployment logs

---

## 📞 CONTACT

**Reporter:** Yahoska Perez  
**Phone:** +1 786 368 3093  
**Email:** yperez@healthexps.com  
**Company:** The Health Experts Insurance  

**Urgency:** High - blocking ACA agent payments

---

**Last Updated:** June 10, 2026, 8:30 AM EDT  
**Status:** 🔴 UNRESOLVED - Needs immediate attention
