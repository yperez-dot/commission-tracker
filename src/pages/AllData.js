import React, { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../api';
import { formatCarrier } from '../utils/formatCarrier';
import { formatDate } from '../utils/dateFormat';
import EditCommissionModal from '../components/EditCommissionModal';
import { commissionUploadExportPath, exportUploadFile } from '../utils/exportUpload';
import { uploadCategoryLabel } from '../utils/uploadDestination';
import { classifyClientFileStream } from '../clientFileStream';
import { normalizeCarrier } from '../matchingNormalize';
import {
  isOverrideStatementRow,
  buildOverrideMatches,
  dedupeProductionSales,
  getOverrideReconCategory,
  getThreeWayOverrideStatus,
} from '../agencyOverrideReconMatch';

function fmt(n) {
  return '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatPeriodLabel(p) {
  if (!p) return '—';
  const s = String(p).trim();
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  if (s.match(/^\d{6}$/)) return months[parseInt(s.slice(4, 6), 10) - 1] + ' ' + s.slice(0, 4);
  return s;
}

// Not-paid detail text per Recon's own three-way status — same tags Agency Override
// Recon shows in its Missing tab, just spelled out for someone who never opened Recon.
const THREE_WAY_DETAIL = {
  chase_bsi: 'Carrier paid BSI, no house remittance on file yet',
  not_paid_to_bsi: 'Not on the uploaded carrier BSI statement',
  pending: 'Carrier BSI statement not uploaded for this period yet',
  held_licensing: 'Held — licensing/appointment issue',
  no_pay_expected: 'No payout expected (withdrawn/cancelled/denied)',
  request_audit: 'Carrier BSI shows $0 — needs audit',
};

/**
 * One production sale's current payment status, using the exact same fields Agency
 * Override Recon computes (getOverrideReconCategory / getThreeWayOverrideStatus) —
 * never re-derived here. `rows` is every buildOverrideMatches row for that one
 * production id (its full paid/chargeback history plus, if still open, one current
 * row); a production with no open ("isHistory: false") row has already netted
 * positive, i.e. Recon would show it as Paid.
 */
function summarizeProductionStatus(rows) {
  const current = rows.find((r) => !r.isHistory);
  const hadPaidHistory = rows.some((r) => r.isHistory && r.lifecycle === 'paid');
  const hadChargebackHistory = rows.some((r) => r.isHistory && r.lifecycle === 'chargeback');
  if (!current) {
    return hadChargebackHistory && hadPaidHistory
      ? { label: 'Partial', detail: 'Paid then partially charged back — net still positive', tone: 'amber' }
      : { label: 'Paid', detail: null, tone: 'green' };
  }
  const category = getOverrideReconCategory(current);
  if (category === 'paid') return { label: 'Paid', detail: null, tone: 'green' };
  if (category === 'cancelled') {
    return {
      label: current.lifecycle === 'chargeback' ? 'Chargeback' : 'Cancelled',
      detail: null,
      tone: 'red',
    };
  }
  const threeWay = getThreeWayOverrideStatus(current);
  return { label: 'Not paid', detail: THREE_WAY_DETAIL[threeWay] || null, tone: 'amber' };
}

/** Clickable dollar amount → source upload report (manual audit). */
function AmountLink({ value, record, onOpenSource, style = {} }) {
  const hasAmount = value != null && value !== '';
  const display = hasAmount ? fmt(value) : '—';
  const canLink = hasAmount && record?.upload_id;
  if (!canLink) {
    return <span style={style}>{display}</span>;
  }
  const name = record.upload_name || `Upload #${record.upload_id}`;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onOpenSource(record);
      }}
      title={`Open source report: ${name}`}
      style={{
        background: 'none',
        border: 'none',
        padding: 0,
        cursor: 'pointer',
        fontWeight: 500,
        textDecoration: 'underline',
        textUnderlineOffset: 2,
        ...style,
      }}
    >
      {display}
    </button>
  );
}

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

function listFromInitial(filters, singularKey, pluralKey) {
  if (Array.isArray(filters[pluralKey]) && filters[pluralKey].length) {
    return filters[pluralKey].filter(Boolean);
  }
  if (filters[singularKey]) return [filters[singularKey]];
  return [];
}

