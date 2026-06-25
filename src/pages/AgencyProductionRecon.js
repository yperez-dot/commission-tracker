import React, { useState, useEffect } from 'react';
import { apiFetch } from '../api';
import { formatCarrier } from '../utils/formatCarrier';
import { formatDate as formatDateUtil } from '../utils/dateFormat';

// Version: 2026-06-19-18:50 - Added multi-select filters

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

function fmt(n) {
  return '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Convert YYYYMM period to "Mon YYYY" display format
function formatPeriodLabel(period) {
  if (!period || period === 'Unknown') return '—';
  const periodStr = String(period).trim();
  
  // Handle YYYYMM format (202603 → Mar 2026)
  if (periodStr.match(/^\d{6}$/)) {
    const year = periodStr.slice(0, 4);
    const month = periodStr.slice(4, 6);
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const monthIndex = parseInt(month) - 1;
    if (monthIndex >= 0 && monthIndex < 12) {
      return `${months[monthIndex]} ${year}`;
    }
  }
  
  // Fallback: return as-is
  return periodStr;
}

// Use standardized MM-DD-YYYY format
function formatDate(dateStr) {
  return formatDateUtil(dateStr);
}

function normalizeName(name) {
  if (!name) return '';
  return name.toLowerCase().trim().replace(/\s+/g, ' ');
}

// Normalize name to match database normalized_name logic (same as Missing Renewals / Our Sales)
function normName(name) {
  if (!name) return '';
  const s = String(name).trim();
  
  // Helper: Convert to Title Case
  function toTitleCase(str) {
    return str.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
  }
  
  // Handle comma-separated "LAST, FIRST" format
  // Everything before the comma is the full surname (handles compound surnames)
  if (s.includes(',')) {
    let [last, first] = s.split(',').map(p => p.trim());
    
    // Strip common suffixes from surname
    last = last.replace(/\b(JR|SR|III|II|IV|V)\.?$/i, '').trim();
    
    // Return "FIRST LAST" in Title Case
    const normalized = `${first} ${last}`.replace(/\s+/g, ' ').trim();
    return toTitleCase(normalized);
  }
  
  // For non-comma format, just normalize spaces and title case
  const normalized = s.replace(/\s+/g, ' ').trim();
  return toTitleCase(normalized);
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
  if (!name) return { first: '', last: '' };
  const trimmed = name.trim();

  // Handle "LAST, FIRST" format
  if (trimmed.includes(',')) {
    const parts = trimmed.split(',');
    return {
      last: parts[0].trim().toLowerCase(),
      first: parts[1].trim().toLowerCase()
    };
  }

  // Handle "FIRST LAST" format
  const parts = trimmed.split(' ');
  return {
    last: parts[parts.length - 1].toLowerCase(),
    first: parts[0].toLowerCase()
  };
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

// Match agency production to override commissions using normName() fuzzy matching
// TYPE-AWARE NETTING: Collect ALL matching overrides and calculate override_net
// Same fix as Sales Reconciliation (Fix B)
function findOverrideMatch(production, overrides) {
  const prodClientNorm = normName(production.client_name);
  const prodCarrier = normalizeCarrier(production.carrier);
  
  // Collect ALL matching overrides (not just first)
  const matches = [];
  
  for (const override of overrides) {
    const overrideClientNorm = normName(override.client_full_name);
    const overrideCarrier = normalizeCarrier(override.carrier);
    
    // Client name match using normName() (handles "LAST FIRST" vs "FIRST LAST")
    const clientMatch = prodClientNorm === overrideClientNorm;
    
    // Carrier match
    const carrierMatch = prodCarrier === overrideCarrier || 
                        prodCarrier.includes(overrideCarrier) || 
                        overrideCarrier.includes(prodCarrier);
    
    // Match if client + carrier match (period-agnostic)
    if (clientMatch && carrierMatch) {
      matches.push(override);  // Collect ALL matches, don't return early
    }
  }
  
  if (matches.length === 0) {
    return null;  // No matches found
  }
  
  // Calculate override_net (sum of all matching override records)
  // Example: David Mosley Jr (UHC 135614656): +$70 -$70 = $0 net
  // Example: Maritza Trivino Pin: +75 -75 +75 -75 +6.25 +3.13 +28.13 = $37.51 net
  const override_net = matches.reduce((sum, m) => sum + parseFloat(m.commission || 0), 0);
  const hasChargeback = matches.some(m => parseFloat(m.commission || 0) < 0);
  
  // Determine classification based on override_net
  let classification;
  if (override_net > 0) {
    classification = hasChargeback ? 'Override Paid (net +)' : 'Override Paid';
  } else if (override_net === 0 && matches.length > 0) {
    classification = 'Override Paid & reversed (net $0)';
  } else if (override_net < 0) {
    classification = 'Override Chargeback expected';
  } else {
    classification = 'No Override';
  }
  
  // Return first match as primary (for display compatibility)
  // but include TYPE-AWARE nets and full matches array
  return {
    ...matches[0],  // Spread first match for backward compatibility
    allMatches: matches,
    matchCount: matches.length,
    override_net,       // Net of all override records (KEY for verdict)
    hasChargeback,
    classification
  };
}

export default function AgencyProductionRecon() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [production, setProduction] = useState([]);
  const [overrides, setOverrides] = useState([]);
  const [tab, setTab] = useState('missing'); // Default to Missing tab
  const [filterCarriers, setFilterCarriers] = useState([]);
  const [filterAgents, setFilterAgents] = useState([]);
  const [filterEffDates, setFilterEffDates] = useState([]);
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
      
      // FIX: Filter to LATEST upload batch only (prevents cross-batch duplicates)
      // John Rivera 3× was caused by same person in 3 different upload batches
      const allProduction = prodData.production || [];
      
      if (allProduction.length > 0) {
        // Find the latest batch
        const latestBatch = allProduction.reduce((max, p) => {
          const batch = p.upload_batch || '';
          return batch > max ? batch : max;
        }, '');
        
        console.log(`[BATCH FILTER] Total production records: ${allProduction.length}`);
        console.log(`[BATCH FILTER] Latest batch: ${latestBatch}`);
        
        // Filter to only latest batch
        const latestOnly = allProduction.filter(p => p.upload_batch === latestBatch);
        
        console.log(`[BATCH FILTER] After filtering to latest batch: ${latestOnly.length}`);
        console.log(`[BATCH FILTER] Removed ${allProduction.length - latestOnly.length} records from older batches`);
        
        setProduction(latestOnly);
      } else {
        setProduction([]);
      }

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

  // DEDUPLICATION: Remove duplicate production records before matching
  // Deduplicate by: client_name + carrier ONLY
  // Example: John Rivera appears 3×, Lilia Rivera 2× (duplicates in agency_production table)
  // FIX: After testing policy_number (0.6% deduped) and effective_date (1% deduped),
  //      neither worked because duplicates have blank/different values in those fields.
  //      True duplicates = same client + carrier, regardless of policy/date variations.
  //      Keep the record with most complete data (has policy_number, or newest effective_date).
  const productionDeduped = [];
  const seen = new Map();  // Store best record for each key
  
  // DEBUG: Track duplicates for analysis
  const duplicateLog = [];
  
  production.forEach(prod => {
    // Dedup key: ONLY client + carrier (no policy, no date)
    const normalizedClient = normName(prod.client_name || '');
    const normalizedCarrier = normalizeCarrier(prod.carrier || '');
    const key = [normalizedClient, normalizedCarrier].join('|').toLowerCase();
    
    const existing = seen.get(key);
    
    // DEBUG: Log when we find a duplicate
    if (existing) {
      duplicateLog.push({
        key,
        original: { name: existing.client_name, carrier: existing.carrier },
        duplicate: { name: prod.client_name, carrier: prod.carrier }
      });
    }
    
    if (!existing) {
      // First occurrence - keep it
      seen.set(key, prod);
    } else {
      // Duplicate found - keep the one with most complete data
      // Prefer: has policy_number > has effective_date > first occurrence
      const prodHasPolicy = !!(prod.policy_number && prod.policy_number.trim());
      const existingHasPolicy = !!(existing.policy_number && existing.policy_number.trim());
      const prodHasDate = !!(prod.effective_date);
      const existingHasDate = !!(existing.effective_date);
      
      if (prodHasPolicy && !existingHasPolicy) {
        seen.set(key, prod);  // New record has policy, existing doesn't
      } else if (!prodHasPolicy && !existingHasPolicy && prodHasDate && !existingHasDate) {
        seen.set(key, prod);  // Neither has policy, but new has date
      }
      // Otherwise keep existing (first occurrence or already has better data)
    }
  });
  
  seen.forEach(prod => productionDeduped.push(prod));
  
  console.log(`[DEDUP] Production records: ${production.length} → ${productionDeduped.length} (removed ${production.length - productionDeduped.length} duplicates)`);
  
  // Debug: log if dedup seems too low
  const dupesRemoved = production.length - productionDeduped.length;
  if (production.length > 100 && dupesRemoved < (production.length * 0.05)) {
    console.warn(`[DEDUP] Warning: Only removed ${dupesRemoved} of ${production.length} (${(dupesRemoved/production.length*100).toFixed(1)}%) - dedup key may be too strict`);
    // Show first 10 duplicates that WERE caught
    if (duplicateLog.length > 0) {
      console.log(`[DEDUP] Sample duplicates found (first 10):`, duplicateLog.slice(0, 10));
    }
    // Sample some records to see what keys are being generated
    const sampleKeys = production.slice(0, 20).map(p => ({
      raw: { name: p.client_name, carrier: p.carrier },
      normalized: { name: normName(p.client_name || ''), carrier: normalizeCarrier(p.carrier || '') },
      key: [normName(p.client_name || ''), normalizeCarrier(p.carrier || '')].join('|').toLowerCase()
    }));
    console.log(`[DEDUP] Sample normalized keys (first 20):`, sampleKeys);
  }
  
  // Match deduplicated production to overrides
  const matches = productionDeduped.map(prod => ({
    production: prod,
    override: findOverrideMatch(prod, overrides)
  }));

  // TYPE-AWARE CATEGORIZATION: Use override_net to determine paid vs missing
  // A row is only "paid" if override_net > 0
  // Net $0 or negative → NOT paid (goes to missing or special status)
  const getCategory = (m) => {
    // Check status flags first (plan change, denied, etc.)
    const status = m.production.status?.toLowerCase() || '';
    if (status.includes('plan denied') || status.includes('plan_denied') || status.includes('denied')) return 'plandenied';
    if (status.includes('plan change') || status.includes('plan_change')) return 'planchange';
    if (status.includes('cancel') || status.includes('terminated')) return 'cancelled';
    if (status.includes('chase') || status.includes('chasing')) return 'chase';
    
    // TYPE-AWARE VERDICT: Check override_net, not just existence
    if (m.override && m.override.override_net > 0) {
      return 'paid';  // Only paid if override_net > 0
    }
    
    // If override_net = 0 or < 0, it's NOT paid
    // David Mosley Jr: +$70 -$70 = $0 net → missing (not paid)
    return 'missing';
  };

  const categorized = {
    missing: matches.filter(m => getCategory(m) === 'missing'),
    planchange: matches.filter(m => getCategory(m) === 'planchange'),
    plandenied: matches.filter(m => getCategory(m) === 'plandenied'),
    chase: matches.filter(m => getCategory(m) === 'chase'),
    cancelled: matches.filter(m => getCategory(m) === 'cancelled'),
    paid: matches.filter(m => getCategory(m) === 'paid')
  };

  // Apply filters to each category
  const applyFilters = (list) => {
    let filtered = list;
    
    if (filterAgents.length > 0) {
      filtered = filtered.filter(m => filterAgents.includes(m.production.agent_name));
    }
    
    if (filterCarriers.length > 0) {
      filtered = filtered.filter(m => {
        const prodCarrier = normalizeCarrier(m.production.carrier);
        return filterCarriers.some(fc => normalizeCarrier(fc) === prodCarrier);
      });
    }
    
    if (filterEffDates.length > 0) {
      filtered = filtered.filter(m => filterEffDates.includes(m.production.effective_date || ''));
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
    tab === 'missing' ? (filtered.missing || []) :
    tab === 'planchange' ? (filtered.planchange || []) :
    tab === 'plandenied' ? (filtered.plandenied || []) :
    tab === 'chase' ? (filtered.chase || []) :
    tab === 'cancelled' ? (filtered.cancelled || []) :
    tab === 'paid' ? (filtered.paid || []) :
    [...(filtered.missing || []), ...(filtered.planchange || []), ...(filtered.plandenied || []), ...(filtered.chase || []), ...(filtered.cancelled || []), ...(filtered.paid || [])];

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
  
  // Get unique effective dates
  const effectiveDates = [...new Set(production.map(p => p.effective_date).filter(Boolean))].sort((a, b) => b.localeCompare(a)); // Sort descending (newest first)

  function exportToCSV() {
    let dataToExport = [];
    let filename = '';
    
    if (tab === 'missing') {
      dataToExport = filtered.missing || [];
      filename = `agency-overrides-missing-${new Date().toISOString().split('T')[0]}.csv`;
    } else if (tab === 'planchange') {
      dataToExport = filtered.planchange || [];
      filename = `agency-overrides-planchange-${new Date().toISOString().split('T')[0]}.csv`;
    } else if (tab === 'cancelled') {
      dataToExport = filtered.cancelled || [];
      filename = `agency-overrides-cancelled-${new Date().toISOString().split('T')[0]}.csv`;
    } else if (tab === 'paid') {
      dataToExport = filtered.paid || [];
      filename = `agency-overrides-paid-${new Date().toISOString().split('T')[0]}.csv`;
    } else {
      dataToExport = [...(filtered.missing || []), ...(filtered.planchange || []), ...(filtered.cancelled || []), ...(filtered.paid || [])];
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
      const paid = m.override && m.override.override_net > 0 ? 'Yes' : 'No';
      const amount = m.override ? (m.override.override_net || '0') : '—';
      
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
                <div className="form-label" style={{ marginBottom: 6 }}>Agents</div>
                <MultiSelect 
                  label="Agents" 
                  options={agents} 
                  selected={filterAgents} 
                  onChange={setFilterAgents} 
                />
              </div>
              <div>
                <div className="form-label" style={{ marginBottom: 6 }}>Carriers</div>
                <MultiSelect 
                  label="Carriers" 
                  options={carriers} 
                  selected={filterCarriers} 
                  onChange={setFilterCarriers} 
                />
              </div>
              <div>
                <div className="form-label" style={{ marginBottom: 6 }}>Effective Dates</div>
                <MultiSelect 
                  label="Dates" 
                  options={effectiveDates} 
                  selected={filterEffDates} 
                  onChange={setFilterEffDates} 
                />
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
                Missing ({(filtered.missing || []).length})
              </button>
              <button style={tabStyle('planchange')} onClick={() => setTab('planchange')}>
                Plan Change ({(filtered.planchange || []).length})
              </button>
              <button style={tabStyle('plandenied')} onClick={() => setTab('plandenied')}>
                Plan Denied ({(filtered.plandenied || []).length})
              </button>
              <button style={tabStyle('chase')} onClick={() => setTab('chase')}>
                Chase ({(filtered.chase || []).length})
              </button>
              <button style={tabStyle('cancelled')} onClick={() => setTab('cancelled')}>
                Cancelled ({(filtered.cancelled || []).length})
              </button>
              <button style={tabStyle('paid')} onClick={() => setTab('paid')}>
                Paid ({(filtered.paid || []).length})
              </button>
              <button style={tabStyle('all')} onClick={() => setTab('all')}>
                All ({(filtered.missing || []).length + (filtered.planchange || []).length + (filtered.plandenied || []).length + (filtered.chase || []).length + (filtered.cancelled || []).length + (filtered.paid || []).length})
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
                                if (m && m.production) {
                                  setSelectedProduction(m.production);
                                }
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
                              let displayStatus;
                              let bgColor;
                              let textColor;
                              
                              // Check production status flags first (plan change, denied, etc.)
                              if (status.includes('cancel') || status.includes('terminated')) {
                                displayStatus = 'Cancelled';
                                bgColor = '#F8D7DA';
                                textColor = '#721C24';
                              } else if (status.includes('plan change') || status.includes('planchange')) {
                                displayStatus = 'Plan Change';
                                bgColor = '#E9D5FF';
                                textColor = '#6B21A8';
                              } else if (status.includes('plan denied') || status.includes('plan_denied') || status.includes('denied')) {
                                displayStatus = 'Plan Denied';
                                bgColor = '#FFF3CD';
                                textColor = '#856404';
                              } else if (status.includes('chase') || status.includes('chasing')) {
                                displayStatus = 'Chase';
                                bgColor = '#D1ECF1';
                                textColor = '#0C5460';
                              } else {
                                // FIXED: Check actual override payment (override_net > 0), not production.status
                                // This fixes the "Paid badge in Missing tab" bug
                                if (m.override && m.override.override_net > 0) {
                                  displayStatus = 'Paid';
                                  bgColor = '#D4EDDA';
                                  textColor = '#155724';
                                } else {
                                  displayStatus = 'Missing';
                                  bgColor = '#F8F9FA';
                                  textColor = '#6C757D';
                                }
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
                              <span style={{ color: m.override.override_net > 0 ? 'var(--green)' : 'var(--amber)', fontWeight: 600 }}>
                                {m.override.override_net > 0 ? '✅' : '⚠️'} {fmt(m.override.override_net || 0)}
                                {m.override.matchCount > 1 && <span style={{ fontSize: '0.85em', marginLeft: 4 }}>({m.override.matchCount} records)</span>}
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
