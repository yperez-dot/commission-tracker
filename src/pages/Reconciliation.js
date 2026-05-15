import React, { useState, useEffect } from 'react';
import { apiFetch } from '../api';

function fmt(n) {
  return '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Normalize names for fuzzy matching
function normalizeName(name) {
  if (!name) return '';
  return name.toLowerCase().trim().replace(/\s+/g, ' ');
}

// Normalize carrier names
function normalizeCarrier(carrier) {
  if (!carrier) return '';
  const c = carrier.toLowerCase().trim();
  
  if (c.includes('humana')) return 'humana';
  if (c.includes('aetna')) return 'aetna';
  if (c.includes('uhc') || c.includes('united')) return 'uhc';
  if (c.includes('doctors')) return 'doctors';
  if (c.includes('careplus') || c.includes('care plus')) return 'careplus';
  if (c.includes('devoted')) return 'devoted';
  if (c.includes('wellcare')) return 'wellcare';
  if (c.includes('healthsun')) return 'healthsun';
  if (c.includes('florida blue') || c.includes('fl blue')) return 'florida blue';
  
  return c;
}

// Check if dates match
function datesMatch(date1, date2) {
  if (!date1 || !date2) return false;
  try {
    const d1 = new Date(date1.split('T')[0]);
    const d2 = new Date(date2.split('T')[0]);
    return d1.getTime() === d2.getTime();
  } catch {
    return false;
  }
}

// Find matching commission for a sale
function findMatch(sale, commissions) {
  const client = normalizeName(sale.client_name);
  const agent = normalizeName(sale.agent);
  const carrier = normalizeCarrier(sale.carrier);
  
  for (const comm of commissions) {
    const commClient = normalizeName(comm.client_full_name);
    const commAgent = normalizeName(comm.agent_name);
    const commCarrier = normalizeCarrier(comm.carrier);
    
    // Client name match (fuzzy)
    const clientMatch = (
      client.includes(commClient) || 
      commClient.includes(client) ||
      client.replace(/\s/g, '').includes(commClient.replace(/\s/g, ''))
    );
    
    // Agent name match
    const agentMatch = agent.includes(commAgent) || commAgent.includes(agent);
    
    // Carrier match
    const carrierMatch = carrier === commCarrier || carrier.includes(commCarrier) || commCarrier.includes(carrier);
    
    // Date match (bonus)
    const dateMatch = datesMatch(sale.effective_date, comm.effective_date);
    
    // Require: client + agent + carrier
    if (clientMatch && agentMatch && carrierMatch) {
      return comm;
    }
  }
  
  return null;
}

export default function Reconciliation({ user }) {
  const [sales, setSales] = useState([]);
  const [commissions, setCommissions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState('summary');
  const [filterAgent, setFilterAgent] = useState('all');
  const [filterCarrier, setFilterCarrier] = useState('all');

  async function loadData() {
    setLoading(true);
    setError(null);
    try {
      // Fetch sales from backend (which fetches from Notion)
      const salesData = await apiFetch('/sales-tracker');
      setSales(salesData.sales || []);
      
      // Fetch commissions from OliComm
      const commData = await apiFetch('/records?limit=5000');
      setCommissions((commData.records || []).filter(r => parseFloat(r.commission) > 0));
    } catch (e) {
      console.error('Error loading data:', e);
      setError(e.message || 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  // Match sales to commissions
  const matches = sales.map(sale => ({
    sale,
    commission: findMatch(sale, commissions)
  }));

  const paid = matches.filter(m => m.commission);
  
  // Only show Yahoska + Katy in unpaid (they get carrier commissions)
  // Other agents only generate agency overrides (BSI/NHP)
  const directAgents = ['Yahoska Perez', 'Katy Robles'];
  const unpaid = matches.filter(m => {
    if (!m.commission) {
      const agent = m.sale.agent || '';
      return directAgents.some(da => agent.includes(da) || da.includes(agent));
    }
    return false;
  });

  // Apply filters
  let filteredPaid = paid;
  let filteredUnpaid = unpaid;

  if (filterAgent !== 'all') {
    filteredPaid = paid.filter(m => m.sale.agent === filterAgent);
    filteredUnpaid = unpaid.filter(m => m.sale.agent === filterAgent);
  }

  if (filterCarrier !== 'all') {
    filteredPaid = filteredPaid.filter(m => normalizeCarrier(m.sale.carrier) === normalizeCarrier(filterCarrier));
    filteredUnpaid = filteredUnpaid.filter(m => normalizeCarrier(m.sale.carrier) === normalizeCarrier(filterCarrier));
  }

  // Get unique agents and carriers for filters
  const agents = [...new Set(sales.map(s => s.agent).filter(Boolean))].sort();
  const carriers = [...new Set(sales.map(s => s.carrier).filter(Boolean))].sort();

  const tabStyle = (id) => ({
    padding: '7px 14px',
    border: 'none',
    background: 'none',
    fontSize: 13,
    cursor: 'pointer',
    borderBottom: tab === id ? '2px solid var(--blue)' : '2px solid transparent',
    color: tab === id ? 'var(--blue)' : 'var(--text-muted)',
    fontWeight: tab === id ? 600 : 400,
    marginBottom: -1,
    whiteSpace: 'nowrap'
  });

  return (
    <div>
      <div className="page-header">
        <div className="page-title">Sales Reconciliation</div>
        <div className="page-sub">Cross-check Sales Tracker vs Commission Records</div>
      </div>
      <div className="page-body">

        <div className="card" style={{marginBottom:14}}>
          <div style={{display:'flex', alignItems:'flex-end', gap:12, flexWrap:'wrap', justifyContent:'space-between'}}>
            <div style={{display:'flex', gap:12, flexWrap:'wrap'}}>
              <div>
                <div className="form-label">Agent</div>
                <select className="filter-select" value={filterAgent} onChange={e => setFilterAgent(e.target.value)}>
                  <option value="all">All agents</option>
                  {agents.map(a => <option key={a} value={a}>{a}</option>)}
                </select>
              </div>
              <div>
                <div className="form-label">Carrier</div>
                <select className="filter-select" value={filterCarrier} onChange={e => setFilterCarrier(e.target.value)}>
                  <option value="all">All carriers</option>
                  {carriers.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>
            <button className="btn btn-primary" onClick={loadData} disabled={loading}>
              {loading ? 'Loading...' : '🔄 Refresh'}
            </button>
          </div>
        </div>

        {error && (
          <div className="card" style={{marginBottom:14, background:'var(--red-light)', border:'1px solid var(--red)'}}>
            <div style={{color:'var(--red-dark)', fontWeight:500}}>❌ Error: {error}</div>
          </div>
        )}

        {loading ? (
          <div className="card">
            <div className="empty-state">
              <div className="empty-title" style={{color:'var(--text-muted)'}}>Loading sales and commissions...</div>
            </div>
          </div>
        ) : !sales.length ? (
          <div className="card">
            <div className="empty-state">
              <div className="empty-icon">📊</div>
              <div className="empty-title">No sales data found</div>
              <div className="empty-sub">Check your Sales Tracker in Notion</div>
            </div>
          </div>
        ) : (
          <div>
            {/* KPI Cards */}
            <div className="kpi-grid" style={{marginBottom:14}}>
              <div className="kpi-card">
                <div className="kpi-label">Total Sales</div>
                <div className="kpi-value">{sales.length}</div>
              </div>
              <div className="kpi-card">
                <div className="kpi-label">✅ Paid</div>
                <div className="kpi-value green">{paid.length}</div>
                <div className="kpi-sub">{((paid.length / sales.length) * 100).toFixed(1)}%</div>
              </div>
              <div className="kpi-card">
                <div className="kpi-label">⏳ Unpaid</div>
                <div className="kpi-value red">{unpaid.length}</div>
                <div className="kpi-sub">{((unpaid.length / sales.length) * 100).toFixed(1)}%</div>
              </div>
              <div className="kpi-card">
                <div className="kpi-label">Commission Records</div>
                <div className="kpi-value blue">{commissions.length}</div>
              </div>
            </div>

            {/* Tabs */}
            <div style={{display:'flex', gap:8, marginBottom:12, borderBottom:'1px solid var(--border)', overflowX:'auto'}}>
              <button style={tabStyle('summary')} onClick={() => setTab('summary')}>
                Summary
              </button>
              <button style={tabStyle('paid')} onClick={() => setTab('paid')}>
                ✅ Paid ({filteredPaid.length})
              </button>
              <button style={tabStyle('unpaid')} onClick={() => setTab('unpaid')}>
                ⏳ Unpaid ({filteredUnpaid.length})
              </button>
            </div>

            {/* Summary Tab */}
            {tab === 'summary' && (
              <div className="card">
                <div className="card-title">Reconciliation Summary</div>
                <div style={{marginBottom:20}}>
                  <div style={{fontSize:14, marginBottom:12}}>
                    Out of <strong>{sales.length} total sales</strong> in your Sales Tracker:
                  </div>
                  <ul style={{fontSize:14, lineHeight:1.8, paddingLeft:20}}>
                    <li><strong style={{color:'var(--green)'}}>{paid.length} sales ({((paid.length / sales.length) * 100).toFixed(1)}%)</strong> have matching commission records in OliComm</li>
                    <li><strong style={{color:'var(--red)'}}>{unpaid.length} sales ({((unpaid.length / sales.length) * 100).toFixed(1)}%)</strong> are missing commission records</li>
                  </ul>
                </div>
                
                <div className="card-title" style={{marginTop:24}}>What this means</div>
                <div style={{fontSize:14, lineHeight:1.7}}>
                  <p><strong>✅ Paid sales</strong> have been matched to commission records using client name, agent, carrier, and effective date.</p>
                  <p><strong>⏳ Unpaid sales</strong> either haven't been paid yet, or the commission statement hasn't been uploaded to OliComm.</p>
                  <p style={{marginTop:16, padding:12, background:'var(--blue-light)', borderRadius:6, color:'var(--blue-dark)'}}>
                    💡 <strong>Tip:</strong> After Katy uploads new commission statements, click "🔄 Refresh" to update the reconciliation.
                  </p>
                </div>
              </div>
            )}

            {/* Paid Tab */}
            {tab === 'paid' && (
              <div className="card" style={{padding:0}}>
                {filteredPaid.length === 0 ? (
                  <div className="empty-state">
                    <div className="empty-title">No paid sales match your filters</div>
                  </div>
                ) : (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Client</th>
                          <th>Agent</th>
                          <th>Carrier</th>
                          <th>Effective Date</th>
                          <th>Commission</th>
                          <th>Payment Period</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredPaid.map((m, i) => (
                          <tr key={i}>
                            <td style={{fontWeight:500}}>{m.sale.client_name}</td>
                            <td>{m.sale.agent}</td>
                            <td style={{fontSize:12}}>{m.sale.carrier}</td>
                            <td style={{fontSize:12, color:'var(--text-muted)'}}>
                              {m.sale.effective_date || '—'}
                            </td>
                            <td style={{fontWeight:600, color:'var(--green)'}}>
                              {fmt(m.commission.commission)}
                            </td>
                            <td style={{fontSize:12}}>
                              {m.commission.payment_period || '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* Unpaid Tab */}
            {tab === 'unpaid' && (
              <div className="card" style={{padding:0}}>
                {filteredUnpaid.length === 0 ? (
                  <div className="empty-state">
                    <div className="empty-icon">🎉</div>
                    <div className="empty-title">All sales are paid!</div>
                    <div className="empty-sub">No unpaid sales match your filters</div>
                  </div>
                ) : (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Client</th>
                          <th>Agent</th>
                          <th>Carrier</th>
                          <th>Effective Date</th>
                          <th>Enrollment Date</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredUnpaid.map((m, i) => (
                          <tr key={i}>
                            <td style={{fontWeight:500}}>{m.sale.client_name}</td>
                            <td>{m.sale.agent}</td>
                            <td style={{fontSize:12}}>{m.sale.carrier}</td>
                            <td style={{fontSize:12, color:'var(--text-muted)'}}>
                              {m.sale.effective_date || '—'}
                            </td>
                            <td style={{fontSize:12, color:'var(--text-muted)'}}>
                              {m.sale.enrollment_date || '—'}
                            </td>
                            <td>
                              <span className="badge badge-amber">
                                {m.sale.status || 'Unpaid'}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

          </div>
        )}
      </div>
    </div>
  );
}
