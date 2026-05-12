// Local test harness for the upgraded NHP parser.
const fs = require('fs');
const XLSX = require('xlsx');
const { normalizeAgentName } = require('./routes/normalize');

// ─── Mirror the constants from routes/files.js ──────────────────────────────
const NO_SPLIT_AGENTS = [
  'patsy pernia',
  'eduardo pernia',
  'josseline silber',
  'josseline mena',
  'jessica sifontes',
  'sabri perez',
  'jill taylor',
  'osmary orozco',
];

const ACA_CARRIERS_LIST = [
  'molina', 'cigna', 'ambetter', 'florida blue', 'oscar health', 'oscar',
];

const ACA_AGENCY_PAYS_PRODUCER = ['molina', 'cigna', 'ambetter', 'florida blue'];

function shouldSplit(agentName, carrier) {
  const car = String(carrier || '').toLowerCase().trim();
  if (ACA_CARRIERS_LIST.some(c => car.includes(c))) return false;
  return true;
}

function isAcaAgencyPaysProducer(carrier) {
  const car = String(carrier || '').toLowerCase().trim();
  return ACA_AGENCY_PAYS_PRODUCER.some(c => car.includes(c));
}

function normalizeNHPCarrier(carrierMonth) {
  const s = String(carrierMonth || '').toLowerCase();
  if (s.includes('uhc') || s.includes('united')) return 'UnitedHealthcare';
  if (s.includes('humana')) return 'Humana';
  if (s.includes('aetna')) return 'Aetna';
  if (s.includes('cigna')) return 'Cigna';
  if (s.includes('devoted')) return 'Devoted';
  if (s.includes('wellcare')) return 'WellCare';
  if (s.includes('avmed')) return 'AvMed';
  if (s.includes('solis')) return 'Solis';
  if (s.includes('doctors')) return 'Doctors';
  if (s.includes('healthsun')) return 'HealthSun';
  return carrierMonth;
}

function normalizePeriod(value) {
  if (!value) return 'Unknown';
  if (typeof value === 'number') return String(value);
  const s = String(value).trim();
  return s;
}

function formatDate(v) {
  if (!v) return '';
  if (typeof v === 'number') {
    // Excel serial date
    const d = new Date((v - 25569) * 86400 * 1000);
    return `${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCDate()).padStart(2, '0')}/${d.getUTCFullYear()}`;
  }
  return String(v);
}

function derivePlanType(carrier) {
  if (carrier === 'UnitedHealthcare') return 'UnitedHealthcare Med Adv';
  if (carrier === 'Humana') return 'Humana Med Adv';
  if (carrier === 'Aetna') return 'Aetna MAPD';
  return carrier;
}

// ─── parseNHPRows (mirror of routes/files.js logic) ─────────────────────────
function parseNHPRows(wb) {
  const records = [];
  const ws = wb.Sheets[wb.SheetNames[0]];
  const range = XLSX.utils.decode_range(ws['!ref']);

  let headerRow = -1;
  for (let r = range.s.r; r <= Math.min(range.s.r + 20, range.e.r); r++) {
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })];
      if (cell && String(cell.v || '').toLowerCase().trim() === 'override') {
        headerRow = r;
        break;
      }
    }
    if (headerRow >= 0) break;
  }
  if (headerRow < 0) return records;
  const rows = XLSX.utils.sheet_to_json(ws, { raw: true, defval: '', range: headerRow });

  for (const row of rows) {
    const agentRaw = String(row['Agent'] || '').trim();
    const agent = normalizeAgentName(agentRaw);
    const carrierRaw = String(row['Carrier-Statement Month'] || '').trim();
    const client = String(row['Subscriber Name'] || '').trim();
    const policyNumber = String(row['Policy Number'] || '').trim();
    const effectiveDate = formatDate(row['Policy Effective Date']);
    const rawPeriod = row['Commission Month'];
    const period = normalizePeriod(rawPeriod);
    const nhpType = String(row['Type'] || '').trim();
    const lobRaw = String(row['LOB'] || '').trim();

    const isCommissionRow = nhpType.toLowerCase().includes('commission');
    const grossCommission = isCommissionRow
      ? (parseFloat(row['Commission']) || 0)
      : (parseFloat(row['Override']) || 0);

    if (!client) continue;
    if (grossCommission === 0) continue;

    const carrier = normalizeNHPCarrier(carrierRaw);
    const recordType = isCommissionRow ? 'Agent Commission' : 'Agency Override';
    const planType = derivePlanType(carrier);

    const isAcaCarrier = ACA_CARRIERS_LIST.some(c => String(carrier).toLowerCase().includes(c));
    const isAcaAgentRow = NO_SPLIT_AGENTS.some(a => String(agent).toLowerCase().includes(a));
    let splitApplies, theiShare, bsiShare, producerPayable;

    if (isCommissionRow) {
      splitApplies = false;
      theiShare = 0;
      bsiShare = 0;
      producerPayable = grossCommission;
    } else if (isAcaCarrier) {
      splitApplies = false;
      if (isAcaAgencyPaysProducer(carrier) && isAcaAgentRow) {
        theiShare = 0;
        bsiShare = 0;
        producerPayable = grossCommission;
      } else {
        theiShare = grossCommission;
        bsiShare = 0;
        producerPayable = 0;
      }
    } else {
      splitApplies = true;
      theiShare = Math.round(grossCommission * 0.5 * 100) / 100;
      bsiShare = Math.round(grossCommission * 0.5 * 100) / 100;
      producerPayable = 0;
    }

    let lob;
    const lobLower = lobRaw.toLowerCase();
    if (lobLower === 'ma' || lobLower === 'mapd') lob = 'MA';
    else if (lobLower === 'aca') lob = 'ACA';
    else if (lobLower === 'pdp') lob = 'PDP';
    else if (lobLower === 'medsupp' || lobLower === 'medigap') lob = 'MedSupp';
    else lob = lobRaw || null;

    records.push({
      agent: agent || 'Unknown',
      carrier,
      planType,
      client,
      effectiveDate,
      premium: 0,
      commission: theiShare,
      classification: grossCommission < 0 ? 'Chargeback' : recordType,
      period: period || 'Unknown',
      policyNumber,
      payee: 'NHP',
      source: 'NHP',
      policyWrittenDate: effectiveDate,
      grossCommission,
      theiShare,
      bsiShare,
      producerPayable,
      splitApplies,
      lob,
      raw: row,
    });
  }
  return records;
}

