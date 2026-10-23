'use strict';

/*
 * Extra statement sections shared by Lina's and the Integrity statements.
 * Manual adjustment lines print as their own section; negatives in red
 * (same as chargebacks).
 */

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
    ws.getCell('B' + r).value = a.categoryLabel + (a.correctsPeriod ? ' (' + a.correctsPeriod + ')' : '');
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

module.exports = { attachAdjustments: attachAdjustments, writeAdjustmentsSection: writeAdjustmentsSection, categoryLabel: categoryLabel };
