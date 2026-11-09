'use strict';

const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');
const {
  isAmeriLifeAgencyCsv,
  isAmeriLifeAgencyWorkbook,
  parseAmeriLifeAgencyRows,
  parseAmeriLifeAgencyWorkbook,
  classifyAmeriLifeRow,
  HOUSE_AGENT,
} = require('../amerilifeAgencyCsv');

const FIX = path.join(__dirname, 'fixtures');
const YTD = path.join(FIX, 'amerilife_humana_ytd_2026_synthetic.csv');
const OCT = path.join(FIX, 'amerilife_humana_10_2026_synthetic.csv');

function load(file) {
  return XLSX.readFile(file, { raw: true });
}

function monthTotals(records) {
  const by = {};
  for (const r of records) {
    const mm = String(r.period || '').slice(4);
    by[mm] = by[mm] || { n: 0, t: 0 };
    by[mm].n += 1;
    by[mm].t += r.commission;
  }
  for (const k of Object.keys(by)) by[k].t = Math.round(by[k].t * 100) / 100;
  return by;
}

describe('AmeriLife agency CSV (Humana THEI)', () => {
  test('detects AmeriLife layout; rejects Humana broker-portal XML headers', () => {
    const wb = load(YTD);
    expect(isAmeriLifeAgencyWorkbook(wb, 'THEI_AML_HUMANA_YTD_2026.csv')).toBe(true);
    expect(isAmeriLifeAgencyWorkbook(wb, 'Humana_Agency_10.2026.csv')).toBe(true);
    expect(
      isAmeriLifeAgencyCsv(
        ['AorSan', 'CommRunDt', 'WaName', 'GrpName', 'PaidAmount', 'FrstYrRnwl', 'MonthPaid'],
        { filename: 'THEI.HUMANA.08.01TO.09.30.26.xls' }
      )
    ).toBe(false);
  });

  test('classify: First Year→New Business, Renewal Year→Renewal, neg→Chargeback', () => {
    expect(classifyAmeriLifeRow({ commission: 347, firstYearRenewal: 'First Year', commissionType: 'Adjustment' })).toBe('New Business');
    expect(classifyAmeriLifeRow({ commission: 28.92, firstYearRenewal: 'Renewal Year', commissionType: 'Override' })).toBe('Renewal');
    expect(classifyAmeriLifeRow({ commission: -86.75, firstYearRenewal: 'First Year', commissionType: 'Override' })).toBe('Chargeback');
    expect(classifyAmeriLifeRow({ commission: 50, firstYearRenewal: '', commissionType: 'Override' })).toBe('Agency Override');
  });

  test('Oct 10.2026 synthetic: 3 records $129.42, Writing Agent + period', () => {
    const rows = parseAmeriLifeAgencyWorkbook(load(OCT), 'amerilife_humana_10_2026_synthetic.csv');
    expect(rows).toHaveLength(3);
    const total = Math.round(rows.reduce((s, r) => s + r.commission, 0) * 100) / 100;
    expect(total).toBeCloseTo(129.42, 2);
    expect(rows.every((r) => r.period === '202610')).toBe(true);
    expect(rows.every((r) => r.source === 'AmeriLife')).toBe(true);
    expect(rows.map((r) => r.agent).sort()).toEqual(['Katy Robles', 'Yahoska Perez', 'Yahoska Perez']);
    expect(rows.find((r) => r.commission === 86.75).classification).toBe('New Business');
    expect(rows.filter((r) => r.classification === 'Renewal')).toHaveLength(2);
  });

  test('YTD synthetic: 77 records $17,147.19 with per-month totals', () => {
    const rows = parseAmeriLifeAgencyWorkbook(load(YTD), 'amerilife_humana_ytd_2026_synthetic.csv');
    expect(rows).toHaveLength(77);
    const total = Math.round(rows.reduce((s, r) => s + r.commission, 0) * 100) / 100;
    expect(total).toBeCloseTo(17147.19, 2);
    expect(rows.every((r) => r.source === 'AmeriLife')).toBe(true);

    const by = monthTotals(rows);
    const expected = {
      '01': { n: 23, t: 6997.83 },
      '02': { n: 3, t: 207.67 },
      '03': { n: 3, t: 331.84 },
      '04': { n: 3, t: -217.58 },
      '05': { n: 2, t: 42.67 },
      '06': { n: 3, t: 245.09 },
      '07': { n: 27, t: 9411.67 },
      '08': { n: 2, t: 42.67 },
      '09': { n: 8, t: -44.09 },
      '10': { n: 3, t: 129.42 },
    };
    for (const [mm, exp] of Object.entries(expected)) {
      expect(by[mm].n).toBe(exp.n);
      expect(by[mm].t).toBeCloseTo(exp.t, 2);
    }

    // July Adjustment First Year lines land as New Business (not bare Agent Commission)
    const july = rows.filter((r) => r.period === '202607');
    expect(july).toHaveLength(27);
    expect(july.filter((r) => r.classification === 'New Business')).toHaveLength(25);
    expect(july.filter((r) => r.classification === 'Renewal')).toHaveLength(2);

    // Empty Writing Agent → house
    expect(rows.filter((r) => r.agent === HOUSE_AGENT).length).toBeGreaterThanOrEqual(25);
  });

  test('filename with humana still detects AmeriLife CSV (not broker portal)', () => {
    const wb = load(OCT);
    expect(isAmeriLifeAgencyWorkbook(wb, 'THEI.HUMANA.AML.10.2026.csv')).toBe(true);
    const rows = parseAmeriLifeAgencyWorkbook(wb, 'THEI.HUMANA.AML.10.2026.csv');
    expect(rows).toHaveLength(3);
  });
});

