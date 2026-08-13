'use strict';

/**
 * NHP → BSI owed report
 *
 * Compares:
 *  - Paid: user-supplied NHP override lines already remitted to BSI
 *  - Expected: OliComm commission_records source=NHP bsi_share
 *              (MA overrides, eff ≥ 2025-09-01 → 50/50 after any sub-agent peel)
 *
 * Usage:
 *   node scripts/build-nhp-bsi-owed-report.js \
 *     --paid exports/nhp-bsi-owed/NHP_Paid_to_BSI_User_Paste.tsv \
 *     --out  exports/nhp-bsi-owed
 */

require('dotenv').config({ path: '.env.local' });
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false },
});

function arg(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function money(v) {
  if (v == null || v === '') return 0;
  const s = String(v).replace(/[$,\s]/g, '').replace(/^\((.*)\)$/, '-$1');
  const n = parseFloat(s);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function norm(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function parseEff(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  // Excel serial-ish YYYYMMDD
  if (/^\d{8}$/.test(s)) {
    return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  }
  // 2025-11-01 0:00:00
  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) {
    return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`;
  }
  // M/D/YYYY
  const us = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (us) {
    return `${us[3]}-${us[1].padStart(2, '0')}-${us[2].padStart(2, '0')}`;
  }
  return null;
}

function carrierKeyFromStatementMonth(sm) {
  const n = norm(sm);
  if (n.includes('humana') && n.includes('pa')) return 'humana_pa';
  if (n.includes('carepoint') && n.includes('humana')) return 'humana_carepoint';
  if (n.includes('humana')) return 'humana';
  if (n.includes('healthsun') || n.includes('health sun')) return 'healthsun';
  if (n.includes('solis')) return 'solis';
  if (n.includes('doctors')) return 'doctors';
  if (n.includes('sparks') && n.includes('uhc')) return 'uhc_sparks';
  if (n.includes('uhc') || n.includes('united')) return 'uhc';
  if (n.includes('aetna')) return 'aetna';
  if (n.includes('devoted')) return 'devoted';
  if (n.includes('cigna')) return 'cigna';
  return n.split(' ')[0] || 'unknown';
}

function carrierKeyFromDb(carrier) {
  const n = norm(carrier);
  if (n.includes('humana')) return 'humana'; // PA / CarePoint collapsed for rollup match later
  if (n.includes('healthsun')) return 'healthsun';
  if (n.includes('solis')) return 'solis';
  if (n.includes('doctors')) return 'doctors';
  if (n.includes('united') || n.includes('uhc')) return 'uhc';
  if (n.includes('aetna')) return 'aetna';
  if (n.includes('devoted')) return 'devoted';
  if (n.includes('cigna')) return 'cigna';
  if (n.includes('oscar')) return 'oscar';
  if (n.includes('simply')) return 'simply';
  if (n.includes('avmed')) return 'avmed';
  if (n.includes('gold kidney')) return 'goldkidney';
  return n || 'unknown';
}

function statementPeriodKey(sm) {
  const n = norm(sm);
  const months = {
    january: '01',
    february: '02',
    march: '03',
    april: '04',
    may: '05',
    june: '06',
    july: '07',
    august: '08',
    september: '09',
    october: '10',
    november: '11',
    december: '12',
  };
  let month = null;
  let year = null;
  for (const [name, num] of Object.entries(months)) {
    if (n.includes(name)) {
      month = num;
      break;
    }
  }
  const y = n.match(/(20\d{2})/);
  if (y) year = y[1];
  if (year && month) return `${year}${month}`;
  return null;
}

function agentKey(name) {
  const n = norm(name);
  // last-token heavy match helpers
  if (n.includes('gina') && (n.includes('berenguer') || n.includes('ferro'))) return 'gina_berenguer';
  if (n.includes('yahoska') && n.includes('perez')) return 'yahoska_perez';
  if (n.includes('katy') && n.includes('robles')) return 'katy_robles';
  if (n.includes('jill') && n.includes('taylor')) return 'jill_taylor';
  if (n.includes('alan') && n.includes('elchami')) return 'alan_elchami';
  if (n.includes('edgar') && n.includes('piloto')) return 'edgar_piloto';
  if (n.includes('sabri') && n.includes('perez')) return 'sabri_perez';
  if (n.includes('marianne') && n.includes('edward')) return 'marianne_edwards';
  if (n.includes('richard') && n.includes('sett')) return 'richard_sett';
  return n;
}

function isBsiEligibleEff(effIso, lob) {
  const lobN = String(lob || '').toUpperCase();
  // ACA never splits; MED/MA (and blank treated as MA in NHP medicare rows) do
  if (lobN === 'ACA') return false;
  if (!effIso) return false;
  return effIso >= '2025-09-01';
}

function loadPaidTsv(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const headers = lines[0].split('\t').map((h) => h.trim());
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split('\t');
    const obj = {};
    headers.forEach((h, idx) => {
      obj[h] = (cols[idx] || '').trim();
    });
    const override = money(obj.Override);
    const commission = money(obj.Commission);
    const amt = override !== 0 ? override : commission;
    const eff = parseEff(obj['Policy Effective Date']);
    const stmt = obj['Carrier-Statement Month'] || '';
    rows.push({
      lob: obj.LOB || '',
      statementMonth: stmt,
      statementPeriod: statementPeriodKey(stmt),
      carrierKey: carrierKeyFromStatementMonth(stmt),
      agency: obj.Agency || '',
      agentNpn: obj['Agent NPN'] || '',
      agent: obj.Agent || '',
      agentKey: agentKey(obj.Agent),
      effectiveDate: eff,
      commissionMonth: obj['Commission Month'] || '',
      status: obj.Status || '',
      type: obj.Type || '',
      commission,
      override: amt,
      payee: obj.Payee || '',
      paymentDate: obj['Payment Date'] || '',
      bsiEligible: isBsiEligibleEff(eff, obj.LOB),
      // Per engine: BSI share = 50% of eligible override (no Christian/Horacio on this paid list)
      expectedBsiShare: isBsiEligibleEff(eff, obj.LOB) ? round2(amt * 0.5) : 0,
    });
  }
  return rows;
}

async function loadOliCommNhp() {
  const { rows } = await pool.query(`
    SELECT
      cr.id,
      COALESCE(cr.lob, '') AS lob,
      COALESCE(cr.carrier, '') AS carrier,
      COALESCE(cr.statement_month, '') AS statement_month,
      COALESCE(cr.payment_period, '') AS payment_period,
      COALESCE(cr.agent_name, '') AS agent_name,
      COALESCE(cr.client_full_name, '') AS client_full_name,
      COALESCE(cr.policy_number, '') AS policy_number,
      COALESCE(cr.effective_date, '') AS effective_date,
      COALESCE(cr.classification, '') AS classification,
      COALESCE(cr.gross_commission, 0)::float AS gross_commission,
      COALESCE(cr.commission, 0)::float AS commission,
      COALESCE(cr.thei_share, 0)::float AS thei_share,
      COALESCE(cr.bsi_share, 0)::float AS bsi_share,
      COALESCE(cr.producer_payable, 0)::float AS producer_payable,
      COALESCE(cr.sub_agent_override, 0)::float AS sub_agent_override,
      COALESCE(cr.split_applies, false) AS split_applies,
      COALESCE(u.filename, '') AS upload_filename,
      COALESCE(u.original_name, '') AS upload_original_name
    FROM commission_records cr
    LEFT JOIN uploads u ON u.id = cr.upload_id
    WHERE cr.source = 'NHP'
    ORDER BY cr.payment_period NULLS LAST, cr.carrier, cr.id
  `);
  return rows.map((r) => {
    const eff = parseEff(r.effective_date) || (String(r.effective_date || '').match(/^\d{4}-\d{2}-\d{2}/) || [null])[0];
    return {
      ...r,
      effectiveIso: eff,
      carrierKey: carrierKeyFromDb(r.carrier),
      agentKey: agentKey(r.agent_name),
      statementPeriod: statementPeriodKey(r.statement_month) || (String(r.payment_period || '').match(/^\d{6}$/) ? r.payment_period : null),
    };
  });
}

function summarizePaid(paid) {
  const byStmt = new Map();
  const byPayDate = new Map();
  let gross = 0;
  let expectedHalf = 0;
  for (const r of paid) {
    gross = round2(gross + r.override);
    expectedHalf = round2(expectedHalf + r.expectedBsiShare);
    const sk = r.statementMonth || '(blank)';
    if (!byStmt.has(sk)) byStmt.set(sk, { statementMonth: sk, period: r.statementPeriod, n: 0, gross: 0, expectedBsiHalf: 0, paymentDates: new Set() });
    const s = byStmt.get(sk);
    s.n += 1;
    s.gross = round2(s.gross + r.override);
    s.expectedBsiHalf = round2(s.expectedBsiHalf + r.expectedBsiShare);
    if (r.paymentDate) s.paymentDates.add(r.paymentDate);

    const pd = r.paymentDate || '(blank)';
    if (!byPayDate.has(pd)) byPayDate.set(pd, { paymentDate: pd, n: 0, gross: 0, expectedBsiHalf: 0 });
    const p = byPayDate.get(pd);
    p.n += 1;
    p.gross = round2(p.gross + r.override);
    p.expectedBsiHalf = round2(p.expectedBsiHalf + r.expectedBsiShare);
  }
  return {
    n: paid.length,
    grossPaidListed: gross,
    expectedBsiHalfOfPaidLines: expectedHalf,
    byStatementMonth: [...byStmt.values()].map((s) => ({
      ...s,
      paymentDates: [...s.paymentDates].join(', '),
    })),
    byPaymentDate: [...byPayDate.values()],
  };
}

function summarizeOli(oli) {
  const withBsi = oli.filter((r) => round2(r.bsi_share) !== 0);
  const byPeriod = new Map();
  const byCarrier = new Map();
  let bsi = 0;
  let gross = 0;
  let thei = 0;
  for (const r of withBsi) {
    bsi = round2(bsi + r.bsi_share);
    gross = round2(gross + r.gross_commission);
    thei = round2(thei + r.thei_share);
    const pk = r.payment_period || '(blank)';
    if (!byPeriod.has(pk)) byPeriod.set(pk, { paymentPeriod: pk, n: 0, gross: 0, bsi: 0, thei: 0 });
    const p = byPeriod.get(pk);
    p.n += 1;
    p.gross = round2(p.gross + r.gross_commission);
    p.bsi = round2(p.bsi + r.bsi_share);
    p.thei = round2(p.thei + r.thei_share);

    const ck = r.carrier || '(blank)';
    if (!byCarrier.has(ck)) byCarrier.set(ck, { carrier: ck, n: 0, gross: 0, bsi: 0, thei: 0 });
    const c = byCarrier.get(ck);
    c.n += 1;
    c.gross = round2(c.gross + r.gross_commission);
    c.bsi = round2(c.bsi + r.bsi_share);
    c.thei = round2(c.thei + r.thei_share);
  }
  return {
    nAll: oli.length,
    nWithBsiShare: withBsi.length,
    grossWithBsi: gross,
    bsiShareTotal: bsi,
    theiShareTotal: thei,
    byPeriod: [...byPeriod.values()].sort((a, b) => String(a.paymentPeriod).localeCompare(String(b.paymentPeriod))),
    byCarrier: [...byCarrier.values()].sort((a, b) => b.bsi - a.bsi),
    withBsi,
  };
}

/**
 * Match paid statement months to OliComm rows by carrier family + amount multiset
 * within nearby payment periods. Mark matched OliComm ids as SETTLED.
 */
function matchPaidToOliComm(paid, oliWithBsi) {
  // Bucket OliComm by carrierKey + rounded |bsi*2| (gross-ish) OR gross_commission
  const buckets = new Map();
  for (const r of oliWithBsi) {
    const amtKeys = [
      round2(Math.abs(r.gross_commission)),
      round2(Math.abs(r.bsi_share) * 2),
      round2(Math.abs(r.bsi_share)),
    ];
    for (const ak of new Set(amtKeys)) {
      const key = `${r.carrierKey}|${ak}`;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(r);
    }
  }

  const used = new Set();
  const matchedPaid = [];
  const unmatchedPaid = [];

  for (const p of paid) {
    // Prefer matching full override to gross_commission; fallback to half↔bsi_share
    const tryKeys = [
      `${canonicalizePaidCarrier(p.carrierKey)}|${round2(Math.abs(p.override))}`,
    ];
    // Humana PA / CarePoint → humana
    if (p.carrierKey.startsWith('humana')) {
      tryKeys.push(`humana|${round2(Math.abs(p.override))}`);
    }
    if (p.carrierKey === 'uhc_sparks') {
      tryKeys.push(`uhc|${round2(Math.abs(p.override))}`);
    }

    let hit = null;
    for (const tk of tryKeys) {
      const list = buckets.get(tk) || [];
      hit = list.find((r) => !used.has(r.id) && agentsLooseMatch(p.agentKey, r.agentKey));
      if (!hit) hit = list.find((r) => !used.has(r.id));
      if (hit) break;
    }

    // Fallback: match on bsi half amount
    if (!hit) {
      const half = round2(Math.abs(p.override) * 0.5);
      const tk2 = `${canonicalizePaidCarrier(p.carrierKey)}|${half}`;
      const list = (buckets.get(tk2) || []).filter((r) => round2(Math.abs(r.bsi_share)) === half);
      hit = list.find((r) => !used.has(r.id) && agentsLooseMatch(p.agentKey, r.agentKey))
        || list.find((r) => !used.has(r.id));
    }

    if (hit) {
      used.add(hit.id);
      matchedPaid.push({
        ...p,
        matchStatus: 'MATCHED_OLICOMM',
        oliId: hit.id,
        oliClient: hit.client_full_name,
        oliPolicy: hit.policy_number,
        oliPeriod: hit.payment_period,
        oliGross: hit.gross_commission,
        oliBsiShare: hit.bsi_share,
        oliTheiShare: hit.thei_share,
      });
    } else {
      unmatchedPaid.push({ ...p, matchStatus: 'PAID_NOT_IN_OLICOMM' });
    }
  }

  const unsettled = oliWithBsi.filter((r) => !used.has(r.id));
  return { matchedPaid, unmatchedPaid, unsettled, matchedOliIds: used };
}

function canonicalizePaidCarrier(ck) {
  if (ck.startsWith('humana')) return 'humana';
  if (ck === 'uhc_sparks') return 'uhc';
  return ck;
}

function agentsLooseMatch(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  // shared last token
  const at = a.split('_').pop();
  const bt = b.split('_').pop();
  return at && bt && at === bt && at.length > 3;
}

function sheet(wb, name, rows) {
  const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{ note: 'none' }]);
  XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31));
}

async function main() {
  const paidPath = arg('--paid', 'exports/nhp-bsi-owed/NHP_Paid_to_BSI_User_Paste.tsv');
  const outDir = arg('--out', 'exports/nhp-bsi-owed');
  fs.mkdirSync(outDir, { recursive: true });

  if (!fs.existsSync(paidPath)) {
    console.error('Missing paid file:', paidPath);
    process.exit(1);
  }

  const paid = loadPaidTsv(paidPath);
  const oli = await loadOliCommNhp();
  const paidSum = summarizePaid(paid);
  const oliSum = summarizeOli(oli);
  const match = matchPaidToOliComm(paid, oliSum.withBsi);

  const unsettledBsi = round2(match.unsettled.reduce((s, r) => s + r.bsi_share, 0));
  const matchedBsi = round2(match.matchedPaid.reduce((s, r) => s + (r.oliBsiShare || 0), 0));

  // Two views of "paid":
  // A) User paste Override column sum (literal "this is what I paid")
  // B) Engine 50% of those eligible lines
  // C) Matched OliComm bsi_share on paid lines
  const paidLiteral = paidSum.grossPaidListed;
  const paidHalfEngine = paidSum.expectedBsiHalfOfPaidLines;
  const paidMatchedOli = matchedBsi;

  const expectedTotal = oliSum.bsiShareTotal;

  const unsettledGross = round2(match.unsettled.reduce((s, r) => s + r.gross_commission, 0));
  const cashOwedIfPasteWasRemittance = round2(expectedTotal - paidLiteral);

  const summaryRows = [
    { Metric: 'Paid paste lines (sales N)', Value: paidSum.n },
    { Metric: 'Paid paste Override $ (treated as $ already remitted to BSI)', Value: paidLiteral },
    { Metric: 'Engine 50% BSI share on those same paid lines (reference)', Value: paidHalfEngine },
    { Metric: 'Paid paste lines matched to OliComm', Value: match.matchedPaid.length },
    { Metric: 'Paid paste lines unmatched to OliComm', Value: match.unmatchedPaid.length },
    { Metric: 'Matched OliComm bsi_share on paid lines', Value: paidMatchedOli },
    { Metric: 'OliComm NHP rows with nonzero bsi_share (sales N)', Value: oliSum.nWithBsiShare },
    { Metric: 'OliComm expected BSI share TOTAL (50% rule)', Value: expectedTotal },
    { Metric: 'RECOMMENDED CASH OWED (Expected BSI − Paid paste $)', Value: cashOwedIfPasteWasRemittance },
    { Metric: 'Unsettled sales N (OliComm bsi rows not matched to paid paste)', Value: match.unsettled.length },
    { Metric: 'Unsettled OliComm bsi_share $ (detail list total)', Value: unsettledBsi },
    { Metric: 'Unsettled OliComm gross override $ (if you remit full NHP pot)', Value: unsettledGross },
    { Metric: 'Note: do NOT add unsettled bsi on top of Recommended Cash Owed', Value: 'use one or the other' },
  ];

  const unsettledDetail = match.unsettled
    .map((r) => ({
      'Payment Period': r.payment_period,
      Carrier: r.carrier,
      Agent: r.agent_name,
      Client: r.client_full_name,
      'Policy #': r.policy_number,
      'Eff Date': r.effective_date,
      Classification: r.classification,
      LOB: r.lob,
      'Gross Override': round2(r.gross_commission),
      'THEI Share': round2(r.thei_share),
      'BSI Share OWED': round2(r.bsi_share),
      'Sub-Agent OV': round2(r.sub_agent_override),
      'Statement Month': r.statement_month,
      Upload: r.upload_original_name || r.upload_filename,
    }))
    .sort((a, b) => String(a['Payment Period']).localeCompare(String(b['Payment Period'])) || b['BSI Share OWED'] - a['BSI Share OWED']);

  const unsettledByPeriod = [...match.unsettled.reduce((m, r) => {
    const k = r.payment_period || '(blank)';
    if (!m.has(k)) m.set(k, { 'Payment Period': k, 'Sales N': 0, 'Gross Override': 0, 'BSI Share OWED': 0, 'THEI Share': 0 });
    const x = m.get(k);
    x['Sales N'] += 1;
    x['Gross Override'] = round2(x['Gross Override'] + r.gross_commission);
    x['BSI Share OWED'] = round2(x['BSI Share OWED'] + r.bsi_share);
    x['THEI Share'] = round2(x['THEI Share'] + r.thei_share);
    return m;
  }, new Map()).values()].sort((a, b) => String(a['Payment Period']).localeCompare(String(b['Payment Period'])));

  const unsettledByCarrier = [...match.unsettled.reduce((m, r) => {
    const k = r.carrier || '(blank)';
    if (!m.has(k)) m.set(k, { Carrier: k, 'Sales N': 0, 'Gross Override': 0, 'BSI Share OWED': 0 });
    const x = m.get(k);
    x['Sales N'] += 1;
    x['Gross Override'] = round2(x['Gross Override'] + r.gross_commission);
    x['BSI Share OWED'] = round2(x['BSI Share OWED'] + r.bsi_share);
    return m;
  }, new Map()).values()].sort((a, b) => b['BSI Share OWED'] - a['BSI Share OWED']);

  const paidByStmt = paidSum.byStatementMonth.map((s) => ({
    'Carrier-Statement Month': s.statementMonth,
    Period: s.period,
    'Sales N': s.n,
    'Override $ (as listed / paid claim)': s.gross,
    'Engine 50% BSI': s.expectedBsiHalf,
    'Payment Dates': s.paymentDates,
  }));

  const wb = XLSX.utils.book_new();
  sheet(wb, 'Summary', summaryRows);
  sheet(wb, 'Owed by Period', unsettledByPeriod);
  sheet(wb, 'Owed by Carrier', unsettledByCarrier);
  sheet(wb, 'Owed Detail', unsettledDetail);
  sheet(wb, 'Paid Paste by Stmt Month', paidByStmt);
  sheet(wb, 'Paid Paste by Pay Date', paidSum.byPaymentDate.map((p) => ({
    'Payment Date': p.paymentDate,
    'Sales N': p.n,
    'Override $': p.gross,
    'Engine 50% BSI': p.expectedBsiHalf,
  })));
  sheet(wb, 'Paid Matched to OliComm', match.matchedPaid.map((r) => ({
    'Statement Month': r.statementMonth,
    Agent: r.agent,
    'Eff Date': r.effectiveDate,
    'Paid Override $': r.override,
    'Payment Date': r.paymentDate,
    'Oli Client': r.oliClient,
    'Oli Policy': r.oliPolicy,
    'Oli Period': r.oliPeriod,
    'Oli Gross': r.oliGross,
    'Oli BSI Share': r.oliBsiShare,
  })));
  sheet(wb, 'Paid Unmatched', match.unmatchedPaid.map((r) => ({
    'Statement Month': r.statementMonth,
    Agent: r.agent,
    Status: r.status,
    'Eff Date': r.effectiveDate,
    'Override $': r.override,
    'Payment Date': r.paymentDate,
    'Engine 50% BSI': r.expectedBsiShare,
  })));
  sheet(wb, 'OliComm BSI by Period', oliSum.byPeriod);
  sheet(wb, 'OliComm BSI by Carrier', oliSum.byCarrier);
  sheet(wb, 'Assumptions', [
    { Note: 'NHP MA overrides with eff ≥ 2025-09-01 split 50/50 THEI/BSI after any Christian/Horacio peel.' },
    { Note: 'ACA NHP overrides do not split with BSI.' },
    { Note: 'User paste = sales already paid to BSI. Override $ treated as dollars remitted.' },
    { Note: 'RECOMMENDED CASH OWED = OliComm total bsi_share − sum(Override $ in paste).' },
    { Note: 'Your remittances look like full NHP pots (~2× engine bsi_share on matched lines), so cash owed is smaller than unsettled bsi list.' },
    { Note: 'Owed Detail = OliComm sales not matched to the paste (what still needs a remittance). Amounts show engine 50% BSI share.' },
    { Note: 'Largest gap driver: 202601 Doctors AEP overrides not in the paid paste.' },
  ]);

  const xlsxPath = path.join(outDir, 'NHP_BSI_Owed_Report.xlsx');
  XLSX.writeFile(wb, xlsxPath);

  // CSV of owed detail for easy share
  const csvPath = path.join(outDir, 'NHP_BSI_Still_Owed_Detail.csv');
  const csvHeader = Object.keys(unsettledDetail[0] || { note: 1 });
  const csv = [
    csvHeader.join(','),
    ...unsettledDetail.map((r) => csvHeader.map((h) => {
      const v = r[h];
      const s = v == null ? '' : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(',')),
  ].join('\n');
  fs.writeFileSync(csvPath, csv);

  const readme = `# NHP → BSI Owed Report

Generated: ${new Date().toISOString()}

## Bottom line
- **Recommended cash still owed to BSI:** $${cashOwedIfPasteWasRemittance.toLocaleString('en-US', { minimumFractionDigits: 2 })}
  - OliComm expected BSI share **$${expectedTotal.toLocaleString('en-US', { minimumFractionDigits: 2 })}**
  - Minus your paid paste Override $ **$${paidLiteral.toLocaleString('en-US', { minimumFractionDigits: 2 })}** (${paidSum.n} sales)
- **Unsettled sales still needing a remittance line:** **${match.unsettled.length}** (engine BSI share $${unsettledBsi.toLocaleString('en-US', { minimumFractionDigits: 2 })}; mostly **202601 Doctors**)

Do not add unsettled BSI on top of the recommended cash figure — the cash figure already nets total expected vs what you remitted.

## Rule
MA NHP agency overrides with effective date ≥ 2025-09-01 → BSI gets 50% (after Christian/Horacio peel when applicable). ACA does not split.

## Files
- \`NHP_BSI_Owed_Report.xlsx\`
- \`NHP_BSI_Still_Owed_Detail.csv\`
- \`NHP_Paid_to_BSI_User_Paste.tsv\`

Regenerate:
\`\`\`
node scripts/build-nhp-bsi-owed-report.js --paid exports/nhp-bsi-owed/NHP_Paid_to_BSI_User_Paste.tsv --out exports/nhp-bsi-owed
\`\`\`
`;
  fs.writeFileSync(path.join(outDir, 'README.md'), readme);

  console.log('\n=== NHP → BSI OWED ===\n');
  console.log(summaryRows.map((r) => `${r.Metric}: ${r.Value}`).join('\n'));
  console.log('\nWrote', xlsxPath);
  console.log('Wrote', csvPath);
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
