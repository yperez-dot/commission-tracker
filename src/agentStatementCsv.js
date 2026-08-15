'use strict';

/**
 * Build agent payout statement as CSV (same layout as Payroll download).
 */
function formatMoney(n) {
  return '$' + Number(n || 0).toFixed(2);
}

function formatDateMmDdYyyy(dateStr) {
  if (dateStr == null || dateStr === '') return '';
  try {
    const s = String(dateStr).trim();
    const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return `${iso[2]}-${iso[3]}-${iso[1]}`;
    return s;
  } catch {
    return String(dateStr);
  }
}

function recordAmount(r) {
  const hasSubAgentOV = parseFloat(r.sub_agent_override || 0) !== 0;
  if (hasSubAgentOV) return parseFloat(r.sub_agent_override);
  if (r.producer_payable != null) return parseFloat(r.producer_payable) || 0;
  return parseFloat(r.commission) || 0;
}

function buildAgentStatementCsv(agent, records, periodLabel) {
  const list = Array.isArray(records) ? records : [];
  const positives = list.filter((r) => recordAmount(r) >= 0);
  const negatives = list.filter((r) => recordAmount(r) < 0);
  const grossTotal = positives.reduce((s, r) => s + recordAmount(r), 0);
  const chargebackTotal = negatives.reduce((s, r) => s + recordAmount(r), 0);
  const netTotal = grossTotal + chargebackTotal;
  const headers = ['Policy #', 'Client', 'Statement', 'Lives', 'Effective Date', 'Commission', 'Type'];

  const rows = [
    [`*** AGENT: ${agent} ***`, '', '', '', '', '', ''],
    [`Period: ${periodLabel}`, '', '', '', '', '', ''],
    ['', '', '', '', '', '', ''],
    headers,
    ...positives.map((r) => [
      r.policy_number || '—',
      r.client_full_name,
      r.statement_month || r.carrier,
      r.members != null && r.members !== 0 ? r.members : '',
      formatDateMmDdYyyy(r.effective_date),
      formatMoney(recordAmount(r)),
      r.classification || '—',
    ]),
    ...(negatives.length
      ? [
          ['--- CHARGEBACKS ---', '', '', '', '', '', ''],
          ...negatives.map((r) => [
            r.policy_number || '—',
            r.client_full_name,
            r.statement_month || r.carrier,
            r.members != null && r.members !== 0 ? r.members : '',
            formatDateMmDdYyyy(r.effective_date),
            formatMoney(recordAmount(r)),
            r.classification || '—',
          ]),
        ]
      : []),
    ['', '', '', '', '', '', ''],
    ['Gross Commission', '', '', '', '', formatMoney(grossTotal), ''],
    ...(negatives.length ? [['Chargebacks', '', '', '', '', formatMoney(chargebackTotal), '']] : []),
    ['NET TOTAL', '', '', '', '', formatMoney(netTotal), ''],
  ];

  return rows.map((r) => r.map((v) => `"${String(v || '').replace(/"/g, '""')}"`).join(',')).join('\n');
}

function statementFilename(agent, periodLabel, isBSI) {
  const who = isBSI ? 'BSI' : 'THEI';
  const a = String(agent || 'Agent').replace(/\s+/g, '_');
  const p = String(periodLabel || 'Period').replace(/\s+/g, '_');
  return `${who}_Statement_${a}_${p}.csv`;
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
}

module.exports = {
  buildAgentStatementCsv,
  statementFilename,
  recordAmount,
  isValidEmail,
};
