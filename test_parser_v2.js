const fs = require('fs');
const pdfParse = require('pdf-parse');

const filePath = '/home/medicare-ai-agent/.openclaw/media/inbound/Medicare_Statement-THE-April_3---b2af98bf-401b-47bf-8e1c-81803907df1a.pdf';

function derivePlanType(carrier, rawPlanType, policyNumber, planName) {
  return 'MAPD';
}

async function parseTHEStatementPDF(filePath, filename) {
  const records = [];
  if (!pdfParse) { console.error('pdf-parse not installed'); return records; }
  try {
    const dataBuffer = fs.readFileSync(filePath);
    const data = await pdfParse(dataBuffer);
    const text = data.text;
    const lines = text.split('\n').map(l => l.trim());

    const toTitleCase = (str) =>
      str.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());

    const normalizeAgent = (raw) => {
      raw = raw.trim();
      if (raw.includes(',')) {
        const parts = raw.split(',');
        return toTitleCase(`${parts[1].trim()} ${parts[0].trim()}`);
      }
      return toTitleCase(raw);
    };

    const dateToPeriod = (dateStr) => {
      const parts = dateStr.trim().split('/');
      return parts.length === 3 ? parts[2] + parts[0] : null;
    };

    let currentCarrier = null;
    let carrierFormat = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (line.includes('Detailed Compensation Statement (UHC)')) {
        currentCarrier = 'UnitedHealthcare';
        carrierFormat = 'multi-line';
        continue;
      }
      if (line.includes('Detailed Compensation Statement (HUMANA)') || line.includes('Detailed Compensation Statement(HUMANA)')) {
        currentCarrier = 'Humana';
        carrierFormat = 'single-line';
        continue;
      }
      if (line.includes('Detailed Compensation Statement (AETNA)') || line.includes('Detailed Compensation Statement(AETNA)')) {
        currentCarrier = 'Aetna';
        carrierFormat = 'single-line';
        continue;
      }

      if (!currentCarrier) continue;

      if (/^Agent\s*Company|^Balance:|^CARRIER SUMMARY|^TOTAL|^APRIL STATEMENT|^UNITED HEALTH CARE\s+\(|^HUMANA\/DEVOTED|^AETNA\s+\(/i.test(line)) continue;

      if (carrierFormat === 'multi-line') {
        if (line === 'UNITED HEALTH CARE') {
          if (i + 3 >= lines.length) continue;

          const dataLine = lines[i + 1];
          const amountLine = lines[i + 2];
          const agentLine = lines[i + 3];

          const amountMatch = amountLine.match(/^(-?\$[\d,]+\.\d{2})$/);
          if (!amountMatch) continue;
          const commission = parseFloat(amountMatch[1].replace(/[$,]/g, '')) || 0;

          const dateMatch = dataLine.match(/(\d{2}\/\d{2}\/\d{4})$/);
          if (!dateMatch) continue;
          const effectiveDate = dateMatch[1];
          const period = dateToPeriod(effectiveDate);

          const beforeDate = dataLine.slice(0, dateMatch.index);
          // UHC policies are numeric only
          const policyMatch = beforeDate.match(/^(\d+)(.+)$/);
          if (!policyMatch) continue;
          const policyNumber = policyMatch[1];
          const client = policyMatch[2].trim();

          const agent = normalizeAgent(agentLine);

          records.push({
            agent,
            carrier: currentCarrier,
            planType: derivePlanType(currentCarrier, 'MAPD', policyNumber, ''),
            client: toTitleCase(client),
            effectiveDate,
            premium: 0,
            commission,
            classification: commission < 0 ? 'Chargeback' : 'Agency Override',
            period,
            policyNumber,
            payee: 'THE',
            raw: {}
          });

          i += 3;
        }
      } else if (carrierFormat === 'single-line') {
        const carrierToken = currentCarrier === 'Humana' ? 'HUMANA' : 'AETNA';
        if (!line.includes(carrierToken)) continue;

        const amountMatch = line.match(/(-?\$[\d,]+\.\d{2})$/);
        if (!amountMatch) continue;
        const commission = parseFloat(amountMatch[1].replace(/[$,]/g, '')) || 0;

        const beforeAmount = line.slice(0, amountMatch.index);
        const dateMatch = beforeAmount.match(/(\d{2}\/\d{2}\/\d{4})$/);
        if (!dateMatch) continue;
        const effectiveDate = dateMatch[1];
        const period = dateToPeriod(effectiveDate);

        const beforeDate = beforeAmount.slice(0, dateMatch.index);
        const carrierIdx = beforeDate.indexOf(carrierToken);
        if (carrierIdx === -1) continue;

        const agentPart = beforeDate.slice(0, carrierIdx).trim();
        const afterCarrier = beforeDate.slice(carrierIdx + carrierToken.length);

        // Humana/Aetna policies are uppercase alphanumeric + underscore
        const policyMatch = afterCarrier.match(/^([A-Z0-9_]+)(.+)$/);
        if (!policyMatch) continue;
        const policyNumber = policyMatch[1];
        const client = policyMatch[2].trim();

        records.push({
          agent: normalizeAgent(agentPart),
          carrier: currentCarrier,
          planType: derivePlanType(currentCarrier, 'MAPD', policyNumber, ''),
          client: toTitleCase(client),
          effectiveDate,
          premium: 0,
          commission,
          classification: commission < 0 ? 'Chargeback' : 'Agency Override',
          period,
          policyNumber,
          payee: 'THE',
          raw: {}
        });
      }
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
  
  console.log('\n🔍 Sample client names (FIXED):');
  const uhcSample = records.find(r => r.carrier === 'UnitedHealthcare');
  const humanaSample = records.find(r => r.carrier === 'Humana');
  const aetnaSample = records.find(r => r.carrier === 'Aetna');
  if (uhcSample) console.log('UHC:', uhcSample.client, '|', uhcSample.policyNumber);
  if (humanaSample) console.log('Humana:', humanaSample.client, '|', humanaSample.policyNumber);
  if (aetnaSample) console.log('Aetna:', aetnaSample.client, '|', aetnaSample.policyNumber);
});
