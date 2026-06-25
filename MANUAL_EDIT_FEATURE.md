# Manual Commission Record Editing - Feature Documentation

## Overview

Manual edit capability for commission records with full audit trail, evidence retention, and re-import protection.

**Use Case:** Shirley St Hill's $260.25 shows as BSI override but is actually agent commission paid to Carolina - needs manual correction with audit trail.

---

## Features

### 1. **Manual Edit Form**
Edit per-record:
- **Override amount** (THEI/BSI split)
- **Agent commission amount**
- **Type** (Override / Agent Comp / New Business / Chargeback)
- **Edit notes** (required - explain why)

### 2. **Audit Trail**
Every edit logs:
- Who changed it (`edited_by`)
- When (`edited_at`)
- Old value → New value (field-by-field)
- Notes/reason for change

Stored in `commission_edit_audit` table - **never deleted**.

### 3. **Evidence Retention**
Original parsed values preserved in:
- `original_commission`
- `original_thei_share`
- `original_bsi_share`
- `original_classification`

Visible alongside corrected values in UI.

### 4. **Manual-Edit Flag**
- `is_manually_edited` = TRUE prevents re-import from overwriting
- Next statement upload skips manually corrected records
- User sees warning: "X manually edited records protected from overwrite"

### 5. **Reversion**
- "Revert to Original" button restores parsed values
- Logged in audit trail
- Clears `is_manually_edited` flag

---

## Database Schema

### Migration 007: `migrations/007_manual_edit_audit.sql`

**commission_records table - new columns:**
```sql
is_manually_edited BOOLEAN DEFAULT FALSE
edited_by VARCHAR(255)
edited_at TIMESTAMP
edit_notes TEXT
original_commission DECIMAL(10,2)
original_thei_share DECIMAL(10,2)
original_bsi_share DECIMAL(10,2)
original_classification VARCHAR(50)
```

**New table: commission_edit_audit**
```sql
CREATE TABLE commission_edit_audit (
  id SERIAL PRIMARY KEY,
  record_id INTEGER NOT NULL REFERENCES commission_records(id),
  edited_by VARCHAR(255) NOT NULL,
  edited_at TIMESTAMP NOT NULL DEFAULT NOW(),
  field_name VARCHAR(100) NOT NULL,
  old_value TEXT,
  new_value TEXT,
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);
```

---

## API Endpoints

### `PUT /api/commission/:id/edit`
**Edit a commission record**

**Body:**
```json
{
  "commission": 260.25,
  "theiShare": 0,
  "bsiShare": 0,
  "classification": "Agent Comp",
  "editedBy": "yahoska@healthexps.com",
  "notes": "Mis-classified as override, actually agent commission to Carolina"
}
```

**Response:**
```json
{
  "success": true,
  "record": { ... },
  "changesLogged": 3,
  "message": "Record updated successfully. 3 change(s) logged."
}
```

### `GET /api/commission/:id/audit`
**Get audit history for a record**

**Response:**
```json
{
  "record": { 
    "id": 12345,
    "commission": 260.25,
    "original_commission": 260.25,
    "is_manually_edited": true,
    "edited_by": "yahoska@healthexps.com",
    "edited_at": "2026-06-25T15:30:00Z",
    ...
  },
  "auditHistory": [
    {
      "id": 1,
      "record_id": 12345,
      "edited_by": "yahoska@healthexps.com",
      "edited_at": "2026-06-25T15:30:00Z",
      "field_name": "classification",
      "old_value": "Override",
      "new_value": "Agent Comp",
      "notes": "Mis-classified..."
    }
  ]
}
```

### `POST /api/commission/:id/revert`
**Revert to original parsed values**

**Body:**
```json
{
  "editedBy": "yahoska@healthexps.com",
  "notes": "Reverting after review"
}
```

---

## Frontend Component

### `EditCommissionModal.js`

