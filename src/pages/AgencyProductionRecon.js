import React, { useState, useEffect } from 'react';
import { apiFetch } from '../api';
import { formatCarrier } from '../utils/formatCarrier';
import { formatDate as formatDateUtil } from '../utils/dateFormat';

// Version: 2026-06-04-19:03 - HealthSun consolidation fix

function fmt(n) {
  return '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Use standardized MM-DD-YYYY format
function formatDate(dateStr) {
  return formatDateUtil(dateStr);
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
  if (c.includes('uhc') || c.includes('united')) return 'unitedhealthcare';
  if (c.includes('doctors')) return 'doctors';
  if (c.includes('careplus') || c.includes('care plus')) return 'careplus';
  if (c.includes('devoted')) return 'devoted';
  if (c.includes('solis')) return 'solis';
  if (c.includes('healthsun') || c.includes('health sun')) return 'healthsun';
  if (c.includes('oscar')) return 'oscar health';
  if (c.includes('molina')) return 'molina';
  if (c.includes('wellcare')) return 'wellcare';
  if (c.includes('florida blue') || c.includes('bcbs') || c.includes('blue cross')) return 'florida blue';
  if (c.includes('cigna')) return 'cigna';
  if (c.includes('avmed')) return 'avmed';
  if (c.includes('simply')) return 'simply';
  if (c.includes('gold kidney') || c.includes('goldkidney')) return 'gold kidney';
  if (c.includes('elevance') || c.includes('anthem')) return 'elevance medicare';
  if (c.includes('freedom')) return 'freedom';
  if (c.includes('nhp')) return 'nhp';

  return c;
}

function parseClientName(name) {
  if (!name) return { first: '', last: '', full: '' };
  
  const normalized = normalizeName(name);
  
  if (normalized.includes(',')) {
    const parts = normalized.split(',').map(p => p.trim());
    const last = parts[0].replace(/[^a-z\s]/g, '').trim();
    const firstPart = parts[1] || '';
    const firstWords = firstPart.split(' ').filter(w => w.length > 0);
    const first = firstWords[0] ? firstWords[0].replace(/[^a-z]/g, '').trim() : '';
    return { first, last, full: `${first} ${last}`.trim() };
  }
  
  const words = normalized.split(' ').filter(w => w.length > 1);
  if (words.length >= 2) {
    return { first: words[0], last: words[words.length - 1], full: normalized };
  }
  
  return { first: '', last: words[0] || '', full: normalized };
}

// Calculate string similarity (0-1, higher is more similar)
function stringSimilarity(str1, str2) {
  if (!str1 || !str2) return 0;
  if (str1 === str2) return 1;
  
  const s1 = str1.toLowerCase();
  const s2 = str2.toLowerCase();
  
  // Check if one contains the other
  if (s1.includes(s2) || s2.includes(s1)) return 0.9;
  
  // Simple character overlap score
  const len1 = s1.length;
  const len2 = s2.length;
  const maxLen = Math.max(len1, len2);
  
  let matches = 0;
  const minLen = Math.min(len1, len2);
  for (let i = 0; i < minLen; i++) {
    if (s1[i] === s2[i]) matches++;
  }
  
  return matches / maxLen;
}

// Parse date to YYYYMM format
function parseEffectiveDate(dateStr) {
  if (!dateStr) return null;
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return null;
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    return `${year}${month}`;
  } catch {
    return null;
  }
}

