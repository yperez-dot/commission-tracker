# Fix #2: Name-Bleed Re-Parse Checklist

## ⚠️ CRITICAL: Test First, Don't Delete Until Proven

---

## ☑️ Step 1: Fix Parser

**File:** `routes/files.js`, function `parseBSIPDF` (line ~2640)

**Add name-bleed detection:**
```javascript
// After extracting policy number, check for name bleed
const policyMatch = clientRaw.match(/^([0-9A-Z]+)([A-Z]{4,})$/);
if (policyMatch) {
  // Policy has name bleed: "929779560RODRIGUEZ"
  const cleanPolicy = policyMatch[1];  // "929779560"
  const bleedSurname = policyMatch[2];  // "RODRIGUEZ"
  
  // Add surname to client name if missing
  if (!clientRaw.includes(bleedSurname)) {
    clientRaw = bleedSurname + ' ' + clientRaw;
  }
  
  // Use clean policy
  policyNumber = cleanPolicy;
}
```

**Commit:** `git commit -m "Fix #2: Add name-bleed split to BSI parser"`

---

## ☑️ Step 2: Test on ONE Statement

**Choose test file:** One BSI statement containing Guido Rodriguez Jr

**Upload through UI:**
1. Go to OliComm → Upload
2. Select ONE test file
3. Upload
4. Check console for errors

**Verify in database:**
```sql
SELECT client_full_name, policy_number, commission, carrier
FROM commission_records
WHERE source = 'BSI'
  AND client_full_name LIKE '%Rodriguez%'
ORDER BY uploaded_at DESC
LIMIT 5;
```

**Expected:**
- ✅ Name: "Guido Rodriguez Jr" (NOT "Jr, Guido A.")
- ✅ Policy: "929779560" (NOT "929779560RODRIGUEZ")
- ✅ Commission: $37.50

**Test matching:**
1. Go to Agency Override Recon
2. Open console (F12)
3. Search for Guido Rodriguez Jr
4. Look for `[MATCH DEBUG]` messages
5. Verify: clientMatch = true ✅

**❌ IF TEST FAILS:**
- DO NOT PROCEED to Step 3
- Debug parser logic
- Re-test on same file
- Repeat until test passes

**✅ IF TEST PASSES:**
- Proceed to Step 3

---

## ☑️ Step 3: Back Up Existing Data

**Option A: CSV Export**
1. Go to OliComm → All Data page
2. Filter: Source = BSI
3. Export all BSI records to CSV
4. Save as: `bsi_records_backup_YYYY-MM-DD.csv`

**Option B: Database Snapshot**
```sql
-- Export BSI records to backup table
CREATE TABLE commission_records_bsi_backup AS
SELECT * FROM commission_records
WHERE source = 'BSI';

-- Verify count
SELECT COUNT(*) FROM commission_records_bsi_backup;
```

**Verify manual edits preserved:**
```sql
SELECT id, client_full_name, commission, classification, 
       is_manually_edited, edit_notes
FROM commission_records
WHERE is_manually_edited = true
  AND source = 'BSI';
```

**Save this list** - will need to re-apply after re-parse if they get overwritten

---

## ☑️ Step 4: Delete Old BSI Records

**⚠️ ONLY after Step 2 test passes and Step 3 backup complete!**

```sql
-- Delete BSI records (parsed with old parser)
DELETE FROM commission_records
WHERE source = 'BSI';

-- Verify deletion
SELECT COUNT(*) FROM commission_records WHERE source = 'BSI';
-- Expected: 0
```

---

## ☑️ Step 5: Re-Upload ALL BSI Statements

**Upload through UI:**
1. Go to OliComm → Upload
2. Select ALL BSI statement PDFs
3. Upload one by one (or batch if supported)
4. Monitor console for errors

**Verify counts:**
```sql
SELECT 
  COUNT(*) as total,
  COUNT(DISTINCT client_full_name) as unique_clients,
  COUNT(DISTINCT policy_number) as unique_policies
FROM commission_records
WHERE source = 'BSI';
```

