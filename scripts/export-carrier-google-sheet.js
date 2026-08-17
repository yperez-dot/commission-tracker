#!/usr/bin/env node
'use strict';

/**
 * Export carrier fight audit in Google Sheet column order with Policy # + NPN filled.
 * Run after: node scripts/enrich-carrier-fight-audit-for-katy.js
 */

const fs = require('fs');
const path = require('path');
const { clientNameKey } = require('../src/clientNameKey');
const { normalizeCarrier } = require('../src/matchingNormalize.cjs');

const BASE = path.join(__dirname, '../exports/fight-packs-2026-08-15/google-import');
const FIGHT_CSV = path.join(BASE, 'CARRIER_ALL_FIGHTS_111.csv');
const KATY_CSV = path.join(BASE, 'CARRIER_AUDIT_KATY.csv');
const REPORT_CSV = path.join(BASE, 'CARRIER_REPORT_SEND_FIRST.csv');
const OUT_CSV = path.join(BASE, 'CARRIER_SHEET_IMPORT.csv');

const MANUAL_ADDS = [
  {
    Fight_type: 'Wrong_claw',
    Client: 'IBARRA GONZALEZ R,RITO',
    Send_to_carrier: 'Aetna',
    Writing_agent: 'Christian Munoz',
    Effective_date: '2026-05-01',
    Rate_reference: 'OVER_CLAW',
    Amount_carrier_owes_BSI: 80,
    THEI_share_when_paid: 40,
    BSI_share_when_paid: 40,
    Proof: 'New Business $160.00 (AETNA_BSI_STATEMENT_202604.csv); Chargeback $240.00 (AETNA_BSI_STATEMENT_202604.csv)',
    policy_number: 'NG102274141800',
    agent_writing_number: '18524641',
  },
  {
    Fight_type: 'Wrong_claw',
    Client: 'CAMBAS DE RIVAS,MILAGROS',
    Send_to_carrier: 'Aetna',
    Writing_agent: 'Lina Hernandez',
    Effective_date: '2026-05-01',
    Hector_status: 'Active Policy',
    State: 'FL',
    Year_type: 'Plan Change',
    Rate_reference: 'OVER_CLAW',
    Amount_carrier_owes_BSI: 240,
    THEI_share_when_paid: 120,
    BSI_share_when_paid: 120,
    Proof: 'New Business $151.33 (AETNA_BSI_STATEMENT_202604.csv); Chargeback $391.33 (AETNA_BSI_STATEMENT_202605.csv)',
    policy_number: 'NG102137253900',
    agent_writing_number: '21209073',
  },
];

function issueOverrides() {
  const pairs = [
    ['CAMBAS DE RIVAS,MILAGROS', 'Aetna', 'Proof + Plan Change + split $120/$120 — locked'],
    ['IBARRA GONZALEZ R,RITO', 'Aetna', 'Paid $160 New Business, clawed $240 → owe $80'],
    ['GENEVA COLLIER M', 'Humana', 'Clawed $90 Mar, paid again Jul → owe $90'],
    ['GO, FLORAEDNA S.', 'UnitedHealthcare', 'Paid $175 Mar, clawed again Apr → owe $175'],
    ['ILLOUZ, JOSEPH Y.', 'UnitedHealthcare', 'Paid $175 Mar, clawed again → owe $175'],
    ['PEDRO, ISIDRO R.', 'UnitedHealthcare', 'Paid $175 Mar, clawed again Jun → owe $175'],
    ['REYNOLDS, FRANCINE R.', 'UnitedHealthcare', 'Paid $175 Mar, clawed again Apr → owe $175'],
    ['VERNON NEWMAN, LINDA M.', 'UnitedHealthcare', 'Paid $175 Mar, clawed $175 + $160.41 → owe $160.41'],
    ['CARLOS ALVARADO R', 'Humana', 'Over-claw $3.75'],
  ];
  return new Map(pairs.map(([c, car, txt]) => [fightKey(c, car), txt]));
}

