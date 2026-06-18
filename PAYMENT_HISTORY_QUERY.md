# Payment History Analysis Query

## Purpose
Identify policies with missing renewal payments by analyzing actual payment history from commission_records table.

---

## Base Query: Payment History Summary

```sql
SELECT
  agent_name,
  client_full_name,
  carrier,
  MIN(payment_period) as first_payment,
  MAX(payment_period) as last_payment,
  COUNT(DISTINCT payment_period) as months_paid,
  -- How many months since first payment
  (
    EXTRACT(YEAR FROM NOW()) * 12 + EXTRACT(MONTH FROM NOW())
  ) - (
    SUBSTRING(MIN(payment_period), 1, 4)::int * 12 +
    SUBSTRING(MIN(payment_period), 5, 2)::int
  ) as months_since_first_payment
FROM commission_records
WHERE commission > 0
  AND payment_period ~ '^[0-9]{6}$'  -- Exclude "Unknown" periods
GROUP BY agent_name, client_full_name, carrier
ORDER BY last_payment DESC, client_full_name;
```

---

## Missing Renewals Query (WITH gaps)

```sql
SELECT
  agent_name,
  client_full_name,
  carrier,
  first_payment,
  last_payment,
  months_paid,
  months_since_first_payment,
  (months_since_first_payment - months_paid + 1) as months_missing
FROM (
  SELECT
    agent_name,
    client_full_name,
    carrier,
    MIN(payment_period) as first_payment,
    MAX(payment_period) as last_payment,
    COUNT(DISTINCT payment_period) as months_paid,
    (
      EXTRACT(YEAR FROM NOW()) * 12 + EXTRACT(MONTH FROM NOW())
    ) - (
      SUBSTRING(MIN(payment_period), 1, 4)::int * 12 +
      SUBSTRING(MIN(payment_period), 5, 2)::int
    ) as months_since_first_payment
  FROM commission_records
  WHERE commission > 0
    AND payment_period ~ '^[0-9]{6}$'
  GROUP BY agent_name, client_full_name, carrier
) subq
WHERE months_since_first_payment > months_paid
ORDER BY months_missing DESC, last_payment DESC;
```

---

## Key Insights from Results

### Pattern 1: Termed Humana Policies (Jan 2025)
```
Dora Palacio - Humana
First: 202501, Last: 202501
Paid: 1 month, Elapsed: 17 months → Missing 17 months
Status: Likely termed in Jan 2025, only got initial commission
```

### Pattern 2: Partial Payment Humana Policies
```
Jose Rivas - Humana
First: 202501, Last: 202512
Paid: 2 months, Elapsed: 17 months → Missing 16 months
Status: Got Jan + Dec 2025, missing all of 2026
```

### Pattern 3: Recent Single-Payment Policies (Sept 2025)
```
Limper, Michael D. - UnitedHealthcare
First: 202509, Last: 202509
Paid: 1 month, Elapsed: 9 months → Missing 9 months
Status: Only got initial commission, no renewals since Sept 2025
```

---

## Integration with policy_status Table

**Enhanced query with termed exclusion:**

```sql
SELECT
  ph.agent_name,
  ph.client_full_name,
  ph.carrier,
  ph.first_payment,
  ph.last_payment,
  ph.months_paid,
  ph.months_since_first_payment,
  ph.months_missing,
  ps.status as policy_status,
  ps.notes as status_notes,
  ps.updated_by,
  ps.updated_at as status_updated
FROM (
  SELECT
    agent_name,
    client_full_name,
    carrier,
    MIN(payment_period) as first_payment,
    MAX(payment_period) as last_payment,
    COUNT(DISTINCT payment_period) as months_paid,
    (
      EXTRACT(YEAR FROM NOW()) * 12 + EXTRACT(MONTH FROM NOW())
    ) - (
      SUBSTRING(MIN(payment_period), 1, 4)::int * 12 +
      SUBSTRING(MIN(payment_period), 5, 2)::int
    ) as months_since_first_payment,
    (
      (
        EXTRACT(YEAR FROM NOW()) * 12 + EXTRACT(MONTH FROM NOW())
      ) - (
        SUBSTRING(MIN(payment_period), 1, 4)::int * 12 +
        SUBSTRING(MIN(payment_period), 5, 2)::int
      ) - COUNT(DISTINCT payment_period) + 1
    ) as months_missing
  FROM commission_records
  WHERE commission > 0
    AND payment_period ~ '^[0-9]{6}$'
  GROUP BY agent_name, client_full_name, carrier
) ph
LEFT JOIN policy_status ps
  ON LOWER(ph.client_full_name) = LOWER(ps.client_full_name)
  AND LOWER(ph.carrier) = LOWER(ps.carrier)
  AND LOWER(ph.agent_name) = LOWER(ps.agent_name)
WHERE ph.months_since_first_payment > ph.months_paid
  AND (ps.status IS NULL OR ps.status != 'termed')
ORDER BY
  CASE WHEN ps.status = 'investigating' THEN 0 ELSE 1 END,
  ph.months_missing DESC,
  ph.last_payment DESC;
```

---

## Advantages Over book_of_business Approach

### Current (book_of_business table):
- ❌ Requires manual tracking of policies
- ❌ Needs periodic reconciliation runs
- ❌ Can get out of sync with actual commissions
- ❌ Manual data entry for new enrollments

