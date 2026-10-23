# Payroll close — how it works

THEI runs agent payroll itself. These are the rules the code follows.

## Month lock
- **Mark paid** on Agent Payouts opens a payment form (method check / ACH / Zelle / other, reference #, pay date,
  amount — defaults to the amount payable). Saving records a `payroll_payments` row, sets the paid check mark and
  **locks** that payee + month.
- **Close month** (Month Close page) locks every payee on the page for that month (Lina, Munoz and Mendieta always).
- A locked month is frozen: payout amount, carry-forward and the issued statement all come from the stored snapshot
  (`payroll_locks`). The statement download for a locked month returns the frozen file. Re-issuing is refused.
- Carry-forward into later months uses the locked month's frozen ending balance.
- If the rows under a locked month change later (re-upload, delete, late rows) nothing locked changes. The open month
  shows a **suggested prior-period correction** (live − locked − corrections already posted). One click posts it as an
  adjustment line in the open month.
- **Unlock** (admin + reason) clears the paid mark and voids its payment record. **Reopen month** (admin + reason)
  unlocks only the close-made locks; paid months stay locked.

## Adjustment lines
- Per payee + month: amount (+/−), category (clawback not yet on file / correction / advance / prior-period correction
  / other), reason (required), entered by, time.
- Count in payout totals and carry-forward; print in an ADJUSTMENTS section on Lina's and the Integrity statements,
  negatives in red.
- Locked or closed months can't take new lines. Voiding a line needs admin + reason.

## Close checklist
- Expected carriers: UnitedHealthcare, Humana, Devoted, Aetna, Freedom, plus any carrier seen on a BSI statement upload
  in the 3 months before.
- Flags: missing carrier (blocks closing unless marked "none this month" with a reason), $0 total with records, and
  file name / title naming a different carrier than the rows were stored under. Flags other than "missing" and
  deposit differences are warnings, not blockers.

## Deposit reconciliation (THEI bank)
- Deposits: date, payer (pick list + Other), amount, reference, memo, months covered (split allowed), entered by.
  Edit / delete need a reason and are logged. `source` / `external_id` columns are there for a future QuickBooks import.
- Expected per payer per month:
  - **BSI**: all BSI statement uploads for the month, `SUM(commission − bsi_share)` = THEI's share plus the producer
    pay THEI passes through. Licensing/appointment fees aren't stored as rows, so a fee netted out of BSI's wire shows
    up as a difference.
  - **Direct carriers** (commission statement uploads): `SUM(commission)` for that carrier.
- Received = deposits assigned to that payer + month. Unassigned money is listed as unmatched.

## Change log
`change_log` records upload created / deleted / renamed, record edits / reverts / deletes, and every payroll action
(lock, unlock, adjustment, void, payment, close, reopen, "none this month", statements issued/voided, deposits).
Payroll → Change Log filters by user, type and period.

## Roles
- Payroll staff (admin, or a role in `PAYROLL_STAFF_ROLES`, default `admin,staff,payroll,manager`, or an email in
  `PAYROLL_STAFF_EMAILS`): adjustments, mark paid, checklist, close month, deposits, change log.
- Unlock / void adjustment / reopen: role `admin`; if `PAYROLL_UNLOCK_EMAILS` is set, only those admins.

## Tables
All self-create on first use (no manual SQL on Railway). `migrations/014_payroll_close.sql` has the same DDL for
reference.
