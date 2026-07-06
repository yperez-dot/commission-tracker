# OliComm Feature Specs — Implementation Queue

**Date:** June 10, 2026  
**Status:** Specification phase - not yet implemented  
**Build Order:** 4 → 3 → 1 → 2

---

## Feature 1: Missing Renewals Action Tracker

**Effort:** Medium  
**Files:** `MissingRenewals.js`, `routes/records.js`, new DB table

### Goal
Turn Missing Renewals from a read-only report into a trackable workflow where Katy and Yahoska can investigate, annotate, and resolve missing commissions.

### Database Changes
```sql
-- New table to track missing renewal statuses
CREATE TABLE missing_renewal_statuses (
  id SERIAL PRIMARY KEY,
  agent_name TEXT NOT NULL,
  carrier TEXT NOT NULL,
  client_full_name TEXT NOT NULL,
  effective_date TEXT,
  status TEXT DEFAULT 'Missing', -- Missing | Investigating | Found | Cancelled
  notes TEXT,
  updated_by TEXT,
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(agent_name, carrier, client_full_name)
);
```

### Backend Changes (routes/records.js)
Add three new endpoints:

**1. GET status for a specific record:**
```javascript
router.get('/missing-renewal-status', requireAuth, async (req, res) => {
  const { agent, carrier, client } = req.query;
  const pool = getPool();
  const result = await pool.query(
    `SELECT * FROM missing_renewal_statuses
     WHERE agent_name = $1 AND carrier = $2 AND client_full_name = $3`,
    [agent, carrier, client]
  );
  res.json(result.rows[0] || null);
});
```

