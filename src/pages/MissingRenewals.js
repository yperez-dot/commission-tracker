import React, { useState, useEffect } from 'react';
import { apiFetch } from '../api';

function fmt(n) {
  return '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatPeriodLabel(p) {
  if (!p) return null;
  const s = String(p).trim();
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  if (s.match(/^\d{6}$/)) return months[parseInt(s.slice(4,6))-1] + ' ' + s.slice(0,4);
  if (s.match(/^\d{2}\/\d{4}$/)) return months[parseInt(s.slice(0,2))-1] + ' ' + s.slice(3);
  if (s.match(/^\d{2}\/\d{2}\/\d{4}$/)) return months[parseInt(s.slice(0,2))-1] + ' ' + s.slice(6);
  return null;
}

export default function MissingRenewals({ user }) {
  const [periods, setPeriods] = useState([]);
  const [selectedPeriod, setSelectedPeriod] = useState('');
  const [loading, setLoading] = useState(false);
  const [checked, setChecked] = useState(false);
  const [results, setResults] = useState({ missing: [], found: [], checkedClients: 0, matchedRecords: 0 });
  const [filterCarrier, setFilterCarrier] = useState('');
  const [filterAgent, setFilterAgent] = useState('');
  const [tab, setTab] = useState('missing');

  useEffect(() => {
    apiFetch('/records/filters').then(d => {
      const valid = (d.periods || []).filter(p => {
        if (!p || p === 'Unknown') return false;
        const s = String(p);
        return s.match(/^\d{6}$/) || s.match(/^\d{2}\/\d{4}$/) || s.match(/^\d{2}\/\d{2}\/\d{4}$/);
      });
      // Deduplicate by normalized label
      const seen = new Set();
      const deduped = valid.filter(p => {
        const label = formatPeriodLabel(p);
        if (!label || seen.has(label)) return false;
        seen.add(label);
        return true;
      });
      setPeriods(deduped);
      if (deduped.length > 0) setSelectedPeriod(deduped[0]);
    }).catch(console.error);
  }, []);

  async function runCheck() {
    if (!selectedPeriod) return;
    setLoading(true);
    setChecked(false);
    try {
      // Get all active BOB clients
      const bobData = await apiFetch('/bob?status=active');
      const bobClients = bobData || [];

      // Get all commission records for selected period
      const recData = await apiFetch(`/records?periods=${encodeURIComponent(selectedPeriod)}&limit=2000`);
      const records = recData.records || [];

      // Also try normalizing — match by YYYYMM
      function normPeriod(p) {
        if (!p) return null;
        const s = String(p).trim();
        if (s.match(/^\d{6}$/)) return s;
        const mm = s.match(/^(\d{1,2})\/(?:\d{2}\/)?(\d{4})$/);
        if (mm) return mm[2] + mm[1].padStart(2,'0');
        return null;
      }
      const targetNorm = normPeriod(selectedPeriod);
      const allRecData = await apiFetch(`/records?limit=5000`);
      const allRecs = (allRecData.records || []).filter(r => {
        const n = normPeriod(r.payment_period);
        return n && targetNorm && n === targetNorm;
      });

      // Build set of paid clients: lowercase name + carrier
      const paidSet = new Set(allRecs.map(r =>
        `${String(r.client_full_name || '').toLowerCase().trim()}|${String(r.carrier || '').toLowerCase()}`
      ));

      const missing = [];
      const found = [];

      for (const client of bobClients) {
        const key = `${String(client.client_full_name || '').toLowerCase().trim()}|${String(client.carrier || '').toLowerCase()}`;
        if (paidSet.has(key)) {
          found.push(client);
        } else {
          missing.push(client);
        }
      }

      setResults({
        missing,
        found,
        checkedClients: bobClients.length,
        matchedRecords: allRecs.length
      });
      setChecked(true);
      setTab('missing');
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  const carriers = [...new Set([...results.missing, ...results.found].map(c => c.carrier).filter(Boolean))];
  const agents = [...new Set([...results.missing, ...results.found].map(c => c.agent_name).filter(Boolean))];

  const filteredMissing = results.missing.filter(c =>
    (!filterCarrier || c.carrier === filterCarrier) &&
    (!filterAgent || c.agent_name === filterAgent)
  );
  const filteredFound = results.found.filter(c =>
    (!filterCarrier || c.carrier === filterCarrier) &&
    (!filterAgent || c.agent_name === filterAgent)
  );

  const atRisk = filteredMissing.reduce((s, c) => s + (parseFloat(c.last_commission_amount) || 0), 0);
  const periodLabel = formatPeriodLabel(selectedPeriod) || selectedPeriod;

  const tabStyle = (id) => ({
    padding: '7px 14px', border: 'none', background: 'none', fontSize: 13, cursor: 'pointer',
    borderBottom: tab === id ? '2px solid var(--blue)' : '2px solid transparent',
    color: tab === id ? 'var(--blue)' : 'var(--text-muted)',
    fontWeight: tab === id ? 600 : 400, marginBottom: -1
  });

  return (
    <div>
      <div className="page-header">
        <div className="page-title">Missing Renewals</div>
        <div className="page-sub">Compare your Book of Business against any month's commission statements</div>
      </div>
      <div className="page-body">

        {/* Check panel */}
        <div className="card" style={{ marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap' }}>
            <div>
              <div className="form-label" style={{ marginBottom: 6, fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                Statement month
              </div>
              <select
                className="filter-select"
                value={selectedPeriod}
                onChange={e => { setSelectedPeriod(e.target.value); setChecked(false); }}
                style={{ minWidth: 160, fontSize: 13 }}
              >
                <option value="">Select month...</option>
                {periods.map(p => {
                  const label = formatPeriodLabel(p);
                  return label ? <option key={p} value={p}>{label}</option> : null;
                })}
              </select>
            </div>
            <button
              className="btn btn-primary"
              onClick={runCheck}
              disabled={loading || !selectedPeriod}
              style={{ padding: '8px 20px', fontSize: 13 }}
            >
              {loading ? '⏳ Checking...' : '🔍 Run check'}
            </button>
            {checked && (
              <div style={{ fontSize: 12, color: 'var(--text-muted)', alignSelf: 'center' }}>
                Checked <strong>{results.checkedClients}</strong> BOB clients against <strong>{results.matchedRecords}</strong> statement records for <strong>{periodLabel}</strong>
              </div>
            )}
          </div>
        </div>

        {/* No BOB warning */}
        {checked && results.checkedClients === 0 && (
          <div style={{ background: '#FFF8E6', border: '1px solid #F5D78E', borderRadius: 8, padding: '12px 16px', marginBottom: 14, fontSize: 13, color: '#7A5C00' }}>
            ⚠️ Your Book of Business is empty. Go to <strong>Book of Business → Setup & tools → Upload carrier BOB export</strong> to add your clients first.
          </div>
        )}

        {checked && results.checkedClients > 0 && (
          <div>
            {/* KPI cards */}
            <div className="kpi-grid" style={{ marginBottom: 14 }}>
              <div className="kpi-card">
                <div className="kpi-label">BOB clients checked</div>
                <div className="kpi-value blue">{results.checkedClients}</div>
              </div>
              <div className="kpi-card">
                <div className="kpi-label">Missing this month</div>
                <div className={`kpi-value ${results.missing.length > 0 ? 'red' : 'green'}`}>{results.missing.length}</div>
              </div>
              <div className="kpi-card">
                <div className="kpi-label">Paid this month</div>
                <div className="kpi-value green">{results.found.length}</div>
              </div>
              <div className="kpi-card">
                <div className="kpi-label">Est. at risk</div>
                <div className={`kpi-value ${atRisk > 0 ? 'amber' : 'green'}`}>{fmt(atRisk)}</div>
              </div>
            </div>

            {results.missing.length === 0 && (
              <div style={{ background: '#EAF3DE', border: '1px solid #C0DD97', borderRadius: 8, padding: '12px 16px', marginBottom: 14, fontSize: 13, color: '#3B6D11', fontWeight: 600 }}>
                ✓ All {results.checkedClients} BOB clients appeared in {periodLabel} statements — no missing renewals!
              </div>
            )}

            {/* Filters */}
            {(carriers.length > 1 || agents.length > 1) && (
              <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                {carriers.length > 1 && (
                  <select className="filter-select" value={filterCarrier} onChange={e => setFilterCarrier(e.target.value)}>
                    <option value="">All carriers</option>
                    {carriers.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                )}
                {agents.length > 1 && (
                  <select className="filter-select" value={filterAgent} onChange={e => setFilterAgent(e.target.value)}>
                    <option value="">All agents</option>
                    {agents.map(a => <option key={a} value={a}>{a}</option>)}
                  </select>
                )}
              </div>
            )}

            {/* Tabs */}
            <div style={{ display: 'flex', gap: 8, borderBottom: '1px solid var(--border)', marginBottom: 0 }}>
              <button style={tabStyle('missing')} onClick={() => setTab('missing')}>
                Missing ({filteredMissing.length})
              </button>
              <button style={tabStyle('found')} onClick={() => setTab('found')}>
                Paid ({filteredFound.length})
              </button>
            </div>

            <div className="card" style={{ padding: 0 }}>
              {tab === 'missing' && (
                filteredMissing.length === 0 ? (
                  <div className="empty-state">
                    <div className="empty-icon">✅</div>
                    <div className="empty-title">No missing clients</div>
                    <div className="empty-sub">All filtered clients appeared in {periodLabel}</div>
                  </div>
                ) : (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>#</th>
                          <th>Client</th>
                          <th>Agent</th>
                          <th>Carrier</th>
                          <th>Effective date</th>
                          <th>Last commission</th>
                          <th>Months missing</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredMissing.map((c, i) => (
                          <tr key={c.id}>
                            <td style={{ color: 'var(--text-muted)', fontSize: 11 }}>{i + 1}</td>
                            <td style={{ fontWeight: 500 }}>{c.client_full_name}</td>
                            <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{c.agent_name || '—'}</td>
                            <td style={{ fontSize: 12 }}>{c.carrier}</td>
                            <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{c.effective_date || '—'}</td>
                            <td style={{ fontWeight: 600, color: '#E24B4A' }}>{fmt(c.last_commission_amount)}</td>
                            <td>
                              {c.months_missing > 0
                                ? <span className={`badge ${c.months_missing >= 2 ? 'badge-red' : 'badge-amber'}`}>{c.months_missing} mo</span>
                                : <span className="badge badge-gray">New miss</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr style={{ background: 'var(--gray-50)', fontWeight: 600 }}>
                          <td colSpan={5} style={{ padding: '8px 12px', fontSize: 12 }}>Total at risk</td>
                          <td style={{ padding: '8px 12px', fontSize: 12, color: '#E24B4A' }}>{fmt(atRisk)}</td>
                          <td></td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )
              )}

              {tab === 'found' && (
                filteredFound.length === 0 ? (
                  <div className="empty-state">
                    <div className="empty-icon">📋</div>
                    <div className="empty-title">No matching clients</div>
                  </div>
                ) : (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>#</th>
                          <th>Client</th>
                          <th>Agent</th>
                          <th>Carrier</th>
                          <th>Effective date</th>
                          <th>Last commission</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredFound.map((c, i) => (
                          <tr key={c.id}>
                            <td style={{ color: 'var(--text-muted)', fontSize: 11 }}>{i + 1}</td>
                            <td style={{ fontWeight: 500 }}>{c.client_full_name}</td>
                            <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{c.agent_name || '—'}</td>
                            <td style={{ fontSize: 12 }}>{c.carrier}</td>
                            <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{c.effective_date || '—'}</td>
                            <td style={{ fontWeight: 600, color: '#1D9E75' }}>{fmt(c.last_commission_amount)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )
              )}
            </div>
          </div>
        )}

        {!checked && !loading && (
          <div className="card">
            <div className="empty-state">
              <div className="empty-icon">🔍</div>
              <div className="empty-title">Select a month and run the check</div>
              <div className="empty-sub">The system will compare every client in your Book of Business against that month's commission records and flag anyone who didn't get paid.</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
