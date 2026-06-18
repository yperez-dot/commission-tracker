# Missing Renewals - Frontend Implementation Spec

**Phase 1 Progress:** Steps 1-2 Complete ✅  
**Remaining:** Steps 4-8 (Frontend changes)  
**Skipped:** Step 3 (query update - will align with BOB logic in next session)

---

## What's Already Done ✅

1. **Database:** `policy_status` table created
2. **API:** `PUT /api/bob/policy-status` endpoint added

---

## Frontend Changes Needed

### 4. Row Action Buttons on Each Missing Row

**Location:** `src/pages/MissingRenewals.js` - Table row rendering

**Current structure:**
```jsx
<tr key={i} style={{ background: r.isMissing ? '#FFF8F5' : 'transparent' }}>
  <td>...</td>
  <td>{i+1}</td>
  <td>{r.agent}</td>
  <td>{r.carrier}</td>
  <td><button onClick={() => openClient(r)}>{r.client}</button></td>
  <td>{prettifyDate(r.effectiveDate)||'—'}</td>
  <td>{r.isMissing ? '$0.00' : fmt(r.commission)}</td>
  <td>
    {r.isMissing
      ? <span className="badge badge-red">Missing</span>
      : <span className="badge badge-green">Paid</span>}
  </td>
  <td>{r.monthsMissing > 0 ? <span>{r.monthsMissing} mo</span> : '—'}</td>
</tr>
```

**New structure (add actions column):**
```jsx
<thead>
  <tr>
    <th style={{ width:8 }}></th>
    <th>#</th>
    <th>Agent</th>
    <th>Carrier</th>
    <th>Client</th>
    <th>Effective date</th>
    <th>Last Paid</th>  {/* NEW COLUMN */}
    <th>Commission</th>
    <th>Status</th>
    <th>Months missing</th>
    <th style={{ width: 140 }}>Actions</th>  {/* NEW COLUMN */}
  </tr>
</thead>

<tbody>
  {filtered.map((r, i) => (
    <tr key={i} style={{ background: r.isMissing ? '#FFF8F5' : 'transparent' }}>
      <td style={{ padding:'4px 6px' }}>
        {r.isMissing && <span style={{ display:'block',width:3,height:'100%',background:'var(--red)',borderRadius:2 }}></span>}
      </td>
      <td style={{ color:'var(--text-muted)',fontSize:11 }}>{i+1}</td>
      <td style={{ fontWeight:400 }}>{r.agent}</td>
      <td style={{ fontSize:12 }}>{r.carrier}</td>
      <td>
        <button onClick={() => openClient(r)} style={{ background:'none',border:'none',cursor:'pointer',color:'var(--accent-dark)',fontWeight:500,padding:0,textDecoration:'underline',fontSize:12,textAlign:'left' }}>
          {r.client}
        </button>
      </td>
      <td style={{ fontSize:12,color:'var(--text-muted)' }}>{prettifyDate(r.effectiveDate)||'—'}</td>
      
      {/* NEW: Last Paid column */}
      <td style={{ fontSize:12,color:'var(--text-muted)' }}>
        {formatPeriodLabel(r.lastPaidPeriod) || '—'}
      </td>
      
      <td style={{ fontWeight:500,color:r.isMissing?'var(--text-muted)':'var(--green)' }}>
        {r.isMissing ? '$0.00' : fmt(r.commission)}
      </td>
      <td>
        {/* Updated Status display with policy_status */}
        {r.policyStatus === 'chase' && (
          <span className="badge badge-amber">🔍 Chasing</span>
        )}
        {r.policyStatus === 'ignore' && (
          <span className="badge badge-gray">🙈 Ignored</span>
        )}
        {(!r.policyStatus || r.policyStatus === 'active') && (
          r.isMissing
            ? <span className="badge badge-red">Missing</span>
            : <span className="badge badge-green">Paid</span>
        )}
      </td>
      <td style={{ fontSize:12,color:'var(--text-muted)' }}>
        {/* Fixed Months Missing display */}
        {r.lastPaidPeriod === null && !r.isMissing
          ? <span className="badge badge-blue">New</span>
          : r.monthsMissing > 0
            ? <span style={{ color:'var(--red)',fontWeight:500 }}>{r.monthsMissing} mo</span>
            : '—'
        }
      </td>
      
      {/* NEW: Action buttons (only show on missing rows) */}
      <td style={{ fontSize:11 }}>
        {r.isMissing && (!r.policyStatus || r.policyStatus === 'active') && (
          <div style={{ display:'flex',gap:4 }}>
            <button
              onClick={() => updatePolicyStatus(r, 'termed')}
              style={{ padding:'3px 8px',fontSize:10,background:'var(--red)',color:'#fff',border:'none',borderRadius:4,cursor:'pointer',fontWeight:500 }}
            >
              Termed
            </button>
            <button
              onClick={() => updatePolicyStatus(r, 'chase')}
              style={{ padding:'3px 8px',fontSize:10,background:'var(--amber)',color:'#fff',border:'none',borderRadius:4,cursor:'pointer',fontWeight:500 }}
            >
              Chase
            </button>
            <button
              onClick={() => updatePolicyStatus(r, 'ignore')}
              style={{ padding:'3px 8px',fontSize:10,background:'var(--text-muted)',color:'#fff',border:'none',borderRadius:4,cursor:'pointer',fontWeight:500 }}
            >
              Ignore
            </button>
          </div>
        )}
      </td>
    </tr>
  ))}
</tbody>
```

