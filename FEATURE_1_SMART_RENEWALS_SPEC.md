# Feature 1: Smart Missing Renewals Tracker (Enhanced)

**Date:** June 10, 2026  
**Priority:** HIGH  
**Approved By:** Yahoska (Option B - Smart Tracking)

---

## 🎯 Goals

1. **Track missing renewals month-to-month** - Mark items as investigating, add notes
2. **Automatic resolution detection** - System detects when late statements arrive and auto-resolves
3. **Audit trail** - See history of what was missing, when resolved, by whom
4. **Alert on upload** - "✅ 3 previously missing renewals found in this upload"

---

## 📊 Enhancement Over Current System

### Current (Read-only):
- Select month → see missing vs. paid
- No memory between checks
- No tracking of "investigating" items
- Manual re-checking needed

### Enhanced (Smart Tracking):
- Mark items as investigating with notes
- **Auto-detect when late statements arrive**
- **Alert which items were resolved**
- Full history and audit trail

---

## 🗄️ Database Schema

```sql
-- New table to track missing renewal investigations
CREATE TABLE missing_renewal_statuses (
  id SERIAL PRIMARY KEY,
  agent_name TEXT NOT NULL,
  carrier TEXT NOT NULL,
  client_full_name TEXT NOT NULL,
  effective_date TEXT,
  payment_period TEXT NOT NULL, -- Period when it was first marked missing
  expected_commission DECIMAL(10,2), -- Last known commission amount
  status TEXT DEFAULT 'Missing', -- Missing | Investigating | Found | Cancelled
  notes TEXT,
  created_by TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_by TEXT,
  updated_at TIMESTAMP DEFAULT NOW(),
  resolved_at TIMESTAMP,
  resolved_by TEXT,
  resolution_method TEXT, -- 'manual' | 'auto-upload' | 'statement-upload'
  resolving_upload_batch TEXT, -- Batch ID that resolved it
  UNIQUE(agent_name, carrier, client_full_name, payment_period)
);

-- Index for fast lookups during upload resolution detection
CREATE INDEX idx_missing_renewal_active 
  ON missing_renewal_statuses(status, agent_name, carrier, client_full_name)
  WHERE status IN ('Missing', 'Investigating');
```

---

## 🔧 Backend Changes

### 1. New Endpoints (routes/records.js)

**GET /records/missing-renewal-status** - Get status for specific record
```javascript
router.get('/missing-renewal-status', requireAuth, async (req, res) => {
  const { agent, carrier, client, period } = req.query;
  const pool = getPool();
  const result = await pool.query(
    `SELECT * FROM missing_renewal_statuses
     WHERE agent_name = $1 AND carrier = $2 
       AND client_full_name = $3 AND payment_period = $4`,
    [agent, carrier, client, period]
  );
  res.json(result.rows[0] || null);
});
```

**POST /records/missing-renewal-status** - Create/update status
```javascript
router.post('/missing-renewal-status', requireAuth, async (req, res) => {
  const { 
    agent_name, carrier, client_full_name, effective_date, 
    payment_period, expected_commission, status, notes 
  } = req.body;
  const pool = getPool();
  
  await pool.query(
    `INSERT INTO missing_renewal_statuses
     (agent_name, carrier, client_full_name, effective_date, payment_period, 
      expected_commission, status, notes, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)
     ON CONFLICT (agent_name, carrier, client_full_name, payment_period)
     DO UPDATE SET 
       status = $7, 
       notes = $8, 
       updated_by = $9, 
       updated_at = NOW(),
       resolved_at = CASE WHEN $7 = 'Found' THEN NOW() ELSE NULL END,
       resolved_by = CASE WHEN $7 = 'Found' THEN $9 ELSE NULL END,
       resolution_method = CASE WHEN $7 = 'Found' THEN 'manual' ELSE NULL END`,
    [agent_name, carrier, client_full_name, effective_date, payment_period, 
     expected_commission, status, notes, req.user.name]
  );
  
  res.json({ success: true });
});
```