export default function AllData({ user, initialFilters = {}, onNavigate }) {
  const [records, setRecords] = useState([]);
  const [filterSums, setFilterSums] = useState(null);
  const [total, setTotal] = useState(0);
  const [filterOptions, setFilterOptions] = useState({ agents: [], carriers: [], periods: [], planTypes: [], classifications: [], lobs: [] });
  const [selAgents, setSelAgents] = useState(() => listFromInitial(initialFilters, 'agent', 'agents'));
  const [selCarriers, setSelCarriers] = useState(() => listFromInitial(initialFilters, 'carrier', 'carriers'));
  const [selPeriods, setSelPeriods] = useState(() => listFromInitial(initialFilters, 'period', 'periods'));
  const [selTypes, setSelTypes] = useState(() => listFromInitial(initialFilters, 'classification', 'classifications'));
  const [selPayees, setSelPayees] = useState([]);
  const [selLOB, setSelLOB] = useState(() => listFromInitial(initialFilters, 'lob', 'lobs'));
  const [amountSign, setAmountSign] = useState(initialFilters.amountSign || '');
  const [search, setSearch] = useState('');
  const [sortCol, setSortCol] = useState('');
  const [sortDir, setSortDir] = useState('asc');
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState(new Set());
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [hideTermed, setHideTermed] = useState(false);
  const [listMode, setListMode] = useState('clients'); // clients | payments
  const [clients, setClients] = useState([]);
  const PAGE_SIZE = 100;
  const [policyModal, setPolicyModal] = useState(null);
  const [editRecord, setEditRecord] = useState(null);
  const [clientHistory, setClientHistory] = useState(null); // { client, carrier, agent }
  const [clientHistoryData, setClientHistoryData] = useState([]);
  const [clientHistoryLoading, setClientHistoryLoading] = useState(false);
  const [clientHistoryError, setClientHistoryError] = useState('');
  const [clientHistorySameAgent, setClientHistorySameAgent] = useState(true);
  const [sourceReport, setSourceReport] = useState(null); // commission row with upload_* fields
  const [sourceExporting, setSourceExporting] = useState(false);
  const [uploadFilter, setUploadFilter] = useState(null); // { id, name }
  // Unpaid agency production for the current search — Katy's path: a client marked
  // Not paid on Agency Override Recon is invisible here because /records only holds
  // commission-statement rows, never agency_production. This is populated by a
  // separate, debounced, search-scoped lookup (never on empty search, never a full
  // production dump) — see the effect below.
  const [prodMatches, setProdMatches] = useState([]); // [{ production, ...status fields }]
  const [prodLoading, setProdLoading] = useState(false);
  const [prodError, setProdError] = useState(null);
  const [prodPanelOpen, setProdPanelOpen] = useState(true);

  useEffect(() => {
    apiFetch('/records/filters').then(d => setFilterOptions(d)).catch(console.error);
    setSelAgents([]); setSelCarriers([]); setSelPeriods([]); setSelTypes([]); setSelPayees([]); setSelLOB([]);
    setAmountSign('');
    setUploadFilter(null);
    setPage(0);
  }, [user.agency]);

  useEffect(() => {
    setSelAgents(listFromInitial(initialFilters, 'agent', 'agents'));
    setSelCarriers(listFromInitial(initialFilters, 'carrier', 'carriers'));
    setSelPeriods(listFromInitial(initialFilters, 'period', 'periods'));
    setSelTypes(listFromInitial(initialFilters, 'classification', 'classifications'));
    setSelLOB(listFromInitial(initialFilters, 'lob', 'lobs'));
    setAmountSign(initialFilters.amountSign || '');
    setPage(0);
  }, [
    initialFilters.agent, initialFilters.agents,
    initialFilters.carrier, initialFilters.carriers,
    initialFilters.period, initialFilters.periods,
    initialFilters.classification, initialFilters.classifications,
    initialFilters.lob, initialFilters.lobs,
    initialFilters.amountSign,
  ]);

  function buildListParams(offset = 0) {
    const params = new URLSearchParams({ limit: PAGE_SIZE, offset });
    if (selAgents.length === 1) params.set('agent', selAgents[0]);
    if (selCarriers.length === 1) params.set('carrier', selCarriers[0]);
    if (selPeriods.length === 1) params.set('period', selPeriods[0]);
    if (selTypes.length === 1) params.set('classification', selTypes[0]);
    if (selAgents.length > 1) params.set('agents', selAgents.join(','));
    if (selCarriers.length > 1) params.set('carriers', selCarriers.join(','));
    if (selPeriods.length > 1) params.set('periods', selPeriods.join(','));
    if (selTypes.length > 1) params.set('classifications', selTypes.join(','));
    if (selPayees.length === 1) params.set('payee', selPayees[0]);
    if (selLOB.length === 1) params.set('lob', selLOB[0]);
    if (selLOB.length > 1) params.set('lobs', selLOB.join(','));
    if (amountSign === 'negative' || amountSign === 'positive') params.set('amountSign', amountSign);
    if (uploadFilter?.id) params.set('upload_id', String(uploadFilter.id));
    if (search.trim()) params.set('search', search.trim());
    if (sortCol) params.set('sortCol', sortCol);
    if (sortDir) params.set('sortDir', sortDir);
    return params;
  }

  const loadRecords = useCallback(async (offset = 0) => {
    setLoading(true);
    try {
      const params = buildListParams(offset);
      const data = await apiFetch(`/records?${params}`);
      let filteredRecords = data.records || [];
      if (hideTermed) {
        filteredRecords = filteredRecords.filter(r => !r.is_termed);
      }
      const uniqueRecords = filteredRecords.filter((record, index, self) =>
        index === self.findIndex(r => r.id === record.id)
      );
      setRecords(uniqueRecords);
      setClients([]);
      setTotal(data.total || 0);
      setFilterSums(data.sums || null);
      setSelected(new Set());
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- buildListParams reads current filter state
  }, [selAgents, selCarriers, selPeriods, selTypes, selPayees, selLOB, amountSign, search, sortCol, sortDir, hideTermed, uploadFilter, user.agency]);

  const loadClients = useCallback(async (offset = 0) => {
    setLoading(true);
    try {
      const params = buildListParams(offset);
      if (hideTermed) params.set('hideTermed', 'true');
      // Client list sorts use different columns; map payment-only sorts away
      const clientSortOk = ['client_full_name', 'carrier', 'agent_name', 'payment_count', 'commission_total', 'latest_period', 'first_period', 'policy_number', 'lob'];
      if (sortCol && !clientSortOk.includes(sortCol)) {
        params.delete('sortCol');
        params.set('sortCol', 'client_full_name');
      }
      const data = await apiFetch(`/records/by-client?${params}`);
      setClients(data.clients || []);
      setRecords([]);
      setTotal(data.total || 0);
      setFilterSums(data.sums || null);
      setSelected(new Set());
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selAgents, selCarriers, selPeriods, selTypes, selPayees, selLOB, amountSign, search, sortCol, sortDir, hideTermed, uploadFilter, user.agency]);

  useEffect(() => {
    setPage(0);
    if (listMode === 'clients') loadClients(0);
    else loadRecords(0);
  }, [selAgents, selCarriers, selPeriods, selTypes, selPayees, selLOB, amountSign, search, sortCol, sortDir, hideTermed, uploadFilter, user.agency, listMode]);  // load* intentionally omitted

  // Unpaid-production search (Brief D / Katy's path). Only runs when the search box
  // has a real name in it — never on the default All Data load, and never a full
  // production or override dump: every call below is scoped by the same `search`
  // term (server-side ILIKE), same as the main /records search already is. Debounced
  // so it doesn't fire per keystroke.
  useEffect(() => {
    const term = search.trim();
    if (term.length < 3) {
      setProdMatches([]);
      setProdError(null);
      setProdLoading(false);
      return;
    }
    let cancelled = false;
    setProdLoading(true);
    setProdError(null);
    const handle = setTimeout(async () => {
      try {
        const q = `search=${encodeURIComponent(term)}`;
        const [prodData, overrideData, bsiData, bsiUploadsData] = await Promise.all([
          apiFetch(`/agency-production?${q}&limit=50`),
          apiFetch(`/records?${q}&exclude_upload_category=bsi_statement&classificationLike=override,chargeback&light=1&limit=200`),
          apiFetch(`/records?${q}&upload_category=bsi_statement&light=1&limit=200`),
          apiFetch('/files/uploads?category=bsi_statement'),
        ]);
        if (cancelled) return;
        const production = prodData.production || [];
        const overrides = (overrideData.records || []).filter(isOverrideStatementRow);
        const carrierBSIRecords = bsiData.records || [];
        const bsiUploadedKeys = new Set();
        (bsiUploadsData || []).forEach((u) => {
          const carriersOnUpload = (u.carrier || '').split(',').map((c) => c.trim()).filter(Boolean);
          const period = u.payment_period || '';
          carriersOnUpload.forEach((c) => bsiUploadedKeys.add(`${normalizeCarrier(c)}|${period}`));
        });
        // Same shared function Agency Override Recon itself uses (agencyOverrideReconMatch.js)
        // — status here can't drift from what Recon shows for the same sale because it's
        // the same code, not a re-derived copy of the payment rules.
        const rows = buildOverrideMatches(production, overrides, carrierBSIRecords, bsiUploadedKeys);
        const byProduction = new Map();
        rows.forEach((r) => {
          const id = r.production?.id;
          if (id == null) return;
          if (!byProduction.has(id)) byProduction.set(id, []);
          byProduction.get(id).push(r);
        });
        // buildOverrideMatches dedupes rolling-90-day production internally (one row
        // per true sale — see dedupeProductionSales), so the rows it returns are keyed
        // by the *winning* duplicate's id, not every id in the raw fetch. Displaying
        // over the same deduped set keeps a rolling repeat of an already-summarized
        // sale from wrongly showing as a second, unmatched "Paid" entry.
        const uniqueProduction = dedupeProductionSales(production);
        const summarized = uniqueProduction.map((prod) => {
          const prodRows = byProduction.get(prod.id) || [];
          return { production: prod, ...summarizeProductionStatus(prodRows) };
        });
        setProdMatches(summarized);
      } catch (e) {
        if (!cancelled) setProdError(e.message || 'Production search failed');
      } finally {
        if (!cancelled) setProdLoading(false);
      }
    }, 400);
    return () => { cancelled = true; clearTimeout(handle); };
  }, [search, user.agency]);

  function handlePage(dir) {
    const next = page + dir;
    setPage(next);
    if (listMode === 'clients') loadClients(next * PAGE_SIZE);
    else loadRecords(next * PAGE_SIZE);
  }

  function clearAll() {
    setSelAgents([]); setSelCarriers([]); setSelPeriods([]); setSelTypes([]); setSelPayees([]); setSelLOB([]);
    setAmountSign(''); setSearch('');
    setUploadFilter(null);
    setPage(0);
  }

  function openSourceReport(record) {
    if (!record?.upload_id) return;
    setSourceReport(record);
  }

  async function exportSourceReport() {
    if (!sourceReport?.upload_id) return;
    setSourceExporting(true);
    try {
      const base = String(sourceReport.upload_name || 'report').replace(/\.[^.]+$/, '');
      await exportUploadFile({
        path: commissionUploadExportPath(sourceReport.upload_id),
        fallbackName: `${base}_export.xlsx`,
      });
    } catch (e) {
      console.error(e);
      window.alert(e.message || 'Export failed');
    } finally {
      setSourceExporting(false);
    }
  }

  function viewSourceUploadRows() {
    if (!sourceReport?.upload_id) return;
    setUploadFilter({
      id: sourceReport.upload_id,
      name: sourceReport.upload_name || `Upload #${sourceReport.upload_id}`,
    });
    setSourceReport(null);
    setClientHistory(null);
    setPolicyModal(null);
    setSearch('');
    setPage(0);
  }

  function toggleSelect(id) {
    setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  function toggleSelectAll() {
    setSelected(records.length > 0 && selected.size === records.length ? new Set() : new Set(records.map(r => r.id)));
  }

  async function executeDelete() {
    setDeleting(true);
    try {
      if (confirmDelete === 'all') {
        await apiFetch('/records/bulk-delete', { method: 'POST', body: JSON.stringify({ deleteAll: true, confirm: 'DELETE ALL' }) });
        setRecords([]); setTotal(0); setSelected(new Set());
      } else if (confirmDelete === 'selected') {
        await apiFetch('/records/bulk-delete', { method: 'POST', body: JSON.stringify({ ids: [...selected] }) });
        setRecords(prev => prev.filter(r => !selected.has(r.id)));
        setTotal(prev => prev - selected.size); setSelected(new Set());
      } else if (confirmDelete === 'single') {
        await apiFetch(`/records/${deleteTarget.id}`, { method: 'DELETE' });
        setRecords(prev => prev.filter(r => r.id !== deleteTarget.id));
        setTotal(prev => prev - 1);
      }
      setConfirmDelete(null); setDeleteTarget(null);
    } catch (e) { console.error(e); }
    finally { setDeleting(false); }
  }

  function handleSort(col) {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortCol(col); setSortDir('asc'); }
    setPage(0); // Reset to first page when sorting
  }

  const pageClientTotal = clients.reduce((s, r) => s + (parseFloat(r.commission_total) || 0), 0);
  const grandTotal = listMode === 'clients'
    ? (filterSums ? parseFloat(filterSums.commission) || 0 : pageClientTotal)
    : (filterSums ? parseFloat(filterSums.commission) || 0 : records.reduce((s, r) => s + (parseFloat(r.commission) || 0), 0));
  const pagePaymentCount = clients.reduce((s, c) => s + (c.payment_count || 0), 0);
  const sumMoney = (key) => {
    if (filterSums && filterSums[key] != null) return parseFloat(filterSums[key]) || 0;
    return records.reduce((s, r) => s + (parseFloat(r[key]) || 0), 0);
  };
  const footerMoney = (n, color) => (
    <td style={{ padding: '10px 12px', fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', color: color || (n < 0 ? 'var(--red)' : 'var(--green)') }}>
      {fmt(n)}
    </td>
  );
  const footerEmpty = () => <td style={{ padding: '10px 12px' }} />;
  const hasFilters = selAgents.length || selCarriers.length || selPeriods.length || selTypes.length || selPayees.length || selLOB.length || amountSign || search.trim() || uploadFilter;
  const tableEmpty = listMode === 'clients' ? clients.length === 0 : records.length === 0;

  async function exportCSV() {
    try {
      // Build same params as loadRecords but without limit/offset to get ALL records
      const params = new URLSearchParams();
      if (selAgents.length === 1) params.set('agent', selAgents[0]);
      if (selCarriers.length === 1) params.set('carrier', selCarriers[0]);
      if (selPeriods.length === 1) params.set('period', selPeriods[0]);
      if (selTypes.length === 1) params.set('classification', selTypes[0]);
      if (selAgents.length > 1) params.set('agents', selAgents.join(','));
      if (selCarriers.length > 1) params.set('carriers', selCarriers.join(','));
      if (selPeriods.length > 1) params.set('periods', selPeriods.join(','));
      if (selTypes.length > 1) params.set('classifications', selTypes.join(','));
      if (selPayees.length === 1) params.set('payee', selPayees[0]);
      if (selLOB.length === 1) params.set('lob', selLOB[0]);
      if (selLOB.length > 1) params.set('lobs', selLOB.join(','));
      if (amountSign === 'negative' || amountSign === 'positive') params.set('amountSign', amountSign);
      if (uploadFilter?.id) params.set('upload_id', String(uploadFilter.id));
      if (search.trim()) params.set('search', search.trim());
      
      // Fetch ALL records (set high limit to override default 100)
      params.set('limit', '50000');
      const data = await apiFetch(`/records?${params}`);
      const allRecords = data.records || [];
      
      // Build CSV with all records
      const headers = ['Agent', 'Carrier', 'Client', 'Policy #', 'Effective Date', 'Premium', 'Comm Value', 'Type', 'Period', 'Payee', 'MGA'];
      const rows = allRecords.map(r => {
        const commValue = r.producer_payable != null && parseFloat(r.producer_payable) !== 0
          ? r.producer_payable
          : r.commission;
        return [r.agent_name, formatCarrier(r.carrier), r.client_full_name, r.policy_number, formatDate(r.effective_date), r.premium, commValue, r.classification, r.payment_period, r.payee, r.mga];
      });
      const csv = [headers, ...rows].map(r => r.map(v => `"${String(v||'').replace(/"/g,'""')}"`).join(',')).join('\n');
      
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `commissions_export_${new Date().toISOString().split('T')[0]}.csv`; a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('Export error:', e);
      alert('Error exporting data. Please try again.');
    }
  }

  function badgeClass(c) {
    if (c === 'New Business') return 'badge-green';
    if (c === 'Renewal') return 'badge-blue';
    if (c === 'Agent Commission') return 'badge-green';
    if (c === 'Agency Override') return 'badge-blue';
    if (c === 'Chargeback') return 'badge-red';
    if (c === 'HRA/Bonus') return 'badge-amber';
    return 'badge-gray';
  }

  const deleteModalText = {
    all: { title: 'Delete EVERYTHING?', sub: `This will permanently delete all ${total.toLocaleString()} records and all uploads. This cannot be undone.`, btn: 'Yes, delete everything' },
    selected: { title: `Delete ${selected.size} selected records?`, sub: 'These records will be permanently deleted.', btn: `Delete ${selected.size} records` },
    single: { title: 'Delete this record?', sub: deleteTarget ? `${deleteTarget.client_full_name} · ${deleteTarget.carrier} · ${fmt(deleteTarget.commission)}` : '', btn: 'Delete' }
  };

  async function loadClientHistory(r, sameAgent = clientHistorySameAgent) {
    if (!r?.client_full_name || !r?.carrier) return;
    setClientHistory({
      client_full_name: r.client_full_name,
      carrier: r.carrier,
      agent_name: r.agent_name,
    });
    setClientHistoryLoading(true);
    setClientHistoryError('');
    setClientHistoryData([]);
    try {
      const params = new URLSearchParams({
        client: r.client_full_name,
        carrier: r.carrier,
      });
      if (sameAgent && r.agent_name) params.set('agent', r.agent_name);
      const data = await apiFetch(`/records/client-history?${params}`);
      setClientHistoryData(data.rows || []);
    } catch (e) {
      setClientHistoryError(e.message || 'Failed to load history');
    } finally {
      setClientHistoryLoading(false);
    }
  }

  const hasMGA = records.some(r => r.mga && r.mga.trim());
  const hasCommSplit = records.some(r => {
    try { const raw = typeof r.raw_data === 'string' ? JSON.parse(r.raw_data) : r.raw_data; return raw && raw.agentComm !== undefined; } catch(e) { return false; }
  });
  function getCommSplit(r) {
    try { const raw = typeof r.raw_data === 'string' ? JSON.parse(r.raw_data) : r.raw_data; return raw || {}; } catch(e) { return {}; }
  }
  const hasLOB = records.some(r => r.lob);
  const hasSplitData = records.some(r => r.thei_share != null || r.bsi_share != null);
  const hasSubAgentOverride = records.some(r => r.sub_agent_override && r.sub_agent_override > 0);
  const carrierStatementRows = clientHistoryData.filter(
    (row) => classifyClientFileStream(row) === 'carrier_bsi'
  );
  const theiRemittanceRows = clientHistoryData.filter(
    (row) => classifyClientFileStream(row) === 'thei_override'
  );
  const otherCommissionRows = clientHistoryData.filter(
    (row) => classifyClientFileStream(row) === 'other'
  );
  const sumStatementCommission = (rows) => rows.reduce(
    (total, row) => total + (parseFloat(row.commission) || 0),
    0
  );

  function ClientHistoryRows({ rows }) {
    return (
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr>
            {['Period', 'Type', 'Statement amount', 'Policy', 'LOB', 'Agent', 'Source'].map((h) => (
              <th
                key={h}
                style={{
                  textAlign: 'left', padding: '6px 8px',
                  borderBottom: '0.5px solid var(--border)', color: 'var(--text-muted)', fontSize: 11
                }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const amount = parseFloat(row.commission) || 0;
            return (
              <tr key={row.id} style={{ borderBottom: '0.5px solid var(--border)' }}>
                <td style={{ padding: '6px 8px' }}>{formatPeriodLabel(row.payment_period)}</td>
                <td style={{ padding: '6px 8px' }}>{row.classification || '—'}</td>
                <td style={{ padding: '6px 8px' }}>
                  <AmountLink
                    value={amount}
                    record={row}
                    onOpenSource={openSourceReport}
                    style={{ color: amount < 0 ? 'var(--red)' : 'var(--green)' }}
                  />
                </td>
                <td style={{ padding: '6px 8px', color: 'var(--text-muted)' }}>{row.policy_number || '—'}</td>
                <td style={{ padding: '6px 8px' }}>{row.lob || '—'}</td>
                <td style={{ padding: '6px 8px' }}>{row.agent_name || '—'}</td>
                <td style={{ padding: '6px 8px', maxWidth: 160 }}>
                  {row.upload_id ? (
                    <button
                      type="button"
                      onClick={() => openSourceReport(row)}
                      title={row.upload_name || `Upload #${row.upload_id}`}
                      style={{
                        background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                        color: 'var(--accent-dark)', fontSize: 11, textDecoration: 'underline',
                        textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap', maxWidth: '100%', display: 'block',
                      }}
                    >
                      {row.upload_name || `Upload #${row.upload_id}`}
                    </button>
                  ) : (
                    <span style={{ color: 'var(--text-muted)' }}>—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    );
  }
  
  const columns = [
    { col: 'carrier',         label: 'Carrier' },
    { col: 'agent_name',      label: 'Agent' },
    { col: 'policy_number',   label: 'Policy #' },
    { col: 'client_full_name',label: 'Client' },
    { col: 'effective_date',  label: 'Effective' },
    { col: 'premium',         label: 'Premium' },
    { col: 'commission',      label: 'Comm Value' },
    ...(hasCommSplit ? [{ col: 'comm_rate', label: 'Comm Rate' }] : []),
    ...(hasCommSplit ? [{ col: 'agent_comm', label: 'Agent Comm' }] : []),
    ...(hasCommSplit ? [{ col: 'agency_comm', label: 'Agency Comm' }] : []),
    { col: 'payment_period',  label: 'Period' },
    { col: 'classification',  label: 'Type' },
    ...(hasLOB ? [{ col: 'lob', label: 'LOB' }] : []),
    ...(hasSplitData ? [{ col: 'gross_commission', label: 'Gross' }] : []),
    ...(hasSplitData ? [{ col: 'thei_share', label: 'THEI' }] : []),
    ...(hasSplitData ? [{ col: 'bsi_share', label: 'BSI' }] : []),
    ...(hasSplitData ? [{ col: 'producer_payable', label: 'Agent Pay' }] : []),
    ...(hasSubAgentOverride ? [{ col: 'sub_agent_override', label: 'Sub-Agent OV' }] : []),
    ...(hasMGA ? [{ col: 'mga', label: 'MGA' }] : []),
  ];

  return (
    <>
      {sourceReport && (
        <div
          onClick={() => setSourceReport(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'var(--bg)', borderRadius: 12, padding: 24, width: 480, maxWidth: '96vw',
              border: '0.5px solid var(--border)', boxShadow: '0 8px 32px rgba(0,0,0,0.15)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14, gap: 12 }}>
              <div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>
                  Source report
                </div>
                <div style={{ fontSize: 16, fontWeight: 600, wordBreak: 'break-word' }}>
                  {sourceReport.upload_name || `Upload #${sourceReport.upload_id}`}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSourceReport(null)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: 'var(--text-muted)' }}
              >
                ×
              </button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 16px', fontSize: 13, marginBottom: 18 }}>
              <div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 2 }}>Uploads tab</div>
                <div style={{ fontWeight: 500 }}>{uploadCategoryLabel(sourceReport.upload_category)}</div>
              </div>
              <div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 2 }}>Uploaded</div>
                <div style={{ fontWeight: 500 }}>
                  {sourceReport.upload_uploaded_at
                    ? new Date(sourceReport.upload_uploaded_at).toLocaleString()
                    : '—'}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 2 }}>Carrier</div>
                <div style={{ fontWeight: 500 }}>{formatCarrier(sourceReport.carrier) || '—'}</div>
              </div>
              <div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 2 }}>Period</div>
                <div style={{ fontWeight: 500 }}>{formatPeriodLabel(sourceReport.payment_period)}</div>
              </div>
              <div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 2 }}>Client</div>
                <div style={{ fontWeight: 500 }}>{sourceReport.client_full_name || '—'}</div>
              </div>
              <div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 2 }}>Comm value</div>
                <div style={{ fontWeight: 500, color: parseFloat(sourceReport.commission) < 0 ? 'var(--red)' : 'var(--green)' }}>
                  {fmt(sourceReport.commission)}
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={viewSourceUploadRows}
                style={{
                  padding: '8px 14px', borderRadius: 8, border: 'none', cursor: 'pointer',
                  background: 'var(--accent)', color: 'var(--sidebar-bg)', fontWeight: 600, fontSize: 13,
                }}
              >
                View all rows from this report
              </button>
              <button
                type="button"
                onClick={exportSourceReport}
                disabled={sourceExporting}
                style={{
                  padding: '8px 14px', borderRadius: 8, border: '1px solid var(--border)', cursor: sourceExporting ? 'wait' : 'pointer',
                  background: 'var(--bg)', color: 'var(--text)', fontWeight: 500, fontSize: 13,
                }}
              >
                {sourceExporting ? 'Exporting…' : 'Export report'}
              </button>
            </div>
          </div>
        </div>
      )}

      {policyModal && (
        <div onClick={()=>setPolicyModal(null)} style={{position:'fixed',top:0,left:0,right:0,bottom:0,background:'rgba(0,0,0,0.45)',zIndex:1000,display:'flex',alignItems:'center',justifyContent:'center'}}>
          <div onClick={e=>e.stopPropagation()} style={{background:'var(--bg)',borderRadius:12,padding:28,width:520,maxWidth:'95vw',border:'0.5px solid var(--border)',boxShadow:'0 8px 32px rgba(0,0,0,0.15)',maxHeight:'85vh',overflowY:'auto'}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:18}}>
              <div>
                <div style={{fontSize:11,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.5px',marginBottom:4}}>Policy Record</div>
                <div style={{fontSize:16,fontWeight:500,color:'var(--text)'}}>{policyModal.policy_number || '—'}</div>
              </div>
              <button onClick={()=>setPolicyModal(null)} style={{background:'none',border:'none',cursor:'pointer',fontSize:20,color:'var(--text-muted)'}}>×</button>
            </div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'10px 20px',fontSize:13}}>
              {[
                ['Client', policyModal.client_full_name],
                ['Agent', policyModal.agent_name],
                ['Carrier', policyModal.carrier],
                ['Plan Type', policyModal.plan_type],
                ['LOB', policyModal.lob],
                ['Effective Date', formatDate(policyModal.effective_date)],
                ['Period', policyModal.payment_period],
                ['Type', policyModal.classification],
                ['Payee', policyModal.payee],
                ['MGA', policyModal.mga],
                ['Premium', policyModal.premium ? fmt(policyModal.premium) : '—'],
                ['Comm Value', null],
                ['Gross Commission', policyModal.gross_commission != null ? fmt(policyModal.gross_commission) : null],
                ['THEI Share', policyModal.thei_share != null ? fmt(policyModal.thei_share) : null],
                ['BSI Share', policyModal.bsi_share != null ? fmt(policyModal.bsi_share) : null],
                ['Agent Payable', policyModal.producer_payable != null ? fmt(policyModal.producer_payable) : null],
                ['Sub-Agent Override', policyModal.sub_agent_override && policyModal.sub_agent_override > 0 ? fmt(policyModal.sub_agent_override) : null],
              ].map(([label, val]) => {
                if (label === 'Comm Value') {
                  return (
                    <div key={label}>
                      <div style={{fontSize:10,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.5px',marginBottom:2}}>{label}</div>
                      <div style={{fontWeight:500,color:'var(--text)'}}>
                        <AmountLink
                          value={policyModal.commission}
                          record={policyModal}
                          onOpenSource={openSourceReport}
                          style={{ color: parseFloat(policyModal.commission) < 0 ? 'var(--red)' : 'var(--green)' }}
                        />
                      </div>
                    </div>
                  );
                }
                return val && val !== '—' ? (
                <div key={label}>
                  <div style={{fontSize:10,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.5px',marginBottom:2}}>{label}</div>
                  <div style={{fontWeight:500,color:'var(--text)'}}>{val}</div>
                </div>
              ) : null;
              })}
              {(() => {
                const s = policyModal.raw_data ? (typeof policyModal.raw_data === 'string' ? JSON.parse(policyModal.raw_data) : policyModal.raw_data) : {};
                return s.commRate ? (
                  <>
                    <div>
                      <div style={{fontSize:10,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.5px',marginBottom:2}}>Comm Rate</div>
                      <div style={{fontWeight:500,color:'var(--text)'}}>{s.commRate}%</div>
                    </div>
                    <div>
                      <div style={{fontSize:10,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.5px',marginBottom:2}}>Comm Value</div>
                      <div style={{fontWeight:500,color:'var(--text)'}}>{fmt(s.commValue)}</div>
                    </div>
                    <div>
                      <div style={{fontSize:10,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.5px',marginBottom:2}}>Agent Comm</div>
                      <div style={{fontWeight:500,color:'var(--green)'}}>{fmt(s.agentComm)}</div>
                    </div>
                    <div>
                      <div style={{fontSize:10,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.5px',marginBottom:2}}>Agency Comm</div>
                      <div style={{fontWeight:500,color:'var(--text)'}}>{fmt(s.agencyComm)}</div>
                    </div>
                  </>
                ) : null;
              })()}
            </div>
            <div style={{marginTop:16,paddingTop:12,borderTop:'0.5px solid var(--border)',fontSize:11,color:'var(--text-muted)'}}>
              Upload:{' '}
              {policyModal.upload_id ? (
                <button
                  type="button"
                  onClick={() => openSourceReport(policyModal)}
                  style={{
                    background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                    color: 'var(--accent-dark)', fontWeight: 500, textDecoration: 'underline', fontSize: 11,
                  }}
                >
                  {policyModal.upload_name || `Upload #${policyModal.upload_id}`}
                </button>
              ) : (policyModal.upload_name || '—')}
            </div>
          </div>
        </div>
      )}

      {clientHistory && (
        <div
          onClick={() => setClientHistory(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'var(--bg)', borderRadius: 12, padding: 24, width: 860, maxWidth: '96vw',
              maxHeight: '85vh', overflowY: 'auto', border: '0.5px solid var(--border)',
              boxShadow: '0 8px 32px rgba(0,0,0,0.15)'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12, gap: 12 }}>
              <div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>
                  Client file
                </div>
                <div style={{ fontSize: 17, fontWeight: 600 }}>{clientHistory.client_full_name}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                  {formatCarrier(clientHistory.carrier)}
                  {clientHistory.agent_name ? ` · ${clientHistory.agent_name}` : ''}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setClientHistory(null)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: 'var(--text-muted)' }}
              >
                ×
              </button>
            </div>

            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-muted)', marginBottom: 14, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={clientHistorySameAgent}
                onChange={(e) => {
                  const next = e.target.checked;
                  setClientHistorySameAgent(next);
                  loadClientHistory(clientHistory, next);
                }}
              />
              Same agent only
            </label>

            {clientHistoryLoading ? (
              <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>Loading…</div>
            ) : clientHistoryError ? (
              <div style={{ padding: 12, borderRadius: 8, background: '#F5EAE4', color: '#7A3D1F', fontSize: 13 }}>{clientHistoryError}</div>
            ) : clientHistoryData.length === 0 ? (
              <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>No commission rows found</div>
            ) : (
              <>
                <div style={{ padding: 10, marginBottom: 12, borderRadius: 8, background: 'var(--bg-secondary)', fontSize: 12, color: 'var(--text-muted)' }}>
                  Statement activity is grouped by where it came from. Carrier → BSI rows and THEI remittance rows are not combined into one payment total.
                </div>
                {carrierStatementRows.length > 0 && (
                  <section style={{ marginBottom: theiRemittanceRows.length > 0 ? 24 : 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 8, fontSize: 13 }}>
                      <strong>Carrier → BSI statement activity</strong>
                      <span><strong>{carrierStatementRows.length}</strong> rows · statement total: <strong>{fmt(sumStatementCommission(carrierStatementRows))}</strong></span>
                    </div>
                    <ClientHistoryRows rows={carrierStatementRows} />
                  </section>
                )}
                {theiRemittanceRows.length > 0 && (
                  <section style={{ marginBottom: otherCommissionRows.length > 0 ? 24 : 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 8, fontSize: 13 }}>
                      <strong>THEI remittance / agency override activity</strong>
                      <span><strong>{theiRemittanceRows.length}</strong> rows · statement total: <strong>{fmt(sumStatementCommission(theiRemittanceRows))}</strong></span>
                    </div>
                    <ClientHistoryRows rows={theiRemittanceRows} />
                  </section>
                )}
                {otherCommissionRows.length > 0 && (
                  <section>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 8, fontSize: 13 }}>
                      <strong>Other agent / commission activity</strong>
                      <span><strong>{otherCommissionRows.length}</strong> rows · statement total: <strong>{fmt(sumStatementCommission(otherCommissionRows))}</strong></span>
                    </div>
                    <ClientHistoryRows rows={otherCommissionRows} />
                  </section>
                )}
              </>
            )}
          </div>
        </div>
      )}

      <div className="page-header">
        <div className="page-title">All Data</div>
        <div className="page-sub">One row per client · open their file for payment history · switch to By payment for every digests row</div>
      </div>
      <div className="page-body">

        {confirmDelete && (
          <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ background: 'var(--bg)', borderRadius: 12, padding: 28, width: 400, boxShadow: '0 8px 40px rgba(0,0,0,0.2)', border: '0.5px solid var(--border)' }}>
              <div style={{ fontWeight: 500, fontSize: 16, marginBottom: 8, color: 'var(--red)' }}>{deleteModalText[confirmDelete]?.title}</div>
              <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16 }}>{deleteModalText[confirmDelete]?.sub}</div>
              {confirmDelete === 'all' && (
                <div style={{ background: '#F5EAE4', border: '0.5px solid #E5C8B8', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 12, color: '#7A3D1F' }}>
                  ⚠️ This will also delete all upload records and BOB data.
                </div>
              )}
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button onClick={() => { setConfirmDelete(null); setDeleteTarget(null); }} className="btn" disabled={deleting}>Cancel</button>
                <button onClick={executeDelete} className="btn btn-danger" disabled={deleting}>
                  {deleting ? 'Deleting...' : deleteModalText[confirmDelete]?.btn}
                </button>
              </div>
            </div>
          </div>
        )}

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12, alignItems: 'center' }}>
          <MultiSelect label="Agents" options={filterOptions.agents || []} selected={selAgents} onChange={setSelAgents} />
          <MultiSelect label="Carriers" options={filterOptions.carriers || []} selected={selCarriers} onChange={setSelCarriers} />
          <MultiSelect label="Periods" options={(filterOptions.periods || []).filter(p => p && p !== 'Unknown')} selected={selPeriods} onChange={setSelPeriods} />
          <MultiSelect label="Types" options={filterOptions.classifications || []} selected={selTypes} onChange={setSelTypes} />
          <MultiSelect label="LOB" options={filterOptions.lobs || []} selected={selLOB} onChange={setSelLOB} />
          <MultiSelect label="Payee" options={filterOptions.payees || []} selected={selPayees} onChange={setSelPayees} />
          <button
            type="button"
            onClick={() => setAmountSign(s => s === 'negative' ? '' : 'negative')}
            style={{
              padding: '6px 10px', borderRadius: 6, border: '0.5px solid var(--border)', fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap',
              background: amountSign === 'negative' ? 'var(--accent)' : 'var(--bg)',
              color: amountSign === 'negative' ? 'var(--sidebar-bg)' : 'var(--text)',
              fontWeight: amountSign === 'negative' ? 500 : 400,
            }}
            title="Show only negative commission rows (chargebacks)"
          >
            Chargebacks only
          </button>
          <input
            type="text"
            placeholder="Search client, agent..."
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(0); }}
            style={{ padding: '6px 10px', borderRadius: 6, border: '0.5px solid var(--border)', fontSize: 12, minWidth: 200, background: 'var(--bg)', color: 'var(--text)' }}
          />
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer', padding: '6px 10px', borderRadius: 6, border: '0.5px solid var(--border)', background: 'var(--bg)', color: 'var(--text)' }}>
            <input
              type="checkbox"
              checked={hideTermed}
              onChange={e => { setHideTermed(e.target.checked); setPage(0); }}
              style={{ cursor: 'pointer', accentColor: 'var(--accent)' }}
            />
            Hide termed clients
          </label>
          {hasFilters && (
            <button onClick={clearAll} style={{ padding: '6px 10px', borderRadius: 6, border: '0.5px solid var(--red)', background: 'none', color: 'var(--red)', fontSize: 12, fontWeight: 500, cursor: 'pointer' }}>
              Reset all
            </button>
          )}
          <div style={{ display: 'flex', border: '0.5px solid var(--border)', borderRadius: 6, overflow: 'hidden' }}>
            {[
              { id: 'clients', label: 'By client' },
              { id: 'payments', label: 'By payment' },
            ].map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => { setListMode(opt.id); setPage(0); setSortCol(''); }}
                style={{
                  padding: '6px 12px', border: 'none', fontSize: 12, cursor: 'pointer',
                  background: listMode === opt.id ? 'var(--accent)' : 'var(--bg)',
                  color: listMode === opt.id ? 'var(--sidebar-bg)' : 'var(--text)',
                  fontWeight: listMode === opt.id ? 600 : 400,
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <span style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 4 }}>
            {total.toLocaleString()} {listMode === 'clients' ? 'clients' : 'records'}
          </span>
          <div style={{ display: 'flex', gap: 6, marginLeft: 'auto' }}>
            <button className="btn" onClick={exportCSV} disabled={listMode === 'payments' ? !records.length : !clients.length} style={{ fontSize: 12 }}>↓ Export All</button>
            {user.role === 'admin' && selected.size > 0 && (
              <button onClick={() => setConfirmDelete('selected')} className="btn btn-danger" style={{ fontSize: 12 }}>
                Delete {selected.size} selected
              </button>
            )}
            {user.role === 'admin' && (
              <button onClick={() => setConfirmDelete('all')} style={{ background: 'none', border: '0.5px solid var(--red)', color: 'var(--red)', borderRadius: 6, padding: '6px 12px', fontSize: 12, fontWeight: 500, cursor: 'pointer' }}>
                Reset all data
              </button>
            )}
          </div>
        </div>

        {uploadFilter && (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap',
            marginBottom: 12, padding: '10px 14px', borderRadius: 8,
            background: 'var(--accent-light)', border: '0.5px solid var(--border)',
          }}>
            <div style={{ fontSize: 13 }}>
              Showing rows from report:{' '}
              <strong style={{ wordBreak: 'break-word' }}>{uploadFilter.name}</strong>
            </div>
            <button
              type="button"
              onClick={() => setUploadFilter(null)}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                color: 'var(--accent-dark)', fontWeight: 600, fontSize: 12, textDecoration: 'underline',
              }}
            >
              Clear report filter
            </button>
          </div>
        )}

        {hasFilters && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
            {[...selAgents, ...selCarriers, ...selPeriods, ...selTypes, ...selLOB, ...selPayees].map(f => (
              <span key={f} style={{ background: 'var(--accent)', color: 'var(--sidebar-bg)', borderRadius: 4, padding: '2px 10px', fontSize: 11, fontWeight: 500 }}>{f}</span>
            ))}
            {amountSign === 'negative' && (
              <span style={{ background: '#F5EAE4', color: '#7A3D1F', borderRadius: 4, padding: '2px 10px', fontSize: 11, fontWeight: 500 }}>Chargebacks only</span>
            )}
            {amountSign === 'positive' && (
              <span style={{ background: 'var(--accent-light)', color: 'var(--accent-dark)', borderRadius: 4, padding: '2px 10px', fontSize: 11, fontWeight: 500 }}>Credits only</span>
            )}
          </div>
        )}

        {search.trim().length >= 3 && (prodLoading || prodError || prodMatches.length > 0) && (
          <div className="card" style={{ marginBottom: 12, padding: '12px 14px', border: '0.5px solid var(--accent)' }}>
            <div
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}
              onClick={() => setProdPanelOpen((o) => !o)}
            >
              <div style={{ fontSize: 13, fontWeight: 600 }}>
                Agency production for "{search.trim()}"
                {!prodLoading && (
                  <span style={{ fontWeight: 400, color: 'var(--text-muted)', marginLeft: 8 }}>
                    {prodMatches.length} sale{prodMatches.length === 1 ? '' : 's'} on Agency Override Recon
                    {prodMatches.some((m) => m.label !== 'Paid') && ' — some not fully paid'}
                  </span>
                )}
              </div>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{prodPanelOpen ? '▲' : '▼'}</span>
            </div>
            {prodPanelOpen && (
              <div style={{ marginTop: 10 }}>
                {prodLoading ? (
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Checking agency production…</div>
                ) : prodError ? (
                  <div style={{ fontSize: 12, color: 'var(--red)' }}>{prodError}</div>
                ) : (
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead>
                      <tr style={{ textAlign: 'left', color: 'var(--text-muted)' }}>
                        <th style={{ padding: '4px 8px' }}>Client</th>
                        <th style={{ padding: '4px 8px' }}>Carrier</th>
                        <th style={{ padding: '4px 8px' }}>Agent</th>
                        <th style={{ padding: '4px 8px' }}>Eff. date</th>
                        <th style={{ padding: '4px 8px' }}>Status</th>
                        <th style={{ padding: '4px 8px' }} />
                      </tr>
                    </thead>
                    <tbody>
                      {prodMatches.map((m) => {
                        const tone = m.tone === 'green' ? 'var(--green)' : m.tone === 'red' ? 'var(--red)' : 'var(--accent-dark)';
                        return (
                          <tr key={m.production.id} style={{ borderTop: '0.5px solid var(--border)' }}>
                            <td style={{ padding: '6px 8px' }}>{m.production.client_name}</td>
                            <td style={{ padding: '6px 8px' }}>{formatCarrier(m.production.carrier)}</td>
                            <td style={{ padding: '6px 8px' }}>{m.production.agent_name}</td>
                            <td style={{ padding: '6px 8px' }}>{formatDate(m.production.effective_date)}</td>
                            <td style={{ padding: '6px 8px' }}>
                              <span style={{ color: tone, fontWeight: 600 }}>{m.label}</span>
                              {m.detail && (
                                <span style={{ color: 'var(--text-muted)', marginLeft: 6 }}>({m.detail})</span>
                              )}
                            </td>
                            <td style={{ padding: '6px 8px', textAlign: 'right' }}>
                              {onNavigate && (
                                <button
                                  type="button"
                                  onClick={() => onNavigate('agency-production-recon', { search: m.production.client_name })}
                                  style={{ background: 'none', border: 'none', color: 'var(--accent-dark)', fontSize: 12, cursor: 'pointer', textDecoration: 'underline', padding: 0 }}
                                >
                                  View in Recon
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8 }}>
                  This is agency production (Hector), not commission-statement rows — it's a separate table from the list below, so a paid sale can appear in both without being a duplicate.
                </div>
              </div>
            )}
          </div>
        )}

        <div className="card" style={{ padding: 0 }}>
          {loading ? (
            <div className="empty-state"><div className="empty-title" style={{ color: 'var(--text-muted)' }}>Loading...</div></div>
          ) : tableEmpty ? (
            <div className="empty-state">
              <div className="empty-icon">📋</div>
              <div className="empty-title">No {listMode === 'clients' ? 'clients' : 'records'} found</div>
              <div className="empty-sub">Try adjusting your filters</div>
            </div>
          ) : listMode === 'clients' ? (
            <>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>#</th>
                      {[
                        { col: 'client_full_name', label: 'Client' },
                        { col: 'carrier', label: 'Carrier' },
                        { col: 'agent_name', label: 'Agent' },
                        { col: 'policy_number', label: 'Policy #' },
                        { col: 'lob', label: 'LOB' },
                        { col: 'payment_count', label: 'Pays' },
                        { col: 'first_period', label: 'First' },
                        { col: 'latest_period', label: 'Latest' },
                        { col: 'commission_total', label: 'Total' },
                      ].map(({ col, label }) => {
                        const isActive = sortCol === col;
                        return (
                          <th key={col} onClick={() => handleSort(col)} style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}>
                            {label} {isActive ? (sortDir === 'asc' ? '↑' : '↓') : <span style={{ opacity: 0.3 }}>↕</span>}
                          </th>
                        );
                      })}
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {clients.map((c, i) => (
                      <tr key={`${c.client_full_name}|${c.carrier}`}>
                        <td style={{ color: 'var(--text-muted)', fontSize: 12 }}>{page * PAGE_SIZE + i + 1}</td>
                        <td style={{ fontSize: 13 }}>
                          <button
                            type="button"
                            onClick={() => {
                              setClientHistorySameAgent(false);
                              loadClientHistory(c, false);
                            }}
                            title="Open client file"
                            style={{
                              background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                              color: 'var(--accent-dark)', fontWeight: 600, fontSize: 13, textDecoration: 'underline',
                              textAlign: 'left',
                            }}
                          >
                            {c.client_full_name}
                          </button>
                          {c.is_termed && (
                            <span style={{
                              marginLeft: 6, padding: '2px 6px', borderRadius: 4,
                              background: '#E5E7EB', color: '#6B7280', fontSize: 10, fontWeight: 500, textTransform: 'uppercase',
                            }}>
                              Termed
                            </span>
                          )}
                        </td>
                        <td style={{ fontSize: 13, fontWeight: 500 }}>{formatCarrier(c.carrier)}</td>
                        <td style={{ fontSize: 13 }}>{c.agent_name || '—'}</td>
                        <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{c.policy_number || '—'}</td>
                        <td style={{ fontSize: 11, fontWeight: 500, color: c.lob === 'ACA' ? 'var(--amber)' : 'var(--text-muted)' }}>{c.lob || '—'}</td>
                        <td style={{ fontSize: 13, fontWeight: 500 }}>{c.payment_count}</td>
                        <td style={{ fontSize: 12 }}>{formatPeriodLabel(c.first_period)}</td>
                        <td style={{ fontSize: 12 }}>{formatPeriodLabel(c.latest_period)}</td>
                        <td style={{ fontWeight: 600, color: parseFloat(c.commission_total) < 0 ? 'var(--red)' : 'var(--green)' }}>
                          {fmt(c.commission_total)}
                        </td>
                        <td>
                          <button
                            type="button"
                            className="btn"
                            onClick={() => {
                              setClientHistorySameAgent(false);
                              loadClientHistory(c, false);
                            }}
                            style={{ fontSize: 11, padding: '4px 10px' }}
                          >
                            Open file
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr style={{ background: 'var(--bg-subtle)', fontWeight: 500 }}>
                      <td colSpan={6} style={{ padding: '10px 12px', fontSize: 13 }}>Page total ({clients.length} clients)</td>
                      <td style={{ padding: '10px 12px', fontSize: 13 }}>{pagePaymentCount}</td>
                      <td colSpan={2}></td>
                      <td style={{ padding: '10px 12px', fontSize: 13, color: pageClientTotal < 0 ? 'var(--red)' : 'var(--green)' }}>{fmt(pageClientTotal)}</td>
                      <td></td>
                    </tr>
                    <tr style={{ background: 'var(--accent-light, #F5EDD4)', fontWeight: 700 }}>
                      <td colSpan={6} style={{ padding: '10px 12px', fontSize: 13 }}>
                        All filtered ({total.toLocaleString()} {total === 1 ? 'client' : 'clients'})
                      </td>
                      <td style={{ padding: '10px 12px', fontSize: 13 }}>
                        {filterSums?.payment_count != null ? Number(filterSums.payment_count).toLocaleString() : '—'}
                      </td>
                      <td colSpan={2}></td>
                      <td style={{ padding: '10px 12px', fontSize: 14, color: grandTotal < 0 ? 'var(--red)' : 'var(--green)' }}>{fmt(grandTotal)}</td>
                      <td></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              {total > PAGE_SIZE && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderTop: '0.5px solid var(--border)', fontSize: 13 }}>
                  <span style={{ color: 'var(--text-muted)' }}>Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total.toLocaleString()}</span>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button className="btn" onClick={() => handlePage(-1)} disabled={page === 0}>← Prev</button>
                    <button className="btn" onClick={() => handlePage(1)} disabled={(page + 1) * PAGE_SIZE >= total}>Next →</button>
                  </div>
                </div>
              )}
            </>
          ) : (
            <>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      {user.role === 'admin' && (
                        <th style={{ width: 36 }}>
                          <input type="checkbox" checked={selected.size === records.length && records.length > 0} onChange={toggleSelectAll} style={{ cursor: 'pointer', accentColor: 'var(--accent)' }} />
                        </th>
                      )}
                      <th>#</th>
                      {columns.map(({ col, label }) => {
                        const isActive = sortCol === col;
                        return (
                          <th key={col} onClick={() => handleSort(col)} style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}>
                            {label} {isActive ? (sortDir === 'asc' ? '↑' : '↓') : <span style={{ opacity: 0.3 }}>↕</span>}
                          </th>
                        );
                      })}
                      {user.role === 'admin' && <th></th>}
                    </tr>
                  </thead>
                  <tbody>
                    {records.map((r, i) => {
                      const isSel = selected.has(r.id);
                      return (
                        <tr key={r.id} style={{ background: isSel ? 'var(--accent-light)' : 'transparent' }}>
                          {user.role === 'admin' && (
                            <td><input type="checkbox" checked={isSel} onChange={() => toggleSelect(r.id)} style={{ cursor: 'pointer', accentColor: 'var(--accent)' }} /></td>
                          )}
                          <td style={{ color: 'var(--text-muted)', fontSize: 12 }}>{page * PAGE_SIZE + i + 1}</td>
                          <td style={{ fontSize: 13, fontWeight: 500 }}>{formatCarrier(r.carrier)}</td>
                          <td style={{ fontWeight: 500, fontSize: 13 }}>{r.agent_name}</td>
                          <td style={{ fontSize: 12 }}>
                            {r.policy_number
                              ? <span onClick={()=>setPolicyModal(r)} style={{cursor:'pointer',color:'var(--accent-dark)',fontWeight:500}}>{r.policy_number}</span>
                              : '—'}
                          </td>
                          <td style={{ fontSize: 13 }}>
                            {r.client_full_name ? (
                              <button
                                type="button"
                                onClick={() => loadClientHistory(r)}
                                title="Open client file"
                                style={{
                                  background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                                  color: 'var(--accent-dark)', fontWeight: 500, fontSize: 13, textDecoration: 'underline',
                                  textAlign: 'left'
                                }}
                              >
                                {r.client_full_name}
                              </button>
                            ) : '—'}
                            {r.is_termed && (
                              <span style={{
                                marginLeft: 6,
                                padding: '2px 6px',
                                borderRadius: 4,
                                background: '#E5E7EB',
                                color: '#6B7280',
                                fontSize: 10,
                                fontWeight: 500,
                                textTransform: 'uppercase'
                              }}>
                                Termed
                              </span>
                            )}
                          </td>
                          <td style={{ fontSize: 12 }}>{formatDate(r.effective_date)}</td>
                          <td>{r.premium ? fmt(r.premium) : '—'}</td>
                          <td>
                            <AmountLink
                              value={r.commission}
                              record={r}
                              onOpenSource={openSourceReport}
                              style={{ color: parseFloat(r.commission) < 0 ? 'var(--red)' : 'var(--green)' }}
                            />
                          </td>
                          {hasCommSplit && (() => { const s = getCommSplit(r); return (
                            <>
                              <td style={{ fontSize: 12 }}>{s.commRate !== undefined ? `${s.commRate}%` : '—'}</td>
                              <td style={{ fontWeight: 500, fontSize: 13, color: s.agentComm > 0 ? 'var(--green)' : 'var(--text)' }}>{s.agentComm !== undefined ? fmt(s.agentComm) : '—'}</td>
                              <td style={{ fontSize: 12 }}>{s.agencyComm !== undefined ? fmt(s.agencyComm) : '—'}</td>
                            </>
                          );})()}
                          <td style={{ fontSize: 12 }}>{r.payment_period || '—'}</td>
                          <td style={{ whiteSpace: 'nowrap' }}>
                            <span className={`badge ${badgeClass(r.classification)}`}>
                              {r.classification === 'Agency Override' ? 'Override' : (r.classification || '—')}
                            </span>
                          </td>
                          {hasLOB && <td style={{ fontSize: 11, fontWeight: 500, color: r.lob === 'ACA' ? 'var(--amber)' : 'var(--text-muted)' }}>{r.lob || '—'}</td>}
                          {hasSplitData && (
                            <td style={{ fontSize: 12, fontWeight: 500 }}>
                              <AmountLink value={r.gross_commission} record={r} onOpenSource={openSourceReport} />
                            </td>
                          )}
                          {hasSplitData && (
                            <td style={{ fontSize: 12 }}>
                              <AmountLink
                                value={r.thei_share}
                                record={r}
                                onOpenSource={openSourceReport}
                                style={{ color: parseFloat(r.thei_share) > 0 ? 'var(--green)' : 'var(--text-muted)' }}
                              />
                            </td>
                          )}
                          {hasSplitData && (
                            <td style={{ fontSize: 12 }}>
                              <AmountLink
                                value={r.bsi_share}
                                record={r}
                                onOpenSource={openSourceReport}
                                style={{ color: parseFloat(r.bsi_share) > 0 ? 'var(--blue)' : 'var(--text-muted)' }}
                              />
                            </td>
                          )}
                          {hasSplitData && (
                            <td style={{ fontSize: 12 }}>
                              <AmountLink
                                value={r.producer_payable}
                                record={r}
                                onOpenSource={openSourceReport}
                                style={{ color: parseFloat(r.producer_payable) > 0 ? 'var(--accent-dark)' : 'var(--text-muted)' }}
                              />
                            </td>
                          )}
                          {hasSubAgentOverride && <td style={{ fontSize: 12, fontWeight: 500, color: parseFloat(r.sub_agent_override) > 0 ? 'var(--amber)' : 'var(--text-muted)' }}>{r.sub_agent_override && r.sub_agent_override > 0 ? fmt(r.sub_agent_override) : '—'}</td>}
                          {hasMGA && <td style={{ fontSize: 11, color: 'var(--text-muted)' }}>{r.mga || '—'}</td>}
                          {user.role === 'admin' && (
                            <td style={{ whiteSpace: 'nowrap' }}>
                              <button
                                type="button"
                                title="Edit"
                                onClick={() => setEditRecord(r)}
                                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent-dark)', fontSize: 12, padding: '2px 6px', fontWeight: 500 }}
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                title="Delete"
                                onClick={() => { setDeleteTarget(r); setConfirmDelete('single'); }}
                                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 14, padding: '2px 6px' }}
                              >
                                ✕
                              </button>
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr style={{ background: 'var(--bg-subtle)', fontWeight: 500, borderTop: '1px solid var(--border)' }}>
                      {user.role === 'admin' && footerEmpty()}
                      <td style={{ padding: '10px 12px', fontSize: 12, color: 'var(--text-muted)' }} />
                      {/* Carrier → Premium (6 cols before Comm Value) */}
                      <td colSpan={6} style={{ padding: '10px 12px', fontSize: 13 }}>
                        Total ({total.toLocaleString()} {total === 1 ? 'record' : 'records'})
                      </td>
                      {footerMoney(sumMoney('commission'))}
                      {hasCommSplit && (
                        <>
                          {footerEmpty()}
                          {footerEmpty()}
                          {footerEmpty()}
                        </>
                      )}
                      {footerEmpty()}
                      {footerEmpty()}
                      {hasLOB && footerEmpty()}
                      {hasSplitData && footerMoney(sumMoney('gross_commission'))}
                      {hasSplitData && footerMoney(sumMoney('thei_share'), sumMoney('thei_share') !== 0 ? 'var(--green)' : 'var(--text-muted)')}
                      {hasSplitData && footerMoney(sumMoney('bsi_share'), sumMoney('bsi_share') !== 0 ? 'var(--blue)' : 'var(--text-muted)')}
                      {hasSplitData && footerMoney(sumMoney('producer_payable'), sumMoney('producer_payable') !== 0 ? 'var(--accent-dark)' : 'var(--text-muted)')}
                      {hasSubAgentOverride && footerMoney(sumMoney('sub_agent_override'), sumMoney('sub_agent_override') !== 0 ? 'var(--amber)' : 'var(--text-muted)')}
                      {hasMGA && footerEmpty()}
                      {user.role === 'admin' && footerEmpty()}
                    </tr>
                  </tfoot>
                </table>
              </div>
              {total > PAGE_SIZE && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderTop: '0.5px solid var(--border)', fontSize: 13 }}>
                  <span style={{ color: 'var(--text-muted)' }}>Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total.toLocaleString()}</span>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button className="btn" onClick={() => handlePage(-1)} disabled={page === 0}>← Prev</button>
                    <button className="btn" onClick={() => handlePage(1)} disabled={(page + 1) * PAGE_SIZE >= total}>Next →</button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
      {editRecord && (
        <EditCommissionModal
          record={editRecord}
          onClose={() => setEditRecord(null)}
          onSave={(updated) => {
            if (updated) {
              setRecords(prev => prev.map(r => (r.id === updated.id ? { ...r, ...updated } : r)));
            }
            setEditRecord(null);
          }}
        />
      )}
    </>
  );
}
