# Auto Plan Change Detection Specification

## Overview
Automatically detect potential plan changes when new commission statements are uploaded by comparing new client records against the existing Book of Business.

## Trigger
- Runs automatically after every successful commission statement upload
- Processes all newly inserted records from that upload

## Detection Logic

### Matching Criteria (ALL must be met)
1. **Same Agent** - Exact match on agent_name
2. **Fuzzy Name Match**:
   - Last name: Exact match (case-insensitive)
   - First name: Starts with same 3+ characters (case-insensitive)
3. **Different Carrier** - Must be different carriers
4. **Date Comparison** - New effective_date > existing BOB last_commission_date

### Name Parsing Rules

**Format 1: "FIRST LAST"** (e.g., "MARY RAMAGE")
- First name: First word
- Last name: Remaining words

**Format 2: "LAST, FIRST"** (e.g., "CARRENO, GAIL")
- Last name: Before comma
- First name: After comma

**Format 3: "FIRST MIDDLE LAST"** (e.g., "MARY RAMAGE K")
- First name: First word
- Last name: Last word (ignore middle initials)

### Examples That Should Match

| BOB Entry                | New Record              | Match? | Reason                              |
|--------------------------|-------------------------|--------|-------------------------------------|
| MARY RAMAGE (Solis)      | MARY RAMAGE K (Humana)  | ✅     | Last: RAMAGE, First: MAR (same 3)   |
| CARRENO, GAIL (Aetna)    | GAIL CARRENO (UHC)      | ✅     | Last: CARRENO, First: GAI (same 3)  |
| JOHN SMITH (Humana)      | JONATHAN SMITH (Aetna)  | ✅     | Last: SMITH, First: JOH (same 3)    |
| MARY JOHNSON (UHC)       | MARY JOHNSTON (Humana)  | ❌     | Last: JOHNSON ≠ JOHNSTON            |
| JOHN SMITH (Humana)      | JOHN SMITH (Humana)     | ❌     | Same carrier                        |

## Database Schema

### New Table: `plan_change_candidates`
```sql
CREATE TABLE plan_change_candidates (
  id SERIAL PRIMARY KEY,
  bob_id INT NOT NULL REFERENCES book_of_business(id),
  new_record_id INT NOT NULL REFERENCES commission_records(id),
  agent_name TEXT NOT NULL,
  client_name TEXT NOT NULL,
  old_carrier TEXT NOT NULL,
  new_carrier TEXT NOT NULL,
  old_effective_date TEXT,
  new_effective_date TEXT,
  confidence_score DECIMAL(3,2),  -- 1.0 = exact name match, 0.8 = fuzzy match
  status TEXT DEFAULT 'pending',  -- 'pending', 'confirmed', 'dismissed'
  confirmed_at TIMESTAMPTZ,
  confirmed_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(bob_id, new_record_id)
);

CREATE INDEX idx_plan_change_candidates_status ON plan_change_candidates(status);
CREATE INDEX idx_plan_change_candidates_bob_id ON plan_change_candidates(bob_id);
```

## API Endpoints

### POST /api/plan-changes/detect
- Runs plan change detection for a specific upload
- Called automatically after upload completes
- Returns count of candidates found

### GET /api/plan-changes/candidates
- Returns all pending plan change candidates
- Filterable by agent, carrier, status

### POST /api/plan-changes/:id/confirm
- Confirms a plan change candidate
- Updates BOB entry: `status = 'plan_change'`
- Updates candidate: `status = 'confirmed'`
- Returns updated BOB entry

### POST /api/plan-changes/:id/dismiss
- Dismisses a false positive
- Updates candidate: `status = 'dismissed'`

## Frontend Changes

### Book of Business Page

**New Tab: "Plan Changes"**
- Shows pending plan change candidates
- Grouped by client/agent
- Side-by-side comparison: Old Carrier vs New Carrier

**BOB Table Row Badges:**
- Yellow ⚠️ badge on entries with pending plan change candidates
- Shows: "Potential Plan Change → [New Carrier]"
- Click badge → opens confirmation modal

**Confirmation Modal:**
```
⚠️ Confirm Plan Change?

Client: Mary Ramage
Agent: Katy Robles

OLD: Solis (Eff: 01/01/2024, Last Paid: 04/15/2026)
NEW: Humana (Eff: 01/01/2026)

[Confirm Plan Change] [Not a Plan Change]
```

**Actions:**
- **Confirm**: Marks BOB entry as `plan_change`, hides from Missing Renewals
- **Dismiss**: Removes candidate, no further action

## Workflow

1. **Upload commission statement**
2. **Insert records** → commission_records table
3. **Run detection** → Scan BOB for matches
4. **Insert candidates** → plan_change_candidates table
5. **User reviews** → BOB page shows badges
6. **User confirms/dismisses** → Updates BOB + candidate status

## Business Rules

- Plan change entries are **excluded from Missing Renewals** (like termed clients)
- BOB entry remains active until manually confirmed
- Confidence score helps prioritize review (1.0 = exact, 0.8 = fuzzy)
- Only most recent plan change candidate shown per BOB entry

## Edge Cases

### Multiple Candidates
- If one BOB entry matches multiple new records, show all
- User confirms each individually

### Same Client, Multiple Agents
- Only match if same agent (prevents false positives)

### Name Variations
- "Mary" vs "Maria" → Should NOT match (different first 3 chars)
- "John" vs "Jon" → Should match (both start with "JON")

## Performance

- Detection runs async after upload (doesn't block response)
- Index on `plan_change_candidates(status, bob_id)`
- Fuzzy matching uses SQL ILIKE with wildcards (not regex)

## Future Enhancements

- Email notifications for new candidates
- Bulk confirm/dismiss
- Auto-confirm if confidence > 0.95
- Integration with carrier APIs to verify enrollments

---
**Approved**: 2026-06-19  
**Status**: ✅ Ready to build
