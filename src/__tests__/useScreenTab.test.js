/**
 * @jest-environment jsdom
 */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { useScreenTab } from '../useScreenTab';

global.IS_REACT_ACT_ENVIRONMENT = true;

function TabProbe() {
  const [tab, setTab] = useScreenTab(['unpaid', 'partial', 'paid'], 'unpaid');
  const location = useLocation();
  return (
    <div>
      <div data-testid="tab">{tab}</div>
      <div data-testid="url">{`${location.pathname}${location.search}`}</div>
      <button type="button" data-testid="paid" onClick={() => setTab('paid')}>Paid</button>
      <button type="button" data-testid="unpaid" onClick={() => setTab('unpaid')}>Unpaid</button>
    </div>
  );
}

function BackButton() {
  const navigate = useNavigate();
  return <button type="button" data-testid="back" onClick={() => navigate(-1)}>Go back</button>;
}

describe('useScreenTab', () => {
  let container;
  let root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => { root.unmount(); });
    container.remove();
  });

  test('tab changes push history and Back restores the prior tab', () => {
    act(() => {
      root.render(
        <MemoryRouter initialEntries={['/direct-recon']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <BackButton />
          <Routes>
            <Route path="/direct-recon" element={<TabProbe />} />
          </Routes>
        </MemoryRouter>
      );
    });

    expect(container.querySelector('[data-testid="tab"]').textContent).toBe('unpaid');
    expect(container.querySelector('[data-testid="url"]').textContent).toBe('/direct-recon');

    act(() => {
      container.querySelector('[data-testid="paid"]').click();
    });
    expect(container.querySelector('[data-testid="tab"]').textContent).toBe('paid');
    expect(container.querySelector('[data-testid="url"]').textContent).toBe('/direct-recon?tab=paid');

    act(() => {
      container.querySelector('[data-testid="back"]').click();
    });
    expect(container.querySelector('[data-testid="tab"]').textContent).toBe('unpaid');
    expect(container.querySelector('[data-testid="url"]').textContent).toBe('/direct-recon');
  });
});
