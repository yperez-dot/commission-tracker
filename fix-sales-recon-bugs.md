# Sales Reconciliation Bug Fixes - Karl Brown (UHC 933986247)

## Problem Summary

**Client:** Karl Brown  
**Policy:** UHC 933986247  
**Issues:**

1. **Payment not matching**: Has commission records (+$318.09 New Business, -$347 chargeback) but Sales Recon shows "Unpaid"
2. **Duplicate display**: Karl Brown appears twice in identical blocks
3. **Termed/deceased status not propagating**: Marked deceased in BOB, but Sales Recon shows "Active"

---

## Root Causes

### Issue #1: Payment Not Matching

**Problem:** `findMatch()` uses old `normName()` that sorts words alphabetically, breaking "Karl Brown" → "brown karl" matching

**Example:**
```javascript
// OLD normName() in Reconciliation.js (line 86-95)
function normName(name) {
  if (!name) return '';
  const s = String(name).toLowerCase().trim()
    .replace(/[,\.;:]/g, '');  // Strip punctuation
  const parts = s.split(/\s+/).filter(Boolean).sort(); // ❌ SORTS ALPHABETICALLY
  return parts.join(' ');
}

// Result:
normName("Karl Brown") → "brown karl"
normName("Brown, Karl") → "brown karl"  
// BUT commission record has "Karl Brown" (not sorted)
```

**Fix:** Apply compound surname fix from Bug #1 (already deployed to other pages)

---

### Issue #2: Duplicate Display

**Problem:** No deduplication in `loadData()` or rendering logic

**Likely cause:**
- MedicarePro CSV uploaded twice with same data
- OR multiple rows in `medicarepro_sales` table for same client/policy
- No UNIQUE constraint on (client_name, policy_number, effective_date)

**Fix:** Add deduplication before rendering:
```javascript
// After fetching sales:
const uniqueSales = Array.from(
  new Map(
    salesData.sales.map(sale => [
      `${sale.client_name}|${sale.policy_number}|${sale.effective_date}`,
      sale
    ])
  ).values()
);
```

---

### Issue #3: Termed/Deceased Status Not Propagating

**Problem:** Sales Recon only shows `medicarepro_sales.status` column value (from CSV upload)

**Issue:**
- MedicarePro CSV might have outdated status ("Active")
- BOB has current status ("Deceased")
- Frontend never checks BOB status

**Fix:** Enrich sales with BOB status before returning from API:

```sql
-- In GET /api/medicarepro endpoint
SELECT 
  ms.*,
  bob.status as bob_status,
  bob.is_termed,
  bob.deceased_date
FROM medicarepro_sales ms
LEFT JOIN book_of_business bob ON (
  LOWER(ms.client_name) = LOWER(bob.client_full_name) AND
  LOWER(ms.carrier) = LOWER(bob.carrier)
)
```

**Frontend logic:**
```javascript
// Use BOB status if available, otherwise CSV status
const status = sale.bob_status || sale.is_termed ? 'Termed' : (sale.status || 'Active');
```

---

## Implementation

### Step 1: Fix normName() in Reconciliation.js

**File:** `src/pages/Reconciliation.js` (line 86)

**Replace:**
```javascript
function normName(name) {
  if (!name) return '';
  const s = String(name).toLowerCase().trim()
    .replace(/[,\.;:]/g, '');
  const parts = s.split(/\s+/).filter(Boolean).sort();
  return parts.join(' ');
}
```

**With (compound surname fix):**
```javascript
function normName(name) {
  if (!name) return '';
  const s = String(name).trim();
  
  function toTitleCase(str) {
    return str.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
  }
  
  // Handle comma-separated "LAST, FIRST" format
  if (s.includes(',')) {
    let [last, first] = s.split(',').map(p => p.trim());
    last = last.replace(/\b(JR|SR|III|II|IV|V)\.?$/i, '').trim();
    const normalized = `${first} ${last}`.replace(/\s+/g, ' ').trim();
    return toTitleCase(normalized);
  }
  
  const normalized = s.replace(/\s+/g, ' ').trim();
  return toTitleCase(normalized);
}
```

---

### Step 2: Add Deduplication in loadData()

**File:** `src/pages/Reconciliation.js` (line 285, after `setSales(salesData.sales || []);`)

