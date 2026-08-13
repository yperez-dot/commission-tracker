#!/usr/bin/env node
'use strict';

/**
 * Cross-tag BSI-paid-vs-OliComm SHORT lines with Agency Override Recon status.
 *
 * So audit/chase items already tracked in Agency OV Recon are labeled separately
 * from unexplained new gaps.
 *
 *   node scripts/tag-short-lines-with-agency-ov-recon.js
 *   node scripts/tag-short-lines-with-agency-ov-recon.js --out exports/thei-remittance-vs-bsi-feed
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const ExcelJS = require('exceljs');

const PERIODS = ['202603', '202604', '202605', '202606', '202607'];
const DEFAULT_OUT = '/workspace/exports/thei-remittance-vs-bsi-feed';
const ART = '/opt/cursor/artifacts';

function outDirFromArgs() {
  const i = process.argv.indexOf('--out');
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  return DEFAULT_OUT;
}

function round2(n) {
  return Math.round(Number(n || 0) * 100) / 100;
}
function normPol(x) {
  return String(x || '')
    .replace(/[\s\-]/g, '')
    .toUpperCase();
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
function monthLabel(p) {
  const m = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${m[parseInt(p.slice(4), 10)]} ${p.slice(0, 4)}`;
}

/** Mirror routes/agencyproduction.js normReconClient / normReconCarrier (JS side). */
function normClient(name) {
  if (!name) return '';
  const s = String(name).trim();
  if (s.includes(',')) {
    const [last, firstRaw] = s.split(',').map((p) => p.trim());
    const first = firstRaw.replace(/(\s+[A-Za-z]\.?)+$/i, '').trim();
    return `${first} ${last}`.toLowerCase().replace(/\s+/g, ' ').trim();
  }
  return s
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/\s+[a-z]\.?$/i, '')
    .trim();
}
function normCarrier(carrier) {
  const c = String(carrier || '').toLowerCase().trim();
  if (c.includes('humana')) return 'humana';
  if (c.includes('aetna')) return 'aetna';
  if (c.includes('uhc') || c.includes('united')) return 'unitedhealthcare';
  if (c.includes('doctors')) return 'doctors';
  if (c.includes('devoted')) return 'devoted';
  if (c.includes('solis')) return 'solis';
  if (c.includes('healthsun') || c.includes('health sun')) return 'healthsun';
  if (c.includes('freedom')) return 'freedom';
  return c;
}

function gapBucket(reconStatus) {
  if (!reconStatus || reconStatus === 'not_in_agency_prod') return 'NOT_IN_AGENCY_PROD';
  if (reconStatus === 'request_audit' || reconStatus === 'chase_bsi') return 'AUDIT_OR_CHASE';
  if (reconStatus === 'held_licensing') return 'HELD_LICENSING';
  if (reconStatus === 'no_pay_expected') return 'NO_PAY_EXPECTED';
  if (reconStatus === 'paid') return 'RECON_SAYS_PAID';
  if (reconStatus === 'pending') return 'PENDING_NO_CARRIER_UPLOAD';
  return 'OTHER';
}

function bucketNote(bucket) {
  switch (bucket) {
    case 'AUDIT_OR_CHASE':
      return 'Already on Agency OV Recon as Request Audit / Chase BSI — expected short until BSI pays';
    case 'HELD_LICENSING':
      return 'Held for licensing — not expected to pay yet';
    case 'NO_PAY_EXPECTED':
      return 'Cancelled/withdrawn/denied — no pay expected';
    case 'RECON_SAYS_PAID':
      return 'Recon shows paid (Leg2 remittance match) but this period still short — timing/class/pro-rate';
    case 'PENDING_NO_CARRIER_UPLOAD':
      return 'No carrier→BSI upload coverage yet in Recon';
    case 'NOT_IN_AGENCY_PROD':
      return 'Client+carrier not on Hector agency production — peel/house/other book';
    default:
      return '';
  }
}

