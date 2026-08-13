#!/usr/bin/env node
'use strict';

/**
 * Compare BSI→THE remittance (Commission Statements tab) vs THEI expectation
 * from BSI Statements feeds (thei_share).
 *
 *   node scripts/compare-thei-remittance-vs-bsi-feed.js
 *   node scripts/compare-thei-remittance-vs-bsi-feed.js --out exports/thei-remittance-vs-bsi-feed
 *
 * Paid   = remittance commission (already THEI's half)
 * Expected = thei_share on category=bsi_statement rows
 * Delta  = paid − expected  (<0 means possible underpayment vs feeds)
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const ExcelJS = require('exceljs');

const DEFAULT_OUT = '/workspace/exports/thei-remittance-vs-bsi-feed';
const PERIODS = ['202603', '202604', '202605', '202606', '202607'];

function outDirFromArgs() {
  const i = process.argv.indexOf('--out');
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  return DEFAULT_OUT;
}

function normPol(x) {
  return String(x || '')
    .replace(/[\s\-]/g, '')
    .toUpperCase();
}
function round2(n) {
  return Math.round(Number(n || 0) * 100) / 100;
}
function carrierKey(c) {
  const u = String(c || '').toUpperCase();
  if (u.includes('UNITED') || u === 'UHC') return 'UHC';
  if (u.includes('HUMANA')) return 'HUMANA';
  if (u.includes('AETNA')) return 'AETNA';
  if (u.includes('DEVOTED')) return 'DEVOTED';
  return u.slice(0, 20) || 'OTHER';
}
function classBucket(classification) {
  const c = String(classification || '').toLowerCase();
  if (c.includes('override')) return 'OV';
  if (c.includes('charge')) return 'CB';
  if (c.includes('renew')) return 'RN';
  if (c.includes('new')) return 'NB';
  return 'OT';
}
function lineKey(row) {
  return [
    row.payment_period,
    carrierKey(row.carrier),
    normPol(row.policy_number),
    classBucket(row.classification),
  ].join('|');
}

async function main() {
  const outDir = outDirFromArgs();
  fs.mkdirSync(outDir, { recursive: true });

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  try {
    const remUploads = (
      await pool.query(`
        SELECT id, original_name FROM uploads
        WHERE original_name ILIKE '%T.H.E%'
           OR original_name ILIKE '%thei_statement_BSI%'
           OR original_name ILIKE '%THE_STATEMENTS%'
           OR original_name ILIKE '%Medicare Statement%THE%'
           OR original_name ILIKE '%Medicare_Statement%THE%'
           OR original_name ILIKE '%Statement-health experts%'
           OR original_name ILIKE '%Statement-health_experts%'
           OR original_name ILIKE '%Health_Experts-March%'
           OR original_name ILIKE '%Health Experts-March%'
        ORDER BY id
      `)
    ).rows;
    const remIds = remUploads.map((r) => r.id);
    if (!remIds.length) {
      console.error('No BSI→THE remittance uploads found.');
      process.exit(1);
    }

    const rem = await pool.query(
      `SELECT id, payment_period, agent_name, carrier, policy_number, client_full_name,
              classification, commission
       FROM commission_records
       WHERE upload_id = ANY($1::int[]) AND payment_period = ANY($2::text[])`,
      [remIds, PERIODS]
    );

    const exp = await pool.query(
      `SELECT cr.id, cr.payment_period, cr.agent_name, cr.carrier, cr.policy_number,
              cr.client_full_name, cr.classification, cr.thei_share
       FROM commission_records cr
       JOIN uploads u ON u.id = cr.upload_id
       WHERE u.category = 'bsi_statement'
         AND cr.payment_period = ANY($1::text[])
         AND COALESCE(cr.thei_share,0) <> 0`,
      [PERIODS]
    );

    const paidMap = new Map();
    for (const r of rem.rows) {
      const k = lineKey(r);
      const cur = paidMap.get(k) || { ...r, amount: 0, n: 0 };
      cur.amount = round2(cur.amount + Number(r.commission || 0));
      cur.n += 1;
      paidMap.set(k, cur);
    }
    const expMap = new Map();
    for (const r of exp.rows) {
      const k = lineKey(r);
      const cur = expMap.get(k) || { ...r, amount: 0, n: 0 };
      cur.amount = round2(cur.amount + Number(r.thei_share || 0));
      cur.n += 1;
      expMap.set(k, cur);
    }

    const summary = {};
    for (const period of PERIODS) {
      summary[period] = {
        paid: 0,
        expected: 0,
        matchCount: 0,
        mismatchCount: 0,
        mismatchDelta: 0,
        onlyPaid: 0,
        onlyPaidCount: 0,
        onlyExpected: 0,
        onlyExpectedCount: 0,
      };
    }

    const lines = [];
    for (const k of new Set([...paidMap.keys(), ...expMap.keys()])) {
      const paid = paidMap.get(k);
      const expected = expMap.get(k);
      const period = (paid || expected).payment_period;
      const paidAmt = paid ? round2(paid.amount) : 0;
      const expAmt = expected ? round2(expected.amount) : 0;
      const delta = round2(paidAmt - expAmt);
      let status;
      const s = summary[period];
      if (paid && expected) {
        if (Math.abs(delta) < 0.02) {
          status = 'MATCH';
          s.matchCount += 1;
        } else {
          status = 'AMOUNT_MISMATCH';
          s.mismatchCount += 1;
          s.mismatchDelta = round2(s.mismatchDelta + delta);
        }
      } else if (paid) {
        status = 'PAID_NOT_IN_BSI_FEED';
        s.onlyPaidCount += 1;
        s.onlyPaid = round2(s.onlyPaid + paidAmt);
      } else {
        status = 'EXPECTED_NOT_PAID';
        s.onlyExpectedCount += 1;
        s.onlyExpected = round2(s.onlyExpected + expAmt);
      }
      s.paid = round2(s.paid + paidAmt);
      s.expected = round2(s.expected + expAmt);
      lines.push({
        period,
        status,
        carrier: carrierKey((paid || expected).carrier),
        policy: (paid || expected).policy_number,
        client: (paid || expected).client_full_name,
        agent: (paid || expected).agent_name,
        classification: (paid || expected).classification,
        paid_thei: paidAmt,
        expected_thei: expAmt,
        delta,
      });
    }

    const wb = new ExcelJS.Workbook();
    const sumSheet = wb.addWorksheet('Summary');
    sumSheet.columns = [
      { header: 'Period', key: 'period', width: 10 },
      { header: 'Remittance paid (THEI half)', key: 'paid', width: 22 },
      { header: 'Expected from BSI feeds', key: 'expected', width: 20 },
      { header: 'Delta paid−expected', key: 'delta', width: 16 },
      { header: 'Matches', key: 'matches', width: 10 },
      { header: 'Amount mismatches', key: 'mismatches', width: 14 },
      { header: 'Paid only $', key: 'onlyPaid', width: 12 },
      { header: 'Paid only #', key: 'onlyPaidN', width: 10 },
      { header: 'Expected unpaid $', key: 'onlyExp', width: 14 },
      { header: 'Expected unpaid #', key: 'onlyExpN', width: 14 },
      { header: 'Verdict', key: 'verdict', width: 56 },
    ];
    sumSheet.getRow(1).font = { bold: true };

    console.log('\n=== THEI remittance vs BSI Statements feed ===\n');
    for (const period of PERIODS) {
      const s = summary[period];
      const delta = round2(s.paid - s.expected);
      let verdict;
      if (delta < -1) verdict = 'UNDER — remittance less than BSI-feed thei_share';
      else if (delta > 1) verdict = 'OVER — remittance more than BSI-feed thei_share';
      else verdict = 'TOTALS CLOSE — still check line gaps';
      console.log(
        `${period}  paid=$${s.paid.toFixed(2)}  expected=$${s.expected.toFixed(2)}  delta=$${delta.toFixed(2)}  → ${verdict}`
      );
      console.log(
        `         match=${s.matchCount} mismatch=${s.mismatchCount} paidOnly=${s.onlyPaidCount}/$${s.onlyPaid} unpaidExpected=${s.onlyExpectedCount}/$${s.onlyExpected}`
      );
      sumSheet.addRow({
        period,
        paid: s.paid,
        expected: s.expected,
        delta,
        matches: s.matchCount,
        mismatches: s.mismatchCount,
        onlyPaid: s.onlyPaid,
        onlyPaidN: s.onlyPaidCount,
        onlyExp: s.onlyExpected,
        onlyExpN: s.onlyExpectedCount,
        verdict,
      });
    }
    ['B', 'C', 'D', 'G', 'I'].forEach((c) => {
      sumSheet.getColumn(c).numFmt = '$#,##0.00;($#,##0.00)';
    });

    const detail = wb.addWorksheet('Line Compare');
    detail.columns = [
      { header: 'Period', key: 'period', width: 10 },
      { header: 'Status', key: 'status', width: 22 },
      { header: 'Carrier', key: 'carrier', width: 10 },
      { header: 'Policy', key: 'policy', width: 18 },
      { header: 'Client', key: 'client', width: 28 },
      { header: 'Agent', key: 'agent', width: 24 },
      { header: 'Class', key: 'classification', width: 16 },
      { header: 'Paid (remittance)', key: 'paid_thei', width: 14 },
      { header: 'Expected (BSI feed)', key: 'expected_thei', width: 16 },
      { header: 'Delta', key: 'delta', width: 12 },
    ];
    detail.getRow(1).font = { bold: true };
    lines.sort(
      (a, b) =>
        a.period.localeCompare(b.period) ||
        a.status.localeCompare(b.status) ||
        Math.abs(b.delta) - Math.abs(a.delta)
    );
    for (const l of lines) detail.addRow(l);
    ['H', 'I', 'J'].forEach((c) => {
      detail.getColumn(c).numFmt = '$#,##0.00;($#,##0.00)';
    });

    const note = wb.addWorksheet('How to read');
    note.getColumn(1).width = 110;
    note.getCell('A1').value =
      'BSI→THE remittance (Commission Statements) vs BSI Statements thei_share';
    note.getCell('A1').font = { bold: true, size: 13 };
    note.getCell('A3').value =
      'PAID = remittance commission (already THEI half) from: ' +
      remUploads.map((u) => u.original_name).join(', ');
    note.getCell('A4').value =
      'EXPECTED = thei_share on Uploads → BSI Statements for same period/policy/class.';
    note.getCell('A5').value =
      'EXPECTED_NOT_PAID = BSI feed implies THEI dollars with no remittance line (possible missing money).';
    note.getCell('A6').value =
      'PAID_NOT_IN_BSI_FEED = remittance with no matching BSI-statement share (other book, true-up, or missing feed).';
    note.getCell('A7').value =
      'Line matching is messy (pro-rates / class differences) — use Summary totals first, then unpaid expected lines.';

    const outPath = path.join(outDir, 'THEI_Remittance_vs_BSI_Feed_Mar-Jul_2026.xlsx');
    await wb.xlsx.writeFile(outPath);
    console.log(`\nWrote ${outPath}`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
