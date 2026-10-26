import React from 'react';
import { createRoot } from 'react-dom/client';
import { act, Simulate } from 'react-dom/test-utils';
import Payroll from '../pages/Payroll';
import { apiFetch, apiDownload } from '../api';

jest.mock('../api', () => ({ apiFetch: jest.fn(), apiDownload: jest.fn(), apiUpload: jest.fn() }));

const admin = { role: 'admin', agency: 'thei', name: 'Admin' };

function mockApi() {
  apiFetch.mockImplementation(async (path) => {
    if (path.startsWith('/records/filters')) return { periods: ['202607', '202608', '202609'] };
    if (path.startsWith('/records')) return { records: [], total: 0 };
    if (path.startsWith('/override-statements/types')) return { types: [{ id: 'thei_bsi', label: 'THEI. BSI Statement' }, { id: 'bsi_override', label: 'BSI Medicare Overrides' }] };
    if (path.startsWith('/override-statements/periods')) return { periods: [{ period: '202609' }, { period: '202608' }] };
    if (path.startsWith('/override-statements/preview')) {
      return {
        periodLabel: '09.2026',
        statementCount: 1,
        grandTotal: 12.5,
        statements: [{ payee: 'House Payee', lineCount: 1, total: 12.5, lines: [] }],
      };
    }
    if (path.startsWith('/payroll-close/meta')) return { isStaff: true, canUnlock: true, paymentMethods: [], adjustmentCategories: [], payers: [] };
    if (path.startsWith('/payroll-close/period')) return { locks: [], adjustments: [] };
    if (path.startsWith('/payee-statements/compare')) return { liveTotal: 0, issuedTotal: null };
    if (path.startsWith('/payee-statements')) return [];
    if (path.startsWith('/payroll/payout-history')) return { history: [] };
    if (path.startsWith('/payroll/payout-status')) return { paid: {}, dates: {}, amounts: {} };
    return {};
  });
}

let container, root;
beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  mockApi();
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  apiFetch.mockReset();
  apiDownload.mockReset();
});

async function flush() {
  for (let i = 0; i < 5; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { await Promise.resolve(); });
  }
}

test('Statements page: one month picker, agent statements first, house statements second', async () => {
  await act(async () => root.render(<Payroll user={admin} initialTab="overrides" onNavigate={() => {}} />));
  await flush();
  expect(container.querySelector('.page-title').textContent).toBe('Statements');
  const month = container.querySelector('select[aria-label="Statements month"]');
  expect(month.value).toBe('202609');
  // the house panel has no period dropdown of its own
  expect([...container.querySelectorAll('.form-label')].map((l) => l.textContent)).not.toContain('Period');

  const agent = container.querySelector('[data-section="agent-statements"]');
  const house = container.querySelector('[data-section="house-statements"]');
  expect(agent && house).toBeTruthy();
  // eslint-disable-next-line no-bitwise
  expect(agent.compareDocumentPosition(house) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

  const text = container.textContent;
  for (const label of ['Lina Hernandez', 'Christian Munoz', 'Horacio Mendieta']) expect(text).toContain(label);
  expect(text).toContain('Issue statement');
  expect(text).toContain('Save BSI copy');
  expect(text).toContain('Lina compensation Excel');
  expect(text).toContain('Export all types');
  expect(text).toContain('Total Payable');
  expect(text).toContain('Sent to commissions');
  // type picker shows the house statement names; no help paragraphs on the page
  expect(text).toContain('THEI. BSI Statement');
  expect(text).toContain('BSI Medicare Overrides');
  expect(container.querySelector('.page-sub')).toBeNull();
  expect(text).not.toMatch(/separate reports|payment cycles|freeze what you paid|Current statement.{0,5}downloads/);

  // house panel follows the page month
  expect(apiFetch.mock.calls.some(([u]) => u.startsWith('/override-statements/preview') && u.includes('period=202609'))).toBe(true);
  expect(apiFetch.mock.calls.some(([u]) => u === '/payee-statements?period=202609')).toBe(true);

  // current (possibly negative) agent statement + Lina Excel downloads
  const btn = (label) => [...container.querySelectorAll('button')].filter((b) => b.textContent === label);
  await act(async () => { Simulate.click(btn('Current statement')[2]); });
  expect(apiDownload.mock.calls.at(-1)[0]).toBe('/payee-statements/preview-download?payee=horacio-mendieta&period=202609');
  await act(async () => { Simulate.click(btn('Lina compensation Excel')[0]); });
  expect(apiDownload.mock.calls.at(-1)[0]).toBe('/lina-statements/export?period=202609');

  // changing the month moves both sections
  await act(async () => { month.value = '202608'; Simulate.change(month); });
  await flush();
  expect(apiFetch.mock.calls.some(([u]) => u === '/payee-statements?period=202608')).toBe(true);
  expect(apiFetch.mock.calls.some(([u]) => u.startsWith('/override-statements/preview') && u.includes('period=202608'))).toBe(true);
});

test('Statements page opens on the month passed in from Agent Payouts', async () => {
  await act(async () => root.render(<Payroll user={admin} initialTab="overrides" initialPeriod="202608" onNavigate={() => {}} />));
  await flush();
  expect(container.querySelector('select[aria-label="Statements month"]').value).toBe('202608');
});

test('Agent Payouts no longer shows the statements card, only a link to Statements', async () => {
  const onNavigate = jest.fn();
  await act(async () => root.render(<Payroll user={admin} initialTab="payroll" onNavigate={onNavigate} />));
  await flush();
  expect(container.textContent).not.toContain('Issue statement');
  expect(container.textContent).not.toContain('Save BSI copy');
  const note = container.querySelector('[data-testid="statements-moved-note"]');
  expect(note).toBeTruthy();
  await act(async () => { Simulate.click(note.querySelector('button')); });
  expect(onNavigate).toHaveBeenCalledWith('payroll-overrides', { period: '202609' });
});
