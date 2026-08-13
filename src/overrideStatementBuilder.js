'use strict';

/**
 * Override statement builder — assemble payee statements from commission_records.
 *
 * Statement types (see payeeSchedules.STATEMENT_TYPES):
 *   thei_override  → amount = thei_share on Agency Override rows (excl. Integrity producer cut)
 *   bsi_override   → amount = bsi_share on Agency Override rows
 *   marco          → amount = sub_agent_override on Marco-schedule agents (rollup to "Marco")
 *   integrity      → amount = producer_payable on Integrity agents (Chris / Horacio / CAM)
 *
 * Does not mutate financial columns. Observe/export only.
 */

const {
  STATEMENT_TYPES,
  isIntegrityAgent,
  isMarcoAgent,
  isAgencyOverride,
} = require('./payeeSchedules');

function num(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

function formatPeriodLabel(p) {
  if (!p) return '';
  const s = String(p).trim();
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  if (/^\d{6}$/.test(s)) {
    const m = parseInt(s.slice(4, 6), 10);
    if (m >= 1 && m <= 12) return `${months[m - 1]} ${s.slice(0, 4)}`;
  }
  return s;
}

function lineKey(row) {
  return [
    row.id,
    row.agent_name,
    row.client_full_name,
    row.policy_number,
    row.payment_period,
    row.classification,
    row.carrier,
  ].join('|');
}

/**
 * Select amount + payee label for a row under a statement type.
 * Returns null if the row does not belong on that statement.
 */
function classifyOverrideLine(row, statementType) {
  if (!isAgencyOverride(row.classification) && statementType !== STATEMENT_TYPES.INTEGRITY) {
    // Integrity statements include Agency Override only (producer cut lives there).
  }
  const clsOverride = isAgencyOverride(row.classification);

  switch (statementType) {
    case STATEMENT_TYPES.THEI_OVERRIDE: {
      if (!clsOverride) return null;
      // Integrity rows still contribute THEI's 25% share.
      const amount = num(row.thei_share);
      if (amount === 0 && num(row.commission) === 0) return null;
      return {
        payee: 'The Health Experts Insurance',
        amountField: 'thei_share',
        amount,
        schedule: isIntegrityAgent(row.agent_name)
          ? 'integrity_thei_25'
          : isMarcoAgent(row.agent_name, row.payment_period)
            ? 'marco_residual_thei'
            : 'standard_thei_half',
      };
    }
    case STATEMENT_TYPES.BSI_OVERRIDE: {
      if (!clsOverride) return null;
      const amount = num(row.bsi_share);
      if (amount === 0 && num(row.commission) === 0) return null;
      return {
        payee: 'Broker Society Insurance',
        amountField: 'bsi_share',
        amount,
        schedule: isIntegrityAgent(row.agent_name)
          ? 'integrity_bsi_25'
          : isMarcoAgent(row.agent_name, row.payment_period)
            ? 'marco_residual_bsi'
            : 'standard_bsi_half',
      };
    }
    case STATEMENT_TYPES.MARCO: {
      if (!clsOverride) return null;
      if (!isMarcoAgent(row.agent_name, row.payment_period)) return null;
      const amount = num(row.sub_agent_override);
      if (amount === 0) return null;
      return {
        payee: 'Marco',
        amountField: 'sub_agent_override',
        amount,
        schedule: 'marco_10_per_policy',
        writingAgent: row.agent_name,
      };
    }
    case STATEMENT_TYPES.INTEGRITY: {
      if (!clsOverride) return null;
      if (!isIntegrityAgent(row.agent_name)) return null;
      const amount = num(row.producer_payable);
      // Include $0 lines only if commission non-zero? Prefer non-zero producer cut.
      if (amount === 0 && num(row.commission) === 0) return null;
      return {
        payee: row.agent_name, // Chris / Horacio / CAM each get their own statement
        amountField: 'producer_payable',
        amount,
        schedule: 'integrity_50_25_25',
      };
    }
    default:
      return null;
  }
}

/**
 * Build statement groups from commission rows.
 *
 * @param {object[]} rows
 * @param {string} statementType
 * @param {{ period?: string }} opts
 * @returns {{ type, periodLabel, statements: Array<{payee, total, lines}> }}
 */
function buildOverrideStatements(rows, statementType, opts = {}) {
  const seen = new Set();
  const byPayee = new Map();

  for (const row of rows) {
    if (opts.period && opts.period !== 'all' && String(row.payment_period) !== String(opts.period)) {
      continue;
    }
    const classified = classifyOverrideLine(row, statementType);
    if (!classified) continue;

    const key = lineKey(row);
    if (seen.has(key)) continue;
    seen.add(key);

    const payee = classified.payee;
    if (!byPayee.has(payee)) {
      byPayee.set(payee, { payee, total: 0, lines: [] });
    }
    const bucket = byPayee.get(payee);
    bucket.total += classified.amount;
    bucket.lines.push({
      id: row.id,
      agent_name: row.agent_name,
      writing_agent: classified.writingAgent || row.agent_name,
      client_full_name: row.client_full_name,
      policy_number: row.policy_number,
      carrier: row.carrier,
      effective_date: row.effective_date,
      payment_period: row.payment_period,
      classification: row.classification,
      commission: num(row.commission),
      thei_share: num(row.thei_share),
      bsi_share: num(row.bsi_share),
      producer_payable: num(row.producer_payable),
      sub_agent_override: num(row.sub_agent_override),
      amount: classified.amount,
      amount_field: classified.amountField,
      schedule: classified.schedule,
    });
  }

  const statements = [...byPayee.values()]
    .map((s) => ({
      ...s,
      total: Math.round(s.total * 100) / 100,
      lineCount: s.lines.length,
    }))
    .sort((a, b) => b.total - a.total);

  return {
    type: statementType,
    period: opts.period || 'all',
    periodLabel: opts.period && opts.period !== 'all' ? formatPeriodLabel(opts.period) : 'All Periods',
    statementCount: statements.length,
    grandTotal: Math.round(statements.reduce((s, x) => s + x.total, 0) * 100) / 100,
    statements,
  };
}

function csvEscape(v) {
  const s = String(v == null ? '' : v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return `"${s}"`;
}

function fmtMoney(n) {
  return `$${Number(n || 0).toFixed(2)}`;
}

/**
 * Render one payee statement as CSV text.
 */
function statementToCsv(bundle, payeeStatement) {
  const title =
    bundle.type === STATEMENT_TYPES.MARCO
      ? 'Marco Override Statement ($10 / policy)'
      : bundle.type === STATEMENT_TYPES.INTEGRITY
        ? 'Integrity Partners Producer Statement (50%)'
        : bundle.type === STATEMENT_TYPES.BSI_OVERRIDE
          ? 'BSI Override Statement (bsi_share)'
          : 'THEI Override Statement (thei_share)';

  const lines = [
    csvEscape(title),
    csvEscape(`Payee: ${payeeStatement.payee}`),
    csvEscape(`Period: ${bundle.periodLabel}`),
    csvEscape('Generated by OliComm Override Statements'),
    '',
    [
      'Policy #',
      'Client',
      'Carrier',
      'Writing Agent',
      'Effective',
      'Period',
      'Type',
      'Gross/Commission',
      'Payable Amount',
      'Amount Field',
      'Schedule',
    ].map(csvEscape).join(','),
  ];

  const positives = payeeStatement.lines.filter((l) => l.amount >= 0);
  const negatives = payeeStatement.lines.filter((l) => l.amount < 0);

  for (const l of positives) {
    lines.push(
      [
        l.policy_number,
        l.client_full_name,
        l.carrier,
        l.writing_agent,
        l.effective_date,
        l.payment_period,
        l.classification,
        fmtMoney(l.commission),
        fmtMoney(l.amount),
        l.amount_field,
        l.schedule,
      ].map(csvEscape).join(',')
    );
  }
  if (negatives.length) {
    lines.push(csvEscape('--- CHARGEBACKS / NEGATIVES ---'));
    for (const l of negatives) {
      lines.push(
        [
          l.policy_number,
          l.client_full_name,
          l.carrier,
          l.writing_agent,
          l.effective_date,
          l.payment_period,
          l.classification,
          fmtMoney(l.commission),
          fmtMoney(l.amount),
          l.amount_field,
          l.schedule,
        ].map(csvEscape).join(',')
      );
    }
  }

  const gross = positives.reduce((s, l) => s + l.amount, 0);
  const cb = negatives.reduce((s, l) => s + l.amount, 0);
  lines.push('');
  lines.push([csvEscape('Gross'), '', '', '', '', '', '', '', csvEscape(fmtMoney(gross))].join(','));
  if (negatives.length) {
    lines.push([csvEscape('Chargebacks'), '', '', '', '', '', '', '', csvEscape(fmtMoney(cb))].join(','));
  }
  lines.push([csvEscape('NET TOTAL'), '', '', '', '', '', '', '', csvEscape(fmtMoney(gross + cb))].join(','));
  lines.push('');
  return lines.join('\n');
}

/**
 * Summary CSV across all payees for a type/period.
 */
function summaryToCsv(bundle) {
  const lines = [
    csvEscape(`OliComm Override Summary — ${bundle.type}`),
    csvEscape(`Period: ${bundle.periodLabel}`),
    '',
    ['Payee', 'Lines', 'Net Total'].map(csvEscape).join(','),
  ];
  for (const s of bundle.statements) {
    lines.push([s.payee, s.lineCount, fmtMoney(s.total)].map(csvEscape).join(','));
  }
  lines.push(['GRAND TOTAL', '', fmtMoney(bundle.grandTotal)].map(csvEscape).join(','));
  return lines.join('\n');
}

function filenameFor(bundle, payee) {
  const safePayee = String(payee || 'ALL').replace(/\s+/g, '_').replace(/[^A-Za-z0-9_\-]/g, '');
  const period = bundle.period === 'all' ? 'ALL' : bundle.period;
  return `${bundle.type}_${safePayee}_${period}.csv`;
}

module.exports = {
  STATEMENT_TYPES,
  classifyOverrideLine,
  buildOverrideStatements,
  statementToCsv,
  summaryToCsv,
  filenameFor,
  formatPeriodLabel,
};
