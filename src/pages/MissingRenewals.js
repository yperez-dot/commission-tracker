import React, { useState, useEffect } from 'react';
import { apiFetch } from '../api';

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

// Normalize a name to lowercase, handle "LAST, FIRST" format
function normName(name) {
  if (!name) return '';
  const s = String(name).toLowerCase().trim();
  if (s.includes(',')) {
    const parts = s.split(',').map(p => p.trim());
    return (parts[1] + ' ' + parts[0]).replace(/\s+/g, ' ').trim();
  }
  return s.replace(/\s+/g, ' ').trim();
}

// Generate name variants to handle Humana's LASTNAME FIRSTNAME format
function nameVariants(name) {
  if (!name) return [];
  const norm = normName(name);
  const parts = norm.split(' ').filter(Boolean);
  const result = [norm];

  if (parts.length >= 2) {
    // Strip single-letter middle initial from end: "hector proano alcivar p" → "hector proano alcivar"
    const noTrailingInitial = parts.filter((p, i) => !(i === parts.length - 1 && p.length === 1)).join(' ');
    if (noTrailingInitial !== norm) result.push(noTrailingInitial);

    // Reversed word order: "hector proano alcivar" → "alcivar proano hector"
    const reversed = [...parts].reverse().join(' ');
    if (!result.includes(reversed)) result.push(reversed);

    // Reversed without trailing initial
    const partsNoInitial = parts.filter((p, i) => !(i === parts.length - 1 && p.length === 1));
    const reversedNoInitial = [...partsNoInitial].reverse().join(' ');
    if (!result.includes(reversedNoInitial)) result.push(reversedNoInitial);
  }

  return result;
}

// Prettify date strings for display: handles YYYYMMDD, MM/DD/YYYY, YYYY-MM-DD, Excel serial numbers
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

function normCarrier(c) {
  const s = String(c || '').toLowerCase();
  if (s.includes('united') || s.includes('uhc')) return 'unitedhealthcare';
  if (s.includes('humana')) return 'humana';
  if (s.includes('aetna')) return 'aetna';
  if (s.includes('devoted')) return 'devoted';
  if (s.includes('cigna')) return 'cigna';
  if (s.includes('oscar')) return 'oscar health';
  if (s.includes('florida blue') || s.includes('bcbs')) return 'florida blue';
  if (s.includes('gold kidney')) return 'gold kidney';
  if (s.includes('simply')) return 'simply';
  if (s.includes('molina')) return 'molina';
  if (s.includes('solis')) return 'solis';
  return s;
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
  return null;
}

