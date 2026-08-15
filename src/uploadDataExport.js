'use strict';

/**
 * Shared helpers for exporting uploaded statement / production rows.
 */

const XLSX = require('xlsx');

function sanitizeFilenamePart(name) {
  return String(name || 'export')
    .replace(/\.[^.]+$/, '')
    .replace(/[^\w.\-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 120) || 'export';
}

function exportFilename(originalName, format = 'xlsx') {
  const ext = format === 'csv' ? 'csv' : 'xlsx';
  return `${sanitizeFilenamePart(originalName)}_export.${ext}`;
}

function csvEscape(value) {
  if (value == null) return '';
  const s = value instanceof Date ? value.toISOString() : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function rowsToCsv(rows, columns) {
  const header = columns.map((c) => csvEscape(c.header)).join(',');
  const lines = (rows || []).map((row) =>
    columns.map((c) => csvEscape(typeof c.value === 'function' ? c.value(row) : row[c.key])).join(',')
  );
  return [header, ...lines].join('\n');
}

function rowsToXlsxBuffer(rows, columns, sheetName = 'Data') {
  const aoa = [
    columns.map((c) => c.header),
    ...(rows || []).map((row) =>
      columns.map((c) => {
        const v = typeof c.value === 'function' ? c.value(row) : row[c.key];
        return v == null ? '' : v;
      })
    ),
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, String(sheetName || 'Data').slice(0, 31));
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

function sendTabularExport(res, { rows, columns, originalName, format = 'xlsx', sheetName }) {
  const fmt = String(format || 'xlsx').toLowerCase() === 'csv' ? 'csv' : 'xlsx';
  const filename = exportFilename(originalName, fmt);
  if (fmt === 'csv') {
    const csv = rowsToCsv(rows, columns);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(csv);
  }
  const buffer = rowsToXlsxBuffer(rows, columns, sheetName);
  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  return res.send(buffer);
}

const COMMISSION_EXPORT_COLUMNS = Object.freeze([
  { key: 'agent_name', header: 'Agent' },
  { key: 'carrier', header: 'Carrier' },
  { key: 'plan_type', header: 'Plan Type' },
  { key: 'lob', header: 'LOB' },
  { key: 'client_full_name', header: 'Client' },
  { key: 'policy_number', header: 'Policy' },
  { key: 'effective_date', header: 'Effective Date' },
  { key: 'payment_period', header: 'Payment Period' },
  { key: 'statement_month', header: 'Statement Month' },
  { key: 'classification', header: 'Classification' },
  { key: 'premium', header: 'Premium' },
  { key: 'commission', header: 'Commission' },
  { key: 'gross_commission', header: 'Gross Commission' },
  { key: 'thei_share', header: 'THEI Share' },
  { key: 'bsi_share', header: 'BSI Share' },
  { key: 'producer_payable', header: 'Producer Payable' },
  { key: 'sub_agent_override', header: 'Sub-Agent Override' },
  { key: 'payee', header: 'Payee' },
  { key: 'mga', header: 'MGA' },
  { key: 'source', header: 'Source' },
]);

const MEDICAREPRO_EXPORT_COLUMNS = Object.freeze([
  { key: 'client_name', header: 'Client' },
  { key: 'agent_name', header: 'Agent' },
  { key: 'carrier', header: 'Carrier' },
  { key: 'policy_type', header: 'Policy Type' },
  { key: 'plan_name', header: 'Plan' },
  { key: 'policy_number', header: 'Policy' },
  { key: 'effective_date', header: 'Effective Date' },
  { key: 'status', header: 'Status' },
  { key: 'upload_batch', header: 'Batch' },
]);

const AGENCY_PRODUCTION_EXPORT_COLUMNS = Object.freeze([
  { key: 'agent_name', header: 'Agent' },
  { key: 'client_name', header: 'Client' },
  { key: 'carrier', header: 'Carrier' },
  { key: 'plan_name', header: 'Plan' },
  { key: 'policy_type', header: 'Policy Type' },
  { key: 'policy_number', header: 'Policy' },
  { key: 'effective_date', header: 'Effective Date' },
  { key: 'status', header: 'Status' },
  { key: 'upload_batch', header: 'Batch' },
]);

module.exports = {
  sanitizeFilenamePart,
  exportFilename,
  rowsToCsv,
  rowsToXlsxBuffer,
  sendTabularExport,
  COMMISSION_EXPORT_COLUMNS,
  MEDICAREPRO_EXPORT_COLUMNS,
  AGENCY_PRODUCTION_EXPORT_COLUMNS,
};
