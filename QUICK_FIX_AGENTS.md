# Quick Agent Name Fix

Since we can't access the correct database via Railway's query interface, here's the SQL that needs to run:

```sql
UPDATE commission_records 
SET agent_name = 'Yahoska Perez' 
WHERE agent_name = 'Yahoska G Perez';

UPDATE commission_records 
SET agent_name = 'Katy Robles' 
WHERE agent_name = 'Katy Jullie Robles';
```

## Yahoska's Real Total
Currently showing as TWO people:
- Yahoska Perez: $8,542.32
- Yahoska G Perez: $7,815.76

**Real total: $16,358.08** (should be #1 on leaderboard!)

## Other possible duplicates to check:
- Look for any other middle initial variations
- Check for case differences (KATY vs Katy)
