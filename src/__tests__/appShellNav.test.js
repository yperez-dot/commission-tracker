import React from 'react';
import { createRoot } from 'react-dom/client';
import { act, Simulate } from 'react-dom/test-utils';
import App from '../App';
import { apiFetch } from '../api';

jest.mock('../api', () => ({ apiFetch: jest.fn(), apiDownload: jest.fn(), apiUpload: jest.fn(), clearToken: jest.fn(), setToken: jest.fn() }));

// Stub every page: the shell is what is under test.
function mockStub(name) {
  const React = require('react');
  return function Stub(props) {
    return (
      <div data-page={name} data-tab={props.initialTab || ''} data-period={props.initialPeriod || ''}>
        {props.onNavigate && (
          <button data-go="overrides" onClick={() => props.onNavigate('payroll-overrides', { period: '202609' })}>go</button>
        )}
      </div>
    );
  };
}
jest.mock('../pages/Login', () => function Login(props) {
  const React = require('react');
  return <button data-login="1" onClick={() => props.onLogin('tok', { name: 'Yah Perez', role: 'admin' })}>login</button>;
});
jest.mock('../pages/Dashboard', () => mockStub('dashboard'));
jest.mock('../pages/Upload', () => mockStub('upload'));
jest.mock('../pages/AllData', () => mockStub('alldata'));
jest.mock('../pages/MissingRenewals', () => mockStub('renewals'));
jest.mock('../pages/Reconciliation', () => mockStub('reconciliation'));
jest.mock('../pages/BookOfBusiness', () => mockStub('bob'));
jest.mock('../pages/Payroll', () => mockStub('payroll'));
jest.mock('../pages/AdminUsers', () => mockStub('users'));
jest.mock('../pages/MedicareProUpload', () => mockStub('medicarepro'));
jest.mock('../pages/AgencyProductionUpload', () => mockStub('apu'));
jest.mock('../pages/AgencyProductionRecon', () => mockStub('apr'));
jest.mock('../pages/BSIStatementsUpload', () => mockStub('bsi'));
jest.mock('../pages/AgentPayoutUploads', () => mockStub('apup'));
jest.mock('../pages/PassThroughChargebacks', () => mockStub('ptc'));

const admin = { name: 'Yah Perez', role: 'admin', agency: '' };
let container, root;

async function flush() { await act(async () => { await Promise.resolve(); }); }

async function mount() {
  await act(async () => { root.render(<App />); });
  await flush();
}

const q = (sel) => container.querySelector(sel);
const header = (id) => q(`[data-section="${id}"]`);
const openSections = () => [...container.querySelectorAll('.nav-section-header[aria-expanded="true"]')].map((b) => b.dataset.section);
const clickText = (text) => {
  const b = [...container.querySelectorAll('button')].find((x) => x.textContent === text);
  if (!b) throw new Error(`no button ${text}`);
  act(() => { Simulate.click(b); });
};

beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  window.history.replaceState(null, '', '/');
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  apiFetch.mockImplementation(async (path) => (path === '/auth/me' ? { user: admin } : {}));
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  apiFetch.mockReset();
});

test('accordion: only the current page\'s section is open; opening one closes the others', async () => {
  window.history.replaceState(null, '', '/#/payroll-overrides');
  await mount();
  expect(openSections()).toEqual(['payroll']);
  expect(header('payroll').classList.contains('has-active')).toBe(true);
  expect(header('payroll').classList.contains('active')).toBe(false); // header ≠ child highlight
  expect(q('.nav-sub-item.active').textContent).toBe('Statements');

  act(() => { Simulate.click(header('uploads')); });
  expect(openSections()).toEqual(['uploads']);
  act(() => { Simulate.click(header('reconciliation')); });
  expect(openSections()).toEqual(['reconciliation']);
  act(() => { Simulate.click(header('reconciliation')); });
  expect(openSections()).toEqual([]);
  // Header clicks never navigate.
  expect(q('[data-page]').dataset.page).toBe('payroll');
  expect(window.location.hash).toBe('#/payroll-overrides');
});

test('top-level page: all sections closed', async () => {
  await mount();
  expect(q('[data-page]').dataset.page).toBe('dashboard');
  expect(openSections()).toEqual([]);
  expect(window.location.hash).toBe('#/dashboard');
});

test('page changes push history; Back/Forward move between pages', async () => {
  await mount();
  const start = window.history.length;
  act(() => { Simulate.click(header('uploads')); });
  clickText('Commission Statements');
  expect(window.location.hash).toBe('#/upload');
  expect(q('[data-page]').dataset.page).toBe('upload');
  clickText('Book of Business');
  expect(window.location.hash).toBe('#/bob');
  expect(window.history.length).toBe(start + 2);

  // Simulate Back
  window.history.replaceState(null, '', '#/upload');
  await act(async () => { window.dispatchEvent(new PopStateEvent('popstate')); });
  expect(q('[data-page]').dataset.page).toBe('upload');
  expect(openSections()).toEqual(['uploads']);
  expect(window.history.length).toBe(start + 2); // popstate doesn't push

  // Back to a page with params
  window.history.replaceState(null, '', '#/payroll-overrides?period=202608');
  await act(async () => { window.dispatchEvent(new PopStateEvent('popstate')); });
  expect(q('[data-page]').dataset.tab).toBe('overrides');
  expect(q('[data-page]').dataset.period).toBe('202608');
});

test('onNavigate(page, params) goes through history with params in the hash', async () => {
  await mount();
  act(() => { Simulate.click(q('[data-go="overrides"]')); });
  expect(window.location.hash).toBe('#/payroll-overrides?period=202609');
  expect(q('[data-page]').dataset.period).toBe('202609');
  expect(localStorage.getItem('he_page')).toBe('payroll-overrides');
});

test('deep link / refresh opens the right page with its params', async () => {
  localStorage.setItem('he_page', 'bob');
  window.history.replaceState(null, '', '/#/payroll-overrides?period=202607');
  await mount();
  expect(q('[data-page]').dataset.tab).toBe('overrides');
  expect(q('[data-page]').dataset.period).toBe('202607');
});

test('removed page in a deep link redirects to dashboard', async () => {
  window.history.replaceState(null, '', '/#/payroll-adp');
  await mount();
  expect(q('[data-page]').dataset.page).toBe('dashboard');
  expect(window.location.hash).toBe('#/dashboard');
});

test('login: no hash → dashboard; deep link survives the sign-in', async () => {
  apiFetch.mockImplementation(async () => ({}));
  await mount();
  act(() => { Simulate.click(q('[data-login]')); });
  expect(q('[data-page]').dataset.page).toBe('dashboard');

  await act(async () => root.unmount());
  root = createRoot(container);
  window.history.replaceState(null, '', '/#/payroll-overrides?period=202609');
  await mount();
  act(() => { Simulate.click(q('[data-login]')); });
  expect(q('[data-page]').dataset.tab).toBe('overrides');
  expect(q('[data-page]').dataset.period).toBe('202609');
});
