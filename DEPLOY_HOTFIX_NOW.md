# Deploy HOTFIX (d7d1d7f) Manually - Step by Step

**Time:** 5:05 PM ET  
**Goal:** Deploy d7d1d7f (HOTFIX - fixes require path crash)  
**Status:** Two builds stuck in "Building" for 1 hour

---

## 🎯 **WHAT TO DO IN RAILWAY (Step by Step)**

### **Step 1: Cancel Stuck Builds (1 minute)**

1. **Go to:** Railway → Backend service → Deployments tab
2. **Find stuck builds:**
   - d7d1d7f (HOTFIX)
   - 1a1a95e (EMERGENCY REVERT)
   - Both should show "Building" status
3. **Cancel them:**
   - Click on d7d1d7f → Click "Cancel Build" button
   - Click on 1a1a95e → Click "Cancel Build" button
4. **Verify:** Both now show "Cancelled" or "Failed"

---

### **Step 2: Trigger Manual Deploy of HOTFIX (2 minutes)**

1. **Go to:** Railway → Backend service → Deployments tab
2. **Find commit d7d1d7f** (HOTFIX: Fix require path in edit-commission.js)
3. **Click the "..." menu** on that deployment
4. **Select "Redeploy"**
5. **Watch the build:**
   - Should go from "Building" → "Deploying" → "Active"
   - Should complete in 2-3 minutes (not 1 hour!)

---

### **Step 3: If Build Hangs Again** (Fallback)

**If d7d1d7f starts building but hangs again:**

#### **Option A: Use Railway CLI to force deploy**

```bash
# Install Railway CLI (if not installed)
npm i -g @railway/cli

# Login
railway login

# Link to project
railway link

# Force deploy specific commit
railway up --service backend
```

#### **Option B: Restart Railway Service**

1. Railway → Backend → Settings tab
2. Click "Restart Deployment"
3. This clears stuck state
4. Try "Redeploy" d7d1d7f again

#### **Option C: Check Railway Status**

- Go to: https://status.railway.app
- Check if Railway has infrastructure issues
- If yes, wait for Railway to fix it

---

## 🔍 **Why Builds Might Be Hanging**

### **Possible Causes:**

1. **Railway resource limits hit** - Too many builds today
2. **npm install timeout** - Dependencies taking too long
3. **Railway infrastructure issue** - Their build servers stuck
4. **Database connection during build** - Trying to connect too early
5. **Docker build cache issue** - Stale cache causing problems

### **Solutions:**

**If npm install is hanging:**
1. Railway → Settings → Clear Build Cache
2. Redeploy

**If Railway is having issues:**
1. Check https://status.railway.app
2. Wait 10-15 minutes
3. Try again

**If builds keep hanging:**
1. Use Railway CLI to force deploy (see Option A above)
2. OR recreate Railway service (nuclear option)

---

## ✅ **WHAT HOTFIX DOES (d7d1d7f)**

**Fixes the crash:**
```javascript
// BEFORE (BROKEN):
const pool = require('../db');  // ❌ MODULE_NOT_FOUND

// AFTER (FIXED):
const { getPool } = require('../db/database');  // ✅ Works
const pool = getPool();
```

**All today's work preserved:**
- ✅ Compound surname fix
- ✅ Sales Recon fixes (dedup, netting, BOB status)
- ✅ Agency Override Recon fix
- ✅ Shared utility
- ✅ Manual edit feature (with crash fix)

---

## 📊 **EXPECTED TIMELINE**

**After deploying HOTFIX (d7d1d7f):**

- **~5:10 PM:** Cancel stuck builds (done in 1 min)
- **~5:12 PM:** Trigger HOTFIX redeploy
- **~5:15 PM:** Backend ACTIVE (if build works)
- **~5:16 PM:** OliComm loads successfully

**Then you can check:**
- Override Recon missing count (~78)
- Sandra Fertil status
- Freedom deduplication

---

## 🚨 **IF BUILD HANGS AGAIN**

**Tell me immediately and I'll:**
1. Check Railway status page
2. Provide Railway CLI commands
3. OR help recreate service if needed

---

## 📝 **QUICK SUMMARY**

**Do this NOW:**
1. Railway → Deployments
2. Cancel both stuck builds (d7d1d7f and 1a1a95e)
3. Redeploy d7d1d7f manually
4. Watch build (should finish in 2-3 min, not 1 hour)
5. Test OliComm at ~5:15 PM

**If successful:** All today's work is live + crash is fixed
**If hangs again:** Tell me and I'll help with Railway CLI

---

**Go cancel those builds and redeploy d7d1d7f NOW!**
