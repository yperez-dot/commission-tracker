# 🚨 MANDATORY PARSER DEVELOPMENT RULES

**Established:** June 18, 2026  
**Status:** MANDATORY - No exceptions

---

## Why These Rules Exist

**Today's preventable issues:**
- ❌ Devoted PDF: Parsed Summary table instead of Transactions table
- ❌ Devoted PDF: Wrong regex pattern (didn't handle multi-line format)
- ❌ Oscar IFP: Wrong column name case (`Subscriber name` vs `Member Name`)
- ❌ Syntax error: Missing comma crashed production backend

**All would have been caught by following this workflow.**

---

## 🚨 5-STEP MANDATORY WORKFLOW

### Before writing ANY new parser or modifying existing one:

---

### ✅ Step 1: Extract Raw Data

**Show me the first 5 rows EXACTLY as the parser will see them.**

**Must include:**
- Column names (exact spelling and case)
- Sample values (actual data from file)
- Data types (string, number, date format)

**❌ NO assumptions**  
**❌ NO guessing**

**Example:**
```
Columns from Excel sheet "Commission Transactions":
- Member Name (string): "TORRES,LILIA"
- Commission (string): "$28.91"
- Commission month (string): "2025-12-01"
- Block Reason (string): "" (empty)
- Policy Number (string): "H1234567890"
```

---

### ✅ Step 2: Submit Mapping Plan

**Format:**
```
| File Column       | OliComm Field    | Example        | Notes           |
|-------------------|------------------|----------------|-----------------|
| Member Name       | client           | "TORRES,LILIA" | -               |
| Commission        | commission       | "$28.91"       | strip $         |
| Commission month  | payment_period   | "2025-12-01"   | YYYY-MM-DD → YYYYMM |
| Policy Number     | policy_number    | "H1234567890"  | -               |
| Block Reason      | (skip logic)     | ""             | skip if commission=0 AND reason!='' |
```

**Include:**
- Every relevant column
- Transformation notes
- Skip conditions
- Default values

---

### ✅ Step 3: Show Expected Output

**Format:** `X records · $Y total · carrier Z · period YYYYMM`

**Example:**
```
Expected output:
- 436 records
- $12,631.96 total commission
- carrier: Devoted
- period: 202603
- LOB: MA
```

---

### ✅ Step 4: Wait for Approval

**❌ NO CODE WRITTEN until mapping is confirmed**

Wait for explicit approval:
- ✅ "Approved - proceed"
- ✅ "Good to code"
- ✅ "✓ Mapping confirmed"

**Only then can you start coding the parser.**

---

### ✅ Step 5: Syntax Check Before Push

**Before EVERY commit to `routes/files.js`:**

```bash
node -c routes/files.js
```

**Must show:** No output (silent = pass)

**If syntax error:** ❌ **DO NOT PUSH**  
Fix the error, check again, then push.

**Chain with push:**
```bash
node -c routes/files.js && git push
```

If syntax check fails, push is automatically blocked.

---

## 🎯 This Rule Applies To:

- ✅ New parsers (UHC, Devoted, Oscar, Molina, etc.)
- ✅ Existing parser modifications
- ✅ PDF parsers
- ✅ Excel/CSV parsers
- ✅ Column mapping changes
- ✅ Regex pattern updates
- ✅ **Everything that touches parser logic**

---

## ❌ What Happens If You Skip This Workflow

**Consequences of not following these steps:**

1. **Wrong data parsed** → Hours wasted debugging
2. **Production crashes** → Backend down, users affected
3. **Wrong table/sheet** → 0 records parsed
4. **Wrong column names** → All records skipped
5. **Syntax errors** → Deployment failures, restart loops

**Time cost:** 2-3 hours of firefighting vs 5 minutes of planning

---

## ✅ Benefits of Following This Workflow

- **Catch errors before coding** (save hours)
- **Validate assumptions early** (no surprises)
- **Clear documentation** (mapping table = reference)
- **Prevent production crashes** (syntax check catches errors)
- **Faster development** (less debugging, less rework)

---

## 📝 Example: Full Workflow

### Step 1: Raw Data
```
File: commission_statement_706381_2026-06-18.xlsx
Sheet: "Commission Transactions"

First 5 rows:
1. Writing Agent Name: "Katy Robles" | Commission: "$125.50" | Plan Type: "AARPMODMEDSUP" | Period: "202606"
2. Writing Agent Name: "Katy Robles" | Commission: "$82.00" | Plan Type: "Part D - PDP" | Period: "202606"
3. Writing Agent Name: "Katy Robles" | Commission: "$150.00" | Plan Type: "MAPD" | Period: "202606"
```

### Step 2: Mapping Plan
```
| File Column          | OliComm Field    | Example           | Notes                    |
|----------------------|------------------|-------------------|--------------------------|
| Writing Agent Name   | agent            | "Katy Robles"     | normalizeAgentName()     |
| Commission           | commission       | "$125.50"         | parseFloat, strip $      |
| Plan Type            | plan_type        | "AARPMODMEDSUP"   | Filter: include only MedSup/PartD |
| Plan Type            | lob              | "AARPMODMEDSUP"   | MedSup or PDP            |
| Period               | payment_period   | "202606"          | Already YYYYMM format    |

FILTER LOGIC:
- INCLUDE: AARPMODMEDSUP, Part D, PDP
- SKIP: MAPD, DSNP, CSNP (avoid BSI duplicates)
```

### Step 3: Expected Output
```
Expected: 85 records · $8,500.00 · carrier UnitedHealthcare · period 202606
```

### Step 4: Approval
```
✅ Mapping confirmed - proceed with parser
```

### Step 5: Syntax Check
```bash
$ node -c routes/files.js
(no output = pass)
$ git push
```

---

## 🔄 Updating This Document

This document should be updated whenever:
- New parser patterns emerge
- Common mistakes are identified
- Workflow improvements are found

**Last updated:** June 18, 2026

---

## 🛡️ DEFENSIVE CODING RULES (Frontend)

**Established:** June 19, 2026  
**Status:** MANDATORY - Apply to ALL new code

### Why These Rules Exist

**Today's crash:**
- ❌ AgencyProductionRecon.js line 631: `filtered.plandenied.length`
- ❌ `filtered.plandenied` was undefined → entire app crashed
- ❌ Would have been prevented by null-check: `(filtered.plandenied || []).length`

**One undefined property crashed the entire OliComm frontend.**

---

### 🚨 Rule 1: Always Null-Check Arrays

**❌ NEVER:**
```javascript
someArray.length
someArray.map(...)
someArray.filter(...)
someArray.reduce(...)
[...someArray, ...otherArray]
```

**✅ ALWAYS:**
```javascript
(someArray || []).length
(someArray || []).map(...)
(someArray || []).filter(...)
(someArray || []).reduce(..., initialValue)
[...(someArray || []), ...(otherArray || [])]
```

**Why:** If API returns `undefined` instead of `[]`, the app crashes.

---

### 🚨 Rule 2: Always Null-Check API Responses

**❌ NEVER:**
```javascript
const data = await apiFetch('/endpoint');
setRecords(data.records);
const count = data.records.length;
```

**✅ ALWAYS:**
```javascript
const data = await apiFetch('/endpoint');
setRecords(data?.records || []);
const count = (data?.records || []).length;
```

**Why:** API errors or missing fields can return `undefined` instead of expected structure.

---

### 🚨 Rule 3: Add Try-Catch to Data Loading

**❌ NEVER:**
```javascript
const loadData = async () => {
  const data = await apiFetch('/endpoint');
  setRecords(data.records);
};
```

**✅ ALWAYS:**
```javascript
const loadData = async () => {
  try {
    const data = await apiFetch('/endpoint');
    setRecords(data?.records || []);
  } catch (err) {
    console.error('Failed to load data:', err);
    setRecords([]); // Fallback to empty array
    showToast('Failed to load data', 'error');
  }
};
```

**Why:** Network errors or API failures shouldn't crash the entire page.

---

### 🚨 Rule 4: Test Every Page After Deploy

**Before marking deploy as complete, manually verify:**

✅ Missing Renewals loads  
✅ BOB loads  
✅ All Data loads  
✅ Override Recon loads  
✅ Agency Production Recon loads  
✅ Payroll loads  
✅ Reports loads  

**Quick test:** Click each page, verify no console errors, verify data displays.

**Time cost:** 2 minutes  
**Crash prevention:** Priceless

---

### 🚨 Rule 5: Never Push Friday Evening

**❌ NO deploys after 5pm Friday**

**Why:** No one available to fix crashes over the weekend 😄

**Exception:** Critical hotfixes (with immediate testing)

---

### ✅ Pre-Commit Checklist (Frontend)

Before committing frontend changes:

```bash
# 1. Build check
npm run build

# 2. Manual test
# Open each affected page in browser
# Verify no console errors
# Verify data loads correctly

# 3. Check for naked array accesses
grep -r "\.length\|.map(\|.filter(" src/pages/YourFile.js
# Review each match - is it null-safe?

# 4. Commit only if all checks pass
git add .
git commit -m "Your message"
git push
```

---

### 📋 Common Patterns to Fix

#### Pattern 1: Tab Counts
```javascript
// ❌ BAD:
<button>Missing ({filtered.missing.length})</button>

// ✅ GOOD:
<button>Missing ({(filtered.missing || []).length})</button>
```

#### Pattern 2: Spread Operators
```javascript
// ❌ BAD:
const combined = [...array1, ...array2];

// ✅ GOOD:
const combined = [...(array1 || []), ...(array2 || [])];
```

#### Pattern 3: Export Data
```javascript
// ❌ BAD:
const dataToExport = filtered.missing;

// ✅ GOOD:
const dataToExport = filtered.missing || [];
```

#### Pattern 4: Conditional Display
```javascript
// ❌ BAD:
const displayData = tab === 'missing' ? filtered.missing : filtered.paid;

// ✅ GOOD:
const displayData = tab === 'missing' ? (filtered.missing || []) : (filtered.paid || []);
```

---

### 🔍 How to Find Unsafe Code

**Search for naked array operations:**
```bash
# Find potential unsafe array accesses
grep -n "\.length" src/pages/*.js | grep -v "|| \[\]"
grep -n "\.map(" src/pages/*.js | grep -v "|| \[\]"
grep -n "\.filter(" src/pages/*.js | grep -v "|| \[\]"
```

**Review each match and add null-checks where needed.**

---

### 📊 Impact

**Before defensive coding:**
- 1 undefined property → entire app crashes
- User sees blank screen
- No error recovery

**After defensive coding:**
- 1 undefined property → empty array
- User sees "No data" instead of crash
- App continues working

---

### 🎯 Apply These Rules To:

- ✅ All new page components
- ✅ All API response handling
- ✅ All array operations
- ✅ All data transformations
- ✅ All export functions
- ✅ All filter/map/reduce chains

**No exceptions.**

---

## 📚 Related Documents

- `PRE_PUSH_CHECKLIST.md` - Syntax check workflow
- `routes/files.js` - Parser implementations
- `src/pages/AgencyProductionRecon.js` - Today's crash (fixed)
- `memory/2026-06-18.md` - Parser incidents
- `memory/2026-06-19.md` - Frontend defensive coding

---

**Remember:**  
**Backend:** Plan first. Code second. Test before push.  
**Frontend:** Null-check everything. Test every page. Never trust API responses. ✅

**Last updated:** June 19, 2026
