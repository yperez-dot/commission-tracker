# Gold Kidney Commission Statement Parser Mapping

## Detection Criteria
- **Sheet names**: ['Summary', 'Detail'] (both must exist)
- **Required columns**: 'Rep Name' + 'Member HIC'
- **File pattern**: Optional `JANUARY_2026`, `FEBRUARY_2026`, etc. in filename

## Column Mapping

| File Column         | OliComm Field      | Example              | Notes                          |
|---------------------|--------------------|--------------------|--------------------------------|
| Rep Name            | agent_name         | Katy Robles         | Normalize                      |
| NPN                 | agent_npn          | 17013263            | Store in raw_data              |
| Member First Name   | client_first       | ALVIN               | Combine with last              |
| Member Last Name    | client_last        | FRANCIS             | → "Alvin Francis"              |
| Member ID           | policy_number      | 80014703            | -                              |
| Member HIC          | member_hic         | 5PG0X91KF18         | Medicare ID (raw_data)         |
| Effective Date      | effective_date     | 01/01/2025          | MM/DD/YYYY                     |
| Payment             | commission         | 28.92               | -                              |
| Plan Group Name     | plan_type          | Gold Health         | -                              |
| Member Year         | -                  | 2                   | For classification logic       |
| Level               | -                  | Agent               | Ignore (use Member Year)       |

## Period Extraction
**From filename:**
- `JANUARY_2026` → `202601`
- `FEBRUARY_2026` → `202602`
- Pattern: `/(JANUARY|FEBRUARY|...)_(\d{4})/i`

**Fallback:** Upload date (YYYYMM)

## Classification Logic
```javascript
if (commission < 0) {
  classification = 'Chargeback';
} else if (memberYear === 1 || memberYear === '1') {
  classification = 'New Business';
} else if (memberYear > 1) {
  classification = 'Renewal';
} else {
  classification = 'Agent Commission';  // fallback
}
```

## Business Rules
- **Carrier**: `Gold Kidney`
- **Payee**: `Gold Kidney`
- **Plan Type**: Use `Plan Group Name` column as-is
- **Source**: `direct_carrier`
- **LOB**: `MA` (Medicare Advantage)

## Expected Output (Sample)
- **Records**: 3
- **Total Commission**: $86.76
- **Carrier**: Gold Kidney
- **Period**: 202601 (from filename `JANUARY_2026`)
- **Classifications**: Based on Member Year column

## Notes
- Sheet names detection prevents false positives
- Member HIC is Medicare beneficiary identifier (store in raw_data)
- Member Year is the key field for classification (1 = new, >1 = renewal)
- Name formatting: Title case (ALVIN FRANCIS → Alvin Francis)

## Sample Data Structure
```javascript
{
  agent: 'Katy Robles',
  carrier: 'Gold Kidney',
  planType: 'Gold Health',
  client: 'Alvin Francis',
  effectiveDate: '01/01/2025',
  commission: 28.92,
  classification: 'Renewal',  // Member Year = 2
  period: '202601',
  policyNumber: '80014703',
  payee: 'Gold Kidney',
  lob: 'MA',
  raw: {
    npn: '17013263',
    memberHIC: '5PG0X91KF18',
    memberYear: 2,
    level: 'Agent'
  }
}
```

---
**Approved**: 2026-06-19  
**Status**: ✅ Ready to build
