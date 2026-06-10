# Database Check - What's Actually Stored

Run this SQL query on Railway to see what data was saved:

```sql
SELECT 
  agent_name,
  client_full_name,
  policy_number,
  lob,
  classification,
  producer_payable,
  commission,
  statement_month,
  members,
  effective_date,
  payment_period,
  created_at
FROM commission_records
WHERE payment_period = '202606'
  AND lob = 'ACA'
ORDER BY agent_name, client_full_name
LIMIT 20;
```

## Expected for Patsy (4 records):
- `producer_payable`: 27, 54, 27, 54 ✅
- `commission`: 0 or NULL (THEI doesn't get it)
- `statement_month`: "Cigna - April 2026" ✅
- `members`: 1, 2, 1, 2 ✅
- `effective_date`: NOT NULL ✅

## If ALL fields are wrong:
→ **Parser changes didn't deploy to Railway** OR **old cached code still running**

## If producer_payable = 0:
→ **NHP parser ACA logic broken** - not assigning values correctly

---

# Also Check: Are Columns Even Created?

```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'commission_records'
  AND column_name IN ('producer_payable', 'statement_month', 'members')
ORDER BY column_name;
```

Expected:
- `producer_payable` | numeric | YES
- `statement_month` | text | YES  
- `members` | integer | YES

If missing → columns weren't created

---

# Next: Email this to yourself or check Railway logs directly
