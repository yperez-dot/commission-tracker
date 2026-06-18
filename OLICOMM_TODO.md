# OliComm - Feature Wishlist & Bug Fixes

**Last Updated:** 2026-06-17 9:18 PM EDT

---

## 🐛 Bug Fixes

### 1. MedicarePro Plan Type Bug (SUP Classification)
**Status:** 🔴 To Do  
**Priority:** High

**Problem:**
- Supplement and Dental/Vision policies are being classified as **SUP** instead of their correct type
- Plan type detection logic in MedicarePro parser needs fixing

**Impact:**
- Incorrect plan type reporting
- Supplement vs. Dental/Vision distinction lost

**Location:**
- File: `routes/medicarepro.js` (or wherever MedicarePro import is handled)
- Function: Plan type classification logic

**Fix Needed:**
- Review plan type detection rules
- Ensure Supplement → separate type (not SUP)
- Ensure Dental/Vision → separate type (not SUP)
- Verify against actual MedicarePro CSV columns

**Testing:**
- Upload MedicarePro file with Supplement policies
- Upload MedicarePro file with Dental/Vision policies
- Verify correct plan types in reconciliation view

---

## ✨ Feature Enhancements

### 2. Client Name Clickable Detail Popup (Override Recon)
**Status:** 🔴 To Do  
**Priority:** Medium

**Feature:**
When clicking a client name on Agency Override Reconciliation page, show a detail popup with:
- Statement name (original filename)
- Upload date
- Source of commission record

**Use Case:**
- "Where did this commission come from?"
- Quick lookup without navigating away
- Audit trail for commission records

**Implementation:**
```jsx
<td>
  <button 
    onClick={() => showClientDetail(record)}
    style={{ background: 'none', border: 'none', color: 'var(--blue)', textDecoration: 'underline', cursor: 'pointer' }}
  >
    {record.client_name}
  </button>
</td>

// Modal
{clientDetailOpen && (
  <div className="modal">
    <div className="modal-content">
      <h3>{clientDetail.client_name}</h3>
      <div><strong>Statement:</strong> {clientDetail.statement_name}</div>
      <div><strong>Uploaded:</strong> {formatDate(clientDetail.upload_date)}</div>
      <div><strong>Carrier:</strong> {clientDetail.carrier}</div>
      <div><strong>Agent:</strong> {clientDetail.agent_name}</div>
      <button onClick={() => setClientDetailOpen(false)}>Close</button>
    </div>
  </div>
)}
```

**Backend:**
- Commission records already have `upload_id`
- Need to JOIN with `uploads` table to get `original_name` and `uploaded_at`
- Return statement info in reconciliation API response

---

### 3. Missing Override Tab as Default
**Status:** 🔴 To Do  
**Priority:** Low

**Feature:**
When landing on Agency Override Reconciliation page, default to **"Missing Override"** tab instead of "All".

**Rationale:**
- Missing Override is the actionable tab
- "All" tab is primarily for reference
- Most common use case: "What overrides are missing?"

**Implementation:**
```jsx
// Current default
const [activeTab, setActiveTab] = useState('all');

// New default
const [activeTab, setActiveTab] = useState('missing');
```

**Location:**
- File: `src/pages/AgencyOverrideReconciliation.js` (or similar)
- Component state initialization

---

### 4. Filtered Count on Tab Labels (Override Recon)
**Status:** 🔴 To Do  
**Priority:** Medium

**Feature:**
When filtering by carrier (e.g., Freedom), update tab counts to show filtered results.

**Current Behavior:**
```
Missing Override (164)  ← shows total count
```

**Desired Behavior:**
```
Missing Override (7)  ← shows filtered count when carrier=Freedom
```

**Implementation:**
```jsx
// Calculate filtered counts
const allFiltered = allRecords.filter(matchesFilters);
const missingFiltered = missingRecords.filter(matchesFilters);
const matchedFiltered = matchedRecords.filter(matchesFilters);

// Update tab labels
<Tab label={`All (${allFiltered.length})`} />
<Tab label={`Missing Override (${missingFiltered.length})`} />
<Tab label={`Matched (${matchedFiltered.length})`} />
```

**Location:**
- File: `src/pages/AgencyOverrideReconciliation.js`
- Tab rendering logic

---

### 5. Soft Duplicate Message for Statements
**Status:** ✅ Complete (2026-06-17)  
**Priority:** N/A (Done)

**Feature:**
Softer, informative duplicate modal for commission statement uploads (reconciliation use case).

**Implementation:**
- Backend: Added `sourceType: 'statement'` to 409 response
- Frontend: Conditional modal header based on sourceType
- Blue info icon (ℹ️) instead of yellow warning (⚠️)
- Message: "These records already exist in OliComm... This may be a reconciliation copy"

**Deployed:** ✅ Production (commit `0ad005c`)

---

## 📊 Priority Summary

**High Priority:**
1. 🐛 MedicarePro Plan Type Bug (SUP classification)

**Medium Priority:**
2. ✨ Client Name Clickable Detail Popup
4. ✨ Filtered Count on Tab Labels

**Low Priority:**
3. ✨ Missing Override Tab as Default

**Complete:**
5. ✅ Soft Duplicate Message for Statements

---

## Implementation Notes

### MedicarePro Plan Type Fix
**Files to check:**
- `routes/medicarepro.js` - Import logic
- Look for plan type classification (SUP, MA, PDP, etc.)
- Check against actual MedicarePro CSV column headers

**Common plan types:**
- MA (Medicare Advantage)
- PDP (Prescription Drug Plan)
- MAPD (MA with Part D)
- Supplement / Medigap
- Dental
- Vision

### Client Detail Popup
**Backend changes:**
```javascript
// Add to reconciliation query
SELECT 
  cr.*,
  u.original_name as statement_name,
  u.uploaded_at as upload_date
FROM commission_records cr
LEFT JOIN uploads u ON cr.upload_id = u.id
WHERE ...
```

### Filtered Counts
**Frontend changes:**
```javascript
// Apply filters to each tab's data
const filteredData = useMemo(() => {
  return {
    all: allRecords.filter(matchesCurrentFilters),
    missing: missingRecords.filter(matchesCurrentFilters),
    matched: matchedRecords.filter(matchesCurrentFilters)
  };
}, [allRecords, missingRecords, matchedRecords, filters]);

// Use filtered counts in tab labels
<Tabs>
  <Tab label={`All (${filteredData.all.length})`} />
  <Tab label={`Missing Override (${filteredData.missing.length})`} />
  <Tab label={`Matched (${filteredData.matched.length})`} />
</Tabs>
```

---

**Total Items:** 5  
**Complete:** 1 ✅  
**In Progress:** 0  
**To Do:** 4 🔴

---

*This is a living document - update as items are completed or new items are added.*
