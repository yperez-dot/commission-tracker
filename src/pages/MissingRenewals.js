import React, { useState, useEffect } from 'react';
import { apiFetch } from '../api';

function fmt(n) {
  return '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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

export default function MissingRenewals({ user }) {
  const [periods, setPeriods] = useState([]);
  const [selectedPeriod, setSelectedPeriod] = useState('');
  const [loading, setLoading] = useState(false);
  const [checked, setChecked] = useState(false);
  const [selectedClient, setSelectedClient] = useState(null);
  const [clientRecords, setClientRecords] = useState([]);
  const [clientLoading, setClientLoading] = useState(false);
  const [results, setResults] = useState({ missing: [], found: [], checkedClients: 0, matchedRecords: 0 });
  const [filterCarrier, setFilterCarrier] = useState('');
  const [filterAgent, setFilterAgent] = useState('');
  const [tab, setTab] = useState('missing');

  useEffect(() => {
    apiFetch('/records/filters').then(d => {
      const valid = (d.periods || []).filter(p => {
        if (!p || p === 'Unknown') return false;
        const s = String(p);
        return s.match(/^\d{6}$/) || s.match(/^\d{2}\/\d{4}$/) || s.match(/^\d{2}\/\d{2}\/\d{4}$/);
      });
      // Deduplicate by normalized label
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
    setChecked(false);
    try {
      // Get all active BOB clients
      const bobData = await apiFetch('/bob?status=active');
      const bobClients = bobData || [];

      // Get all commission records for selected period
      const recData = await apiFetch(`/records?periods=${encodeURIComponent(selectedPeriod)}&limit=2000`);
      const records = recData.records || [];

      // Also try normalizing — match by YYYYMM
      function normPeriod(p) {
        if (!p) return null;
        const s = String(p).trim();
        if (s.match(/^\d{6}$/)) return s;
        const mm = s.match(/^(\d{1,2})\/(?:\d{2}\/)?(\d{4})$/);
        if (mm) return mm[2] + mm[1].padStart(2,'0');
        return null;
      }
      const targetNorm = normPeriod(selectedPeriod);
      const allRecData = await apiFetch(`/records?limit=5000`);
      const allRecs = (allRecData.records || []).filter(r => {
        if (!r.payment_period) return false;
        // Direct match
        if (r.payment_period === selectedPeriod) return true;
        // Normalized YYYYMM match
        const n = normPeriod(r.payment_period);
        if (n && targetNorm && n === targetNorm) return true;
        // Match on MM/YYYY or MM/DD/YYYY
        const recNorm = (() => {
          const s = String(r.payment_period).trim();
          const m1 = s.match(/^(\d{1,2})\/(\d{4})$/);
          if (m1) return m1[2] + m1[1].padStart(2,'0');
          const m2 = s.match(/^(\d{1,2})\/\d{2}\/(\d{4})$/);
          if (m2) return m2[2] + m2[1].padStart(2,'0');
          return null;
        })();
        return recNorm && targetNorm && recNorm === targetNorm;
      });

      // Normalize name: handle both "FIRST LAST" and "LAST, FIRST" formats
      function normalizeName(name) {
        if (!name) return '';
        const s = String(name).toLowerCase().trim();
        // If has comma, it's "Last, First" — convert to "first last"
        if (s.includes(',')) {
          const [last, first] = s.split(',').map(p => p.trim());
          return `${first} ${last}`.replace(/\s+/g, ' ').trim();
        }
        return s.replace(/\s+/g, ' ').trim();
      }

      function normalizeCarrier(c) {
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
        return s;
      }

      // Build set of paid clients using normalized names
      const paidSet = new Set(allRecs.map(r =>
        `${normalizeName(r.client_full_name)}|${normalizeCarrier(r.carrier)}`
      ));

      // Also build a set with just last name + carrier for fuzzy matching
      const paidLastNameSet = new Set(allRecs.map(r => {
        const name = normalizeName(r.client_full_name);
        const lastName = name.split(' ').pop();
        return `${lastName}|${normalizeCarrier(r.carrier)}`;
      }));

      // Parse the selected period into a date for comparison
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
          const [m, day, y] = s.split('/');
          return new Date(parseInt(y), parseInt(m)-1, 1);
        }
        if (s.match(/^\d{4}-\d{2}-\d{2}/)) {
          const [y, m] = s.split('-');
          return new Date(parseInt(y), parseInt(m)-1, 1);
        }
        return null;
      }

      const checkDate = periodToDate(selectedPeriod);
      // Carriers where we have per-client commission data
      // Humana only sends summary totals, not per-client — can't match
      const CHECKABLE_CARRIERS = ['unitedhealthcare', 'uhc', 'aetna', 'devoted', 'cigna', 'oscar health', 'florida blue', 'gold kidney', 'simply', 'molina', 'wellcare'];
      const missing = [];
      const found = [];
      const newEnrollments = [];
      const noData = []; // carriers we can't check

      for (const client of bobClients) {
        const normName = normalizeName(client.client_full_name);
        const normCarrier = normalizeCarrier(client.carrier);
        const key = `${normName}|${normCarrier}`;
        const lastName = normName.split(' ').pop();
        const lastKey = `${lastName}|${normCarrier}`;

        // Skip carriers where we don't have per-client commission data
        if (!CHECKABLE_CARRIERS.includes(normCarrier)) {
          noData.push(client);
          continue;
        }

        // Skip clients enrolled in the same year as the check period
        // Medicare renewals don't pay until the year AFTER enrollment
        const effDate = parseEffDate(client.effective_date);
        const checkYear = checkDate ? checkDate.getFullYear() : null;
        const effYear = effDate ? effDate.getFullYear() : null;
        if (checkYear && effYear && effYear >= checkYear) {
          newEnrollments.push(client);
          continue;
        }

        if (paidSet.has(key) || paidLastNameSet.has(lastKey)) {
          found.push(client);
        } else {
          missing.push(client);
        }
      }

      setResults({
        missing,
        found,
        newEnrollments,
        noData,
        checkedClients: bobClients.length,
        matchedRecords: allRecs.length
      });
      setChecked(true);
      setTab('missing');
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  async function openClient(client) {
    setSelectedClient(client);
    setClientLoading(true);
    setClientRecords([]);
    try {
      const name = encodeURIComponent(client.client_full_name);
      const data = await apiFetch(`/records?limit=50&agents=${encodeURIComponent(client.agent_name || '')}`);
      const recs = (data.records || []).filter(r =>
        r.client_full_name?.toLowerCase().includes(client.client_full_name?.toLowerCase().split(' ').pop() || '') &&
        r.carrier?.toLowerCase() === client.carrier?.toLowerCase()
      );
      setClientRecords(recs);
    } catch(e) { console.error(e); }
    finally { setClientLoading(false); }
  }

  const carriers = [...new Set([...results.missing, ...results.found].map(c => c.carrier).filter(Boolean))];
  const agents = [...new Set([...results.missing, ...results.found].map(c => c.agent_name).filter(Boolean))];

  const filteredMissing = results.missing.filter(c =>
    (!filterCarrier || c.carrier === filterCarrier) &&
    (!filterAgent || c.agent_name === filterAgent)
  );
  const filteredFound = results.found.filter(c =>
    (!filterCarrier || c.carrier === filterCarrier) &&
    (!filterAgent || c.agent_name === filterAgent)
  );

  const atRisk = filteredMissing.reduce((s, c) => s + (parseFloat(c.last_commission_amount) || 0), 0);
  const periodLabel = formatPeriodLabel(selectedPeriod) || selectedPeriod;

  const tabStyle = (id) => ({
    padding: '7px 14px', border: 'none', background: 'none', fontSize: 13, cursor: 'pointer',
    borderBottom: tab === id ? '2px solid var(--blue)' : '2px solid transparent',
    color: tab === id ? 'var(--blue)' : 'var(--text-muted)',
    fontWeight: tab === id ? 600 : 400, marginBottom: -1
  });

  return (
    <div>
      {/* Client detail modal */}
      {selectedClient && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ background: '#ffffff', borderRadius: 12, width: '90%', maxWidth: 700, maxHeight: '80vh', display: 'flex', flexDirection: 'column', boxShadow: '0 8px 40px rgba(0,0,0,0.25)' }}>
            <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 15 }}>{selectedClient.client_full_name}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{selectedClient.carrier} · {selectedClient.agent_name} · Effective {selectedClient.effective_date}</div>
              </div>
              <button onClick={() => setSelectedClient(null)} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--text-muted)' }}>✕</button>
            </div>
            <div style={{ overflowY: 'auto', flex: 1 }}>
              {clientLoading ? (
                <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>Loading payment history...</div>
              ) : clientRecords.length === 0 ? (
                <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
                  <div style={{ fontSize: 24, marginBottom: 8 }}>📋</div>
                  <div style={{ fontWeight: 600 }}>No commission records found</div>
                  <div style={{ fontSize: 12, marginTop: 4 }}>This client has no payment history in your uploaded statements</div>
                </div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead style={{ position: 'sticky', top: 0, background: '#f8f9fa' }}>
                    <tr>
                      {['Period','Carrier','Commission','Type'].map(h => (
                        <th key={h} style={{ padding: '8px 14px', textAlign: 'left', fontWeight: 600, fontSize: 11, color: 'var(--text-muted)', borderBottom: '1px solid var(--border)' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {clientRecords.map((r, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={{ padding: '8px 14px' }}>{r.payment_period || '—'}</td>
                        <td style={{ padding: '8px 14px', color: 'var(--text-muted)' }}>{r.carrier}</td>
                        <td style={{ padding: '8px 14px', fontWeight: 600, color: parseFloat(r.commission) < 0 ? '#E24B4A' : '#1D9E75' }}>${parseFloat(r.commission||0).toFixed(2)}</td>
                        <td style={{ padding: '8px 14px', color: 'var(--text-muted)' }}>{r.classification}</td>
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

        {/* Check panel */}
        <div className="card" style={{ marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap' }}>
            <div>
              <div className="form-label" style={{ marginBottom: 6, fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                Statement month
              </div>
              <select
                className="filter-select"
                value={selectedPeriod}
                onChange={e => { setSelectedPeriod(e.target.value); setChecked(false); }}
                style={{ minWidth: 160, fontSize: 13 }}
              >
                <option value="">Select month...</option>
                {periods.map(p => {
                  const label = formatPeriodLabel(p);
                  return label ? <option key={p} value={p}>{label}</option> : null;
                })}
              </select>
            </div>
            <button
              className="btn btn-primary"
              onClick={runCheck}
              disabled={loading || !selectedPeriod}
              style={{ padding: '8px 20px', fontSize: 13 }}
            >
              {loading ? '⏳ Checking...' : '🔍 Run check'}
            </button>
            {checked && (
              <div style={{ fontSize: 12, color: 'var(--text-muted)', alignSelf: 'center' }}>
                Checked <strong>{results.checkedClients}</strong> BOB clients against <strong>{results.matchedRecords}</strong> statement records for <strong>{periodLabel}</strong>
              </div>
            )}
          </div>
        </div>

        {/* No BOB warning */}
        {checked && results.checkedClients === 0 && (
          <div style={{ background: '#FFF8E6', border: '1px solid #F5D78E', borderRadius: 8, padding: '12px 16px', marginBottom: 14, fontSize: 13, color: '#7A5C00' }}>
            ⚠️ Your Book of Business is empty. Go to <strong>Book of Business → Setup & tools → Upload carrier BOB export</strong> to add your clients first.
          </div>
        )}

        {checked && results.checkedClients > 0 && (
          <div>
            {/* KPI cards */}
            <div className="kpi-grid" style={{ marginBottom: 14 }}>
              <div className="kpi-card">
                <div className="kpi-label">Renewals checked</div>
                <div className="kpi-value blue">{results.checkedClients - (results.newEnrollments||[]).length}</div>
              </div>
              <div className="kpi-card">
                <div className="kpi-label">Missing this month</div>
                <div className={`kpi-value ${results.missing.length > 0 ? 'red' : 'green'}`}>{results.missing.length}</div>
              </div>
              <div className="kpi-card">
                <div className="kpi-label">Paid this month</div>
                <div className="kpi-value green">{results.found.length}</div>
              </div>
              <div className="kpi-card">
                <div className="kpi-label">New enrollments (excl.)</div>
                <div className="kpi-value">{(results.newEnrollments||[]).length}</div>
              </div>
            </div>

            {results.missing.length === 0 && (
              <div style={{ background: '#EAF3DE', border: '1px solid #C0DD97', borderRadius: 8, padding: '12px 16px', marginBottom: 14, fontSize: 13, color: '#3B6D11', fontWeight: 600 }}>
                ✓ All {results.checkedClients} BOB clients appeared in {periodLabel} statements — no missing renewals!
              </div>
            )}

            {/* Humana warning */}
            {(results.noData||[]).length > 0 && (
              <div style={{ background: '#FFF8E6', border: '1px solid #F5D78E', borderRadius: 8, padding: '10px 14px', marginBottom: 14, fontSize: 13, color: '#7A5C00', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span>⚠️ <strong>{(results.noData||[]).length} Humana clients</strong> skipped — Humana statements don't include per-client data for matching.</span>
              </div>
            )}

            {/* Export missing report */}
            {results.missing.length > 0 && (
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
                <button onClick={() => {
                  const headers = ['Client','Agent','Carrier','Effective Date','Last Commission','Months Missing'];
                  const rows = filteredMissing.map(c => [c.client_full_name, c.agent_name, c.carrier, c.effective_date, c.last_commission_amount, c.months_missing > 0 ? c.months_missing + ' months' : 'New miss']);
                  const csv = [headers,...rows].map(r => r.map(v => `"${String(v||'').replace(/"/g,'""')}"`).join(',')).join('\n');
                  const blob = new Blob([csv], {type:'text/csv'});
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href=url; a.download=`missing_renewals_${selectedPeriod}.csv`; a.click();
                  URL.revokeObjectURL(url);
                }} style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 14px', fontSize: 12, cursor: 'pointer' }}>
                  ↓ Export missing report
                </button>
              </div>
            )}

            {/* Filters */}
            {(carriers.length > 1 || agents.length > 1) && (
              <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                {carriers.length > 1 && (
                  <select className="filter-select" value={filterCarrier} onChange={e => setFilterCarrier(e.target.value)}>
                    <option value="">All carriers</option>
                    {carriers.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                )}
                {agents.length > 1 && (
                  <select className="filter-select" value={filterAgent} onChange={e => setFilterAgent(e.target.value)}>
                    <option value="">All agents</option>
                    {agents.map(a => <option key={a} value={a}>{a}</option>)}
                  </select>
                )}
              </div>
            )}

            {/* Tabs */}
            <div style={{ display: 'flex', gap: 8, borderBottom: '1px solid var(--border)', marginBottom: 0 }}>
              <button style={tabStyle('missing')} onClick={() => setTab('missing')}>
                Missing ({filteredMissing.length})
              </button>
              <button style={tabStyle('found')} onClick={() => setTab('found')}>
                Paid ({filteredFound.length})
              </button>
            </div>

            <div className="card" style={{ padding: 0 }}>
              {tab === 'missing' && (
                filteredMissing.length === 0 ? (
                  <div className="empty-state">
                    <div className="empty-icon">✅</div>
                    <div className="empty-title">No missing clients</div>
                    <div className="empty-sub">All filtered clients appeared in {periodLabel}</div>
                  </div>
                ) : (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>#</th>
                          <th>Client</th>
                          <th>Agent</th>
                          <th>Carrier</th>
                          <th>Effective date</th>
                          <th>Last commission</th>
                          <th>Months missing</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredMissing.map((c, i) => (
                          <tr key={c.id}>
                            <td style={{ color: 'var(--text-muted)', fontSize: 11 }}>{i + 1}</td>
                            <td style={{ fontWeight: 500 }}><button onClick={() => openClient(c)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#185FA5', fontWeight: 600, padding: 0, textDecoration: 'underline', fontSize: 12 }}>{c.client_full_name}</button></td>
                            <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{c.agent_name || '—'}</td>
                            <td style={{ fontSize: 12 }}>{c.carrier}</td>
                            <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{c.effective_date || '—'}</td>
                            <td style={{ fontWeight: 600, color: '#E24B4A' }}>{fmt(c.last_commission_amount)}</td>
                            <td>
                              {c.months_missing > 0
                                ? <span className={`badge ${c.months_missing >= 2 ? 'badge-red' : 'badge-amber'}`}>{c.months_missing} mo</span>
                                : <span className="badge badge-gray">New miss</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr style={{ background: 'var(--gray-50)', fontWeight: 600 }}>
                          <td colSpan={5} style={{ padding: '8px 12px', fontSize: 12 }}>Total at risk</td>
                          <td style={{ padding: '8px 12px', fontSize: 12, color: '#E24B4A' }}>{fmt(atRisk)}</td>
                          <td></td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )
              )}

              {tab === 'found' && (
                filteredFound.length === 0 ? (
                  <div className="empty-state">
                    <div className="empty-icon">📋</div>
                    <div className="empty-title">No matching clients</div>
                  </div>
                ) : (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>#</th>
                          <th>Client</th>
                          <th>Agent</th>
                          <th>Carrier</th>
                          <th>Effective date</th>
                          <th>Last commission</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredFound.map((c, i) => (
                          <tr key={c.id}>
                            <td style={{ color: 'var(--text-muted)', fontSize: 11 }}>{i + 1}</td>
                            <td style={{ fontWeight: 500 }}><button onClick={() => openClient(c)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#185FA5', fontWeight: 600, padding: 0, textDecoration: 'underline', fontSize: 12 }}>{c.client_full_name}</button></td>
                            <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{c.agent_name || '—'}</td>
                            <td style={{ fontSize: 12 }}>{c.carrier}</td>
                            <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{c.effective_date || '—'}</td>
                            <td style={{ fontWeight: 600, color: '#1D9E75' }}>{fmt(c.last_commission_amount)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )
              )}
            </div>
          </div>
        )}

        {!checked && !loading && (
          <div className="card">
            <div className="empty-state">
              <div className="empty-icon">🔍</div>
              <div className="empty-title">Select a month and run the check</div>
              <div className="empty-sub">The system will compare every client in your Book of Business against that month's commission records and flag anyone who didn't get paid.</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
