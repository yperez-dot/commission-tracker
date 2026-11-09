'use strict';

/**
 * HealthSpring Medicare Advantage / PDP agency workbook
 * (sheets: Summary, Detail, Legacy; title often typo'd "HealthSping").
 *
 * Distinct from:
 * - HealthSpring Supplemental Benefits PDFs
 * - AgentView CNHIC Med Supp PDFs
 * - Devoted Summary+Detail xls (different Detail columns)
 */

const XLSX = require('xlsx');
const { normalizeAgentName } = require('../routes/normalize');

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function formatDate(value) {
  if (!value && value !== 0) return '';
  if (value instanceof Date && !isNaN(value)) {
    const mo = String(value.getUTCMonth() + 1).padStart(2, '0');
    const d = String(value.getUTCDate()).padStart(2, '0');
    return `${mo}/${d}/${value.getUTCFullYear()}`;
  }
  if (typeof value === 'number' && value > 20000 && value < 80000) {
    const d = new Date(Math.round((value - 25569) * 86400 * 1000));
    return `${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCDate()).padStart(2, '0')}/${d.getUTCFullYear()}`;
  }
  if (typeof value === 'string') {
    const t = value.trim();
    if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(t)) {
      const m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      return `${m[1].padStart(2, '0')}/${m[2].padStart(2, '0')}/${m[3]}`;
    }
    if (/^\d{4}-\d{2}-\d{2}/.test(t)) {
      const [y, mo, d] = t.split('-');
      return `${mo}/${String(d).slice(0, 2)}/${y}`;
    }
    return t;
  }
  return String(value);
}

function periodFromPayPeriod(payPeriod) {
  if (payPeriod instanceof Date && !isNaN(payPeriod)) {
    return `${payPeriod.getUTCFullYear()}${String(payPeriod.getUTCMonth() + 1).padStart(2, '0')}`;
  }
  if (typeof payPeriod === 'number' && payPeriod > 40000) {
    const d = new Date(Math.round((payPeriod - 25569) * 86400 * 1000));
    return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  }
  return '';
}

function summaryTitle(wb) {
  if (!wb || !wb.SheetNames) return '';
  const summaryName = wb.SheetNames.find((s) => String(s).toLowerCase() === 'summary');
  if (!summaryName) return '';
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[summaryName], { header: 1, defval: '' });
  return String((rows[0] && rows[0][0]) || '');
}

function detailHeaders(wb) {
  if (!wb || !wb.SheetNames) return [];
  const detailName = wb.SheetNames.find((s) => String(s).toLowerCase() === 'detail');
  if (!detailName) return [];
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[detailName], { header: 1, defval: '' });
  return (rows[0] || []).map((h) => String(h || '').trim());
}

function isHealthSpringMedicareFilename(filename) {
  const f = String(filename || '').toLowerCase().replace(/[\s().]/g, '_');
  return f.includes('healthspring') || f.includes('healthspting') || f.includes('health_spring');
}

/**
 * Content detection: Summary + Detail sheets, HealthSpring title and/or Detail headers.
 * Filename is irrelevant once content matches (so THEI.HEALTHSPRING.MEDICARE.… works).
 */
function isHealthSpringMedicareWorkbook(wb) {
  if (!wb || !wb.SheetNames) return false;
  const names = wb.SheetNames.map((s) => String(s).toLowerCase());
  if (!names.includes('summary') || !names.includes('detail')) return false;

  const title = summaryTitle(wb).toLowerCase();
  const titleHit = title.includes('healthsping') || title.includes('healthspring');

  const headers = detailHeaders(wb).map((h) => h.toLowerCase());
  const headerSet = new Set(headers);
  const headerHit =
    headerSet.has('payment type') &&
    headerSet.has('payment description') &&
    headerSet.has('writing broker name') &&
    headerSet.has('payment amount') &&
    headerSet.has('member name');

  return titleHit || headerHit;
}

function readSummaryMoney(wb) {
  const summaryName = wb.SheetNames.find((s) => String(s).toLowerCase() === 'summary');
  if (!summaryName) return { balance: null, statementTotal: null, renewalTotal: null };
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[summaryName], { header: 1, defval: '', raw: true });
  let balance = null;
  let statementTotal = null;
  let renewalTotal = null;
  for (const row of rows) {
    const label = String(row[0] || '').trim().toLowerCase();
    const val = row[2];
    const num = typeof val === 'number' ? val : parseFloat(String(val).replace(/[$,]/g, ''));
    if (Number.isNaN(num)) continue;
    if (label === 'balance') balance = round2(num);
    else if (label === 'total') statementTotal = round2(num);
    else if (label === 'renewal') renewalTotal = round2(num);
  }
  return { balance, statementTotal, renewalTotal };
}

