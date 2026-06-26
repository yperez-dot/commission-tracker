# Backend Hanging on Startup - Fix

**Date:** June 25, 2026 2:15 PM ET  
**Status:** 🚨 Backend deployment ACTIVE but not responding (hanging on startup)

---

## 🔍 **DIAGNOSIS**

**Symptoms:**
- Railway shows "ACTIVE / Deployment successful"
- Port 443 is open (confirmed with netcat)
- `/api/health` times out (no response after 10+ seconds)
- CORS error in frontend (because backend never responds)

**Root Cause:** Backend hanging on database initialization

**Evidence:**
```javascript
// server.js line 17
initSchema().then(() => {
  // ... register routes ...
  app.listen(PORT, () => {
    console.log('Server started');
  });
});
```

**The server only starts AFTER initSchema() completes.**

If `initSchema()` hangs waiting for database connection:
- ✅ Railway deployment succeeds (build completed)
- ✅ Container starts (port 443 open)
- ❌ Node.js process stuck in `initSchema()`
- ❌ Server never calls `app.listen()`
- ❌ No HTTP requests answered

---

## 🚨 **WHAT YOU NEED TO CHECK IN RAILWAY**

**I cannot access Railway - you need to check these:**

### **1. Runtime Logs (Most Important)**

**Where:** Railway dashboard → commission-tracker backend → Deployments tab → Click on ACTIVE deployment → View Logs

**Look for:**
- ✅ "Server started on port 3001" (or similar) → means initSchema() completed
- ❌ Stuck after "Connecting to database..." → database timeout
- ❌ "Error: connect ETIMEDOUT" → database unreachable
- ❌ "Error: password authentication failed" → DATABASE_URL wrong
- ❌ No logs at all → process crashed silently

**Screenshot the last 20-30 lines and send to me.**

---

### **2. Environment Variables**

**Where:** Railway dashboard → commission-tracker backend → Settings/Variables tab

**Check these are set:**
- ✅ `DATABASE_URL` - PostgreSQL connection string (starts with `postgres://` or `postgresql://`)
- ✅ `JWT_SECRET` - Any string (for auth tokens)
- ⚠️ `PORT` - Optional (Railway sets this automatically)

**If DATABASE_URL is missing or wrong:**
- Backend will hang forever trying to connect
- This matches our symptoms exactly

---

### **3. Database Status**

**Where:** Railway dashboard → PostgreSQL database (separate service)

**Check:**
- ✅ Database service is "ACTIVE"
- ✅ Database has recent activity (connections)
- ❌ Database is "CRASHED" or "RESTARTING"

---

## 🔧 **FIXES (Depending on What You Find)**

### **FIX #1: DATABASE_URL Missing or Wrong**

**If DATABASE_URL is missing in environment variables:**

1. Find the correct DATABASE_URL:
   - Railway dashboard → PostgreSQL service → Connect tab → Copy connection string
2. Add it to backend environment variables:
   - Backend service → Variables tab → Add variable
   - Name: `DATABASE_URL`
   - Value: `postgresql://user:pass@host:port/dbname`
3. Backend will auto-redeploy with correct URL

---

### **FIX #2: Database Service Down**

**If PostgreSQL service shows "CRASHED":**

1. Railway dashboard → PostgreSQL service → Settings
2. Click "Restart Service"
3. Wait 1-2 minutes for database to come up
4. Backend should reconnect automatically

---

### **FIX #3: Code Change (Add Timeout + Error Handling)**

**If database is unreachable but we need backend up NOW:**

I can add connection timeout and fallback:

```javascript
// db/database.js
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 5000,  // Fail fast after 5 seconds
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// server.js
initSchema()
  .then(() => {
    app.listen(PORT, () => console.log('Server started'));
  })
  .catch(err => {
    console.error('Database init failed:', err);
    // Start server anyway (read-only mode)
    app.listen(PORT, () => console.log('Server started (DB unavailable)'));
  });
```

**This allows backend to start even if database is down.**

---

### **FIX #4: Emergency Revert (Last Resort)**

**If nothing else works and you need OliComm up NOW:**

```bash
cd ~/.openclaw/workspace/commission-tracker
git revert --no-commit f9b7181^..eb37e1b
git commit -m "Emergency revert - backend hanging on startup"
git push origin main
```

**Wait 2-3 minutes for Railway to redeploy to yesterday's version.**

---

## 📋 **WHAT I NEED FROM YOU**

**To fix this, send me:**

1. **Screenshot of Railway runtime logs** (last 30 lines of ACTIVE deployment)
2. **DATABASE_URL status** (Is it set? Does it start with `postgresql://`?)
3. **Database service status** (ACTIVE? CRASHED?)

**OR just tell me:**
- "Logs show: [last line you see]"
- "DATABASE_URL: [present/missing/wrong]"
- "Database: [ACTIVE/CRASHED]"

---

## ⏱️ **WHY THIS HAPPENED NOW**

**Today's commits didn't introduce hanging code**, but:

1. Railway might have rotated database credentials
2. Database service might have restarted during deploy
3. Deployment timing caused database connection race condition
4. No connection timeout = hangs forever instead of failing fast

**The fix is to add proper error handling + timeout.**

---

## 🎯 **RECOMMENDATION**

**Check Railway logs first (30 seconds)**, then:

- **If DATABASE_URL missing:** Add it (Fix #1)
- **If database crashed:** Restart it (Fix #2)  
- **If logs show hang with no error:** I'll add timeout (Fix #3)
- **If you need OliComm NOW:** Revert (Fix #4)

---

**Waiting for Railway logs report.**
