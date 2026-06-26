# Railway Emergency Checklist - CORS Still Broken After Revert

**Time:** 5:00 PM ET  
**Status:** 3+ hours down, revert didn't fix it  
**Issue:** Railway environment problem, not code

---

## 🚨 **CHECK THESE IN RAILWAY DASHBOARD NOW**

### **1. Is Revert Actually Deployed?**

**Where:** Railway → Backend → Deployments tab

**Check:**
- Is commit **1a1a95e** showing as ACTIVE?
- OR is an older commit (eb37e1b, d7d1d7f) still ACTIVE?

**If 1a1a95e is NOT active:**
- Railway might be stuck on old deployment
- **Action:** Click "Redeploy" on 1a1a95e

---

### **2. Check Runtime Logs (CRITICAL)**

**Where:** Railway → Backend → ACTIVE deployment → View Logs

**Look for:**
- ✅ "Server started on port 3001" → Backend is running
- ❌ Crash loop / no startup message → Backend not starting
- ⚠️ "CORS" or "origin" errors → CORS middleware issue

**If no "Server started" message:**
- Backend never started successfully
- **Action:** Check for crash errors in logs

---

### **3. Force Restart Backend**

**Where:** Railway → Backend → Settings tab

**Action:**
1. Click "Restart Deployment" button
2. Wait 2 minutes
3. Check if OliComm loads

**This clears any cached/stuck state**

---

### **4. Check Environment Variables**

**Where:** Railway → Backend → Variables tab

**Verify these are set:**
- ✅ DATABASE_URL (starts with `postgresql://`)
- ✅ JWT_SECRET (any string)
- ⚠️ Check if any CORS-related vars exist (shouldn't, but check)

**If you see:**
- `ALLOWED_ORIGINS` or similar → delete it (we hardcode in server.js)
- `CORS_ORIGIN` or similar → delete it

---

### **5. Test Backend Directly**

**Try this URL in your browser:**
```
https://commission-tracker-production-e4fc.up.railway.app/api/health
```

**Expected:**
```json
{"status":"ok","timestamp":"2026-06-25T..."}
```

**If you get:**
- ✅ JSON response → Backend is running
- ❌ Timeout / no response → Backend is down
- ❌ Railway error page → Service crashed

---

## 🔧 **EMERGENCY FIXES (In Order)**

### **FIX #1: Force Redeploy (2 minutes)**

1. Railway → Backend → Deployments tab
2. Find commit **1a1a95e**
3. Click "..." → "Redeploy"
4. Wait 2-3 minutes
5. Test OliComm

**If this works:** Problem was cached deployment

---

### **FIX #2: Restart Service (2 minutes)**

1. Railway → Backend → Settings tab
2. Click "Restart Deployment"
3. Wait 2 minutes
4. Test OliComm

**If this works:** Problem was stuck process

---

### **FIX #3: Check Database Connection (5 minutes)**

1. Railway → PostgreSQL service
2. Check status (should be ACTIVE)
3. If CRASHED → Restart database service
4. Backend should reconnect automatically

**If this works:** Database was down, backend couldn't start

---

### **FIX #4: Rollback to Specific Deployment (5 minutes)**

1. Railway → Backend → Deployments tab
2. Find a deployment from **June 24** that worked
3. Click "..." → "Redeploy"
4. Wait 3 minutes
5. Test OliComm

**If this works:** Something broke in Railway between June 24-25

---

### **FIX #5: Nuclear Option - Recreate Service (30 minutes)**

**ONLY if nothing else works:**

1. Railway → Create new project
2. Connect to same GitHub repo
3. Set environment variables (DATABASE_URL, JWT_SECRET)
4. Deploy
5. Update Netlify to point to new Railway URL

**This gives you a fresh Railway service**

---

## 📊 **WHAT TO REPORT BACK**

**Send me:**

1. **Active deployment commit:** 1a1a95e? eb37e1b? Something else?
2. **Runtime logs last line:** "Server started"? Error? Nothing?
3. **Direct backend test:** Does `/api/health` respond?
4. **Database status:** ACTIVE? CRASHED?

**Then I'll tell you exactly what to do.**

---

## ⚡ **QUICK DIAGNOSTIC**

**Run this command in Railway logs:**

If you see:
- ✅ "Server started on port 3001" → Backend is up, CORS issue is routing/proxy
- ❌ "MODULE_NOT_FOUND" → Revert didn't deploy, force redeploy
- ❌ "ETIMEDOUT" → Database connection issue
- ❌ Nothing → Backend crashed on startup

---

## 🎯 **MOST LIKELY CAUSE**

**Railway is stuck serving old deployment (eb37e1b or d7d1d7f)**

**Solution:** Force redeploy of 1a1a95e

**How:**
1. Railway → Deployments
2. Find 1a1a95e
3. "..." → "Redeploy"
4. Wait 3 minutes
5. OliComm should load

---

**Check Railway NOW and report back what you see.**
