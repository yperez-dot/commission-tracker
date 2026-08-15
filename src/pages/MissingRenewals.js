import React, { useState, useEffect } from 'react';
import { apiFetch } from '../api';
import { normName, nameVariants, normCarrier } from '../matchingNormalize';

function fmt(n) {
  const num = parseFloat(String(n || '0').replace(/[$,]/g, ''));
  return '$' + (isNaN(num) ? 0 : num).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatPeriodLabel(p) {
  if (!p) return null;
  const s = String(p).trim();
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  if (s.match(/^\d{6}$/)) return months[parseInt(s.slice(4,6))-1] + ' ' + s.slice(0,4);
  if (s.match(/^\d{2}\/\d{4}$/)) return months[parseInt(s.slice(0,2))-1] + ' ' + s.slice(3);
  if (s.match(/^\d{2}\/\d{2}\/\d{4}$/)) return months[parseInt(s.slice(0,2))-1] + ' ' + s.slice(6);
  return null;
}

function normPeriod(p) {
  if (!p) return null;
  const s = String(p).trim();
  if (s.match(/^\d{6}$/) && parseInt(s.slice(0,4)) > 1900) return s;
  const m1 = s.match(/^(\d{1,2})\/(\d{4})$/);
  if (m1) return m1[2] + m1[1].padStart(2,'0');
  const m2 = s.match(/^(\d{1,2})\/\d{2}\/(\d{4})$/);
  if (m2) return m2[2] + m2[1].padStart(2,'0');
  return null;
}

// Calculate months between last paid and termed date
function calculateOwedMonths(lastPaidPeriod, termedDate) {
  if (!lastPaidPeriod || !termedDate) return 0;
  
  // Parse lastPaidPeriod (YYYYMM format like 202605)
  const lastPaidStr = String(lastPaidPeriod).replace(/\D/g, '');
  let lastPaidYear, lastPaidMonth;
  if (lastPaidStr.length === 6) {
    lastPaidYear = parseInt(lastPaidStr.substring(0, 4), 10);
    lastPaidMonth = parseInt(lastPaidStr.substring(4, 6), 10);
  } else {
    return 0;
  }
  
  // Parse termedDate (YYYY-MM-DD format)
  const termedMatch = String(termedDate).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!termedMatch) return 0;
  const termedYear = parseInt(termedMatch[1], 10);
  const termedMonth = parseInt(termedMatch[2], 10);
  
  // Calculate month difference
  const monthsDiff = (termedYear - lastPaidYear) * 12 + (termedMonth - lastPaidMonth);
  
  // Only show if termed is after last paid (positive difference)
  return monthsDiff > 0 ? monthsDiff : 0;
}

function prettifyDate(d) {
  if (!d) return '';
  const s = String(d).trim();
  if (!s || s === '—') return '';
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  // YYYYMMDD (e.g., 20260101)
  const m1 = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m1) {
    const mo = parseInt(m1[2], 10);
    return mo >= 1 && mo <= 12 ? `${months[mo-1]} ${parseInt(m1[3],10)}, ${m1[1]}` : s;
  }
  // MM/DD/YYYY
  const m2 = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m2) {
    const mo = parseInt(m2[1], 10);
    return mo >= 1 && mo <= 12 ? `${months[mo-1]} ${parseInt(m2[2],10)}, ${m2[3]}` : s;
  }
  // YYYY-MM-DD
  const m3 = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m3) {
    const mo = parseInt(m3[2], 10);
    return mo >= 1 && mo <= 12 ? `${months[mo-1]} ${parseInt(m3[3],10)}, ${m3[1]}` : s;
  }
  return s; // leave anything else as-is
}

function periodToDate(p) {
  if (!p) return null;
  const s = String(p).trim();
  if (s.match(/^\d{6}$/)) return new Date(parseInt(s.slice(0,4)), parseInt(s.slice(4,6))-1, 1);
  const m1 = s.match(/^(\d{1,2})\/(\d{4})$/);
  if (m1) return new Date(parseInt(m1[2]), parseInt(m1[1])-1, 1);
  const m2 = s.match(/^(\d{1,2})\/\d{2}\/(\d{4})$/);
  if (m2) return new Date(parseInt(m2[2]), parseInt(m2[1])-1, 1);
  return null;
}

function parseEffDate(d) {
  if (!d) return null;
  const s = String(d).trim();
  if (s.match(/^\d{1,2}\/\d{1,2}\/\d{4}$/)) {
    const [m,,y] = s.split('/');
    return new Date(parseInt(y), parseInt(m)-1, 1);
  }
  if (s.match(/^\d{4}-\d{2}-\d{2}/)) {
    const [y, m] = s.split('-');
    return new Date(parseInt(y), parseInt(m)-1, 1);
  }
  // Handle YYYYMMDD format (e.g., 20260601)
  if (s.match(/^\d{8}$/)) {
    return new Date(parseInt(s.slice(0,4)), parseInt(s.slice(4,6))-1, 1);
  }
  return null;
}

