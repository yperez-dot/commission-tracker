# OliComm ACA Payroll Issues - Diagnostic Document

**Date:** June 10, 2026  
**Issue:** ACA agent commissions not showing correctly in Payroll  
**Reporter:** Yahoska Perez  
**Status:** ❌ BROKEN

---

## 🚨 Current Problems

### 1. **Patsy's Statement Shows $0.00 for All Records**
**Expected:** $162 total ($27 + $54 + $27 + $54)  
**Actual:** $0.00 for every record

**Downloaded CSV shows:**
```csv
"1V8A76","DE LA CRUZ JACKSON, JASME","Cigna"," ","$0.00","ACA Agent Commission"
"9V590P","SANSEVERE, LONI","Cigna"," ","$0.00","ACA Agent Commission"
```

**Root Cause:** Statement export is pulling from wrong field (using `commission` instead of `producer_payable`)

---

### 2. **Eduardo Not Showing in Payroll**
**Expected:** Eduardo Pernia with $50-64 (includes chargebacks)  
**Actual:** Not appearing at all

**Eduardo's records from NHP Excel:**
- Florida Blue Jan: +$612 Commission
- Florida Blue Jan: +$13.50 Override  
- Florida Blue Feb: -$561 Commission (chargeback)
- Florida Blue Jan: -$16.29 Commission (chargeback)
- Oscar April: +$7 Override (but in Commission column!)
- Oscar March: +$9 Override (but in Commission column!)

**Suspected Issues:**
- Negative commissions (chargebacks) not handled correctly
- "Override" records with money in Commission column confusing parser
- Filter excluding agents with net negative or complex records

---

### 3. **Statement Month Column Shows Wrong Data**
**Expected:** "Cigna - April 2026", "FLORIDA BLUE - FEBRUARY 2026"  
**Actual:** Just "Cigna"

**Root Cause:** `statement_month` field not populated from NHP upload

---