**GET /records/missing-renewal-statuses** - Get all active statuses
```javascript
router.get('/missing-renewal-statuses', requireAuth, async (req, res) => {
  const pool = getPool();
  const result = await pool.query(
    `SELECT * FROM missing_renewal_statuses 
     ORDER BY status, updated_at DESC`
  );
  res.json(result.rows);
});
```

**GET /records/missing-renewals-with-last-known** - Enhanced missing renewals query
```javascript
router.get('/missing-renewals-with-last-known', requireAuth, async (req, res) => {
  // Existing missing renewals logic, enhanced with:
  // LEFT JOIN to get last known commission amount and period
  
  const query = `
    SELECT 
      bob.*,
      lk.last_commission,
      lk.last_paid_period,
      mrs.status as tracking_status,
      mrs.notes as tracking_notes,
      mrs.updated_by as tracking_updated_by,
      mrs.updated_at as tracking_updated_at
    FROM book_of_business bob
    LEFT JOIN (
      SELECT agent_name, carrier, client_full_name,
             MAX(commission) as last_commission,
             MAX(payment_period) as last_paid_period
      FROM commission_records
      WHERE commission > 0
      GROUP BY agent_name, carrier, client_full_name
    ) lk ON lk.agent_name = bob.agent_name
         AND lk.carrier = bob.carrier
         AND lk.client_full_name = bob.client_full_name
    LEFT JOIN missing_renewal_statuses mrs 
      ON mrs.agent_name = bob.agent_name
      AND mrs.carrier = bob.carrier
      AND mrs.client_full_name = bob.client_full_name
      AND mrs.payment_period = $1
    WHERE bob.status = 'active'
  `;
  
  // ... rest of logic
});
```

---

### 2. Auto-Resolution Detection (routes/files.js)

**Add after successful statement upload:**

```javascript
// In the upload handler, after records are inserted:

async function detectAndResolveRenewals(pool, batchId, uploadPeriod, userName) {
  console.log('🔍 Checking for auto-resolvable missing renewals...');
  
  // Get all active investigations
  const investigations = await pool.query(
    `SELECT * FROM missing_renewal_statuses 
     WHERE status IN ('Missing', 'Investigating')`
  );
  
  const resolved = [];
  
  for (const inv of investigations.rows) {
    // Check if this upload contains a matching commission
    const match = await pool.query(
      `SELECT id, commission, payment_period, policy_number
       FROM commission_records
       WHERE agent_name = $1 
         AND carrier = $2 
         AND client_full_name = $3
         AND payment_period = $4
         AND commission > 0
       LIMIT 1`,
      [inv.agent_name, inv.carrier, inv.client_full_name, inv.payment_period]
    );
    
    if (match.rows.length > 0) {
      const rec = match.rows[0];
      
      // Auto-resolve!
      await pool.query(
        `UPDATE missing_renewal_statuses
         SET status = 'Found',
             notes = COALESCE(notes, '') || E'\n[Auto-resolved] Found in upload batch ' || $1 || 
                     ' - Commission: $' || $2 || ' (Policy: ' || $3 || ')',
             updated_by = $4,
             updated_at = NOW(),
             resolved_at = NOW(),
             resolved_by = $4,
             resolution_method = 'auto-upload',
             resolving_upload_batch = $1
         WHERE id = $5`,
        [batchId, rec.commission, rec.policy_number, userName, inv.id]
      );
      
      resolved.push({
        client: inv.client_full_name,
        carrier: inv.carrier,
        period: inv.payment_period,
        commission: rec.commission,
        policy: rec.policy_number
      });
    }
  }
  
  console.log(`✅ Auto-resolved ${resolved.length} missing renewals`);
  return resolved;
}

// Call after successful upload:
if (insertedRecords > 0) {
  const resolvedRenewals = await detectAndResolveRenewals(
    pool, 
    batchId, 
    uploadPeriod, 
    req.user.name
  );
  
  // Return in response so frontend can show alert
  return res.json({
    success: true,
    inserted: insertedRecords,
    batch: batchId,
    resolvedRenewals // NEW: list of auto-resolved items
  });
}
```

