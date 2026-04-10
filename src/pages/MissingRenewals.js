import React, { useState, useEffect } from 'react';
import { apiFetch } from '../api';

function fmt(n) { return '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

export default function MissingRenewals({ user }) {
  const [periods, setPeriods] = useState([]);
  const [lastPeriod, setLastPeriod] = useState('');
  const [thisPeriod, setThisPeriod] = useState('');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [agentFilter, setAgentFilter] = useState('');
  const [tab, setTab] = useState('missing');

  useEffect(() => {
    apiFetch('/records/filters').then(d => {
      setPeriods(d.periods || []);
      if (d.periods?.length >= 2) {
        setThisPeriod(d.periods[0]);
        setLastPeriod(d.periods[1]);
      }
    }).catch(console.error);
  }, []);

  async function runComparison() {
    if (!lastPeriod || !thisPeriod) return;
    setLoading(true);
    try {
      const data = await apiFetch(`/records/missing-renewals?lastPeriod=${encodeURIComponent(lastPeriod)}&thisPeriod=${encodeURIComponent(thisPeriod)}`);
      setResult(data);
      setAgentFilter('');
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  const filterByAgent = arr => agentFilter ? arr.filter(r => r.agent_name === agentFilter) : arr;

  const missing = filterByAgent(result?.missing || []).sort((a, b) => (b.commission || 0) - (a.commission || 0));
  const newClients = filterByAgent(result?.newClients || []);
  const allAgents = result ? [...new Set([...result.missing, ...result.newClients].map(r => r.agent_name))] : [];

  const riskLevel = c => c >= 500 ? { label: 'High', color: '#E24B4A', pct: 100 } : c >= 100 ? { label: 'Medium', color: '#BA7517', pct: 60 } : { label: 'Low', color: '#888780', pct: 25 };

  return (
    <>
      <div className="page-header">
        <div className="page-title">Missing renewals</div>
        <div className="page-sub">Compare two months to find clients who stopped paying</div>
      </div>
      <div className="page-body">
        <div className="card" style={{marginBottom:14}}>
          <div style={{display:'flex', alignItems:'flex-end', gap:12, flexWrap:'wrap'}}>
            <div>
              <div className="form-label">Last month</div>
              <select className="filter-select" value={lastPeriod} onChange={e => setLastPeriod(e.target.value)}>
                <option value="">Select period</option>
                {periods.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div>
              <div className="form-label">This month</div>
              <select className="filter-select" value={thisPeriod} onChange={e => setThisPeriod(e.target.value)}>
                <option value="">Select period</option>
                {periods.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <button className="btn btn-primary" onClick={runComparison} disabled={loading || !lastPeriod || !thisPeriod}>
              {loading ? <><span className="spinner"></span> Comparing...</> : 'Compare →'}
            </button>
          </div>
        </div>

        {!result && !loading && (
          <div className="card">
            <div className="empty-state">
              <div className="empty-icon">🔍</div>
              <div className="empty-title">Select two periods and compare</div>
              <div className="empty-sub">The detector will find every client who appeared last month but not this month</div>
            </div>
          </div>
        )}

        {result && (
          <>
            <div className="kpi-grid" style={{marginBottom:14}}>
              <div className="kpi-card">
                <div className="kpi-label">Last month clients</div>
                <div className="kpi-value blue">{result.lastPeriodCount}</div>
              </div>
              <div className="kpi-card">
                <div className="kpi-label">This month clients</div>
                <div className="kpi-value blue">{result.thisPeriodCount}</div>
              </div>
              <div className="kpi-card">
                <div className="kpi-label">Missing renewals</div>
                <div className={`kpi-value ${result.missing.length > 0 ? 'red' : 'green'}`}>{result.missing.length}</div>
              </div>
              <div className="kpi-card">
                <div className="kpi-label">Est. lost / mo</div>
                <div className="kpi-value amber">{fmt(result.lostRevenue)}</div>
              </div>
            </div>

            <div style={{display:'flex', gap:8, marginBottom:12, borderBottom:'1px solid var(--border)', paddingBottom:0}}>
              {[
                { id: 'missing', label: `Missing (${result.missing.length})` },
                { id: 'new', label: `New this month (${result.newClients.length})` }
              ].map(t => (
                <button key={t.id} onClick={() => setTab(t.id)}
                  style={{padding:'7px 14px', border:'none', background:'none', fontSize:13, cursor:'pointer',
                    borderBottom: tab === t.id ? '2px solid var(--blue)' : '2px solid transparent',
                    color: tab === t.id ? 'var(--blue)' : 'var(--text-muted)',
                    fontWeight: tab === t.id ? 600 : 400, marginBottom:-1}}>
                  {t.label}
                </button>
              ))}
              {allAgents.length > 1 && (
                <select className="filter-select" style={{marginLeft:'auto'}} value={agentFilter} onChange={e => setAgentFilter(e.target.value)}>
                  <option value="">All agents</option>
                  {allAgents.map(a => <option key={a} value={a}>{a}</option>)}
                </select>
              )}
            </div>

            {tab === 'missing' && (
              <div className="card" style={{padding:0}}>
                {!missing.length ? (
                  <div className="empty-state">
                    <div className="empty-icon">✅</div>
                    <div className="empty-title">No missing renewals!</div>
                    <div className="empty-sub">Every client from last month appeared this month too</div>
                  </div>
                ) : (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr><th>#</th><th>Client</th><th>Agent</th><th>Carrier</th><th>Last commission</th><th>Risk</th></tr>
                      </thead>
                      <tbody>
                        {missing.map((r, i) => {
                          const risk = riskLevel(r.commission);
                          return (
                            <tr key={i}>
                              <td style={{color:'var(--text-muted)', fontSize:11}}>{i + 1}</td>
                              <td style={{fontWeight:500}}>{r.client_full_name || '—'}</td>
                              <td>{r.agent_name}</td>
                              <td style={{fontSize:12}}>{r.carrier}</td>
                              <td style={{fontWeight:600, color:'var(--red)'}}>{fmt(r.commission)}</td>
                              <td style={{minWidth:80}}>
                                <span style={{fontSize:12, color:risk.color, fontWeight:500}}>{risk.label}</span>
                                <div className="risk-bar">
                                  <div className="risk-fill" style={{width:risk.pct+'%', background:risk.color}}></div>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {tab === 'new' && (
              <div className="card" style={{padding:0}}>
                {!newClients.length ? (
                  <div className="empty-state">
                    <div className="empty-sub">No new clients this month</div>
                  </div>
                ) : (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr><th>#</th><th>Client</th><th>Agent</th><th>Carrier</th><th>Commission</th></tr>
                      </thead>
                      <tbody>
                        {filterByAgent(newClients).map((r, i) => (
                          <tr key={i}>
                            <td style={{color:'var(--text-muted)', fontSize:11}}>{i + 1}</td>
                            <td style={{fontWeight:500}}>{r.client_full_name || '—'}</td>
                            <td>{r.agent_name}</td>
                            <td style={{fontSize:12}}>{r.carrier}</td>
                            <td style={{fontWeight:600, color:'var(--green)'}}>{fmt(r.commission)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
