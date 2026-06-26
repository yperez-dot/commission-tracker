# Fix #6 COMPLETE: Sales Reconciliation Bugs (Karl Brown + Cheryl Lani Juarez)

## Problem Summary

**Two clients showing "Unpaid" despite being paid:**

### Karl Brown
- **Policy:** UHC 933986247
- **Agent:** Yahoska Perez
- **Paid in All Data:**
  - +$318.09 New Business
  - -$347 Chargeback
  - **Net:** -$28.91
- **Sales Recon shows:** Unpaid, Active, Duplicate rows
- **BOB status:** Termed (deceased)

### Cheryl Lani Juarez
- **Policy:** Humana 00025460911K
- **Agent:** Yahoska Perez
- **Paid in All Data:** $347 Agent Commission
- **Sales Recon shows:** Unpaid, Active, Duplicate rows

---

## Root Causes Identified

### 🔴 Issue #1: limit=100 WAY Too Small
**File:** `src/pages/Reconciliation.js` line 290

**Problem:**
```javascript
const commData = await apiFetch('/records?limit=100');
```

- Only fetching **100 commission records**
- OliComm has **1000+ commission records**
- Cheryl's $347 Agent Commission likely not in first 100
- Comment said "optimized: limit=100 instead of 5000" → UNDER-optimization!

**Impact:** Missing most commission records → false "Unpaid" for clients who were actually paid

---

### 🔴 Issue #2: commission > 0 Filter Excludes Chargebacks
**File:** `src/pages/Reconciliation.js` line 292

**Problem:**
```javascript
setCommissions((commData.records || []).filter(r => parseFloat(r.commission) > 0));
```

- Karl Brown's -$347 chargeback was **filtered out**
- Only positive commissions were kept
- Need **ALL records** (positive + negative) for complete picture

**Impact:** Chargebacks invisible → can't calculate net → shows "Unpaid" instead of "Net chargeback"

---

### 🔴 Issue #3: No Policy Number Matching
**File:** `src/pages/Reconciliation.js` findMatch() function

**Problem:**
- Only matched on: `client_name + carrier`
- If name normalization failed, no fallback
- Policy number not used at all

**Impact:** Name mismatches (even with compound surname fix) result in false "Unpaid"

---

### 🔴 Issue #4: Duplicate Display
**File:** `src/pages/Reconciliation.js` loadData()

**Problem:**
- No deduplication by client + policy + date
- MedicarePro CSV uploaded twice → duplicate rows

**Impact:** Same client appears multiple times

---

### 🔴 Issue #5: Termed/Deceased Status Not Showing
**File:** `routes/medicarepro.js` GET endpoint

**Problem:**
- No JOIN with `book_of_business` table
- Only showed CSV status (stale "Active")
- BOB status (current "Termed"/"Deceased") not fetched

**Impact:** Deceased clients show "Active" with "Mark Paid" button

---

## Fixes Applied

### ✅ Fix #6a: Compound Surname Matching (Commit 428e826)
- Applied Bug #1 normName() fix to Sales Reconciliation
- "Karl Brown" and "Cheryl Lani Juarez" now match correctly

### ✅ Fix #6b: Deduplication (Commit 428e826)
- Deduplicate by `client_name | policy_number | effective_date`
- Logs: "Sales deduplication: X → Y (removed Z duplicates)"

### ✅ Fix #6c: BOB Status Propagation (Commit 428e826)
- Backend: JOIN `medicarepro_sales` with `book_of_business`
- Returns: `bob_status`, `is_termed`, `deceased_date`
- Frontend: `resolveStatus()` prioritizes BOB status
- Red badge for Deceased/Termed
- "Mark Paid" button hidden for Deceased/Termed

### ✅ Fix #6d: Fetch ALL Commission Records (Commit a80eeeb)
**Changed:**
```javascript
// BEFORE:
const commData = await apiFetch('/records?limit=100');
setCommissions((commData.records || []).filter(r => parseFloat(r.commission) > 0));

// AFTER:
const commData = await apiFetch('/records?limit=50000');  // Fetch ALL
const allCommissions = commData.records || [];
console.log(`✅ Loaded ${allCommissions.length} commission records (including chargebacks)`);
setCommissions(allCommissions);  // NO filter - include chargebacks
```

