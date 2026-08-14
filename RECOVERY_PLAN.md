# Recovery Plan - Re-Apply Today's Fixes Safely

**Date:** June 25, 2026 4:42 PM ET  
**Status:** Emergency revert deployed (commit 1a1a95e)  
**Expected backend up:** ~4:45 PM ET

---

## 🚨 **WHAT HAPPENED**

**Timeline:**
- **1:30 PM:** Pushed 8 commits (f9b7181 through eb37e1b)
- **1:58 PM:** Backend crashed - `MODULE_NOT_FOUND` in `routes/edit-commission.js`
- **2:16 PM:** Pushed hotfix (d7d1d7f) to fix require path
- **4:39 PM:** Still down with CORS errors
- **4:42 PM:** Emergency revert (1a1a95e) - returning to June 24 stable

**Root cause:** Manual Edit Feature (f0b9b97) had wrong require path, crashed backend on startup

**Total downtime:** ~3 hours

---

## ✅ **IMMEDIATE RECOVERY (Next 5 Minutes)**

**Commit 1a1a95e reverts to last known good (a08a4e5 from June 24)**

**Expected:**
- ⏱️ Railway deploys in 2-3 minutes
- ✅ Backend starts normally
- ✅ OliComm loads at ~4:45 PM
- ✅ All June 24 functionality restored

**When backend is up:**
1. ✅ Hard refresh OliComm (Ctrl+Shift+R)
2. ✅ Log in - verify it works
3. ✅ Check Agency Override Recon loads
4. ✅ Confirm no CORS errors

---

## 📋 **RE-APPLY PLAN (After Backend is Stable)**

**Strategy:** Apply fixes **ONE AT A TIME** with testing between each

**Order of re-application (safest first):**

### **1. Compound Surname Fix (f9b7181) - LOW RISK**
**What it does:** normName() handles compound Hispanic surnames
**Files:** routes/bob.js, frontend pages (4 files)
**Risk:** Low - pure logic fix, no new dependencies
**Test:** Check Override Recon loads, no crashes

---

### **2. Sales Recon Fixes (428e826 + a80eeeb + 9c78a2e + d6f3696) - LOW RISK**
**What it does:** Dedup, BOB status, limit 50k, type-aware netting
**Files:** Frontend only (src/pages/Reconciliation.js, routes/medicarepro.js)
**Risk:** Low - frontend changes only
**Test:** Sales Recon loads, Karl Brown shows correct status

**Combine into one commit for efficiency**

---

### **3. Agency Override Recon Fix (ba16a5d) - LOW RISK**
**What it does:** Dedup, type-aware netting, BOB status for Override Recon
**Files:** Frontend only (src/pages/AgencyProductionRecon.js)
**Risk:** Low - frontend changes only
**Test:** Override Recon loads, missing count ~78, Sandra Fertil OUT of Missing

---

### **4. Shared Utility (eb37e1b) - MEDIUM RISK**
**What it does:** Create reusable matching logic
**Risk:** Medium - not used yet, but adds new code
**Test:** Backend starts, no new errors

**NOTE:** Don't integrate into screens yet - just add the file

---

### **5. Manual Edit Feature (f0b9b97) - HIGH RISK ⚠️**
**What it does:** Edit commission records with audit trail
**Files:** 
- migrations/007_manual_edit_audit.sql
- routes/edit-commission.js ⚠️ (this crashed backend)
- src/components/EditCommissionModal.js + .css
- server.js (route registration)

**Risk:** High - caused today's crash

**BEFORE re-applying:**
1. ✅ Fix require path: `require('../db/database')` not `require('../db')`
2. ✅ Test locally: `node --check routes/edit-commission.js`
3. ✅ Check all pool.connect() calls work
4. ✅ Deploy with extra caution

**Test thoroughly:**
- Backend starts (most important)
- /api/health responds
- Modal loads without errors

---

## 🔧 **STEP-BY-STEP RE-APPLICATION**

### **Step 1: Compound Surname Fix**

```bash
# Cherry-pick f9b7181
git cherry-pick f9b7181

# Test locally
node --check routes/bob.js
node --check src/pages/AgencyProductionRecon.js

# Push
git push origin main

# Wait 3 minutes for Railway deploy
# Test: OliComm loads, Override Recon works
```

