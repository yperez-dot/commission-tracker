import React from 'react';
import { createRoot } from 'react-dom/client';
import { act, Simulate } from 'react-dom/test-utils';
import { PayModal, FALLBACK_META, PaymentRecords } from '../components/PayrollClose';
import Payroll from '../pages/Payroll';
import { apiFetch } from '../api';

jest.mock('../api', () => ({ apiFetch: jest.fn(), apiDownload: jest.fn(), apiUpload: jest.fn() }));

const staff = { role: 'admin', agency: 'thei', name: 'Staff User' };

function mockApi() {
  apiFetch.mockImplementation(async (path) => {
    if (path.startsWith('/records/filters')) return { periods: ['202609'] };
    if (path.startsWith('/records')) return { records: [], total: 0 };
    if (path.startsWith('/payee-statements')) return [];
    if (path.startsWith('/payroll/payout-history')) return { history: [] };
    if (path.startsWith('/payroll/payout-status')) return { paid: {}, dates: {}, amounts: {} };
    if (path.startsWith('/payroll-close/meta')) return FALLBACK_META;
    if (path.startsWith('/payroll-close/payments')) return [];
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
});

async function flush() {
  for (let i = 0; i < 5; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { await Promise.resolve(); });
  }
}

test('PayModal is a Mark sent to commissions flow with payable prefilled', async () => {
  const onSubmit = jest.fn();
  await act(async () => root.render(
    <PayModal
      agent="Test Agent"
      period="09.2026"
      payable={123.45}
      net={123.45}
      meta={FALLBACK_META}
      busy={false}
      error=""
      onCancel={() => {}}
      onSubmit={onSubmit}
    />
  ));
  const text = container.textContent;
  expect(text).toContain('Mark sent to commissions — Test Agent');
  expect(text).not.toContain('Record payment');
  expect(text).toContain('Date sent');
  expect(text).not.toContain('Pay date');
  expect(text).toContain('Mark sent & lock month');
  expect(text).not.toContain('Mark paid & lock');
  expect(text).not.toContain('Lock month ($0 paid)');
  expect(text).not.toMatch(/Check #/);

  const method = container.querySelector('select[aria-label="Method"]');
  expect(method.value).toBe('sent_to_commissions');
  expect([...method.options].map((o) => o.value)).toEqual([
    'sent_to_commissions', 'check', 'ach', 'zelle', 'other',
  ]);
  expect([...method.options].map((o) => o.textContent)[0]).toBe('Sent to commissions');

  const amount = container.querySelector('input[aria-label="Amount"]');
  expect(amount.value).toBe('123.45');
  expect(amount.value).not.toBe('0.00');

  await act(async () => {
    Simulate.click([...container.querySelectorAll('button')].find((b) => b.textContent === 'Mark sent & lock month'));
  });
  expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
    method: 'sent_to_commissions',
    amount: 123.45,
  }));
});

test('PayModal Check # appears only when Check is chosen; amount can stay prefilled', async () => {
  await act(async () => root.render(
    <PayModal
      agent="Test Agent"
      period="09.2026"
      payable={80}
      net={80}
      meta={FALLBACK_META}
      busy={false}
      error=""
      onCancel={() => {}}
      onSubmit={() => {}}
    />
  ));
  expect(container.textContent).not.toMatch(/Check #/);
  const method = container.querySelector('select[aria-label="Method"]');
  await act(async () => { method.value = 'check'; Simulate.change(method); });
  expect(container.textContent).toMatch(/Check #/);
  expect(container.querySelector('input[aria-label="Amount"]').value).toBe('80.00');
});

test('Agent Payouts and Payment History use Sent wording, not Paid / Paid out / Record payment', async () => {
  await act(async () => root.render(<Payroll user={staff} initialTab="payroll" onNavigate={() => {}} />));
  await flush();
  const payouts = container.textContent;
  expect(payouts).toContain('Send producer statements to commissions');
  expect(payouts).toContain('Not sent');
  expect(payouts).toContain('Sent');
  expect(payouts).toContain('Check mark = sent to commissions');
  expect(payouts).not.toContain('Paid out');
  expect(payouts).not.toContain('Still unpaid');
  expect(payouts).not.toContain('Record payment');
  expect(payouts).not.toContain('Unpaid agents');
  expect(payouts).not.toContain('Paid agents');

  await act(async () => root.render(<Payroll user={staff} initialTab="history" onNavigate={() => {}} />));
  await flush();
  const history = container.textContent;
  expect(history).toContain('Shared record of statements sent to commissions');
  expect(history).toContain('No sent records yet');
  expect(history).toContain('Mark agents as sent to commissions on Agent Payouts to track them here');
  expect(history).not.toContain('No payments recorded yet');
  expect(history).not.toContain('Mark agents as paid');
  expect(history).not.toContain('Date paid');
});

test('Payment records empty copy uses sent-to-commissions wording', async () => {
  await act(async () => root.render(<PaymentRecords />));
  await flush();
  const text = container.textContent;
  expect(text).toContain('Sent records');
  expect(text).toContain('How each statement was sent');
  expect(text).toContain('No sent records yet');
  expect(text).not.toContain('Payment records');
  expect(text).not.toContain('How each payout was paid');
  expect(text).not.toContain('Marking an agent paid');
});
