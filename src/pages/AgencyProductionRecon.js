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

      // Load override commission statements (BSI/NHP)
      // These are in commission_records with carrier = 'BSI' or 'NHP' or specific override indicators
      const overrideData = await apiFetch('/records?limit=5000');
      
      // Debug: Show what carriers and classifications we have
      const allCarriers = [...new Set((overrideData.records || []).map(r => r.carrier))].sort();
      const allClassifications = [...new Set((overrideData.records || []).map(r => r.classification))].sort();
      console.log('📊 All carriers in commission_records:', allCarriers);
      console.log('🏷️ All classifications:', allClassifications);
      
      // Filter to only override statements (by classification, not carrier!)
      const overrideStatements = (overrideData.records || []).filter(r => {
        const classification = r.classification?.toLowerCase() || '';
        return classification.includes('agency override') || classification.includes('override');
      });
      
      console.log('✅ Override records found:', overrideStatements.length);
      console.log('📋 Override carriers:', [...new Set(overrideStatements.map(r => r.carrier))].sort());
      console.log('📋 Override classifications:', [...new Set(overrideStatements.map(r => r.classification))].sort());
      
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
      const amount = m.override ? (m.override.commission_amount || '0') : '—';
      
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
      <div className="page-header">
        <div className="page-title">🏢 Agency Override Reconciliation</div>
        <div className="page-sub">Compare agency production (Hector's reports) vs override commissions (filtered by classification="Agency Override")</div>
      </div>

      {/* Debug Info Panel */}
      {(production.length > 0 || overrides.length > 0) && (
        <div style={{
          background: '#FFF3CD',
          border: '1px solid #FFE69C',
          borderRadius: 8,
          padding: 16,
          marginBottom: 16,
          fontSize: 13
        }}>
          <div style={{ fontWeight: 600, marginBottom: 8, color: '#856404' }}>🔍 Debug Info:</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, color: '#856404' }}>
            <div>
              <strong>Production Records:</strong> {production.length}
            </div>
            <div>
              <strong>Override Records:</strong> {overrides.length}
            </div>
            <div>
              <strong>Matched:</strong> {paid.length} | <strong>Unmatched:</strong> {unpaid.length}
            </div>
          </div>
          {overrides.length === 0 && (
            <div style={{ marginTop: 8, padding: 8, background: '#F8D7DA', border: '1px solid #F5C6CB', borderRadius: 4, color: '#721C24' }}>
              ⚠️ <strong>No override records found!</strong> Make sure BSI/NHP statements are uploaded to Commission Statements.
            </div>
          )}
        </div>
      )}

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
                          <td style={{ fontWeight: 500 }}>{m.production.client_name}</td>
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
                                ✅ {fmt(m.override.commission_amount)}
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
