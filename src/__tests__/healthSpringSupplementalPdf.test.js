'use strict';

const fs = require('fs');
const path = require('path');
const {
  looksLikeHealthSpringSupplementalText,
  isHealthSpringSupplementalFilename,
  parseHealthSpringSupplementalText,
  tryParseHealthSpringSupplementalUpload,
} = require('../healthSpringSupplementalPdf');
const { looksLikeAgentViewText } = require('../agentViewCommissionReport');
const { findIncomingDuplicates, uhcTransactionKey, crossFileDuplicateKey } = require('../uhcUad');

const FIX = path.join(__dirname, 'fixtures');
const AUG_TXT = path.join(FIX, 'healthspring-supp-20260815.txt');
const SEP_TXT = path.join(FIX, 'healthspring-supp-20260912.txt');
const OCT_TXT = path.join(FIX, 'healthspring-supp-20261010.txt');
const OCT_PDF = path.join(FIX, 'healthspring-supp-20261010.pdf');

function load(file) {
  return fs.readFileSync(file, 'utf8');
}

function parseFile(txt, name) {
  return parseHealthSpringSupplementalText(load(txt), name);
}

describe('HealthSpring Supplemental Benefits PDF', () => {
  test('sniffs supplemental PDFs and does not match AgentView', () => {
    expect(isHealthSpringSupplementalFilename('HealthSpring_Supplemental_Oct.pdf')).toBe(true);
    expect(isHealthSpringSupplementalFilename('AgentCommissionReport.pdf')).toBe(false);
    const text = load(OCT_TXT);
    expect(looksLikeHealthSpringSupplementalText(text)).toBe(true);
    expect(looksLikeAgentViewText(text)).toBe(false);
  });

  test.each([
    ['Aug 15', AUG_TXT, 'healthspring-supp-20260815.pdf', '202608', '08/15/2026', '09/01/2026'],
    ['Sep 12', SEP_TXT, 'healthspring-supp-20260912.pdf', '202609', '09/12/2026', '10/01/2026'],
    ['Oct 10', OCT_TXT, 'healthspring-supp-20261010.pdf', '202610', '10/10/2026', '11/01/2026'],
  ])('%s: 2 Mushkin rows totaling $111.45', (_label, txt, name, period, statementDate, paidTo) => {
    const rows = parseFile(txt, name);
    expect(rows).toHaveLength(2);
    const total = Math.round(rows.reduce((s, r) => s + r.commission, 0) * 100) / 100;
    expect(total).toBeCloseTo(111.45, 2);
    expect(rows.reconciliation.ok).toBe(true);
    expect(rows.reconciliation.expectedTotal).toBeCloseTo(111.45, 2);

    const silvia = rows.find((r) => r.policyNumber === '60Y0436424');
    const julius = rows.find((r) => r.policyNumber === '60Y0436880');
    expect(silvia).toMatchObject({
      client: 'Silvia Mushkin',
      commission: 55.59,
      carrier: 'HealthSpring',
      lob: 'Med Supp',
      agent: 'Yahoska Perez',
      period,
      statementDate,
      paidToDate: paidTo,
      classification: 'New Business',
    });
    expect(julius).toMatchObject({
      client: 'Julius Mushkin',
      commission: 55.86,
      period,
      statementDate,
      paidToDate: paidTo,
    });
  });

  test('same policy+amount in different statement months are not duplicates', () => {
    const aug = parseFile(AUG_TXT, 'aug.pdf');
    const sep = parseFile(SEP_TXT, 'sep.pdf');
    const oct = parseFile(OCT_TXT, 'oct.pdf');
    expect(findIncomingDuplicates(aug, sep)).toHaveLength(0);
    expect(findIncomingDuplicates(sep, oct)).toHaveLength(0);
    expect(uhcTransactionKey(aug[0])).not.toBe(uhcTransactionKey(sep[0]));
    expect(crossFileDuplicateKey(aug[0])).not.toBe(crossFileDuplicateKey(oct[0]));
  });

  test('tryParse on live upload path sniffs portal filenames', async () => {
    const text = load(OCT_TXT);
    const fakePdfParse = async () => ({ text });
    const rows = await tryParseHealthSpringSupplementalUpload(
      OCT_PDF,
      '01M70M2EAX1HWB8TTT82XS2MM8.pdf',
      fakePdfParse
    );
    expect(rows).not.toBeNull();
    expect(rows).toHaveLength(2);
    expect(rows.reduce((s, r) => s + r.commission, 0)).toBeCloseTo(111.45, 2);
  });
});
