# How to Run fix_agency_production_status.sql

Railway CLI requires authentication. Here are 3 ways to run the SQL normalization script:

---

## Option 1: Railway Dashboard (Easiest)

1. Go to: https://railway.app
2. Open your commission-tracker project
3. Click on the **PostgreSQL** service
4. Click **"Data"** tab (or **"Query"**)
5. Copy/paste the contents of `fix_agency_production_status.sql`
6. Click **"Run"** or press Ctrl+Enter

---

## Option 2: Railway CLI (Local)

```bash
# First, login to Railway (one-time)
railway login

# Then run the SQL script
cd commission-tracker
railway run psql $DATABASE_URL -f fix_agency_production_status.sql
```

---

## Option 3: Direct psql Connection

1. Get your database URL from Railway dashboard:
   - Open PostgreSQL service → **Variables** tab
   - Copy `DATABASE_URL` value

2. Run psql locally:
```bash
psql "postgresql://postgres:PASSWORD@HOST:PORT/railway" -f fix_agency_production_status.sql
```

---

## Expected Output

```
UPDATE 150  -- Paid records normalized
UPDATE 85   -- Cancelled records normalized
UPDATE 1    -- Plan Change records normalized
UPDATE 15   -- Missing records normalized

 status      | count
-------------+-------
 Missing     | 15
 Plan Change | 1
 Cancelled   | 85
 Paid        | 198
```

**Total affected:** ~251 records (varies based on your data)

---

## What This Does

Normalizes all `agency_production.status` values to exactly 4 types:

- **Paid** ← completed, active policy, enrolled, accepted, in progress, etc.
- **Cancelled** ← cancelled application, denied, disenrolled, terminated, etc.
- **Plan Change** ← plan_change, plan change
- **Missing** ← —, empty, NULL, missing override, etc.

**Important:** This is safe to run multiple times (idempotent). Already-normalized records won't change.

---

## Verify Results

After running, check the Agency Override Recon page:
- Tabs should show correct counts
- Status badges should use 4 colors: green, purple, red, gray
- No "weird" status values should appear