**2. POST/UPDATE status:**
```javascript
router.post('/missing-renewal-status', requireAuth, async (req, res) => {
  const { agent_name, carrier, client_full_name, effective_date, status, notes } = req.body;
  const pool = getPool();
  await pool.query(
    `INSERT INTO missing_renewal_statuses
     (agent_name, carrier, client_full_name, effective_date, status, notes, updated_by, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
     ON CONFLICT (agent_name, carrier, client_full_name)
     DO UPDATE SET status=$5, notes=$6, updated_by=$7, updated_at=NOW()`,
    [agent_name, carrier, client_full_name, effective_date, status, notes, req.user.name]
  );
  res.json({ success: true });
});
```

**3. GET all statuses for bulk load:**
```javascript
router.get('/missing-renewal-statuses', requireAuth, async (req, res) => {
  const pool = getPool();
  const result = await pool.query(`SELECT * FROM missing_renewal_statuses`);
  res.json(result.rows);
});
```

### Frontend Changes (MissingRenewals.js)

**1. Load all statuses on mount:**
```javascript
const [statuses, setStatuses] = useState({}); // key: `${agent}|${carrier}|${client}`

useEffect(() => {
  apiFetch('/records/missing-renewal-statuses').then(data => {
    const map = {};
    data.forEach(s => {
      map[`${s.agent_name}|${s.carrier}|${s.client_full_name}`] = s;
    });
    setStatuses(map);
  });
}, []);
```

**2. Add Last Known Commission column:**
Add to the backend missing-renewals endpoint:
```sql
LEFT JOIN (
  SELECT agent_name, carrier, client_full_name,
         MAX(commission) as last_commission,
         MAX(payment_period) as last_paid_period
  FROM commission_records
  WHERE commission > 0
  GROUP BY agent_name, carrier, client_full_name
) lc ON lc.agent_name = r.agent_name
     AND lc.carrier = r.carrier
     AND lc.client_full_name = r.client_full_name
```

**3. Add Status + Notes inline per row:**
```javascript
function StatusCell({ row, statuses, onUpdate }) {
  const key = `${row.agent_name}|${row.carrier}|${row.client_full_name}`;
  const current = statuses[key] || { status: 'Missing', notes: '' };
  const [notes, setNotes] = useState(current.notes || '');
  const [saving, setSaving] = useState(false);

  const STATUS_OPTIONS = ['Missing', 'Investigating', 'Found', 'Cancelled'];
  const STATUS_COLORS = {
    Missing: 'var(--red)',
    Investigating: 'var(--amber)',
    Found: 'var(--green)',
    Cancelled: 'var(--text-muted)'
  };

  async function updateStatus(newStatus) {
    setSaving(true);
    await apiFetch('/records/missing-renewal-status', {
      method: 'POST',
      body: JSON.stringify({
        agent_name: row.agent_name,
        carrier: row.carrier,
        client_full_name: row.client_full_name,
        effective_date: row.effective_date,
        status: newStatus,
        notes
      })
    });
    onUpdate(key, { status: newStatus, notes });
    setSaving(false);
  }

  async function saveNotes() {
    setSaving(true);
    await apiFetch('/records/missing-renewal-status', {
      method: 'POST',
      body: JSON.stringify({
        agent_name: row.agent_name,
        carrier: row.carrier,
        client_full_name: row.client_full_name,
        effective_date: row.effective_date,
        status: current.status,
        notes
      })
    });
    onUpdate(key, { ...current, notes });
    setSaving(false);
  }

  return (
    <td style={{ padding: '6px 8px', minWidth: 280 }}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <select
          value={current.status}
          onChange={e => updateStatus(e.target.value)}
          style={{
            fontSize: 11, padding: '3px 8px', borderRadius: 4,
            border: '0.5px solid var(--border)',
            color: STATUS_COLORS[current.status],
            fontWeight: 500, cursor: 'pointer'
          }}
        >
          {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <input
          value={notes}
          onChange={e => setNotes(e.target.value)}
          onBlur={saveNotes}
          placeholder="Add note..."
          style={{
            fontSize: 11, padding: '3px 8px', borderRadius: 4,
            border: '0.5px solid var(--border)', flex: 1, minWidth: 140,
            background: 'var(--bg)', color: 'var(--text)'
          }}
        />
        {saving && <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>saving...</span>}
      </div>
    </td>
  );
}
```

**4. Add status filter buttons:**
```javascript
const [statusFilter, setStatusFilter] = useState('Missing');

// Filter options
['All', 'Missing', 'Investigating', 'Found', 'Cancelled'].map(s => (
  <button key={s} onClick={() => setStatusFilter(s)}
    style={{
      padding: '4px 10px', fontSize: 11, borderRadius: 4,
      border: '0.5px solid var(--border)', cursor: 'pointer',
      background: statusFilter === s ? 'var(--accent)' : 'transparent',
      color: statusFilter === s ? 'var(--sidebar-bg)' : 'var(--text-muted)'
    }}>{s}</button>
))
```

**5. Updated table columns:**
- Last Commission (from last paid period)
- Last Paid Period
- Status + Notes (inline editable)

---

## Feature 2: Email Statement to Agent

**Effort:** Medium  
**Files:** `Payroll.js`, `routes/payroll.js` (new), `agent_contacts` table, Resend API

### Goal
One-click send branded Excel statement from Payroll page directly to agent's email.

### Prerequisites
- Store agent emails in OliComm (new `agent_contacts` table or add to `users` table)
- Railway email service (use SendGrid or Resend — Resend is simpler, ~$0/mo for low volume)

### Database Changes
```sql
-- Add email to users table if not already there
ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS agent_email TEXT; -- for non-login agents

-- Or separate table for agent contact info
CREATE TABLE agent_contacts (
  id SERIAL PRIMARY KEY,
  agent_name TEXT UNIQUE NOT NULL,
  email TEXT,
  phone TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Seed known agents
INSERT INTO agent_contacts (agent_name, email) VALUES
  ('Patsy Pernia', 'patsy@email.com'),
  ('Eduardo Pernia', 'eduardo@email.com'),
  ('Christian Munoz', 'christian@email.com');
```

### Backend Changes
```javascript
// Install: npm install resend
const { Resend } = require('resend');
const resend = new Resend(process.env.RESEND_API_KEY);

router.post('/send-statement', requireAuth, async (req, res) => {
  const { agent_name, period_label, statement_base64 } = req.body;
  const pool = getPool();

  // Get agent email
  const contact = await pool.query(
    'SELECT email FROM agent_contacts WHERE agent_name = $1',
    [agent_name]
  );

  if (!contact.rows[0]?.email) {
    return res.status(400).json({ error: 'No email on file for this agent' });
  }

  await resend.emails.send({
    from: 'commissions@healthexps.com',
    to: contact.rows[0].email,
    subject: `Your Commission Statement — ${period_label}`,
    html: `
      <p>Hi ${agent_name.split(' ')[0]},</p>
      <p>Please find your commission statement for <strong>${period_label}</strong> attached.</p>
      <p>Questions? Reply to this email or call 1-800-380-6821.</p>
      <br/>
      <p>The Health Experts Insurance</p>
    `,
    attachments: [{
      filename: `THEI_Statement_${agent_name.replace(/\s+/g,'_')}_${period_label.replace(/\s+/g,'_')}.xlsx`,
      content: statement_base64
    }]
  });

  res.json({ success: true });
});
```

### Frontend Changes (Payroll.js)
Add email button next to ↓ Statement:
```javascript
async function emailStatement(agent, records, periodLabel, total) {
  // Generate Excel buffer same as generateStatement but return as base64
  const ExcelJS = (await import('exceljs')).default;
  // ... same Excel generation code ...
  const buffer = await wb.xlsx.writeBuffer();
  const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)));

  try {
    await apiFetch('/payroll/send-statement', {
      method: 'POST',
      body: JSON.stringify({
        agent_name: agent,
        period_label: periodLabel,
        statement_base64: base64
      })
    });
    alert(`Statement sent to ${agent}!`);
  } catch(e) {
    alert('Failed to send. Check agent email is on file.');
  }
}

// In PayoutRow, add email button:
<button onClick={() => emailStatement(p.agent, p.records, periodLabel, p.total)}
  style={{ background:'none', border:'0.5px solid var(--border)', borderRadius:6,
  padding:'4px 10px', fontSize:11, cursor:'pointer', color:'var(--text)' }}>
  ✉ Email
</button>
```

---

## Feature 3: Commission Trend per Client

**Effort:** Small  
**Files:** `AllData.js`, `routes/records.js`

### Goal
Click any client in All Data → see their full commission history across all periods in a modal.

### Backend Changes (routes/records.js)
```javascript
router.get('/client-history', requireAuth, async (req, res) => {
  const { agent, carrier, client } = req.query;
  const pool = getPool();
  const result = await pool.query(
    `SELECT payment_period, classification, commission, producer_payable,
            policy_number, effective_date, lob
     FROM commission_records
     WHERE agent_name = $1 AND carrier = $2 AND client_full_name = $3
     ORDER BY payment_period ASC`,
    [agent, carrier, client]
  );
  res.json(result.rows);
});
```

### Frontend Changes (AllData.js)
When clicking a client name (not policy number), open a history modal:
```javascript
const [clientHistory, setClientHistory] = useState(null);
const [clientHistoryData, setClientHistoryData] = useState([]);

async function loadClientHistory(r) {
  const data = await apiFetch(
    `/records/client-history?agent=${encodeURIComponent(r.agent_name)}&carrier=${encodeURIComponent(r.carrier)}&client=${encodeURIComponent(r.client_full_name)}`
  );
  setClientHistoryData(data);
  setClientHistory(r);
}

// Modal:
{clientHistory && (
  <div onClick={() => setClientHistory(null)}
    style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.45)',zIndex:1000,
    display:'flex',alignItems:'center',justifyContent:'center'}}>
    <div onClick={e=>e.stopPropagation()}
      style={{background:'var(--bg)',borderRadius:12,padding:28,width:600,
      maxHeight:'80vh',overflowY:'auto',border:'0.5px solid var(--border)'}}>
      <div style={{fontWeight:500,fontSize:16,marginBottom:4}}>{clientHistory.client_full_name}</div>
      <div style={{fontSize:12,color:'var(--text-muted)',marginBottom:16}}>
        {clientHistory.carrier} · {clientHistory.agent_name}
      </div>
      <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
        <thead>
          <tr>
            {['Period','Type','Amount','LOB'].map(h=>(
              <th key={h} style={{textAlign:'left',padding:'6px 8px',
              borderBottom:'0.5px solid var(--border)',color:'var(--text-muted)',fontSize:11}}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {clientHistoryData.map((r,i)=>{
            const amt = parseFloat(r.producer_payable||0) !== 0
              ? parseFloat(r.producer_payable)
              : parseFloat(r.commission)||0;
            return (
              <tr key={i} style={{borderBottom:'0.5px solid var(--border)'}}>
                <td style={{padding:'6px 8px'}}>{r.payment_period}</td>
                <td style={{padding:'6px 8px'}}>{r.classification}</td>
                <td style={{padding:'6px 8px',fontWeight:500,
                color:amt<0?'var(--red)':'var(--green)'}}>
                  ${Math.abs(amt).toFixed(2)}
                </td>
                <td style={{padding:'6px 8px',color:'var(--text-muted)'}}>{r.lob}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div style={{marginTop:12,paddingTop:12,borderTop:'0.5px solid var(--border)',
      display:'flex',justifyContent:'space-between',fontSize:12}}>
        <span style={{color:'var(--text-muted)'}}>
          {clientHistoryData.length} records ·
          First: {clientHistoryData[0]?.payment_period} ·
          Last: {clientHistoryData[clientHistoryData.length-1]?.payment_period}
        </span>
        <span style={{fontWeight:500}}>
          Total: ${clientHistoryData.reduce((s,r)=>{
            const amt = parseFloat(r.producer_payable||0)!==0
              ?parseFloat(r.producer_payable)
              :parseFloat(r.commission)||0;
            return s+amt;
          },0).toFixed(2)}
        </span>
      </div>
    </div>
  </div>
)}
```

---

## Feature 4: NHP Auto-Period Detection

**Effort:** Small  
**Files:** `routes/files.js`

### Goal
Extract the correct payment period from the carrier-statement month column (e.g. "Cigna - April 2026" → 202604) instead of using today's date.

### Backend Change (routes/files.js)
In `parseNHPRows`, replace:

**CURRENT (uses upload date):**
```javascript
const now = new Date();
const uploadPeriod = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
records = parseNHPRows(wb, uploadPeriod);
```

**NEW (extract period from statement month per record):**
```javascript
// In parseNHPRows, change period assignment per row:
const extractedPeriod = extractPeriodFromStatementMonth(carrierRaw);
const period = extractedPeriod || uploadPeriod; // fallback to upload date if extraction fails
```

The `extractPeriodFromStatementMonth` function already exists in `files.js` — just needs to be called per record instead of once at upload time.

---

## Summary

| # | Feature | Files | Effort |
|---|---------|-------|--------|
| 1 | Missing Renewals Action Tracker | MissingRenewals.js, records.js, new DB table | Medium |
| 2 | Email Statement to Agent | Payroll.js, routes/payroll.js (new), agent_contacts table, Resend API | Medium |
| 3 | Commission Trend per Client | AllData.js, records.js | Small |
| 4 | NHP Auto-Period Detection | routes/files.js | Small |

**Recommended build order:** 4 → 3 → 1 → 2

- **4** is one-line fix
- **3** is frontend-only + simple backend endpoint
- **1** needs DB work + more complex state management
- **2** needs external API setup (Resend)

---

**Status:** Not yet implemented - awaiting approval and prioritization

---

## 🐛 Follow-up: 30 Bleeding Aetna/MBI Records in DB (logged 2026-07-06)

**Root cause:** Old `parseBSIConsolidatedPDF` Pattern 1 used `[A-Z0-9]{8,20}` which greedily
consumed surname letters into MBI policy numbers.
**Example:** `1EQ0U45TX00TURNER` / client=`A,Rebecca` → should be policy=`1EQ0U45TX00`, client=`Turner A, Rebecca`
**Count:** 30 records (all Aetna, all MBI format)
**Status:** Code fix shipped in Commit 2. Existing DB data NOT retroactively corrected.

**Decision needed (post-Commit 2):**
- Option A: One-time cleanup script — re-parse policy/client split for the 30 affected rows
- Option B: Re-upload the affected statement PDF (triggers full re-parse, replaces records)

**Do not touch until Yahoska decides.**
