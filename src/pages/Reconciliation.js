import React, { useState, useEffect } from 'react';
import { apiFetch } from '../api';
import { formatDate as formatDateUtil } from '../utils/dateFormat';
import { THEI_DIRECT_AGENTS, isTheiDirectAgent, directAgentsLabel } from '../theiPrincipalAgents';
import { normName, normalizeCarrier, carriersMatch } from '../matchingNormalize';

function fmt(n) {
  return '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Multi-select dropdown component
function MultiSelect({ label, options, selected, onChange }) {
  const [open, setOpen] = useState(false);
  const allSelected = selected.length === 0;

  function toggle(val) {
    if (selected.includes(val)) onChange(selected.filter(v => v !== val));
    else onChange([...selected, val]);
  }

  function clear() { onChange([]); setOpen(false); }

  const displayLabel = allSelected ? `All ${label}` : `${selected.length} ${label}`;

  return (
    <div style={{ position: 'relative' }}>
      <button onClick={() => setOpen(o => !o)} style={{
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)',
        background: selected.length > 0 ? 'var(--accent)' : 'var(--bg)',
        color: selected.length > 0 ? 'var(--sidebar-bg)' : 'var(--text)',
        fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap', fontWeight: selected.length > 0 ? 500 : 400
      }}>
        {displayLabel} <span style={{ fontSize: 10 }}>▾</span>
      </button>
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 99 }} />
          <div style={{
            position: 'absolute', top: '100%', left: 0, marginTop: 4,
            background: 'var(--bg)', border: '0.5px solid var(--border)', borderRadius: 8,
            boxShadow: '0 4px 20px rgba(0,0,0,0.12)', zIndex: 100,
            minWidth: 200, maxWidth: 280, maxHeight: 320, overflowY: 'auto', padding: 6
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 8px 8px', borderBottom: '0.5px solid var(--border)', marginBottom: 4 }}>
              <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{label}</span>
              {selected.length > 0 && <button onClick={clear} style={{ fontSize: 11, color: 'var(--red)', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 500 }}>Clear</button>}
            </div>
            {options.map(opt => {
              const isSel = selected.includes(opt);
              return (
                <button key={opt} onClick={() => toggle(opt)} style={{
                  display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                  padding: '6px 8px', background: isSel ? 'var(--accent-light)' : 'none',
                  border: 'none', borderRadius: 4, cursor: 'pointer', textAlign: 'left', fontSize: 12,
                  color: isSel ? 'var(--accent-dark)' : 'var(--text)', fontWeight: isSel ? 500 : 400
                }}>
                  <span style={{
                    width: 14, height: 14, borderRadius: 3, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    border: isSel ? 'none' : '1.5px solid var(--border)', background: isSel ? 'var(--accent)' : 'transparent'
                  }}>
                    {isSel && <span style={{ color: 'var(--sidebar-bg)', fontSize: 9 }}>✓</span>}
                  </span>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{opt}</span>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

// Use standardized MM-DD-YYYY format
function formatDate(dateStr) {
  return formatDateUtil(dateStr);
}

// Normalize names for fuzzy matching
function normalizeName(name) {
  if (!name) return '';
  return name.toLowerCase().trim().replace(/\s+/g, ' ');
}

// Normalize name to match database normalized_name logic (shared matchingNormalize)
// normalizeAgentName kept local for Yahoska test alias
function normalizeAgentName(name) {
  if (!name) return '';
  const normalized = (name || '').toLowerCase().trim().replace(/\s+/g, ' ');
  
  // Map known variations to canonical names
  if (normalized.includes('yahoska')) {
    return 'yahoska perez';  // "Yahoska Test" → "Yahoska Perez"
  }
  
  return normalized;
}

// Resolve client status (Fix #6c: BOB status overrides CSV status)
function resolveStatus(sale) {
  // Priority: BOB status > Termed flag > CSV status
  if (sale.bob_status === 'deceased' || sale.deceased_date) return 'Deceased';
  if (sale.is_termed) return 'Termed';
  if (sale.bob_status) return sale.bob_status;
  return sale.status || 'Active';
}

// Extract first and last name from various formats
function parseClientName(name) {
  if (!name) return { first: '', last: '', full: '' };
  
  const normalized = normalizeName(name);
  
  // Check if it's "LAST, FIRST" format
  if (normalized.includes(',')) {
    const parts = normalized.split(',').map(p => p.trim());
    const last = parts[0].replace(/[^a-z\s]/g, '').trim();  // Remove periods, etc.
    const first = parts[1] ? parts[1].split(' ')[0].replace(/[^a-z]/g, '').trim() : '';  // Get first word, remove initials
    return { first, last, full: `${first} ${last}`.trim() };
  }
  
  // Otherwise assume "FIRST LAST" format
  const words = normalized.split(' ').filter(w => w.length > 1);  // Filter out initials
  if (words.length >= 2) {
    return { first: words[0], last: words[words.length - 1], full: normalized };
  }
  
  return { first: '', last: words[0] || '', full: normalized };
}

// Normalize carrier names — shared matchingNormalize (Omaha ≠ UHC)
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

// Calculate months since enrollment
function monthsSinceEnrollment(effectiveDate, paymentPeriod) {
  if (!effectiveDate || !paymentPeriod) return 0;
  
  try {
    const effDate = new Date(effectiveDate.split('T')[0]);
    const effYear = effDate.getFullYear();
    const effMonth = effDate.getMonth() + 1; // 1-12
    
    const periodStr = String(paymentPeriod).trim();
    let payYear, payMonth;
    
    // Handle YYYYMM format
    if (periodStr.match(/^\d{6}$/)) {
      payYear = parseInt(periodStr.slice(0, 4));
      payMonth = parseInt(periodStr.slice(4, 6));
    } else {
      // Fallback: use current date
      const now = new Date();
      payYear = now.getFullYear();
      payMonth = now.getMonth() + 1;
    }
    
    // Calculate months difference
    const months = (payYear - effYear) * 12 + (payMonth - effMonth);
    
    return Math.max(0, months); // Don't go negative
  } catch {
    return 0;
  }
}

// Calculate expected commission based on declining schedule
// Medicare Advantage: $347 initial, declines $28.92/month, floors at $28.92 renewal
function expectedCommission(months) {
  const initial = 347;
  const decline = 28.92;
  const floor = 28.92; // renewal rate
  
  if (months === 0) return initial; // Month 0 = enrollment month
  
  const calculated = initial - (months * decline);
  return Math.max(calculated, floor);
}

// Find ALL matching commissions for a sale and return net amount
// Period-agnostic: If commission exists for client + carrier, count as Paid
// Returns object with all matches and net commission (e.g., Karl Brown: 6 records = +$352.47 net)
function findMatch(sale, commissions, manualPayments = []) {
  // Check manual payments first
  const saleAgent = sale.agent_name || sale.agent;
  const manualMatch = manualPayments.find(mp => 
    normName(mp.client_name) === normName(sale.client_name) && 
    normalizeAgentName(mp.agent) === normalizeAgentName(saleAgent) && 
    mp.effective_date === sale.effective_date
  );
  
  if (manualMatch) {
    return { ...manualMatch, isManual: true };
  }
  
  // Use normName() for fuzzy client matching (same as Missing Renewals)
  const saleClientNorm = normName(sale.client_name);
  const carrier = normalizeCarrier(sale.carrier);
  const salePolicy = (sale.policy_number || '').trim().toLowerCase();
  
  // Collect ALL matching commission records (not just first)
  const matches = [];
  
  for (const comm of commissions) {
    const commClientNorm = normName(comm.client_full_name);
    const commCarrier = normalizeCarrier(comm.carrier);
    const commPolicy = (comm.policy_number || '').trim().toLowerCase();
    
    // Client name match using normName() (handles "LAST FIRST" vs "FIRST LAST")
    const clientMatch = saleClientNorm === commClientNorm;
    
    // Carrier match (exact canonical — empty carrier never matches)
    const carrierMatch = carriersMatch(carrier, commCarrier);
    
    // Policy number match (fallback for name mismatches)
    const policyMatch = salePolicy && commPolicy && salePolicy === commPolicy;
    
    // PERIOD-AGNOSTIC: Only require client + carrier match
    // OR policy + carrier match (fallback for name normalization issues)
    // Don't check date/period because:
    // 1. New Business records often have blank periods
    // 2. Commission processing can be delayed
    // 3. If they got paid for this client+carrier combo, count it as Paid
    if ((clientMatch && carrierMatch) || (policyMatch && carrierMatch)) {
      matches.push(comm);  // Collect ALL matches, don't return early
    }
  }
  
  if (matches.length === 0) {
    return null;  // No matches found
  }
  
  // Calculate net commission (sum of all matching records)
  // Example: Karl Brown (UHC 933986247) has 6 records:
  //   Sale: +$318.09, +$347.00, -$347.00
  //   Override: +$75.00, -$75.00, +$34.38
  //   Net: +$352.47 (not -$28.91 from partial data)
  const netCommission = matches.reduce((sum, m) => sum + parseFloat(m.commission || 0), 0);
  const hasChargeback = matches.some(m => parseFloat(m.commission || 0) < 0);
  
  // Determine classification based on net
  let classification;
  if (netCommission > 0) {
    classification = hasChargeback ? 'Paid (net positive)' : 'Paid';
  } else if (netCommission === 0) {
    classification = 'Paid & reversed (net $0)';
  } else {
    classification = 'Chargeback expected';
  }
  
  // Return first match as primary (for display compatibility)
  // but include full matches array + net for detailed views
  return {
    ...matches[0],  // Spread first match for backward compatibility
    allMatches: matches,
    matchCount: matches.length,
    netCommission,
    hasChargeback,
    classification
  };
}

export default function Reconciliation({ user }) {
  const [sales, setSales] = useState([]);
  const [commissions, setCommissions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState('unpaid');
  const [filterAgent, setFilterAgent] = useState('all');
  const [filterCarrier, setFilterCarrier] = useState('all');
  const [filterPeriod, setFilterPeriod] = useState('all');
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
      
      // Deduplicate sales by client + policy + date (Fix #6b)
      const rawSales = salesData.sales || [];
      const uniqueSales = Array.from(
        new Map(
          rawSales.map(sale => [
            `${sale.client_name}|${sale.policy_number}|${sale.effective_date}`,
            sale
          ])
        ).values()
      );
      
      if (rawSales.length !== uniqueSales.length) {
        console.log(`✅ Sales deduplication: ${rawSales.length} → ${uniqueSales.length} (removed ${rawSales.length - uniqueSales.length} duplicates)`);
      }
      
      setSales(uniqueSales);
      
      // Fetch commissions from OliComm (ALL records - need complete dataset for matching)
      console.log('Loading commission records...');
      const commData = await apiFetch('/records?limit=50000');  // Increased from 100 to 50000
      console.log('Commission response:', commData);
      
      // Include ALL records (even chargebacks with negative amounts)
      // Need full picture to net: Karl Brown has +$318.09 New Business AND -$347 chargeback
      const allCommissions = commData.records || [];
      console.log(`✅ Loaded ${allCommissions.length} commission records (including chargebacks)`);
      setCommissions(allCommissions);
      
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

  // Filter sales by direct agents if toggle is on (shared list: Yahoska, Katy, Carolina)
  let filteredSales = sales;
  if (showDirectAgentsOnly) {
    filteredSales = sales.filter((sale) => {
      const agentName = sale.agent_name || sale.agent || '';
      return isTheiDirectAgent(agentName);
    });
  }
  
  // Match sales to commissions
  const matches = filteredSales.map(sale => {
    const commission = findMatch(sale, commissions, manualPayments);
    
    // Calculate expected commission based on months since enrollment
    // Use commission period if available, otherwise use current date
    const period = commission?.payment_period || new Date().toISOString().slice(0, 7).replace('-', '');
    const months = monthsSinceEnrollment(sale.effective_date, period);
    const expected = expectedCommission(months);
    
    return {
      sale,
      commission,
      expectedCommission: expected,
      monthsSinceEnrollment: months,
      actualCommission: commission ? parseFloat(commission.commission || 0) : 0,
      difference: commission ? (parseFloat(commission.commission || 0) - expected) : -expected
    };
  });

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

  // Filter by period (effective date month)
  if (filterPeriod !== 'all') {
    const filterPeriodMonth = (effDate) => {
      if (!effDate) return false;
      try {
        // Convert effective_date (YYYY-MM-DD or MM-DD-YYYY) to YYYYMM
        const dateStr = String(effDate).trim();
        let year, month;
        
        // Try YYYY-MM-DD format first
        const match1 = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (match1) {
          year = match1[1];
          month = match1[2];
          return year + month === filterPeriod;
        }
        
        // Try MM-DD-YYYY format
        const match2 = dateStr.match(/^(\d{2})-(\d{2})-(\d{4})/);
        if (match2) {
          month = match2[1];
          year = match2[3];
          return year + month === filterPeriod;
        }
        
        // Try MM/DD/YYYY format
        const match3 = dateStr.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
        if (match3) {
          month = match3[1];
          year = match3[3];
          return year + month === filterPeriod;
        }
        
        return false;
      } catch {
        return false;
      }
    };
    
    filteredPaid = filteredPaid.filter(m => filterPeriodMonth(m.sale.effective_date));
    filteredUnpaid = filteredUnpaid.filter(m => filterPeriodMonth(m.sale.effective_date));
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
  function exportToCSV() {
    // Get current tab data
    let dataToExport = [];
    let filename = '';
    
    if (tab === 'paid') {
      dataToExport = filteredPaid;
      filename = `reconciliation-paid-${new Date().toISOString().split('T')[0]}.csv`;
    } else if (tab === 'unpaid') {
      dataToExport = filteredUnpaid;
      filename = `reconciliation-unpaid-${new Date().toISOString().split('T')[0]}.csv`;
    } else {
      dataToExport = [...filteredPaid, ...filteredUnpaid];
      filename = `reconciliation-all-${new Date().toISOString().split('T')[0]}.csv`;
    }
    
    if (dataToExport.length === 0) {
      alert('No data to export');
      return;
    }
    
    // Build CSV
    const headers = ['Agent', 'Client', 'Carrier', 'Policy Type', 'Effective Date', 'Status', 'Months Since Enrollment', 'Expected Commission', 'Actual Commission', 'Difference', 'Paid'];
    const rows = dataToExport.map(m => {
      const agentName = m.sale.agent_name || m.sale.agent || '—';
      const clientName = m.sale.client_name || '—';
      const carrier = m.sale.carrier || '—';
      const policyType = m.sale.policy_type || '—';
      const effectiveDate = m.sale.effective_date ? formatDate(m.sale.effective_date) : '—';
      const status = resolveStatus(m.sale);
      const monthsSince = m.monthsSinceEnrollment || 0;
      const expected = m.expectedCommission ? m.expectedCommission.toFixed(2) : '0.00';
      const actual = m.actualCommission ? m.actualCommission.toFixed(2) : '0.00';
      const diff = m.difference ? m.difference.toFixed(2) : '0.00';
      const paid = m.commission ? 'Yes' : 'No';
      
      return [
        agentName,
        clientName,
        carrier,
        policyType,
        effectiveDate,
        status,
        monthsSince,
        expected,
        actual,
        diff,
        paid
      ].map(val => `"${String(val).replace(/"/g, '""')}"`).join(',');
    });
    
    const csv = [headers.join(','), ...rows].join('\n');
    
    // Trigger download
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
    URL.revokeObjectURL(link.href);
  }

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
              <div>
                <div className="form-label">Enrollment Period</div>
                <select className="filter-select" value={filterPeriod} onChange={e => setFilterPeriod(e.target.value)}>
                  <option value="all">All periods</option>
                  <option value="202601">Jan 2026</option>
                  <option value="202602">Feb 2026</option>
                  <option value="202603">Mar 2026</option>
                  <option value="202604">Apr 2026</option>
                  <option value="202605">May 2026</option>
                  <option value="202606">Jun 2026</option>
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
                <span>Direct agents only ({directAgentsLabel()})</span>
              </label>
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
            {/* KPI Cards - Show only Paid and Unpaid */}
            <div className="kpi-grid" style={{marginBottom:14, gridTemplateColumns:'repeat(2, 1fr)'}}>
              <div className="kpi-card">
                <div className="kpi-label">⏳ Unpaid</div>
                <div className="kpi-value red">{filteredUnpaid.length}</div>
                <div className="kpi-sub">{filteredPaid.length + filteredUnpaid.length > 0 ? ((filteredUnpaid.length / (filteredPaid.length + filteredUnpaid.length)) * 100).toFixed(1) : '0.0'}%</div>
              </div>
              <div className="kpi-card">
                <div className="kpi-label">✅ Paid</div>
                <div className="kpi-value green">{filteredPaid.length}</div>
                <div className="kpi-sub">{filteredPaid.length + filteredUnpaid.length > 0 ? ((filteredPaid.length / (filteredPaid.length + filteredUnpaid.length)) * 100).toFixed(1) : '0.0'}%</div>
              </div>
            </div>

            {/* Tabs */}
            <div style={{display:'flex', gap:8, marginBottom:12, borderBottom:'1px solid var(--border)', overflowX:'auto'}}>
              <button style={tabStyle('unpaid')} onClick={() => setTab('unpaid')}>
                ⏳ Unpaid ({filteredUnpaid.length})
              </button>
              <button style={tabStyle('paid')} onClick={() => setTab('paid')}>
                ✅ Paid ({filteredPaid.length})
              </button>
            </div>

            {/* Unpaid Tab */}
            {tab === 'unpaid' && (
              <div className="card" style={{padding:0}}>
                {filteredUnpaid.length === 0 ? (
                  <div className="empty-state">
                    <div className="empty-title">No unpaid sales match your filters</div>
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
                              <span className={`badge ${resolveStatus(m.sale) === 'Deceased' || resolveStatus(m.sale) === 'Termed' ? 'badge-red' : 'badge-amber'}`}>
                                {resolveStatus(m.sale)}
                              </span>
                            </td>
                            <td style={{textAlign:'center'}}>
                              {resolveStatus(m.sale) !== 'Deceased' && resolveStatus(m.sale) !== 'Termed' && (
                                <button 
                                  className="btn btn-sm btn-primary"
                                  onClick={() => handleMarkPaid(m.sale)}
                                  style={{fontSize:11, padding:'4px 10px'}}
                                >
                                  💰 Mark Paid
                                </button>
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
                          <th style={{textAlign:'right'}}>Expected</th>
                          <th style={{textAlign:'right'}}>Actual</th>
                          <th style={{textAlign:'right'}}>Difference</th>
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
                            <td style={{textAlign:'right', fontSize:12, color:'var(--text-muted)'}}>
                              {fmt(m.expectedCommission)}
                              <div style={{fontSize:10, marginTop:2}}>Month {m.monthsSinceEnrollment}</div>
                            </td>
                            <td style={{textAlign:'right', fontWeight:600, color: m.actualCommission >= m.expectedCommission ? 'var(--green)' : 'var(--red)'}}>
                              {m.commission.isManual ? (
                                <span>
                                  Manual
                                  <span className="badge badge-blue" style={{marginLeft:6, fontSize:10}}>
                                    ✓ Marked
                                  </span>
                                </span>
                              ) : (
                                fmt(m.actualCommission)
                              )}
                            </td>
                            <td style={{
                              textAlign:'right', 
                              fontWeight:500,
                              color: m.difference >= 0 ? 'var(--green)' : 'var(--red)'
                            }}>
                              {m.difference >= 0 ? '+' : ''}{fmt(Math.abs(m.difference))}
                              {m.difference < -1 && (
                                <div style={{fontSize:10, marginTop:2}}>⚠️ Short payment</div>
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
                              <span className={`badge ${resolveStatus(m.sale) === 'Deceased' || resolveStatus(m.sale) === 'Termed' ? 'badge-red' : 'badge-amber'}`}>
                                {resolveStatus(m.sale)}
                              </span>
                            </td>
                            <td style={{textAlign:'center'}}>
                              {resolveStatus(m.sale) !== 'Deceased' && resolveStatus(m.sale) !== 'Termed' && (
                                <button 
                                  className="btn btn-sm btn-primary"
                                  onClick={() => handleMarkPaid(m.sale)}
                                  style={{fontSize:11, padding:'4px 10px'}}
                                >
                                  💰 Mark Paid
                                </button>
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

          </div>
        )}
      </div>
    </div>
  );
}