async function loadShortLines(pool) {
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

  const rem = await pool.query(
    `SELECT payment_period, agent_name, carrier, policy_number, client_full_name,
            classification, commission
     FROM commission_records
     WHERE upload_id = ANY($1::int[]) AND payment_period = ANY($2::text[])`,
    [remUploads.map((r) => r.id), PERIODS]
  );

  const exp = await pool.query(
    `SELECT cr.payment_period, cr.agent_name, cr.carrier, cr.policy_number,
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
    const cur = paidMap.get(k) || { ...r, amount: 0 };
    cur.amount = round2(cur.amount + Number(r.commission || 0));
    paidMap.set(k, cur);
  }
  const expMap = new Map();
  for (const r of exp.rows) {
    const k = lineKey(r);
    const cur = expMap.get(k) || { ...r, amount: 0 };
    cur.amount = round2(cur.amount + Number(r.thei_share || 0));
    expMap.set(k, cur);
  }

  const shorts = [];
  for (const k of new Set([...paidMap.keys(), ...expMap.keys()])) {
    const paid = paidMap.get(k);
    const expected = expMap.get(k);
    const paidAmt = paid ? round2(paid.amount) : 0;
    const expAmt = expected ? round2(expected.amount) : 0;
    const delta = round2(paidAmt - expAmt);
    const shortToThei = round2(expAmt - paidAmt);
    if (shortToThei <= 0.01) continue;

    let status;
    if (paid && expected) status = 'AMOUNT_MISMATCH';
    else if (!paid && expected) status = 'OLICOMM_NOT_IN_BSI_PAY';
    else continue;

    const src = paid || expected;
    shorts.push({
      period: src.payment_period,
      month: monthLabel(src.payment_period),
      status,
      carrier: carrierKey(src.carrier),
      policy: src.policy_number,
      client: src.client_full_name,
      agent: src.agent_name,
      classification: src.classification,
      bsi_paid: paidAmt,
      olicomm_expected: expAmt,
      delta,
      short_to_thei: shortToThei,
      nc: normClient(src.client_full_name),
      ncarr: normCarrier(src.carrier),
      npol: normPol(src.policy_number),
    });
  }
  return { shorts, remUploads };
}

async function loadAgencyReconIndex(pool) {
  // Same three-way status as /api/agency-production/reconcile (includes Alba for tagging)
  const { rows } = await pool.query(`
    WITH
    leg2 AS (
      SELECT id, commission, payment_period, nc, ncarr FROM (
        SELECT cr.id, cr.commission, cr.payment_period,
          CASE
            WHEN cr.client_full_name LIKE '%,%'
            THEN TRIM(REGEXP_REPLACE(LOWER(TRIM(SPLIT_PART(cr.client_full_name, ',', 2))), '(\\s+[a-z]\\.?)+$', ''))
                 || ' ' || LOWER(TRIM(SPLIT_PART(cr.client_full_name, ',', 1)))
            ELSE TRIM(REGEXP_REPLACE(LOWER(TRIM(REGEXP_REPLACE(COALESCE(cr.client_full_name,''), '\\s+', ' ', 'g'))), '\\s+[a-z]\\.?$', ''))
          END AS nc,
          CASE
            WHEN LOWER(cr.carrier) LIKE '%humana%' THEN 'humana'
            WHEN LOWER(cr.carrier) LIKE '%aetna%' THEN 'aetna'
            WHEN LOWER(cr.carrier) LIKE '%uhc%' OR LOWER(cr.carrier) LIKE '%united%' THEN 'unitedhealthcare'
            WHEN LOWER(cr.carrier) LIKE '%devoted%' THEN 'devoted'
            ELSE LOWER(TRIM(cr.carrier))
          END AS ncarr,
          ROW_NUMBER() OVER (
            PARTITION BY
              CASE
                WHEN cr.client_full_name LIKE '%,%'
                THEN TRIM(REGEXP_REPLACE(LOWER(TRIM(SPLIT_PART(cr.client_full_name, ',', 2))), '(\\s+[a-z]\\.?)+$', ''))
                     || ' ' || LOWER(TRIM(SPLIT_PART(cr.client_full_name, ',', 1)))
                ELSE TRIM(REGEXP_REPLACE(LOWER(TRIM(REGEXP_REPLACE(COALESCE(cr.client_full_name,''), '\\s+', ' ', 'g'))), '\\s+[a-z]\\.?$', ''))
              END,
              CASE
                WHEN LOWER(cr.carrier) LIKE '%humana%' THEN 'humana'
                WHEN LOWER(cr.carrier) LIKE '%aetna%' THEN 'aetna'
                WHEN LOWER(cr.carrier) LIKE '%uhc%' OR LOWER(cr.carrier) LIKE '%united%' THEN 'unitedhealthcare'
                WHEN LOWER(cr.carrier) LIKE '%devoted%' THEN 'devoted'
                ELSE LOWER(TRIM(cr.carrier))
              END
            ORDER BY cr.id DESC
          ) AS rn
        FROM commission_records cr
        JOIN uploads u ON cr.upload_id = u.id
        WHERE (u.category IS NULL OR u.category = 'commission_statement')
          AND cr.payee IN ('BSI','NHP','THE')
          AND cr.client_full_name IS NOT NULL AND TRIM(cr.client_full_name) <> ''
      ) sub WHERE rn = 1
    ),
    leg3 AS (
      SELECT id, commission, classification, hold_reason, nc, ncarr FROM (
        SELECT cr.id, cr.commission, cr.classification,
          cr.raw_data::jsonb->>'Hold Reason' AS hold_reason,
          CASE
            WHEN cr.client_full_name LIKE '%,%'
            THEN TRIM(REGEXP_REPLACE(LOWER(TRIM(SPLIT_PART(cr.client_full_name, ',', 2))), '(\\s+[a-z]\\.?)+$', ''))
                 || ' ' || LOWER(TRIM(SPLIT_PART(cr.client_full_name, ',', 1)))
            ELSE TRIM(REGEXP_REPLACE(LOWER(TRIM(REGEXP_REPLACE(COALESCE(cr.client_full_name,''), '\\s+', ' ', 'g'))), '\\s+[a-z]\\.?$', ''))
          END AS nc,
          CASE
            WHEN LOWER(cr.carrier) LIKE '%humana%' THEN 'humana'
            WHEN LOWER(cr.carrier) LIKE '%aetna%' THEN 'aetna'
            WHEN LOWER(cr.carrier) LIKE '%uhc%' OR LOWER(cr.carrier) LIKE '%united%' THEN 'unitedhealthcare'
            WHEN LOWER(cr.carrier) LIKE '%devoted%' THEN 'devoted'
            ELSE LOWER(TRIM(cr.carrier))
          END AS ncarr,
          ROW_NUMBER() OVER (
            PARTITION BY
              CASE
                WHEN cr.client_full_name LIKE '%,%'
                THEN TRIM(REGEXP_REPLACE(LOWER(TRIM(SPLIT_PART(cr.client_full_name, ',', 2))), '(\\s+[a-z]\\.?)+$', ''))
                     || ' ' || LOWER(TRIM(SPLIT_PART(cr.client_full_name, ',', 1)))
                ELSE TRIM(REGEXP_REPLACE(LOWER(TRIM(REGEXP_REPLACE(COALESCE(cr.client_full_name,''), '\\s+', ' ', 'g'))), '\\s+[a-z]\\.?$', ''))
              END,
              CASE
                WHEN LOWER(cr.carrier) LIKE '%humana%' THEN 'humana'
                WHEN LOWER(cr.carrier) LIKE '%aetna%' THEN 'aetna'
                WHEN LOWER(cr.carrier) LIKE '%uhc%' OR LOWER(cr.carrier) LIKE '%united%' THEN 'unitedhealthcare'
                WHEN LOWER(cr.carrier) LIKE '%devoted%' THEN 'devoted'
                ELSE LOWER(TRIM(cr.carrier))
              END
            ORDER BY cr.id DESC
          ) AS rn
        FROM commission_records cr
        JOIN uploads u ON cr.upload_id = u.id
        WHERE u.category = 'bsi_statement'
          AND cr.client_full_name IS NOT NULL AND TRIM(cr.client_full_name) <> ''
      ) sub WHERE rn = 1
    ),
    carrier_has_uploads AS (
      SELECT DISTINCT
        CASE
          WHEN LOWER(TRIM(cv.c)) LIKE '%humana%' THEN 'humana'
          WHEN LOWER(TRIM(cv.c)) LIKE '%aetna%' THEN 'aetna'
          WHEN LOWER(TRIM(cv.c)) LIKE '%uhc%' OR LOWER(TRIM(cv.c)) LIKE '%united%' THEN 'unitedhealthcare'
          WHEN LOWER(TRIM(cv.c)) LIKE '%devoted%' THEN 'devoted'
          ELSE LOWER(TRIM(cv.c))
        END AS ncarr
      FROM (
        SELECT TRIM(unnest(STRING_TO_ARRAY(u.carrier, ','))) AS c
        FROM uploads u
        WHERE u.category = 'bsi_statement' AND u.carrier IS NOT NULL AND TRIM(u.carrier) <> ''
      ) cv
      WHERE TRIM(cv.c) <> ''
    )
    SELECT
      ap.id AS production_id,
      ap.agent_name AS production_agent,
      ap.client_name,
      ap.carrier AS production_carrier,
      ap.policy_number AS production_policy,
      ap.effective_date,
      ap.status AS production_status,
      ap.manual_override_status,
      CASE
        WHEN ap.client_name LIKE '%,%'
        THEN TRIM(REGEXP_REPLACE(LOWER(TRIM(SPLIT_PART(ap.client_name, ',', 2))), '(\\s+[a-z]\\.?)+$', ''))
             || ' ' || LOWER(TRIM(SPLIT_PART(ap.client_name, ',', 1)))
        ELSE TRIM(REGEXP_REPLACE(LOWER(TRIM(REGEXP_REPLACE(COALESCE(ap.client_name,''), '\\s+', ' ', 'g'))), '\\s+[a-z]\\.?$', ''))
      END AS nc,
      CASE
        WHEN LOWER(ap.carrier) LIKE '%humana%' THEN 'humana'
        WHEN LOWER(ap.carrier) LIKE '%aetna%' THEN 'aetna'
        WHEN LOWER(ap.carrier) LIKE '%uhc%' OR LOWER(ap.carrier) LIKE '%united%' THEN 'unitedhealthcare'
        WHEN LOWER(ap.carrier) LIKE '%devoted%' THEN 'devoted'
        ELSE LOWER(TRIM(ap.carrier))
      END AS ncarr,
      REGEXP_REPLACE(UPPER(COALESCE(ap.policy_number,'')), '[\\s\\-]', '', 'g') AS npol,
      COALESCE(
        NULLIF(TRIM(COALESCE(ap.manual_override_status, '')), ''),
        CASE
          WHEN l2.id IS NOT NULL THEN 'paid'
          WHEN UPPER(TRIM(ap.status)) IN ('WITHDRAWN','IN PROGRESS','CANCELLED','DENIED') THEN 'no_pay_expected'
          WHEN l3.id IS NOT NULL AND COALESCE(l3.commission,0) > 0 THEN 'chase_bsi'
          WHEN l3.id IS NOT NULL
           AND l3.classification = 'Held'
           AND (l3.hold_reason ILIKE '%not licensed%' OR l3.hold_reason ILIKE '%not appointed%')
            THEN 'held_licensing'
          WHEN l3.id IS NOT NULL THEN 'request_audit'
          WHEN chu.ncarr IS NOT NULL THEN 'request_audit'
          ELSE 'pending'
        END
      ) AS recon_status,
      (ap.manual_override_status IS NOT NULL AND TRIM(ap.manual_override_status) <> '') AS manual_pinned
    FROM agency_production ap
    LEFT JOIN leg2 l2 ON
      CASE
        WHEN ap.client_name LIKE '%,%'
        THEN TRIM(REGEXP_REPLACE(LOWER(TRIM(SPLIT_PART(ap.client_name, ',', 2))), '(\\s+[a-z]\\.?)+$', ''))
             || ' ' || LOWER(TRIM(SPLIT_PART(ap.client_name, ',', 1)))
        ELSE TRIM(REGEXP_REPLACE(LOWER(TRIM(REGEXP_REPLACE(COALESCE(ap.client_name,''), '\\s+', ' ', 'g'))), '\\s+[a-z]\\.?$', ''))
      END = l2.nc
      AND CASE
        WHEN LOWER(ap.carrier) LIKE '%humana%' THEN 'humana'
        WHEN LOWER(ap.carrier) LIKE '%aetna%' THEN 'aetna'
        WHEN LOWER(ap.carrier) LIKE '%uhc%' OR LOWER(ap.carrier) LIKE '%united%' THEN 'unitedhealthcare'
        WHEN LOWER(ap.carrier) LIKE '%devoted%' THEN 'devoted'
        ELSE LOWER(TRIM(ap.carrier))
      END = l2.ncarr
    LEFT JOIN leg3 l3 ON
      CASE
        WHEN ap.client_name LIKE '%,%'
        THEN TRIM(REGEXP_REPLACE(LOWER(TRIM(SPLIT_PART(ap.client_name, ',', 2))), '(\\s+[a-z]\\.?)+$', ''))
             || ' ' || LOWER(TRIM(SPLIT_PART(ap.client_name, ',', 1)))
        ELSE TRIM(REGEXP_REPLACE(LOWER(TRIM(REGEXP_REPLACE(COALESCE(ap.client_name,''), '\\s+', ' ', 'g'))), '\\s+[a-z]\\.?$', ''))
      END = l3.nc
      AND CASE
        WHEN LOWER(ap.carrier) LIKE '%humana%' THEN 'humana'
        WHEN LOWER(ap.carrier) LIKE '%aetna%' THEN 'aetna'
        WHEN LOWER(ap.carrier) LIKE '%uhc%' OR LOWER(ap.carrier) LIKE '%united%' THEN 'unitedhealthcare'
        WHEN LOWER(ap.carrier) LIKE '%devoted%' THEN 'devoted'
        ELSE LOWER(TRIM(ap.carrier))
      END = l3.ncarr
    LEFT JOIN carrier_has_uploads chu ON
      CASE
        WHEN LOWER(ap.carrier) LIKE '%humana%' THEN 'humana'
        WHEN LOWER(ap.carrier) LIKE '%aetna%' THEN 'aetna'
        WHEN LOWER(ap.carrier) LIKE '%uhc%' OR LOWER(ap.carrier) LIKE '%united%' THEN 'unitedhealthcare'
        WHEN LOWER(ap.carrier) LIKE '%devoted%' THEN 'devoted'
        ELSE LOWER(TRIM(ap.carrier))
      END = chu.ncarr
  `);

  const byClientCarrier = new Map();
  const byPolicyCarrier = new Map();
  for (const r of rows) {
    const cc = `${r.nc}|${r.ncarr}`;
    if (!byClientCarrier.has(cc)) byClientCarrier.set(cc, []);
    byClientCarrier.get(cc).push(r);
    if (r.npol) {
      const pk = `${r.npol}|${r.ncarr}`;
      if (!byPolicyCarrier.has(pk)) byPolicyCarrier.set(pk, []);
      byPolicyCarrier.get(pk).push(r);
    }
  }
  return { byClientCarrier, byPolicyCarrier, rows };
}

function pickMatch(short, index) {
  if (short.npol) {
    const byPol = index.byPolicyCarrier.get(`${short.npol}|${short.ncarr}`);
    if (byPol && byPol.length) return byPol[0];
  }
  const byCc = index.byClientCarrier.get(`${short.nc}|${short.ncarr}`);
  if (byCc && byCc.length) return byCc[0];
  return null;
}

async function main() {
  const outDir = outDirFromArgs();
  fs.mkdirSync(outDir, { recursive: true });
  fs.mkdirSync(ART, { recursive: true });

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  try {
    const { shorts, remUploads } = await loadShortLines(pool);
    const index = await loadAgencyReconIndex(pool);

    const tagged = shorts.map((s) => {
      const m = pickMatch(s, index);
      const reconStatus = m ? m.recon_status : 'not_in_agency_prod';
      const bucket = gapBucket(reconStatus);
      return {
        ...s,
        recon_status: reconStatus,
        gap_bucket: bucket,
        gap_note: bucketNote(bucket),
        production_id: m ? m.production_id : null,
        production_agent: m ? m.production_agent : null,
        production_status: m ? m.production_status : null,
        manual_pinned: m ? !!m.manual_pinned : false,
        match_how: m
          ? s.npol && m.npol === s.npol
            ? 'policy+carrier'
            : 'client+carrier'
          : 'none',
      };
    });

    tagged.sort(
      (a, b) =>
        a.gap_bucket.localeCompare(b.gap_bucket) ||
        b.short_to_thei - a.short_to_thei ||
        a.period.localeCompare(b.period)
    );

    const byBucket = {};
    for (const t of tagged) {
      if (!byBucket[t.gap_bucket]) byBucket[t.gap_bucket] = { bucket: t.gap_bucket, n: 0, short: 0 };
      byBucket[t.gap_bucket].n += 1;
      byBucket[t.gap_bucket].short = round2(byBucket[t.gap_bucket].short + t.short_to_thei);
    }

    const wb = new ExcelJS.Workbook();
    wb.creator = 'OliComm';

    const sum = wb.addWorksheet('Gap Buckets');
    sum.getColumn(1).width = 28;
    sum.getColumn(2).width = 10;
    sum.getColumn(3).width = 14;
    sum.getColumn(4).width = 80;
    sum.mergeCells('A1:D1');
    sum.getCell('A1').value =
      'Short lines tagged with Agency Override Recon status (Mar–Jul 2026)';
    sum.getCell('A1').font = { bold: true, size: 13 };
    sum.getCell('A3').value = 'Gap bucket';
    sum.getCell('B3').value = 'Lines';
    sum.getCell('C3').value = 'Short $';
    sum.getCell('D3').value = 'Meaning';
    ['A3', 'B3', 'C3', 'D3'].forEach((c) => {
      sum.getCell(c).font = { bold: true };
      sum.getCell(c).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFF1F5F9' },
      };
    });

    const bucketOrder = [
      'AUDIT_OR_CHASE',
      'HELD_LICENSING',
      'NO_PAY_EXPECTED',
      'RECON_SAYS_PAID',
      'PENDING_NO_CARRIER_UPLOAD',
      'NOT_IN_AGENCY_PROD',
      'OTHER',
    ];
    let r = 4;
    let totalShort = 0;
    let totalN = 0;
    for (const b of bucketOrder) {
      const row = byBucket[b];
      if (!row) continue;
      sum.getCell(`A${r}`).value = b;
      sum.getCell(`B${r}`).value = row.n;
      sum.getCell(`C${r}`).value = row.short;
      sum.getCell(`C${r}`).numFmt = '$#,##0.00;($#,##0.00)';
      sum.getCell(`D${r}`).value = bucketNote(b);
      if (b === 'AUDIT_OR_CHASE') {
        sum.getCell(`A${r}`).font = { color: { argb: 'FF856404' }, bold: true };
      }
      if (b === 'NOT_IN_AGENCY_PROD') {
        sum.getCell(`A${r}`).font = { color: { argb: 'FFB91C1C' }, bold: true };
      }
      totalShort = round2(totalShort + row.short);
      totalN += row.n;
      r += 1;
    }
    sum.getCell(`A${r}`).value = 'TOTAL SHORT LINES';
    sum.getCell(`A${r}`).font = { bold: true };
    sum.getCell(`B${r}`).value = totalN;
    sum.getCell(`C${r}`).value = totalShort;
    sum.getCell(`C${r}`).numFmt = '$#,##0.00;($#,##0.00)';
    sum.getCell(`C${r}`).font = { bold: true };

    r += 2;
    sum.getCell(`A${r}`).value =
      'Focus: AUDIT_OR_CHASE = already tracked for BSI audit/chase. NOT_IN_AGENCY_PROD / unexplained = review next.';
    sum.getCell(`A${r}`).font = { color: { argb: 'FF64748B' } };

    const det = wb.addWorksheet('Short + Recon Status');
    det.columns = [
      { header: 'Gap Bucket', key: 'gap_bucket', width: 24 },
      { header: 'Recon Status', key: 'recon_status', width: 16 },
      { header: 'Manual Pin', key: 'manual_pinned', width: 10 },
      { header: 'Month', key: 'month', width: 10 },
      { header: 'Carrier', key: 'carrier', width: 10 },
      { header: 'Policy #', key: 'policy', width: 18 },
      { header: 'Client', key: 'client', width: 28 },
      { header: 'Writing Agent (feed)', key: 'agent', width: 24 },
      { header: 'Class', key: 'classification', width: 14 },
      { header: 'BSI paid us', key: 'bsi_paid', width: 12 },
      { header: 'OliComm expected', key: 'olicomm_expected', width: 14 },
      { header: 'Short to THEI', key: 'short_to_thei', width: 12 },
      { header: 'Prod Agent', key: 'production_agent', width: 22 },
      { header: 'Prod Status', key: 'production_status', width: 14 },
      { header: 'Match', key: 'match_how', width: 14 },
      { header: 'Note', key: 'gap_note', width: 56 },
    ];
    det.getRow(1).font = { bold: true };
    for (const t of tagged) {
      const row = det.addRow({
        ...t,
        manual_pinned: t.manual_pinned ? 'Y' : '',
      });
      if (t.gap_bucket === 'AUDIT_OR_CHASE') {
        row.getCell(1).fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFFFF3CD' },
        };
      }
      if (t.gap_bucket === 'NOT_IN_AGENCY_PROD') {
        row.getCell(1).fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFFEE2E2' },
        };
      }
    }
    ['J', 'K', 'L'].forEach((c) => {
      det.getColumn(c).numFmt = '$#,##0.00;($#,##0.00)';
    });

    // Filtered sheets for quick review
    for (const [name, bucket] of [
      ['Audit or Chase', 'AUDIT_OR_CHASE'],
      ['Not in Agency Prod', 'NOT_IN_AGENCY_PROD'],
      ['Recon Says Paid', 'RECON_SAYS_PAID'],
    ]) {
      const ws = wb.addWorksheet(name);
      ws.columns = det.columns;
      ws.getRow(1).font = { bold: true };
      for (const t of tagged.filter((x) => x.gap_bucket === bucket)) {
        ws.addRow({ ...t, manual_pinned: t.manual_pinned ? 'Y' : '' });
      }
      ['J', 'K', 'L'].forEach((c) => {
        ws.getColumn(c).numFmt = '$#,##0.00;($#,##0.00)';
      });
    }

    const note = wb.addWorksheet('How to read');
    note.getColumn(1).width = 110;
    note.getCell('A1').value = 'Short $ × Agency Override Recon cross-tag';
    note.getCell('A1').font = { bold: true, size: 13 };
    note.getCell('A3').value =
      'Short lines = OliComm thei_share (BSI Statements feed) > BSI→THE remittance paid.';
    note.getCell('A4').value =
      'Recon Status = same three-way logic as Agency Override Recon (manual pin wins).';
    note.getCell('A5').value =
      'AUDIT_OR_CHASE = already flagged for BSI audit / chase — not a new discovery.';
    note.getCell('A6').value =
      'NOT_IN_AGENCY_PROD = not on Hector production list (Alba peel, house, or other book) — review separately.';
    note.getCell('A7').value =
      'Open Agency Override Recon → filter Request Audit / Chase BSI to work the tracked set.';
    note.getCell('A8').value =
      'Remittance sources: ' + remUploads.map((u) => u.original_name).join(', ');

    const outPath = path.join(
      outDir,
      'Short_Lines_Tagged_Agency_OV_Recon_Mar-Jul_2026.xlsx'
    );
    await wb.xlsx.writeFile(outPath);
    fs.copyFileSync(outPath, path.join(ART, path.basename(outPath)));

    console.log('\n=== SHORT × AGENCY OV RECON ===\n');
    console.log('Gap bucket'.padEnd(28), 'Lines'.padStart(6), 'Short $'.padStart(12));
    for (const b of bucketOrder) {
      const row = byBucket[b];
      if (!row) continue;
      console.log(b.padEnd(28), String(row.n).padStart(6), ('$' + row.short.toFixed(2)).padStart(12));
    }
    console.log('TOTAL'.padEnd(28), String(totalN).padStart(6), ('$' + totalShort.toFixed(2)).padStart(12));
    console.log('\nWrote', outPath);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