// Match agency production to override commissions with improved fuzzy matching
function findOverrideMatch(production, overrides) {
  const prodClientParsed = parseClientName(production.client_name);
  const prodCarrier = normalizeCarrier(production.carrier);
  const prodDate = parseEffectiveDate(production.effective_date);
  const prodPolicy = (production.policy_number || '').toLowerCase().trim();
  
  let bestMatch = null;
  let bestScore = 0;
  
  for (const override of overrides) {
    const overrideClientParsed = parseClientName(override.client_full_name);
    const overrideCarrier = normalizeCarrier(override.carrier);
    const overrideDate = parseEffectiveDate(override.effective_date);
    const overridePolicy = (override.policy_number || '').toLowerCase().trim();
    
    let score = 0;
    
    // 1. Carrier match (required, +30 points)
    const carrierMatch = prodCarrier === overrideCarrier || 
                        prodCarrier.includes(overrideCarrier) || 
                        overrideCarrier.includes(prodCarrier);
    if (!carrierMatch) continue; // Skip if carrier doesn't match
    score += 30;
    
    // 2. Last name match (fuzzy, +40 points max)
    if (prodClientParsed.last && overrideClientParsed.last) {
      const lastSimilarity = stringSimilarity(prodClientParsed.last, overrideClientParsed.last);
      if (lastSimilarity > 0.7) {
        score += lastSimilarity * 40;
      } else {
        continue; // Last name too different, skip
      }
    } else {
      continue; // No last name, skip
    }
    
    // 3. First name match (fuzzy, +30 points max)
    if (prodClientParsed.first && overrideClientParsed.first) {
      const firstSimilarity = stringSimilarity(prodClientParsed.first, overrideClientParsed.first);
      score += firstSimilarity * 30;
    }
    
    // 4. Effective date match (same month/year, +20 points)
    if (prodDate && overrideDate && prodDate === overrideDate) {
      score += 20;
    }
    
    // 5. Policy number match (exact, +50 points - strong signal!)
    if (prodPolicy && overridePolicy && prodPolicy === overridePolicy) {
      score += 50;
    }
    
    // Track best match
    if (score > bestScore && score >= 70) { // Require minimum 70 points
      bestScore = score;
      bestMatch = override;
    }
  }
  
  return bestMatch;
}

