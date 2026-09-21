/**
 * @jest-environment jsdom
 */
jest.mock('../api');

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import App from '../App';

global.IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('../pages/Login', () => () => <div>Login screen</div>);
jest.mock('../pages/Dashboard', () => () => <div data-testid="screen">dashboard</div>);
jest.mock('../pages/Upload', () => () => <div data-testid="screen">upload</div>);
jest.mock('../pages/AllData', () => () => <div data-testid="screen">alldata</div>);
jest.mock('../pages/MissingRenewals', () => () => <div data-testid="screen">renewals</div>);
jest.mock('../pages/Reconciliation', () => () => <div data-testid="screen">direct-recon</div>);
jest.mock('../pages/BookOfBusiness', () => () => <div data-testid="screen">bob</div>);
jest.mock('../pages/Payroll', () => ({ initialTab }) => (
  <div data-testid="screen">{`payroll:${initialTab}`}</div>
));
jest.mock('../pages/AdminUsers', () => () => <div data-testid="screen">users</div>);
jest.mock('../pages/MedicareProUpload', () => () => <div data-testid="screen">medicarepro-upload</div>);
jest.mock('../pages/AgencyProductionUpload', () => () => <div data-testid="screen">agency-production-upload</div>);
jest.mock('../pages/AgencyProductionRecon', () => () => <div data-testid="screen">agency-production-recon</div>);
jest.mock('../pages/BSIStatementsUpload', () => () => <div data-testid="screen">bsi-statements-upload</div>);
jest.mock('../pages/AgentPayoutUploads', () => () => <div data-testid="screen">agent-payout-uploads</div>);
jest.mock('../pages/PassThroughChargebacks', () => () => <div data-testid="screen">pass-through-chargebacks</div>);
jest.mock('../pages/AdpExport', () => () => <div data-testid="screen">payroll-adp</div>);

function BackButton() {
  const navigate = useNavigate();
  return <button type="button" data-testid="browser-back" onClick={() => navigate(-1)}>Back</button>;
}

function clickNav(container, label) {
  const btn = Array.from(container.querySelectorAll('button.nav-item'))
    .find((el) => el.textContent.replace(/\s+/g, ' ').includes(label));
  if (!btn) {
    throw new Error(`Nav button not found: ${label}. HTML: ${container.textContent}`);
  }
  act(() => { btn.click(); });
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('App in-app history', () => {
  let container;
  let root;

  beforeEach(() => {
    localStorage.clear();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => { root.unmount(); });
    container.remove();
    localStorage.clear();
  });

  test('sidebar hops push history and Back returns to the prior OliComm page', async () => {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/dashboard']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <BackButton />
          <App />
        </MemoryRouter>
      );
    });
    await flush();

    const screen = container.querySelector('[data-testid="screen"]');
    if (!screen) {
      throw new Error(`App did not render a page. HTML: ${container.textContent}`);
    }
    expect(screen.textContent).toBe('dashboard');

    clickNav(container, 'Payroll');
    clickNav(container, 'Agent Payouts');
    expect(container.querySelector('[data-testid="screen"]').textContent).toBe('payroll:payroll');

    clickNav(container, 'House Statements');
    expect(container.querySelector('[data-testid="screen"]').textContent).toBe('payroll:overrides');

    act(() => {
      container.querySelector('[data-testid="browser-back"]').click();
    });
    expect(container.querySelector('[data-testid="screen"]').textContent).toBe('payroll:payroll');

    act(() => {
      container.querySelector('[data-testid="browser-back"]').click();
    });
    expect(container.querySelector('[data-testid="screen"]').textContent).toBe('dashboard');
  });

  test('deep link opens the requested page after auth', async () => {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/payroll-overrides']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <App />
        </MemoryRouter>
      );
    });
    await flush();
    const screen = container.querySelector('[data-testid="screen"]');
    if (!screen) {
      throw new Error(`Deep link did not render. HTML: ${container.textContent}`);
    }
    expect(screen.textContent).toBe('payroll:overrides');
  });
});
