import React, { useState, useEffect } from 'react';
import { apiFetch } from '../api';

function fmt(n) { return '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

export default function Dashboard({ user }) {
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    apiFetch('/records/summary')
      .then(setSummary)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="page-body" style={{paddingTop:24}}><div className="alert alert-info"><span className="spinner"></span> Loading dashboard...</div></div>;
  if (error) return <div className="page-body" style={{paddingTop:24}}><div className="alert alert-error">{error}</div></div>;

  const maxAgent = summary?.byAgent?.[0]?.total || 1;
  const maxCarrier = summary?.byCarrier?.[0]?.total || 1;

  return (
    <>
      <div className="page-header">
        <div className="page-title">Dashboard</div>
        <div className="page-sub">Welcome back, {user.name.split(' ')[0]} — here's your commission overview</div>
      </div>
      <div className="page-body">
        <div className="kpi-grid">
          <div className="kpi-card">
            <div className="kpi-label">Total commissions</div>
            <div className="kpi-value green">{fmt(summary?.totalCommission)}</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">Total records</div>
            <div className="kpi-value blue">{(summary?.totalRecords || 0).toLocaleString()}</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">Agents</div>
            <div className="kpi-value">{summary?.agentCount || 0}</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">Carriers</div>
            <div className="kpi-value">{summary?.carrierCount || 0}</div>
          </div>
        </div>

        {!summary?.totalRecords ? (
          <div className="card">
            <div className="empty-state">
              <div className="empty-icon">📊</div>
              <div className="empty-title">No data yet</div>
              <div className="empty-sub">Upload your first carrier statement to get started</div>
            </div>
          </div>
        ) : (
          <>
            <div className="two-col">
              <div className="card">
                <div className="card-title">By agent</div>
                {summary?.byAgent?.length ? (
                  <div className="bar-chart">
                    {summary.byAgent.slice(0, 6).map((a, i) => (
                      <div className="bar-col" key={i}>
                        <div className="bar-val">{fmt(a.total)}</div>
                        <div className="bar" style={{ height: Math.max(8, (a.total / maxAgent) * 90) + 'px', background: '#185FA5' }}></div>
                        <div className="bar-lbl">{a.agent_name?.split(' ')[0]}</div>
                      </div>
                    ))}
                  </div>
                ) : <div className="empty-sub" style={{padding:'12px 0'}}>No data</div>}
              </div>

              <div className="card">
                <div className="card-title">By carrier</div>
                {summary?.byCarrier?.length ? (
                  <div className="bar-chart">
                    {summary.byCarrier.slice(0, 6).map((c, i) => (
                      <div className="bar-col" key={i}>
                        <div className="bar-val">{fmt(c.total)}</div>
                        <div className="bar" style={{ height: Math.max(8, (c.total / maxCarrier) * 90) + 'px', background: '#1D9E75' }}></div>
                        <div className="bar-lbl">{c.carrier?.replace('UnitedHealthcare', 'UHC').replace('Med Supp', 'MS').replace('Med Adv', 'MA')}</div>
                      </div>
                    ))}
                  </div>
                ) : <div className="empty-sub" style={{padding:'12px 0'}}>No data</div>}
              </div>
            </div>

            <div className="card">
              <div className="card-title">Agent breakdown</div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Agent</th>
                      <th>Total commission</th>
                      <th>Records</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary?.byAgent?.map((a, i) => (
                      <tr key={i}>
                        <td style={{color:'var(--text-muted)'}}>{i + 1}</td>
                        <td style={{fontWeight:500}}>{a.agent_name}</td>
                        <td style={{fontWeight:600, color:'var(--green)'}}>{fmt(a.total)}</td>
                        <td>{a.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}
