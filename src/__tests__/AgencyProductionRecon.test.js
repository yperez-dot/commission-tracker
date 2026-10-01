import React from 'react';
import { createRoot } from 'react-dom/client';
import { act, Simulate } from 'react-dom/test-utils';
import AgencyProductionRecon from '../pages/AgencyProductionRecon';
import { apiFetch } from '../api';

jest.mock('../api', () => ({ apiFetch: jest.fn() }));

const heldRows = ['AL', 'KS'].map((state, i) => ({
  rowKey: `held-${i}`, status: 'held_licensing', category: 'missing', memberState: state,
  production: { id: null, client_name: `${state} Member`, carrier: 'Aetna' },
  carrierBSI: { classification: 'Held', commission: 0, hold_reason: 'not licensed', member_state: state, payment_period: i ? '202603' : '202601' },
  expected: { amount: null, label: 'Unknown' },
}));

let container, root;
beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  apiFetch.mockImplementation(async (path) => path.endsWith('/periods')
    ? { periods: [{ period: '202603', label: 'Mar 2026' }], defaultPeriod: '202603' }
    : { rows: heldRows, total: 2, counts: { missing: 2 }, scanned: { production: 0, carrierBSI: 2 }, meta: { agents: [], carriers: ['Aetna'], effectiveDates: [] } });
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  apiFetch.mockReset();
});

test('picker switches to dedicated Held path, shows State and months, then returns to single-period path', async () => {
  await act(async () => root.render(<AgencyProductionRecon />));
  const select = container.querySelector('select[aria-label="Payment period"]');
  expect([...select.options].find((o) => o.value === 'all').text).toBe('All periods');
  expect(apiFetch.mock.calls.some(([url]) => url.startsWith('/agency-production/override-recon?period=202603'))).toBe(true);
  await act(async () => { select.value = 'all'; Simulate.change(select); });
  const url = apiFetch.mock.calls.at(-1)[0];
  expect(url).toMatch(/^\/agency-production\/override-recon\/held-licensing\?/);
  expect(new URL(url, 'http://test').searchParams.get('override_status')).toBe('held_licensing');
  expect([...container.querySelectorAll('th')].some((th) => th.textContent === 'State')).toBe(true);
  const stateIndex = [...container.querySelectorAll('thead th')].findIndex((th) => th.textContent === 'State');
  expect([...container.querySelectorAll('tbody tr')].map((tr) => tr.children[stateIndex].textContent)).toEqual(['AL', 'KS']);
  expect(container.textContent).toContain('Jan 2026');
  expect(container.textContent).toContain('Mar 2026');
  await act(async () => { select.value = '202603'; Simulate.change(select); });
  expect(apiFetch.mock.calls.at(-1)[0]).toMatch(/^\/agency-production\/override-recon\?period=202603&/);
});