---

### Add updatePolicyStatus Function

```javascript
async function updatePolicyStatus(row, status) {
  try {
    await apiFetch('/bob/policy-status', {
      method: 'PUT',
      body: JSON.stringify({
        client: row.client,
        carrier: row.carrier,
        agent: row.agent,
        status: status,
        notes: null
      })
    });
    
    // Refresh the data
    await loadMissingRenewals();
    
    if (status === 'termed') {
      // Row will disappear on refresh
    } else if (status === 'chase') {
      alert('✅ Marked as chasing - will stay on list with badge');
    } else if (status === 'ignore') {
      // Row will be filtered out on refresh
    }
  } catch (err) {
    alert(`Error: ${err.message}`);
  }
}
```

---

### 5. Last Paid Column - ALREADY SPECIFIED ABOVE

Added between "Effective date" and "Commission" columns.

Format: `formatPeriodLabel(r.lastPaidPeriod)` (already exists in file)
- Example: `202604` → `Apr 2026`

---

### 6. Fix Months Missing Display

**Current issue:** Shows `—` when calculation fails

**New logic:**
```javascript
{r.lastPaidPeriod === null && !r.isMissing
  ? <span className="badge badge-blue">New</span>  // Never paid before (new enrollment)
  : r.monthsMissing > 0
    ? <span style={{ color:'var(--red)',fontWeight:500 }}>{r.monthsMissing} mo</span>
    : '—'
}
```

---

### 7. Add Scrollbar with Sticky Header

**Location:** Table container div

**Current:**
```jsx
<div style={{ overflowX:'auto' }}>
  <table>...</table>
</div>
```

**New:**
```jsx
<div style={{ 
  overflowX:'auto',
  overflowY:'auto',
  maxHeight:'calc(100vh - 280px)'
}}>
  <table>
    <thead style={{ position:'sticky', top:0, background:'var(--bg)', zIndex:1 }}>
      ...
    </thead>
    ...
  </table>
</div>
```

---

### 8. Filter Count Update

**Location:** Summary bar rendering

**Current:**
```javascript
const totalCommission = filtered.filter(r => !r.isMissing).reduce((s,r) => s+(parseFloat(r.commission)||0), 0);

// Summary bar shows:
Total rows: {rows.length} | Missing: {rows.filter(r=>r.isMissing).length} | Paid: {rows.filter(r=>!r.isMissing).length} | Commission: {fmt(totalCommission)}
```

