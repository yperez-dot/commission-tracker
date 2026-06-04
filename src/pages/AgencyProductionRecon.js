import React, { useState, useEffect } from 'react';
import { apiFetch } from '../api';

function fmt(n) {
  return '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  try {
    const dateOnly = dateStr.split('T')[0];
    const [year, month, day] = dateOnly.split('-');
    const date = new Date(year, month - 1, day);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return dateStr;
  }
}

function normalizeName(name) {
  if (!name) return '';
  return name.toLowerCase().trim().replace(/\s+/g, ' ');
}

function normalizeCarrier(carrier) {
  if (!carrier) return '';
  const c = carrier.toLowerCase().trim();
  
  if (c.includes('humana')) return 'humana';
  if (c.includes('aetna')) return 'aetna';
  if (c.includes('uhc') || c.includes('united')) return 'uhc';
  if (c.includes('doctors')) return 'doctors';
  if (c.includes('careplus') || c.includes('care plus')) return 'careplus';
  if (c.includes('devoted')) return 'devoted';
  if (c.includes('solis')) return 'solis';
  
  return c;
}

function parseClientName(name) {
  if (!name) return { first: '', last: '', full: '' };
  
  const normalized = normalizeName(name);
  
  if (normalized.includes(',')) {
    const parts = normalized.split(',').map(p => p.trim());
    const last = parts[0].replace(/[^a-z\s]/g, '').trim();
    const first = parts[1] ? parts[1].split(' ')[0].replace(/[^a-z]/g, '').trim() : '';
    return { first, last, full: `${first} ${last}`.trim() };
  }
  
  const words = normalized.split(' ').filter(w => w.length > 1);
  if (words.length >= 2) {
    return { first: words[0], last: words[words.length - 1], full: normalized };
  }
  
  return { first: '', last: words[0] || '', full: normalized };
}

// Match agency production to override commissions
function findOverrideMatch(production, overrides) {
  const prodClientParsed = parseClientName(production.client_name);
  const prodCarrier = normalizeCarrier(production.carrier);
  
  for (const override of overrides) {
    const overrideClientParsed = parseClientName(override.client_full_name);
    const overrideCarrier = normalizeCarrier(override.carrier);
    
    const firstMatch = prodClientParsed.first && overrideClientParsed.first && 
                       prodClientParsed.first === overrideClientParsed.first;
    const lastMatch = prodClientParsed.last && overrideClientParsed.last && 
                      prodClientParsed.last === overrideClientParsed.last;
    const clientMatch = firstMatch && lastMatch;
    
    const carrierMatch = prodCarrier === overrideCarrier || 
                        prodCarrier.includes(overrideCarrier) || 
                        overrideCarrier.includes(prodCarrier);
    
    if (clientMatch && carrierMatch) {
      return override;
    }
  }
  
  return null;
}