---

## 🎨 Frontend Changes (MissingRenewals.js)

### 1. Load Statuses on Mount
```javascript
const [statuses, setStatuses] = useState({}); // key: `${agent}|${carrier}|${client}|${period}`

useEffect(() => {
  apiFetch('/records/missing-renewal-statuses').then(data => {
    const map = {};
    data.forEach(s => {
      const key = `${s.agent_name}|${s.carrier}|${s.client_full_name}|${s.payment_period}`;
      map[key] = s;
    });
    setStatuses(map);
  });
}, []);
```

### 2. Add Status Filter Buttons
```javascript
const [statusFilter, setStatusFilter] = useState('All');

const STATUS_OPTIONS = ['All', 'Missing', 'Investigating', 'Found', 'Cancelled'];

// Filter rows based on tracking status
const filtered = rows.filter(r => {
  const key = `${r.agent}|${r.carrier}|${r.client}|${selectedPeriod}`;
  const status = statuses[key];
  
  if (statusFilter === 'All') return true;
  if (statusFilter === 'Missing') return r.isMissing && (!status || status.status === 'Missing');
  return status && status.status === statusFilter;
});
```

### 3. Add StatusCell Component
```javascript
function StatusCell({ row, selectedPeriod, statuses, onUpdate }) {
  const key = `${row.agent}|${row.carrier}|${row.client}|${selectedPeriod}`;
  const current = statuses[key] || { status: 'Missing', notes: '' };
  const [notes, setNotes] = useState(current.notes || '');
  const [saving, setSaving] = useState(false);

  const STATUS_OPTIONS = ['Missing', 'Investigating', 'Found', 'Cancelled'];
  const STATUS_COLORS = {
    Missing: 'var(--red)',
    Investigating: '#E67E22', // orange
    Found: 'var(--green)',
    Cancelled: 'var(--text-muted)'
  };

  async function updateStatus(newStatus) {
    setSaving(true);
    await apiFetch('/records/missing-renewal-status', {
      method: 'POST',
      body: JSON.stringify({
        agent_name: row.agent,
        carrier: row.carrier,
        client_full_name: row.client,
        effective_date: row.effectiveDate,
        payment_period: selectedPeriod,
        expected_commission: row.commission || 0,
        status: newStatus,
        notes
      })
    });
    onUpdate(key, { ...current, status: newStatus, notes });
    setSaving(false);
  }

  async function saveNotes() {
    if (notes === current.notes) return;
    setSaving(true);
    await apiFetch('/records/missing-renewal-status', {
      method: 'POST',
      body: JSON.stringify({
        agent_name: row.agent,
        carrier: row.carrier,
        client_full_name: row.client,
        effective_date: row.effectiveDate,
        payment_period: selectedPeriod,
        expected_commission: row.commission || 0,
        status: current.status,
        notes
      })
    });
    onUpdate(key, { ...current, notes });
    setSaving(false);
  }

  return (
    <td style={{ padding: '6px 8px', minWidth: 300 }}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <select
          value={current.status}
          onChange={e => updateStatus(e.target.value)}
          disabled={saving}
          style={{
            fontSize: 11, padding: '4px 8px', borderRadius: 4,
            border: '0.5px solid var(--border)',
            color: STATUS_COLORS[current.status],
            fontWeight: 500, cursor: 'pointer',
            background: 'var(--bg)'
          }}
        >
          {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <input
          value={notes}
          onChange={e => setNotes(e.target.value)}
          onBlur={saveNotes}
          placeholder="Add note..."
          disabled={saving}
          style={{
            fontSize: 11, padding: '4px 8px', borderRadius: 4,
            border: '0.5px solid var(--border)', flex: 1, minWidth: 150,
            background: 'var(--bg)', color: 'var(--text)'
          }}
        />
        {saving && <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>💾</span>}
        {current.updated_by && (
          <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
            by {current.updated_by.split(' ')[0]}
          </span>
        )}
      </div>
    </td>
  );
}
```

