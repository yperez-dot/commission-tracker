'use strict';

const path = require('path');
const XLSX = require('xlsx');
const {
  isHealthSpringMedicareFilename,
  isHealthSpringMedicareWorkbook,
  parseHealthSpringMedicareRows,
  classifyHealthSpringRow,
} = require('../healthSpringMedicareXlsx');

const FIX = path.join(__dirname, 'fixtures');
const FILES = {
  '202608': path.join(FIX, 'THEI.HEALTHSPRING.MEDICARE.08.2026.xlsx'),
  '202609': path.join(FIX, 'THEI.HEALTHSPRING.MEDICARE.09.2026.xlsx'),
  '202610': path.join(FIX, 'THEI.HEALTHSPRING.MEDICARE.10.2026.xlsx'),
};

const HOUSE = 'The Health Experts Insurance';

function load(file) {
  return XLSX.readFile(file);
}

function agentTotals(rows) {
  const by = {};
  for (const r of rows) {
    by[r.agent] = by[r.agent] || { n: 0, t: 0 };
    by[r.agent].n += 1;
    by[r.agent].t += r.commission;
  }
  for (const k of Object.keys(by)) by[k].t = Math.round(by[k].t * 100) / 100;
  return by;
}

describe('HealthSpring Medicare Advantage/PDP xlsx', () => {
  test('filename with MEDICARE dots still detects; content detection does not need the name', () => {
    expect(isHealthSpringMedicareFilename('THEI.HEALTHSPRING.MEDICARE.08.2026.xlsx')).toBe(true);
    expect(isHealthSpringMedicareFilename('THEI_Healthspring._07.26.91_555837_1.xlsx')).toBe(true);
    expect(isHealthSpringMedicareFilename('random.xlsx')).toBe(false);
    const wb = load(FILES['202608']);
    expect(isHealthSpringMedicareWorkbook(wb)).toBe(true);
  });

  test('renewal is not classified as New Business (substring "new")', () => {
    expect(classifyHealthSpringRow('Renewal', 'Service Fee', 4.16)).toBe('Renewal');
    expect(classifyHealthSpringRow('Renewal', 'Broker Level', 28.92)).toBe('Renewal');
    expect(classifyHealthSpringRow('Initial', 'Broker Level', 347)).toBe('New Business');
  });

  test.each([
    ['202608', 'THEI.HEALTHSPRING.MEDICARE.08.2026.xlsx'],
    ['202609', 'THEI.HEALTHSPRING.MEDICARE.09.2026.xlsx'],
    ['202610', 'THEI.HEALTHSPRING.MEDICARE.10.2026.xlsx'],
  ])('%s: 9 records / $136.48 / all Renewal; Service Fee→THEI, Broker→writer', (period, name) => {
    const wb = load(FILES[period]);
    const rows = parseHealthSpringMedicareRows(wb, name);
    expect(rows).toHaveLength(9);
    const total = Math.round(rows.reduce((s, r) => s + r.commission, 0) * 100) / 100;
    expect(total).toBeCloseTo(136.48, 2);
    expect(rows.every((r) => r.period === period)).toBe(true);
    expect(rows.every((r) => r.classification === 'Renewal')).toBe(true);
    expect(rows.every((r) => r.carrier === 'HealthSpring')).toBe(true);

    const service = rows.filter((r) => String(r.raw['Payment Description']).trim() === 'Service Fee');
    const broker = rows.filter((r) => String(r.raw['Payment Description']).trim() === 'Broker Level');
    expect(service).toHaveLength(5);
    expect(broker).toHaveLength(4);
    expect(service.every((r) => r.agent === HOUSE)).toBe(true);
    expect(service.every((r) => r.commission === 4.16)).toBe(true);
    expect(broker.every((r) => r.agent === 'Yahoska Perez')).toBe(true);
    expect(broker.every((r) => r.commission === 28.92)).toBe(true);

    const by = agentTotals(rows);
    expect(by[HOUSE].n).toBe(5);
    expect(by[HOUSE].t).toBeCloseTo(20.8, 2);
    expect(by['Yahoska Perez'].n).toBe(4);
    expect(by['Yahoska Perez'].t).toBeCloseTo(115.68, 2);
  });

  test('08.2026 Summary Balance -70.80 warns; no invented balance row', () => {
    const rows = parseHealthSpringMedicareRows(load(FILES['202608']), 'THEI.HEALTHSPRING.MEDICARE.08.2026.xlsx');
    expect(rows).toHaveLength(9);
    expect(rows.reconciliation.ok).toBe(false);
    expect(rows.reconciliation.balance).toBeCloseTo(-70.8, 2);
    expect(rows.reconciliation.summaryTotal).toBeCloseTo(65.68, 2);
    expect(rows.reconciliation.importedTotal).toBeCloseTo(136.48, 2);
    expect(rows.reconciliation.warning).toMatch(/carried balance of -70\.80/i);
    expect(rows.every((r) => Math.abs(r.commission) !== 70.8)).toBe(true);
  });

  test('09/10 have matching statement totals (no balance warning)', () => {
    for (const period of ['202609', '202610']) {
      const rows = parseHealthSpringMedicareRows(load(FILES[period]), `THEI.HEALTHSPRING.MEDICARE.${period.slice(4)}.2026.xlsx`);
      expect(rows.reconciliation.ok).toBe(true);
      expect(rows.reconciliation.balance === 0 || rows.reconciliation.balance == null).toBe(true);
      expect(rows.reconciliation.warning).toBeUndefined();
    }
  });
});

describe('package-lock sync (Railway/Cloudflare npm ci)', () => {
  test('lockfile includes yaml@2.x required by react-scripts/tailwind', () => {
    const lock = require('fs').readFileSync(path.join(__dirname, '..', '..', 'package-lock.json'), 'utf8');
    expect(lock).toMatch(/"yaml":\s*\{/);
    expect(lock).toMatch(/node_modules\/yaml/);
  });
});