export default function AgencyProductionRecon() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [production, setProduction] = useState([]);
  const [overrides, setOverrides] = useState([]);
  const [tab, setTab] = useState('all');
  const [filterCarrier, setFilterCarrier] = useState('all');
  const [filterAgent, setFilterAgent] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedOverride, setSelectedOverride] = useState(null);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    setError(null);
    try {
      // Load agency production (Hector's reports)
      const prodData = await apiFetch('/agency-production?limit=5000');
      setProduction(prodData.production || []);

      // Load override commission statements
      const overrideData = await apiFetch('/records?limit=5000');
      
      // Filter to only override statements (by classification)
      const overrideStatements = (overrideData.records || []).filter(r => {
        const classification = r.classification?.toLowerCase() || '';
        return classification.includes('agency override') || classification.includes('override');
      });
      
      setOverrides(overrideStatements);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  // Match production to overrides
  const matches = production.map(prod => ({
    production: prod,
    override: findOverrideMatch(prod, overrides)
  }));

  const paid = matches.filter(m => m.override);
  const unpaid = matches.filter(m => !m.override);

  // Apply filters
  let filteredPaid = paid;
  let filteredUnpaid = unpaid;

  if (filterAgent !== 'all') {
    filteredPaid = paid.filter(m => m.production.agent_name === filterAgent);
    filteredUnpaid = unpaid.filter(m => m.production.agent_name === filterAgent);
  }

  if (filterCarrier !== 'all') {
    filteredPaid = filteredPaid.filter(m => normalizeCarrier(m.production.carrier) === normalizeCarrier(filterCarrier));
    filteredUnpaid = filteredUnpaid.filter(m => normalizeCarrier(m.production.carrier) === normalizeCarrier(filterCarrier));
  }

  if (searchTerm.trim()) {
    const search = searchTerm.toLowerCase();
    filteredPaid = filteredPaid.filter(m => 
      (m.production.client_name || '').toLowerCase().includes(search) ||
      (m.production.agent_name || '').toLowerCase().includes(search) ||
      (m.production.carrier || '').toLowerCase().includes(search)
    );
    filteredUnpaid = filteredUnpaid.filter(m => 
      (m.production.client_name || '').toLowerCase().includes(search) ||
      (m.production.agent_name || '').toLowerCase().includes(search) ||
      (m.production.carrier || '').toLowerCase().includes(search)
    );
  }

  const displayData = tab === 'paid' ? filteredPaid : tab === 'unpaid' ? filteredUnpaid : [...filteredPaid, ...filteredUnpaid];

  const agents = [...new Set(production.map(p => p.agent_name).filter(Boolean))].sort();
  const carriers = [...new Set(production.map(p => p.carrier).filter(Boolean))].sort();

  function exportToCSV() {
    let dataToExport = [];
    let filename = '';
    
    if (tab === 'paid') {
      dataToExport = filteredPaid;
      filename = `agency-overrides-paid-${new Date().toISOString().split('T')[0]}.csv`;
    } else if (tab === 'unpaid') {
      dataToExport = filteredUnpaid;
      filename = `agency-overrides-unpaid-${new Date().toISOString().split('T')[0]}.csv`;
    } else {
      dataToExport = [...filteredPaid, ...filteredUnpaid];
      filename = `agency-overrides-all-${new Date().toISOString().split('T')[0]}.csv`;
    }
    
    if (dataToExport.length === 0) {
      alert('No data to export');
      return;
    }
    
    const headers = ['Agent', 'Client', 'Carrier', 'Plan', 'Effective Date', 'Status', 'Override Paid', 'Override Amount'];
    const rows = dataToExport.map(m => {
      const agentName = m.production.agent_name || '—';
      const clientName = m.production.client_name || '—';
      const carrier = m.production.carrier || '—';
      const plan = m.production.plan_name || '—';
      const effectiveDate = m.production.effective_date ? formatDate(m.production.effective_date) : '—';
      const status = m.production.status || '—';
      const paid = m.override ? 'Yes' : 'No';
      const amount = m.override ? (m.override.commission || m.override.commission_amount || '0') : '—';
      
      return [
        agentName,
        clientName,
        carrier,
        plan,
        effectiveDate,
        status,
        paid,
        amount
      ].map(val => `"${String(val).replace(/"/g, '""')}"`).join(',');
    });
    
    const csv = [headers.join(','), ...rows].join('\n');
    
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
    URL.revokeObjectURL(link.href);
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
      {/* Override Details Modal */}
      {selectedOverride && (
        <div 
          onClick={() => setSelectedOverride(null)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999
          }}
        >
          <div 
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'white',
              borderRadius: 12,
              maxWidth: '600px',
              width: '90%',
              maxHeight: '85vh',
              overflow: 'auto',
              boxShadow: '0 10px 40px rgba(0,0,0,0.3)'
            }}
          >
            <div style={{
              padding: '20px',
              borderBottom: '1px solid var(--border)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center'
            }}>
              <div>
                <h2 style={{ margin: 0, fontSize: 18, color: 'var(--text)' }}>
                  📊 Override Statement Details
                </h2>
                <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-muted)' }}>
                  Matched BSI/NHP commission record
                </p>
              </div>
              <button 
                onClick={() => setSelectedOverride(null)}
                style={{
                  background: 'var(--red)',
                  color: 'white',
                  border: 'none',
                  borderRadius: 4,
                  padding: '6px 12px',
                  cursor: 'pointer',
                  fontSize: 12,
                  fontWeight: 500
                }}
              >
                Close
              </button>
            </div>
            <div style={{ padding: '20px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr', gap: '12px 16px', fontSize: 13 }}>
                <div style={{ color: 'var(--text-muted)', fontWeight: 500 }}>Client Name:</div>
                <div style={{ fontWeight: 600, color: 'var(--text)' }}>{selectedOverride.override.client_full_name || '—'}</div>
                
                <div style={{ color: 'var(--text-muted)', fontWeight: 500 }}>Agent Name:</div>
                <div>{selectedOverride.override.agent_name || '—'}</div>
                
                <div style={{ color: 'var(--text-muted)', fontWeight: 500 }}>Carrier:</div>
                <div>{selectedOverride.override.carrier || '—'}</div>
                
                <div style={{ color: 'var(--text-muted)', fontWeight: 500 }}>Plan Type:</div>
                <div>{selectedOverride.override.plan_type || '—'}</div>
                
                <div style={{ color: 'var(--text-muted)', fontWeight: 500 }}>Classification:</div>
                <div>
                  <span className="badge" style={{
                    background: 'var(--blue-light)',
                    color: 'var(--blue)',
                    padding: '3px 8px',
                    borderRadius: 4,
                    fontSize: 11
                  }}>
                    {selectedOverride.override.classification || '—'}
                  </span>
                </div>
                
                <div style={{ color: 'var(--text-muted)', fontWeight: 500 }}>Commission:</div>
                <div style={{ fontWeight: 600, color: 'var(--green)', fontSize: 16 }}>
                  {fmt(selectedOverride.override.commission || selectedOverride.override.commission_amount || 0)}
                </div>
                
                <div style={{ color: 'var(--text-muted)', fontWeight: 500 }}>Effective Date:</div>
                <div>{selectedOverride.override.effective_date ? formatDate(selectedOverride.override.effective_date) : '—'}</div>
                
                <div style={{ color: 'var(--text-muted)', fontWeight: 500 }}>Payment Period:</div>
                <div>{selectedOverride.override.payment_period || '—'}</div>
                
                <div style={{ color: 'var(--text-muted)', fontWeight: 500 }}>Policy Number:</div>
                <div style={{ fontFamily: 'monospace', fontSize: 12 }}>{selectedOverride.override.policy_number || '—'}</div>
                
                {selectedOverride.override.payee && (
                  <>
                    <div style={{ color: 'var(--text-muted)', fontWeight: 500 }}>Payee:</div>
                    <div>{selectedOverride.override.payee}</div>
                  </>
                )}
              </div>
              
              <div style={{
                marginTop: 20,
                padding: 12,
                background: 'var(--blue-light)',
                borderRadius: 6,
                fontSize: 12,
                color: 'var(--text-muted)'
              }}>
                <strong>Production Record:</strong> {selectedOverride.production.client_name} ({selectedOverride.production.carrier})
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="page-header">
        <div className="page-title">🏢 Agency Override Reconciliation</div>
      </div>

      <div className="page-body">
        <div className="card" style={{ marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <div>
                <div className="form-label">Search</div>
                <input 
                  type="text"
                  className="filter-select"
                  placeholder="Client, agent, or carrier..."
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                  style={{ minWidth: 220 }}
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
            <div style={{ display: 'flex', gap: 12 }}>
              <button className="btn btn-secondary" onClick={exportToCSV} disabled={loading}>
                📥 Export CSV
              </button>
              <button className="btn btn-primary" onClick={loadData} disabled={loading}>
                {loading ? 'Loading...' : '🔄 Refresh'}
              </button>
            </div>
          </div>
        </div>

        {error && (
          <div className="card" style={{ marginTop: 20, background: 'var(--red-light)', border: '1px solid var(--red)', padding: 16 }}>
            ❌ {error}
          </div>
        )}

        {!loading && (
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ borderBottom: '1px solid var(--border)', padding: '0 20px', display: 'flex', gap: 2 }}>
              <button style={tabStyle('all')} onClick={() => setTab('all')}>
                All ({paid.length + unpaid.length})
              </button>
              <button style={tabStyle('paid')} onClick={() => setTab('paid')}>
                Override Paid ({paid.length})
              </button>
              <button style={tabStyle('unpaid')} onClick={() => setTab('unpaid')}>
                Missing Override ({unpaid.length})
              </button>
            </div>

            <div style={{ padding: 20 }}>
              {displayData.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
                  {production.length === 0 
                    ? 'No agency production data yet. Upload Hector\'s reports to get started!' 
                    : 'No results match your filters.'}
                </div>
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Agent</th>
                        <th>Client</th>
                        <th>Carrier</th>
                        <th>Plan</th>
                        <th>Effective Date</th>
                        <th>Status</th>
                        <th style={{ textAlign: 'center' }}>Override</th>
                      </tr>
                    </thead>
                    <tbody>
                      {displayData.map((m, idx) => (
                        <tr key={idx}>
                          <td style={{ fontSize: 13 }}>{m.production.agent_name || '—'}</td>
                          <td style={{ fontWeight: 500 }}>
                            {m.override ? (
                              <a 
                                href="#"
                                onClick={(e) => {
                                  e.preventDefault();
                                  setSelectedOverride({ production: m.production, override: m.override });
                                }}
                                style={{
                                  color: 'var(--blue)',
                                  textDecoration: 'none',
                                  cursor: 'pointer',
                                  borderBottom: '1px dashed var(--blue)'
                                }}
                                onMouseOver={(e) => e.target.style.borderBottom = '1px solid var(--blue)'}
                                onMouseOut={(e) => e.target.style.borderBottom = '1px dashed var(--blue)'}
                                title="Click to view override statement details"
                              >
                                {m.production.client_name}
                              </a>
                            ) : (
                              m.production.client_name
                            )}
                          </td>
                          <td>{m.production.carrier}</td>
                          <td style={{ fontSize: 12 }}>{m.production.plan_name || '—'}</td>
                          <td style={{ fontSize: 12 }}>
                            {m.production.effective_date ? formatDate(m.production.effective_date) : '—'}
                          </td>
                          <td>
                            <span className="badge" style={{
                              background: m.production.status?.toLowerCase().includes('active') ? '#D4EDDA' : '#FFF3CD',
                              color: m.production.status?.toLowerCase().includes('active') ? '#155724' : '#856404',
                              padding: '4px 8px',
                              borderRadius: 4,
                              fontSize: 11
                            }}>
                              {m.production.status || '—'}
                            </span>
                          </td>
                          <td style={{ textAlign: 'center' }}>
                            {m.override ? (
                              <span style={{ color: 'var(--green)', fontWeight: 600 }}>
                                ✅ {fmt(m.override.commission || m.override.commission_amount || 0)}
                              </span>
                            ) : (
                              <span style={{ color: 'var(--red)', fontWeight: 600 }}>❌ Missing</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        <div style={{ marginTop: 30, padding: 16, background: 'var(--blue-light)', borderRadius: 6, borderLeft: '4px solid var(--blue)', color: 'var(--blue-dark)', fontSize: 13, lineHeight: 1.6 }}>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>💡 How this works:</div>
          <ul style={{ paddingLeft: 20, margin: 0 }}>
            <li><strong>Agency Production:</strong> Hector's monthly reports showing ALL sales (uploaded via "Upload Agency Production")</li>
            <li><strong>Override Statements:</strong> BSI/NHP commission statements showing what THEI got paid</li>
            <li><strong>This page:</strong> Matches production to overrides and shows missing payments</li>
            <li><strong>Missing Override:</strong> Sales exist in production but no override commission found</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