export default function MissingRenewals({ user }) {
  const [periods, setPeriods] = useState([]); // [{period, label, recordCount, viable}]
  const [selectedPeriod, setSelectedPeriod] = useState('');
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState([]);
  const [showMissingOnly, setShowMissingOnly] = useState(true);
  const [filterAgent, setFilterAgent] = useState('');
  const [filterCarrier, setFilterCarrier] = useState('');
  const [filterLOB, setFilterLOB] = useState('');
  const [filterClient, setFilterClient] = useState('');
  const [selectedClient, setSelectedClient] = useState(null);
  const [clientRecords, setClientRecords] = useState([]);
  const [clientLoading, setClientLoading] = useState(false);
  const [coverageWarning, setCoverageWarning] = useState(null);
  const [showCoverageWarning, setShowCoverageWarning] = useState(true);
  const [grayedRows, setGrayedRows] = useState(new Set());
  const [termedDatePicker, setTermedDatePicker] = useState(null); // { rowKey, date }
  const [sortCol, setSortCol] = useState('isMissing'); // Default: sort by missing status
  const [sortDir, setSortDir] = useState('desc'); // Missing first
  const [loadError, setLoadError] = useState('');
  const [checkMeta, setCheckMeta] = useState(null); // { periodRecordCount, sparsePeriod, summary }

  // Toast notification helper
  function showToast(message, type = 'success') {
    const toast = document.createElement('div');
    toast.style.cssText = `
      position: fixed;
      bottom: 24px;
      right: 24px;
      background: ${type === 'success' ? '#452068' : '#e53e3e'};
      color: white;
      padding: 12px 20px;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 500;
      z-index: 9999;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      transition: opacity 0.3s ease;
    `;
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => { toast.style.opacity = '0'; }, 2500);
    setTimeout(() => { toast.remove(); }, 2800);
  }

  // Countdown toast with undo button
  function showCountdownToast(message, seconds, onUndo) {
    let undone = false;
    let remaining = seconds;
    
    const toast = document.createElement('div');
    toast.style.cssText = `
      position: fixed;
      bottom: 24px;
      right: 24px;
      background: #452068;
      color: white;
      padding: 14px 20px;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 500;
      z-index: 9999;
      box-shadow: 0 4px 12px rgba(0,0,0,0.2);
      display: flex;
      align-items: center;
      gap: 16px;
      min-width: 320px;
    `;
    
    toast.innerHTML = `
      <span id="toast-msg">${message} (${remaining}s)</span>
      <button id="toast-undo" style="
        background: white;
        color: #452068;
        border: none;
        padding: 4px 12px;
        border-radius: 4px;
        font-weight: 600;
        cursor: pointer;
        font-size: 13px;
      ">Undo</button>
    `;
    
    document.body.appendChild(toast);
    
    // Countdown timer
    const interval = setInterval(() => {
      remaining--;
      const msg = toast.querySelector('#toast-msg');
      if (msg) msg.textContent = `${message} (${remaining}s)`;
      if (remaining <= 0) {
        clearInterval(interval);
        toast.remove();
      }
    }, 1000);
    
    // Undo button
    toast.querySelector('#toast-undo').addEventListener('click', () => {
      undone = true;
      clearInterval(interval);
      toast.remove();
      onUndo();
    });
    
    // Auto remove after seconds
    setTimeout(() => {
      clearInterval(interval);
      if (toast.parentNode) toast.remove();
    }, seconds * 1000);
    
    return () => undone;
  }

  useEffect(() => {
    apiFetch('/bob/missing-renewals-periods')
      .then((d) => {
        const list = (d.periods || []).filter((p) => p && p.period && p.label);
        setPeriods(list);
        if (d.defaultPeriod) setSelectedPeriod(d.defaultPeriod);
        else if (list.length > 0) setSelectedPeriod(list[0].period);
      })
      .catch((err) => {
        console.error(err);
        // Fallback to legacy filters list if periods endpoint fails
        apiFetch('/records/filters')
          .then((d) => {
            const valid = (d.periods || []).filter((p) => {
              if (!p || p === 'Unknown') return false;
              const s = String(p);
              return s.match(/^\d{6}$/) || s.match(/^\d{2}\/\d{4}$/) || s.match(/^\d{2}\/\d{2}\/\d{4}$/);
            });
            const seen = new Set();
            const deduped = valid.filter((p) => {
              const label = formatPeriodLabel(p);
              if (!label || seen.has(label)) return false;
              seen.add(label);
              return true;
            });
            setPeriods(deduped.map((p) => ({ period: p, label: formatPeriodLabel(p), recordCount: null, viable: true })));
            if (deduped.length > 0) setSelectedPeriod(deduped[0]);
          })
          .catch(console.error);
      });
  }, []);

  async function runCheck() {
    if (!selectedPeriod) return;
    setLoading(true);
    setRows([]);
    setCoverageWarning(null);
    setShowCoverageWarning(true);
    setLoadError('');
    setCheckMeta(null);
    try {
      const targetNorm = normPeriod(selectedPeriod) || selectedPeriod;

      try {
        const coverage = await apiFetch(`/bob/coverage?period=${encodeURIComponent(selectedPeriod)}`);
        setCoverageWarning(coverage);
      } catch (err) {
        console.error('Coverage check failed:', err);
      }

      const data = await apiFetch(
        `/bob/missing-renewals-check?period=${encodeURIComponent(targetNorm)}`
      );
      setRows(data.rows || []);
      setCheckMeta({
        periodRecordCount: data.periodRecordCount,
        sparsePeriod: !!data.sparsePeriod,
        summary: data.summary || null,
        minStatementRecords: data.minStatementRecords,
      });
    } catch (e) {
      console.error(e);
      setLoadError(e.message || 'Missing renewals check failed');
    } finally {
      setLoading(false);
    }
  }

  async function openClient(row) {
    setSelectedClient(row);
    setClientLoading(true);
    setClientRecords([]);
    try {
      // Pull a large window then filter — payment history spans many periods
      const data = await apiFetch(`/records?search=${encodeURIComponent(row.client)}&limit=500`);
      const recs = (data.records || []).filter(r => {
        const normClient = normName(row.client);
        const normRecord = normName(r.client_full_name);
        if (normCarrier(r.carrier) !== normCarrier(row.carrier)) return false;
        if (normClient === normRecord) return true;
        return nameVariants(row.client).some(v => v === normRecord) ||
               nameVariants(r.client_full_name).some(v => v === normClient);
      });
      // Newest period first
      recs.sort((a, b) => String(b.payment_period || '').localeCompare(String(a.payment_period || '')));
      setClientRecords(recs);
    } catch(e) { console.error(e); }
    finally { setClientLoading(false); }
  }

  async function updatePolicyStatus(row, status) {
    try {
      const rowKey = `${row.client}|${row.carrier}|${row.agent}`;
      
      await apiFetch('/bob/policy-status', {
        method: 'PUT',
        body: JSON.stringify({
          client: row.client,
          carrier: row.carrier,
          agent: row.agent,
          status: status,
          notes: null
        })
      });
      
      // Update row state immediately (before refetch)
      setRows(prevRows => prevRows.map(r => {
        if (`${r.client}|${r.carrier}|${r.agent}` === rowKey) {
          return { ...r, policyStatus: status };
        }
        return r;
      }));
      
      // Refresh the data in background for consistency
      await runCheck();
      
      if (status === 'termed') {
        showToast('✅ Marked as termed — row removed from list', 'success');
      } else if (status === 'chase') {
        showToast('✅ Marked as chasing — will stay on list with badge', 'success');
      } else if (status === 'pending') {
        showToast('✅ Marked as pending — will stay on list with gray badge', 'success');
      }
    } catch (err) {
      showToast(`Error: ${err.message}`, 'error');
    }
  }

  function exportReport() {
    const headers = ['Agent','Carrier','Payment Period','Client','Effective Date','Commission','Status','Months Missing'];
    const data = sorted.map(r => [
      r.agent, r.carrier, formatPeriodLabel(selectedPeriod) || selectedPeriod,
      r.client, r.effectiveDate,
      r.isMissing ? (r.lastKnownCommission > 0 ? fmt(r.lastKnownCommission) : '—') : fmt(r.commission),
      r.isHeld ? 'Held – Licensing' : r.isMissing ? 'Missing' : 'Paid',
      r.monthsMissing
    ]);
    const csv = [headers, ...data].map(r => r.map(v => `"${String(v||'').replace(/"/g,'""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `missing-renewals-${formatPeriodLabel(selectedPeriod)||selectedPeriod}-${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const agents = [...new Set(rows.map(r => r.agent).filter(Boolean))].sort();
  const carriers = [...new Set(rows.map(r => r.carrier).filter(Boolean))].sort();
  const lobs = [...new Set(rows.map(r => r.lob).filter(Boolean))].sort();

  const filtered = rows.filter(r => {
    const rowKey = `${r.client}|${r.carrier}|${r.agent}`;
    return (
      (!showMissingOnly || r.isMissing) &&
      (!filterAgent || r.agent === filterAgent) &&
      (!filterCarrier || r.carrier === filterCarrier) &&
      (!filterLOB || r.lob === filterLOB) &&
      (!filterClient || r.client.toLowerCase().includes(filterClient.toLowerCase())) &&
      !grayedRows.has(rowKey) &&
      r.policyStatus !== 'plan_change' &&
      r.policyStatus !== 'ignore' &&
      r.policyStatus !== 'termed'
    );
  });

  // Sort filtered results
  function handleSort(col) {
    if (sortCol === col) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortCol(col);
      setSortDir('asc');
    }
  }

  const sorted = [...filtered].sort((a, b) => {
    let aVal, bVal;
    
    switch(sortCol) {
      case 'agent':
        aVal = (a.agent || '').toLowerCase();
        bVal = (b.agent || '').toLowerCase();
        break;
      case 'carrier':
        aVal = (a.carrier || '').toLowerCase();
        bVal = (b.carrier || '').toLowerCase();
        break;
      case 'client':
        aVal = (a.client || '').toLowerCase();
        bVal = (b.client || '').toLowerCase();
        break;
      case 'effectiveDate':
        aVal = a.effectiveDate || '';
        bVal = b.effectiveDate || '';
        break;
      case 'lastPaidPeriod':
        aVal = a.lastPaidPeriod || '';
        bVal = b.lastPaidPeriod || '';
        break;
      case 'commission':
        aVal = a.commission || 0;
        bVal = b.commission || 0;
        break;
      case 'isMissing':
        aVal = a.isMissing ? 1 : 0;
        bVal = b.isMissing ? 1 : 0;
        break;
      case 'monthsMissing':
        aVal = a.monthsMissing || 0;
        bVal = b.monthsMissing || 0;
        break;
      default:
        return 0;
    }
    
    if (typeof aVal === 'number' && typeof bVal === 'number') {
      return sortDir === 'asc' ? aVal - bVal : bVal - aVal;
    }
    
    const cmp = String(aVal).localeCompare(String(bVal));
    return sortDir === 'asc' ? cmp : -cmp;
  });

  const filteredMissing = filtered.filter(r => r.isMissing && !r.isHeld).length;
  const filteredHeld    = filtered.filter(r => r.isHeld).length;
  const filteredPaid    = filtered.filter(r => !r.isMissing).length;
  const totalCommission = filtered.filter(r => !r.isMissing).reduce((s,r) => s + r.commission, 0);
  const periodLabel = formatPeriodLabel(selectedPeriod) || selectedPeriod;

  return (
    <div>
      {selectedClient && (
        <div style={{ position:'fixed',top:0,left:0,right:0,bottom:0,background:'rgba(0,0,0,0.5)',zIndex:1000,display:'flex',alignItems:'center',justifyContent:'center',padding:20 }}>
          <div style={{ background:'#ffffff',borderRadius:12,width:'90%',maxWidth:700,maxHeight:'80vh',display:'flex',flexDirection:'column',boxShadow:'0 8px 40px rgba(0,0,0,0.2)' }}>
            <div style={{ padding:'14px 20px',borderBottom:'1px solid var(--border)',display:'flex',alignItems:'center',justifyContent:'space-between' }}>
              <div>
                <div style={{ fontWeight:500,fontSize:15 }}>{selectedClient.client}</div>
                <div style={{ fontSize:12,color:'var(--text-muted)',marginTop:2 }}>
                  {selectedClient.carrier} · {selectedClient.agent} · Effective {selectedClient.effectiveDate}
                  {selectedClient.isHeld && <span style={{ marginLeft:8,background:'#E8E8E8',color:'#444',borderRadius:4,padding:'1px 6px',fontSize:11,fontWeight:500 }}>🔒 Held – Licensing</span>}
                  {selectedClient.isMissing && !selectedClient.isHeld && <span style={{ marginLeft:8,background:'#FFF4D6',color:'#856404',borderRadius:4,padding:'1px 6px',fontSize:11,fontWeight:500 }}>Missing</span>}
                </div>
              </div>
              <button onClick={() => setSelectedClient(null)} style={{ background:'none',border:'none',fontSize:20,cursor:'pointer',color:'var(--text-muted)' }}>✕</button>
            </div>
            <div style={{ overflowY:'auto',flex:1 }}>
              {clientLoading ? (
                <div style={{ padding:40,textAlign:'center',color:'var(--text-muted)' }}>Loading payment history...</div>
              ) : clientRecords.length === 0 ? (
                <div style={{ padding:40,textAlign:'center' }}>
                  <div style={{ fontSize:24,marginBottom:8 }}>📋</div>
                  <div style={{ fontWeight:500 }}>No commission records found</div>
                  <div style={{ fontSize:12,color:'var(--text-muted)',marginTop:4 }}>No payment history in uploaded statements</div>
                </div>
              ) : (
                <table style={{ width:'100%',borderCollapse:'collapse',fontSize:12 }}>
                  <thead style={{ position:'sticky',top:0,background:'var(--bg-subtle)' }}>
                    <tr>
                      {['Period','Carrier','Commission','Type'].map(h => (
                        <th key={h} style={{ padding:'8px 14px',textAlign:'left',fontWeight:500,fontSize:11,color:'var(--text-muted)',borderBottom:'1px solid var(--border)' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {clientRecords.map((r,i) => (
                      <tr key={i} style={{ borderBottom:'1px solid var(--border)' }}>
                        <td style={{ padding:'8px 14px' }}>{r.payment_period||'—'}</td>
                        <td style={{ padding:'8px 14px',color:'var(--text-muted)' }}>{r.carrier}</td>
                        <td style={{ padding:'8px 14px',fontWeight:500,color:parseFloat(r.commission)<0?'var(--red)':'var(--green)' }}>{fmt(r.commission)}</td>
                        <td style={{ padding:'8px 14px',color:'var(--text-muted)' }}>{r.classification}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="page-header">
        <div className="page-title">Missing Renewals</div>
        <div className="page-sub">Yahoska &amp; Katy BOB vs statement month — unpaid renewals, held licensing, chase / term actions</div>
      </div>
      <div className="page-body">

        {loadError && (
          <div style={{ background:'#FEF2F2', border:'1px solid #FECACA', color:'#991B1B', padding:'10px 14px', borderRadius:8, marginBottom:12, fontSize:13 }}>
            {loadError}
          </div>
        )}

        <div style={{ display:'flex',alignItems:'flex-end',gap:10,flexWrap:'wrap',marginBottom:14,background:'var(--bg)',padding:'12px 14px',borderRadius:8,border:'0.5px solid var(--border)' }}>
          <div>
            <div className="form-label" style={{ marginBottom:4 }}>Statement month</div>
            <select className="filter-select" value={selectedPeriod} onChange={e => { setSelectedPeriod(e.target.value); setRows([]); setCheckMeta(null); }} style={{ minWidth:160,fontSize:13 }}>
              <option value="">Select month...</option>
              {periods.map(p => {
                const value = p.period || p;
                const label = p.label || formatPeriodLabel(value);
                if (!label) return null;
                const countLabel = p.recordCount != null ? ` · ${p.recordCount} rows` : '';
                const stub = p.viable === false ? ' (stub)' : '';
                return <option key={value} value={value}>{label}{countLabel}{stub}</option>;
              })}
            </select>
          </div>
          <button className="btn btn-primary" onClick={runCheck} disabled={loading||!selectedPeriod} style={{ padding:'8px 20px',fontSize:13 }}>
            {loading ? '⏳ Checking...' : '🔍 Run check'}
          </button>
          {rows.length > 0 && (
            <>
              <div style={{ display:'flex',alignItems:'center',gap:6,marginLeft:8 }}>
                <input type="checkbox" id="missingOnly" checked={showMissingOnly} onChange={e => setShowMissingOnly(e.target.checked)} style={{ cursor:'pointer',width:14,height:14,accentColor:'var(--accent)' }} />
                <label htmlFor="missingOnly" style={{ fontSize:13,cursor:'pointer',fontWeight:showMissingOnly?500:400,color:showMissingOnly?'var(--red)':'var(--text)' }}>Show only missing</label>
              </div>
              <select className="filter-select" value={filterLOB} onChange={e => setFilterLOB(e.target.value)}>
                <option value="">All LOB</option>
                {lobs.map(l => <option key={l} value={l}>{l}</option>)}
              </select>
              <select className="filter-select" value={filterAgent} onChange={e => setFilterAgent(e.target.value)}>
                <option value="">All agents</option>
                {agents.map(a => <option key={a} value={a}>{a}</option>)}
              </select>
              <select className="filter-select" value={filterCarrier} onChange={e => setFilterCarrier(e.target.value)}>
                <option value="">All carriers</option>
                {carriers.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <input 
                type="text" 
                placeholder="Search client name..." 
                value={filterClient} 
                onChange={e => setFilterClient(e.target.value)}
                style={{
                  padding: '6px 10px',
                  fontSize: 12,
                  border: '0.5px solid var(--border)',
                  borderRadius: 6,
                  background: 'var(--bg)',
                  color: 'var(--text)',
                  width: 180
                }}
              />
              <button onClick={exportReport} style={{ marginLeft:'auto',background:'none',border:'0.5px solid var(--border)',borderRadius:6,padding:'7px 14px',fontSize:12,cursor:'pointer',color:'var(--text)' }}>
                ↓ Download
              </button>
            </>
          )}
        </div>

        {rows.length > 0 && (
          <>
            {checkMeta?.sparsePeriod && (
              <div style={{
                background: '#FEF2F2',
                border: '0.5px solid #FECACA',
                borderRadius: 8,
                padding: '12px 16px',
                marginBottom: 12,
                fontSize: 13,
                color: '#991B1B'
              }}>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>
                  This month only has {checkMeta.periodRecordCount} commission row{checkMeta.periodRecordCount === 1 ? '' : 's'} — not a real statement month
                </div>
                <div style={{ fontSize: 12, opacity: 0.9 }}>
                  Pick a month with at least {checkMeta.minStatementRecords || 50} uploaded rows (e.g. Jul 2026). Stub months make every renewal look Missing.
                </div>
              </div>
            )}

            {/* Statement Coverage Warning/Confirmation */}
            {coverageWarning && showCoverageWarning && (
              <div style={{
                background: coverageWarning.missingStatements.length > 0 ? '#FFF9E6' : '#EAF3DE',
                border: coverageWarning.missingStatements.length > 0 ? '0.5px solid #F5C842' : '0.5px solid #C0DD97',
                borderRadius: 8,
                padding: '12px 16px',
                marginBottom: 12,
                fontSize: 13,
                color: coverageWarning.missingStatements.length > 0 ? '#A16207' : '#3B6D11',
                display: 'flex',
                alignItems: 'flex-start',
                gap: 12
              }}>
                <div style={{ flex: 1 }}>
                  {coverageWarning.missingStatements.length > 0 ? (
                    <>
                      <div style={{ fontWeight: 600, marginBottom: 4 }}>
                        ⚠️ Missing statements for {formatPeriodLabel(selectedPeriod)} — upload before chasing payments:
                      </div>
                      <div style={{ marginBottom: 8 }}>
                        {coverageWarning.missingStatements.join(' · ')}
                      </div>
                      <div style={{ fontSize: 12, color: '#A16207', opacity: 0.8 }}>
                        These carriers have active clients in your BOB but no commission records uploaded for this month. Upload their statements first.
                      </div>
                    </>
                  ) : (
                    <div style={{ fontWeight: 500 }}>
                      ✅ All carrier statements uploaded for {formatPeriodLabel(selectedPeriod)} — Missing records are genuine unpaid commissions.
                    </div>
                  )}
                </div>
                <button
                  onClick={() => setShowCoverageWarning(false)}
                  style={{
                    background: 'none',
                    border: 'none',
                    fontSize: 18,
                    cursor: 'pointer',
                    color: coverageWarning.missingStatements.length > 0 ? '#A16207' : '#3B6D11',
                    padding: 0,
                    lineHeight: 1,
                    opacity: 0.6,
                    flexShrink: 0
                  }}
                  title="Dismiss"
                >
                  ×
                </button>
              </div>
            )}

            <div style={{ display:'flex',gap:6,alignItems:'center',marginBottom:10,fontSize:13,flexWrap:'wrap' }}>
              <span style={{ color:'var(--text-muted)' }}>Total rows: <strong>{filtered.length}</strong></span>
              <span style={{ color:'var(--text-muted)',margin:'0 4px' }}>|</span>
              <span style={{ color:'var(--red)',fontWeight:500 }}>Missing: {filteredMissing}</span>
              {filteredHeld > 0 && <>
                <span style={{ color:'var(--text-muted)',margin:'0 4px' }}>|</span>
                <span style={{ color:'#555',fontWeight:500 }}>🔒 Held – Licensing: {filteredHeld}</span>
              </>}
              <span style={{ color:'var(--text-muted)',margin:'0 4px' }}>|</span>
              <span style={{ color:'var(--green)',fontWeight:500 }}>Paid: {filteredPaid}</span>
              <span style={{ color:'var(--text-muted)',margin:'0 4px' }}>|</span>
              <span>Commission: <strong style={{ color:'var(--green)' }}>{fmt(totalCommission)}</strong></span>
              <span style={{ fontSize:12,color:'var(--text-muted)',marginLeft:8 }}>— {periodLabel}</span>
            </div>

            <div className="card" style={{ padding:0 }}>
              <div style={{ overflowX:'auto', overflowY:'auto', maxHeight:'calc(100vh - 280px)' }}>
                <table>
                  <thead style={{ position:'sticky', top:0, background:'var(--bg)', zIndex:1 }}>
                    <tr>
                      <th style={{ width:8 }}></th>
                      <th>#</th>
                      <th onClick={() => handleSort('agent')} style={{ cursor:'pointer', userSelect:'none' }}>
                        Agent {sortCol === 'agent' ? (sortDir === 'asc' ? '↑' : '↓') : <span style={{opacity:0.3}}>↕</span>}
                      </th>
                      <th onClick={() => handleSort('carrier')} style={{ cursor:'pointer', userSelect:'none' }}>
                        Carrier {sortCol === 'carrier' ? (sortDir === 'asc' ? '↑' : '↓') : <span style={{opacity:0.3}}>↕</span>}
                      </th>
                      <th onClick={() => handleSort('client')} style={{ cursor:'pointer', userSelect:'none' }}>
                        Client {sortCol === 'client' ? (sortDir === 'asc' ? '↑' : '↓') : <span style={{opacity:0.3}}>↕</span>}
                      </th>
                      <th onClick={() => handleSort('effectiveDate')} style={{ cursor:'pointer', userSelect:'none' }}>
                        Effective date {sortCol === 'effectiveDate' ? (sortDir === 'asc' ? '↑' : '↓') : <span style={{opacity:0.3}}>↕</span>}
                      </th>
                      <th onClick={() => handleSort('lastPaidPeriod')} style={{ cursor:'pointer', userSelect:'none' }}>
                        Last Paid {sortCol === 'lastPaidPeriod' ? (sortDir === 'asc' ? '↑' : '↓') : <span style={{opacity:0.3}}>↕</span>}
                      </th>
                      <th onClick={() => handleSort('commission')} style={{ cursor:'pointer', userSelect:'none' }}>
                        Commission {sortCol === 'commission' ? (sortDir === 'asc' ? '↑' : '↓') : <span style={{opacity:0.3}}>↕</span>}
                      </th>
                      <th onClick={() => handleSort('isMissing')} style={{ cursor:'pointer', userSelect:'none' }}>
                        Status {sortCol === 'isMissing' ? (sortDir === 'asc' ? '↑' : '↓') : <span style={{opacity:0.3}}>↕</span>}
                      </th>
                      <th onClick={() => handleSort('monthsMissing')} style={{ cursor:'pointer', userSelect:'none' }}>
                        Months missing {sortCol === 'monthsMissing' ? (sortDir === 'asc' ? '↑' : '↓') : <span style={{opacity:0.3}}>↕</span>}
                      </th>
                      <th style={{ width:140 }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.map((r, i) => {
                      const rowKey = `${r.client}|${r.carrier}|${r.agent}`;
                      const showingDatePicker = termedDatePicker && termedDatePicker.rowKey === rowKey;
                      return (<>
                      <tr key={i} style={{ 
                        background: r.isMissing ? '#FFF9E6' : 'transparent',
                        opacity: grayedRows.has(rowKey) ? 0.4 : 1,
                        transition: 'opacity 0.3s ease'
                      }}>
                        <td style={{ padding:'4px 6px' }}>
                          {(r.isMissing || r.isHeld) && <span style={{ display:'block',width:3,height:'100%',background:r.isHeld?'#aaa':'var(--amber)',borderRadius:2 }}></span>}
                        </td>
                        <td style={{ color:'var(--text-muted)',fontSize:11 }}>{i+1}</td>
                        <td style={{ fontWeight:400 }}>{r.agent}</td>
                        <td style={{ fontSize:12 }}>{r.carrier}</td>
                        <td>
                          <button onClick={() => openClient(r)} style={{ background:'none',border:'none',cursor:'pointer',color:'var(--accent-dark)',fontWeight:500,padding:0,textDecoration:'underline',fontSize:12,textAlign:'left' }}>
                            {r.client}
                          </button>
                        </td>
                        <td style={{ fontSize:12,color:'var(--text-muted)' }}>{prettifyDate(r.effectiveDate)||'—'}</td>
                        <td style={{ fontSize:12,color:'var(--text-muted)' }}>
                          <div>{r.lastPaidPeriod ? formatPeriodLabel(r.lastPaidPeriod) : '—'}</div>
                          {(() => {
                            const owedMonths = calculateOwedMonths(r.lastPaidPeriod, r.termedDate);
                            if (owedMonths > 0) {
                              return (
                                <div style={{
                                  fontSize: 11,
                                  color: '#F97316',
                                  fontWeight: 500,
                                  marginTop: 4,
                                  fontStyle: 'italic'
                                }}>
                                  ⚠️ May be owed {owedMonths} payment{owedMonths > 1 ? 's' : ''} before term
                                </div>
                              );
                            }
                            return null;
                          })()}
                        </td>
                        <td style={{ fontWeight:500,color:r.isMissing?'var(--text-muted)':'var(--green)' }}>
                          {r.isMissing ? (r.lastKnownCommission > 0 ? fmt(r.lastKnownCommission) : '—') : fmt(r.commission)}
                        </td>
                        <td>
                          {r.policyStatus === 'chase' && (
                            <span className="badge badge-amber" data-status-key={rowKey}>🔍 Chasing</span>
                          )}
                          {r.policyStatus === 'plan_change' && (
                            <span className="badge badge-purple" data-status-key={rowKey}>🔄 Plan Change</span>
                          )}
                          {r.policyStatus === 'pending' && (
                            <span className="badge badge-gray" data-status-key={rowKey}>⏳ Pending</span>
                          )}
                          {(!r.policyStatus || r.policyStatus === 'active') && (
                            r.isHeld
                              ? <span className="badge" style={{ background:'#E8E8E8',color:'#444' }} data-status-key={rowKey}>🔒 Held – Licensing</span>
                              : r.isMissing
                                ? <span className="badge badge-amber" data-status-key={rowKey}>Missing</span>
                                : <span className="badge badge-green" data-status-key={rowKey}>Paid</span>
                          )}
                        </td>
                        <td style={{ fontSize:12,color:'var(--text-muted)' }}>
                          {!r.lastPaidPeriod
                            ? <span className="badge badge-blue">New</span>
                            : <span style={{ color: r.monthsMissing > 0 ? 'var(--red)' : 'var(--text-muted)', fontWeight: r.monthsMissing > 0 ? 500 : 400 }}>
                                {r.monthsMissing} mo
                              </span>
                          }
                        </td>
                        <td style={{ fontSize:11 }}>
                          {r.isMissing && !r.isHeld && (!r.policyStatus || r.policyStatus === 'active' || r.policyStatus === 'chase') && (
                            <select
                              onChange={async (e) => {
                                const action = e.target.value;
                                if (!action) return;
                                e.target.value = ''; // Reset dropdown immediately
                                
                                const rowKey = `${r.client}|${r.carrier}|${r.agent}`;
                                
                                if (action === 'termed') {
                                  // Show date picker inline
                                  const today = new Date().toISOString().split('T')[0];
                                  setTermedDatePicker({ rowKey, clientName: r.client, date: today, row: r });
                                } else if (action === 'chase') {
                                  // Chase saves immediately (no undo needed)
                                  await updatePolicyStatus(r, 'chase');
                                } else if (action === 'ignore') {
                                  // Ignore saves to database (permanent)
                                  await updatePolicyStatus(r, 'ignore');
                                } else if (action === 'clear') {
                                  await updatePolicyStatus(r, 'active');
                                } else if (action === 'plan_change') {
                                  await updatePolicyStatus(r, 'plan_change');
                                }
                              }}
                              style={{
                                padding: '4px 8px',
                                fontSize: 11,
                                border: '1px solid var(--border)',
                                borderRadius: 4,
                                background: 'var(--bg)',
                                color: 'var(--text)',
                                cursor: 'pointer',
                                fontWeight: 500
                              }}
                            >
                              <option value="">Update Status</option>
                              <option value="termed">🔴 Termed</option>
                              <option value="chase">🟠 Chase Payment</option>
                              <option value="plan_change">🔄 Plan Change</option>
                              <option value="ignore">⚫ Ignore (hide permanently)</option>
                              {r.policyStatus === 'chase' && (
                                <option value="clear">✅ Clear Chase</option>
                              )}
                            </select>
                          )}
                        </td>
                      </tr>
                        {showingDatePicker && (
                          <tr key={`${i}-date-picker`}>
                            <td colSpan="11" style={{ padding: '12px 16px', background: '#FFF3CD', borderLeft: '3px solid #FFC107' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                <strong style={{ fontSize: 13, color: '#856404' }}>
                                  {termedDatePicker.clientName} — When did they term?
                                </strong>
                                <input
                                  type="date"
                                  value={termedDatePicker.date}
                                  onChange={e => setTermedDatePicker({ ...termedDatePicker, date: e.target.value })}
                                  style={{
                                    padding: '6px 10px',
                                    fontSize: 13,
                                    border: '1px solid #FFC107',
                                    borderRadius: 4,
                                    background: 'white'
                                  }}
                                />
                                <button
                                  onClick={async () => {
                                    const { date, row } = termedDatePicker;
                                    let undone = false;
                                    
                                    // Gray out row and hide date picker
                                    setGrayedRows(prev => new Set([...prev, rowKey]));
                                    setTermedDatePicker(null);
                                    
                                    // Show countdown toast with undo
                                    showCountdownToast(
                                      `${row.client} marked as Termed`,
                                      10,
                                      () => {
                                        // Undo clicked
                                        undone = true;
                                        setGrayedRows(prev => {
                                          const newSet = new Set(prev);
                                          newSet.delete(rowKey);
                                          return newSet;
                                        });
                                        showToast('Undo successful', 'success');
                                      }
                                    );
                                    
                                    // After 10 seconds, save if not undone
                                    setTimeout(async () => {
                                      if (!undone) {
                                        await apiFetch('/bob/policy-status', {
                                          method: 'PUT',
                                          body: JSON.stringify({
                                            client: row.client,
                                            carrier: row.carrier,
                                            agent: row.agent,
                                            status: 'termed',
                                            termedDate: date,
                                            notes: null
                                          })
                                        });
                                        await runCheck(); // Refresh data
                                      }
                                    }, 10000);
                                  }}
                                  style={{
                                    padding: '6px 12px',
                                    fontSize: 12,
                                    fontWeight: 600,
                                    background: '#28A745',
                                    color: 'white',
                                    border: 'none',
                                    borderRadius: 4,
                                    cursor: 'pointer'
                                  }}
                                >
                                  Confirm Termed
                                </button>
                                <button
                                  onClick={() => setTermedDatePicker(null)}
                                  style={{
                                    padding: '6px 12px',
                                    fontSize: 12,
                                    fontWeight: 600,
                                    background: '#6C757D',
                                    color: 'white',
                                    border: 'none',
                                    borderRadius: 4,
                                    cursor: 'pointer'
                                  }}
                                >
                                  Cancel
                                </button>
                              </div>
                            </td>
                          </tr>
                        )}
                      </>);
                    })}
                  </tbody>
                  <tfoot>
                    <tr style={{ background:'var(--bg-subtle)',fontWeight:500 }}>
                      <td colSpan={7} style={{ padding:'8px 12px',fontSize:12 }}>Total ({filtered.filter(r=>!r.isMissing).length} paid)</td>
                      <td style={{ padding:'8px 12px',fontSize:12,color:'var(--green)' }}>{fmt(totalCommission)}</td>
                      <td colSpan={3}></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          </>
        )}

        {!rows.length && !loading && (
          <div className="card">
            <div className="empty-state">
              <div className="empty-icon">🔍</div>
              <div className="empty-title">Select a month and run the check</div>
              <div className="empty-sub">Shows all BOB clients for that month — toggle "Show only missing" to filter to unpaid renewals</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