**Issue:** Uses `rows.length` (unfiltered) instead of `filtered.length`

**Fix:**
```javascript
const filteredMissing = filtered.filter(r => r.isMissing).length;
const filteredPaid = filtered.filter(r => !r.isMissing).length;
const totalCommission = filtered.filter(r => !r.isMissing).reduce((s,r) => s+(parseFloat(r.commission)||0), 0);

// Summary bar should show:
<div style={{ ... }}>
  <span>Total rows: <strong>{filtered.length}</strong></span>
  <span> | </span>
  <span>Missing: <strong style={{ color:'var(--red)' }}>{filteredMissing}</strong></span>
  <span> | </span>
  <span>Paid: <strong style={{ color:'var(--green)' }}>{filteredPaid}</strong></span>
  <span> | </span>
  <span>Commission: <strong style={{ color:'var(--green)' }}>{fmt(totalCommission)}</strong></span>
</div>
```

**Location:** Find the summary bar div (likely around line 400-430)

---

## Data Requirements

### Backend Response Needs:

The Missing Renewals API response must include these fields for each row:

```javascript
{
  agent: 'Yahoska Perez',
  client: 'John Doe',
  carrier: 'UnitedHealthcare',
  effectiveDate: '01/01/2026',
  lastPaidPeriod: '202604',  // NEW - last payment_period from commission_records
  commission: 0,  // 0 if missing, actual amount if paid
  isMissing: true,
  monthsMissing: 2,
  policyStatus: 'active',  // NEW - from policy_status table (active, termed, chase, ignore)
  notes: null  // NEW - from policy_status table
}
```

**Note:** Query update (Step 3) was skipped - will align with BOB logic in next session. For now, frontend can assume these fields exist.

---

## CSS Variables Needed

```css
--red: #E24B4A
--green: #1D9E75
--amber: #F59E0B
--blue: #3B82F6
--text-muted: #6B7280
--bg: #FFFFFF
--bg-subtle: #F8F9FA
```

---

## Badge Styles

```jsx
// Red (Missing)
<span className="badge badge-red">Missing</span>

// Green (Paid)
<span className="badge badge-green">Paid</span>

// Amber (Chasing)
<span className="badge badge-amber">🔍 Chasing</span>

// Gray (Ignored)
<span className="badge badge-gray">🙈 Ignored</span>

// Blue (New)
<span className="badge badge-blue">New</span>
```

If these classes don't exist, add to CSS:

```css
.badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.badge-red {
  background: #FCE8E8;
  color: #A32D2D;
}

.badge-green {
  background: #EAF3DE;
  color: #3B6D11;
}

.badge-amber {
  background: #FEF3C7;
  color: #92400E;
}

.badge-gray {
  background: #F3F4F6;
  color: #6B7280;
}

.badge-blue {
  background: #DBEAFE;
  color: #1E40AF;
}
```

---

## Testing Checklist

After implementation:

- [ ] Last Paid column shows "Apr 2026" format
- [ ] Months Missing shows "New" badge for never-paid policies
- [ ] Months Missing shows "—" for paid policies
- [ ] Action buttons appear only on missing rows
- [ ] "Termed" button removes row immediately (after refresh)
- [ ] "Chase" button adds orange badge and keeps row visible
- [ ] "Ignore" button hides row (filters it out)
- [ ] Table scrolls vertically with sticky header
- [ ] Header stays visible when scrolling down
- [ ] Filter counts update when carrier/agent filters applied
- [ ] Summary shows filtered totals, not full dataset totals

---

## Implementation Order

1. Add `updatePolicyStatus()` function
2. Update table headers (add Last Paid + Actions columns)
3. Update table rows (add Last Paid column + action buttons)
4. Fix Months Missing display logic
5. Update Status column to show policy_status badges
6. Add scrollbar styles + sticky header
7. Fix filter count calculations in summary bar
8. Test with various filter combinations

---

**Status:** API ready ✅, Frontend spec complete 📋, ready to implement when Yahoska returns to align query logic.