### 4. Add Resolution Alert Banner
```javascript
const [resolvedItems, setResolvedItems] = useState(null);

// Show after upload completes (would come from Upload page via navigation state)
useEffect(() => {
  if (resolvedItems && resolvedItems.length > 0) {
    // Auto-clear after 10 seconds
    const timer = setTimeout(() => setResolvedItems(null), 10000);
    return () => clearTimeout(timer);
  }
}, [resolvedItems]);

// Banner component
{resolvedItems && resolvedItems.length > 0 && (
  <div style={{
    background: 'rgba(74, 114, 96, 0.1)',
    border: '0.5px solid var(--green)',
    borderRadius: 8,
    padding: '12px 16px',
    marginBottom: 16,
    display: 'flex',
    alignItems: 'center',
    gap: 10
  }}>
    <span style={{ fontSize: 20 }}>✅</span>
    <div style={{ flex: 1 }}>
      <div style={{ fontWeight: 500, color: 'var(--green)', marginBottom: 4 }}>
        {resolvedItems.length} Missing Renewal{resolvedItems.length !== 1 ? 's' : ''} Auto-Resolved!
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
        {resolvedItems.map((r, i) => (
          <div key={i}>
            • {r.client} ({r.carrier}) - ${r.commission} found in {r.period}
          </div>
        ))}
      </div>
    </div>
    <button onClick={() => setResolvedItems(null)} style={{
      background: 'none', border: 'none', cursor: 'pointer',
      color: 'var(--text-muted)', fontSize: 18
    }}>×</button>
  </div>
)}
```

### 5. Update Table Columns
Add new column: **Tracking** (between Status and Months Missing)

```javascript
<th>Tracking</th>

// In tbody:
<StatusCell 
  row={r} 
  selectedPeriod={selectedPeriod} 
  statuses={statuses} 
  onUpdate={(key, newStatus) => {
    setStatuses(prev => ({ ...prev, [key]: newStatus }));
  }} 
/>
```

---

## 📊 New Table Layout

| # | Agent | Carrier | Client | Effective Date | Commission | Status | **Tracking** | Months Missing |
|---|-------|---------|--------|----------------|------------|--------|--------------|----------------|
| 1 | Yahoska | Humana | John Doe | Jan 1, 2025 | $0.00 | Missing | [Dropdown] [Notes] | 3 mo |

---

## 🚀 User Workflow

### Scenario: Late Statement Detection

**April 10, 2026:**
1. Run Missing Renewals check for April
2. See Client X (Humana) is missing
3. Mark as "Investigating" → Note: "Called carrier 4/10, statement delayed"

**May 15, 2026:**
1. Humana sends April statement (late)
2. Upload to OliComm
3. **System detects:** "Client X was investigating → now found!"
4. **Auto-updates:** Status → "Found", adds note "[Auto-resolved] Found in batch MAY-2026-15"
5. **Shows alert:** "✅ 1 missing renewal auto-resolved: Client X - $450"

**Result:**
- ✅ Full audit trail
- ✅ No manual re-checking needed
- ✅ Know exactly when/how it was resolved

---

## ✅ Implementation Checklist

### Database:
- [ ] Create `missing_renewal_statuses` table
- [ ] Create index for fast lookups

### Backend:
- [ ] Add 3 new endpoints (get/post/list)
- [ ] Enhance missing renewals query with last known commission
- [ ] Add auto-resolution detection in upload handler
- [ ] Return resolved items in upload response

### Frontend:
- [ ] Load statuses on mount
- [ ] Add status filter buttons
- [ ] Add StatusCell component
- [ ] Add resolution alert banner
- [ ] Add Tracking column to table
- [ ] Wire up status updates

---

## 🎯 Success Metrics

- ✅ Can mark items as investigating
- ✅ Can add notes per item
- ✅ Late statements auto-resolve investigations
- ✅ Alert shows what was resolved
- ✅ Full audit trail in database
- ✅ Filter by status works
- ✅ Export includes tracking info

---

**Estimated build time:** 2-3 hours  
**Status:** Ready to build - awaiting approval