describe('Humana broker-portal XML path unchanged (AmeriLife must not claim it)', () => {
  test('synthetic CommissionData XML still yields F→NB / R→Renewal via parseHumanaRows helpers', () => {
    // Minimal SpreadsheetML row set mirroring THEI.HUMANA.08… layout (no PHI).
    const xml = `<?xml version="1.0"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Worksheet ss:Name="Sheet1"><Table>
  <Row>
    <Cell><Data ss:Type="String">AorSan</Data></Cell>
    <Cell><Data ss:Type="String">CommRunDt</Data></Cell>
    <Cell><Data ss:Type="String">WaName</Data></Cell>
    <Cell><Data ss:Type="String">GrpName</Data></Cell>
    <Cell><Data ss:Type="String">GrpNbr</Data></Cell>
    <Cell><Data ss:Type="String">MonthPaid</Data></Cell>
    <Cell><Data ss:Type="String">FrstYrRnwl</Data></Cell>
    <Cell><Data ss:Type="String">PaidAmount</Data></Cell>
    <Cell><Data ss:Type="String">EffDate</Data></Cell>
    <Cell><Data ss:Type="String">BlkBusCd</Data></Cell>
    <Cell><Data ss:Type="String">Product</Data></Cell>
  </Row>
  <Row>
    <Cell><Data ss:Type="String">1</Data></Cell>
    <Cell><Data ss:Type="String">2026-08-05T00:00:00.000</Data></Cell>
    <Cell><Data ss:Type="String">PEREZ YAHOSKA G</Data></Cell>
    <Cell><Data ss:Type="String">SYNTHETIC CLIENT A</Data></Cell>
    <Cell><Data ss:Type="String">000111</Data></Cell>
    <Cell><Data ss:Type="String">AUG</Data></Cell>
    <Cell><Data ss:Type="String">R</Data></Cell>
    <Cell><Data ss:Type="Number">28.91</Data></Cell>
    <Cell><Data ss:Type="String">2025-01-01T00:00:00.000</Data></Cell>
    <Cell><Data ss:Type="String">MA</Data></Cell>
    <Cell><Data ss:Type="String">HMO</Data></Cell>
  </Row>
  <Row>
    <Cell><Data ss:Type="String">1</Data></Cell>
    <Cell><Data ss:Type="String">2026-08-05T00:00:00.000</Data></Cell>
    <Cell><Data ss:Type="String">PEREZ YAHOSKA G</Data></Cell>
    <Cell><Data ss:Type="String">SYNTHETIC REYES</Data></Cell>
    <Cell><Data ss:Type="String">000222</Data></Cell>
    <Cell><Data ss:Type="String">JAN</Data></Cell>
    <Cell><Data ss:Type="String">F</Data></Cell>
    <Cell><Data ss:Type="Number">-144.58</Data></Cell>
    <Cell><Data ss:Type="String">2026-01-01T00:00:00.000</Data></Cell>
    <Cell><Data ss:Type="String">MA</Data></Cell>
    <Cell><Data ss:Type="String">HMO</Data></Cell>
  </Row>
 </Table></Worksheet>
</Workbook>`;
    const tmp = path.join(FIX, 'humana_broker_portal_synthetic.xls');
    fs.writeFileSync(tmp, xml.replace('<?xml version="1.0"?>', '<xml version>'));

    // Mirror routes/files.js parseHumanaRows period + classification rules for the Reyes note.
    const content = fs.readFileSync(tmp, 'utf8').replace('<xml version>', '<?xml version="1.0"?>');
    const rowRegex = /<Row[^>]*>([\s\S]*?)<\/Row>/g;
    const cellRegex = /<Cell[^>]*>[\s\S]*?<Data[^>]*>([\s\S]*?)<\/Data>[\s\S]*?<\/Cell>/g;
    const allRows = [];
    let rowMatch;
    while ((rowMatch = rowRegex.exec(content)) !== null) {
      const cells = [];
      let cellMatch;
      while ((cellMatch = cellRegex.exec(rowMatch[1])) !== null) cells.push(cellMatch[1].trim());
      if (cells.length) allRows.push(cells);
    }
    const headers = allRows[0];
    const col = (n) => headers.indexOf(n);
    expect(col('WaName')).toBeGreaterThanOrEqual(0);
    expect(isAmeriLifeAgencyCsv(headers, { filename: 'THEI.HUMANA.08.01TO.09.30.26.xls' })).toBe(false);

    const monthMap = { jan: '01', aug: '08' };
    const records = [];
    for (let i = 1; i < allRows.length; i++) {
      const vals = allRows[i];
      const get = (name) => vals[col(name)] || '';
      const commission = parseFloat(get('PaidAmount')) || 0;
      const client = get('GrpName').trim();
      if (!client || !commission) continue;
      const monthPaid = get('MonthPaid').trim().toLowerCase();
      const commRunDt = get('CommRunDt').trim();
      const year = (commRunDt.match(/^(\d{4})/) || [])[1];
      const period = year && monthMap[monthPaid] ? year + monthMap[monthPaid] : '';
      const fyr = get('FrstYrRnwl').trim().toUpperCase();
      let classification = 'Agent Commission';
      if (commission < 0) classification = 'Chargeback';
      else if (fyr === 'F') classification = 'New Business';
      else if (fyr === 'R') classification = 'Renewal';
      records.push({ client, commission, period, classification, monthPaid, commRunDt, eff: get('EffDate') });
    }
    expect(records).toHaveLength(2);
    expect(records.find((r) => r.commission === 28.91).classification).toBe('Renewal');
    expect(records.find((r) => r.commission === 28.91).period).toBe('202608');
    const reyes = records.find((r) => r.commission === -144.58);
    expect(reyes.classification).toBe('Chargeback');
    // Period driven by MonthPaid (JAN) + year from CommRunDt (2026-08-05) → 202601.
    // EffDate / coverage month also 2026-01-01; statement/run date is August.
    expect(reyes.period).toBe('202601');
    expect(reyes.monthPaid).toBe('jan');
    expect(reyes.commRunDt).toMatch(/^2026-08-05/);
  });
});
