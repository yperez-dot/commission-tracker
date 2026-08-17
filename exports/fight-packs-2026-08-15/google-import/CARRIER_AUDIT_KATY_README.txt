Katy audit export — carrier fights (113 rows)

File: CARRIER_AUDIT_KATY.csv

First 5 columns (required for audit):
  Policy_number
  Effective_date
  Member_name
  Agent_name
  Agent_writing_number  (NPN from BSI stmt / Hector production)

Regenerate after OliComm uploads:
  node scripts/enrich-carrier-fight-audit-for-katy.js
  node scripts/export-carrier-google-sheet.js

Google Sheet import (Reason, Carrier, Client, Policy #, …):
  CARRIER_SHEET_IMPORT.csv — same folder

Includes original 111 + Ibarra ($80) + Milagros ($240).

Known gaps (7 rows): missing NPN for agents not in Hector/BSI feeds yet
  (Noris Arcaya Martinez, KHUU LONG, MCCALLA NICHOLAS, CLAWSON FRANK).
Known gaps (2 rows): Devoted missing pays with no policy in OliComm yet
  (Ana Betancourt de Patino, Carol Anderson) — use Hector MBI when available.