function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQ = !inQ;
      continue;
    }
    if (ch === ',' && !inQ) {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

function escapeCsv(val) {
  const s = val == null ? '' : String(val);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function rowToCsv(row, headers) {
  return headers.map((h) => escapeCsv(row[h] ?? '')).join(',');
}

function loadCsv(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const lines = raw
    .split(/\r?\n/)
    .filter(
      (l) =>
        l &&
        !l.startsWith('#') &&
        !l.startsWith('"#') &&
        !l.startsWith('CARRIER TOTALS')
    );
  const header = parseCsvLine(lines[0]).map((h) => h.trim());
  const rows = [];
  for (const line of lines.slice(1)) {
    const cols = parseCsvLine(line);
    const row = {};
    header.forEach((h, i) => {
      row[h] = (cols[i] || '').trim();
    });
    rows.push(row);
  }
  return rows;
}

function fightKey(client, carrier) {
  return `${clientNameKey(client)}|${normalizeCarrier(carrier)}`;
}

function formatMoney(n) {
  const v = parseFloat(String(n).replace(/[$,]/g, '')) || 0;
  return `$${v.toFixed(2)}`;
}

function formatEffSheet(iso) {
  if (!iso) return '';
  const s = String(iso).trim();
  let y;
  let m;
  let d;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    [y, m, d] = s.slice(0, 10).split('-').map(Number);
  } else if (/^\d{1,2}\/\d{1,2}\/\d{4}/.test(s)) {
    [m, d, y] = s.split('/').map(Number);
  } else {
    return s;
  }
  return `${m}/${d}/${y}`;
}

function parseProofEvents(proofLine) {
  if (!proofLine) return [];
  return proofLine
    .split(' ; ')
    .map((p) => {
      const m = p.match(/^(\w+ \d{4}) \| ([^|]+) \| \$([\d.]+)/);
      if (!m) return null;
      return { period: m[1], type: m[2].trim(), amt: parseFloat(m[3]) };
    })
    .filter(Boolean);
}

function fmtAmt(n) {
  const v = parseFloat(n) || 0;
  return Number.isInteger(v) ? String(v) : v.toFixed(2);
}

function buildIssueText(r, reportRow, overrides) {
  const key = fightKey(r.Client, r.Send_to_carrier);
  const override = overrides.get(key);
  if (override) return override;

  if (r.Fight_type === 'Missing_pay') {
    return 'On Hector/active but NO pay on Carrier-BSI statements';
  }

  const code = r.Rate_reference || r.Issue;
  const amount = parseFloat(r.Amount_carrier_owes_BSI) || 0;
  const proof = reportRow?.What_happened_on_carrier_stmt || r.Proof || '';
  const events = parseProofEvents(proof);

  if (code === 'DOUBLE_CLAW') {
    return `Paid $175 Mar, clawed again → owe $${fmtAmt(amount)}`;
  }

  if (code === 'OVER_CLAW') {
    const paid = events
      .filter((e) => /new business|agency override|renewal/i.test(e.type))
      .reduce((s, e) => s + e.amt, 0);
    const clawed = events
      .filter((e) => /chargeback/i.test(e.type))
      .reduce((s, e) => s + e.amt, 0);
    if (paid > 0 && clawed > paid) {
      return `Paid $${fmtAmt(paid)}, clawed $${fmtAmt(clawed)} → owe $${fmtAmt(amount)}`;
    }
    return `Over-claw $${fmtAmt(amount)}`;
  }

  return r.Issue || '';
}

function buildProofText(r, reportRow) {
  if (r.Fight_type === 'Missing_pay') {
    return (r.Proof || '')
      .replace(/carrier→BSI/gi, 'Carrier-BSI')
      .replace(/carrier→BSI uploads/gi, 'Carrier-BSI uploads');
  }
  if (reportRow?.What_happened_on_carrier_stmt) return reportRow.What_happened_on_carrier_stmt;
  return r.Proof || '';
}

function hectorStatusDisplay(r) {
  const s = (r.Hector_status || '').trim();
  if (s) return s;
  if (r.Fight_type === 'Wrong_claw') return '(not on Hector)';
  return '';
}

function reasonCode(r) {
  if (r.Fight_type === 'Missing_pay') return 'Missing_pay';
  return r.Rate_reference || r.Issue || 'OVER_CLAW';
}

function main() {
  let fightRows = loadCsv(FIGHT_CSV);
  const katyRows = loadCsv(KATY_CSV);
  const reportRows = loadCsv(REPORT_CSV);

  const existing = new Set(fightRows.map((r) => fightKey(r.Client, r.Send_to_carrier)));
  for (const m of MANUAL_ADDS) {
    const k = fightKey(m.Client, m.Send_to_carrier);
    if (!existing.has(k)) {
      fightRows.push(m);
      existing.add(k);
    }
  }

  const overrides = issueOverrides();
  const katyByKey = new Map(
    katyRows.map((r) => [fightKey(r.Member_name, r.Send_to_carrier), r])
  );
  const reportByKey = new Map(
    reportRows.map((r) => [fightKey(r.Client, r.Send_to_carrier), r])
  );

  const sheetHeaders = [
    'Reason',
    'Carrier',
    'Client',
    'Policy #',
    'Writing_agent',
    'Agent_writing_number',
    'Effective_date',
    'Hector_status',
    'State',
    'Year_type',
    'Amount_carrier_owes_BSI',
    'THEI_share_when_paid',
    'BSI_share_when_paid',
    'Issue',
    'Proof',
  ];

  const outRows = fightRows.map((r) => {
    const key = fightKey(r.Client, r.Send_to_carrier);
    const katy = katyByKey.get(key) || {};
    const report = reportByKey.get(key) || {};
    const yearType = (r.Year_type || katy.Year_type || '').replace(/Plan_Change/i, 'Plan Change');

    return {
      Reason: reasonCode(r),
      Carrier: r.Send_to_carrier || '',
      Client: r.Client || '',
      'Policy #': katy.Policy_number || r.policy_number || '',
      Writing_agent: r.Writing_agent || katy.Agent_name || '',
      Agent_writing_number: katy.Agent_writing_number || r.agent_writing_number || '',
      Effective_date: formatEffSheet(r.Effective_date || katy.Effective_date),
      Hector_status: hectorStatusDisplay(r),
      State: r.State || katy.State || '',
      Year_type: yearType === 'Initial' ? 'Initial' : yearType,
      Amount_carrier_owes_BSI: formatMoney(r.Amount_carrier_owes_BSI),
      THEI_share_when_paid: formatMoney(r.THEI_share_when_paid),
      BSI_share_when_paid: formatMoney(r.BSI_share_when_paid),
      Issue: buildIssueText(r, report, overrides),
      Proof: buildProofText(r, report),
    };
  });

  const total = fightRows.reduce(
    (s, r) => s + (parseFloat(r.Amount_carrier_owes_BSI) || 0),
    0
  );
  const missingPolicy = outRows.filter((r) => !r['Policy #']);
  const missingNpn = outRows.filter((r) => !r.Agent_writing_number);

  const headerLine = sheetHeaders.join(',');
  const body = outRows.map((r) => rowToCsv(r, sheetHeaders)).join('\n');
  fs.writeFileSync(OUT_CSV, `${headerLine}\n${body}\n`);

  console.log(`Wrote ${outRows.length} rows → ${OUT_CSV}`);
  console.log(`Total Amount_carrier_owes_BSI: $${total.toFixed(2)}`);
  console.log(`Missing Policy #: ${missingPolicy.length}`);
  console.log(`Missing Agent_writing_number: ${missingNpn.length}`);
  if (missingPolicy.length) {
    console.log('No policy:', missingPolicy.map((r) => r.Client).join('; '));
  }
  if (missingNpn.length) {
    console.log(
      'No NPN:',
      missingNpn.map((r) => `${r.Client} / ${r.Writing_agent}`).join('; ')
    );
  }
}

main();