**Usage:**
```jsx
import EditCommissionModal from '../components/EditCommissionModal';

const [editingRecord, setEditingRecord] = useState(null);

// In your table row:
<button onClick={() => setEditingRecord(record)}>
  Edit
</button>

// Render modal:
{editingRecord && (
  <EditCommissionModal
    record={editingRecord}
    onClose={() => setEditingRecord(null)}
    onSave={(updatedRecord) => {
      // Refresh data
      fetchRecords();
      setEditingRecord(null);
    }}
  />
)}
```

**Features:**
- Form validation
- Original values display (if manually edited)
- Audit history viewer
- Revert button
- Loading states
- Error handling

---

## Re-Import Protection

**Modified:** `routes/files.js` - `findDuplicates()` function

**Logic:**
1. Check for existing records with matching key
2. Exclude records where `is_manually_edited = TRUE`
3. Return only non-manually-edited duplicates for skip/overwrite decision
4. Manually edited records are **never** included in duplicate detection

**Result:** Next statement upload won't touch manually corrected records.

---

## Testing Checklist

### Manual Edit Flow
- [ ] Open edit modal for a record
- [ ] Change commission amount
- [ ] Change classification from "Override" to "Agent Comp"
- [ ] Add edit notes
- [ ] Save successfully
- [ ] Verify `is_manually_edited` = TRUE in database
- [ ] Verify original values preserved
- [ ] Verify audit log entry created

### Audit Trail
- [ ] View audit history for edited record
- [ ] Verify old → new values logged correctly
- [ ] Verify edited_by and edited_at populated
- [ ] Edit same record again
- [ ] Verify second edit logged separately

### Re-Import Protection
- [ ] Upload statement containing manually edited record
- [ ] Verify manually edited record NOT flagged as duplicate
- [ ] Verify manually edited record NOT overwritten
- [ ] Verify other (non-edited) duplicates still detected

### Reversion
- [ ] Click "Revert to Original" on edited record
- [ ] Verify values restored to original parsed values
- [ ] Verify `is_manually_edited` = FALSE
- [ ] Verify reversion logged in audit trail
- [ ] Upload statement again - should now be treated as duplicate

### Edge Cases
- [ ] Edit record with no original values (first manual edit)
- [ ] Edit record multiple times (accumulating audit entries)
- [ ] Revert record that was never edited (should error)
- [ ] Upload identical statement twice with edited record

---

## Deployment Steps

1. **Run migration:**
   ```bash
   psql $DATABASE_URL < migrations/007_manual_edit_audit.sql
   ```

2. **Deploy backend:**
   ```bash
   git add routes/edit-commission.js routes/files.js migrations/007_manual_edit_audit.sql server.js
   git commit -m "Add manual edit with audit trail"
   git push railway main
   ```

3. **Deploy frontend:**
   ```bash
   git add src/components/EditCommissionModal.js src/components/EditCommissionModal.css
   git commit -m "Add edit commission modal"
   npm run build
   # Deploy to Netlify
   ```

4. **Test in production:**
   - Find Shirley St Hill's $260.25 record
   - Edit classification from "Override" to "Agent Comp"
   - Verify override reconciliation updates correctly
   - Re-upload BSI statement containing that record
   - Verify it's not overwritten

---

## Security & Compliance

- ✅ **Audit trail immutable** - audit log never deleted
- ✅ **Evidence retention** - original parsed values preserved
- ✅ **User accountability** - every change requires `editedBy`
- ✅ **Reversion capability** - can undo manual edits
- ✅ **Re-import protection** - prevents accidental overwrites
- ✅ **Transparent history** - full audit trail visible in UI

**Compliance:** Meets financial records audit requirements (SOX, GAAP-adjacent for internal accounting).

---

## Known Limitations

1. **No batch edit** - currently one record at a time (by design for audit trail)
2. **No delete** - manual edits can only be reverted, not deleted (evidence retention)
3. **Frontend integration** - EditCommissionModal must be added to Reconciliation/AgencyProductionRecon pages manually

---

## Future Enhancements

- [ ] Batch edit with multi-select
- [ ] CSV export of audit trail
- [ ] Email notifications when high-value records edited
- [ ] Role-based permissions (only admin can edit >$500)
- [ ] Edit approval workflow for large amounts