**If successful:** Continue to Step 2  
**If crashes:** Revert immediately

---

### **Step 2: Sales Recon Fixes (Combined)**

```bash
# Create new branch for safety
git checkout -b sales-recon-fixes

# Cherry-pick multiple commits
git cherry-pick 428e826  # Fix #6 Part 1
git cherry-pick a80eeeb  # Fix #6 Part 2
git cherry-pick 9c78a2e  # Critical netting
git cherry-pick d6f3696  # Type-aware netting

# Squash into one commit
git reset --soft HEAD~4
git commit -m "Sales Recon fixes: dedup + netting + BOB status (combined)"

# Test locally
node --check src/pages/Reconciliation.js

# Merge to main
git checkout main
git merge sales-recon-fixes
git push origin main

# Wait 3 minutes
# Test: Sales Recon loads, Karl Brown correct
```

---

### **Step 3: Agency Override Recon Fix**

```bash
git cherry-pick ba16a5d

# Test locally  
node --check src/pages/AgencyProductionRecon.js

git push origin main

# Wait 3 minutes
# Test: Override Recon loads, count ~78, Sandra Fertil OUT
```

---

### **Step 4: Shared Utility (Optional)**

```bash
git cherry-pick eb37e1b

# Test locally

git push origin main

# Wait 3 minutes
# Test: Backend still works (utility not used yet)
```

---

### **Step 5: Manual Edit Feature (CAREFUL)**

```bash
# Create new commit with fixed require path
# DON'T cherry-pick f0b9b97 (it has the bug)

# Create fresh version:
git checkout -b manual-edit-fixed

# Copy files manually (with fix applied):
# - routes/edit-commission.js (FIX require path first!)
# - migrations/007_manual_edit_audit.sql
# - src/components/EditCommissionModal.js + .css

# Test extensively:
node --check routes/edit-commission.js
node --check server.js

# Create new commit
git add routes/edit-commission.js migrations/007_manual_edit_audit.sql src/components/
git commit -m "Manual edit feature (FIXED require path)"

# Merge carefully
git checkout main
git merge manual-edit-fixed

# Push with prayer
git push origin main

# WATCH RAILWAY LOGS CLOSELY
# If MODULE_NOT_FOUND appears, revert immediately
```

---

## ⚠️ **SAFETY RULES**

1. **ONE commit at a time** - no bulk pushes
2. **Wait 3 minutes** between pushes - let Railway deploy fully
3. **Test after each deploy** - don't proceed if something breaks
4. **Watch Railway logs** - catch crashes immediately
5. **Have revert ready** - `git revert HEAD` if anything fails

---

## 🎯 **SUCCESS CRITERIA**

**After all re-applications:**
1. ✅ OliComm loads normally
2. ✅ Override Recon shows ~78 missing (not 700)
3. ✅ Sandra Fertil OUT of Missing tab
4. ✅ Karl Brown shows "Deceased" status
5. ✅ Freedom clients deduplicated
6. ✅ Sales Recon shows correct paid/unpaid

---

## 📊 **TIMELINE ESTIMATE**

- **Step 1 (Compound surnames):** 10 minutes
- **Step 2 (Sales Recon combined):** 15 minutes  
- **Step 3 (Override Recon):** 10 minutes
- **Step 4 (Shared utility):** 10 minutes
- **Step 5 (Manual edit):** 20 minutes (extra testing)

**Total: ~65 minutes** (just over 1 hour)

---

## 🚀 **WHEN TO START**

**NOT TODAY** - It's 4:42 PM, you've been dealing with this for 3 hours

**Tomorrow (June 26):**
1. ✅ Verify OliComm is stable on June 24 version
2. ✅ Start fresh in the morning
3. ✅ Apply fixes one at a time
4. ✅ Complete by lunch if no issues

**Priority:** Get OliComm stable TODAY, fix bugs TOMORROW

---

## 📝 **LESSONS LEARNED**

1. **Test locally before pushing** - `node --check` all modified files
2. **Never push 8+ commits at once** - too hard to debug
3. **Check require paths** - `require('../db')` vs `require('../db/database')`
4. **Add connection timeouts** - prevent hanging on database issues
5. **Have rollback plan** - revert should be 1 command, not panic

---

**Backend should be up in 2 minutes. Check OliComm at 4:45 PM.**