function classifyHealthSpringRow(paymentType, paymentDesc, commission) {
  if (commission < 0 || String(paymentType || '').toLowerCase().includes('disenroll')) {
    return 'Chargeback';
  }
  const pt = String(paymentType || '').toLowerCase().trim();
  // Payment Type wins over Payment Description (Service Fee rows are still Renewals).
  // Check "renewal" BEFORE "new" — otherwise "renewal".includes("new") is true.
  if (pt.includes('renewal') || pt === 'legacy') return 'Renewal';
  if (pt.includes('initial') || pt === 'new' || pt.startsWith('new ')) return 'New Business';
  const pd = String(paymentDesc || '').toLowerCase();
  if (pd === 'service fee') return 'Agency Override';
  return 'Agent Commission';
}

function parseHealthSpringMedicareRows(wb, filename) {
  const records = [];
  if (!wb) return records;

  const sheetsToProcess = ['Detail', 'Legacy'].filter((s) =>
    wb.SheetNames.some((n) => String(n) === s)
  );

  for (const sheetName of sheetsToProcess) {
    const ws = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(ws, { defval: '', raw: true });
    for (const row of rows) {
      const paymentType = String(row['Payment Type'] || '').trim();
      const paymentDesc = String(row['Payment Description'] || '').trim();
      const writingBrokerName = String(row['Writing Broker Name'] || '').trim();
      const memberName = String(row['Member Name'] || '').trim();
      const memberId = row['Member ID'];
      const mbi = String(row['Medicare Beneficiary Identifier (MBI)'] || '').trim();
      const payPeriod = row['Pay Period'];
      const paymentAmount = round2(parseFloat(row['Payment Amount']) || 0);
      const effectiveDateRaw = row['Original Effective Date'] || row['Effective Date'];
      const planTypeRaw = String(row['Plan Type'] || '').trim();

      if (!memberName || !paymentAmount) continue;

      const period = periodFromPayPeriod(payPeriod) || '';
      const ptRaw = planTypeRaw.toUpperCase();
      let planType = 'HealthSpring Med Adv';
      if (ptRaw.includes('PDP')) planType = 'HealthSpring PDP';

      const policyNumber =
        typeof memberId === 'number'
          ? String(Math.round(memberId))
          : String(memberId || mbi || '').trim();

      records.push({
        agent: normalizeAgentName(writingBrokerName) || 'The Health Experts Insurance',
        carrier: 'HealthSpring',
        planType,
        client: memberName,
        effectiveDate: formatDate(effectiveDateRaw),
        premium: 0,
        commission: paymentAmount,
        classification: classifyHealthSpringRow(paymentType, paymentDesc, paymentAmount),
        period,
        policyNumber: policyNumber || mbi,
        payee: 'HealthSpring',
        raw: row,
      });
    }
  }

  const lineSum = round2(records.reduce((s, r) => s + (r.commission || 0), 0));
  const { balance, statementTotal } = readSummaryMoney(wb);
  const recon = {
    checked: statementTotal != null,
    ok: statementTotal == null ? true : Math.abs(lineSum - statementTotal) < 0.015,
    importedTotal: lineSum,
    summaryTotal: statementTotal,
    balance: balance,
    variance: statementTotal == null ? 0 : round2(lineSum - statementTotal),
    source: 'HealthSpring Summary',
  };

  if (recon.checked && !recon.ok && balance != null && Math.abs(balance) > 0.005) {
    recon.warning =
      `Statement total (${statementTotal.toFixed(2)}) differs from line sum (${lineSum.toFixed(2)}) ` +
      `because of a carried balance of ${balance.toFixed(2)}. Balance is not imported as a commission row.`;
  } else if (recon.checked && !recon.ok) {
    recon.warning =
      `Statement total (${statementTotal != null ? statementTotal.toFixed(2) : 'n/a'}) ` +
      `differs from detail line sum (${lineSum.toFixed(2)}).`;
  }

  records.reconciliation = recon;
  return records;
}

module.exports = {
  isHealthSpringMedicareFilename,
  isHealthSpringMedicareWorkbook,
  parseHealthSpringMedicareRows,
  readSummaryMoney,
  classifyHealthSpringRow,
  summaryTitle,
};