### 4. **Lives Column Missing**
**Expected:** Column showing 1, 2, etc. (# of members per policy)  
**Actual:** Column doesn't exist in statement export

**Root Cause:** Either Netlify didn't finish building, or `members` field not saved to database

---

### 5. **Effective Date Blank**
**Expected:** Date like "202604" or formatted date  
**Actual:** Blank space " "

**Root Cause:** `effective_date` field not populated or formatted incorrectly

---

## 📋 What We Tried (Fixes Applied Today)

### Fix #1: NHP Parser - Handle Negative Commissions
**File:** `routes/files.js` (line ~950)  
**Change:** 
```javascript
// OLD
if (commissionAmount > 0) {
  producerPayable = commissionAmount;
}

// NEW
if (commissionAmount !== 0) {  // Include negative (chargebacks)
  producerPayable = commissionAmount;
  recordType = commissionAmount < 0 ? 'ACA Agent Chargeback' : 'ACA Agent Commission';
}
```
**Status:** ✅ Deployed to Railway  
**Expected Result:** Eduardo's chargebacks should now have `producer_payable` set correctly

---

### Fix #2: Payroll Filter - Use producer_payable for Negatives
**File:** `src/pages/Payroll.js` (line ~210, ~120)  
**Change:**
```javascript
// OLD
const commission = parseFloat(r.producer_payable) > 0 
  ? parseFloat(r.producer_payable)
  : parseFloat(r.commission);

// NEW
const hasProducerPayable = r.producer_payable != null;
const commission = hasProducerPayable
  ? parseFloat(r.producer_payable)  // Use even if negative
  : parseFloat(r.commission);
```
**Status:** ✅ Deployed to Netlify  
**Expected Result:** Payroll should calculate amounts correctly including chargebacks

---

### Fix #3: Upload Date = Period for All Records
**File:** `routes/files.js` (line ~873, ~1957)  
**Change:**
```javascript
// OLD
const rawPeriod = row[commDateIdx + shift];
const period = normalizePeriod(rawPeriod);  // Uses broken Commission Date column

// NEW
const uploadPeriod = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
const period = uploadPeriod;  // All records get upload month
```
**Status:** ✅ Deployed to Railway  
**Expected Result:** Upload on June 10 → all records get period = 202606

---

### Fix #4: Add Statement Month Column
**File:** `routes/files.js` (line ~1040)  
**Change:** Added `statementMonth: carrierRaw` to record object  
**Status:** ✅ Deployed to Railway  
**Expected Result:** "Cigna - April 2026" saved to `statement_month` field

---

### Fix #5: Add Lives/Members Column
**File:** `routes/files.js` (line ~877, ~905, ~1044)  
**Change:** 
- Parse "Members" column (Column I)
- Add `members` field to database
- Show in Payroll table as "Lives"

**Status:** ✅ Deployed to Railway + Netlify  
**Expected Result:** Each ACA record shows # of members (1, 2, etc.)

---

### Fix #6: Exclude Only Yahoska + Katy from Payroll
**File:** `src/pages/Payroll.js` (line ~9)  
**Change:**
```javascript
// OLD
const YOUR_TEAM = ['yahoska perez', 'katy robles', 'gina berenguer', 'jill taylor', ...];

// NEW
const YOUR_TEAM = ['yahoska perez', 'katy robles'];
```
**Status:** ✅ Deployed to Netlify  
**Expected Result:** Gina, Jill, Osmary, Sabri now show if they have ACA commissions

---

## 🧪 Test Case (May 30th NHP Statement)

### Input File
**Name:** `THE_HEALTH_EXPERST_INSURANCE_-_YAHOSKA_PEREZ_principal_-_KAT---04986e93-4a72-4108-b6fd-c5d258e0ae0a.xlsx`  
**Sheet:** "May 30th, 2026"

### Expected Results After Upload

**Period:** 202606 (Jun 2026) - based on upload date June 10, 2026

#### Patsy Pernia - Expected Total: $162.00
| Policy | Client | Statement | Lives | Effective | Type | Amount |
|--------|--------|-----------|-------|-----------|------|--------|
| 1V8A76 | DE LA CRUZ JACKSON | Cigna - April 2026 | 1 | (date) | ACA Agent Commission | $27.00 |
| 9V590P | SANSEVERE, LONI | Cigna - April 2026 | 2 | (date) | ACA Agent Commission | $54.00 |
| 1WX480 | DE LA CRUZ JACKSON | Cigna - April 2026 | 1 | (date) | ACA Agent Commission | $27.00 |
| 3W9G92 | SANSEVERE, LONI | Cigna - April 2026 | 2 | (date) | ACA Agent Commission | $54.00 |

#### Eduardo Pernia - Expected Total: $50.71 to $64.21
| Policy | Client | Statement | Lives | Effective | Type | Amount |
|--------|--------|-----------|-------|-----------|------|--------|
| H69246723 | JORGE RAMIREZ | Florida Blue - January 2026 | (?) | (date) | ACA Agent Commission | $612.00 |
| H69246723 | JORGE RAMIREZ | Florida Blue - January 2026 | (?) | (date) | ACA Agency Override | $13.50 |
| H69246723 | JORGE RAMIREZ | Florida Blue - February 2026 | (?) | (date) | ACA Agent Chargeback | -$561.00 |
| H69827052 | PRAJWAL CHUMMAR | Florida Blue - January 2026 | (?) | (date) | ACA Agent Chargeback | -$16.29 |
| OSC75522291-01 | Michelle Day | Oscar - April 2026 | (?) | (date) | ACA Agent Commission | $7.00 |
| OSC75522291-01 | Michelle Day | OSCAR - MARCH 2026 | (?) | (date) | ACA Agent Commission | $9.00 |

**Net:** $64.21 or $50.71 depending on which records qualify

#### Christian Munoz - Expected Total: $100.00
(Medicare sub-agent override, not ACA)

---

## 🔍 Debugging Steps

### Step 1: Check Database After Upload

**SQL Query:**
```sql
SELECT 
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
  payment_period
FROM commission_records
WHERE lob = 'ACA'
  AND payment_period = '202606'
  AND agent_name ILIKE '%patsy%'
ORDER BY agent_name, client_full_name;
```

**Expected Results for Patsy (4 records):**
- `producer_payable`: 27, 54, 27, 54
- `commission`: should be 0 or NULL (THEI doesn't get commission, agent does)
- `statement_month`: "Cigna - April 2026"
- `members`: 1, 2, 1, 2
- `effective_date`: NOT NULL
- `classification`: "ACA Agent Commission"

**If producer_payable is 0 or NULL:**  
→ NHP parser fix didn't work, money is going to wrong field

**If statement_month is NULL:**  
→ `statementMonth: carrierRaw` not being saved

**If members is 0:**  
→ Members column not being parsed correctly

---

### Step 2: Check Eduardo's Records

**SQL Query:**
```sql
SELECT 
  agent_name,
  client_full_name,
  policy_number,
  classification,
  producer_payable,
  commission,
  lob
FROM commission_records
WHERE lob = 'ACA'
  AND payment_period = '202606'
  AND agent_name ILIKE '%eduardo%'
ORDER BY client_full_name;
```

**Expected:** 6 records (4 Florida Blue, 2 Oscar)

**If 0 records found:**  
→ Parser skipping Eduardo's records entirely (maybe because of mixed commission/override types)

**If records exist but producer_payable = 0:**  
→ Parser not assigning negative chargebacks correctly

---

### Step 3: Check Payroll API Response

**HTTP Request:**
```
GET https://commission-tracker-production-e4fc.up.railway.app/api/records?period=202606&lob=ACA&limit=100
```

**Expected Response:**
```json
{
  "records": [
    {
      "agent_name": "Patsy Pernia",
      "client_full_name": "DE LA CRUZ JACKSON, JASME",
      "producer_payable": 27,
      "statement_month": "Cigna - April 2026",
      "members": 1,
      "classification": "ACA Agent Commission"
    },
    ...
  ]
}
```

**If producer_payable is wrong:**  
→ Database has wrong data (parser issue)

**If fields missing:**  
→ Backend not returning new fields

---

### Step 4: Check Payroll Filter Logic

**File:** `src/pages/Payroll.js` line ~195  
**Current Filter:**
```javascript
const isACAPayable = lob === 'ACA' && producerPayable !== 0;
```

**Test:** Does Eduardo have at least ONE record with `producer_payable !== 0`?

**If NO:**  
→ All his records have `producer_payable = 0` (parser bug)

**If YES but he doesn't show:**  
→ Frontend filter is excluding him (check `hasPositivePayable` logic on line ~231)

---

## 🛠️ Suspected Root Causes (Priority Order)

### 1. **NHP Parser Not Assigning producer_payable Correctly**
**Symptom:** Patsy's statement shows $0.00  
**Location:** `routes/files.js` parseNHPRows function  
**Issue:** The "Commission" and "Override" column logic might be wrong

**Current Logic:**
```javascript
if (commissionAmount !== 0) {
  producerPayable = commissionAmount;
} else if (overrideAmount !== 0) {
  producerPayable = 0;  // THEI keeps override
}
```

**Problem:** What if BOTH columns have values? What if the columns are shifted?

**Verify:**
- Check `commissionIdx` and `overrideIdx` are finding correct columns
- Check shift logic (when LOB is blank, data shifts left)
- Print debug output to see what values are being read

---

### 2. **Eduardo's Records Have Mixed Types**
**Symptom:** Eduardo not showing  
**Issue:** His records have "Override" in Comm Class but money in Commission column

**Example:**
```
Oscar - April 2026 | Class: Override | Commission: $7 | Override: 0
```

**Current Parser Checks:**
```javascript
const isCommissionRow = commClassLower.includes('commission') || commTypeLower.includes('commission');
const isOverrideRow = commClassLower.includes('override') || commTypeLower.includes('override');
```

**If Comm Class = "Override" but money is in Commission column:**
- `isOverrideRow = true`
- `grossCommission = overrideAmount` (which is 0!)
- Record gets skipped because `grossCommission === 0`

**Fix:** Ignore Comm Class label, trust which column has money

---

### 3. **Statement Download Using Wrong Field**
**Symptom:** Downloaded CSV shows $0.00  
**Location:** `src/pages/Payroll.js` generateStatement function (line ~34)

**Current Code:**
```javascript
const fmtCsv = n => '$' + Number(n||0).toFixed(2);
...
fmtCsv(r.commission)  // ❌ WRONG FIELD
```

**Should Be:**
```javascript
const amount = hasProducerPayable 
  ? parseFloat(r.producer_payable)
  : parseFloat(r.commission);
fmtCsv(amount)  // ✅ CORRECT
```

---

### 4. **Database Columns Not Created**
**Symptom:** statement_month, members fields missing  
**Issue:** Auto-create migrations might not have run

**Check:**
```sql
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'commission_records'
  AND column_name IN ('statement_month', 'members');
```

**If columns don't exist:**  
→ Run manual migration:
```sql
ALTER TABLE commission_records ADD COLUMN IF NOT EXISTS statement_month TEXT;
ALTER TABLE commission_records ADD COLUMN IF NOT EXISTS members INTEGER DEFAULT 0;
```

---

## ✅ Recommended Fix Path

### Phase 1: Stop and Diagnose (Don't Upload Again)

1. **Check Railway Deployment Status**
   - Go to https://railway.app
   - Verify latest commit deployed successfully
   - Check logs for errors

2. **Check Netlify Deployment Status**
   - Go to https://app.netlify.com  
   - Verify latest commit deployed successfully
   - Check build logs

3. **Query Database Directly**
   - Run SQL queries above
   - Verify `producer_payable`, `statement_month`, `members` fields exist and have correct data
   - Check Eduardo's records specifically

---

### Phase 2: Fix Root Issues

**If producer_payable = 0 for all ACA records:**

→ **Fix NHP Parser Column Detection**
- Add debug logging to see which columns are being read
- Verify `commissionIdx` and `overrideIdx` are correct
- Check shift logic with sample rows
- Might need to ignore "Comm Class" label entirely and just check which column has money

**If Eduardo missing:**

→ **Fix Mixed Commission/Override Handling**
- Current parser checks Comm Class label first
- Should check which COLUMN has money first, ignore label
- Example: If Commission column has $7 and Override column has $0, use Commission regardless of what Comm Class says

**If statement_month NULL:**

→ **Verify carrierRaw is Being Captured**
- Should be full string like "Cigna - April 2026"
- Check normalization isn't stripping it down to just "Cigna"

**If members = 0:**

→ **Verify membersIdx Column Detection**
- Check header row has "Members" (case-insensitive)
- Verify shift logic applies to members column too

---

### Phase 3: Fix Statement Export

**File:** `src/pages/Payroll.js` generateStatement function

**Current (BROKEN):**
```javascript
fmtCsv(r.commission)  // Always shows commission field (wrong for ACA)
```

**Fixed:**
```javascript
const amount = r.lob === 'ACA' && r.producer_payable != null
  ? r.producer_payable
  : r.commission;
fmtCsv(amount)
```

**Also update the detail view table (line ~120-135)** to use same logic

---

### Phase 4: Test End-to-End

1. **Delete ALL existing Jun 2026 uploads**
2. **Re-upload May 30th statement**
3. **Query database immediately:**
   ```sql
   SELECT agent_name, COUNT(*), SUM(producer_payable)
   FROM commission_records
   WHERE lob = 'ACA' AND payment_period = '202606'
   GROUP BY agent_name;
   ```
4. **Expected:**
   - Patsy Pernia: 4 records, $162 total
   - Eduardo Pernia: 6 records, $50-64 total
   - Yahoska Perez: 4 records (won't show in Payroll)

5. **Check Payroll Page:**
   - Patsy should show $162
   - Eduardo should show $50-64 with chargebacks in details
   - Christian should show $100

6. **Download Patsy's statement:**
   - Should show correct amounts ($27, $54, $27, $54)
   - Should show "Cigna - April 2026" in Statement column
   - Should show 1, 2, 1, 2 in Lives column
   - Should show dates in Effective column

---

## 📝 Next Steps for Developer

1. **Read this entire document**
2. **Run database queries to verify current state**
3. **Identify which specific part is broken**
4. **Apply targeted fix (don't just re-upload)**
5. **Test with small sample first**
6. **Then do full re-upload**

---

## 🔗 Important Files

**Backend (Railway):**
- `routes/files.js` - Line ~850-1065 (parseNHPRows function)
- `routes/files.js` - Line ~1957 (where parseNHPRows is called)
- `routes/files.js` - Line ~2070-2120 (INSERT statement)

**Frontend (Netlify):**
- `src/pages/Payroll.js` - Line ~34-77 (generateStatement export)
- `src/pages/Payroll.js` - Line ~113-145 (detail table view)
- `src/pages/Payroll.js` - Line ~185-235 (filter + grouping logic)
- `src/pages/Payroll.js` - Line ~268-290 (exportAll function)

**Database:**
- Table: `commission_records`
- Key columns: `producer_payable`, `statement_month`, `members`, `lob`, `payment_period`, `classification`

---

## ⚠️ DO NOT

- ❌ Upload again without verifying deployments finished
- ❌ Test in production (use database queries first)
- ❌ Assume fixes worked without checking database
- ❌ Make multiple changes at once (test incrementally)

---

**End of Diagnostic Document**