export default function MissingRenewals({ user }) {
  const [periods, setPeriods] = useState([]);
  const [selectedPeriod, setSelectedPeriod] = useState('');
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState([]);
  const [showMissingOnly, setShowMissingOnly] = useState(false);
  const [filterAgent, setFilterAgent] = useState('');
  const [filterCarrier, setFilterCarrier] = useState('');
  const [selectedClient, setSelectedClient] = useState(null);
  const [clientRecords, setClientRecords] = useState([]);
  const [clientLoading, setClientLoading] = useState(false);

  useEffect(() => {
    apiFetch('/records/filters').then(d => {
      const valid = (d.periods || []).filter(p => {
        if (!p || p === 'Unknown') return false;
        const s = String(p);
        return s.match(/^\d{6}$/) || s.match(/^\d{2}\/\d{4}$/) || s.match(/^\d{2}\/\d{2}\/\d{4}$/);
      });
      const seen = new Set();
      const deduped = valid.filter(p => {
        const label = formatPeriodLabel(p);
        if (!label || seen.has(label)) return false;
        seen.add(label);
        return true;
      });
      setPeriods(deduped);
      if (deduped.length > 0) setSelectedPeriod(deduped[0]);
    }).catch(console.error);
  }, []);

  async function runCheck() {
    if (!selectedPeriod) return;
    setLoading(true);
    setRows([]);
    try {
      const targetNorm = normPeriod(selectedPeriod);
      const checkDate = periodToDate(selectedPeriod);

      const bobData = await apiFetch('/bob?status=active');
      // Filter to only Yahoska + Katy's BOB (THEI's own production).
      // Per Yahoska 2026-05-12: 'We only check for mine and Katy's BOB.'
      // Downline producers' renewals are BSI's responsibility, not ours.
      const allBob = bobData || [];
      const bobClients = allBob.filter(c => {
        const a = String(c.agent_name || '').toLowerCase();
        return a.includes('yahoska') || a.includes('katy')
          || a.includes('perez, yahoska') || a.includes('robles, katy');
      });

      const allRecData = await apiFetch('/records?limit=5000');
      const allRecs = (allRecData.records || []).filter(r => {
        if (!r.payment_period) return false;
        if (r.payment_period === selectedPeriod) return true;
        const n = normPeriod(r.payment_period);
        return n && targetNorm && n === targetNorm;
      });

      // Build full-name lookup: "normname|carrier" → records[]
      const recMap = {};
      for (const r of allRecs) {
        const key = normName(r.client_full_name) + '|' + normCarrier(r.carrier);
        if (!recMap[key]) recMap[key] = [];
        recMap[key].push(r);
      }

      // Build last-name lookup for fuzzy fallback
      const lastNameMap = {};
      for (const r of allRecs) {
        const parts = normName(r.client_full_name).split(' ').filter(p => p.length > 1);
        if (!parts.length) continue;
        // Index by last significant word
        const lastKey = parts[parts.length - 1] + '|' + normCarrier(r.carrier);
        if (!lastNameMap[lastKey]) lastNameMap[lastKey] = [];
        lastNameMap[lastKey].push(r);
        // Also index by first significant word (handles reversed names)
        const firstKey = parts[0] + '|' + normCarrier(r.carrier);
        if (!lastNameMap[firstKey]) lastNameMap[firstKey] = [];
        lastNameMap[firstKey].push(r);
      }

      const built = [];

      for (const client of bobClients) {
        const nc = normCarrier(client.carrier);

        // Skip clients enrolled in same calendar year or later than check period
        const effDate = parseEffDate(client.effective_date);
        const checkYear = checkDate ? checkDate.getFullYear() : null;
        const effYear = effDate ? effDate.getFullYear() : null;
        if (checkYear && effYear && effYear >= checkYear) continue;

        // Try all name variants for matching
        const variants = nameVariants(client.client_full_name);
        let matchedRecs = [];

        // 1. Try exact variant match
        for (const v of variants) {
          const k = v + '|' + nc;
          if (recMap[k] && recMap[k].length) {
            matchedRecs = recMap[k];
            break;
          }
        }

        // 2. Try last-name/first-name fuzzy match
        if (!matchedRecs.length) {
          const normClient = normName(client.client_full_name);
          const clientParts = normClient.split(' ').filter(p => p.length > 1);
          for (const part of clientParts) {
            const k = part + '|' + nc;
            if (lastNameMap[k] && lastNameMap[k].length) {
              matchedRecs = lastNameMap[k];
              break;
            }
          }
        }

        const commission = matchedRecs.reduce((s, r) => s + (parseFloat(r.commission) || 0), 0);

        built.push({
          client: client.client_full_name,
          agent: client.agent_name || '—',
          carrier: client.carrier,
          effectiveDate: client.effective_date,
          commission,
          isMissing: matchedRecs.length === 0,
          monthsMissing: client.months_missing || 0,
          bobId: client.id,
          records: matchedRecs
        });
      }

      built.sort((a, b) => {
        if (a.isMissing !== b.isMissing) return a.isMissing ? -1 : 1;
        return a.agent.localeCompare(b.agent) || a.client.localeCompare(b.client);
      });

      setRows(built);
    } catch(e) { console.error(e); }
    finally { setLoading(false); }
  }

  async function openClient(row) {
    setSelectedClient(row);
    setClientLoading(true);
    setClientRecords([]);
    try {
      const data = await apiFetch(`/records?limit=200`);
      const recs = (data.records || []).filter(r => {
        const normClient = normName(row.client);
        const normRecord = normName(r.client_full_name);
        if (normCarrier(r.carrier) !== normCarrier(row.carrier)) return false;
        if (normClient === normRecord) return true;
        // Check any variant
        return nameVariants(row.client).some(v => v === normRecord) ||
               nameVariants(r.client_full_name).some(v => v === normClient);
      });
      setClientRecords(recs);
    } catch(e) { console.error(e); }
    finally { setClientLoading(false); }
  }

  function exportReport() {
    const headers = ['Agent','Carrier','Payment Period','Client','Effective Date','Commission','Status','Months Missing'];
    const data = filtered.map(r => [
      r.agent, r.carrier, formatPeriodLabel(selectedPeriod) || selectedPeriod,
      r.client, r.effectiveDate,
      r.isMissing ? '$0.00' : fmt(r.commission),
      r.isMissing ? 'Missing' : 'Paid',
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

  const filtered = rows.filter(r =>
    (!showMissingOnly || r.isMissing) &&
    (!filterAgent || r.agent === filterAgent) &&
    (!filterCarrier || r.carrier === filterCarrier)
  );

  const missingCount = rows.filter(r => r.isMissing).length;
  const paidCount = rows.filter(r => !r.isMissing).length;
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
                  {selectedClient.isMissing && <span style={{ marginLeft:8,background:'#F5EAE4',color:'#7A3D1F',borderRadius:4,padding:'1px 6px',fontSize:11,fontWeight:500 }}>Missing</span>}
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
        <div className="page-sub">Compare your Book of Business against any month's commission statements</div>
      </div>
      <div className="page-body">

        <div style={{ display:'flex',alignItems:'flex-end',gap:10,flexWrap:'wrap',marginBottom:14,background:'var(--bg)',padding:'12px 14px',borderRadius:8,border:'0.5px solid var(--border)' }}>
          <div>
            <div className="form-label" style={{ marginBottom:4 }}>Statement month</div>
            <select className="filter-select" value={selectedPeriod} onChange={e => { setSelectedPeriod(e.target.value); setRows([]); }} style={{ minWidth:160,fontSize:13 }}>
              <option value="">Select month...</option>
              {periods.map(p => {
                const label = formatPeriodLabel(p);
                return label ? <option key={p} value={p}>{label}</option> : null;
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
              <select className="filter-select" value={filterAgent} onChange={e => setFilterAgent(e.target.value)}>
                <option value="">All agents</option>
                {agents.map(a => <option key={a} value={a}>{a}</option>)}
              </select>
              <select className="filter-select" value={filterCarrier} onChange={e => setFilterCarrier(e.target.value)}>
                <option value="">All carriers</option>
                {carriers.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <button onClick={exportReport} style={{ marginLeft:'auto',background:'none',border:'0.5px solid var(--border)',borderRadius:6,padding:'7px 14px',fontSize:12,cursor:'pointer',color:'var(--text)' }}>
                ↓ Download
              </button>
            </>
          )}
        </div>

        {rows.length > 0 && (
          <>
            <div style={{ display:'flex',gap:6,alignItems:'center',marginBottom:10,fontSize:13,flexWrap:'wrap' }}>
              <span style={{ color:'var(--text-muted)' }}>Total rows: <strong>{filtered.length}</strong></span>
              <span style={{ color:'var(--text-muted)',margin:'0 4px' }}>|</span>
              <span style={{ color:'var(--red)',fontWeight:500 }}>Missing: {missingCount}</span>
              <span style={{ color:'var(--text-muted)',margin:'0 4px' }}>|</span>
              <span style={{ color:'var(--green)',fontWeight:500 }}>Paid: {paidCount}</span>
              <span style={{ color:'var(--text-muted)',margin:'0 4px' }}>|</span>
              <span>Commission: <strong style={{ color:'var(--green)' }}>{fmt(totalCommission)}</strong></span>
              <span style={{ fontSize:12,color:'var(--text-muted)',marginLeft:8 }}>— {periodLabel}</span>
            </div>

            <div className="card" style={{ padding:0 }}>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th style={{ width:8 }}></th>
                      <th>#</th>
                      <th>Agent</th>
                      <th>Carrier</th>
                      <th>Client</th>
                      <th>Effective date</th>
                      <th>Commission</th>
                      <th>Status</th>
                      <th>Months missing</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((r, i) => (
                      <tr key={i} style={{ background: r.isMissing ? '#FFF8F5' : 'transparent' }}>
                        <td style={{ padding:'4px 6px' }}>
                          {r.isMissing && <span style={{ display:'block',width:3,height:'100%',background:'var(--red)',borderRadius:2 }}></span>}
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
                        <td style={{ fontWeight:500,color:r.isMissing?'var(--text-muted)':'var(--green)' }}>
                          {r.isMissing ? '$0.00' : fmt(r.commission)}
                        </td>
                        <td>
                          {r.isMissing
                            ? <span className="badge badge-red">Missing</span>
                            : <span className="badge badge-green">Paid</span>}
                        </td>
                        <td style={{ fontSize:12,color:'var(--text-muted)' }}>
                          {r.monthsMissing > 0 ? <span style={{ color:'var(--red)',fontWeight:500 }}>{r.monthsMissing} mo</span> : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr style={{ background:'var(--bg-subtle)',fontWeight:500 }}>
                      <td colSpan={6} style={{ padding:'8px 12px',fontSize:12 }}>Total ({filtered.filter(r=>!r.isMissing).length} paid)</td>
                      <td style={{ padding:'8px 12px',fontSize:12,color:'var(--green)' }}>{fmt(totalCommission)}</td>
                      <td colSpan={2}></td>
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
