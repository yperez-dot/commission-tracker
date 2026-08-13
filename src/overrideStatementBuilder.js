'use strict';

/**
 * Override statement builder — assemble payee statements from commission_records.
 *
 * Statement types (see payeeSchedules.STATEMENT_TYPES):
 *   thei_override  → amount = thei_share (50% of override pot on standard BSI rows)
 *   bsi_override   → amount = bsi_share  (50% of override pot on standard BSI rows)
 *   marco          → amount = sub_agent_override on Marco-schedule agents
 *   integrity      → amount = producer_payable on Integrity agents
 *
 * Does not mutate financial columns. Observe/export only.
 */

const {
  STATEMENT_TYPES,
  isIntegrityAgent,
  isMarcoAgent,
  isAlbaHernandez,
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
 * Resolve the override pot (gross) for display.
 * Prefer gross_commission; fall back to thei+bsi(+marco/integrity) or commission.
 */
function overridePot(row) {
  const gross = num(row.gross_commission);
  if (gross) return gross;
  const parts =
    num(row.thei_share) +
    num(row.bsi_share) +
    num(row.sub_agent_override) +
    num(row.producer_payable);
  if (parts) return parts;
  return num(row.commission);
}

function sharePct(amount, pot) {
  if (!pot) return '';
  return `${Math.round((Math.abs(amount) / Math.abs(pot)) * 1000) / 10}%`;
}

/**
 * Select amount + payee label for a row under a statement type.
 * Returns null if the row does not belong on that statement.
 */
function classifyOverrideLine(row, statementType) {
  const clsOverride = isAgencyOverride(row.classification);

  switch (statementType) {
    case STATEMENT_TYPES.THEI_OVERRIDE: {
      if (!clsOverride) return null;
      const amount = num(row.thei_share);
      if (amount === 0 && num(row.commission) === 0) return null;
      const pot = overridePot(row);
      return {
        payee: 'The Health Experts Insurance',
        amountField: 'thei_share',
        amount,
        pot,
        shareLabel: sharePct(amount, pot) || (isIntegrityAgent(row.agent_name) ? '25%' : '50%'),
        schedule: isIntegrityAgent(row.agent_name)
          ? 'integrity_thei_25'
          : isMarcoAgent(row.agent_name, row.payment_period)
            ? 'marco_residual_thei'
            : 'standard_thei_50',
      };
    }
    case STATEMENT_TYPES.BSI_OVERRIDE: {
      if (!clsOverride) return null;
      const amount = num(row.bsi_share);
      if (amount === 0 && num(row.commission) === 0) return null;
      const pot = overridePot(row);
      return {
        payee: 'Broker Society Insurance',
        amountField: 'bsi_share',
        amount,
        pot,
        shareLabel: sharePct(amount, pot) || (isIntegrityAgent(row.agent_name) ? '25%' : '50%'),
        schedule: isIntegrityAgent(row.agent_name)
          ? 'integrity_bsi_25'
          : isMarcoAgent(row.agent_name, row.payment_period)
            ? 'marco_residual_bsi'
            : 'standard_bsi_50',
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
        pot: overridePot(row),
        shareLabel: '$10',
        schedule: 'marco_10_per_policy',
        writingAgent: row.agent_name,
      };
    }
    case STATEMENT_TYPES.INTEGRITY: {
      if (!clsOverride) return null;
      if (!isIntegrityAgent(row.agent_name)) return null;
      const amount = num(row.producer_payable);
      if (amount === 0 && num(row.commission) === 0) return null;
      const pot = overridePot(row);
      return {
        payee: row.agent_name,
        amountField: 'producer_payable',
        amount,
        pot,
        shareLabel: sharePct(amount, pot) || '50%',
        schedule: 'integrity_50_25_25',
      };
    }
    case STATEMENT_TYPES.ALBA: {
      // Alba agent payout statement — all classifications with producer_payable.
      if (!isAlbaHernandez(row.agent_name)) return null;
      const amount = num(row.producer_payable);
      if (amount === 0) return null;
      return {
        payee: 'Alba Hernandez',
        amountField: 'producer_payable',
        amount,
        pot: num(row.gross_commission) || num(row.commission) || Math.abs(amount),
        shareLabel: 'producer',
        schedule: 'alba_producer_payable',
      };
    }
    default:
      return null;
  }
}

/**
 * Build statement groups from commission rows.
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
      override_pot: classified.pot,
      thei_share: num(row.thei_share),
      bsi_share: num(row.bsi_share),
      producer_payable: num(row.producer_payable),
      sub_agent_override: num(row.sub_agent_override),
      amount: classified.amount,
      amount_field: classified.amountField,
      share_label: classified.shareLabel,
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

/**
 * Combined THEI+BSI breakdown for one period — makes the 50/50 split obvious.
 */
function buildTheiBsiBreakdown(rows, opts = {}) {
  const seen = new Set();
  const lines = [];
  let sumPot = 0;
  let sumThei = 0;
  let sumBsi = 0;
  let sumMarco = 0;
  let sumIntegrity = 0;

  for (const row of rows) {
    if (opts.period && opts.period !== 'all' && String(row.payment_period) !== String(opts.period)) {
      continue;
    }
    if (!isAgencyOverride(row.classification)) continue;
    const key = lineKey(row);
    if (seen.has(key)) continue;
    seen.add(key);

    const pot = overridePot(row);
    const thei = num(row.thei_share);
    const bsi = num(row.bsi_share);
    const marco = num(row.sub_agent_override);
    const integrity = num(row.producer_payable);
    sumPot += pot;
    sumThei += thei;
    sumBsi += bsi;
    sumMarco += marco;
    sumIntegrity += integrity;

    lines.push({
      id: row.id,
      agent_name: row.agent_name,
      client_full_name: row.client_full_name,
      policy_number: row.policy_number,
      carrier: row.carrier,
      payment_period: row.payment_period,
      override_pot: pot,
      thei_share: thei,
      bsi_share: bsi,
      sub_agent_override: marco,
      producer_payable: integrity,
      thei_pct: sharePct(thei, pot),
      bsi_pct: sharePct(bsi, pot),
    });
  }

  return {
    type: 'thei_bsi_breakdown',
    period: opts.period || 'all',
    periodLabel: opts.period && opts.period !== 'all' ? formatPeriodLabel(opts.period) : 'All Periods',
    lineCount: lines.length,
    totals: {
      override_pot: Math.round(sumPot * 100) / 100,
      thei_share: Math.round(sumThei * 100) / 100,
      bsi_share: Math.round(sumBsi * 100) / 100,
      sub_agent_override: Math.round(sumMarco * 100) / 100,
      producer_payable: Math.round(sumIntegrity * 100) / 100,
    },
    lines,
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

function statementToCsv(bundle, payeeStatement) {
  const title =
    bundle.type === STATEMENT_TYPES.MARCO
      ? 'Marco Override Statement ($10 / policy)'
      : bundle.type === STATEMENT_TYPES.INTEGRITY
        ? 'Integrity Partners Producer Statement (50%)'
        : bundle.type === STATEMENT_TYPES.ALBA
          ? 'Alba Hernandez Agent Statement (producer_payable)'
        : bundle.type === STATEMENT_TYPES.BSI_OVERRIDE
          ? 'BSI Override Statement (50% of override pot)'
          : 'THEI Override Statement (50% of override pot)';

  const splitNote =
    bundle.type === STATEMENT_TYPES.ALBA
      ? 'Alba agent payout — uses producer_payable (New Business / Renewal / Chargeback)'
      : 'Split: THEI and BSI are 50/50 of the override pot (Integrity 50/25/25; Marco $10 then 50/50)';

  const lines = [
    csvEscape(title),
    csvEscape(`Payee: ${payeeStatement.payee}`),
    csvEscape(`Period: ${bundle.periodLabel}`),
    csvEscape(splitNote),
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
      'Override Pot',
      'Share %',
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
        fmtMoney(l.override_pot),
        l.share_label,
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
          fmtMoney(l.override_pot),
          l.share_label,
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
  lines.push([csvEscape('Gross'), '', '', '', '', '', '', '', '', csvEscape(fmtMoney(gross))].join(','));
  if (negatives.length) {
    lines.push([csvEscape('Chargebacks'), '', '', '', '', '', '', '', '', csvEscape(fmtMoney(cb))].join(','));
  }
  lines.push([csvEscape('NET TOTAL'), '', '', '', '', '', '', '', '', csvEscape(fmtMoney(gross + cb))].join(','));
  lines.push('');
  return lines.join('\n');
}

function breakdownToCsv(bundle) {
  const t = bundle.totals;
  const lines = [
    csvEscape('OliComm THEI / BSI Override Breakdown (50/50)'),
    csvEscape(`Period: ${bundle.periodLabel}`),
    csvEscape(
      `Totals — Pot ${fmtMoney(t.override_pot)} | THEI ${fmtMoney(t.thei_share)} | BSI ${fmtMoney(t.bsi_share)} | Marco ${fmtMoney(t.sub_agent_override)} | Integrity ${fmtMoney(t.producer_payable)}`
    ),
    '',
    [
      'Policy #',
      'Client',
      'Carrier',
      'Writing Agent',
      'Period',
      'Override Pot',
      'THEI Share',
      'THEI %',
      'BSI Share',
      'BSI %',
      'Marco $10',
      'Integrity Producer',
    ].map(csvEscape).join(','),
  ];
  for (const l of bundle.lines) {
    lines.push(
      [
        l.policy_number,
        l.client_full_name,
        l.carrier,
        l.agent_name,
        l.payment_period,
        fmtMoney(l.override_pot),
        fmtMoney(l.thei_share),
        l.thei_pct,
        fmtMoney(l.bsi_share),
        l.bsi_pct,
        fmtMoney(l.sub_agent_override),
        fmtMoney(l.producer_payable),
      ].map(csvEscape).join(',')
    );
  }
  return lines.join('\n');
}

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
  buildTheiBsiBreakdown,
  statementToCsv,
  breakdownToCsv,
  summaryToCsv,
  filenameFor,
  formatPeriodLabel,
  overridePot,
};
