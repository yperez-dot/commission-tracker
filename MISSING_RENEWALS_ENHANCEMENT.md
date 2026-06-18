# Missing Renewals Workflow Enhancement

## Overview
Transform Missing Renewals from a read-only report into an actionable workflow with per-policy status tracking.

---

## ✅ Step 1: Database Table (COMPLETE)

**Table created:** `policy_status`

```sql
CREATE TABLE IF NOT EXISTS policy_status (
  id SERIAL PRIMARY KEY,
  client_full_name TEXT NOT NULL,
  carrier TEXT NOT NULL,
  agent_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  notes TEXT,
  updated_at TIMESTAMP DEFAULT NOW(),
  updated_by TEXT,
  UNIQUE(client_full_name, carrier, agent_name)
);
```

**Verified:** ✅ Table exists in production database

---

## 🔄 Step 2: Update Missing Renewals Query

### Current Query (routes/bob.js line ~150)
```sql
SELECT * FROM book_of_business 
WHERE ${where.join(' AND ')} 
ORDER BY months_missing DESC, client_full_name ASC
```

### New Query (with termed exclusion)
```sql
SELECT bob.* 
FROM book_of_business bob
LEFT JOIN policy_status ps
  ON LOWER(bob.client_full_name) = LOWER(ps.client_full_name)
  AND LOWER(bob.carrier) = LOWER(ps.carrier)
  AND LOWER(bob.agent_name) = LOWER(ps.agent_name)
WHERE ${where.join(' AND ')}
  AND (ps.status IS NULL OR ps.status != 'termed')
ORDER BY 
  CASE WHEN ps.status = 'investigating' THEN 0 ELSE 1 END,
  bob.months_missing DESC, 
  bob.client_full_name ASC
```

**Changes:**
- LEFT JOIN with policy_status table
- Exclude policies where status = 'termed'
- Sort investigating policies to top

**File:** `routes/bob.js` lines ~148-151

---

## 🆕 Step 3: Add Backend Routes for Policy Status

### New Route: Mark Policy Status
**POST /bob/policy-status**

```javascript
router.post('/policy-status', requireAuth, async (req, res) => {
  try {
    const { client_full_name, carrier, agent_name, status, notes } = req.body;
    const updated_by = req.user.name || req.user.email;
    
    const pool = getPool();
    await pool.query(`
      INSERT INTO policy_status 
        (client_full_name, carrier, agent_name, status, notes, updated_by, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, NOW())
      ON CONFLICT (client_full_name, carrier, agent_name)
      DO UPDATE SET 
        status = $4,
        notes = $5,
        updated_by = $6,
        updated_at = NOW()
    `, [client_full_name, carrier, agent_name, status, notes, updated_by]);
    
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
```

### New Route: Get Policy Status
**GET /bob/policy-status/:client/:carrier/:agent**

```javascript
router.get('/policy-status/:client/:carrier/:agent', requireAuth, async (req, res) => {
  try {
    const { client, carrier, agent } = req.params;
    const pool = getPool();
    const result = await pool.query(`
      SELECT * FROM policy_status
      WHERE LOWER(client_full_name) = LOWER($1)
        AND LOWER(carrier) = LOWER($2)
        AND LOWER(agent_name) = LOWER($3)
    `, [decodeURIComponent(client), decodeURIComponent(carrier), decodeURIComponent(agent)]);
    
    if (result.rows.length === 0) {
      return res.json({ status: 'active', notes: null });
    }
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
```

---

## 🎨 Step 4: Frontend UI Enhancements

### Add Action Buttons to Each Missing Row

**Location:** `src/pages/MissingRenewals.js` (or wherever Missing Renewals table is rendered)

**Current row structure:**
```jsx
<tr>
  <td>{client}</td>
  <td>{agent}</td>
  <td>{carrier}</td>
  <td>{effectiveDate}</td>
  <td>{commission}</td>
  <td>{status}</td>
</tr>
```

**New row structure:**
```jsx
<tr>
  <td>{client}</td>
  <td>{agent}</td>
  <td>{carrier}</td>
  <td>{effectiveDate}</td>
  <td>{commission}</td>
  <td>
    {policyStatus === 'investigating' && (
      <span className="badge badge-amber">🔍 Investigating</span>
    )}
    {policyStatus === 'termed' && (
      <span className="badge badge-gray">✕ Termed</span>
    )}
    {policyStatus === 'active' && (
      <span className="badge badge-red">❗ Missing</span>
    )}
  </td>
  <td style={{ textAlign: 'right' }}>
    <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
      <button
        className="btn btn-sm"
        onClick={() => markPolicyStatus(row, 'termed')}
        style={{ fontSize: 11, padding: '3px 8px' }}
      >
        Mark Termed
      </button>
      <button
        className="btn btn-sm btn-amber"
        onClick={() => markPolicyStatus(row, 'investigating')}
        style={{ fontSize: 11, padding: '3px 8px' }}
      >
        Investigating
      </button>
      <button
        className="btn btn-sm"
        onClick={() => openNotesModal(row)}
        style={{ fontSize: 11, padding: '3px 8px' }}
      >
        + Note
      </button>
    </div>
  </td>
</tr>
```

