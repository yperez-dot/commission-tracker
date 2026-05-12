// Local test harness for the BSI PDF parser.
// Strips out Express/Multer parts and just runs parseBSIPDF on a file.

// Stub env so derivePlanType etc work
process.env.NODE_ENV = 'test';

const path = require('path');
const fs = require('fs');
const pdfParse = require('pdf-parse');
const { normalizeAgentName } = require('./routes/normalize');

// Inline the helpers we need from routes/files.js (avoid loading the full
// Express router which requires DB connections etc.)

// ─── BSI split rules ────────────────────────────────────────────────────────
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
  // Corrected logic 2026-05-12:
  //   - Medicare always splits 50/50 with BSI (every agent, no exceptions)
  //   - ACA never splits with BSI
  //   - The NO_SPLIT_AGENTS list is for producer_payable only, not the split decision
  const car = String(carrier || '').toLowerCase().trim();
  if (ACA_CARRIERS_LIST.some(c => car.includes(c))) return false;
  return true;
}

function isAcaAgencyPaysProducer(carrier) {
  const car = String(carrier || '').toLowerCase().trim();
  return ACA_AGENCY_PAYS_PRODUCER.some(c => car.includes(c));
}

function normalizeBSICarrier(c) {
  const lc = String(c || '').toLowerCase();
  if (lc.includes('united') || lc.includes('uhc')) return 'UnitedHealthcare';
  if (lc.includes('humana')) return 'Humana';
  if (lc.includes('aetna')) return 'Aetna';
  if (lc.includes('devoted')) return 'Devoted';
  return c;
}

function derivePlanType(carrier) {
  if (carrier === 'UnitedHealthcare') return 'UnitedHealthcare Med Adv';
  if (carrier === 'Humana') return 'Humana Med Adv';
  if (carrier === 'Aetna') return 'Aetna MAPD';
  if (carrier === 'Devoted') return 'Devoted Med Adv';
  return carrier;
}

