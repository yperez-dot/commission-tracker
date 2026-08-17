#!/usr/bin/env node
'use strict';

/**
 * Build carrier fight audit CSV for Katy with:
 * Policy_number, Effective_date, Member_name, Agent_name, Agent_writing_number
 * plus fight columns from CARRIER_ALL_FIGHTS_111 (+ manual adds).
 */

const fs = require('fs');
const path = require('path');
const { getPool } = require('../db/database');
const { clientNameKey } = require('../src/clientNameKey');
const { normalizeCarrier } = require('../src/matchingNormalize.cjs');

const IN_CSV = path.join(__dirname, '../exports/fight-packs-2026-08-15/google-import/CARRIER_ALL_FIGHTS_111.csv');
const OUT_CSV = path.join(__dirname, '../exports/fight-packs-2026-08-15/google-import/CARRIER_AUDIT_KATY.csv');

const MANUAL_ADDS = [
  {
    Fight_type: 'Wrong_claw',
    Client: 'IBARRA GONZALEZ R,RITO',
    Send_to_carrier: 'Aetna',
    Writing_agent: 'Christian Munoz',
    Effective_date: '2026-05-01',
    Issue: 'OVER_CLAW',
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
    Hector_status: 'Active',
    State: 'FL',
    Year_type: 'Plan_Change',
    Issue: 'OVER_CLAW',
    Amount_carrier_owes_BSI: 240,
    THEI_share_when_paid: 120,
    BSI_share_when_paid: 120,
    Proof: 'New Business $151.33 (AETNA_BSI_STATEMENT_202604.csv); Chargeback $391.33 (AETNA_BSI_STATEMENT_202605.csv)',
    policy_number: 'NG102137253900',
    agent_writing_number: '21209073',
  },
];

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

function loadFightCsv(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const lines = raw.split(/\r?\n/).filter((l) => l && !l.startsWith('#'));
  const header = lines[0].split(',');
  const rows = [];
  for (const line of lines.slice(1)) {
    const cols = parseCsvLine(line);
    const row = {};
    header.forEach((h, i) => {
      row[h.trim()] = (cols[i] || '').trim();
    });
    rows.push(row);
  }
  return rows;
}

function fightKey(client, carrier) {
  return `${clientNameKey(client)}|${normalizeCarrier(carrier)}`;
}

function pickWritingNumber(raw) {
  if (!raw) return '';
  const rd = typeof raw === 'string' ? JSON.parse(raw) : raw;
  const n =
    rd['Writing Agent NPN'] ||
    rd.NPN ||
    rd.Writing_Agent_NPN ||
    rd['Writing Agent NPN'] ||
    rd.writing_agent_npn ||
    rd.AGENT_NPN ||
    '';
  return n ? String(n).trim() : '';
}

function pickPolicyFromRaw(raw) {
  if (!raw) return '';
  const rd = typeof raw === 'string' ? JSON.parse(raw) : raw;
  return (
    rd['Policy #'] ||
    rd['Policy Number'] ||
    rd.Policy_Number ||
    rd.policy_number ||
    ''
  )
    .toString()
    .trim();
}

/** Known writing-agent NPNs from production / stmt feeds (fallback). */
const AGENT_NPN_FALLBACK = {
  'lina hernandez': '21231852',
  'jendy vanheyningen': '20805247',
  'christian munoz': '18524641',
  'alba hernandez': '21209073',
  'hernandez, alba r': '21209073',
  'katy robles': '17013263',
  'robles, katy j': '17013263',
  'alan elchami': '17589158',
  'elchami, alan': '17589158',
  'cristy witcher': '20679966',
  'ivan santiago': '19155946',
  'paulette rostran': '20212059',
  'noris arcaya martinez': '',
  'the health experts insurance': '16326554',
  'yahoska perez': '16326554',
  'michael rivera': '19037371',
  'frank clawson': '',
  'nicholas mccalla': '',
  'long khuu': '',
  'eric del valle': '20480534',
  'adrian cruz': '18483210',
  'miguel osle': '',
  'tyler payton': '19312513',
  'jeremy nichelson': '19808188',
  'horacio mendeta': '3694849',
  'jill taylor': '20062445',
  'kelly carpenter': '19367697',
  'jena brewer': '18761024',
  'edgar piloto': '20014249',
};

