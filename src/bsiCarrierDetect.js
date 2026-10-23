'use strict';

/**
 * Carrier→BSI upload layout detection (BSI Statements page).
 *
 * Each carrier's BSI file has its own column signature. Routing by signature
 * (not only by filename) keeps an Aetna / Humana / Devoted file from falling
 * through to the UHC parser, which hard-codes carrier UnitedHealthcare.
 *
 * CommonJS so routes/files.js and the tests share one copy.
 */

const { carrierDisplayName } = require('./bsiStatementTitle');

const BSI_LAYOUTS = Object.freeze({
  AETNA_PAYEE: 'aetna_payee',
  HUMANA_DEVOTED: 'humana_devoted',
  UHC: 'uhc_carrier',
});

function cleanHeader(h) {
  return String(h == null ? '' : h).replace(/^\uFEFF/, '').trim().toLowerCase();
}

/** Which BSI layout a header row belongs to, or null. */
function detectBsiLayoutFromHeaders(headers) {
  const set = new Set((headers || []).map(cleanHeader).filter(Boolean));
  const has = (...cols) => cols.every((c) => set.has(c));
  // Aetna → BSI payee CSV
  if (has('payee amount', 'sales event', 'writing agent name') && (set.has('plan id') || set.has('member id'))) {
    return BSI_LAYOUTS.AETNA_PAYEE;
  }
  // Humana / Devoted → BSI split workbook
  if (has('insured name', 'commission ($)') && (set.has('writing agent') || set.has('carrier'))) {
    return BSI_LAYOUTS.HUMANA_DEVOTED;
  }
  // UHC → BSI "Commission Transactions"
  if (has('writing agent name', 'member name', 'commission') &&
      (set.has('commission action') || set.has('policy number'))) {
    return BSI_LAYOUTS.UHC;
  }
  return null;
}

/**
 * Detect the layout of a workbook: checks the "Commission Transactions" sheet
 * first, then every sheet, using each of the first few rows as a header row.
 */
function detectBsiWorkbookLayout(wb, XLSX) {
  if (!wb || !Array.isArray(wb.SheetNames)) return null;
  const names = [...wb.SheetNames].sort((a, b) => {
    const ta = /commission trans/i.test(a) ? 0 : 1;
    const tb = /commission trans/i.test(b) ? 0 : 1;
    return ta - tb;
  });
  for (const name of names) {
    const ws = wb.Sheets[name];
    if (!ws) continue;
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false }).slice(0, 5);
    for (const row of rows) {
      const layout = detectBsiLayoutFromHeaders(row);
      if (layout) return layout;
    }
  }
  return null;
}

/** Canonical carrier key: 'Aetna' | 'Humana' | 'Devoted' | 'UHC' | null. */
function carrierKey(text) {
  const c = carrierDisplayName(String(text || ''));
  return c || null;
}

/** Carrier the user pointed at: selected carrier, then title, then filename. */
function expectedCarrier({ selectedCarrier, title, filename } = {}) {
  return carrierKey(selectedCarrier) || carrierKey(title) || carrierKey(filename) || null;
}

/** Carrier a layout implies (Humana/Devoted is per row, so null). */
function layoutCarrier(layout) {
  if (layout === BSI_LAYOUTS.AETNA_PAYEE) return 'Aetna';
  if (layout === BSI_LAYOUTS.UHC) return 'UHC';
  return null;
}

/**
 * Upload-time sanity warning: the carrier the user picked / named the file for
 * does not match what was detected / imported. Returns a message or null.
 */
function carrierMismatchWarning({ expected, layout, importedCarriers } = {}) {
  if (!expected) return null;
  const detected = [...new Set((importedCarriers || []).map((c) => carrierKey(c) || String(c || '').trim()).filter(Boolean))];
  const fromLayout = layoutCarrier(layout);
  const humanaDevoted = (k) => k === 'Humana' || k === 'Devoted';
  const matches = (k) => k === expected || (humanaDevoted(k) && humanaDevoted(expected) && layout === BSI_LAYOUTS.HUMANA_DEVOTED);
  if (fromLayout && !matches(fromLayout)) {
    return `This file was selected/named as ${expected}, but its columns look like a ${fromLayout} statement. Check the carrier before using this upload.`;
  }
  const off = detected.filter((k) => !matches(k));
  if (off.length) {
    return `This file was selected/named as ${expected}, but rows were imported as ${off.join(', ')}. Check the carrier before using this upload.`;
  }
  return null;
}

module.exports = {
  BSI_LAYOUTS,
  detectBsiLayoutFromHeaders,
  detectBsiWorkbookLayout,
  expectedCarrier,
  layoutCarrier,
  carrierKey,
  carrierMismatchWarning,
};
