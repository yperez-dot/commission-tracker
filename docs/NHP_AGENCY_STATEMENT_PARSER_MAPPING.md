# NHP Agency Statement Parser - Mapping Plan (REVISED)

**Parser:** `parseNHPAgencyStatementPDF()`  
**Detection:** Filename contains `Agency-Statement-The_Health_Experts_Insurance` OR PDF text contains "Agency Commission Statement" + "The Health Experts Insurance"  
**Statement:** Oscar Health ACA agency overrides via NHP (June 15, 2026 statement)

---

## 1. Raw Data Structure (First 5 Rows)

**Section Header:** `Oscar · ACA`  
**Agent Header:** `Eduardo Pernia · NPN 17676534`

```
| Policy #       | Commission Date | Name / Description | State | Lives | Type    | Commission | Override | Bonus   | Charge Back | Total |
| -------------- | --------------- | ------------------ | ----- | ----- | ------- | ---------- | -------- | ------- | ----------- | ----- |
| OSC75522291-01 | May 1, 2026     | Michelle Day       | FL    | 2     | (empty) | $7.00      | (empty)  | (empty) | (empty)     | $7.00 |
```

**Next Agent:** `Giselle Lopez · NPN 18108127`

```
| Policy #       | Commission Date | Name / Description   | State | Lives | Type    | Commission | Override | Bonus   | Charge Back | Total  |
| -------------- | --------------- | -------------------- | ----- | ----- | ------- | ---------- | -------- | ------- | ----------- | ------ |
| OSC75339595-01 | May 1, 2026     | Saundra Redeemer     | FL    | 2     | (empty) | $7.00      | (empty)  | (empty) | (empty)     | $7.00  |
| OSC76960456-01 | May 1, 2026     | Edgire Charles       | FL    | 2     | (empty) | $7.00      | (empty)  | (empty) | (empty)     | $7.00  |
| OSC78708509-01 | May 1, 2026     | Morgia Kerr-Lewis    | FL    | 1     | (empty) | $3.50      | (empty)  | (empty) | (empty)     | $3.50  |
| OSC75512956-01 | May 1, 2026     | Shantoria Gray       | FL    | 3     | (empty) | $10.50     | (empty)  | (empty) | (empty)     | $10.50 |
```

**Pattern:**
- Commission = Lives × $3.50 (ACA rate)
- Total always matches Commission (no overrides/bonuses/chargebacks in this statement)
- Multiple months present (May primary, some Apr/Mar/Feb)

---

## 2. Complete Column Mapping

| **PDF Column**                  | **OliComm Field**      | **Example Value**        | **Transform**           | **Notes**                          |
| ------------------------------- | ---------------------- | ------------------------ | ----------------------- | ---------------------------------- |
| Policy #                        | policy_number          | OSC75522291-01           | Direct                  | Unique identifier                  |
| Commission Date                 | payment_period         | May 1, 2026 → 202605     | Parse date → YYYYMM     | Coverage month                     |
| —                               | effective_date         | —                        | NULL                    | Not available in statement         |
| Name / Description              | client_full_name       | Michelle Day             | Direct                  | Member name                        |
| State                           | state                  | FL                       | Direct                  | Always FL for THEI                 |
| Lives                           | members                | 2                        | Direct → integer        | Store as members count             |
| Commission                      | amount                 | $7.00 → 7.00             | Strip $ → float         | Override amount paid to THEI       |
| Total                           | (verification)         | $7.00                    | —                       | Should match Commission column     |
| **From Section Header:**        |                        |                          |                         |                                    |
| "Oscar · ACA"                   | carrier                | —                        | Extract                 | "Oscar Health"                     |
| "Oscar · ACA"                   | lob                    | —                        | Extract                 | "ACA"                              |
| **From Agent Header:**          |                        |                          |                         |                                    |
| "Eduardo Pernia · NPN 17676534" | agent_name             | —                        | Extract                 | Agent who wrote the policy         |
| "Eduardo Pernia · NPN 17676534" | writing_agent_npn      | —                        | Extract                 | "17676534"                         |
| **Context/Metadata:**           |                        |                          |                         |                                    |
| —                               | record_type            | —                        | Set                     | "Agency Override"                  |
| —                               | payee                  | —                        | Set                     | "NHP"                              |
| —                               | commission_type        | —                        | Set                     | "Renewal" (all ACA records)        |
| —                               | plan_name              | —                        | Leave blank             | Not provided in ACA statements     |
| —                               | payment_type           | —                        | Leave blank             | Column exists but empty            |
| **Upload metadata**             | batch                  | —                        | Auto-generate           | YYYY-MM from upload date           |
| **Upload metadata**             | source_file            | —                        | From upload             | Original filename                  |
| **Upload metadata**             | upload_date            | —                        | Timestamp               | Upload timestamp                   |

**Classification Logic (ACA):**
- **All records → "Renewal"** (ACA monthly payments are recurring by nature)

---

## 3. Expected Output

**Records:** ~200-300 commission records (14-page PDF, estimate based on $1,162 ÷ $3.50-$7.00 avg)  
**Total Amount:** $1,162.00  
**Carrier:** Oscar Health  
**LOB:** ACA  
**Primary Period:** May 2026 (202605)  
**Secondary Periods:** Apr 2026 (202604), Mar 2026 (202603), Feb 2026 (202602) _(catch-up payments)_  
**Agents:** Eduardo Pernia, Giselle Lopez _(+ potentially more in later pages)_  
**Record Type:** Agency Override (NHP → THEI)

