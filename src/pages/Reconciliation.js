import React, { useState, useEffect } from 'react';
import { apiFetch } from '../api';
import { formatDate as formatDateUtil } from '../utils/dateFormat';
import {
  buildDepositTimeline,
  expectedSaleCommission,
  resolveSalePaymentStatus,
  sumCommissionNet,
} from '../utils/salesReconPayment';
import { THEI_DIRECT_AGENTS, isTheiDirectAgent, directAgentsLabel } from '../theiPrincipalAgents';
import { normName, normalizeCarrier, carriersMatch } from '../matchingNormalizeEs';
import { fetchAllPages, truncationMessage } from '../fetchAllPages';
import TruncationBanner from '../components/TruncationBanner';

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

  const saleMatches = matches.filter(m => {
    const c = (m.classification || '').toLowerCase();
    return !c.includes('override');
  });
  const netMatches = saleMatches.length ? saleMatches : matches;

  const netCommission = sumCommissionNet(netMatches, { saleSideOnly: false });
  const hasChargeback = netMatches.some(m => parseFloat(m.commission || 0) < 0);
  
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
    ...netMatches[0],
    allMatches: matches,
    saleMatches: netMatches,
    matchCount: netMatches.length,
    netCommission,
    hasChargeback,
    classification
  };
}

function DepositTimeline({ deposits }) {
  if (!deposits?.length) return <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>—</span>;
  return (
    <div style={{ fontSize: 11, lineHeight: 1.5 }}>
      {deposits.map((d, i) => (
        <div key={i} style={{ color: d.amount < 0 ? 'var(--red)' : 'var(--text-muted)' }}>
          {d.period}: {fmt(d.amount)}
        </div>
      ))}
    </div>
  );
}

function ExpectedCell({ meta, amount }) {
  const kind = meta?.kind;
  if (kind === 'med_supp') {
    if (amount == null) {
      return (
        <td style={{ textAlign: 'right', fontSize: 12, color: 'var(--text-muted)' }}>
          —
          <div style={{ fontSize: 10, marginTop: 2, lineHeight: 1.35 }}>
            {meta?.note || 'Med Supp (need plan/state)'}
          </div>
        </td>
      );
    }
    return (
      <td style={{ textAlign: 'right', fontSize: 12, color: 'var(--text-muted)' }}>
        {fmt(amount)}
        <div style={{ fontSize: 10, marginTop: 2, lineHeight: 1.35 }}>
          {meta?.medSupp?.tableKey
            ? `Med Supp Y1 · ${meta.medSupp.tableKey} · Plan ${meta.medSupp.plan || '?'}`
            : 'Med Supp Year 1'}
        </div>
      </td>
    );
  }
  if (kind === 'pdp') {
    return (
      <td style={{ textAlign: 'right', fontSize: 12, color: 'var(--text-muted)' }}>
        —
        <div style={{ fontSize: 10, marginTop: 2, lineHeight: 1.35 }}>PDP (no MA $347)</div>
      </td>
    );
  }
  const prorated = meta?.prorated;
  return (
    <td style={{ textAlign: 'right', fontSize: 12, color: 'var(--text-muted)' }}>
      {fmt(amount)}
      <div style={{ fontSize: 10, marginTop: 2, lineHeight: 1.35 }}>
        {prorated
          ? `MA prorated ${meta.remainingMonths}/12 mo`
          : meta?.kind === 'renewal'
            ? 'MA renewal floor'
            : 'MA full year (Jan)'}
      </div>
    </td>
  );
}