**Spot check names:**
```sql
SELECT client_full_name, policy_number, commission, carrier
FROM commission_records
WHERE source = 'BSI'
  AND (
    client_full_name LIKE '%Rodriguez%' OR
    client_full_name LIKE '%Vazquez%' OR
    client_full_name LIKE '%Fertil%'
  )
ORDER BY client_full_name;
```

**Expected:**
- ✅ Names clean (no "Jr, Guido A." mangled names)
- ✅ Policies clean (no "929779560RODRIGUEZ" bleed)
- ✅ All surnames present

---

## ☑️ Step 6: Re-Apply Manual Edits

**Check if manual edits survived:**
```sql
SELECT id, client_full_name, commission, classification, 
       is_manually_edited, edit_notes
FROM commission_records
WHERE is_manually_edited = true
  AND source = 'BSI';
```

**If manual edits lost:**
1. Find records in backup (Step 3)
2. Re-apply through UI (Edit Commission feature)
3. Re-verify is_manually_edited = true

**Known manual edits:**
- Shirley St Hill: $260.25 reclassified from Override to Agent Commission (Carolina's)

---

## ☑️ Step 7: Verify Agency Override Matching

**Go to OliComm → Agency Override Recon**

**Check Missing count:**
- Before: 706
- After: ~78-200 (expected)

**Test cases:**

1. **Guido Rodriguez Jr (UHC)**
   - Status: Should be in Paid tab ✅
   - Override: $37.50

2. **Sandra Fertil (Doctors)**
   - Status: Check if Doctors payment matches
   - NOT UHC $150 (earlier note was wrong)

3. **Freedom/Anthem/HealthSpring clients**
   - Status: Should stay Missing (no statements uploaded yet)
   - Freedom: ~7 records
   - Anthem: ~8 records
   - HealthSpring: ~6 records

**Console verification:**
- Open console (F12)
- Look for `[MATCH DEBUG]` messages showing matches
- Verify: clientMatch = true for previously-broken names

---

## ☑️ Step 8: Final Verification

**Expected results:**

✅ **Missing count:** 706 → ~78-200  
✅ **Guido Rodriguez Jr:** Moved to Paid  
✅ **Name-bleed records:** All matching now  
✅ **Manual edits:** Preserved or re-applied  
✅ **Freedom/Anthem/HealthSpring:** Still Missing (correct - no statements)

**Breakdown of remaining Missing (~78-200):**
- ~57: UHC/Humana "no payment found" (legitimate)
- ~21: Anthem/Freedom/HealthSpring "unverified" (no statements yet)
- ~0-100: Other (plan change, termed, denied, etc.)

---

## 🚨 Emergency Rollback

**If something goes wrong:**

1. **Stop immediately**
2. **Restore from backup:**
   ```sql
   -- Restore from backup table
   INSERT INTO commission_records
   SELECT * FROM commission_records_bsi_backup;
   ```
3. **Or restore from CSV:**
   - Use OliComm → Upload → Import CSV
   - Upload backup CSV from Step 3

4. **Revert parser code:**
   ```bash
   git revert <commit-hash>
   git push origin main
   ```

---

## 📝 Notes

- **PDFs are safe** - not deleting source files, only re-parsing
- **Test on one file first** - prove parser works before full re-parse
- **Back up first** - always reversible
- **Manual edits** - preserve or re-apply after re-parse
- **Deploy hygiene** - one commit, watch it go active before next

---

## ✅ Completion Checklist

- [ ] Parser fixed (routes/files.js)
- [ ] Test on ONE file (Guido verified clean)
- [ ] Backup created (CSV or DB snapshot)
- [ ] Old records deleted
- [ ] All statements re-uploaded
- [ ] Manual edits re-applied
- [ ] Missing count verified (~78-200)
- [ ] Test cases verified (Guido, Sandra, Freedom/Anthem)
- [ ] Console shows matches working
- [ ] Handoff complete

**When all checked:** Fix #2 complete! 🎉
