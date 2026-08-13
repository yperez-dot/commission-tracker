import React, { useState, useEffect, useMemo } from 'react';
import { apiFetch, apiDownload } from '../api';
import LOAStatements from '../components/LOAStatements';
import { formatDate } from '../utils/dateFormat';

function fmt(n) {
  return '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const YOUR_TEAM = ['yahoska perez', 'katy robles'];

function isYourTeam(name) {
  return YOUR_TEAM.some((t) => String(name || '').toLowerCase().includes(t));
}

function isAlbaName(name) {
  const n = String(name || '').toLowerCase();
  if (!n.includes('hernandez')) return false;
  return n.includes('alba') || n.includes('lina') || n.includes('ritela');
}

function albaPayrollDisplayName(name) {
  return isAlbaName(name) ? 'Lina Hernandez' : name;
}

function formatPeriodLabel(p) {
  if (!p) return p;
  const s = String(p).trim();
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  if (s.match(/^\d{6}$/)) return months[parseInt(s.slice(4, 6), 10) - 1] + ' ' + s.slice(0, 4);
  if (s.match(/^\d{2}\/\d{4}$/)) return months[parseInt(s.slice(0, 2), 10) - 1] + ' ' + s.slice(3);
  if (s.match(/^\d{2}\/\d{2}\/\d{4}$/)) return months[parseInt(s.slice(0, 2), 10) - 1] + ' ' + s.slice(6);
  return null;
}

function recordAmount(r) {
  const hasSubAgentOV = parseFloat(r.sub_agent_override || 0) !== 0;
  if (hasSubAgentOV) return parseFloat(r.sub_agent_override);
  if (r.producer_payable != null) return parseFloat(r.producer_payable) || 0;
  return parseFloat(r.commission) || 0;
}

function downloadTextFile(filename, text) {
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function chipStyle(active) {
  return {
    padding: '6px 12px',
    borderRadius: 6,
    border: active ? 'none' : '0.5px solid var(--border)',
    background: active ? 'var(--accent)' : 'transparent',
    color: active ? 'var(--sidebar-bg)' : 'var(--text)',
    fontSize: 12,
    fontWeight: 500,
    cursor: 'pointer',
  };
}

function generateStatement(agent, records, periodLabel, isBSI) {
  const filename = isBSI
    ? `BSI_Statement_${agent.replace(/\s+/g, '_')}_${periodLabel.replace(/\s+/g, '_')}.csv`
    : `THEI_Statement_${agent.replace(/\s+/g, '_')}_${periodLabel.replace(/\s+/g, '_')}.csv`;

  const fmtCsv = (n) => '$' + Number(n || 0).toFixed(2);
  const positives = records.filter((r) => recordAmount(r) >= 0);
  const negatives = records.filter((r) => recordAmount(r) < 0);
  const grossTotal = positives.reduce((s, r) => s + recordAmount(r), 0);
  const chargebackTotal = negatives.reduce((s, r) => s + recordAmount(r), 0);
  const netTotal = grossTotal + chargebackTotal;
  const headers = ['Policy #', 'Client', 'Statement', 'Lives', 'Effective Date', 'Commission', 'Type'];

  const rows = [
    [`*** AGENT: ${agent} ***`, '', '', '', '', '', ''],
    [`Period: ${periodLabel}`, '', '', '', '', '', ''],
    ['', '', '', '', '', '', ''],
    headers,
    ...positives.map((r) => [
      r.policy_number || '—',
      r.client_full_name,
      r.statement_month || r.carrier,
      r.members != null && r.members !== 0 ? r.members : '',
      formatDate(r.effective_date),
      fmtCsv(recordAmount(r)),
      r.classification || '—',
    ]),
    ...(negatives.length
      ? [
          ['--- CHARGEBACKS ---', '', '', '', '', '', ''],
          ...negatives.map((r) => [
            r.policy_number || '—',
            r.client_full_name,
            r.statement_month || r.carrier,
            r.members != null && r.members !== 0 ? r.members : '',
            formatDate(r.effective_date),
            fmtCsv(recordAmount(r)),
            r.classification || '—',
          ]),
        ]
      : []),
    ['', '', '', '', '', '', ''],
    ['Gross Commission', '', '', '', '', fmtCsv(grossTotal), ''],
    ...(negatives.length ? [['Chargebacks', '', '', '', '', fmtCsv(chargebackTotal), '']] : []),
    ['NET TOTAL', '', '', '', '', fmtCsv(netTotal), ''],
  ];

  const csv = rows.map((r) => r.map((v) => `"${String(v || '').replace(/"/g, '""')}"`).join(',')).join('\n');
  downloadTextFile(filename, csv);
}

function PayoutRow({ p, isPaid, paidDate, onTogglePaid, onExport, exportLabel }) {
  const [expanded, setExpanded] = useState(false);
  const posCount = p.records.filter((r) => recordAmount(r) > 0).length;
  const negCount = p.records.filter((r) => recordAmount(r) < 0).length;
  const negSum = p.records.filter((r) => recordAmount(r) < 0).reduce((s, r) => s + recordAmount(r), 0);
  const isLina = p.agent === 'Lina Hernandez';

  return (
    <div style={{ borderBottom: '1px solid var(--border)' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '12px 14px',
          background: isPaid ? 'rgba(80,160,80,0.06)' : isLina ? 'rgba(59,130,246,0.04)' : 'transparent',
        }}
      >
        <button
          onClick={() => onTogglePaid(p.agent)}
          title={isPaid ? 'Mark unpaid' : 'Mark paid'}
          style={{
            width: 26,
            height: 26,
            borderRadius: '50%',
            flexShrink: 0,
            border: isPaid ? 'none' : '2px solid var(--border)',
            background: isPaid ? 'var(--green)' : 'transparent',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {isPaid && <span style={{ color: '#fff', fontSize: 12, fontWeight: 600 }}>✓</span>}
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text)' }}>{p.agent}</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
            {posCount} line{posCount !== 1 ? 's' : ''}
            {negCount > 0 && (
              <span style={{ marginLeft: 8, color: 'var(--red)', fontWeight: 500 }}>
                · {negCount} chargeback{negCount !== 1 ? 's' : ''} ({fmt(negSum)})
              </span>
            )}
            {isPaid && paidDate && (
              <span style={{ color: 'var(--green)', marginLeft: 8, fontWeight: 500 }}>· Paid {paidDate}</span>
            )}
          </div>
        </div>
        <div style={{ fontWeight: 600, fontSize: 16, color: isPaid ? 'var(--green)' : 'var(--accent-dark)', whiteSpace: 'nowrap' }}>
          {fmt(p.total)}
        </div>
        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
          <button
            className="btn"
            onClick={() => setExpanded((e) => !e)}
            style={{ fontSize: 11, padding: '4px 10px' }}
          >
            {expanded ? 'Hide' : 'Details'}
          </button>
          <button className="btn btn-primary" onClick={onExport} style={{ fontSize: 11, padding: '4px 12px' }}>
            {exportLabel || 'Statement'}
          </button>
        </div>
      </div>
      {expanded && (
        <div style={{ background: 'var(--bg-subtle)', padding: '0 14px 12px 54px' }}>
          <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Policy #', 'Client', 'Carrier', 'Lives', 'Effective', 'Period', 'Type', 'Amount'].map((h) => (
                  <th
                    key={h}
                    style={{
                      textAlign: h === 'Amount' ? 'right' : 'left',
                      padding: '6px 8px',
                      color: 'var(--text-muted)',
                      fontWeight: 500,
                      fontSize: 11,
                      borderBottom: '0.5px solid var(--border)',
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {p.records.map((r, j) => {
                const amount = recordAmount(r);
                return (
                  <tr key={j} style={{ borderBottom: '0.5px solid var(--border)' }}>
                    <td style={{ padding: '6px 8px', color: 'var(--accent-dark)', fontWeight: 500, fontSize: 11 }}>
                      {r.policy_number || '—'}
                    </td>
                    <td style={{ padding: '6px 8px' }}>{r.client_full_name}</td>
                    <td style={{ padding: '6px 8px', color: 'var(--text-muted)', fontSize: 11 }}>
                      {r.statement_month || r.carrier}
                    </td>
                    <td style={{ padding: '6px 8px', textAlign: 'center', fontSize: 11 }}>
                      {r.members != null && r.members !== 0 ? r.members : '—'}
                    </td>
                    <td style={{ padding: '6px 8px', color: 'var(--text-muted)', fontSize: 11 }}>
                      {formatDate(r.effective_date)}
                    </td>
                    <td style={{ padding: '6px 8px', color: 'var(--text-muted)', fontSize: 11 }}>
                      {r.payment_period || '—'}
                    </td>
                    <td style={{ padding: '6px 8px', color: 'var(--text-muted)', fontSize: 11 }}>
                      {r.classification || '—'}
                    </td>
                    <td
                      style={{
                        padding: '6px 8px',
                        textAlign: 'right',
                        fontWeight: 500,
                        color: amount < 0 ? 'var(--red)' : 'var(--green)',
                      }}
                    >
                      {fmt(amount)}
                    </td>
                  </tr>
                );
              })}
              <tr style={{ borderTop: '0.5px solid var(--border)' }}>
                <td colSpan={7} style={{ padding: '7px 8px', fontWeight: 500, fontSize: 12 }}>
                  Total ({p.records.length} records)
                </td>
                <td style={{ padding: '7px 8px', textAlign: 'right', fontWeight: 600, color: 'var(--green)', fontSize: 12 }}>
                  {fmt(p.total)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function OverridePayeeRow({ s, onExport }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div style={{ borderBottom: '0.5px solid var(--border)' }}>
      <div style={{ padding: '12px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 500, fontSize: 13 }}>{s.payee}</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            {s.lineCount} line{s.lineCount !== 1 ? 's' : ''}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
          <span style={{ fontWeight: 600, color: s.total < 0 ? 'var(--red)' : 'var(--green)' }}>{fmt(s.total)}</span>
          <button className="btn" onClick={() => setExpanded((e) => !e)} style={{ fontSize: 11, padding: '4px 10px' }}>
            {expanded ? 'Hide' : 'Details'}
          </button>
          <button className="btn" onClick={onExport} style={{ fontSize: 11, padding: '4px 10px' }}>
            Statement
          </button>
        </div>
      </div>
      {expanded && (
        <div style={{ background: 'var(--bg-subtle)', padding: '0 14px 12px' }}>
          <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Policy #', 'Client', 'Carrier', 'Writing agent', 'Type', 'Amount'].map((h) => (
                  <th
                    key={h}
                    style={{
                      textAlign: h === 'Amount' ? 'right' : 'left',
                      padding: '6px 8px',
                      color: 'var(--text-muted)',
                      fontWeight: 500,
                      fontSize: 11,
                      borderBottom: '0.5px solid var(--border)',
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(s.lines || []).map((l, i) => (
                <tr key={i} style={{ borderBottom: '0.5px solid var(--border)' }}>
                  <td style={{ padding: '6px 8px', fontSize: 11 }}>{l.policy_number || '—'}</td>
                  <td style={{ padding: '6px 8px' }}>{l.client_full_name}</td>
                  <td style={{ padding: '6px 8px', color: 'var(--text-muted)', fontSize: 11 }}>{l.carrier}</td>
                  <td style={{ padding: '6px 8px', color: 'var(--text-muted)', fontSize: 11 }}>{l.writing_agent}</td>
                  <td style={{ padding: '6px 8px', color: 'var(--text-muted)', fontSize: 11 }}>{l.classification}</td>
                  <td
                    style={{
                      padding: '6px 8px',
                      textAlign: 'right',
                      fontWeight: 500,
                      color: Number(l.amount) < 0 ? 'var(--red)' : 'var(--green)',
                    }}
                  >
                    {fmt(l.amount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function HouseOverridesPanel() {
  const [ovTypes, setOvTypes] = useState([]);
  const [ovPeriods, setOvPeriods] = useState([]);
  const [ovType, setOvType] = useState('thei_override');
  const [ovPeriod, setOvPeriod] = useState('');
  const [preview, setPreview] = useState(null);
  const [ovLoading, setOvLoading] = useState(false);
  const [ovError, setOvError] = useState('');
  const [autoLoaded, setAutoLoaded] = useState(false);

  useEffect(() => {
    Promise.all([
      apiFetch('/override-statements/types'),
      apiFetch('/override-statements/periods'),
    ])
      .then(([typesData, periodsData]) => {
        setOvTypes(typesData.types || []);
        const periods = periodsData.periods || [];
        setOvPeriods(periods);
        if (periods[0]?.period) setOvPeriod(periods[0].period);
      })
      .catch((e) => setOvError(e.message || 'Failed to load override filters'));
  }, []);

  useEffect(() => {
    if (ovPeriod && ovType && !autoLoaded) {
      setAutoLoaded(true);
      loadPreview();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ovPeriod, ovType, autoLoaded]);

  async function loadPreview() {
    if (!ovType || !ovPeriod) return;
    setOvLoading(true);
    setOvError('');
    try {
      const data = await apiFetch(
        `/override-statements/preview?type=${encodeURIComponent(ovType)}&period=${encodeURIComponent(ovPeriod)}`
      );
      setPreview(data);
    } catch (e) {
      setOvError(e.message || 'Failed to load preview');
      setPreview(null);
    } finally {
      setOvLoading(false);
    }
  }

  async function exportAll() {
    if (!ovType || !ovPeriod) return;
    setOvLoading(true);
    setOvError('');
    try {
      const data = await apiFetch(
        `/override-statements/export-all?type=${encodeURIComponent(ovType)}&period=${encodeURIComponent(ovPeriod)}`
      );
      if (data.summaryCsv) downloadTextFile(data.summaryFilename || 'summary.csv', data.summaryCsv);
      for (const f of data.files || []) downloadTextFile(f.filename, f.csv);
    } catch (e) {
      setOvError(e.message || 'Export failed');
    } finally {
      setOvLoading(false);
    }
  }

  async function exportOne(payee) {
    try {
      const data = await apiFetch(
        `/override-statements/export-all?type=${encodeURIComponent(ovType)}&period=${encodeURIComponent(ovPeriod)}`
      );
      const file = (data.files || []).find((f) => f.payee === payee);
      if (file) downloadTextFile(file.filename, file.csv);
    } catch (e) {
      setOvError(e.message || 'Export failed');
    }
  }

  return (
    <div>
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-title" style={{ fontSize: 15, marginBottom: 6 }}>House overrides</div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 14, lineHeight: 1.45 }}>
          THEI / BSI 50/50, Marco $10, and Integrity producer shares. Lina’s agent production is under{' '}
          <strong>Agent Payouts</strong> — not here.
        </div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div>
            <div className="form-label">Type</div>
            <select
              className="filter-select"
              value={ovType}
              onChange={(e) => {
                setOvType(e.target.value);
                setPreview(null);
                setAutoLoaded(false);
              }}
              style={{ minWidth: 220 }}
            >
              {ovTypes.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <div className="form-label">Period</div>
            <select
              className="filter-select"
              value={ovPeriod}
              onChange={(e) => {
                setOvPeriod(e.target.value);
                setPreview(null);
                setAutoLoaded(false);
              }}
              style={{ minWidth: 160 }}
            >
              <option value="">Select period...</option>
              <option value="all">— All periods —</option>
              {ovPeriods.map((p) => {
                const label = formatPeriodLabel(p.period);
                return label ? (
                  <option key={p.period} value={p.period}>
                    {label}
                  </option>
                ) : null;
              })}
            </select>
          </div>
          <button className="btn btn-primary" onClick={loadPreview} disabled={!ovType || !ovPeriod || ovLoading}>
            {ovLoading ? 'Loading…' : 'Refresh'}
          </button>
          {preview && (
            <button className="btn" onClick={exportAll} disabled={ovLoading}>
              Export all CSVs
            </button>
          )}
        </div>
        {ovError && (
          <div style={{ marginTop: 10, color: 'var(--red)', fontSize: 12 }}>{ovError}</div>
        )}
      </div>

      {preview && (
        <div className="card" style={{ padding: 0 }}>
          <div
            style={{
              padding: '10px 14px',
              borderBottom: '0.5px solid var(--border)',
              display: 'flex',
              justifyContent: 'space-between',
            }}
          >
            <span style={{ fontSize: 13, fontWeight: 500 }}>
              {preview.periodLabel} — {preview.statementCount} payee
              {preview.statementCount !== 1 ? 's' : ''}
            </span>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--green)' }}>{fmt(preview.grandTotal)}</span>
          </div>
          {(preview.statements || []).length === 0 ? (
            <div className="empty-state">
              <div className="empty-title">No override lines for this type/period</div>
            </div>
          ) : (
            (preview.statements || []).map((s) => (
              <OverridePayeeRow key={s.payee} s={s} onExport={() => exportOne(s.payee)} />
            ))
          )}
        </div>
      )}
    </div>
  );
}

export default function Payroll({ user }) {
  const [periods, setPeriods] = useState([]);
  const [selectedPeriod, setSelectedPeriod] = useState('');
  const [payouts, setPayouts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [paidStatus, setPaidStatus] = useState({});
  const [paidDates, setPaidDates] = useState({});
  const [tab, setTab] = useState('payroll');
  const [history, setHistory] = useState([]);
  const historyKey = `payroll_history_${(user.agency || 'thei').toLowerCase().replace(/[^a-z]/g, '_')}`;
  const [statusFilter, setStatusFilter] = useState('unpaid'); // unpaid | paid | all
  const [search, setSearch] = useState('');
  const [linaBusy, setLinaBusy] = useState(false);
  const [linaError, setLinaError] = useState('');
  const isBSI = (user.agency || '').toLowerCase().includes('broker society');

  async function downloadLinaExcel(period) {
    if (!period) return;
    setLinaBusy(true);
    setLinaError('');
    try {
      await apiDownload(
        `/lina-statements/export?period=${encodeURIComponent(period)}`,
        `Lina_Hernandez_Compensation_Statement_${period}.xlsx`
      );
    } catch (e) {
      setLinaError(e.message || 'Failed to download Lina statement');
    } finally {
      setLinaBusy(false);
    }
  }

  useEffect(() => {
    apiFetch('/records/filters')
      .then((d) => {
        const valid = (d.periods || []).filter((p) => {
          if (!p || p === 'Unknown') return false;
          const s = String(p);
          return s.match(/^\d{6}$/) || s.match(/^\d{2}\/\d{4}$/) || s.match(/^\d{2}\/\d{2}\/\d{4}$/);
        });
        const seen = new Set();
        const list = valid.filter((p) => {
          const l = formatPeriodLabel(p);
          if (!l || seen.has(l)) return false;
          seen.add(l);
          return true;
        });
        // Newest first for the dropdown
        list.sort((a, b) => String(b).localeCompare(String(a)));
        setPeriods(list);
        if (list[0]) setSelectedPeriod(list[0]);
      })
      .catch((e) => setLoadError(e.message || 'Failed to load periods'));
    setHistory(JSON.parse(localStorage.getItem(historyKey) || '[]'));
  }, [user.agency, historyKey]);

  useEffect(() => {
    if (selectedPeriod) loadPayouts(selectedPeriod);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPeriod, user.agency]);

  async function loadPayouts(period) {
    if (!period) return;
    setLoading(true);
    setLoadError('');
    try {
      const url =
        period === 'all'
          ? `/records?limit=5000`
          : `/records?period=${encodeURIComponent(period)}&limit=5000`;
      const data = await apiFetch(url);
      let allRecs = data.records || [];

      if (isBSI) {
        allRecs = allRecs.filter((r) => {
          const c = (r.classification || '').toLowerCase();
          return c.includes('new business') || c.includes('chargeback');
        });
      } else {
        allRecs = allRecs.filter((r) => {
          const classification = (r.classification || '').toLowerCase();
          const lob = (r.lob || '').toUpperCase();
          const producerPayable = parseFloat(r.producer_payable || 0);
          const isAlba = isAlbaName(r.agent_name);

          if (isAlba) {
            return (
              producerPayable !== 0 &&
              !classification.includes('override') &&
              (classification.includes('new business') ||
                classification.includes('renewal') ||
                classification.includes('chargeback') ||
                classification.includes('agent commission') ||
                classification === 'commission')
            );
          }

          const hasSubAgentOverride = parseFloat(r.sub_agent_override || 0) > 0;
          const isACAPayable = lob === 'ACA' && producerPayable !== 0;
          return (isACAPayable || hasSubAgentOverride) && !isYourTeam(r.agent_name);
        });
      }

      const grouped = {};
      const seen = new Set();
      for (const r of allRecs) {
        const agent = albaPayrollDisplayName(r.agent_name || 'Unknown');
        const commission = recordAmount(r);
        const key = `${agent}|${r.client_full_name}|${r.statement_month || r.carrier}|${r.payment_period}|${r.policy_number}|${r.classification}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (!grouped[agent]) grouped[agent] = { agent, records: [], total: 0, hasPositivePayable: false };
        grouped[agent].records.push(r);
        grouped[agent].total += commission;

        const classification = (r.classification || '').toLowerCase();
        const isACAPayableCheck = (r.lob || '').toUpperCase() === 'ACA' && parseFloat(r.producer_payable || 0) !== 0;
        const hasSubAgentOverride = parseFloat(r.sub_agent_override || 0) > 0;
        const isAlbaRow =
          isAlbaName(r.agent_name) &&
          parseFloat(r.producer_payable || 0) !== 0 &&
          !classification.includes('override');
        if (isACAPayableCheck || hasSubAgentOverride || isAlbaRow) grouped[agent].hasPositivePayable = true;
      }

      setPayouts(
        Object.values(grouped)
          .filter((p) => p.hasPositivePayable)
          .sort((a, b) => b.total - a.total)
      );
      const saved = JSON.parse(localStorage.getItem(`payroll_period_${period}`) || '{}');
      setPaidStatus(saved.paid || {});
      setPaidDates(saved.dates || {});
    } catch (e) {
      console.error(e);
      setLoadError(e.message || 'Failed to load payouts');
      setPayouts([]);
    } finally {
      setLoading(false);
    }
  }

  function togglePaid(agent) {
    const newStatus = { ...paidStatus, [agent]: !paidStatus[agent] };
    const newDates = { ...paidDates };
    if (newStatus[agent]) {
      newDates[agent] = new Date().toISOString().slice(0, 10);
      const payout = payouts.find((p) => p.agent === agent);
      const h = JSON.parse(localStorage.getItem(historyKey) || '[]');
      h.unshift({
        period: selectedPeriod,
        periodLabel: formatPeriodLabel(selectedPeriod) || selectedPeriod,
        agent,
        amount: payout?.total || 0,
        date: newDates[agent],
      });
      localStorage.setItem(historyKey, JSON.stringify(h.slice(0, 200)));
      setHistory(h.slice(0, 200));
    } else {
      delete newDates[agent];
    }
    setPaidStatus(newStatus);
    setPaidDates(newDates);
    localStorage.setItem(
      `payroll_period_${selectedPeriod}`,
      JSON.stringify({ paid: newStatus, dates: newDates })
    );
  }

  function exportAll() {
    if (!payouts.length) return;
    const pl = selectedPeriod === 'all' ? 'All Periods' : formatPeriodLabel(selectedPeriod) || selectedPeriod;
    const agencyName = isBSI ? 'Broker Society Insurance / Level Up Insurance' : 'The Health Experts Insurance';
    const fmtCsv = (n) => '$' + Number(n || 0).toFixed(2);
    const lines = [`"${agencyName} — Payout Summary"`, `"Period: ${pl}"`, `"Generated by OliComm"`, ``];
    for (const p of payouts) {
      const positives = p.records.filter((r) => recordAmount(r) >= 0);
      const negatives = p.records.filter((r) => recordAmount(r) < 0);
      const gross = positives.reduce((s, r) => s + recordAmount(r), 0);
      const cb = negatives.reduce((s, r) => s + recordAmount(r), 0);
      const net = gross + cb;
      lines.push(`"*** AGENT: ${p.agent} ***"`);
      lines.push(`"Status: ${paidStatus[p.agent] ? `Paid ${paidDates[p.agent]}` : 'Unpaid'}"`);
      lines.push(`"Policy #","Client","Statement","Lives","Effective","Commission","Type"`);
      for (const r of positives) {
        lines.push(
          `"${r.policy_number || ''}","${r.client_full_name}","${r.statement_month || r.carrier}","${
            r.members != null && r.members !== 0 ? r.members : ''
          }","${formatDate(r.effective_date)}","${fmtCsv(recordAmount(r))}","${r.classification || ''}"`
        );
      }
      if (negatives.length) {
        lines.push(`"--- CHARGEBACKS ---"`);
        for (const r of negatives) {
          lines.push(
            `"${r.policy_number || ''}","${r.client_full_name}","${r.statement_month || r.carrier}","${
              r.members != null && r.members !== 0 ? r.members : ''
            }","${formatDate(r.effective_date)}","${fmtCsv(recordAmount(r))}","${r.classification || ''}"`
          );
        }
      }
      lines.push(`"Gross Commission","","","","${fmtCsv(gross)}",""`);
      if (negatives.length) lines.push(`"Chargebacks","","","","${fmtCsv(cb)}",""`);
      lines.push(`"NET TOTAL","","","","${fmtCsv(net)}",""`);
      lines.push(``);
    }
    downloadTextFile(`${isBSI ? 'BSI' : 'THEI'}_Payouts_${selectedPeriod}.csv`, lines.join('\n'));
  }

  const periodLabel =
    selectedPeriod === 'all' ? 'All Periods' : formatPeriodLabel(selectedPeriod) || selectedPeriod;

  const filteredPayouts = useMemo(() => {
    const q = search.trim().toLowerCase();
    return payouts
      .filter((p) => {
        if (statusFilter === 'unpaid' && paidStatus[p.agent]) return false;
        if (statusFilter === 'paid' && !paidStatus[p.agent]) return false;
        if (q && !p.agent.toLowerCase().includes(q)) return false;
        return true;
      })
      .sort((a, b) => {
        const aPaid = !!paidStatus[a.agent];
        const bPaid = !!paidStatus[b.agent];
        if (statusFilter === 'all' && aPaid !== bPaid) return aPaid ? 1 : -1;
        return b.total - a.total;
      });
  }, [payouts, paidStatus, statusFilter, search]);

  const totalOwed = payouts.reduce((s, p) => s + p.total, 0);
  const totalPaid = payouts.filter((p) => paidStatus[p.agent]).reduce((s, p) => s + p.total, 0);
  const totalUnpaid = totalOwed - totalPaid;
  const paidCount = payouts.filter((p) => paidStatus[p.agent]).length;
  const unpaidCount = payouts.length - paidCount;
  const linaPayout = payouts.find((p) => p.agent === 'Lina Hernandez');

  const tabStyle = (id) => ({
    padding: '8px 14px',
    border: 'none',
    background: 'none',
    fontSize: 13,
    cursor: 'pointer',
    borderBottom: tab === id ? '2px solid var(--accent)' : '2px solid transparent',
    color: tab === id ? 'var(--accent-dark)' : 'var(--text-muted)',
    fontWeight: tab === id ? 600 : 400,
    marginBottom: -1,
  });

  return (
    <div>
      <div className="page-header">
        <div className="page-title">Payroll</div>
        <div className="page-sub">
          Pay agents from production · house overrides separately · track what’s been paid
        </div>
      </div>
      <div className="page-body">
        <div style={{ display: 'flex', gap: 4, marginBottom: 16, borderBottom: '1px solid var(--border)', flexWrap: 'wrap' }}>
          <button style={tabStyle('payroll')} onClick={() => setTab('payroll')}>
            Agent Payouts
            {unpaidCount > 0 && tab !== 'payroll' && (
              <span
                style={{
                  background: 'var(--amber, #B88100)',
                  color: '#fff',
                  borderRadius: 99,
                  fontSize: 10,
                  padding: '1px 6px',
                  marginLeft: 6,
                  fontWeight: 600,
                }}
              >
                {unpaidCount}
              </span>
            )}
          </button>
          <button style={tabStyle('overrides')} onClick={() => setTab('overrides')}>
            House Overrides
          </button>
          <button style={tabStyle('loa')} onClick={() => setTab('loa')}>
            LOA
          </button>
          <button style={tabStyle('history')} onClick={() => setTab('history')}>
            History
            {history.length > 0 && (
              <span
                style={{
                  background: 'var(--accent)',
                  color: 'var(--sidebar-bg)',
                  borderRadius: 99,
                  fontSize: 10,
                  padding: '1px 6px',
                  marginLeft: 6,
                  fontWeight: 500,
                }}
              >
                {history.length}
              </span>
            )}
          </button>
        </div>

        {tab === 'overrides' && <HouseOverridesPanel />}
        {tab === 'loa' && <LOAStatements />}

        {tab === 'payroll' && (
          <div>
            <div className="card" style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12, lineHeight: 1.45 }}>
                Agent production only — ACA producer pay, Marco $10, and <strong>Lina Hernandez</strong> (NB /
                Renewal / Chargeback). No agency overrides on this tab.
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap' }}>
                <div>
                  <div className="form-label">Month</div>
                  <select
                    className="filter-select"
                    value={selectedPeriod}
                    onChange={(e) => {
                      setSelectedPeriod(e.target.value);
                      setSearch('');
                      setStatusFilter('unpaid');
                    }}
                    style={{ minWidth: 160 }}
                  >
                    <option value="">Select period...</option>
                    <option value="all">— All periods —</option>
                    {periods.map((p) => {
                      const l = formatPeriodLabel(p);
                      return l ? (
                        <option key={p} value={p}>
                          {l}
                        </option>
                      ) : null;
                    })}
                  </select>
                </div>
                <div style={{ flex: 1, minWidth: 180 }}>
                  <div className="form-label">Find agent</div>
                  <input
                    className="filter-select"
                    style={{ width: '100%', cursor: 'text' }}
                    placeholder="Search name…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    disabled={!selectedPeriod}
                  />
                </div>
                {selectedPeriod && payouts.length > 0 && (
                  <button className="btn" onClick={exportAll}>
                    Export all
                  </button>
                )}
              </div>
              {selectedPeriod && (
                <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                  <button style={chipStyle(statusFilter === 'unpaid')} onClick={() => setStatusFilter('unpaid')}>
                    Unpaid ({unpaidCount})
                  </button>
                  <button style={chipStyle(statusFilter === 'paid')} onClick={() => setStatusFilter('paid')}>
                    Paid ({paidCount})
                  </button>
                  <button style={chipStyle(statusFilter === 'all')} onClick={() => setStatusFilter('all')}>
                    All ({payouts.length})
                  </button>
                </div>
              )}
            </div>

            {loadError && (
              <div
                className="card"
                style={{ marginBottom: 14, borderColor: '#E5C8B8', background: '#F5EAE4', color: '#7A3D1F', fontSize: 13 }}
              >
                {loadError}
              </div>
            )}

            {!selectedPeriod ? (
              <div className="card">
                <div className="empty-state">
                  <div className="empty-title">Select a month</div>
                  <div className="empty-sub">Choose a statement period to see who is owed</div>
                </div>
              </div>
            ) : loading ? (
              <div className="card">
                <div className="empty-state">
                  <div className="empty-title" style={{ color: 'var(--text-muted)' }}>
                    Loading payouts…
                  </div>
                </div>
              </div>
            ) : (
              <div>
                <div className="kpi-grid" style={{ marginBottom: 14 }}>
                  <div className="kpi-card">
                    <div className="kpi-label">Total — {periodLabel}</div>
                    <div className="kpi-value blue">{fmt(totalOwed)}</div>
                  </div>
                  <div className="kpi-card">
                    <div className="kpi-label">Still unpaid</div>
                    <div className={`kpi-value ${totalUnpaid > 0 ? 'amber' : 'green'}`}>{fmt(totalUnpaid)}</div>
                  </div>
                  <div className="kpi-card">
                    <div className="kpi-label">Paid out</div>
                    <div className="kpi-value green">{fmt(totalPaid)}</div>
                  </div>
                  <div className="kpi-card">
                    <div className="kpi-label">Agents</div>
                    <div className="kpi-value">
                      {paidCount} / {payouts.length}
                    </div>
                  </div>
                </div>

                {linaPayout && selectedPeriod && selectedPeriod !== 'all' && (
                  <div
                    className="card"
                    style={{
                      marginBottom: 14,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 12,
                      flexWrap: 'wrap',
                    }}
                  >
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>Lina Hernandez — compensation statement</div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                        {periodLabel} · {linaPayout.records.length} line
                        {linaPayout.records.length !== 1 ? 's' : ''} · Balance {fmt(linaPayout.total)} · Excel detail
                        report (same layout BSI used)
                      </div>
                      {linaError && (
                        <div style={{ fontSize: 12, color: 'var(--red)', marginTop: 6 }}>{linaError}</div>
                      )}
                    </div>
                    <button
                      className="btn btn-primary"
                      disabled={linaBusy}
                      onClick={() => downloadLinaExcel(selectedPeriod)}
                    >
                      {linaBusy ? 'Preparing…' : 'Download Excel'}
                    </button>
                  </div>
                )}

                {totalUnpaid === 0 && payouts.length > 0 && (
                  <div
                    style={{
                      background: '#EAF3DE',
                      border: '1px solid #C0DD97',
                      borderRadius: 8,
                      padding: '10px 14px',
                      marginBottom: 14,
                      fontSize: 13,
                      color: '#3B6D11',
                      fontWeight: 500,
                    }}
                  >
                    All agents marked paid for {periodLabel}
                  </div>
                )}

                <div className="card" style={{ padding: 0 }}>
                  <div
                    style={{
                      padding: '10px 14px',
                      borderBottom: '0.5px solid var(--border)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 8,
                      flexWrap: 'wrap',
                    }}
                  >
                    <span style={{ fontSize: 13, fontWeight: 500 }}>
                      {statusFilter === 'unpaid' ? 'Unpaid agents' : statusFilter === 'paid' ? 'Paid agents' : 'All agents'}
                      {' — '}
                      {filteredPayouts.length}
                    </span>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      Check mark = paid · Lina = Excel statement · others = CSV
                    </span>
                  </div>
                  {filteredPayouts.length === 0 ? (
                    <div className="empty-state">
                      <div className="empty-title">
                        {payouts.length === 0 ? 'No payouts for this period' : 'No agents match these filters'}
                      </div>
                      <div className="empty-sub">
                        {payouts.length === 0
                          ? `No eligible agent production for ${periodLabel}.`
                          : 'Try All, or clear the search.'}
                      </div>
                    </div>
                  ) : (
                    filteredPayouts.map((p) => (
                      <PayoutRow
                        key={p.agent}
                        p={p}
                        isPaid={!!paidStatus[p.agent]}
                        paidDate={paidDates[p.agent]}
                        onTogglePaid={togglePaid}
                        exportLabel={p.agent === 'Lina Hernandez' ? 'Excel' : 'Statement'}
                        onExport={() => {
                          if (p.agent === 'Lina Hernandez' && selectedPeriod && selectedPeriod !== 'all') {
                            downloadLinaExcel(selectedPeriod);
                          } else {
                            generateStatement(p.agent, p.records, periodLabel, isBSI);
                          }
                        }}
                      />
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {tab === 'history' && (
          <div className="card" style={{ padding: 0 }}>
            <div style={{ padding: '10px 14px', borderBottom: '0.5px solid var(--border)', fontSize: 13, fontWeight: 500 }}>
              Payment history
              <span style={{ marginLeft: 8, fontWeight: 400, color: 'var(--text-muted)', fontSize: 11 }}>
                Saved in this browser only
              </span>
            </div>
            {history.length === 0 ? (
              <div className="empty-state">
                <div className="empty-title">No payments recorded yet</div>
                <div className="empty-sub">Mark agents as paid on Agent Payouts to track them here</div>
              </div>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Period</th>
                      <th>Agent</th>
                      <th>Amount</th>
                      <th>Date paid</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((r, i) => (
                      <tr key={i}>
                        <td style={{ fontSize: 12 }}>{r.periodLabel}</td>
                        <td style={{ fontWeight: 500 }}>{r.agent}</td>
                        <td style={{ fontWeight: 500, color: 'var(--green)' }}>{fmt(r.amount)}</td>
                        <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{r.date}</td>
                        <td>
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button
                              className="btn"
                              style={{ fontSize: 11, padding: '3px 10px' }}
                              onClick={() => {
                                setSelectedPeriod(r.period);
                                setTab('payroll');
                                setStatusFilter('all');
                              }}
                            >
                              View
                            </button>
                            <button
                              className="btn btn-danger"
                              style={{ fontSize: 11, padding: '3px 10px' }}
                              onClick={() => {
                                const updated = history.filter((_, j) => j !== i);
                                setHistory(updated);
                                localStorage.setItem(historyKey, JSON.stringify(updated));
                                const k = `payroll_period_${r.period}`;
                                const sv = JSON.parse(localStorage.getItem(k) || '{}');
                                if (sv.paid) {
                                  delete sv.paid[r.agent];
                                  delete sv.dates[r.agent];
                                }
                                localStorage.setItem(k, JSON.stringify(sv));
                                if (selectedPeriod === r.period) {
                                  setPaidStatus(sv.paid || {});
                                  setPaidDates(sv.dates || {});
                                }
                              }}
                            >
                              Delete
                            </button>
                          </div>
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
    </div>
  );
}
