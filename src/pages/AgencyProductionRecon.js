import React, { useState, useEffect, useMemo } from 'react';
import { apiFetch } from '../api';
import { formatCarrier } from '../utils/formatCarrier';
import { formatDate as formatDateUtil } from '../utils/dateFormat';
import { normName, normalizeCarrier, carriersMatch } from '../matchingNormalize';
import { findOverrideMatch, expandOverrideLifecycle, dedupeProductionSales, isOverrideStatementRow, getThreeWayOverrideStatus, getOverrideReconCategory } from '../agencyOverrideReconMatch';
import { fetchAllPages, truncationMessage } from '../fetchAllPages';
import TruncationBanner from '../components/TruncationBanner';
import { expectedAgencyOverride, expectedOverrideLabel } from '../utils/agencyOverrideExpected';

// Version: 2026-08-15 — shared matchingNormalize (Omaha ≠ UHC, empty-carrier safe)

// Multi-select dropdown component
function MultiSelect({ label, options, selected, onChange, formatOption }) {
  const [open, setOpen] = useState(false);
  const allSelected = selected.length === 0;
  const fmt = formatOption || (v => v);

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
            <button onClick={clear} style={{
                display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                padding: '6px 8px', background: allSelected ? 'var(--accent-light)' : 'none',
                border: 'none', borderRadius: 4, cursor: 'pointer', textAlign: 'left', fontSize: 12,
                color: allSelected ? 'var(--accent-dark)' : 'var(--text)', fontWeight: allSelected ? 500 : 400,
                marginBottom: 2
              }}>
                <span style={{
                  width: 14, height: 14, borderRadius: 3, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  border: allSelected ? 'none' : '1.5px solid var(--border)', background: allSelected ? 'var(--accent)' : 'transparent'
                }}>
                  {allSelected && <span style={{ color: 'var(--sidebar-bg)', fontSize: 9 }}>✓</span>}
                </span>
                <span>Select All</span>
              </button>
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
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{fmt(opt)}</span>
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

/** Expected BSI→THEI cell — same visual language as Sales Recon Expected. */
function ExpectedOverrideCell({ production, asTd = true }) {
  let meta;
  try {
    meta = expectedAgencyOverride(production || {});
  } catch {
    meta = { amount: null, note: 'Rate lookup failed', kind: 'unknown' };
  }
  const label = expectedOverrideLabel(meta) || meta.note || '';
  const inner = (
    <>
      {meta.amount == null ? (
        <span style={{ color: 'var(--text-muted)' }}>—</span>
      ) : (
        <span style={{ fontWeight: 600, color: 'var(--text)' }}>{fmt(meta.amount)}</span>
      )}
      <div style={{ fontSize: 10, marginTop: 2, lineHeight: 1.35, color: 'var(--text-muted)' }}>
        {label}
      </div>
    </>
  );
  if (!asTd) return <div style={{ textAlign: 'right', fontSize: 12 }}>{inner}</div>;
  return (
    <td style={{ textAlign: 'right', fontSize: 12, verticalAlign: 'top', padding: '8px 10px', borderBottom: '1px solid var(--border)' }}>
      {inner}
    </td>
  );
}

function normalizeName(name) {
  if (!name) return '';
  return name.toLowerCase().trim().replace(/\s+/g, ' ');
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

// Match agency production to override commissions (netted — see agencyOverrideReconMatch.js)
// findOverrideMatch imported from shared module

// Pure helpers — defined outside component so useMemo deps stay stable
function _findCarrierBSIMatch(prod, carrierRecords) {
  const prodPeriod = prod.payment_period || '';
  if (prodPeriod) {
    const samePeriod = carrierRecords.filter((r) => r.payment_period === prodPeriod);
    const periodMatch = findOverrideMatch(prod, samePeriod);
    if (periodMatch) return periodMatch;
  }
  // Fall back across periods — Hector month ≠ statement month still means carrier paid BSI.
  return findOverrideMatch(prod, carrierRecords);
}

// Extract hold detail for held_licensing rows: { reason, state, county }
// Prefers the carrierBSI Held record; falls back to heldRecord.
function _getHoldDetail(m) {
  const src = (m.carrierBSI && m.carrierBSI.classification === 'Held') ? m.carrierBSI
            : m.heldRecord || null;
  if (!src) return null;
  try {
    const rd = typeof src.raw_data === 'string' ? JSON.parse(src.raw_data) : (src.raw_data || {});
    return {
      reason: rd['Hold Reason'] || null,
      state:  rd['Member State'] || null,
      county: rd['Member County'] || null,
    };
  } catch { return null; }
}

// Pure helper: period-agnostic lookup for a Held record by client+carrier.
// Used when _findCarrierBSIMatch misses because payment_period differs.
function _findHeldRecord(prod, carrierRecords) {
  const prodClientNorm = normName(prod.client_name);
  const prodCarrier = normalizeCarrier(prod.carrier);
  return carrierRecords.find(r =>
    r.classification === 'Held' &&
    normName(r.client_full_name) === prodClientNorm &&
    carriersMatch(r.carrier, prodCarrier)
  ) || null;
}

// Aliases — shared three-way / tab logic lives in agencyOverrideReconMatch.js
const _getThreeWayStatus = getThreeWayOverrideStatus;
const _getCategory = getOverrideReconCategory;

export default function AgencyProductionRecon() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [production, setProduction] = useState([]);
  const [overrides, setOverrides] = useState([]);
  const [carrierBSIRecords, setCarrierBSIRecords] = useState([]);
  const [bsiUploadedKeys, setBsiUploadedKeys] = useState(new Set()); // "CARRIER|PERIOD" keys
  const [tab, setTab] = useState('missing'); // Missing holds Not on BSI / Chase / pending (status tags)
  const [filterCarriers, setFilterCarriers] = useState([]);
  const [filterAgents, setFilterAgents] = useState([]);
  const [filterEffDates, setFilterEffDates] = useState([]);
  const [filterOverrideStatus, setFilterOverrideStatus] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [sortCol, setSortCol] = useState(null);
  const [sortDir, setSortDir] = useState('asc');
  const [selectedOverride, setSelectedOverride] = useState(null);
  const [selectedProduction, setSelectedProduction] = useState(null);
  const [editingMatch, setEditingMatch] = useState(null); // row opened via Edit button
  const [overrideSaving, setOverrideSaving] = useState(null); // id of row currently saving
  const [truncationWarning, setTruncationWarning] = useState(null);
  const [gapAudit, setGapAudit] = useState(null);
  const [gapAuditLoading, setGapAuditLoading] = useState(false);
  const [gapAuditError, setGapAuditError] = useState(null);
  const [gapAuditFilter, setGapAuditFilter] = useState('returnee_clawback');

  useEffect(() => {
    loadData();
  }, []);

  async function saveOverride(productionId, status) {
    setOverrideSaving(productionId);
    try {
      await apiFetch(`/agency-production/${productionId}/override`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: status || null })
      });
      // Update local state immediately so the row re-renders without a full reload
      setProduction(prev => prev.map(p =>
        p.id === productionId
          ? { ...p, manual_override_status: status || null,
                    manual_override_at: status ? new Date().toISOString() : null }
          : p
      ));
      setEditingMatch(null);
    } catch (err) {
      alert('Failed to save override: ' + err.message);
    } finally {
      setOverrideSaving(null);
    }
  }

  async function runGapAudit() {
    setGapAuditLoading(true);
    setGapAuditError(null);
    try {
      const data = await apiFetch('/agency-production/override-gap-audit');
      setGapAudit(data);
      setGapAuditFilter('returnee_clawback');
    } catch (err) {
      setGapAuditError(err.message || 'Audit failed');
    } finally {
      setGapAuditLoading(false);
    }
  }

  function exportGapAuditCsv() {
    if (!gapAudit?.gaps?.length) return;
    const rows = gapAuditFilter === 'all'
      ? gapAudit.gaps
      : gapAudit.gaps.filter((g) => g.gap_type === gapAuditFilter);
    const headers = [
      'Gap Type', 'Client', 'Agent', 'Carrier', 'Eff Date', 'Status',
      'Override Net', 'Paid Total', 'Chargeback Total', 'Paid Count', 'Chargeback Count', 'Reason',
    ];
    const lines = [headers.join(',')];
    rows.forEach((g) => {
      lines.push([
        g.gap_type,
        g.client_name,
        g.agent_name,
        g.carrier,
        g.effective_date,
        g.status,
        g.override_net,
        g.paid_total,
        g.chargeback_total,
        g.paid_count,
        g.chargeback_count,
        g.reason,
      ].map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','));
    });
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `override-gap-audit-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function loadData() {
    setLoading(true);
    setError(null);
    setTruncationWarning(null);
    try {
      const [prodPage, overridePage, carrierPage, bsiUploadsData] = await Promise.all([
        fetchAllPages('/agency-production', { itemsKey: 'production', pageSize: 5000 }, apiFetch),
        fetchAllPages(
          '/records?exclude_upload_category=bsi_statement&classificationLike=override,chargeback&light=1',
          { pageSize: 5000 },
          apiFetch
        ),
        fetchAllPages(
          '/records?upload_category=bsi_statement&light=1',
          { pageSize: 5000 },
          apiFetch
        ),
        apiFetch('/files/uploads?category=bsi_statement'),
      ]);

      setProduction(prodPage.items || []);

      const overrideStatements = (overridePage.items || []).filter(isOverrideStatementRow);
      setOverrides(overrideStatements);

      setCarrierBSIRecords(carrierPage.items || []);

      setTruncationWarning(truncationMessage([
        prodPage.warning ? `Agency production: ${prodPage.warning}` : null,
        overridePage.warning ? `Override statements: ${overridePage.warning}` : null,
        carrierPage.warning ? `Carrier→BSI: ${carrierPage.warning}` : null,
      ]));

      const uploadedKeys = new Set();
      (bsiUploadsData || []).forEach(u => {
        const carrier = (u.carrier || '').split(',').map(c => c.trim()).filter(Boolean);
        const period = u.payment_period || '';
        carrier.forEach(c => uploadedKeys.add(`${normalizeCarrier(c)}|${period}`));
      });
      setBsiUploadedKeys(uploadedKeys);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  // ─── Memoized computations ─────────────────────────────────────────────────
  // matches: expand each production row into paid / chargeback / missing history
  const matches = useMemo(() => {
    const bsiKeysList = [...bsiUploadedKeys];
    const rows = [];
    // Rolling 90-day production repeats the same sale — one recon row per true sale.
    const uniqueProduction = dedupeProductionSales(production);
    for (const prod of uniqueProduction) {
      const carrierBSI = _findCarrierBSIMatch(prod, carrierBSIRecords);
      const heldRecord = _findHeldRecord(prod, carrierBSIRecords);
      const prodCarrier = normalizeCarrier(prod.carrier || '');
      const prodPeriod = prod.payment_period || prod.effective_date?.substring(0,7)?.replace('-','') || '';
      const carrierUploaded = bsiUploadedKeys.has(`${prodCarrier}|${prodPeriod}`) ||
        bsiKeysList.some(k => k.startsWith(`${prodCarrier}|`));
      const lifecycleRows = expandOverrideLifecycle(prod, overrides);
      for (const life of lifecycleRows) {
        rows.push({
          ...life,
          carrierBSI: life.isHistory ? null : carrierBSI,
          heldRecord: life.isHistory ? null : heldRecord,
          carrierUploaded: life.isHistory ? false : carrierUploaded,
        });
      }
    }
    return rows;
  }, [production, overrides, carrierBSIRecords, bsiUploadedKeys]);

  // Aliases so JSX can call the stable outer functions by their original names
  const getThreeWayStatus = _getThreeWayStatus;
  const getCategory = _getCategory;

  // categorized: only reruns when matches changes
  const categorized = useMemo(() => ({
    missing:    matches.filter(m => _getCategory(m) === 'missing'),
    planchange: matches.filter(m => _getCategory(m) === 'planchange'),
    plandenied: matches.filter(m => _getCategory(m) === 'plandenied'),
    cancelled:  matches.filter(m => _getCategory(m) === 'cancelled'),
    paid:       matches.filter(m => _getCategory(m) === 'paid'),
  }), [matches]);

  // filtered: only reruns when data or filter state changes (NOT on tab switch)
  const filtered = useMemo(() => {
    function applyFilters(list) {
      let result = list;
      if (filterAgents.length > 0)
        result = result.filter(m => filterAgents.includes(m.production.agent_name));
      if (filterCarriers.length > 0)
        result = result.filter(m => filterCarriers.some(fc => normalizeCarrier(fc) === normalizeCarrier(m.production.carrier)));
      if (filterEffDates.length > 0)
        result = result.filter(m => filterEffDates.includes(m.production.effective_date || ''));
      if (filterOverrideStatus.length > 0)
        result = result.filter(m => filterOverrideStatus.includes(_getThreeWayStatus(m)));
      if (searchTerm.trim()) {
        const search = searchTerm.toLowerCase();
        result = result.filter(m =>
          (m.production.client_name || '').toLowerCase().includes(search) ||
          (m.production.agent_name || '').toLowerCase().includes(search) ||
          (m.production.carrier || '').toLowerCase().includes(search)
        );
      }
      return result;
    }
    return {
      missing:    applyFilters(categorized.missing),
      planchange: applyFilters(categorized.planchange),
      plandenied: applyFilters(categorized.plandenied),
      cancelled:  applyFilters(categorized.cancelled),
      paid:       applyFilters(categorized.paid),
    };
  }, [categorized, filterAgents, filterCarriers, filterEffDates, filterOverrideStatus, searchTerm]);

  // rawDisplayData: only reruns on tab or filtered change
  const rawDisplayData = useMemo(() => (
    tab === 'missing'    ? (filtered.missing    || []) :
    tab === 'planchange' ? (filtered.planchange || []) :
    tab === 'plandenied' ? (filtered.plandenied || []) :
    tab === 'cancelled'  ? (filtered.cancelled  || []) :
    tab === 'paid'       ? (filtered.paid       || []) :
    [...(filtered.missing||[]), ...(filtered.planchange||[]),
     ...(filtered.plandenied||[]), ...(filtered.cancelled||[]), ...(filtered.paid||[])]
  ), [filtered, tab]);

  // Sort helpers (stable refs, no memo needed)
  function toggleSort(col) {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortCol(col); setSortDir('asc'); }
  }
  function sortIcon(col) {
    if (sortCol !== col) return <span style={{ opacity: 0.3, fontSize: 10 }}>⇅</span>;
    return <span style={{ fontSize: 10 }}>{sortDir === 'asc' ? '↑' : '↓'}</span>;
  }

  // displayData: only reruns when visible rows or sort changes
  const displayData = useMemo(() => (
    sortCol ? [...rawDisplayData].sort((a, b) => {
      let va, vb;
      if (sortCol === 'agent')    { va = a.production.agent_name || ''; vb = b.production.agent_name || ''; }
      else if (sortCol === 'member')   { va = a.production.client_name || ''; vb = b.production.client_name || ''; }
      else if (sortCol === 'carrier')  { va = a.production.carrier || ''; vb = b.production.carrier || ''; }
      else if (sortCol === 'bsi_thei') { va = parseFloat(a.override?.commission || 0); vb = parseFloat(b.override?.commission || 0); }
      else if (sortCol === 'c_bsi')    { va = parseFloat(a.carrierBSI?.commission || 0); vb = parseFloat(b.carrierBSI?.commission || 0); }
      else if (sortCol === 'eff_date') { va = a.production.effective_date || ''; vb = b.production.effective_date || ''; }
      else if (sortCol === 'expected') {
        try {
          va = expectedAgencyOverride(a.production).amount;
          vb = expectedAgencyOverride(b.production).amount;
        } catch {
          va = -1;
          vb = -1;
        }
        va = va == null ? -1 : va;
        vb = vb == null ? -1 : vb;
      }
      else if (sortCol === 'status')   { va = _getThreeWayStatus(a); vb = _getThreeWayStatus(b); }
      else                             { va = ''; vb = ''; }
      if (typeof va === 'number') return sortDir === 'asc' ? va - vb : vb - va;
      return sortDir === 'asc' ? String(va).localeCompare(String(vb)) : String(vb).localeCompare(String(va));
    }) : rawDisplayData
  ), [rawDisplayData, sortCol, sortDir]);

  // agents / carriers / effectiveDates: only reruns when production data changes
  const agents = useMemo(
    () => [...new Set(production.map(p => p.agent_name).filter(Boolean))].sort(),
    [production]
  );
  const carriers = useMemo(() => {
    const uniqueC = [...new Set(production.map(p => normalizeCarrier(p.carrier)).filter(Boolean))];
    return uniqueC
      .map(c => {
        const original = production.find(p => normalizeCarrier(p.carrier) === c)?.carrier;
        return formatCarrier(original || c);
      })
      .filter((v, i, arr) => arr.indexOf(v) === i)
      .sort();
  }, [production]);
  const effectiveDates = useMemo(
    () => [...new Set(production.map(p => p.effective_date).filter(Boolean))].sort((a, b) => b.localeCompare(a)),
    [production]
  );

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
      dataToExport = [...(filtered.missing || []), ...(filtered.planchange || []), ...(filtered.plandenied || []), ...(filtered.cancelled || []), ...(filtered.paid || [])];
      filename = `agency-overrides-all-${new Date().toISOString().split('T')[0]}.csv`;
    }
    
    if (dataToExport.length === 0) {
      alert('No data to export');
      return;
    }
    
    const carrierBSIAmt = (m) => m.carrierBSI ? parseFloat(m.carrierBSI.commission || 0) : null;
    const headers = ['Agent', 'Client', 'Carrier', 'State', 'Effective Date', 'Expected THEI', 'Expected Note', 'BSI→THEI Amt', 'Carrier→BSI Amt', 'Status', 'Override Status'];
    const rows = dataToExport.map(m => {
      const agentName = m.production.agent_name || '—';
      const clientName = m.production.client_name || '—';
      const carrier = formatCarrier(m.production.carrier) || '—';
      const hd = _getHoldDetail(m);
      const state = (hd && hd.state) || m.production.state || '—';
      const effectiveDate = m.production.effective_date ? formatDate(m.production.effective_date) : '—';
      const exp = expectedAgencyOverride(m.production);
      const expectedAmt = exp.amount == null ? '—' : exp.amount;
      const expectedNote = expectedOverrideLabel(exp);
      const bsiThei = m.override ? (m.override.commission || m.override.commission_amount || '0') : '—';
      const cBSI = carrierBSIAmt(m) !== null ? carrierBSIAmt(m).toFixed(2) : '—';
      const enrollStatus = m.production.status || '—';
      const overrideStatus = getThreeWayStatus(m);
      
      return [
        agentName,
        clientName,
        carrier,
        state,
        effectiveDate,
        expectedAmt,
        expectedNote,
        bsiThei,
        cBSI,
        enrollStatus,
        overrideStatus
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

      {editingMatch && (
        <div
          onClick={() => setEditingMatch(null)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'white',
              borderRadius: 12,
              maxWidth: 420,
              width: '90%',
              boxShadow: '0 10px 40px rgba(0,0,0,0.3)',
            }}
          >
            <div
              style={{
                padding: '16px 20px',
                borderBottom: '1px solid var(--border)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <div>
                <h2 style={{ margin: 0, fontSize: 16, color: 'var(--text)', fontWeight: 600 }}>
                  Edit override status
                </h2>
                <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--text-muted)' }}>
                  {editingMatch.production.client_name}
                  {' · '}
                  {formatCarrier(editingMatch.production.carrier)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEditingMatch(null)}
                style={{
                  background: 'none',
                  border: 'none',
                  fontSize: 20,
                  cursor: 'pointer',
                  color: 'var(--text-muted)',
                  padding: 4,
                }}
              >
                ×
              </button>
            </div>
            <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              {[
                { value: null, label: '— Auto (clear manual)' },
                { value: 'paid', label: 'Paid' },
                { value: 'chase_bsi', label: 'Chase BSI' },
                { value: 'not_paid_to_bsi', label: 'Not on BSI (carrier unpaid)' },
                { value: 'request_audit', label: 'Request Audit' },
                { value: 'held_licensing', label: 'Held – Licensing' },
                { value: 'no_pay_expected', label: 'No Pay Expected' },
                { value: 'pending', label: 'Pending' },
              ].map((opt) => {
                const current = editingMatch.production.manual_override_status || null;
                const selected = current === opt.value;
                const saving = overrideSaving === editingMatch.production.id;
                return (
                  <button
                    key={String(opt.value)}
                    type="button"
                    disabled={saving}
                    onClick={() => saveOverride(editingMatch.production.id, opt.value)}
                    style={{
                      textAlign: 'left',
                      padding: '10px 12px',
                      borderRadius: 6,
                      border: selected ? '1.5px solid var(--accent, #6D28D9)' : '1px solid var(--border)',
                      background: selected ? 'var(--accent-light, #EDE9FE)' : 'var(--bg)',
                      color: 'var(--text)',
                      fontSize: 13,
                      fontWeight: selected ? 600 : 500,
                      cursor: saving ? 'wait' : 'pointer',
                    }}
                  >
                    {opt.label}
                    {selected ? ' · current' : ''}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      <div className="page-header">
        <div className="page-title">Agency Override Reconciliation</div>
        <div className="page-sub">
          Missing holds unpaid rows — use Override Status tags (Not on BSI, Chase BSI, Pending, Held). Filter Status to narrow.
        </div>
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
              <div>
                <div className="form-label" style={{ marginBottom: 6 }}>Override Status</div>
                <MultiSelect
                  label="Status"
                  options={['paid','chargeback','chase_bsi','not_paid_to_bsi','request_audit','held_licensing','no_pay_expected','pending']}
                  selected={filterOverrideStatus}
                  onChange={setFilterOverrideStatus}
                  formatOption={v => ({
                    paid: '🟢 Paid',
                    chargeback: '↩️ Chargeback',
                    chase_bsi: '🔴 Chase BSI',
                    not_paid_to_bsi: '🟠 Not on BSI',
                    request_audit: '🟡 Request Audit',
                    held_licensing: '🔒 Held – Licensing',
                    no_pay_expected: '⛔ No Pay Expected',
                    pending: '⚪ Pending'
                  }[v] || v)}
                />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              <button className="btn btn-secondary" onClick={exportToCSV} disabled={loading}>
                📥 Export CSV
              </button>
              {/* BSI Recon Export — cutoff date required, always blank */}
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', background: 'var(--blue-light)', border: '1px solid var(--blue)', borderRadius: 6, padding: '4px 10px' }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--blue)', whiteSpace: 'nowrap' }}>
                  BSI paid through:
                </label>
                <input
                  type="date"
                  id="bsiCutoffDate"
                  style={{ fontSize: 12, border: '1px solid var(--border)', borderRadius: 4, padding: '3px 6px' }}
                />
                <button
                  className="btn btn-primary"
                  style={{ fontSize: 12, padding: '4px 12px', whiteSpace: 'nowrap' }}
                  disabled={loading}
                  onClick={() => {
                    const cutoff = document.getElementById('bsiCutoffDate').value;
                    if (!cutoff) { alert('Enter the date BSI has paid through before exporting.'); return; }
                    const token = localStorage.getItem('he_token');
                    const url = `${process.env.REACT_APP_API_URL}/api/agency-production/export-bsi-recon?cutoffDate=${cutoff}`;
                    fetch(url, { headers: { Authorization: `Bearer ${token}` } })
                      .then(r => {
                        if (!r.ok) return r.json().then(e => { throw new Error(e.error || r.status); });
                        return r.blob();
                      })
                      .then(blob => {
                        const a = document.createElement('a');
                        a.href = URL.createObjectURL(blob);
                        a.download = `BSI_Recon_Export_through_${cutoff.replace(/-/g,'')}.xlsx`;
                        a.click();
                        URL.revokeObjectURL(a.href);
                      })
                      .catch(err => alert('Export failed: ' + err.message));
                  }}
                >
                  📤 Export BSI Recon
                </button>
              </div>
              <button
                className="btn btn-secondary"
                onClick={runGapAudit}
                disabled={loading || gapAuditLoading}
                title="Scan all production vs overrides for Milagros-style clawback gaps and never-paid rows"
              >
                {gapAuditLoading ? 'Auditing…' : '🔎 Audit gaps'}
              </button>
              <button className="btn btn-primary" onClick={loadData} disabled={loading}>
                {loading ? 'Loading...' : '🔄 Refresh'}
              </button>
            </div>
          </div>
        </div>

        {error && (
          <div className="card" style={{ marginTop: 20, background: 'var(--red-light)', border: '1px solid var(--red)', padding: 16 }}>
            {error}
          </div>
        )}

        <TruncationBanner message={truncationWarning} />

        {gapAuditError && (
          <div className="card" style={{ marginBottom: 14, background: 'var(--red-light)', border: '1px solid var(--red)', padding: 14, fontSize: 13 }}>
            Audit failed: {gapAuditError}
          </div>
        )}

        {gapAudit && (
          <div className="card" style={{ marginBottom: 14, padding: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>Override gap audit</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  Scanned {gapAudit.summary?.production_clients ?? 0} production clients ·{' '}
                  {gapAudit.summary?.override_rows_scanned ?? 0} override rows
                  {gapAudit.generated_at ? ` · ${new Date(gapAudit.generated_at).toLocaleString()}` : ''}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-secondary" style={{ fontSize: 12 }} onClick={exportGapAuditCsv}>
                  Export CSV
                </button>
                <button className="btn btn-secondary" style={{ fontSize: 12 }} onClick={() => setGapAudit(null)}>
                  Close
                </button>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
              {[
                ['returnee_clawback', `Returnee clawback (${gapAudit.summary?.returnee_clawback ?? 0})`],
                ['never_paid', `Never paid (${gapAudit.summary?.never_paid ?? 0})`],
                ['chargeback_only', `Chargeback only (${gapAudit.summary?.chargeback_only ?? 0})`],
                ['net_zero', `Net zero (${gapAudit.summary?.net_zero ?? 0})`],
                ['all', `All gaps (${gapAudit.summary?.gap_total ?? 0})`],
              ].map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setGapAuditFilter(id)}
                  style={{
                    fontSize: 12,
                    padding: '5px 10px',
                    borderRadius: 6,
                    border: gapAuditFilter === id ? '1.5px solid var(--accent, #6D28D9)' : '1px solid var(--border)',
                    background: gapAuditFilter === id ? 'var(--accent-light, #EDE9FE)' : 'var(--bg)',
                    fontWeight: gapAuditFilter === id ? 700 : 500,
                    cursor: 'pointer',
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            <div style={{ marginTop: 10, fontSize: 12, color: 'var(--text-muted)' }}>
              Start with <strong>Returnee clawback</strong> — same pattern as Milagros (paid → chargeback → still in production, no open override).
            </div>
            <div style={{ marginTop: 12, maxHeight: 280, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 6 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead style={{ position: 'sticky', top: 0, background: 'var(--bg-subtle, #fafafa)' }}>
                  <tr>
                    {['Client', 'Agent', 'Carrier', 'Paid', 'Chargeback', 'Net', 'Reason'].map((h) => (
                      <th key={h} style={{ textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid var(--border)', fontWeight: 600 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(gapAuditFilter === 'all'
                    ? gapAudit.gaps
                    : gapAudit.gaps.filter((g) => g.gap_type === gapAuditFilter)
                  ).map((g, i) => (
                    <tr key={`${g.gap_type}-${g.client_name}-${g.carrier}-${i}`}>
                      <td style={{ padding: '7px 10px', borderBottom: '1px solid var(--border)', fontWeight: 600 }}>{g.client_name}</td>
                      <td style={{ padding: '7px 10px', borderBottom: '1px solid var(--border)' }}>{g.agent_name || '—'}</td>
                      <td style={{ padding: '7px 10px', borderBottom: '1px solid var(--border)' }}>{formatCarrier(g.carrier)}</td>
                      <td style={{ padding: '7px 10px', borderBottom: '1px solid var(--border)', color: 'var(--green)' }}>{fmt(g.paid_total || 0)}</td>
                      <td style={{ padding: '7px 10px', borderBottom: '1px solid var(--border)', color: 'var(--red)' }}>{fmt(g.chargeback_total || 0)}</td>
                      <td style={{ padding: '7px 10px', borderBottom: '1px solid var(--border)', fontWeight: 600 }}>{g.override_net == null ? '—' : fmt(g.override_net)}</td>
                      <td style={{ padding: '7px 10px', borderBottom: '1px solid var(--border)', color: 'var(--text-muted)', maxWidth: 320 }}>{g.reason}</td>
                    </tr>
                  ))}
                  {(gapAuditFilter === 'all' ? gapAudit.gaps : gapAudit.gaps.filter((g) => g.gap_type === gapAuditFilter)).length === 0 && (
                    <tr>
                      <td colSpan={7} style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)' }}>
                        No gaps in this bucket.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {!loading && (
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ borderBottom: '1px solid var(--border)', padding: '0 20px', display: 'flex', gap: 2, flexWrap: 'wrap' }}>
              <button style={tabStyle('missing')} onClick={() => setTab('missing')}
                title="Unpaid override work — tags show Not on BSI, Chase BSI, Pending, Held, etc.">
                Missing ({(filtered.missing || []).length})
              </button>
              <button style={tabStyle('planchange')} onClick={() => setTab('planchange')}
                title="Client changed plans; original override may not apply">
                Plan Change ({(filtered.planchange || []).length})
              </button>
              <button style={tabStyle('plandenied')} onClick={() => setTab('plandenied')}
                title="Application denied by the carrier; no override expected">
                Plan Denied ({(filtered.plandenied || []).length})
              </button>
              <button style={tabStyle('cancelled')} onClick={() => setTab('cancelled')}
                title="Cancelled / disenrolled / override chargeback (left the plan)">
                Cancelled ({(filtered.cancelled || []).length})
              </button>
              <button style={tabStyle('paid')} onClick={() => setTab('paid')}
                title="Override commission paid (includes historical paid before a later chargeback)">
                Paid ({(filtered.paid || []).length})
              </button>
              <button style={tabStyle('all')} onClick={() => setTab('all')}
                title="All production records across every status category">
                All ({(filtered.missing || []).length + (filtered.planchange || []).length + (filtered.plandenied || []).length + (filtered.cancelled || []).length + (filtered.paid || []).length})
              </button>
            </div>
            {/* One-line subtitle per tab */}
            {tab !== 'all' && (() => {
              const subtitles = {
                missing:    'Unpaid work queue. Override Status tags: Not on BSI (carrier never paid BSI), Chase BSI (carrier paid, remittance missing), Pending / Held / Request Audit. Use the Status filter to narrow.',
                planchange: 'Client changed plans; original override may not apply.',
                plandenied: 'Application denied by the carrier; no override expected.',
                cancelled:  'Cancelled / disenrolled, override chargeback, or No Pay Expected (not chasing).',
                paid:       'Override commission paid — including earlier paid rows when a later chargeback clawed it back.',
              };
              const text = subtitles[tab];
              return text ? (
                <div style={{ padding: '6px 20px', fontSize: 12, color: 'var(--text-muted)', borderBottom: '1px solid var(--border)', background: 'var(--bg-subtle, #fafafa)' }}>
                  {text}
                </div>
              ) : null;
            })()}

            <div style={{ padding: 20 }}>
              {displayData.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
                  {production.length === 0 
                    ? 'No agency production data yet. Upload Hector\'s reports to get started!' 
                    : 'No results match your filters.'}
                </div>
              ) : (
                <div style={{ overflowY: 'auto', maxHeight: 'calc(100vh - 280px)' }}>
                  <table style={{ tableLayout: 'fixed', width: '100%', borderCollapse: 'collapse' }}>
                    <colgroup>
                      <col style={{ width: '12%' }} />
                      <col style={{ width: '13%' }} />
                      <col style={{ width: '10%' }} />
                      <col style={{ width: '8%' }} />
                      <col style={{ width: '11%' }} />
                      <col style={{ width: '9%' }} />
                      <col style={{ width: '9%' }} />
                      <col style={{ width: '16%' }} />
                      <col style={{ width: '12%' }} />
                    </colgroup>
                    <thead style={{ position: 'sticky', top: 0, background: 'var(--bg)', zIndex: 1 }}>
                      <tr>
                        {[
                          ['Writing Agent','left','agent'],
                          ['Member Name','left','member'],
                          ['Carrier','left','carrier'],
                          ['Eff Date','left','eff_date'],
                          ['Expected','right','expected'],
                          ['BSI→THEI','right','bsi_thei'],
                          ['Carrier→BSI','right','c_bsi'],
                          ['Override Status','center','status'],
                          ['Actions','center',null]
                        ].map(([label, align, col], i) => (
                          <th key={i} onClick={col ? () => toggleSort(col) : undefined} style={{
                            padding: '8px 10px', textAlign: align, fontSize: 11, fontWeight: 600,
                            whiteSpace: 'normal', wordWrap: 'break-word', overflowWrap: 'break-word',
                            verticalAlign: 'top', borderBottom: '2px solid var(--border)',
                            background: (i === 4 || i === 5 || i === 6) ? 'var(--accent-light, #EDE9FE)' : 'var(--bg)',
                            cursor: col ? 'pointer' : 'default', userSelect: 'none'
                          }}>
                            <span style={{ display:'inline-flex', alignItems:'center', gap:3 }}>
                              {label}{col && sortIcon(col)}
                            </span>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {displayData.map((m) => {
                        const twStatus = getThreeWayStatus(m);
                        const tdBase = { padding: '8px 10px', fontSize: 12, verticalAlign: 'top',
                          wordWrap: 'break-word', overflowWrap: 'break-word', whiteSpace: 'normal',
                          borderBottom: '1px solid var(--border)' };
                        const tdAccent = { ...tdBase, background: 'rgba(109,40,217,0.04)' };

                        const isManual = !!m.production.manual_override_status;
                        const statusBadge = () => {
                          const badge = (() => {
                            if (twStatus === 'paid')          return <span style={{ background:'#D4EDDA',color:'#155724',padding:'3px 8px',borderRadius:4,fontSize:11,fontWeight:600 }}>🟢 Paid</span>;
                            if (twStatus === 'chargeback')    return <span style={{ background:'#F8D7DA',color:'#721C24',padding:'3px 8px',borderRadius:4,fontSize:11,fontWeight:600 }}>↩️ Chargeback</span>;
                            if (twStatus === 'chase_bsi')     return <span style={{ background:'#F8D7DA',color:'#721C24',padding:'3px 8px',borderRadius:4,fontSize:11,fontWeight:600 }}>🔴 Chase BSI</span>;
                            if (twStatus === 'not_paid_to_bsi') return <span style={{ background:'#FFE8D6',color:'#9A3412',padding:'3px 8px',borderRadius:4,fontSize:11,fontWeight:600 }}>🟠 Not on BSI</span>;
                            if (twStatus === 'request_audit') return <span style={{ background:'#FFF3CD',color:'#856404',padding:'3px 8px',borderRadius:4,fontSize:11,fontWeight:600 }}>🟡 Request Audit</span>;
                            if (twStatus === 'held_licensing') {
                              const hd = _getHoldDetail(m);
                              // Option A: badge + state pill inline; full reason on hover tooltip.
                              // Outer statusBadge wrapper is already inline-flex so pill is
                              // a natural sibling of the badge — no column flex needed.
                              return (
                                <>
                                  <span style={{ background:'#E8E8E8',color:'#444',padding:'3px 8px',borderRadius:4,fontSize:11,fontWeight:600 }}>🔒 Held – Licensing</span>
                                  {hd && (hd.state || hd.reason) && (
                                    <span
                                      title={hd.reason || undefined}
                                      style={{
                                        display:'inline-flex',alignItems:'center',gap:3,
                                        border:'1px solid #bbb',borderRadius:4,
                                        padding:'2px 7px',fontSize:11,fontWeight:500,
                                        color:'#555',background:'#fff',whiteSpace:'nowrap',
                                        cursor: hd.reason ? 'help' : 'default',
                                      }}
                                    >
                                      {hd.state || 'ⓘ'}{hd.reason && <span style={{ fontSize:10,color:'#999',lineHeight:1 }}>ⓘ</span>}
                                    </span>
                                  )}
                                </>
                              );
                            }
                            if (twStatus === 'no_pay_expected')  return <span style={{ background:'#F3F0FF',color:'#6D28D9',padding:'3px 8px',borderRadius:4,fontSize:11,fontWeight:600 }}>⛔ No Pay Expected</span>;
                            return <span style={{ background:'#F0F0F0',color:'#6C757D',padding:'3px 8px',borderRadius:4,fontSize:11,fontWeight:600 }}>⚪ Pending</span>;
                          })();
                          return (
                            <span style={{ display:'inline-flex',alignItems:'center',gap:4,flexWrap:'wrap',justifyContent:'center' }}>
                              {badge}
                              {isManual && !m.isHistory && (
                                <span title={`Manually set${m.production.manual_override_by ? ' by ' + m.production.manual_override_by : ''}`}
                                  style={{ fontSize:10,color:'var(--text-muted)',background:'var(--bg-subtle)',
                                    border:'1px solid var(--border)',borderRadius:3,padding:'1px 4px',
                                    lineHeight:1.3,whiteSpace:'nowrap' }}
                                >✏️ manual</span>
                              )}
                              {m.lifecycle === 'paid' && m.isHistory && (
                                <span style={{ fontSize:10,color:'var(--text-muted)' }}>history</span>
                              )}
                            </span>
                          );
                        };

                        const overrideAmt = m.override
                          ? (m.override.override_net != null
                              ? m.override.override_net
                              : (m.override.commission || m.override.commission_amount || 0))
                          : null;
                        const overrideColor = overrideAmt == null
                          ? undefined
                          : overrideAmt > 0
                            ? 'var(--green)'
                            : overrideAmt < 0
                              ? 'var(--red)'
                              : 'var(--amber)';

                        return (
                          <tr key={m.rowKey || `${m.production.id}-${m.lifecycle || 'row'}`}>
                            <td style={tdBase}>{m.production.agent_name || '—'}</td>
                            <td style={{ ...tdBase, fontWeight: 500, fontSize: 12 }}>
                              <a href="#" onClick={e => { e.preventDefault(); setSelectedProduction(m.production); }}
                                style={{ color:'var(--blue)',textDecoration:'none',borderBottom:'1px dashed var(--blue)' }}
                                onMouseOver={e=>e.currentTarget.style.borderBottom='1px solid var(--blue)'}
                                onMouseOut={e=>e.currentTarget.style.borderBottom='1px dashed var(--blue)'}
                              >{m.production.client_name}</a>

                            </td>
                            <td style={{ ...tdBase, fontSize: 12 }}>{formatCarrier(m.production.carrier)}</td>
                            <td style={{ ...tdBase, fontSize: 12, color: 'var(--text-muted)' }}>
                              {m.production.effective_date ? formatDate(m.production.effective_date) : '—'}
                            </td>
                            <ExpectedOverrideCell production={m.production} />
                            <td style={{ ...tdBase, textAlign: 'right' }}>
                              {m.override
                                ? <span
                                    style={{ color: overrideColor, fontWeight:600, fontSize: 12 }}
                                    title={
                                      m.lifecycle === 'chargeback'
                                        ? (m.override.payment_period || m.override.source || 'Chargeback')
                                        : m.override.matchCount > 1
                                          ? m.override.matchCount + ' rows netted'
                                          : (m.override.payment_period || m.override.source || undefined)
                                    }
                                  >
                                    {fmt(overrideAmt)}
                                    {m.override.matchCount > 1 ? ' (' + m.override.matchCount + ')' : ''}
                                  </span>
                                : <span style={{ color:'var(--red)',fontSize:11 }}>—</span>}
                            </td>
                            <td style={{ ...tdAccent, textAlign: 'right' }}>
                              {m.isHistory
                                ? <span style={{ color:'var(--text-muted)',fontSize:11 }}>—</span>
                                : m.carrierBSI
                                  ? <span style={{ color:'var(--green)',fontWeight:600 }}>{fmt(m.carrierBSI.commission || 0)}</span>
                                  : m.carrierUploaded
                                    ? <span style={{ color:'var(--text-muted)',fontSize:11 }}>—</span>
                                    : <span style={{ color:'var(--text-muted)',fontSize:10,fontStyle:'italic' }}>not uploaded</span>}
                            </td>
                            <td style={{ ...tdAccent, textAlign: 'center' }}>{statusBadge()}</td>
                            <td style={{ ...tdBase, textAlign: 'center' }}>
                              {m.isHistory ? (
                                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>—</span>
                              ) : (
                                <button
                                  type="button"
                                  className="btn btn-secondary"
                                  onClick={() => setEditingMatch(m)}
                                  disabled={overrideSaving === m.production.id}
                                  title={isManual ? 'Edit manual override status' : 'Edit override status'}
                                  style={{
                                    fontSize: 11,
                                    padding: '4px 12px',
                                    fontWeight: 600,
                                    minWidth: 64,
                                  }}
                                >
                                  {overrideSaving === m.production.id ? '…' : 'Edit'}
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
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
            <li><strong>Hector production:</strong> who is on the books (who should be paid)</li>
            <li><strong>Carrier→BSI statements:</strong> did the carrier pay BSI for that sale?</li>
            <li><strong>BSI→THEI remittance:</strong> did we get our half from BSI?</li>
          </ul>
          <div style={{ fontWeight: 600, marginTop: 12, marginBottom: 8 }}>Tabs:</div>
          <ul style={{ paddingLeft: 20, margin: 0 }}>
            <li><strong>Missing:</strong> All unpaid rows. Read the Override Status tag — Not on BSI, Chase BSI, Pending, Held, etc. Filter Status to narrow.</li>
            <li><strong>Paid / Cancelled / Plan Change:</strong> Same as before</li>
            <li><strong>Same person can appear in more than one tab</strong> (e.g. Paid → Cancelled chargeback → Missing again)</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
