import { isOverrideStatementRow } from './agencyOverrideReconMatch';

/**
 * Keep carrier-paid BSI activity separate from THEI override remittances.
 * Carrier upload category takes precedence because those records can also
 * be classified as Agency Override.
 */
export function classifyClientFileStream(row) {
  if (row?.upload_category === 'bsi_statement') return 'carrier_bsi';
  if (isOverrideStatementRow(row)) return 'thei_override';
  return 'other';
}