function PaymentStatusBadge({ status }) {
  const styles = {
    unpaid: { bg: '#FEF3C7', color: '#92400E', label: 'Unpaid' },
    partial: { bg: '#FEF9C3', color: '#854D0E', label: 'Partial' },
    paid: { bg: '#EAF3DE', color: '#3B6D11', label: 'Paid in full' },
    overpaid: { bg: '#E6F1FB', color: '#0C447C', label: 'Overpaid' },
    manual: { bg: '#E6F1FB', color: '#0C447C', label: 'Marked paid' },
    reversed: { bg: '#F3F4F6', color: '#374151', label: 'Net zero' },
  };
  const s = styles[status?.id] || styles.unpaid;
  return (
    <span
      style={{
        background: s.bg,
        color: s.color,
        borderRadius: 4,
        padding: '2px 8px',
        fontSize: 10,
        fontWeight: 600,
        whiteSpace: 'nowrap',
      }}
    >
      {status?.label || s.label}
    </span>
  );
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
  const [truncationWarning, setTruncationWarning] = useState(null);

  async function loadData() {
    setLoading(true);
    setError(null);
    setTruncationWarning(null);
    console.log('Loading MedicarePro sales...');
    try {
      // Fetch sales from MedicarePro upload endpoint (page through limit)
      const salesPage = await fetchAllPages('/medicarepro', {
        itemsKey: 'sales',
        pageSize: 10000,
      }, apiFetch);
      const rawSales = salesPage.items || [];
      console.log('MedicarePro sales loaded:', rawSales.length, 'total', salesPage.total);

      // Deduplicate sales by client + policy + date (Fix #6b)
      const uniqueSales = Array.from(
        new Map(
          rawSales.map(sale => [
            `${sale.client_name}|${sale.policy_number}|${sale.effective_date}`,
            sale
          ])
        ).values()
      );

      if (rawSales.length !== uniqueSales.length) {
        console.log(`Sales deduplication: ${rawSales.length} → ${uniqueSales.length} (removed ${rawSales.length - uniqueSales.length} duplicates)`);
      }

      setSales(uniqueSales);

      // Fetch commissions from OliComm (ALL records - need complete dataset for matching)
      console.log('Loading commission records...');
      const commPage = await fetchAllPages('/records', { pageSize: 5000 }, apiFetch);
      console.log(`Loaded ${commPage.fetched} commission records (total ${commPage.total})`);
      setCommissions(commPage.items || []);

      setTruncationWarning(truncationMessage([
        salesPage.warning ? `Sales: ${salesPage.warning}` : null,
        commPage.warning ? `Commissions: ${commPage.warning}` : null,
      ]));

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

    const period = commission?.payment_period || new Date().toISOString().slice(0, 7).replace('-', '');
    const months = monthsSinceEnrollment(sale.effective_date, period);
    const expect = expectedSaleCommission(sale);
    const expected = expect.amount;
    const actualNet = commission
      ? (commission.isManual
          ? (expected != null ? expected : (commission.netCommission || 0))
          : (commission.netCommission ?? parseFloat(commission.commission || 0)))
      : 0;
    const deposits = commission?.isManual
      ? []
      : buildDepositTimeline(commission?.saleMatches || commission?.allMatches || []);
    const paymentStatus = resolveSalePaymentStatus({
      expected,
      actualNet,
      isManual: !!commission?.isManual,
      fullYear: expect.fullYear,
    });

    return {
      sale,
      commission,
      expectedCommission: expected,
      expectedMeta: expect,
      monthsSinceEnrollment: months,
      actualCommission: actualNet,
      difference: expected != null ? actualNet - expected : 0,
      deposits,
      paymentStatus,
    };
  });

  const unpaid = matches.filter(m => m.paymentStatus.id === 'unpaid');
  const partial = matches.filter(m => m.paymentStatus.id === 'partial');
  const paid = matches.filter(m =>
    ['paid', 'overpaid', 'manual', 'reversed'].includes(m.paymentStatus.id)
  );

  // Apply filters
  let filteredPaid = paid;
  let filteredPartial = partial;
  let filteredUnpaid = unpaid;

  if (filterAgent !== 'all') {
    filteredPaid = paid.filter(m => (m.sale.agent_name || m.sale.agent) === filterAgent);
    filteredPartial = partial.filter(m => (m.sale.agent_name || m.sale.agent) === filterAgent);
    filteredUnpaid = unpaid.filter(m => (m.sale.agent_name || m.sale.agent) === filterAgent);
  }

  if (filterCarrier !== 'all') {
    filteredPaid = filteredPaid.filter(m => normalizeCarrier(m.sale.carrier) === normalizeCarrier(filterCarrier));
    filteredPartial = filteredPartial.filter(m => normalizeCarrier(m.sale.carrier) === normalizeCarrier(filterCarrier));
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
    filteredPartial = filteredPartial.filter(m => filterPeriodMonth(m.sale.effective_date));
    filteredUnpaid = filteredUnpaid.filter(m => filterPeriodMonth(m.sale.effective_date));
  }

  // Apply search term
  if (searchTerm.trim()) {
    const search = searchTerm.toLowerCase();
    const matchSearch = (m) =>
      (m.sale.client_name || '').toLowerCase().includes(search) ||
      (m.sale.agent || '').toLowerCase().includes(search) ||
      (m.sale.carrier || '').toLowerCase().includes(search);

    filteredPaid = filteredPaid.filter(matchSearch);
    filteredPartial = filteredPartial.filter(matchSearch);
    filteredUnpaid = filteredUnpaid.filter(matchSearch);
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
  filteredPartial = sortData(filteredPartial);
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
    } else if (tab === 'partial') {
      dataToExport = filteredPartial;
      filename = `reconciliation-partial-${new Date().toISOString().split('T')[0]}.csv`;
    } else if (tab === 'unpaid') {
      dataToExport = filteredUnpaid;
      filename = `reconciliation-unpaid-${new Date().toISOString().split('T')[0]}.csv`;
    } else {
      dataToExport = [...filteredUnpaid, ...filteredPartial, ...filteredPaid];
      filename = `reconciliation-all-${new Date().toISOString().split('T')[0]}.csv`;
    }
    
    if (dataToExport.length === 0) {
      alert('No data to export');
      return;
    }
    
    // Build CSV
    const headers = [
      'Agent', 'Client', 'Carrier', 'Policy Type', 'Effective Date', 'BOB Status',
      'Payment Status', 'Expected (prorated NB)', 'Full-year $347', 'Prorated months',
      'Actual (net)', 'Remaining vs prorated', 'Deposit Count', 'Deposits',
    ];
    const rows = dataToExport.map(m => {
      const agentName = m.sale.agent_name || m.sale.agent || '—';
      const clientName = m.sale.client_name || '—';
      const carrier = m.sale.carrier || '—';
      const policyType = m.sale.policy_type || '—';
      const effectiveDate = m.sale.effective_date ? formatDate(m.sale.effective_date) : '—';
      const bobStatus = resolveStatus(m.sale);
      const payStatus = m.paymentStatus?.label || '—';
      const expected = (m.expectedCommission || 0).toFixed(2);
      const fullYear = (m.expectedMeta?.fullYear || 347).toFixed(2);
      const months = m.expectedMeta?.remainingMonths ?? '';
      const actual = (m.actualCommission || 0).toFixed(2);
      const remaining = Math.max(0, (m.expectedCommission || 0) - (m.actualCommission || 0)).toFixed(2);
      const depositCount = m.deposits?.length || 0;
      const deposits = (m.deposits || []).map(d => `${d.period}:${d.amount.toFixed(2)}`).join(' | ');

      return [
        agentName, clientName, carrier, policyType, effectiveDate, bobStatus,
        payStatus, expected, fullYear, months, actual, remaining, depositCount, deposits,
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
        <div className="page-sub">Medicare Advantage expected is calendar-prorated ($347 full year). Medicare Supplement: UHC AARP Year-1 by plan/area; HealthSpring/CNHIC from AgentView as-earned (~47% of modal × 12) — not $347.</div>
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
            <div style={{color:'var(--red-dark)', fontWeight:500}}>Error: {error}</div>
          </div>
        )}

        <TruncationBanner message={truncationWarning} />

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
            <div className="kpi-grid" style={{marginBottom:14, gridTemplateColumns:'repeat(3, 1fr)'}}>
              <div className="kpi-card">
                <div className="kpi-label">Unpaid</div>
                <div className="kpi-value red">{filteredUnpaid.length}</div>
              </div>
              <div className="kpi-card">
                <div className="kpi-label">Partial</div>
                <div className="kpi-value" style={{ color: '#854D0E' }}>{filteredPartial.length}</div>
                <div className="kpi-sub">Split deposits / short vs expected</div>
              </div>
              <div className="kpi-card">
                <div className="kpi-label">Paid in full</div>
                <div className="kpi-value green">{filteredPaid.length}</div>
              </div>
            </div>

            {/* Tabs */}
            <div style={{display:'flex', gap:8, marginBottom:12, borderBottom:'1px solid var(--border)', overflowX:'auto'}}>
              <button style={tabStyle('unpaid')} onClick={() => setTab('unpaid')}>
                Unpaid ({filteredUnpaid.length})
              </button>
              <button style={tabStyle('partial')} onClick={() => setTab('partial')}>
                Partial ({filteredPartial.length})
              </button>
              <button style={tabStyle('paid')} onClick={() => setTab('paid')}>
                Paid in full ({filteredPaid.length})
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
                          <th style={{textAlign:'right'}}>Expected</th>
                          <th>BOB</th>
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
                            <ExpectedCell meta={m.expectedMeta} amount={m.expectedCommission} />
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
                                  Mark paid
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

            {/* Partial Tab */}
            {tab === 'partial' && (
              <div className="card" style={{padding:0}}>
                {filteredPartial.length === 0 ? (
                  <div className="empty-state">
                    <div className="empty-title">No partial payments match your filters</div>
                    <div className="empty-sub">Upload the next carrier statement when the remaining deposit arrives</div>
                  </div>
                ) : (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Client</th>
                          <th>Agent</th>
                          <th>Carrier</th>
                          <th style={{textAlign:'right'}}>Expected</th>
                          <th style={{textAlign:'right'}}>Received (net)</th>
                          <th style={{textAlign:'right'}}>Still owed</th>
                          <th>Deposits</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredPartial.map((m, i) => (
                          <tr key={i}>
                            <td style={{fontWeight:500}}>{m.sale.client_name}</td>
                            <td>{m.sale.agent_name || m.sale.agent || '—'}</td>
                            <td style={{fontSize:12}}>{m.sale.carrier}</td>
                            <ExpectedCell meta={m.expectedMeta} amount={m.expectedCommission} />
                            <td style={{textAlign:'right', fontWeight:600, color:'#854D0E'}}>
                              {fmt(m.actualCommission)}
                              {m.deposits.length > 1 && (
                                <div style={{fontSize:10, marginTop:2}}>{m.deposits.length} deposits</div>
                              )}
                            </td>
                            <td style={{textAlign:'right', fontWeight:600, color:'var(--red)'}}>
                              {fmt(m.paymentStatus.remaining ?? Math.max(0, m.expectedCommission - m.actualCommission))}
                            </td>
                            <td><DepositTimeline deposits={m.deposits} /></td>
                            <td><PaymentStatusBadge status={m.paymentStatus} /></td>
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
                    <div className="empty-title">No paid-in-full sales match your filters</div>
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
                          <th style={{textAlign:'right'}}>Actual (net)</th>
                          <th style={{textAlign:'right'}}>Difference</th>
                          <th>Deposits</th>
                          <th>Status</th>
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
                            <ExpectedCell meta={m.expectedMeta} amount={m.expectedCommission} />
                            <td style={{textAlign:'right', fontWeight:600, color: m.actualCommission >= m.expectedCommission ? 'var(--green)' : 'var(--text)'}}>
                              {m.commission?.isManual ? 'Manual' : fmt(m.actualCommission)}
                            </td>
                            <td style={{
                              textAlign:'right',
                              fontWeight:500,
                              color: m.difference >= 0 ? 'var(--green)' : 'var(--red)'
                            }}>
                              {m.difference >= 0 ? '+' : ''}{fmt(Math.abs(m.difference))}
                            </td>
                            <td><DepositTimeline deposits={m.deposits} /></td>
                            <td><PaymentStatusBadge status={m.paymentStatus} /></td>
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
