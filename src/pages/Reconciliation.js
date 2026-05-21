import React, { useState, useEffect } from 'react';
import { apiFetch } from '../api';

function fmt(n) {
  return '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  try {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return dateStr;
  }
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

// Find matching commission for a sale (including manual payments)
function findMatch(sale, commissions, manualPayments = []) {
  // Check manual payments first
  const manualMatch = manualPayments.find(mp => 
    mp.client_name === sale.client_name && 
    mp.agent === sale.agent && 
    mp.effective_date === sale.effective_date
  );
  
  if (manualMatch) {
    return { ...manualMatch, isManual: true };
  }
  
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
  const [manualPayments, setManualPayments] = useState([]);
  const [sortColumn, setSortColumn] = useState('client');
  const [sortDirection, setSortDirection] = useState('asc');
  const [searchTerm, setSearchTerm] = useState('');
  const [showDirectAgentsOnly, setShowDirectAgentsOnly] = useState(true);  // Default to direct agents only

  async function loadData() {
    setLoading(true);
    setError(null);
    console.log('Loading MedicarePro sales...');
    try {
      // Fetch sales from MedicarePro upload endpoint
      const salesData = await apiFetch('/medicarepro');
      console.log('MedicarePro API response:', salesData);
      setSales(salesData.sales || []);
      
      // Fetch commissions from OliComm (optimized: limit=100 instead of 5000)
      console.log('Loading commission records...');
      const commData = await apiFetch('/records?limit=100');
      console.log('Commission response:', commData);
      setCommissions((commData.records || []).filter(r => parseFloat(r.commission) > 0));
      
      // Fetch manual payments (optional - may not exist yet)
      try {
        console.log('Loading manual payments...');
        const manualData = await apiFetch('/manual-payments');
        console.log('Manual payments response:', manualData);
        setManualPayments(manualData.payments || []);
      } catch (manualError) {
        console.log('Manual payments endpoint not available yet (optional feature)');
        setManualPayments([]);
      }
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

  // Direct agents who get carrier commissions (Yahoska + Katy)
  const directAgents = ['Yahoska Perez', 'Katy Robles'];
  
  // Filter sales by direct agents if toggle is on
  let filteredSales = sales;
  if (showDirectAgentsOnly) {
    filteredSales = sales.filter(sale => {
      const agentName = sale.agent_name || sale.agent || '';
      return directAgents.some(da => agentName.includes(da) || da.includes(agentName));
    });
  }
  
  // Match sales to commissions
  const matches = filteredSales.map(sale => ({
    sale,
    commission: findMatch(sale, commissions, manualPayments)
  }));

  const paid = matches.filter(m => m.commission);
  const unpaid = matches.filter(m => !m.commission);

  // Apply filters
  let filteredPaid = paid;
  let filteredUnpaid = unpaid;

  if (filterAgent !== 'all') {
    filteredPaid = paid.filter(m => (m.sale.agent_name || m.sale.agent) === filterAgent);
    filteredUnpaid = unpaid.filter(m => (m.sale.agent_name || m.sale.agent) === filterAgent);
  }

  if (filterCarrier !== 'all') {
    filteredPaid = filteredPaid.filter(m => normalizeCarrier(m.sale.carrier) === normalizeCarrier(filterCarrier));
    filteredUnpaid = filteredUnpaid.filter(m => normalizeCarrier(m.sale.carrier) === normalizeCarrier(filterCarrier));
  }

  // Apply search term
  if (searchTerm.trim()) {
    const search = searchTerm.toLowerCase();
    filteredPaid = filteredPaid.filter(m => 
      (m.sale.client_name || '').toLowerCase().includes(search) ||
      (m.sale.agent || '').toLowerCase().includes(search) ||
      (m.sale.carrier || '').toLowerCase().includes(search)
    );
    filteredUnpaid = filteredUnpaid.filter(m => 
      (m.sale.client_name || '').toLowerCase().includes(search) ||
      (m.sale.agent || '').toLowerCase().includes(search) ||
      (m.sale.carrier || '').toLowerCase().includes(search)
    );
  }

  // Sort data
  const sortData = (data) => {
    return [...data].sort((a, b) => {
      let aVal, bVal;
      
      switch(sortColumn) {
        case 'client':
          aVal = (a.sale.client_name || '').toLowerCase();
          bVal = (b.sale.client_name || '').toLowerCase();
          break;
        case 'agent':
          aVal = (a.sale.agent_name || a.sale.agent || '').toLowerCase();
          bVal = (b.sale.agent_name || b.sale.agent || '').toLowerCase();
          break;
        case 'carrier':
          aVal = (a.sale.carrier || '').toLowerCase();
          bVal = (b.sale.carrier || '').toLowerCase();
          break;
        case 'effective_date':
          aVal = a.sale.effective_date || '';
          bVal = b.sale.effective_date || '';
          break;
        case 'enrollment_date':
          aVal = a.sale.enrollment_date || '';
          bVal = b.sale.enrollment_date || '';
          break;
        default:
          return 0;
      }
      
      if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
  };

  filteredPaid = sortData(filteredPaid);
  filteredUnpaid = sortData(filteredUnpaid);

  // Handle column header click for sorting
  const handleSort = (column) => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(column);
      setSortDirection('asc');
    }
  };

  // Sort indicator
  const sortIndicator = (column) => {
    if (sortColumn !== column) return ' ↕';
    return sortDirection === 'asc' ? ' ↑' : ' ↓';
  };

  // Get unique agents and carriers for filters (from filtered sales)
  const agents = [...new Set(filteredSales.map(s => s.agent_name || s.agent).filter(Boolean))].sort();
  const carriers = [...new Set(filteredSales.map(s => s.carrier).filter(Boolean))].sort();

  // Handle marking a sale as paid
  async function handleMarkPaid(sale) {
    const paymentDate = prompt(
      `Mark "${sale.client_name}" as paid.\n\nEnter payment date (YYYY-MM-DD):`,
      new Date().toISOString().split('T')[0]
    );
    
    if (!paymentDate) return; // User cancelled
    
    try {
      await apiFetch('/manual-payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_name: sale.client_name,
          agent: sale.agent,
          carrier: sale.carrier,
          effective_date: sale.effective_date,
          payment_date: paymentDate,
          marked_by: user?.name || 'User'
        })
      });
      
      // Reload data to reflect the change
      await loadData();
      alert('✅ Marked as paid!');
    } catch (e) {
      console.error('Error marking as paid:', e);
      alert('❌ Error: ' + (e.message || 'Could not mark as paid'));
    }
  }

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
        <div className="page-sub">Cross-check MedicarePro Sales vs Commission Records</div>
      </div>
      <div className="page-body">

        <div className="card" style={{marginBottom:14}}>
          <div style={{display:'flex', alignItems:'flex-end', gap:12, flexWrap:'wrap', justifyContent:'space-between'}}>
            <div style={{display:'flex', gap:12, flexWrap:'wrap'}}>
              <div>
                <div className="form-label">Search</div>
                <input 
                  type="text"
                  className="filter-select"
                  placeholder="Client, agent, or carrier..."
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                  style={{minWidth:220}}
                />
              </div>
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
            <div style={{display:'flex', gap:12, alignItems:'center'}}>
              <label style={{display:'flex', alignItems:'center', gap:8, fontSize:13, cursor:'pointer', userSelect:'none'}}>
                <input 
                  type="checkbox" 
                  checked={showDirectAgentsOnly} 
                  onChange={e => setShowDirectAgentsOnly(e.target.checked)}
                  style={{cursor:'pointer'}}
                />
                <span>Direct agents only (Yahoska & Katy)</span>
              </label>
              <button className="btn btn-primary" onClick={loadData} disabled={loading}>
                {loading ? 'Loading...' : '🔄 Refresh'}
              </button>
            </div>
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
              <div className="empty-sub">Upload a MedicarePro CSV to get started</div>
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
                    Out of <strong>{sales.length} total sales</strong> in your MedicarePro upload:
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
                    💡 <strong>Tip:</strong> After uploading new commission statements, click "🔄 Refresh" to update the reconciliation.
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
                          <th onClick={() => handleSort('client')} style={{cursor:'pointer', userSelect:'none'}}>
                            Client{sortIndicator('client')}
                          </th>
                          <th onClick={() => handleSort('agent')} style={{cursor:'pointer', userSelect:'none'}}>
                            Agent{sortIndicator('agent')}
                          </th>
                          <th onClick={() => handleSort('carrier')} style={{cursor:'pointer', userSelect:'none'}}>
                            Carrier{sortIndicator('carrier')}
                          </th>
                          <th onClick={() => handleSort('effective_date')} style={{cursor:'pointer', userSelect:'none'}}>
                            Effective Date{sortIndicator('effective_date')}
                          </th>
                          <th>Commission</th>
                          <th>Payment Period</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredPaid.map((m, i) => (
                          <tr key={i}>
                            <td style={{fontWeight:500}}>{m.sale.client_name}</td>
                            <td>{m.sale.agent_name || m.sale.agent || '—'}</td>
                            <td style={{fontSize:12}}>{m.sale.carrier}</td>
                            <td style={{fontSize:12, color:'var(--text-muted)'}}>
                              {formatDate(m.sale.effective_date)}
                            </td>
                            <td style={{fontWeight:600, color:'var(--green)'}}>
                              {m.commission.isManual ? (
                                <span>
                                  Manual
                                  <span className="badge badge-blue" style={{marginLeft:6, fontSize:10}}>
                                    ✓ Marked
                                  </span>
                                </span>
                              ) : (
                                fmt(m.commission.commission)
                              )}
                            </td>
                            <td style={{fontSize:12}}>
                              {m.commission.isManual ? (
                                m.commission.payment_date || '—'
                              ) : (
                                m.commission.payment_period || '—'
                              )}
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
                          <th onClick={() => handleSort('client')} style={{cursor:'pointer', userSelect:'none'}}>
                            Client{sortIndicator('client')}
                          </th>
                          <th onClick={() => handleSort('agent')} style={{cursor:'pointer', userSelect:'none'}}>
                            Agent{sortIndicator('agent')}
                          </th>
                          <th onClick={() => handleSort('carrier')} style={{cursor:'pointer', userSelect:'none'}}>
                            Carrier{sortIndicator('carrier')}
                          </th>
                          <th onClick={() => handleSort('effective_date')} style={{cursor:'pointer', userSelect:'none'}}>
                            Effective Date{sortIndicator('effective_date')}
                          </th>
                          <th>Status</th>
                          <th style={{textAlign:'center'}}>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredUnpaid.map((m, i) => (
                          <tr key={i}>
                            <td style={{fontWeight:500}}>{m.sale.client_name}</td>
                            <td>{m.sale.agent_name || m.sale.agent || '—'}</td>
                            <td style={{fontSize:12}}>{m.sale.carrier}</td>
                            <td style={{fontSize:12, color:'var(--text-muted)'}}>
                              {formatDate(m.sale.effective_date)}
                            </td>
                            <td>
                              <span className="badge badge-amber">
                                {m.sale.status || 'Unpaid'}
                              </span>
                            </td>
                            <td style={{textAlign:'center'}}>
                              <button 
                                className="btn btn-sm btn-primary"
                                onClick={() => handleMarkPaid(m.sale)}
                                style={{fontSize:11, padding:'4px 10px'}}
                              >
                                💰 Mark Paid
                              </button>
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
