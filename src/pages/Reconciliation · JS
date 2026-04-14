import React, { useState, useEffect } from 'react';
import { apiFetch } from '../api';

function fmt(n) {
  return '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const SPLIT_START_DATE = new Date('2025-08-01');

function isSplitEligible(effectiveDate) {
  if (!effectiveDate) return false;
  const d = new Date(effectiveDate);
  if (isNaN(d.getTime())) return false;
  return d >= SPLIT_START_DATE;
}

export default function Reconciliation({ user }) {
  const [periods, setPeriods] = useState([]);
  const [selectedPeriod, setSelectedPeriod] = useState('');
  const [nhpRecords, setNhpRecords] = useState([]);
  const [bsiRecords, setBsiRecords] = useState([]);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState('summary');

  useEffect(() => {
    apiFetch('/records/filters').then(d => {
      setPeriods(d.periods || []);
      if (d.periods && d.periods.length) setSelectedPeriod(d.periods[0]);
    }).catch(console.error);
  }, []);

  async function loadReconciliation() {
    if (!selectedPeriod) return;
    setLoading(true);
    try {
      const nhpData = await apiFetch('/records?carrier=NHP&limit=500');
      const bsiData = await apiFetch('/records?carrier=BSI&limit=500');
      setNhpRecords(nhpData.records || []);
      setBsiRecords(bsiData.records || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (selectedPeriod) loadReconciliation();
  }, [selectedPeriod]);

  const nhpPreSplit = nhpRecords.filter(r => !isSplitEligible(r.effective_date));
  const nhpSplitElig = nhpRecords.filter(r => isSplitEligible(r.effective_date));
  const nhpGross = nhpRecords.reduce((s, r) => s + (parseFloat(r.commission) || 0), 0);
  const nhpPreTotal = nhpPreSplit.reduce((s, r) => s + (parseFloat(r.commission) || 0), 0);
  const nhpSplitTotal = nhpSplitElig.reduce((s, r) => s + (parseFloat(r.commission) || 0), 0);
  const owedToBSI = nhpSplitTotal * 0.5;
  const yourNHPShare = nhpPreTotal + (nhpSplitTotal * 0.5);
  const bsiTotal = bsiRecords.reduce((s, r) => s + (parseFloat(r.commission) || 0), 0);
  const difference = bsiTotal - owedToBSI;
  const diffPct = owedToBSI > 0 ? ((difference / owedToBSI) * 100).toFixed(1) : 0;
  const isBalanced = Math.abs(difference) < 10;
  const statusLabel = isBalanced ? 'Balanced' : difference > 0 ? 'BSI paid more' : 'BSI paid less';
  const statusBg = isBalanced ? 'var(--green-light)' : difference > 0 ? 'var(--blue-light)' : 'var(--red-light)';
  const statusFg = isBalanced ? 'var(--green)' : difference > 0 ? 'var(--blue)' : 'var(--red)';

  const tabStyle = (id) => ({
    padding: '7px 14px',
    border: 'none',
    background: 'none',
    fontSize: 13,
    cursor: 'pointer',
    borderBottom: tab === id ? '2px solid var(--blue)' : '2px solid transparent',
    color: tab === id ? 'var(--blue)' : 'var(--text-muted)',
    fontWeight: tab === id ? 600 : 400,
    marginBottom: -1
  });

  return (
    <div>
      <div className="page-header">
        <div className="page-title">NHP / BSI reconciliation</div>
        <div className="page-sub">Cross-check NHP overrides vs BSI payments — partnership started 08/01/2025</div>
      </div>
      <div className="page-body">

        <div className="card" style={{marginBottom:14}}>
          <div style={{display:'flex', alignItems:'flex-end', gap:12, flexWrap:'wrap'}}>
            <div>
              <div className="form-label">Statement period</div>
              <select className="filter-select" value={selectedPeriod} onChange={e => setSelectedPeriod(e.target.value)}>
                <option value="">Select period</option>
                {periods.map(p => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </div>
            <button className="btn btn-primary" onClick={loadReconciliation} disabled={loading}>
              {loading ? 'Loading...' : 'Refresh'}
            </button>
          </div>
        </div>

        {!nhpRecords.length && !bsiRecords.length ? (
          <div className="card">
            <div className="empty-state">
              <div className="empty-icon">🔍</div>
              <div className="empty-title">No NHP or BSI data found</div>
              <div className="empty-sub">Upload your NHP and BSI statements first</div>
            </div>
          </div>
        ) : (
          <div>
            <div className="kpi-grid" style={{marginBottom:14}}>
              <div className="kpi-card">
                <div className="kpi-label">NHP gross received</div>
                <div className="kpi-value blue">{fmt(nhpGross)}</div>
              </div>
              <div className="kpi-card">
                <div className="kpi-label">Your NHP share</div>
                <div className="kpi-value green">{fmt(yourNHPShare)}</div>
              </div>
              <div className="kpi-card">
                <div className="kpi-label">Owed to BSI (50%)</div>
                <div className="kpi-value amber">{fmt(owedToBSI)}</div>
              </div>
              <div className="kpi-card">
                <div className="kpi-label">BSI actually paid</div>
                <div className="kpi-value blue">{fmt(bsiTotal)}</div>
              </div>
            </div>

            <div className="card" style={{marginBottom:14}}>
              <div className="card-title">Reconciliation result</div>
              <div style={{display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:12}}>
                <div style={{background:'var(--gray-100)', borderRadius:'var(--radius)', padding:'14px 16px'}}>
                  <div style={{fontSize:12, color:'var(--text-muted)', marginBottom:4}}>Pre-partnership</div>
                  <div style={{fontSize:18, fontWeight:600}}>{fmt(nhpPreTotal)}</div>
                  <div style={{fontSize:11, color:'var(--text-muted)', marginTop:2}}>Before 08/01/2025 — 100% yours</div>
                </div>
                <div style={{background:'var(--gray-100)', borderRadius:'var(--radius)', padding:'14px 16px'}}>
                  <div style={{fontSize:12, color:'var(--text-muted)', marginBottom:4}}>Split-eligible</div>
                  <div style={{fontSize:18, fontWeight:600}}>{fmt(nhpSplitTotal)}</div>
                  <div style={{fontSize:11, color:'var(--text-muted)', marginTop:2}}>08/01/2025 or later — 50/50</div>
                </div>
                <div style={{background:statusBg, borderRadius:'var(--radius)', padding:'14px 16px'}}>
                  <div style={{fontSize:12, color:'var(--text-muted)', marginBottom:4}}>Difference</div>
                  <div style={{fontSize:18, fontWeight:600, color:statusFg}}>
                    {difference >= 0 ? '+' : ''}{fmt(difference)}
                  </div>
                  <div style={{fontSize:11, marginTop:2, color:statusFg}}>
                    {statusLabel} {Math.abs(diffPct) > 0 ? '(' + diffPct + '%)' : ''}
                  </div>
                </div>
              </div>
            </div>

            <div style={{display:'flex', gap:8, marginBottom:12, borderBottom:'1px solid var(--border)'}}>
              <button style={tabStyle('summary')} onClick={() => setTab('summary')}>Split breakdown</button>
              <button style={tabStyle('nhp')} onClick={() => setTab('nhp')}>{'NHP records (' + nhpRecords.length + ')'}</button>
              <button style={tabStyle('bsi')} onClick={() => setTab('bsi')}>{'BSI records (' + bsiRecords.length + ')'}</button>
            </div>

            {tab === 'summary' && (
              <div className="card" style={{padding:0}}>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Category</th>
                        <th>Records</th>
                        <th>Total</th>
                        <th>Your share</th>
                        <th>BSI share</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td>
                          <div style={{fontWeight:500}}>Pre-partnership</div>
                          <div style={{fontSize:11, color:'var(--text-muted)'}}>Before 08/01/2025</div>
                        </td>
                        <td>{nhpPreSplit.length}</td>
                        <td>{fmt(nhpPreTotal)}</td>
                        <td style={{fontWeight:600, color:'var(--green)'}}>{fmt(nhpPreTotal)}</td>
                        <td style={{color:'var(--text-muted)'}}>$0.00</td>
                      </tr>
                      <tr>
                        <td>
                          <div style={{fontWeight:500}}>Split-eligible</div>
                          <div style={{fontSize:11, color:'var(--text-muted)'}}>08/01/2025 or later</div>
                        </td>
                        <td>{nhpSplitElig.length}</td>
                        <td>{fmt(nhpSplitTotal)}</td>
                        <td style={{fontWeight:600, color:'var(--green)'}}>{fmt(nhpSplitTotal * 0.5)}</td>
                        <td style={{fontWeight:600, color:'var(--amber)'}}>{fmt(nhpSplitTotal * 0.5)}</td>
                      </tr>
                      <tr style={{background:'var(--gray-50)'}}>
                        <td style={{fontWeight:600}}>Total NHP</td>
                        <td style={{fontWeight:600}}>{nhpRecords.length}</td>
                        <td style={{fontWeight:600}}>{fmt(nhpGross)}</td>
                        <td style={{fontWeight:600, color:'var(--green)'}}>{fmt(yourNHPShare)}</td>
                        <td style={{fontWeight:600, color:'var(--amber)'}}>{fmt(owedToBSI)}</td>
                      </tr>
                      <tr>
                        <td>
                          <div style={{fontWeight:500}}>BSI direct payment</div>
                          <div style={{fontSize:11, color:'var(--text-muted)'}}>What BSI actually sent you</div>
                        </td>
                        <td>{bsiRecords.length}</td>
                        <td style={{fontWeight:600, color:'var(--blue)'}}>{fmt(bsiTotal)}</td>
                        <td colSpan={2} style={{color:'var(--text-muted)', fontSize:12}}>Should match BSI share above</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {tab === 'nhp' && (
              <div className="card" style={{padding:0}}>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Agent</th>
                        <th>Carrier</th>
                        <th>Client</th>
                        <th>Effective</th>
                        <th>Commission</th>
                        <th>Split eligible</th>
                        <th>Your share</th>
                      </tr>
                    </thead>
                    <tbody>
                      {nhpRecords.map((r, i) => {
                        var eligible = isSplitEligible(r.effective_date);
                        var comm = parseFloat(r.commission) || 0;
                        var share = eligible ? comm * 0.5 : comm;
                        return (
                          <tr key={r.id}>
                            <td style={{color:'var(--text-muted)', fontSize:11}}>{i + 1}</td>
                            <td style={{fontWeight:500}}>{r.agent_name}</td>
                            <td style={{fontSize:12}}>{r.carrier}</td>
                            <td>{r.client_full_name || '—'}</td>
                            <td style={{fontSize:12, color:'var(--text-muted)'}}>{r.effective_date || '—'}</td>
                            <td style={{fontWeight:600}}>{fmt(comm)}</td>
                            <td>
                              {eligible
                                ? <span className="badge badge-amber">Yes (50/50)</span>
                                : <span className="badge badge-green">No (100% yours)</span>
                              }
                            </td>
                            <td style={{fontWeight:600, color:'var(--green)'}}>{fmt(share)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {tab === 'bsi' && (
              <div className="card" style={{padding:0}}>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Agent</th>
                        <th>Carrier</th>
                        <th>Client</th>
                        <th>Effective</th>
                        <th>Commission</th>
                        <th>Type</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bsiRecords.map((r, i) => {
                        var comm = parseFloat(r.commission) || 0;
                        return (
                          <tr key={r.id}>
                            <td style={{color:'var(--text-muted)', fontSize:11}}>{i + 1}</td>
                            <td style={{fontWeight:500}}>{r.agent_name}</td>
                            <td style={{fontSize:12}}>{r.carrier}</td>
                            <td>{r.client_full_name || '—'}</td>
                            <td style={{fontSize:12, color:'var(--text-muted)'}}>{r.effective_date || '—'}</td>
                            <td style={{fontWeight:600, color: comm < 0 ? 'var(--red)' : 'var(--green)'}}>{fmt(comm)}</td>
                            <td><span className="badge badge-blue">{r.classification || 'Override'}</span></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

          </div>
        )}
      </div>
    </div>
  );
}
