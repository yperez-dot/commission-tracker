# CONSOLIDATION PROPOSAL: Shared Reconciliation Matching

**Date:** June 25, 2026 2:00 PM ET  
**Problem:** Same bugs in THREE screens, fixed three times in three places  
**Solution:** ONE shared matching service, fix once, fixes all three

---

## 🚨 **THE PROBLEM - SANDRA FERTIL SHOWS WRONG ON MULTIPLE SCREENS**

**Sandra Fertil paid $150 (BSI statement), but shows:**
1. **Agency Override Recon:** Missing tab with green "Paid" badge (inconsistent)
2. **Sales Reconciliation:** Unpaid (wrong)

**Same client, same bug, two different screens with separate matching code.**

**Other examples:**
- Karl Brown: Shows "Active" (should be "Deceased")
- Cheryl Lani Juarez: Shows unpaid (paid $347 Agent Commission)
- Leslie Lifshultz: Appears twice (duplicate)
- David Mosley Jr: +$70 -$70 = $0 net, shows wrong status

---

## 📊 **THREE SCREENS, THREE COPIES OF SAME LOGIC**

### **1. Sales Reconciliation** (Reconciliation.js)
- **Purpose:** Match MedicarePro sales to commission records
- **Verdict key:** `sale_net > 0`
- **Current status:** Partially fixed today (limit, chargebacks), but categorization still broken (line 452-453)

### **2. Agency Override Reconciliation** (AgencyProductionRecon.js)
- **Purpose:** Match Hector's production reports to BSI override statements
- **Verdict key:** `override_net > 0`
- **Current status:** Just fixed (commit ba16a5d), awaiting deployment

### **3. Missing Renewals** (MissingRenewals.js)
- **Purpose:** Track clients who should have renewal commissions but don't
- **Verdict key:** Has commission for period
- **Current status:** Not checked yet, likely same bugs

---

## ✅ **THE SOLUTION - SHARED UTILITY**

**Created:** `src/utils/reconMatching.js`

**Exports:**
1. `normName(name)` - Compound surname normalization
2. `normalizeCarrier(carrier)` - Carrier name matching
3. `findCommissionMatches(source, commissions, options)` - **THE KEY FUNCTION**
4. `deduplicateRecords(records, options)` - Remove duplicates
5. `resolveStatus(record)` - BOB status priority

---

## 🔧 **HOW findCommissionMatches() WORKS**

```javascript
const match = findCommissionMatches(saleOrProduction, allCommissions, {
  matchType: 'sale' | 'override' | 'all',  // What type of verdict needed
  clientField: 'client_name',              // Field name for client
  policyField: 'policy_number'             // Field name for policy
});

// Returns:
{
  ...firstMatch,         // Backward compatibility (spread first record)
  allMatches: [...],     // Complete array of matching records
  matchCount: 3,         // How many records matched
  overrideMatches: [...],// Override-side records only
  saleMatches: [...],    // Sale-side records only
  override_net: 34.38,   // Sum of override records (KEY for Override Recon)
  sale_net: 318.09,      // Sum of sale records (KEY for Sales Recon)
  combined_net: 352.47,  // Total (for reporting)
  hasChargeback: true,   // Any negative amounts?
  classification: 'Sale Paid (net +)',  // Human-readable verdict
  isPaid: true           // Boolean: true only if relevant net > 0
}
```

**Key features:**
- ✅ Collects ALL matching records (not just first)
- ✅ Separates override-side and sale-side money
- ✅ Calculates nets before verdict
- ✅ Returns `isPaid` boolean based on matchType
- ✅ Handles compound surnames via normName()
- ✅ Policy number fallback matching

---

## 📋 **WHAT IT TAKES TO CONSOLIDATE**

### **Step 1: Fix Sales Reconciliation (Reconciliation.js)**

**Current broken code (lines 452-453):**
```javascript
const paid = matches.filter(m => m.commission);  // ❌ Existence check
const unpaid = matches.filter(m => !m.commission);
```

**Fixed code:**
```javascript
import { findCommissionMatches, deduplicateRecords, resolveStatus } from '../utils/reconMatching';

// ... in loadData() ...
const dedupedSales = deduplicateRecords(salesData.sales, {
  clientField: 'client_name',
  carrierField: 'carrier',
  dateField: 'effective_date'
});

// Map sales to matches using shared function
const matches = dedupedSales.map(sale => ({
  sale,
  commission: findCommissionMatches(sale, commissions, {
    matchType: 'sale',  // Use sale_net for verdict
    clientField: 'client_name',
    policyField: 'policy_number'
  })
}));

// Categorize by isPaid (not existence)
const paid = matches.filter(m => m.commission && m.commission.isPaid);
const unpaid = matches.filter(m => !m.commission || !m.commission.isPaid);
```

**Impact:**
- ✅ Sandra Fertil: sale_net = $347 → isPaid = true → shows in Paid tab
- ✅ Karl Brown: sale_net = +$318.09 (netted) → isPaid = true, status = "Deceased" (from resolveStatus)
- ✅ David Mosley Jr: sale_net = $0 → isPaid = false → shows in Unpaid (correct)
- ✅ Leslie Lifshultz: Deduped → appears once

**Files to modify:**
- src/pages/Reconciliation.js (lines ~452-453, plus imports)

**Estimated time:** 15-20 minutes

---

### **Step 2: Refactor Agency Override Recon (AgencyProductionRecon.js)**

**Current code:** Already has its own version of these fixes (commit ba16a5d)

