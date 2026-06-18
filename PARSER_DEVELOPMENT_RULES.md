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

## 📚 Related Documents

- `PRE_PUSH_CHECKLIST.md` - Syntax check workflow
- `routes/files.js` - Parser implementations
- `memory/2026-06-18.md` - Today's parser incidents

---

**Remember:** Plan first. Code second. Test before push. ✅