**Sample Output Record:**
```javascript
{
  policy_number: 'OSC75522291-01',
  client_full_name: 'Michelle Day',
  payment_period: '202605',
  effective_date: null,
  carrier: 'Oscar Health',
  lob: 'ACA',
  state: 'FL',
  members: 2,
  amount: 7.00,
  agent_name: 'Eduardo Pernia',
  writing_agent_npn: '17676534',
  commission_type: 'Renewal',
  record_type: 'Agency Override',
  payee: 'NHP',
  batch: '2026-06',
  source_file: 'Agency-Statement-The_Health_Experts_Insurance-June_15_2026.pdf',
  upload_date: '2026-06-19T17:33:00Z'
}
```

---

## 4. Critical Parser Logic

### Section Detection
```javascript
// Detect carrier section
if (line.includes('Oscar · ACA')) {
  currentCarrier = 'Oscar';
  currentLOB = 'ACA';
}
```

### Agent Block Detection
```javascript
// Agent header format: "Eduardo Pernia · NPN 17676534"
const agentMatch = line.match(/^(.+?)\s*·\s*NPN\s+(\d+)$/);
if (agentMatch) {
  currentAgent = agentMatch[1].trim();
  currentNPN = agentMatch[2].trim();
}
```

### Row Parsing
```javascript
// Table row: | OSC75522291-01 | May 1, 2026 | Michelle Day | FL | 2 | (empty) | $7.00 | ...
const rowMatch = line.match(/^\|\s*([A-Z0-9-]+)\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*[A-Z]{2}\s*\|\s*(\d+)\s*\|.*?\|\s*\$?([\d,]+\.\d{2})/);

if (rowMatch) {
  const [_, policy, commDate, client, lives, commission] = rowMatch;
  
  records.push({
    CARRIER: currentCarrier,
    AGENT: currentAgent,
    NPN: currentNPN,
    POLICY: policy.trim(),
    CLIENT: client.trim(),
    EFFECTIVE: parseDate(commDate),  // "May 1, 2026" → "2026-05-01"
    LOB: currentLOB,  // "ACA"
    CLASSIFICATION: 'Renewal',
    AMOUNT: parseFloat(commission.replace(/,/g, '')),
    UPLOAD_TYPE: 'commission_statement',
    SOURCE: 'nhp_agency_statement'
  });
}
```

### Date Parsing
```javascript
function parseDate(dateStr) {
  // "May 1, 2026" → "2026-05-01"
  const parsed = new Date(dateStr);
  return parsed.toISOString().split('T')[0];
}
```

---

## 5. Validation Rules

1. **Lives × $3.50 = Commission**  
   Validate: `parseFloat(commission) === parseInt(lives) * 3.50`

2. **Total = Commission**  
   (Override/Bonus/Chargeback all empty in this statement)

3. **Policy Format**  
   Must match: `^OSC\d{8}-\d{2}$`

4. **Agent Required**  
   Every row must have current agent context from header

5. **Date Format**  
   Commission Date must parse to valid ISO date

---

## 6. Multi-Agent Handling

**Statement Structure:**
```
Oscar · ACA
  Eduardo Pernia · NPN 17676534
    [1 row]
  Giselle Lopez · NPN 18108127
    [4 rows]
  Ivan Santiago · NPN 17670043
    [2 rows]
  ...
```

**Parser State:**
- Maintain `currentAgent` and `currentNPN`
- Update on each agent header
- Apply to all subsequent rows until next agent header
- Each row gets the current agent context

---

## 7. Edge Cases

1. **Empty Type Column**  
   → Map to LOB from section header (ACA)

2. **Multiple Commission Dates**  
   → Each row has its own date, parse individually

3. **Hyphenated Names**  
   → Preserve as-is: "Morgia Kerr-Lewis"

4. **Multi-Carrier Statements**  
   → Reset carrier/LOB on each section header  
   → (This statement only has Oscar, but parser should support multiple)

---

## 8. Testing Checklist

- [ ] Detects NHP agency statement by filename
- [ ] Detects NHP agency statement by PDF text content
- [ ] Parses carrier section header (Oscar · ACA)
- [ ] Parses agent headers (name + NPN)
- [ ] Extracts all 7 rows correctly
- [ ] Maps empty Type → ACA
- [ ] Parses "May 1, 2026" dates correctly
- [ ] Validates Lives × $3.50 = Commission
- [ ] Assigns correct agent to each row
- [ ] Handles multiple agents in one statement

---

## 9. Changes from v1

1. ✅ `effective_date` → NULL (not available)
2. ✅ `commission_type` → Always "Renewal" (no DB lookup)
3. ✅ `members` → Store Lives column value
4. ✅ `agent_name` → Correct OliComm field name

**Status:** ✅ Ready for implementation

---

## 10. Implementation Status

- [ ] Parser function created
- [ ] Detection logic added to route handler
- [ ] Unit tests written
- [ ] Integration test with sample PDF
- [ ] Deployed to Railway staging
- [ ] Validated against production upload

---

**Last Updated:** June 19, 2026  
**Author:** Igor (AI Agent)  
**Related:** OliComm Commission Reconciliation System