// ─── The BSI parser itself ──────────────────────────────────────────────────
async function parseBSIPDF(filePath, filename) {
  const records = [];
  try {
    const dataBuffer = fs.readFileSync(filePath);
    const data = await pdfParse(dataBuffer);
    const text = data.text;

    const periodMatch = text.match(/(JANUARY|FEBRUARY|MARCH|APRIL|MAY|JUNE|JULY|AUGUST|SEPTEMBER|OCTOBER|NOVEMBER|DECEMBER)\s+STATEMENT\s+(\d{4})/i);
    const monthMap = { JANUARY:'01', FEBRUARY:'02', MARCH:'03', APRIL:'04', MAY:'05', JUNE:'06', JULY:'07', AUGUST:'08', SEPTEMBER:'09', OCTOBER:'10', NOVEMBER:'11', DECEMBER:'12' };
    const period = periodMatch ? `${periodMatch[2]}${monthMap[periodMatch[1].toUpperCase()]}` : 'Unknown';

    const sectionRegex = /Detailed Compensation Statement\s*\(([^)]+)\)/gi;
    const sections = [];
    let m;
    while ((m = sectionRegex.exec(text)) !== null) {
      sections.push({ rawCarrier: m[1].trim(), startIdx: m.index });
    }

    for (let si = 0; si < sections.length; si++) {
      const { rawCarrier, startIdx } = sections[si];
      const endIdx = (si + 1 < sections.length) ? sections[si + 1].startIdx : text.length;
      const sectionText = text.slice(startIdx, endIdx);

      let carrier = rawCarrier.toUpperCase().trim();
      if (carrier === 'UHC' || carrier.includes('UNITED')) carrier = 'UnitedHealthcare';
      else if (carrier.includes('HUMANA')) carrier = 'Humana';
      else if (carrier === 'AETNA') carrier = 'Aetna';
      else if (carrier.includes('DEVOTED')) carrier = 'Devoted';
      else carrier = normalizeBSICarrier(rawCarrier);

      // The BSI PDF extracts records in TWO different layouts depending on carrier:
      //
      // LAYOUT A (UHC section): 3-line per record
      //   Line 1: AGENT_NAME
      //   Line 2: CARRIER
      //   Line 3: POLICY#CLIENT_NAMEMM/DD/YYYY-?$AMOUNT
      //
      // LAYOUT B (Humana / Aetna sections): 1-line per record (everything smushed)
      //   AGENT_NAMECARRIERPOLICY#CLIENT_NAMEMM/DD/YYYY-?$AMOUNT
      //
      // We try both and merge the results.

      const lines = sectionText.split('\n').map(l => l.trim()).filter(Boolean);
      const carrierPattern = /^(UNITED\s+HEA?L?T?H?\s+CARE|HUMANA|AETNA|DEVOTED)\s*$/i;
      // Policy formats observed across BSI sections:
      //   UHC:    9-digit number, occasionally with a single letter prefix (e.g. 933986247, 134593474)
      //   Humana: complex codes ending in _PPO/_HMO/_MA/_PDP (e.g. 7A14DD4NF93_MA, 00026003927K_PPO)
      //   Aetna:  NG-prefixed long numbers (e.g. NG101194462000)
      //
      // We use a non-greedy match anchored to digit-heavy starts, terminating either:
      //   (a) at an _XYZ suffix (humana/aetna LOB suffix), OR
      //   (b) at the boundary where the next char is a CAPITAL LETTER that starts the client name.
      //
      // Practical pattern (in order of attempt):
      //   - Letter+digits ending in _LOBcode (Humana / Aetna)
      //   - 9-15 pure digits (UHC) — use a lookahead for next char being capital letter
      const policyAlternatives = [
        '[A-Z0-9]{6,15}_[A-Z]{2,5}',          // 7A14DD4NF93_MA, 00026003927K_PPO, 5X20TJ8CX00_MA
        '[A-Z]{2,3}\\d{8,15}',                // NG101194462000
        '\\d{9,15}',                          // 933986247
        '[A-Z]\\d{6,12}',                     // legacy alphanumeric
        '[A-Z]\\d{8,12}',                     // A12345678
      ];
      const policyChars = `(?:${policyAlternatives.join('|')})`;
      // Anchor client name at non-digit start so we don't eat digits into it.
      const dataLinePattern = new RegExp(`^(${policyChars})([A-Z][A-Z\\s,'\\.\\-]+?)(\\d{2}\\/\\d{2}\\/\\d{4})(-?\\$[\\d,]+\\.\\d{2})$`);

      // For single-line records, the carrier is embedded between agent and policy.
      // We detect by looking for HUMANA / AETNA / DEVOTED / UNITED HEAL?TH? CARE inside the string.
      // Strategy: match "<agent><carrier><policy><client><date><amount>" with the carrier as a hard anchor.
      const carrierAlternatives = '(?:UNITED\\s*HEA?L?T?H?\\s*CARE|HUMANA/DEVOTED|HUMANA|AETNA|DEVOTED)';
      const singleLinePattern = new RegExp(
        `^([A-Z][A-Z\\s,'\\.\\-]+?)(${carrierAlternatives})(${policyChars})([A-Z][A-Z\\s,'\\.\\-]+?)(\\d{2}\\/\\d{2}\\/\\d{4})(-?\\$[\\d,]+\\.\\d{2})$`,
        'i'
      );

      const parsedRows = [];

      // First pass: try the 3-line LAYOUT A
      const consumedIndices = new Set();
      for (let i = 0; i < lines.length - 2; i++) {
        const lineA = lines[i];
        const lineB = lines[i + 1];
        const lineC = lines[i + 2];
        if (!carrierPattern.test(lineB)) continue;
        if (!/^[A-Z][A-Z\s,'\.\-]+$/.test(lineA)) continue;
        const dm = lineC.match(dataLinePattern);
        if (!dm) continue;
        parsedRows.push({
          agentRaw: lineA,
          policyNumber: dm[1],
          clientRaw: dm[2],
          effectiveDate: dm[3],
          amountStr: dm[4],
        });
        consumedIndices.add(i);
        consumedIndices.add(i + 1);
        consumedIndices.add(i + 2);
        i += 2;
      }

      // Second pass: try the smushed single-line LAYOUT B on each line that wasn't consumed
      for (let i = 0; i < lines.length; i++) {
        if (consumedIndices.has(i)) continue;
        const single = lines[i].match(singleLinePattern);
        if (!single) continue;
        parsedRows.push({
          agentRaw: single[1],
          policyNumber: single[3],
          clientRaw: single[4],
          effectiveDate: single[5],
          amountStr: single[6],
        });
      }

      for (const t of parsedRows) {
        const agentRaw = t.agentRaw.trim().replace(/\s+/g, ' ');
        const policyNumber = t.policyNumber;
        const clientRaw = t.clientRaw.trim().replace(/\s+/g, ' ');
        const effectiveDate = t.effectiveDate;
        const amountStr = t.amountStr;
        const commission = parseFloat(amountStr.replace(/[$,]/g, '')) || 0;

        if (!agentRaw || !clientRaw) continue;
        if (agentRaw.length < 3 || clientRaw.length < 3) continue;
        // Note: we allow $0.00 commissions through — they appear in real BSI
        // statements (zero-pay rows for tracking) and should NOT be silently dropped.

        const agent = normalizeAgentName(agentRaw);
        const client = clientRaw
          .split(/\s+/)
          .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
          .join(' ');
        const planType = derivePlanType(carrier);

        const isChargeback = commission < 0;
        const splitApplies = shouldSplit(agent, carrier);
        const grossCommission = commission;
        const theiShare = splitApplies ? Math.round(commission * 0.5 * 100) / 100 : commission;
        const bsiShare = splitApplies ? Math.round(commission * 0.5 * 100) / 100 : 0;
        const producerPayable = isAcaAgencyPaysProducer(carrier) ? commission : 0;
        const lob = /humana|aetna|devoted|united.?health/i.test(carrier) ? 'MA' : 'Unknown';

        records.push({
          agent,
          carrier,
          planType,
          client,
          effectiveDate,
          commission: theiShare,
          classification: isChargeback ? 'Chargeback' : 'Agency Override',
          period,
          policyNumber,
          payee: 'BSI',
          source: 'BSI',
          policyWrittenDate: effectiveDate,
          grossCommission,
          theiShare,
          bsiShare,
          producerPayable,
          splitApplies,
          lob,
          _agentRaw: agentRaw,
          _clientRaw: clientRaw,
          _rawCarrier: rawCarrier,
        });
      }
    }
  } catch (err) {
    console.error('parseBSIPDF error:', err.message);
  }
  return records;
}

// ─── Run the test ───────────────────────────────────────────────────────────
async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error('Usage: node test-bsi-parser.js <path-to-bsi.pdf>');
    process.exit(1);
  }
  console.log(`\nParsing: ${path.basename(filePath)}\n`);

  const records = await parseBSIPDF(filePath, path.basename(filePath));

  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`TOTAL RECORDS PARSED: ${records.length}`);
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Per-carrier summary
  const byCarrier = {};
  for (const r of records) {
    if (!byCarrier[r.carrier]) byCarrier[r.carrier] = { count: 0, gross: 0, theiNet: 0, chargebacks: 0 };
    byCarrier[r.carrier].count++;
    byCarrier[r.carrier].gross += r.grossCommission;
    byCarrier[r.carrier].theiNet += r.theiShare;
    if (r.commission < 0) byCarrier[r.carrier].chargebacks++;
  }

  console.log('PER-CARRIER SUMMARY:');
  console.log('Carrier               Rows  Gross         THEI Share    Chargebacks');
  console.log('────────────────────────────────────────────────────────────────────');
  for (const [c, s] of Object.entries(byCarrier)) {
    console.log(
      `${c.padEnd(22)}${String(s.count).padStart(4)}  $${s.gross.toFixed(2).padStart(11)}  $${s.theiNet.toFixed(2).padStart(11)}  ${s.chargebacks}`
    );
  }

  // First 10 records
  console.log('\n\nFIRST 10 RECORDS:');
  console.log('───────────────────────────────────────────────────────────────────────');
  records.slice(0, 10).forEach((r, i) => {
    console.log(
      `${i+1}. ${r.agent.padEnd(22)} | ${r.carrier.padEnd(20)} | ${r.client.padEnd(30)} | ${r.effectiveDate} | gross $${r.grossCommission.toFixed(2)} | THEI $${r.theiShare.toFixed(2)} | split=${r.splitApplies}`
    );
  });

  // Check BROKER SOCIETY -> Alba Hernandez mapping worked
  console.log('\n\nBROKER SOCIETY → ALBA HERNANDEZ MAPPING CHECK:');
  const albaRows = records.filter(r => r.agent === 'Alba Hernandez');
  console.log(`Found ${albaRows.length} rows credited to Alba Hernandez`);
  if (albaRows.length) {
    console.log('First 3 examples:');
    albaRows.slice(0, 3).forEach(r => {
      console.log(`  agent_raw="${r._agentRaw}" → agent="${r.agent}" | client="${r.client}" | $${r.grossCommission.toFixed(2)}`);
    });
  }

  // Check split logic
  console.log('\n\nSPLIT LOGIC CHECK:');
  const splitTrue = records.filter(r => r.splitApplies).length;
  const splitFalse = records.filter(r => !r.splitApplies).length;
  console.log(`  splitApplies=true:  ${splitTrue} rows (50/50 with BSI)`);
  console.log(`  splitApplies=false: ${splitFalse} rows (THEI keeps 100%)`);

  const noSplitAgents = records.filter(r => !r.splitApplies);
  if (noSplitAgents.length > 0) {
    console.log('\n  Agents marked as "no split":');
    const uniqueAgents = [...new Set(noSplitAgents.map(r => r.agent))];
    uniqueAgents.forEach(a => {
      const count = noSplitAgents.filter(r => r.agent === a).length;
      console.log(`    - ${a}: ${count} rows`);
    });
  }

  // Show unique agents to spot normalization issues
  console.log('\n\nUNIQUE AGENT NAMES PARSED:');
  const uniqueAgents = [...new Set(records.map(r => r.agent))].sort();
  uniqueAgents.forEach(a => {
    const rows = records.filter(r => r.agent === a);
    const gross = rows.reduce((s, r) => s + r.grossCommission, 0);
    console.log(`  ${a.padEnd(28)} ${String(rows.length).padStart(3)} rows  $${gross.toFixed(2)}`);
  });

  // Check for "raw" agent names that didn't normalize
  console.log('\n\nAGENT NAMES THAT MIGHT NEED NORMALIZATION:');
  const unrecognized = records.filter(r =>
    r.agent !== r._agentRaw &&  // Not the same as raw (normalization happened)
    /[A-Z],/.test(r.agent)       // Still has "LAST, FIRST" format
  );
  if (unrecognized.length === 0) {
    console.log('  None found — all agent names cleaned up nicely.');
  } else {
    [...new Set(unrecognized.map(r => `${r._agentRaw} → ${r.agent}`))].forEach(s => console.log(`  ${s}`));
  }
}

main().catch(e => { console.error(e); process.exit(1); });
