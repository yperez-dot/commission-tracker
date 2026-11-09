'use strict';

/**
 * The production UI upload path is POST /api/files/upload (src/pages/Upload.js
 * → apiUpload('/files/upload') → routes/files.js). Parser unit tests are not
 * enough: prod previously generic-mapped YP_UHC_STATTEMENT because the route
 * chain never selected parseUHCRows.
 *
 * This module is the UHC stage of that chain plus the duplicate 409 check
 * after records have been round-tripped through commission_records columns
 * (raw_data JSON, no statement_date column).
 */

const XLSX = require('xlsx');
const { parseUhcUploadWorkbook, uadTotals } = require('./uhcCommissionParse');
const { collapseInternalDuplicates } = require('./uploadBatchDedupe');
const {
  findIncomingDuplicates,
  recordFromDbRow,
  uhcTransactionKey,
  crossFileDuplicateKey,
  duplicateMatchKey,
  policylessDuplicateKey,
  uadAmount,
  UHC_FEE_CLASSIFICATION,
  UAD_CLASSIFICATION,
} = require('./uhcUad');

function parsePostFilesUploadExcel(filePath, originalName, wb) {
  const workbook = wb || XLSX.readFile(filePath);
  const records = parseUhcUploadWorkbook(workbook, originalName);
  if (records) {
    return {
      parser: 'uhc_commission_transactions',
      records,
      workbook,
    };
  }
  return { parser: null, records: null, workbook };
}

function collapseLikePostFilesUpload(records) {
  const before = (records || []).length;
  const collapsed = collapseInternalDuplicates(records || []);
  return {
    records: collapsed.records,
    internalDuplicatesRemoved: collapsed.removedCount,
    beforeCount: before,
  };
}

function toCommissionDbRow(r) {
  return {
    policy_number: r.policyNumber,
    client_full_name: r.client,
    effective_date: r.effectiveDate,
    commission: r.commission,
    payment_period: r.period,
    uad_activity: r.uadActivity != null ? r.uadActivity : 0,
    carrier: r.carrier,
    agent_name: r.agent,
    raw_data: r.raw,
  };
}

/**
 * Same filter + recordFromDbRow + findIncomingDuplicates as routes/files.js
 * findDuplicates, without Postgres.
 */
/**
 * Rows that take part in the DB duplicate check: anything with a policy number,
 * plus policy-less money lines (Doctors/Solis prior-month negative carry).
 */
function isDuplicateCheckable(r) {
  if (!r) return false;
  if (r.policyNumber) return !!(r.client || r.statementDate);
  return !!policylessDuplicateKey(r);
}

function findDuplicatesLikePostFilesUpload(existingParsedRecords, incomingParsedRecords) {
  const incoming = incomingParsedRecords || [];
  const filtered = incoming.filter(isDuplicateCheckable);
  const existing = (existingParsedRecords || []).map(toCommissionDbRow).map(recordFromDbRow);
  const dups = findIncomingDuplicates(existing, filtered);
  const dupSet = new Set(dups);
  const duplicateRows = filtered.filter((r) => dupSet.has(r));
  const newRecords = incoming.filter((r) => !dupSet.has(r));
  return {
    duplicateWarning: duplicateRows.length > 0,
    duplicateCount: duplicateRows.length,
    totalCount: incoming.length,
    duplicates: duplicateRows.map((r) => ({
      client: r.client,
      carrier: r.carrier,
      date: r.effectiveDate,
      amount: r.commission,
      uadActivity: uadAmount(r),
      agent: r.agent,
      policy: r.policyNumber,
      type: r.classification,
      period: r.period,
      statementDate: r.statementDate || null,
      matchKey: duplicateMatchKey(r),
      txnKey: uhcTransactionKey(r),
    })),
    newRecords,
  };
}

function uploadResponseTotals(records) {
  const t = uadTotals(records);
  return {
    rowCount: t.rowCount,
    commissionSum: t.commission,
    uadSum: t.uadActivity,
    uadRows: t.uadRows,
    feeRows: t.feeRows,
    fees: t.fees,
    commissionExclFees: t.commissionExclFees,
    carriers: Array.from(new Set((records || []).map((r) => r.carrier).filter(Boolean))),
  };
}

function runPostFilesUpload(filePath, originalName, existingParsedRecords) {
  const parsed = parsePostFilesUploadExcel(filePath, originalName);
  if (!parsed.records) {
    return { parser: null, error: 'No records found in file (not a UHC workbook on this path)' };
  }
  const collapsed = collapseLikePostFilesUpload(parsed.records);
  const totals = uploadResponseTotals(collapsed.records);
  const dup = findDuplicatesLikePostFilesUpload(existingParsedRecords || [], collapsed.records);
  return {
    parser: parsed.parser,
    records: collapsed.records,
    internalDuplicatesRemoved: collapsed.internalDuplicatesRemoved,
    totals,
    duplicateCheck: dup,
  };
}

module.exports = {
  isDuplicateCheckable,
  parsePostFilesUploadExcel,
  collapseLikePostFilesUpload,
  toCommissionDbRow,
  findDuplicatesLikePostFilesUpload,
  uploadResponseTotals,
  runPostFilesUpload,
  UHC_FEE_CLASSIFICATION,
  UAD_CLASSIFICATION,
};
