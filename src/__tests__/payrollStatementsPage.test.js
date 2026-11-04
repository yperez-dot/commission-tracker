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
        statements: [{
          payee: 'House Payee',
          lineCount: 1,
          total: 12.5,
          heldTotal: 4,
          hold: {
            payeeKey: 'thei',
            effectiveOnOrAfter: '2027-01-01',
            heldTotal: 4,
            heldLineCount: 2,
            heldPolicyCount: 2,
            note: 'Hold: 2027-effective overrides (2 line items across 2 policies, $4.00) are being held and will be paid in 12.2026 or 01.2027. They are not included in this statement.',
          },
          lines: [],
        }],
      };
    }
    if (path.startsWith('/payment-holds')) return { holds: [{ id: 1, payeeKey: 'thei', effectiveOnOrAfter: '2027-01-01', note: '' }] };
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
  expect([...month.options].find((o) => o.value === '202609').textContent).toBe('09.2026');
  // the house panel has no period dropdown of its own
  expect([...container.querySelectorAll('.form-label')].map((l) => l.textContent)).not.toContain('Period');

  const agent = container.querySelector('[data-section="agent-statements"]');
  const house = container.querySelector('[data-section="house-statements"]');
  expect(agent && house).toBeTruthy();
  // eslint-disable-next-line no-bitwise
  expect(agent.compareDocumentPosition(house) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

  const text = container.textContent;
  for (const label of ['Lina Hernandez', 'Christian Munoz', 'Horacio Mendieta']) expect(text).toContain(label);
  expect(text).toContain('Export all types');
  expect(text).toContain('Total Payable');
  expect(text).toContain('Sent to commissions');
  expect(text).not.toContain('Lina compensation Excel');
  expect(text).not.toContain('Current statement');
  // type picker shows the house statement names; no help paragraphs on the page
  expect(text).toContain('THEI. BSI Statement');
  expect(text).toContain('BSI Medicare Overrides');
  expect(text).toContain('Held $4.00');
  expect(container.querySelector('[data-testid="house-held-badge"]')).toBeTruthy();
  expect(container.querySelector('[data-testid="payment-hold-controls-thei"]')).toBeTruthy();
  expect(text).toContain('THEI payment hold');
  expect(text).toContain('Release hold');
  expect(container.querySelector('.page-sub')).toBeNull();
  expect(text).not.toMatch(/separate reports|payment cycles|freeze what you paid|Current statement.{0,5}downloads/);

  // house panel follows the page month
  expect(apiFetch.mock.calls.some(([u]) => u.startsWith('/override-statements/preview') && u.includes('period=202609'))).toBe(true);
  expect(apiFetch.mock.calls.some(([u]) => u === '/payee-statements?period=202609')).toBe(true);

  // one statement download per payee (Lina uses the same carry workbook as Chris / Horacio)
  const linaRow = container.querySelector('[data-testid="agent-statement-row-lina"]');
  const chrisRow = container.querySelector('[data-testid="agent-statement-row-christian-munoz"]');
  const horacioRow = container.querySelector('[data-testid="agent-statement-row-horacio-mendieta"]');
  const rowBtns = (el) => [...el.querySelectorAll('button')].map((b) => b.textContent);
  expect(rowBtns(linaRow)).toEqual(['Statement', 'Sent to commissions']);
  expect(rowBtns(chrisRow)).toEqual(['Statement', 'Sent to commissions']);
  expect(rowBtns(horacioRow)).toEqual(['Statement', 'Sent to commissions']);

  const more = container.querySelector('[data-testid="agent-statement-more"]');
  expect(more).toBeTruthy();
  expect(more.querySelector('summary').textContent).toBe('More');
  expect(more.textContent).toContain('Issue statement');
  expect(more.textContent).toContain('Save BSI copy');

  await act(async () => { Simulate.click([...horacioRow.querySelectorAll('button')].find((b) => b.textContent === 'Statement')); });
  expect(apiDownload.mock.calls.at(-1)[0]).toBe('/payee-statements/preview-download?payee=horacio-mendieta&period=202609');
  await act(async () => { Simulate.click([...linaRow.querySelectorAll('button')].find((b) => b.textContent === 'Statement')); });
  expect(apiDownload.mock.calls.at(-1)[0]).toBe('/payee-statements/preview-download?payee=lina&period=202609');
  expect(apiDownload.mock.calls.some(([u]) => String(u).includes('/lina-statements/export'))).toBe(false);

  // changing the month moves both sections
  await act(async () => { month.value = '202608'; Simulate.change(month); });
  await flush();
  expect(apiFetch.mock.calls.some(([u]) => u === '/payee-statements?period=202608')).toBe(true);
  expect(apiFetch.mock.calls.some(([u]) => u.startsWith('/override-statements/preview') && u.includes('period=202608'))).toBe(true);
});

test('Sent to commissions opens the date-sent modal', async () => {
  await act(async () => root.render(<Payroll user={admin} initialTab="overrides" onNavigate={() => {}} />));
  await flush();
  const linaRow = container.querySelector('[data-testid="agent-statement-row-lina"]');
  await act(async () => {
    Simulate.click([...linaRow.querySelectorAll('button')].find((b) => b.textContent === 'Sent to commissions'));
  });
  const modal = container.querySelector('[data-testid="sent-to-commissions-modal"]');
  expect(modal).toBeTruthy();
  expect(modal.textContent).toContain('Date sent');
  expect(modal.textContent).toContain('Lina Hernandez');
  expect(modal.querySelector('input[aria-label="Amount"]')).toBeNull();
  expect(modal.textContent).not.toMatch(/Check #|ACH/);
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