function formatEff(d) {
  if (!d) return '';
  const s = String(d).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  if (/^\d{1,2}\/\d{1,2}\/\d{4}/.test(s)) {
    const [m, day, y] = s.split('/');
    return `${y}-${m.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }
  return s;
}

async function loadEnrichment(pool) {
  const cr = await pool.query(`
    SELECT cr.client_full_name, cr.carrier, cr.agent_name,
           cr.policy_number, cr.effective_date, cr.raw_data
    FROM commission_records cr
    ORDER BY cr.id DESC
  `);

  const policyByKey = new Map();
  const effByKey = new Map();
  const agentByKey = new Map();
  const npnByClientCarrier = new Map();

  for (const r of cr.rows) {
    const key = fightKey(r.client_full_name, r.carrier);
    const rawPolicy = pickPolicyFromRaw(r.raw_data);
    const rawNpn = pickWritingNumber(r.raw_data);

    if (!policyByKey.has(key) && (r.policy_number || rawPolicy)) {
      policyByKey.set(key, r.policy_number || rawPolicy);
    }
    if (!effByKey.has(key) && r.effective_date) {
      effByKey.set(key, formatEff(r.effective_date));
    }
    if (!agentByKey.has(key) && r.agent_name) {
      agentByKey.set(key, r.agent_name);
    }
    if (rawNpn && !npnByClientCarrier.has(key)) {
      npnByClientCarrier.set(key, rawNpn);
    }
  }

  const ap = await pool.query(`
    SELECT client_name, carrier, agent_name, policy_number, effective_date, raw_data
    FROM agency_production
  `);

  const npnByAgent = new Map();
  const prodPolicyByKey = new Map();
  const prodEffByKey = new Map();

  for (const r of ap.rows) {
    const key = fightKey(r.client_name, r.carrier);
    const npn = pickWritingNumber(r.raw_data);
    if (npn && !npnByClientCarrier.has(key)) npnByClientCarrier.set(key, npn);
    if (npn && r.agent_name) {
      const ak = String(r.agent_name).toLowerCase().trim();
      if (!npnByAgent.has(ak)) npnByAgent.set(ak, npn);
    }
    const rd = typeof r.raw_data === 'string' ? JSON.parse(r.raw_data) : r.raw_data || {};
    const prodPol =
      r.policy_number ||
      (rd.Affinitypolicyid ? String(rd.Affinitypolicyid) : '') ||
      (rd.UMID ? String(rd.UMID) : '') ||
      (rd.MEDICARE_IDENTIFIER ? String(rd.MEDICARE_IDENTIFIER) : '') ||
      (rd.MEDICARE_NUMBER ? String(rd.MEDICARE_NUMBER) : '') ||
      '';
    if (prodPol && !prodPolicyByKey.has(key)) prodPolicyByKey.set(key, prodPol);
    if (r.effective_date && !prodEffByKey.has(key)) {
      prodEffByKey.set(key, formatEff(String(r.effective_date).slice(0, 10)));
    }
  }

  return { policyByKey, effByKey, agentByKey, npnByClientCarrier, npnByAgent, prodPolicyByKey, prodEffByKey };
}

async function main() {
  const pool = getPool();
  const enrich = await loadEnrichment(pool);
  let rows = loadFightCsv(IN_CSV);

  const existing = new Set(rows.map((r) => fightKey(r.Client, r.Send_to_carrier)));
  for (const m of MANUAL_ADDS) {
    const k = fightKey(m.Client, m.Send_to_carrier);
    if (!existing.has(k)) {
      rows.push(m);
      existing.add(k);
    }
  }

  const katyHeaders = [
    'Policy_number',
    'Effective_date',
    'Member_name',
    'Agent_name',
    'Agent_writing_number',
    'Fight_type',
    'Issue',
    'Send_to_carrier',
    'Amount_carrier_owes_BSI',
    'THEI_share_when_paid',
    'BSI_share_when_paid',
    'State',
    'Year_type',
    'Hector_status',
    'Proof',
    'Ask_carrier',
    'Note',
  ];

  const outRows = rows.map((r) => {
    const key = fightKey(r.Client, r.Send_to_carrier);
    const agentName = r.Writing_agent || enrich.agentByKey.get(key) || '';
    const agentKey = String(agentName).toLowerCase().trim();

    return {
      Policy_number:
        r.policy_number ||
        enrich.policyByKey.get(key) ||
        enrich.prodPolicyByKey.get(key) ||
        '',
      Effective_date:
        formatEff(r.Effective_date) ||
        enrich.effByKey.get(key) ||
        enrich.prodEffByKey.get(key) ||
        '',
      Member_name: r.Client || '',
      Agent_name: agentName,
      Agent_writing_number:
        r.agent_writing_number ||
        enrich.npnByClientCarrier.get(key) ||
        enrich.npnByAgent.get(agentKey) ||
        AGENT_NPN_FALLBACK[agentKey] ||
        '',
      Fight_type: r.Fight_type || '',
      Issue: r.Issue || r.Rate_reference || '',
      Send_to_carrier: r.Send_to_carrier || '',
      Amount_carrier_owes_BSI: r.Amount_carrier_owes_BSI || '',
      THEI_share_when_paid: r.THEI_share_when_paid || '',
      BSI_share_when_paid: r.BSI_share_when_paid || '',
      State: r.State || '',
      Year_type: r.Year_type || '',
      Hector_status: r.Hector_status || '',
      Proof: r.Proof || '',
      Ask_carrier: r.Ask_carrier || '',
      Note: r.Note || '',
    };
  });

  const missingPolicy = outRows.filter((r) => !r.Policy_number);
  const missingNpn = outRows.filter((r) => !r.Agent_writing_number);

  const headerLine = katyHeaders.join(',');
  const body = outRows.map((r) => rowToCsv(r, katyHeaders)).join('\n');
  fs.writeFileSync(OUT_CSV, `${headerLine}\n${body}\n`);

  console.log(`Wrote ${outRows.length} rows → ${OUT_CSV}`);
  console.log(`Missing policy_number: ${missingPolicy.length}`);
  console.log(`Missing agent_writing_number: ${missingNpn.length}`);
  if (missingPolicy.length) {
    console.log('No policy (first 10):', missingPolicy.slice(0, 10).map((r) => r.Member_name));
  }
  if (missingNpn.length) {
    console.log('No NPN (first 10):', missingNpn.slice(0, 10).map((r) => `${r.Member_name} / ${r.Agent_name}`));
  }

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