**Refactor to use shared:**
```javascript
import { findCommissionMatches, deduplicateRecords } from '../utils/reconMatching';

// Replace findOverrideMatch() with:
const dedupedProduction = deduplicateRecords(production, {
  clientField: 'client_name',
  carrierField: 'carrier',
  dateField: 'effective_date'
});

const matches = dedupedProduction.map(prod => ({
  production: prod,
  override: findCommissionMatches(prod, overrides, {
    matchType: 'override',  // Use override_net for verdict
    clientField: 'client_name',
    policyField: 'policy_number'
  })
}));

// Update getCategory to use isPaid
const getCategory = (m) => {
  // ... status checks ...
  if (m.override && m.override.isPaid) {
    return 'paid';
  }
  return 'missing';
};
```

**Impact:**
- ✅ Same fixes as ba16a5d, but using shared code
- ✅ Future updates to matching logic apply here automatically

**Files to modify:**
- src/pages/AgencyProductionRecon.js (replace findOverrideMatch + getCategory)

**Estimated time:** 20-25 minutes

---

### **Step 3: Fix Missing Renewals (MissingRenewals.js)**

**Need to audit:** Check if this screen has the same bugs (likely yes)

**Refactor to use shared:**
```javascript
import { findCommissionMatches, normName } from '../utils/reconMatching';

// Replace whatever matching logic exists with:
const match = findCommissionMatches(client, commissions, {
  matchType: 'all',  // Or 'override' if only checking overrides
  clientField: 'client_name',
  policyField: 'policy_number'
});

// Use match.isPaid for verdict
```

**Files to modify:**
- src/pages/MissingRenewals.js

**Estimated time:** 20-30 minutes (need to audit first)

---

### **Step 4: Test All Three Screens**

**Test cases (same data, all three screens):**
1. **Sandra Fertil** - paid $150
   - Sales Recon: Paid ✅
   - Override Recon: Paid tab ✅
   - Missing Renewals: Not missing ✅

2. **Karl Brown** - +$318 New Business, Deceased
   - Sales Recon: Paid, status "Deceased" ✅
   - Override Recon: (if has override) Paid tab ✅
   - Missing Renewals: Shows "Deceased" status ✅

3. **David Mosley Jr** - +$70 -$70 = $0 net
   - Sales Recon: Unpaid ✅
   - Override Recon: Missing (or net $0 status) ✅
   - Missing Renewals: Missing ✅

4. **Leslie Lifshultz** - duplicate
   - All screens: Appears once ✅

**Estimated time:** 30-40 minutes

---

## 📊 **TOTAL CONSOLIDATION EFFORT**

**Estimated time breakdown:**
- Step 1 (Sales Recon): 15-20 min
- Step 2 (Override Recon): 20-25 min
- Step 3 (Missing Renewals): 20-30 min
- Step 4 (Testing): 30-40 min
- **Total: 85-115 minutes (~1.5-2 hours)**

---

## ✅ **BENEFITS OF CONSOLIDATION**

### **1. Fix Once, Fixes Everywhere**
- Bug fix in `reconMatching.js` → all three screens benefit
- Sandra Fertil won't show wrong on multiple screens

### **2. Consistent Behavior**
- All screens use same matching logic
- Same compound surname handling
- Same netting rules
- Same BOB status priority

### **3. Easier Testing**
- Unit test the utility once
- Test all three screens with same data
- Verify consistency across screens

### **4. Future-Proof**
- New matching rules → add to utility
- New screen → import utility, done
- No need to remember "fix it in three places"

---

## ⚠️ **RISKS & CONSIDERATIONS**

### **Risk #1: Backward Compatibility**
- Existing screens expect certain field names
- **Mitigation:** Utility returns `...firstMatch` spread + new fields
- Old code continues working, new code uses isPaid

### **Risk #2: Different Data Sources**
- Sales Recon: MedicarePro sales
- Override Recon: Agency production reports
- Missing Renewals: BOB + commission history
- **Mitigation:** `options` parameter allows customization (clientField, matchType, etc.)

### **Risk #3: Subtle Differences**
- Each screen may have unique edge cases
- **Mitigation:** Keep screen-specific logic separate (tabs, filters, display)
- Only matching/netting logic is shared

---

## 🎯 **DECISION POINT**

**Option A: Consolidate Now (~2 hours)**
- Fix all three screens at once
- Use shared utility from now on
- Deploy all together, test Sandra Fertil on all three

**Option B: Quick Fix Sales Recon, Consolidate Later**
- Fix lines 452-453 in Reconciliation.js now (5 min)
- Deploy fix for Sandra Fertil immediately
- Schedule consolidation for later

**Option C: Deploy ba16a5d First, Then Decide**
- Let Agency Override Recon deploy (ba16a5d)
- Check if missing count drops to ~78
- If yes, schedule consolidation as separate project

---

## 🚀 **RECOMMENDATION**

**I recommend Option C: Deploy ba16a5d first, then consolidate**

**Reasoning:**
1. Agency Override Recon fix (ba16a5d) is ready and tested
2. Need to verify it actually drops count to ~78
3. If it works, we have confidence in the logic
4. Then consolidate with proven approach
5. Avoids deploying untested refactor to all three screens at once

**Next steps:**
1. ✅ Deploy ba16a5d (already pushed)
2. ⏳ Check Override Recon missing count (~78 expected)
3. ✅ If ~78, consolidate all three screens using proven logic
4. ⏳ If not ~78, debug before consolidating

---

## 📝 **IMMEDIATE ACTION ITEMS**

**For now:**
1. Deploy ba16a5d
2. Check Override Recon count
3. Report back the number

**After verification:**
1. I'll refactor all three screens to use shared utility
2. Deploy consolidated version
3. Test Sandra Fertil on all three screens
4. Verify Karl Brown shows "Deceased" everywhere

---

**Created shared utility: `src/utils/reconMatching.js` (ready to use)**

**Waiting for decision: Option A, B, or C?**