export default function AgencyProductionRecon() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [production, setProduction] = useState([]);
  const [overrides, setOverrides] = useState([]);
  const [tab, setTab] = useState('missing'); // Default to Missing tab
  const [filterCarrier, setFilterCarrier] = useState('all');
  const [filterAgent, setFilterAgent] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedOverride, setSelectedOverride] = useState(null);
  const [selectedProduction, setSelectedProduction] = useState(null);

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

  // Categorize by status
  const getCategory = (m) => {
    if (m.override) return 'paid';
    const status = m.production.status?.toLowerCase() || '';
    if (status.includes('plan change') || status.includes('plan_change')) return 'planchange';
    if (status.includes('cancel') || status.includes('terminated')) return 'cancelled';
    return 'missing'; // No override = missing
  };

  const categorized = {
    missing: matches.filter(m => getCategory(m) === 'missing'),
    planchange: matches.filter(m => getCategory(m) === 'planchange'),
    cancelled: matches.filter(m => getCategory(m) === 'cancelled'),
    paid: matches.filter(m => getCategory(m) === 'paid')
  };

  // Apply filters to each category
  const applyFilters = (list) => {
    let filtered = list;
    
    if (filterAgent !== 'all') {
      filtered = filtered.filter(m => m.production.agent_name === filterAgent);
    }
    
    if (filterCarrier !== 'all') {
      filtered = filtered.filter(m => normalizeCarrier(m.production.carrier) === normalizeCarrier(filterCarrier));
    }
    
    if (searchTerm.trim()) {
      const search = searchTerm.toLowerCase();
      filtered = filtered.filter(m => 
        (m.production.client_name || '').toLowerCase().includes(search) ||
        (m.production.agent_name || '').toLowerCase().includes(search) ||
        (m.production.carrier || '').toLowerCase().includes(search)
      );
    }
    
    return filtered;
  };

  const filtered = {
    missing: applyFilters(categorized.missing),
    planchange: applyFilters(categorized.planchange),
    cancelled: applyFilters(categorized.cancelled),
    paid: applyFilters(categorized.paid)
  };

  const displayData = 
    tab === 'missing' ? filtered.missing :
    tab === 'planchange' ? filtered.planchange :
    tab === 'cancelled' ? filtered.cancelled :
    tab === 'paid' ? filtered.paid :
    [...filtered.missing, ...filtered.planchange, ...filtered.cancelled, ...filtered.paid];

  const agents = [...new Set(production.map(p => p.agent_name).filter(Boolean))].sort();
  // Get unique carriers and format them consistently
  const uniqueCarriers = [...new Set(production.map(p => normalizeCarrier(p.carrier)).filter(Boolean))];
  const carriers = uniqueCarriers
    .map(c => {
      // Find original carrier name for display
      const original = production.find(p => normalizeCarrier(p.carrier) === c)?.carrier;
      return formatCarrier(original || c);
    })
    .filter((v, i, arr) => arr.indexOf(v) === i) // Remove duplicates after formatting
    .sort();

  function exportToCSV() {
    let dataToExport = [];
    let filename = '';
    
    if (tab === 'missing') {
      dataToExport = filtered.missing;
      filename = `agency-overrides-missing-${new Date().toISOString().split('T')[0]}.csv`;
    } else if (tab === 'planchange') {
      dataToExport = filtered.planchange;
      filename = `agency-overrides-planchange-${new Date().toISOString().split('T')[0]}.csv`;
    } else if (tab === 'cancelled') {
      dataToExport = filtered.cancelled;
      filename = `agency-overrides-cancelled-${new Date().toISOString().split('T')[0]}.csv`;
    } else if (tab === 'paid') {
      dataToExport = filtered.paid;
      filename = `agency-overrides-paid-${new Date().toISOString().split('T')[0]}.csv`;
    } else {
      dataToExport = [...filtered.missing, ...filtered.planchange, ...filtered.cancelled, ...filtered.paid];
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
      const carrier = formatCarrier(m.production.carrier) || '—';
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
                  Matched BSI commission record
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
                <strong>Production Record:</strong> {selectedOverride.production.client_name} ({formatCarrier(selectedOverride.production.carrier)})
              </div>
            </div>
          </div>
        </div>
      )}

      {selectedProduction && (
        <div 
          onClick={() => setSelectedProduction(null)}
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
              maxWidth: '500px',
              width: '90%',
              boxShadow: '0 10px 40px rgba(0,0,0,0.3)'
            }}
          >
            <div style={{
              padding: '16px 20px',
              borderBottom: '1px solid var(--border)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center'
            }}>
              <div>
                <h2 style={{ margin: 0, fontSize: 16, color: 'var(--text)', fontWeight: 600 }}>
                  📄 Upload Source
                </h2>
                <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--text-muted)' }}>
                  {selectedProduction.client_name}
                </p>
              </div>
              <button 
                onClick={() => setSelectedProduction(null)}
                style={{
                  background: 'none',
                  border: 'none',
                  fontSize: 20,
                  cursor: 'pointer',
                  color: 'var(--text-muted)',
                  padding: 4
                }}
              >
                ×
              </button>
            </div>
            <div style={{ padding: '16px 20px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '100px 1fr', gap: '10px', fontSize: 13 }}>
                <div style={{ color: 'var(--text-muted)', fontWeight: 500 }}>Source:</div>
                <div style={{ fontWeight: 500, color: 'var(--text)' }}>{selectedProduction.upload_filename || '—'}</div>
                
                <div style={{ color: 'var(--text-muted)', fontWeight: 500 }}>Uploaded:</div>
                <div>
                  {selectedProduction.upload_date ? formatDate(selectedProduction.upload_date) : '—'}
                  {selectedProduction.uploaded_by_user && (
                    <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                      {' · by '}{selectedProduction.uploaded_by_user}
                    </span>
                  )}
                </div>
                
                <div style={{ color: 'var(--text-muted)', fontWeight: 500 }}>Period:</div>
                <div style={{ fontWeight: 500 }}>{selectedProduction.upload_batch ? formatPeriodLabel(selectedProduction.upload_batch) : '—'}</div>
                
                <div style={{ color: 'var(--text-muted)', fontWeight: 500 }}>Batch:</div>
                <div style={{ fontFamily: 'monospace', fontSize: 12 }}>{selectedProduction.upload_batch || '—'}</div>
                
                <div style={{ color: 'var(--text-muted)', fontWeight: 500 }}>Carrier:</div>
                <div>{formatCarrier(selectedProduction.carrier)}</div>
                
                <div style={{ color: 'var(--text-muted)', fontWeight: 500 }}>Agent:</div>
                <div>{selectedProduction.agent_name || '—'}</div>
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
              <button style={tabStyle('missing')} onClick={() => setTab('missing')}>
                Missing ({filtered.missing.length})
              </button>
              <button style={tabStyle('planchange')} onClick={() => setTab('planchange')}>
                Plan Change ({filtered.planchange.length})
              </button>
              <button style={tabStyle('cancelled')} onClick={() => setTab('cancelled')}>
                Cancelled ({filtered.cancelled.length})
              </button>
              <button style={tabStyle('paid')} onClick={() => setTab('paid')}>
                Paid ({filtered.paid.length})
              </button>
              <button style={tabStyle('all')} onClick={() => setTab('all')}>
                All ({filtered.missing.length + filtered.planchange.length + filtered.cancelled.length + filtered.paid.length})
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
                <div style={{ overflowY: 'auto', maxHeight: 'calc(100vh - 280px)' }}>
                  <table>
                    <thead style={{ position: 'sticky', top: 0, background: 'var(--bg)', zIndex: 1 }}>
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
                            <a 
                              href="#"
                              onClick={(e) => {
                                e.preventDefault();
                                setSelectedProduction(m.production);
                              }}
                              style={{
                                color: 'var(--blue)',
                                textDecoration: 'none',
                                cursor: 'pointer',
                                borderBottom: '1px dashed var(--blue)'
                              }}
                              onMouseOver={(e) => e.target.style.borderBottom = '1px solid var(--blue)'}
                              onMouseOut={(e) => e.target.style.borderBottom = '1px dashed var(--blue)'}
                              title="Click to view upload details"
                            >
                              {m.production.client_name}
                            </a>
                          </td>
                          <td>{formatCarrier(m.production.carrier)}</td>
                          <td style={{ fontSize: 12 }}>{m.production.plan_name || '—'}</td>
                          <td style={{ fontSize: 12 }}>
                            {m.production.effective_date ? formatDate(m.production.effective_date) : '—'}
                          </td>
                          <td>
                            {(() => {
                              const status = m.production.status?.toLowerCase() || '';
                              let displayStatus = 'Paid';
                              let bgColor = '#D4EDDA';
                              let textColor = '#155724';
                              
                              if (status.includes('cancel') || status.includes('terminated')) {
                                displayStatus = 'Cancelled';
                                bgColor = '#F8D7DA';
                                textColor = '#721C24';
                              } else if (status.includes('plan change') || status.includes('planchange')) {
                                displayStatus = 'Plan Change';
                                bgColor = '#E9D5FF';
                                textColor = '#6B21A8';
                              } else if (status.includes('missing') || status.includes('pending') || status.includes('not found')) {
                                displayStatus = 'Missing';
                                bgColor = '#F8F9FA';
                                textColor = '#6C757D';
                              } else if (status.includes('paid') || status.includes('complete') || status.includes('active') || status.includes('progress')) {
                                displayStatus = 'Paid';
                              }
                              
                              return (
                                <span className="badge" style={{
                                  background: bgColor,
                                  color: textColor,
                                  padding: '4px 8px',
                                  borderRadius: 4,
                                  fontSize: 11,
                                  fontWeight: 500
                                }}>
                                  {displayStatus}
                                </span>
                              );
                            })()}
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
            <li><strong>Override Statements:</strong> BSI commission statements showing what THEI got paid</li>
            <li><strong>This page:</strong> Matches production to overrides and shows status</li>
          </ul>
          <div style={{ fontWeight: 600, marginTop: 12, marginBottom: 8 }}>Status Categories:</div>
          <ul style={{ paddingLeft: 20, margin: 0 }}>
            <li><strong>Missing:</strong> Sales exist in production but no override commission found</li>
            <li><strong>Plan Change:</strong> Client changed plans (may or may not have override)</li>
            <li><strong>Cancelled:</strong> Application cancelled, denied, or disenrolled</li>
            <li><strong>Paid:</strong> Override commission found in statements</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
