const fs = require('fs');
const pdfParse = require('pdf-parse');

const filePath = '/home/medicare-ai-agent/.openclaw/media/inbound/Medicare_Statement-THE-April_3---b2af98bf-401b-47bf-8e1c-81803907df1a.pdf';

function derivePlanType(carrier, rawPlanType, policyNumber, planName) {
  return 'MAPD';
}

// Load the new parser from files.js
async function parseTHEStatementPDF(filePath, filename) {
  const records = [];
  if (!pdfParse) { console.error('pdf-parse not installed'); return records; }
  try {
    const dataBuffer = fs.readFileSync(filePath);
    const data = await pdfParse(dataBuffer);
    const text = data.text;
    const lines = text.split('\n');

    const sectionHeaders = {
      'Detailed Compensation Statement (UHC)': 'UnitedHealthcare',
      'Detailed Compensation Statement (HUMANA)': 'Humana',
      'Detailed Compensation Statement(AETNA)': 'Aetna',
      'Detailed Compensation Statement (AETNA)': 'Aetna',
    };

    const carrierTokens = [
      { token: 'UNITED HEALTH CARE', carrier: 'UnitedHealthcare' },
      { token: 'AETNA', carrier: 'Aetna' },
      { token: 'HUMANA', carrier: 'Humana' },
    ];

    const skipPatterns = [
      /^Agent\s+Company/i,
      /^Balance:/i,
      /^CARRIER SUMMARY/i,
      /^TOTAL/i,
      /STATEMENT\s+20\d{2}/i,
      /^UNITED HEALTH CARE\s+\(\$/i,
      /^HUMANA\/DEVOTED/i,
      /^AETNA\s+\(\$/i,
      /^Detailed Compensation Statement/i,
    ];

    const toTitleCase = (str) =>
      str.trim().toLowerCase().replace(/\b\w/g, c => c.toUpperCase());

    const normalizeAgent = (raw) => {
      raw = raw.trim();
      raw = raw.replace(/united\s*health\s*care.*/i, '').replace(/humana.*/i, '').replace(/aetna.*/i, '').trim();
      if (!raw) return '';
      if (raw.includes(',')) {
        const parts = raw.split(',');
        const last = parts[0].trim();
        const first = parts[1].trim();
        return toTitleCase(`${first} ${last}`);
      }
      return toTitleCase(raw);
    };

    const dateToPeriod = (dateStr) => {
      const parts = dateStr.trim().split('/');
      return parts.length === 3 ? parts[2] + parts[0] : null;
    };

    let currentCarrier = null;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      for (const [header, carrier] of Object.entries(sectionHeaders)) {
        if (trimmed.includes(header)) { currentCarrier = carrier; break; }
      }
      if (!currentCarrier) continue;
      if (skipPatterns.some(p => p.test(trimmed))) continue;

      const trailMatch = trimmed.match(/(\d{2}\/\d{2}\/\d{4})\s+(-?\$[\d,]+\.\d{2})$/);
      if (!trailMatch) continue;

      const dateStr = trailMatch[1];
      const amountStr = trailMatch[2];
      const beforeDate = trimmed.slice(0, trailMatch.index).trim();

      let agentPart = null, policyPart = null, clientPart = null;

      for (const { token } of carrierTokens) {
        const idx = beforeDate.toUpperCase().indexOf(token);
        if (idx !== -1) {
          agentPart = beforeDate.slice(0, idx).trim();
          const rest = beforeDate.slice(idx + token.length).trim();
          const spaceIdx = rest.indexOf(' ');
          if (spaceIdx > 0) {
            policyPart = rest.slice(0, spaceIdx).trim();
            clientPart = rest.slice(spaceIdx + 1).trim();
          }
          break;
        }
      }

      if (!agentPart || !policyPart || !clientPart) continue;
      if (agentPart.length > 60 || /\d/.test(agentPart)) continue;

      const commission = parseFloat(amountStr.replace(/[$,]/g, '')) || 0;
      const period = dateToPeriod(dateStr);
      const agentNormalized = normalizeAgent(agentPart);
      if (!agentNormalized) continue;

      records.push({
        agent: agentNormalized,
        carrier: currentCarrier,
        client: toTitleCase(clientPart),
        effectiveDate: dateStr,
        commission,
        period,
        policyNumber: policyPart
      });
    }
  } catch (err) {
    console.error('parseTHEStatementPDF error:', err.message);
  }
  return records;
}

parseTHEStatementPDF(filePath, 'test.pdf').then(records => {
  console.log(`✅ Total records: ${records.length}`);
  const total = records.reduce((sum, r) => sum + r.commission, 0);
  console.log(`✅ Total commission: $${total.toFixed(2)}`);
  
  const byCarrier = {};
  records.forEach(r => {
    if (!byCarrier[r.carrier]) byCarrier[r.carrier] = { count: 0, total: 0 };
    byCarrier[r.carrier].count++;
    byCarrier[r.carrier].total += r.commission;
  });
  
  console.log('\n📊 By carrier:');
  Object.entries(byCarrier).forEach(([carrier, data]) => {
    console.log(`  ${carrier}: ${data.count} records, $${data.total.toFixed(2)}`);
  });
  
  console.log('\n✅ Sample records (ALL FIXED):');
  const uhc = records.find(r => r.carrier === 'UnitedHealthcare');
  const humana = records.find(r => r.carrier === 'Humana');
  const aetna = records.find(r => r.carrier === 'Aetna');
  if (uhc) console.log(`  UHC: ${uhc.agent} | ${uhc.client} | $${uhc.commission}`);
  if (humana) console.log(`  Humana: ${humana.agent} | ${humana.client} | $${humana.commission}`);
  if (aetna) console.log(`  Aetna: ${aetna.agent} | ${aetna.client} | $${aetna.commission}`);
});