**Add:**
```javascript
// Deduplicate sales by client + policy + date
const uniqueSales = Array.from(
  new Map(
    (salesData.sales || []).map(sale => [
      `${sale.client_name}|${sale.policy_number}|${sale.effective_date}`,
      sale
    ])
  ).values()
);

console.log(`Sales deduplication: ${salesData.sales?.length || 0} → ${uniqueSales.length}`);
setSales(uniqueSales);
```

---

### Step 3: Enrich with BOB Status in Backend

**File:** `routes/medicarepro.js` (line 220, in GET endpoint)

**Replace:**
```javascript
let query = 'SELECT * FROM medicarepro_sales WHERE 1=1';
```

**With:**
```javascript
let query = `
  SELECT 
    ms.*,
    bob.status as bob_status,
    bob.is_termed,
    bob.deceased_date,
    bob.resolution
  FROM medicarepro_sales ms
  LEFT JOIN book_of_business bob ON (
    LOWER(TRIM(ms.client_name)) = LOWER(TRIM(bob.client_full_name)) AND
    LOWER(TRIM(ms.carrier)) = LOWER(TRIM(bob.carrier))
  )
  WHERE 1=1
`;
```

**Also update count query (line 240):**
```javascript
let countQuery = 'SELECT COUNT(*) as count FROM medicarepro_sales ms WHERE 1=1';
```

---

### Step 4: Update Frontend Status Display

**File:** `src/pages/Reconciliation.js` (line 515, in export logic and line 746/889 in render)

**Add helper function after normName():**
```javascript
function resolveStatus(sale) {
  // Priority: BOB status > Termed flag > CSV status
  if (sale.bob_status === 'deceased' || sale.deceased_date) return 'Deceased';
  if (sale.is_termed) return 'Termed';
  if (sale.bob_status) return sale.bob_status;
  return sale.status || 'Active';
}
```

**Update CSV export (line 515):**
```javascript
const status = resolveStatus(m.sale);
```

**Update table render (line 746 and 889):**
```javascript
<td className={resolveStatus(m.sale) === 'Deceased' || resolveStatus(m.sale) === 'Termed' ? 'cell-red' : ''}>
  {resolveStatus(m.sale)}
</td>
```

**Add CSS for termed/deceased styling:**
```css
.cell-red {
  color: #dc2626;
  font-weight: 600;
}
```

---

## Testing Plan

### Test Case: Karl Brown (UHC 933986247)

**Before Fix:**
- [ ] Shows "Unpaid" despite +$318.09/-$347 commission records
- [ ] Appears twice (duplicate)
- [ ] Shows "Active" instead of "Deceased"

**After Fix:**
- [ ] Should show "Paid" (matches to commission records)
- [ ] Should appear once (deduplicated)
- [ ] Should show "Deceased" status (from BOB)
- [ ] Should NOT show "Mark Paid" button if deceased/termed

---

## Expected Results

1. **Payment Matching:** Karl Brown's +$318.09 New Business and -$347 chargeback match correctly → shows "Paid"
2. **Deduplication:** Only one Karl Brown row appears
3. **Status:** Shows "Deceased" (from BOB), not "Active" (from stale CSV)

---

## Database Check

```sql
-- Verify Karl Brown's data
SELECT 
  client_name, 
  policy_number, 
  effective_date, 
  status, 
  agent_name,
  carrier
FROM medicarepro_sales
WHERE LOWER(client_name) LIKE '%karl%brown%'
  AND policy_number = '933986247';

-- Check BOB status
SELECT 
  client_full_name,
  carrier,
  status,
  is_termed,
  deceased_date,
  resolution
FROM book_of_business
WHERE LOWER(client_full_name) LIKE '%karl%brown%';

-- Check commission records
SELECT 
  client_full_name,
  carrier,
  commission,
  classification,
  payment_period,
  effective_date
FROM commission_records
WHERE LOWER(client_full_name) LIKE '%karl%brown%'
  AND carrier ILIKE '%uhc%';
```

---

## Deployment Order

1. ✅ Apply normName() fix (uses compound surname logic)
2. ✅ Add deduplication in frontend
3. ✅ Update backend to join BOB data
4. ✅ Add resolveStatus() helper in frontend
5. ✅ Test with Karl Brown case
6. ✅ Verify no regressions on other sales

---

## Related Fixes

- **Bug #1 (Compound Surnames):** Already deployed (f9b7181)
- **Manual Edit Feature:** Already deployed (f0b9b97)
- This fix applies the same normName() logic to Sales Reconciliation