### Add Frontend Functions

```javascript
async function markPolicyStatus(row, status) {
  try {
    await apiFetch('/bob/policy-status', {
      method: 'POST',
      body: JSON.stringify({
        client_full_name: row.client,
        carrier: row.carrier,
        agent_name: row.agent,
        status: status,
        notes: null
      })
    });
    
    // Refresh the list
    await loadMissingRenewals();
    
    alert(`✅ Marked as ${status}`);
  } catch (err) {
    alert(`Error: ${err.message}`);
  }
}

function openNotesModal(row) {
  setNoteModalRow(row);
  setNoteModalOpen(true);
}

async function saveNote() {
  try {
    await apiFetch('/bob/policy-status', {
      method: 'POST',
      body: JSON.stringify({
        client_full_name: noteModalRow.client,
        carrier: noteModalRow.carrier,
        agent_name: noteModalRow.agent,
        status: noteModalRow.policyStatus || 'active',
        notes: noteText
      })
    });
    
    setNoteModalOpen(false);
    setNoteText('');
    await loadMissingRenewals();
    
    alert('✅ Note saved');
  } catch (err) {
    alert(`Error: ${err.message}`);
  }
}
```

### Add Notes Modal Component

```jsx
{noteModalOpen && (
  <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
    <div style={{ background: 'var(--bg)', borderRadius: 12, padding: 24, width: 400, boxShadow: '0 8px 32px rgba(0,0,0,0.2)' }}>
      <h3 style={{ marginTop: 0, fontSize: 16 }}>Add Note</h3>
      <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 12 }}>
        {noteModalRow?.client} · {noteModalRow?.carrier}
      </div>
      <textarea
        value={noteText}
        onChange={(e) => setNoteText(e.target.value)}
        placeholder="Add context about this policy..."
        style={{ width: '100%', minHeight: 100, padding: 8, fontSize: 13, borderRadius: 6, border: '1px solid var(--border)' }}
      />
      <div style={{ display: 'flex', gap: 8, marginTop: 12, justifyContent: 'flex-end' }}>
        <button onClick={() => { setNoteModalOpen(false); setNoteText(''); }} className="btn">
          Cancel
        </button>
        <button onClick={saveNote} className="btn btn-primary">
          Save Note
        </button>
      </div>
    </div>
  </div>
)}
```

---

## 🎯 User Workflow

### Before (Read-Only)
1. User sees Missing Renewals list
2. User manually tracks which ones are termed vs. legitimately missing
3. List gets cluttered with termed policies every month
4. No context for investigating policies

### After (Actionable Workflow)
1. User sees Missing Renewals list
2. **Mark as Termed** → Policy disappears from list permanently
3. **Mark as Investigating** → Policy stays on list with yellow badge, sorted to top
4. **Add Note** → Context saved (e.g., "Called client, waiting for callback")
5. Clean, actionable list → focus on real missing payments

---

## 📊 Benefits

1. **Workflow efficiency** - Work through list systematically, mark off completed items
2. **Persistent state** - Status survives across months/sessions
3. **Team context** - Notes explain why policies are investigating
4. **Clean reports** - Termed policies don't pollute future reports
5. **Prioritization** - Investigating policies sorted to top

---

## 🚀 Implementation Steps

### Backend (routes/bob.js)
1. ✅ Create policy_status table (DONE)
2. Update Missing Renewals query to exclude termed
3. Add POST /bob/policy-status route
4. Add GET /bob/policy-status/:client/:carrier/:agent route

### Frontend (src/pages/MissingRenewals.js or similar)
1. Add action buttons to each row
2. Add markPolicyStatus() function
3. Add notes modal component
4. Add openNotesModal() / saveNote() functions
5. Add state for noteModalOpen, noteModalRow, noteText
6. Fetch policy status when loading rows
7. Display status badges (investigating = yellow, termed = hidden)

---

## 🔒 Security Notes

- Policy status changes require authentication (requireAuth middleware)
- Updated_by field tracks who made changes
- Status changes only affect Missing Renewals display, not commission records
- Termed policies can be un-termed by re-marking as active

---

## 📝 Testing Checklist

- [ ] Mark policy as termed → disappears from Missing Renewals
- [ ] Mark policy as investigating → stays on list with yellow badge
- [ ] Add note → saves successfully and displays on re-load
- [ ] Un-term policy → reappears on Missing Renewals
- [ ] Termed policies excluded from counts
- [ ] Investigating policies sorted to top

---

**Status:** Ready for implementation
**Priority:** High (turns read-only report into actionable workflow)
**Estimated time:** 2-3 hours
