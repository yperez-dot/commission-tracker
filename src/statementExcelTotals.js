'use strict';

/** Shared Excel money formatting for statement header totals and the line-table TOTAL row. */

const MONEY_FMT = '$#,##0.00;($#,##0.00)';
const NEG_RED = { argb: 'FFB91C1C' };

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function writeMoneyCell(cell, value, opts = {}) {
  const n = round2(value);
  cell.value = n;
  cell.numFmt = MONEY_FMT;
  const font = { ...(cell.font || {}) };
  if (opts.bold) font.bold = true;
  if (opts.size) font.size = opts.size;
  if (n < 0) font.color = NEG_RED;
  cell.font = font;
  return n;
}

function writeLabeledMoney(ws, row, label, value, opts = {}) {
  const labelCell = ws.getCell(`A${row}`);
  labelCell.value = label;
  labelCell.style = opts.labelStyle || { font: { size: 11, color: { argb: 'FF64748B' } } };
  writeMoneyCell(ws.getCell(`B${row}`), value, opts);
}

module.exports = {
  MONEY_FMT,
  NEG_RED,
  round2,
  writeMoneyCell,
  writeLabeledMoney,
};
