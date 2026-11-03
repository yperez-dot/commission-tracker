'use strict';
const { periodToMmYyyy } = require('./periodFormat');

/*
 * Extra statement sections shared by Lina's and the Integrity statements.
 * Manual adjustment lines print as their own section; negatives in red
 * (same as chargebacks).
 */

var bottomLine = require('./payrollLock').bottomLine;

var MONEY = '$#,##0.00;($#,##0.00)';
var RED = { argb: 'FFB91C1C' };

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function categoryLabel(key) {
  var map = {
    clawback_not_on_file: 'Clawback not yet on file',
    correction: 'Correction',
    advance: 'Advance',
    prior_period_correction: 'Prior-period correction',
    agent_repayment: 'Repayment from agent',
    other: 'Other',
  };
  return map[key] || String(key || '');
}

/** Attach active adjustments to a built statement (mutates + returns it). */
function attachAdjustments(statement, adjustments) {
  var list = (adjustments || []).filter(function (a) { return !a.voided_at && a.status !== 'void'; })
    .map(function (a) {
      return {
        id: a.id,
        date: a.created_at ? String(a.created_at instanceof Date ? a.created_at.toISOString() : a.created_at).slice(0, 10) : '',
        category: a.category,
        categoryLabel: categoryLabel(a.category),
        reason: a.reason || '',
        correctsPeriod: a.corrects_period || null,
        amount: round2(a.amount),
      };
    });
  statement.adjustments = list;
  statement.adjustmentsTotal = round2(list.reduce(function (s, a) { return s + a.amount; }, 0));
  statement.balanceAfterAdjustments = round2((Number(statement.balance) || 0) + statement.adjustmentsTotal);
  return statement;
}

/**
 * Write the "Adjustments" section. Returns the next free row.
 * amountCol: column letter for amounts (both statements use F).
 */
function writeAdjustmentsSection(ws, startRow, statement, amountCol) {
  var col = amountCol || 'F';
  var adj = statement.adjustments || [];
  if (!adj.length) return startRow;
  var r = startRow;
  ws.getCell('A' + r).value = 'ADJUSTMENTS';
  ws.getCell('A' + r).font = { bold: true, size: 12 };
  r += 1;
  ['Date', 'Category', 'Reason'].forEach(function (h, i) {
    var cell = ws.getRow(r).getCell(i + 1);
    cell.value = h;
    cell.font = { bold: true, color: { argb: 'FF334155' } };
  });
  ws.getCell(col + r).value = 'Amount';
  ws.getCell(col + r).font = { bold: true, color: { argb: 'FF334155' } };
  r += 1;
  adj.forEach(function (a) {
    ws.getCell('A' + r).value = a.date;
    ws.getCell('B' + r).value = a.categoryLabel + (a.correctsPeriod ? ' (' + (periodToMmYyyy(a.correctsPeriod) || a.correctsPeriod) + ')' : '');
    ws.getCell('C' + r).value = a.reason;
    ws.getCell(col + r).value = a.amount;
    ws.getCell(col + r).numFmt = MONEY;
    if (a.amount < 0) ws.getCell(col + r).font = { color: RED };
    r += 1;
  });
  ws.getCell('A' + r).value = 'Adjustments total';
  ws.getCell('A' + r).font = { bold: true };
  ws.getCell(col + r).value = statement.adjustmentsTotal;
  ws.getCell(col + r).numFmt = MONEY;
  ws.getCell(col + r).font = statement.adjustmentsTotal < 0 ? { bold: true, color: RED } : { bold: true };
  r += 1;
  ws.getCell('A' + r).value = 'Balance after adjustments';
  ws.getCell('A' + r).font = { bold: true, size: 12 };
  ws.getCell(col + r).value = statement.balanceAfterAdjustments;
  ws.getCell(col + r).numFmt = MONEY;
  ws.getCell(col + r).font = statement.balanceAfterAdjustments < 0 ? { bold: true, size: 12, color: RED } : { bold: true, size: 12 };
  return r + 1;
}

/**
 * Net for the statement's bottom line: carry-forward net when known (monthly statements),
 * else the balance after adjustments.
 */
/**
 * Prior-month negative lines that still make up carryIn. Oldest first; the last
 * line is trimmed so the subtotal always equals the carried amount.
 */
function buildCarryDetailLines(lines, period, carryIn, startPeriod) {
  var target = round2(carryIn);
  if (!(target < -0.005) || !/^\d{6}$/.test(String(period || ''))) return [];
  var start = String(startPeriod || '202609');
  var prior = (lines || []).filter(function (l) {
    var p = String(l.paymentPeriod || l.payment_period || '');
    var amt = Number(l.commission != null ? l.commission : l.amount) || 0;
    return /^\d{6}$/.test(p) && p >= start && p < String(period) && amt < -0.005;
  }).sort(function (a, b) {
    var pa = String(a.paymentPeriod || a.payment_period || '');
    var pb = String(b.paymentPeriod || b.payment_period || '');
    if (pa !== pb) return pa < pb ? -1 : 1;
    return (Number(a.id) || 0) - (Number(b.id) || 0);
  });
  var need = round2(-target);
  var out = [];
  prior.forEach(function (l) {
    if (need < 0.005) return;
    var amt = Number(l.commission != null ? l.commission : l.amount) || 0;
    var take = Math.min(need, -amt);
    var p = String(l.paymentPeriod || l.payment_period || '');
    out.push({
      id: l.id,
      agent: l.agent || l.agency || '',
      company: l.company || l.carrier || '',
      policyNumber: l.policyNumber || l.policy_number || '',
      clientName: l.clientName || l.client_full_name || '',
      effectiveDate: l.effectiveDate || l.effective_date || '',
      period: periodToMmYyyy(p) || p,
      paymentPeriod: p,
      amount: round2(-take),
    });
    need = round2(need - take);
  });
  return out;
}

