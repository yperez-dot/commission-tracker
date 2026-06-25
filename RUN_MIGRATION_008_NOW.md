# RUN MIGRATION 008 NOW - Fix Sales Reconciliation Crash

**Time:** 5:15 PM ET  
**Error:** "column bob.is_termed does not exist"  
**Cause:** Code deployed without database schema update  
**Fix:** Run migration to add missing columns

---

## 🚨 **THE PROBLEM**

**Code expects these columns in `book_of_business` table:**
- `is_termed` (boolean) - Flag for terminated clients
- `deceased_date` (date) - Date when client deceased

**But database doesn't have them yet** → Sales Recon crashes

---

## ✅ **THE FIX - Run Migration 008**

**File created:** `migrations/008_add_bob_status_columns.sql`

**What it does:**
1. ✅ Adds `is_termed` column (BOOLEAN)
2. ✅ Adds `deceased_date` column (DATE)
3. ✅ Updates existing records (marks as termed if status contains "term")
4. ✅ Creates indexes for performance

---

## 🔧 **HOW TO RUN MIGRATION (3 Options)**

### **OPTION A: Railway Dashboard (Easiest - 2 minutes)**

1. **Go to Railway** → PostgreSQL database service
2. **Click "Data" tab** (or "Query" tab if available)
3. **Copy this SQL:**

```sql
-- Migration 008: Add is_termed and deceased_date columns
BEGIN;

ALTER TABLE book_of_business 
ADD COLUMN IF NOT EXISTS is_termed BOOLEAN DEFAULT FALSE;

ALTER TABLE book_of_business 
ADD COLUMN IF NOT EXISTS deceased_date DATE;

UPDATE book_of_business 
SET is_termed = TRUE 
WHERE LOWER(status) LIKE '%term%';

CREATE INDEX IF NOT EXISTS idx_bob_is_termed ON book_of_business(is_termed);
CREATE INDEX IF NOT EXISTS idx_bob_deceased_date ON book_of_business(deceased_date);

COMMIT;
```

4. **Click "Run Query" or "Execute"**
5. **Should see:** "ALTER TABLE" success messages

---

### **OPTION B: psql Command Line (If You Have Access)**

```bash
# Get DATABASE_URL from Railway environment variables
# Railway → Backend → Variables → DATABASE_URL

# Connect with psql
psql "postgresql://user:password@host:port/database"

# Run migration
\i migrations/008_add_bob_status_columns.sql

# Verify
\d book_of_business
# Should show is_termed and deceased_date columns

# Exit
\q
```

---

### **OPTION C: Railway CLI**

```bash
# Install Railway CLI (if not installed)
npm i -g @railway/cli

# Login
railway login

# Link to project
railway link

# Connect to database
railway connect postgres

# In psql prompt:
\i migrations/008_add_bob_status_columns.sql

# Exit
\q
```

---

## ✅ **VERIFY MIGRATION WORKED**

**After running migration, test this query:**

```sql
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'book_of_business' 
AND column_name IN ('is_termed', 'deceased_date');
```

**Expected output:**
```
 column_name  | data_type
--------------+-----------
 is_termed    | boolean
 deceased_date| date
```

---

## 🎯 **AFTER MIGRATION (Test OliComm)**

1. **Hard refresh OliComm:** Ctrl+Shift+R
2. **Go to Sales Reconciliation**
3. **Should see:**
   - ✅ Sales data loads (no crash)
   - ✅ Karl Brown shows "Deceased" status
   - ✅ Jill Bernhardt shows "Deceased" status
   - ✅ No "column bob.is_termed does not exist" error

---

## 📊 **WHAT MIGRATION DOES**

**Before:**
```sql
book_of_business:
  - status (text) ← only this existed
```

**After:**
```sql
book_of_business:
  - status (text)
  - is_termed (boolean) ← NEW
  - deceased_date (date) ← NEW
```

**Impact:**
- ✅ Sales Recon can check `bob.is_termed`
- ✅ Code can check `bob.deceased_date`
- ✅ Deceased/Termed clients show correct status

---

## ⚠️ **IF MIGRATION FAILS**

**Error: "column already exists"**
- ✅ Good! Means columns are there
- Migration is idempotent (`ADD COLUMN IF NOT EXISTS`)
- Safe to run multiple times

**Error: "relation book_of_business does not exist"**
- ❌ BOB table missing
- Run database init first: `initSchema()` should create it

**Error: "permission denied"**
- ❌ DATABASE_URL user doesn't have ALTER TABLE permission
- Use Railway dashboard method instead (has admin access)

---

## 🚀 **QUICK STEPS**

1. **Railway** → **PostgreSQL** → **Data/Query tab**
2. **Copy SQL** from Option A above
3. **Paste** and **Run**
4. **Wait** 2 seconds (should be instant)
5. **Refresh OliComm** → Sales Recon works

**Total time: 2 minutes**

---

## 📋 **MIGRATION FILE**

**Already created:** `migrations/008_add_bob_status_columns.sql`

**Committed to Git:** Available in repo

**Safe to run:** Uses `IF NOT EXISTS` - won't break if columns already exist

---

**Run the migration NOW in Railway dashboard, then test Sales Reconciliation!**