// ─── Test runner ────────────────────────────────────────────────────────────
async function main() {
  const filePath = process.argv[2];
  if (!filePath) { console.error('Usage: node test-nhp-parser.js <path-to-nhp.xlsx>'); process.exit(1); }

  console.log(`\nParsing: ${filePath}\n`);
  const wb = XLSX.readFile(filePath);
  const records = parseNHPRows(wb);

  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`TOTAL RECORDS PARSED: ${records.length}`);
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Totals
  let grossTotal = 0, theiTotal = 0, bsiTotal = 0, payableTotal = 0;
  for (const r of records) {
    grossTotal += r.grossCommission || 0;
    theiTotal += r.theiShare || 0;
    bsiTotal += r.bsiShare || 0;
    payableTotal += r.producerPayable || 0;
  }
  console.log('TOTALS:');
  console.log(`  Gross:          $${grossTotal.toFixed(2)}`);
  console.log(`  THEI Share:     $${theiTotal.toFixed(2)}`);
  console.log(`  BSI Share:      $${bsiTotal.toFixed(2)}`);
  console.log(`  Producer Payable: $${payableTotal.toFixed(2)}`);
  console.log(`  Math check (THEI + BSI + Payable = Gross?): ${(theiTotal + bsiTotal + payableTotal).toFixed(2)} vs ${grossTotal.toFixed(2)}`);

  // By type
  const byType = {};
  for (const r of records) {
    const k = r.classification;
    if (!byType[k]) byType[k] = { count: 0, gross: 0, thei: 0, bsi: 0, payable: 0 };
    byType[k].count++;
    byType[k].gross += r.grossCommission || 0;
    byType[k].thei += r.theiShare || 0;
    byType[k].bsi += r.bsiShare || 0;
    byType[k].payable += r.producerPayable || 0;
  }
  console.log('\nBY CLASSIFICATION:');
  for (const [k, s] of Object.entries(byType)) {
    console.log(`  ${k.padEnd(20)} count=${String(s.count).padStart(4)}  gross=$${s.gross.toFixed(2).padStart(10)}  thei=$${s.thei.toFixed(2).padStart(10)}  bsi=$${s.bsi.toFixed(2).padStart(10)}  payable=$${s.payable.toFixed(2).padStart(10)}`);
  }

  // Split decisions
  const splitTrue = records.filter(r => r.splitApplies);
  const splitFalse = records.filter(r => !r.splitApplies);
  console.log(`\nSPLIT LOGIC:`);
  console.log(`  Split applies (50/50 with BSI): ${splitTrue.length} rows`);
  console.log(`  Split does NOT apply:           ${splitFalse.length} rows`);

  // Unique agents
  const byAgent = {};
  for (const r of records) {
    if (!byAgent[r.agent]) byAgent[r.agent] = 0;
    byAgent[r.agent]++;
  }
  console.log(`\nUNIQUE AGENTS (${Object.keys(byAgent).length}):`);
  Object.entries(byAgent).sort((a,b) => b[1] - a[1]).forEach(([a, n]) => {
    console.log(`  ${a.padEnd(28)} ${n} rows`);
  });

  // First 5 records
  console.log(`\nFIRST 5 RECORDS:`);
  records.slice(0, 5).forEach((r, i) => {
    console.log(`${i+1}. ${r.agent.padEnd(20)} | ${r.carrier.padEnd(20)} | ${r.client.padEnd(25)} | ${r.classification.padEnd(15)} | gross=$${(r.grossCommission||0).toFixed(2)} | thei=$${(r.theiShare||0).toFixed(2)} | bsi=$${(r.bsiShare||0).toFixed(2)} | payable=$${(r.producerPayable||0).toFixed(2)} | split=${r.splitApplies}`);
  });
}

main().catch(e => { console.error(e); process.exit(1); });