function attachCarryDetail(statement, allLines, period, carry) {
  if (!statement) return statement;
  var carryIn = carry && carry.carryIn != null ? carry.carryIn : (statement.carry && statement.carry.carryIn);
  var start = (carry && carry.startPeriod) || (statement.carry && statement.carry.startPeriod);
  statement.carryDetail = buildCarryDetailLines(allLines || statement.lines, period || statement.period, carryIn, start);
  return statement;
}

/**
 * "Carried balance detail" table. Returns the next free row (same as writeBottomLine).
 */
function writeCarryDetailSection(ws, startRow, statement, opts) {
  var lines = (statement && statement.carryDetail) || [];
  if (!lines.length) return startRow;
  var amountCol = (opts && opts.amountCol) || 7;
  var r = startRow;
  var head = {
    font: { bold: true, size: 11, color: { argb: 'FF334155' } },
    fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } },
    border: { bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } } },
  };
  ws.getCell('A' + r).value = 'Carried balance detail';
  ws.getCell('A' + r).font = { bold: true, size: 12 };
  r += 1;
  ['Agent', 'Company', 'Policy #', 'Client Name', 'Effective Date', 'Period', 'Amount'].forEach(function (h, i) {
    var cell = ws.getRow(r).getCell(i + 1);
    cell.value = h;
    cell.style = head;
  });
  r += 1;
  var total = 0;
  lines.forEach(function (l) {
    var row = ws.getRow(r);
    row.getCell(1).value = l.agent;
    row.getCell(2).value = l.company;
    row.getCell(3).value = l.policyNumber;
    row.getCell(4).value = l.clientName;
    row.getCell(5).value = l.effectiveDate;
    row.getCell(6).value = l.period;
    row.getCell(amountCol).value = l.amount;
    row.getCell(amountCol).numFmt = MONEY;
    if (l.amount < 0) row.getCell(amountCol).font = { color: RED };
    total = round2(total + l.amount);
    r += 1;
  });
  ws.getCell('A' + r).value = 'TOTAL';
  ws.getCell('A' + r).font = { bold: true };
  var totalCell = ws.getRow(r).getCell(amountCol);
  totalCell.value = total;
  totalCell.numFmt = MONEY;
  totalCell.font = total < 0 ? { bold: true, color: RED } : { bold: true };
  return r + 1;
}

function statementNet(statement) {
  if (statement.carry && statement.carry.net != null) return round2(statement.carry.net);
  if (statement.balanceAfterAdjustments != null) return round2(statement.balanceAfterAdjustments);
  return round2(statement.balance);
}

/**
 * Carry-forward rows (if any) and the bottom line, always printed:
 *   "Amount payable to agent"  or  "Balance due from agent" (red, amount shown positive).
 * Returns the next free row.
 */
function writeBottomLine(ws, startRow, statement, amountCol) {
  var col = amountCol || 'F';
  var r = startRow;
  var carry = statement.carry;
  if (carry && carry.carryIn) {
    ws.getCell('A' + r).value = 'Negative balance carried in from prior months';
    ws.getCell(col + r).value = carry.carryIn;
    ws.getCell(col + r).numFmt = MONEY;
    ws.getCell(col + r).font = { color: RED };
    r += 1;
  }
  var bl = statement.bottomLine || bottomLine(statementNet(statement));
  ws.getCell('A' + r).value = bl.label;
  ws.getCell('A' + r).font = bl.isBalanceDue ? { bold: true, size: 12, color: RED } : { bold: true, size: 12 };
  ws.getCell(col + r).value = bl.amount;
  ws.getCell(col + r).numFmt = MONEY;
  ws.getCell(col + r).font = bl.isBalanceDue ? { bold: true, size: 12, color: RED } : { bold: true, size: 12 };
  r += 1;
  if (bl.isBalanceDue) {
    if (carry && carry.carryOut < 0) {
      ws.getCell('A' + r).value = 'Negative balance carried to next period';
      ws.getCell(col + r).value = carry.carryOut;
      ws.getCell(col + r).numFmt = MONEY;
      ws.getCell(col + r).font = { color: RED };
      r += 1;
    }
  }
  return r;
}

module.exports = {
  attachAdjustments: attachAdjustments,
  attachCarryDetail: attachCarryDetail,
  buildCarryDetailLines: buildCarryDetailLines,
  writeAdjustmentsSection: writeAdjustmentsSection,
  writeCarryDetailSection: writeCarryDetailSection,
  writeBottomLine: writeBottomLine,
  statementNet: statementNet,
  categoryLabel: categoryLabel,
};
