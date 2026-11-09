'use strict';

/**
 * Solis / Doctors Healthcare "Commissions Ledger" parser (moved out of routes/files.js
 * unchanged except for classification, so it can be unit-tested with real files).
 * Header row is found by "Member Name"/"MemberName"; the Total Amount row and
 * blank/zero rows are skipped; a policy-less "Negative Charge from Previous Month"
 * carry is kept with the payment type as its client label.
 */

const XLSX = require('xlsx');
const { normalizeAgentName } = require('../routes/normalize');
const { formatDate } = require('./uhcCommissionParse');
const { solisClassification } = require('./solisClassify');

function isValidClientName(clientName) {
  if (!clientName) return false;
  const name = String(clientName).trim();
  if (name === '') return false;
  const lower = name.toLowerCase();
  const artifacts = ['summary', 'deduction', 'total', 'balance', 'subtotal', 'grand total'];
  for (const artifact of artifacts) {
    if (lower.includes(artifact)) return false;
  }
  return true;
}

function isDoctorsFile(filename) {
  const f = filename.toLowerCase().replace(/['\s()]/g, '_');
  return f.includes('doctor') || f.startsWith('drs') || f.startsWith('dr_s') || f.includes('dr_s_katy') || f.includes('dr_s_');
}

function isSolisFile(filename) {
  const f = filename.toLowerCase().replace(/['\s()]/g, '_');
  if (isDoctorsFile(filename)) return false;
  return f.includes('commissions_ledger') || f.includes('solis');
}

function parseSolisRows(wb, filename) {
  const records = [];
  const ws = wb.Sheets[wb.SheetNames[0]];
  const range = XLSX.utils.decode_range(ws['!ref']);

  let headerRow = -1;
  for (let r = range.s.r; r <= Math.min(range.s.r + 10, range.e.r); r++) {
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })];
      const cellValue = String(cell?.v || '').toLowerCase().replace(/\s+/g, '');
      // Match both "Member Name" and "MemberName" formats
      if (cell && cellValue.includes('membername')) {
        headerRow = r;
        break;
      }
    }
    if (headerRow >= 0) break;
  }
  if (headerRow < 0) return records;

  const rows = XLSX.utils.sheet_to_json(ws, { defval: '', raw: true, range: headerRow });

  for (const row of rows) {
    // Handle both Solis (with spaces) and Doctors (no spaces) column formats
    let client = String(row['Member Name'] || row['MemberName'] || '').trim();
    const agent = normalizeAgentName(String(row['Agent Name'] || row['AgentName'] || '').trim());
    const commission = parseFloat(row['Payment Amt'] || row['PaymentAmt']) || 0;
    const commissionEffDate = row['Commission Eff. Date'] || row['CommissionEffectiveDate'];
    const memberEnrollDate = row['Member Enrollment Date'] || row['MemberEnrollmentDate'];
    
    // Both Doctors and Solis use Member Enrollment Date for EFFECTIVE column
    const isDoctor = isDoctorsFile(filename);
    const effectiveDate = formatDate(memberEnrollDate);
    // Normalize payment type: lowercase and collapse multiple spaces
    const paymentType = String(row['Payment Type'] || row['PaymentType'] || '').toLowerCase().replace(/\s+/g, ' ').trim();
    const policyNumber = String(row['Plan Member ID'] || row['PlanMemberID'] || '').trim();

    // Doctors/Solis often include a prior-month negative with blank MemberName.
    // Keep non-zero amounts even when client is blank; do not import zero blank junk.
    const paymentTypeRaw = String(row['Payment Type'] || row['PaymentType'] || '').trim();
    const isPriorMonthNegative = /negative|previous\s*month|prior\s*month|carry\s*over|carryover/i.test(paymentTypeRaw)
      || (commission < 0 && !client);
    if (commission === 0) continue;
    if (!isValidClientName(client)) {
      if (!isPriorMonthNegative) continue;
      client = paymentTypeRaw
        ? paymentTypeRaw.replace(/\s+/g, ' ').trim().slice(0, 120)
        : 'PRIOR MONTH NEGATIVE CHARGE';
      // isValidClientName rejects names containing "balance"/"total"/etc — strip those words
      client = client.replace(/\b(balance|total|summary|subtotal|deduction)\b/ig, 'CHARGE').trim()
        || 'PRIOR MONTH NEGATIVE CHARGE';
    }

    // Determine if New Business vs Renewal by comparing enrollment date to commission date
    let isNewBusiness = false;
    if (memberEnrollDate && commissionEffDate) {
      // Helper to convert any date format to Date object
      const parseAnyDate = (val) => {
        if (typeof val === 'number') {
          // Excel serial number
          return new Date(Date.UTC(1899, 11, 30) + val * 86400000);
        }
        const str = String(val);
        if (str.length === 8 && /^\d{8}$/.test(str)) {
          // YYYYMMDD format (Doctors)
          const y = parseInt(str.substring(0, 4));
          const m = parseInt(str.substring(4, 6));
          const d = parseInt(str.substring(6, 8));
          return new Date(Date.UTC(y, m - 1, d));
        }
        // Standard date string
        return new Date(val);
      };
      
      const enrollDate = parseAnyDate(memberEnrollDate);
      const commDate = parseAnyDate(commissionEffDate);
      
      if (!isNaN(enrollDate.getTime()) && !isNaN(commDate.getTime())) {
        const enrollYM = enrollDate.getUTCFullYear() * 100 + (enrollDate.getUTCMonth() + 1);
        const commYM = commDate.getUTCFullYear() * 100 + (commDate.getUTCMonth() + 1);
        isNewBusiness = (enrollYM === commYM);
      }
    }

    // Solis/Doctors payment type mapping
    // Use enrollment vs commission date comparison to determine New Business vs Renewal
    // Explicit Payment Type wins over the enrollment-month heuristic (src/solisClassify.js).
    // Prior-month negative carry → Carryover (not Chargeback) — see solisCarryover.js.
    const classification = solisClassification(paymentType, commission, isNewBusiness, {
      isPriorMonthNegative,
      paymentTypeRaw,
    });

    let period = '';
    if (commissionEffDate) {
      let d;
      // Handle Excel serial date numbers (e.g., 46143 = days since 1900)
      if (typeof commissionEffDate === 'number') {
        // Convert Excel serial to JS Date (Excel epoch is Dec 30, 1899)
        d = new Date(Date.UTC(1899, 11, 30) + commissionEffDate * 86400000);
      } else {
        d = new Date(commissionEffDate);
      }
      if (!isNaN(d.getTime())) {
        period = String(d.getUTCFullYear()) + String(d.getUTCMonth() + 1).padStart(2, '0');
      }
    }

    const carrierName = isDoctor ? 'Doctors' : 'Solis';
    const planTypeName = isDoctor ? 'Doctors Med Adv' : 'Solis Med Adv';
    records.push({
      agent: agent || 'The Health Experts Insurance',
      carrier: carrierName,
      planType: planTypeName,
      client,
      effectiveDate,
      premium: 0,
      commission,
      classification,
      period,
      policyNumber,
      payee: isDoctor ? 'Doctors' : 'Solis',
      raw: row
    });
  }
  return records;
}

module.exports = { parseSolisRows, isDoctorsFile, isSolisFile };