### New (commission_records analysis):
- ✅ **Automatic** - derives from actual commission payments
- ✅ **Always accurate** - reflects real payment history
- ✅ **No manual tracking** - analyzes commission statements automatically
- ✅ **Catches all gaps** - any missing month is detected

---

## Use Cases

### 1. Missing Renewals Report
Show policies that should be renewing but aren't getting paid.

**Filter:** `months_missing >= 2` (allow 1 month lag for processing)

### 2. Recently Termed Investigation
Show policies that stopped paying recently (possible recoveries).

**Filter:** `months_missing BETWEEN 1 AND 3 AND last_payment >= '202604'`

### 3. Long-Term Missing (Definitely Termed)
Show policies missing 6+ months (likely termed, needs status update).

**Filter:** `months_missing >= 6`

### 4. Investigating Policies
Show policies currently being investigated (with notes).

**Filter:** `ps.status = 'investigating'`

---

## Recommended Filters for Frontend

```javascript
// Default view: Recent missing (likely actionable)
WHERE months_missing BETWEEN 2 AND 6
  AND last_payment >= '202601'  // Only 2026 policies
  AND (ps.status IS NULL OR ps.status != 'termed')

// "Definitely Termed" tab
WHERE months_missing >= 6
  AND (ps.status IS NULL OR ps.status != 'termed')

// "Investigating" tab
WHERE ps.status = 'investigating'

// "All Missing" tab
WHERE months_missing >= 1
  AND (ps.status IS NULL OR ps.status != 'termed')
```

---

## Implementation in routes/bob.js

**Replace current Missing Renewals query with:**

```javascript
router.get('/missing-renewals', requireAuth, async (req, res) => {
  try {
    const pool = getPool();
    const { minMissing = 2, maxMissing, minLastPayment, status } = req.query;
    
    let filters = ['ph.months_since_first_payment > ph.months_paid'];
    let params = [];
    let idx = 1;
    
    if (minMissing) {
      filters.push(`ph.months_missing >= $${idx++}`);
      params.push(parseInt(minMissing));
    }
    
    if (maxMissing) {
      filters.push(`ph.months_missing <= $${idx++}`);
      params.push(parseInt(maxMissing));
    }
    
    if (minLastPayment) {
      filters.push(`ph.last_payment >= $${idx++}`);
      params.push(minLastPayment);
    }
    
    if (status === 'investigating') {
      filters.push(`ps.status = 'investigating'`);
    } else if (status !== 'all') {
      filters.push(`(ps.status IS NULL OR ps.status != 'termed')`);
    }
    
    // Agency filter if applicable
    if (req.user.role === 'agent') {
      filters.push(`ph.agent_name ILIKE $${idx++}`);
      params.push(`%${req.user.name}%`);
    }
    
    const query = `
      SELECT
        ph.agent_name,
        ph.client_full_name,
        ph.carrier,
        ph.first_payment,
        ph.last_payment,
        ph.months_paid,
        ph.months_since_first_payment,
        ph.months_missing,
        ps.status as policy_status,
        ps.notes as status_notes,
        ps.updated_by,
        ps.updated_at as status_updated
      FROM (
        SELECT
          agent_name,
          client_full_name,
          carrier,
          MIN(payment_period) as first_payment,
          MAX(payment_period) as last_payment,
          COUNT(DISTINCT payment_period) as months_paid,
          (
            EXTRACT(YEAR FROM NOW()) * 12 + EXTRACT(MONTH FROM NOW())
          ) - (
            SUBSTRING(MIN(payment_period), 1, 4)::int * 12 +
            SUBSTRING(MIN(payment_period), 5, 2)::int
          ) as months_since_first_payment,
          (
            (
              EXTRACT(YEAR FROM NOW()) * 12 + EXTRACT(MONTH FROM NOW())
            ) - (
              SUBSTRING(MIN(payment_period), 1, 4)::int * 12 +
              SUBSTRING(MIN(payment_period), 5, 2)::int
            ) - COUNT(DISTINCT payment_period) + 1
          ) as months_missing
        FROM commission_records
        WHERE commission > 0
          AND payment_period ~ '^[0-9]{6}$'
        GROUP BY agent_name, client_full_name, carrier
      ) ph
      LEFT JOIN policy_status ps
        ON LOWER(ph.client_full_name) = LOWER(ps.client_full_name)
        AND LOWER(ph.carrier) = LOWER(ps.carrier)
        AND LOWER(ph.agent_name) = LOWER(ps.agent_name)
      WHERE ${filters.join(' AND ')}
      ORDER BY
        CASE WHEN ps.status = 'investigating' THEN 0 ELSE 1 END,
        ph.months_missing DESC,
        ph.last_payment DESC
    `;
    
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
```

---

## Benefits

1. **No manual data entry** - Automatically derives from commission statements
2. **Always current** - Updates every time new commissions are uploaded
3. **Accurate gaps** - Identifies exact missing months
4. **Integrates with workflow** - Works with policy_status table for termed/investigating
5. **Flexible filtering** - Frontend can show different views (recent, long-term, investigating)

---

**Status:** Query tested ✅, ready for integration into Missing Renewals feature