**Impact:**
- Now fetches up to 50,000 commission records (vs 100)
- Includes chargebacks (negative amounts)
- Complete dataset for matching

### ✅ Fix #6e: Policy Number Fallback Matching (Commit a80eeeb)
**Added to findMatch():**
```javascript
const salePolicy = (sale.policy_number || '').trim().toLowerCase();
const commPolicy = (comm.policy_number || '').trim().toLowerCase();
const policyMatch = salePolicy && commPolicy && salePolicy === commPolicy;

// Match on: (name + carrier) OR (policy + carrier)
if ((clientMatch && carrierMatch) || (policyMatch && carrierMatch)) {
  return comm;
}
```

**Impact:**
- If name normalization fails, policy number can still match
- More robust matching

---

## Expected Results After Fix

### Karl Brown (UHC 933986247)
- ✅ **Found:** +$318.09 New Business record (limit increased)
- ✅ **Found:** -$347 Chargeback record (no longer filtered out)
- ✅ **Status:** "Termed" (from BOB, not "Active")
- ✅ **Display:** Single row (deduplicated)
- ✅ **Match:** Name matches via compound surname fix
- ✅ **Button:** No "Mark Paid" button (deceased/termed)

**Current behavior:** Shows "Paid" (found at least one commission)
**Future enhancement:** Show net -$28.91 and "Chargeback expected" label

### Cheryl Lani Juarez (Humana 00025460911K)
- ✅ **Found:** $347 Agent Commission (limit increased → in dataset)
- ✅ **Match:** Name + carrier OR policy + carrier
- ✅ **Display:** Single row (deduplicated)
- ✅ **Status:** Current BOB status (if any)

**Result:** Shows "Paid"

---

## Testing Checklist

### Test Karl Brown
- [ ] Search for "Karl Brown" in Sales Recon
- [ ] Verify shows "Paid" (not "Unpaid")
- [ ] Verify appears once (not twice)
- [ ] Verify status shows "Termed" (not "Active")
- [ ] Verify NO "Mark Paid" button
- [ ] Check console log: "Loaded X commission records (including chargebacks)" where X > 100

### Test Cheryl Lani Juarez
- [ ] Search for "Cheryl Lani Juarez" in Sales Recon
- [ ] Verify shows "Paid" (not "Unpaid")
- [ ] Verify appears once (not twice)
- [ ] Verify commission amount: $347

### General Verification
- [ ] Console shows "Loaded X records" where X is total commission count (not 100)
- [ ] No sales show "Unpaid" when they have matching commission records
- [ ] Deceased/Termed clients show red badge
- [ ] Deceased/Termed clients have no "Mark Paid" button

---

## Commits

1. **428e826** - Fix #6: Karl Brown Sales Reconciliation bugs (parts a, b, c)
2. **a80eeeb** - Fix #6 Part 2: Sales Recon matching improvements (parts d, e)

**Files modified:**
- `src/pages/Reconciliation.js` (normName, dedup, resolveStatus, limit, filter, policy matching)
- `routes/medicarepro.js` (JOIN with BOB)

---

## Future Enhancements

### Net Commission Display
Currently: Shows "Paid" if ANY commission found (first match)

**Proposed:** Calculate net of ALL matching commissions
- Karl Brown: +$318.09 - $347 = **-$28.91 net**
- Display: "Chargeback expected (-$28.91)" with red badge
- Especially important for deceased/termed clients

**Implementation:**
```javascript
function findMatch(sale, commissions) {
  const matches = commissions.filter(comm => 
    /* matching logic */
  );
  
  if (!matches.length) return null;
  
  const netCommission = matches.reduce((sum, m) => sum + parseFloat(m.commission), 0);
  
  return {
    matches,
    netCommission,
    hasChargeback: matches.some(m => parseFloat(m.commission) < 0),
    classification: netCommission >= 0 ? 'Paid' : 'Chargeback Expected'
  };
}
```

---

## Related Issues

- **Bug #1** (Compound Surnames): Already fixed (f9b7181) - applied to Sales Recon in Fix #6a
- **Manual Edit Feature**: Already deployed (f0b9b97) - can manually correct mis-classifications

---

## Deployment Status

✅ **Committed:** All fixes (428e826, a80eeeb)
⏳ **Pending:** Railway/Netlify deployment
⏳ **Testing:** Verify Karl Brown and Cheryl Lani Juarez after deployment

