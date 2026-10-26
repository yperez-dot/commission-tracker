import React, { useState, useEffect, useMemo } from 'react';
import { apiFetch, apiDownload, apiUpload } from '../api';
import LOAStatements from '../components/LOAStatements';
import { UploadListSearch } from '../components/UploadPageLayout';
import { formatDate } from '../utils/dateFormat';
import { countSplitDepositClients, groupClientDeposits } from '../utils/salesReconPayment';
import { fetchAllPages } from '../fetchAllPages';
import { bottomLine } from '../payrollLock';
import TruncationBanner from '../components/TruncationBanner';
import { statementsMonth, houseCycleOptions } from '../utils/statementsPeriods';
import { houseStatementFilename } from '../houseStatementNames';
import { periodToMmYyyy, formatPeriodsInText } from '../periodFormat';
import {
  usePayrollMeta, PayModal, SentToCommissionsModal, ReasonModal, AdjustmentsPanel, PaymentRecords, MonthClosePanel, ChangeLogPanel,
} from '../components/PayrollClose';
import { sentToCommissionsBadge, houseLockName, lockPeriod } from '../statementPayeeGroups';

function fmt(n) {
  return '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const YOUR_TEAM = ['yahoska perez', 'katy robles'];

function isYourTeam(name) {
  return YOUR_TEAM.some((t) => String(name || '').toLowerCase().includes(t));
}

function integrityPayeeName(name) {
  const n = String(name || '').toLowerCase();
  if (n.includes('christian munoz') || n.includes('cam insurance solutions corp')) return 'Christian Munoz';
  if (n.includes('horacio mendieta')) return 'Horacio Mendieta';
  return null;
}

const STATEMENT_PAYEE_KEYS = {
  'Lina Hernandez': 'lina',
  'Christian Munoz': 'christian-munoz',
  'Horacio Mendieta': 'horacio-mendieta',
};

function isAlbaName(name) {
  const n = String(name || '').toLowerCase();
  if (!n.includes('hernandez')) return false;
  return n.includes('alba') || n.includes('lina') || n.includes('ritela');
}

function albaPayrollDisplayName(name) {
  return isAlbaName(name) ? 'Lina Hernandez' : (integrityPayeeName(name) || name);
}

/** Period → "MM.YYYY" (NHP cycles "MM.YYYY · cycle DD"); null when not a period. */
function formatPeriodLabel(p) {
  if (!p) return p;
  return periodToMmYyyy(p);
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

function downloadBase64File(filename, base64, mime) {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  const blob = new Blob([bytes], {
    type: mime || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function filenameForHouseExcel(type, period, payee) {
  const periodPart = period && period !== 'all' ? period : 'ALL';
  const renamed = houseStatementFilename(type, period, 'xlsx');
  if (renamed) return renamed;
  if (type === 'thei_override') return `THEI_Override_Statement_${periodPart}.xlsx`;
  if (type === 'marco') return `Marco_Override_Statement_${periodPart}.xlsx`;
  const who = String(payee || 'Override').replace(/\s+/g, '_').replace(/[^A-Za-z0-9_\-]/g, '');
  return `${who}_Override_Statement_${periodPart}.xlsx`;
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
    [bottomLine(netTotal).label, '', '', '', '', fmtCsv(bottomLine(netTotal).amount), ''],
  ];

  const csv = rows.map((r) => r.map((v) => `"${String(v || '').replace(/"/g, '""')}"`).join(',')).join('\n');
  downloadTextFile(filename, csv);
}

const STATEMENT_PAYEE_OPTIONS = [
  { key: 'lina', label: 'Lina Hernandez' },
  { key: 'christian-munoz', label: 'Christian Munoz' },
  { key: 'horacio-mendieta', label: 'Horacio Mendieta' },
];

/** Issued statements (OliComm) + BSI-received copies for the selected period, with comparison. */
function StoredStatements({
  period, isAdmin, onDownloadCurrent, onDownloadLinaExcel, downloadBusy, downloadError,
  paidStatus, paidDates, locks, meta, onMarkSent, onUnlock,
}) {
  const [stored, setStored] = useState([]);
  const [compare, setCompare] = useState({});
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const [recv, setRecv] = useState({ payee: 'lina', total: '', file: null });

  async function refresh() {
    try {
      const list = await apiFetch(`/payee-statements?period=${encodeURIComponent(period)}`);
      setStored(list || []);
      const cmp = {};
      for (const o of STATEMENT_PAYEE_OPTIONS) {
        try {
          cmp[o.key] = await apiFetch(`/payee-statements/compare?payee=${o.key}&period=${encodeURIComponent(period)}`);
        } catch (e) { cmp[o.key] = null; }
      }
      setCompare(cmp);
    } catch (e) {
      setMsg(e.message || 'Failed to load stored statements');
    }
  }
  useEffect(() => { refresh(); }, [period]);

  async function issue(payee) {
    setBusy(payee); setMsg('');
    try {
      await apiFetch('/payee-statements/issue', { method: 'POST', body: JSON.stringify({ payee, period }) });
      await refresh();
    } catch (e) { setMsg(e.message || 'Issue failed'); }
    setBusy('');
  }

  async function logReceived() {
    if (!recv.file || recv.total === '') { setMsg('Pick the BSI file and type its balance.'); return; }
    setBusy('recv'); setMsg('');
    try {
      const fd = new FormData();
      fd.append('file', recv.file);
      fd.append('payee', recv.payee);
      fd.append('period', period);
      fd.append('total', recv.total);
      await apiUpload('/payee-statements/received', fd);
      setRecv({ payee: recv.payee, total: '', file: null });
      await refresh();
    } catch (e) { setMsg(e.message || 'Upload failed'); }
    setBusy('');
  }

  async function voidOne(id) {
    try {
      await apiFetch(`/payee-statements/${id}/void`, { method: 'POST' });
      await refresh();
    } catch (e) { setMsg(e.message || 'Void failed'); }
  }

  return (
    <div className="card" style={{ marginTop: 14 }}>
      <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 10 }}>Agent statements — {formatPeriodLabel(period) || period}</div>
      {msg && <div style={{ color: 'var(--red)', fontSize: 12, marginBottom: 8 }}>{msg}</div>}
      {downloadError && <div style={{ color: 'var(--red)', fontSize: 12, marginBottom: 8 }}>{downloadError}</div>}
      {STATEMENT_PAYEE_OPTIONS.map((o) => {
        const c = compare[o.key];
        const issued = stored.find((s) => s.payee_key === o.key && s.source === 'olicomm' && s.status === 'issued');
        const sent = !!(paidStatus && paidStatus[o.label]);
        const lock = locks && locks[o.label];
        const badge = sent ? sentToCommissionsBadge(period, paidDates && paidDates[o.label], periodToMmYyyy) : '';
        return (
          <div key={o.key} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderTop: '0.5px solid var(--border)', flexWrap: 'wrap' }}>
            <div style={{ width: 140, fontWeight: 500, fontSize: 13 }}>{o.label}</div>
            <div style={{ fontSize: 12, flex: 1, minWidth: 220 }}>
              {c ? (
                <>
                  Total Payable {fmt(c.liveTotal)}
                  {c.issuedTotal != null && <> · issued v{issued ? issued.version : '?'} {fmt(c.issuedTotal)}</>}
                  {c.issuedStale && <span style={{ color: '#B45309', fontWeight: 600 }}> · ⚠ data changed since issued ({fmt(c.staleBy)})</span>}
                  {c.receivedTotal != null && (
                    <span style={{ color: c.matchesBsi ? 'var(--green)' : 'var(--red)', fontWeight: 600 }}>
                      {' '}· BSI {fmt(c.receivedTotal)} {c.matchesBsi ? '✓ matches' : `✗ off by ${fmt(c.varianceVsBsi)}`}
                    </span>
                  )}
                  {badge && <span style={{ color: 'var(--green)', fontWeight: 600 }}> · {badge}</span>}
                  {lock && !badge && <span style={{ marginLeft: 8, fontWeight: 600 }}>· 🔒 Locked</span>}
                </>
              ) : '—'}
            </div>
            {onDownloadCurrent && (
              <button className="btn" style={{ fontSize: 11, padding: '4px 10px' }} disabled={!!downloadBusy}
                onClick={() => onDownloadCurrent(o.key)}>
                Current statement
              </button>
            )}
            {o.key === 'lina' && onDownloadLinaExcel && (
              <button className="btn" style={{ fontSize: 11, padding: '4px 10px' }} disabled={!!downloadBusy}
                onClick={() => onDownloadLinaExcel()}>
                Lina compensation Excel
              </button>
            )}
            {issued && (
              <>
                <button className="btn" style={{ fontSize: 11, padding: '4px 10px' }}
                  onClick={() => apiDownload(`/payee-statements/${issued.id}/download`, issued.file_name || 'statement.xlsx')}>
                  Download issued
                </button>
                {isAdmin && (
                  <button className="btn btn-danger" style={{ fontSize: 11, padding: '4px 10px' }} onClick={() => voidOne(issued.id)}>Void</button>
                )}
              </>
            )}
            {isAdmin && (
              <button className="btn btn-primary" style={{ fontSize: 11, padding: '4px 12px' }} disabled={busy === o.key} onClick={() => issue(o.key)}>
                {busy === o.key ? 'Issuing…' : issued ? 'Re-issue' : 'Issue statement'}
              </button>
            )}
            {sent ? (
              meta && meta.canUnlock ? (
                <button className="btn" style={{ fontSize: 11, padding: '4px 10px' }} onClick={() => onUnlock && onUnlock(o.label)}>Unlock</button>
              ) : null
            ) : (
              meta && meta.isStaff ? (
                <button
                  className="btn"
                  style={{ fontSize: 11, padding: '4px 10px' }}
                  onClick={() => onMarkSent && onMarkSent({ agent: o.label, label: o.label, total: c ? c.liveTotal : 0, period })}
                >
                  Sent to commissions
                </button>
              ) : null
            )}
          </div>
        );
      })}
      {isAdmin && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 12, paddingTop: 12, borderTop: '0.5px solid var(--border)', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, fontWeight: 500 }}>Log BSI&apos;s copy:</span>
          <select value={recv.payee} onChange={(e) => setRecv({ ...recv, payee: e.target.value })}>
            {STATEMENT_PAYEE_OPTIONS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
          </select>
          <input type="number" step="0.01" placeholder="BSI balance" value={recv.total} onChange={(e) => setRecv({ ...recv, total: e.target.value })} style={{ width: 120 }} />
          <input type="file" onChange={(e) => setRecv({ ...recv, file: e.target.files[0] || null })} />
          <button className="btn" disabled={busy === 'recv'} onClick={logReceived}>{busy === 'recv' ? 'Saving…' : 'Save BSI copy'}</button>
        </div>
      )}
      {stored.filter((s) => s.source === 'bsi_received' && s.status !== 'void').length > 0 && (
        <div style={{ marginTop: 10, fontSize: 11, color: 'var(--text-muted)' }}>
          BSI copies:{' '}
          {stored.filter((s) => s.source === 'bsi_received' && s.status !== 'void').map((s) => (
            <button key={s.id} className="btn" style={{ fontSize: 11, padding: '2px 8px', marginRight: 6 }}
              onClick={() => apiDownload(`/payee-statements/${s.id}/download`, s.file_name || 'bsi-statement')}>
              {s.payee_name.split(' ')[0]} {fmt(s.total)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function PayoutRow({ p, isPaid, paidDate, paidAmount, carry, lock, adjTotal, amount, net, onTogglePaid, onExport, exportLabel, exportDisabled }) {
  const [expanded, setExpanded] = useState(false);
  const posCount = p.records.filter((r) => recordAmount(r) > 0).length;
  const negCount = p.records.filter((r) => recordAmount(r) < 0).length;
  const negSum = p.records.filter((r) => recordAmount(r) < 0).reduce((s, r) => s + recordAmount(r), 0);
  // amount = what you pay: frozen lock snapshot if paid/closed, else carry payable, else rows + adjustments
  const owedNow = amount != null ? amount : (carry ? carry.payable : p.total);
  const shownCarry = lock
    ? { periodTotal: Number(lock.period_total), carryIn: Number(lock.carry_in), carryOut: Number(lock.carry_out), net: Number(lock.net) }
    : carry;
  const hasCarry = !!shownCarry && (shownCarry.carryIn !== 0 || shownCarry.net < 0);
  const bl = bottomLine(net != null ? net : (shownCarry ? shownCarry.net : owedNow));
  const lockDrift = lock ? Math.round((p.total - Number(lock.data_total)) * 100) / 100 : 0;
  const isLina = p.agent === 'Lina Hernandez';
  const splitClients = isLina
    ? countSplitDepositClients(p.records, (r) => parseFloat(r.producer_payable || 0))
    : 0;
  const clientGroups = isLina && expanded ? groupClientDeposits(p.records, (r) => parseFloat(r.producer_payable || 0)) : [];

  return (
    <div style={{ borderBottom: '1px solid var(--border)' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '12px 14px',
          background: isPaid ? 'rgba(80,160,80,0.06)' : 'transparent',
        }}
      >
        <button
          onClick={() => onTogglePaid(p.agent)}
          title={isPaid ? 'Mark not sent' : 'Mark sent to commissions'}
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
            {splitClients > 0 && (
              <span style={{ marginLeft: 8, color: '#854D0E', fontWeight: 500 }}>
                · {splitClients} client{splitClients !== 1 ? 's' : ''} with split deposits
              </span>
            )}
            {!!adjTotal && (
              <span style={{ marginLeft: 8, color: adjTotal < 0 ? 'var(--red)' : 'var(--text)', fontWeight: 500 }}>
                · adjustments {fmt(adjTotal)}
              </span>
            )}
            {hasCarry && (
              <span style={{ marginLeft: 8, color: 'var(--red)', fontWeight: 500 }}>
                · {fmt(shownCarry.periodTotal)} this month{shownCarry.carryIn !== 0 ? ` ${fmt(shownCarry.carryIn)} carried in` : ''}
                {shownCarry.carryOut < 0 ? ` · ${fmt(shownCarry.carryOut)} carries to next month` : ''}
              </span>
            )}
            {lock && (
              <span style={{ marginLeft: 8, fontWeight: 600 }} title={`Locked by ${lock.locked_by || '?'} (${lock.source === 'close' ? 'month closed' : 'sent to commissions'})`}>
                · 🔒 Locked
              </span>
            )}
            {lock && Math.abs(lockDrift) >= 0.01 && (
              <span style={{ marginLeft: 8, color: '#B45309', fontWeight: 600 }}>
                · ⚠ data changed {fmt(lockDrift)} since locked — post it as a prior-period correction in an open month
              </span>
            )}
            {isPaid && paidDate && (
              <span style={{ color: 'var(--green)', marginLeft: 8, fontWeight: 500 }}>· Sent {paidDate}</span>
            )}
            {isPaid && paidAmount != null && Math.abs(Number(paidAmount) - owedNow) >= 0.01 && (
              <span style={{ marginLeft: 8, color: '#B45309', fontWeight: 600 }}>
                · ⚠ Sent {fmt(paidAmount)} but now owed {fmt(owedNow)} ({fmt(owedNow - Number(paidAmount))} difference)
              </span>
            )}
          </div>
        </div>
        <div style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: bl.isBalanceDue ? 'var(--red)' : 'var(--text-muted)' }}>{bl.label}</div>
          <div style={{ fontWeight: 600, fontSize: 16, color: bl.isBalanceDue ? 'var(--red)' : isPaid ? 'var(--green)' : 'var(--accent-dark)' }}>
            {fmt(bl.isBalanceDue ? bl.amount : owedNow)}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
          <button
            className="btn"
            onClick={() => setExpanded((e) => !e)}
            style={{ fontSize: 11, padding: '4px 10px' }}
          >
            {expanded ? 'Hide' : 'Details'}
          </button>
          <button className="btn btn-primary" onClick={onExport} disabled={exportDisabled} style={{ fontSize: 11, padding: '4px 12px' }}>
            {exportDisabled ? 'Preparing…' : (exportLabel || 'Statement')}
          </button>
        </div>
      </div>
      {expanded && (
        <div style={{ background: 'var(--bg-subtle)', padding: '0 14px 12px 54px' }}>
          {isLina && splitClients > 0 && (
            <div style={{ fontSize: 11, color: 'var(--text-muted)', padding: '8px 0', borderBottom: '0.5px solid var(--border)', marginBottom: 8 }}>
              Clients paid in multiple statement periods are grouped below (same logic as Sales Reconciliation partial tracking).
            </div>
          )}
          {isLina && splitClients > 0 ? (
            <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse', marginBottom: 12 }}>
              <thead>
                <tr>
                  {['Client', 'Policy', 'Deposits', 'Net'].map((h) => (
                    <th key={h} style={{ textAlign: h === 'Net' ? 'right' : 'left', padding: '6px 8px', color: 'var(--text-muted)', fontWeight: 500, fontSize: 11, borderBottom: '0.5px solid var(--border)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {clientGroups.filter(g => g.deposits.length > 1).map((g, i) => (
                  <tr key={i} style={{ borderBottom: '0.5px solid var(--border)' }}>
                    <td style={{ padding: '6px 8px' }}>{g.client}</td>
                    <td style={{ padding: '6px 8px', fontSize: 11, color: 'var(--text-muted)' }}>{g.policy || '—'}</td>
                    <td style={{ padding: '6px 8px', fontSize: 11 }}>
                      {g.deposits.map((d, j) => (
                        <div key={j}>{formatPeriodLabel(d.period) || d.period}: {fmt(d.amount)}</div>
                      ))}
                    </td>
                    <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 600 }}>{fmt(g.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
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
                      {r.payment_period ? (formatPeriodLabel(r.payment_period) || r.payment_period) : '—'}
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

function OverridePayeeRow({ s, onExport, exportLabel = 'Statement', sentBadge, lock, meta, onMarkSent, onUnlock }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div style={{ borderBottom: '0.5px solid var(--border)' }}>
      <div style={{ padding: '12px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 500, fontSize: 13 }}>{s.payee}</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            {s.lineCount} line{s.lineCount !== 1 ? 's' : ''}
            {sentBadge && <span style={{ color: 'var(--green)', fontWeight: 600 }}> · {sentBadge}</span>}
            {lock && !sentBadge && <span style={{ fontWeight: 600 }}> · 🔒 Locked</span>}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)' }}>Total Payable</div>
            <span style={{ fontWeight: 600, color: s.total < 0 ? 'var(--red)' : 'var(--green)' }}>{fmt(s.total)}</span>
          </div>
          <button className="btn" onClick={() => setExpanded((e) => !e)} style={{ fontSize: 11, padding: '4px 10px' }}>
            {expanded ? 'Hide' : 'Details'}
          </button>
          <button className="btn" onClick={onExport} style={{ fontSize: 11, padding: '4px 10px' }}>
            {exportLabel}
          </button>
          {sentBadge ? (
            meta && meta.canUnlock ? (
              <button className="btn" style={{ fontSize: 11, padding: '4px 10px' }} onClick={onUnlock}>Unlock</button>
            ) : null
          ) : (
            meta && meta.isStaff ? (
              <button className="btn" style={{ fontSize: 11, padding: '4px 10px' }} onClick={onMarkSent}>Sent to commissions</button>
            ) : null
          )}
        </div>
      </div>
      {expanded && (
        <div style={{ background: 'var(--bg-subtle)', padding: '0 14px 12px' }}>
          <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Policy #', 'Client', 'Carrier', 'Writing agent', 'Effective', 'Type', 'Amount'].map((h) => (
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
                  <td style={{ padding: '6px 8px', color: 'var(--text-muted)', fontSize: 11 }}>
                    {formatDate(l.effective_date)}
                  </td>
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
              <tr>
                <td colSpan={6} style={{ padding: '7px 8px', fontWeight: 700, fontSize: 12 }}>TOTAL</td>
                <td style={{
                  padding: '7px 8px',
                  textAlign: 'right',
                  fontWeight: 700,
                  color: Number(s.total) < 0 ? 'var(--red)' : 'var(--green)',
                  fontSize: 12,
                }}>{fmt(s.total)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function HouseOverridesPanel({ month, paidStatus, paidDates, locks, meta, onMarkSent, onUnlock } = {}) {
  const [ovTypes, setOvTypes] = useState([]);
  const [ovPeriods, setOvPeriods] = useState([]);
  const [ovType, setOvType] = useState('thei_nhp');
  const [ovPeriod, setOvPeriod] = useState('');
  const [preview, setPreview] = useState(null);
  const [ovLoading, setOvLoading] = useState(false);
  const [ovError, setOvError] = useState('');
  const [autoLoaded, setAutoLoaded] = useState(false);
  const [showSourceUploads, setShowSourceUploads] = useState(false);

  useEffect(() => {
    Promise.all([
      apiFetch('/override-statements/types'),
      apiFetch('/override-statements/periods'),
    ])
      .then(([typesData, periodsData]) => {
        setOvTypes(typesData.types || []);
        const periods = periodsData.periods || [];
        setOvPeriods(periods);
        // On the Statements page the page-level month drives the period.
        if (!month && periods[0]?.period) setOvPeriod(periods[0].period);
      })
      .catch((e) => setOvError(e.message || 'Failed to load override filters'));
  }, []); // load filters once

  // Follow the page-level month picker (Statements page).
  useEffect(() => {
    if (!month) return;
    setOvPeriod(month);
    setPreview(null);
    setShowSourceUploads(false);
    setAutoLoaded(false);
  }, [month]);

  const cycleOptions = month ? houseCycleOptions(month, ovPeriods) : [];

  useEffect(() => {
    if (ovPeriod && ovType && !autoLoaded) {
      setAutoLoaded(true);
      loadPreview();
    }
  }, [ovPeriod, ovType, autoLoaded]); // loadPreview intentionally omitted — one-shot auto load

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
      for (const f of data.files || []) {
        if (f.xlsxBase64) downloadBase64File(f.filename, f.xlsxBase64);
      }
      if (data.summaryCsv) downloadTextFile(data.summaryFilename || 'summary.csv', data.summaryCsv);
    } catch (e) {
      setOvError(e.message || 'Export failed');
    } finally {
      setOvLoading(false);
    }
  }

  async function exportAllTypes() {
    if (!ovPeriod) return;
    setOvLoading(true);
    setOvError('');
    try {
      const data = await apiFetch(
        `/override-statements/export-all-types?period=${encodeURIComponent(ovPeriod)}`
      );
      for (const f of data.files || []) {
        if (f.xlsxBase64) downloadBase64File(f.filename, f.xlsxBase64);
      }
      if (data.summaryCsv) downloadTextFile(data.summaryFilename || 'house_summary.csv', data.summaryCsv);
      if (!(data.files || []).length) {
        setOvError('No house statement lines for this period');
      }
    } catch (e) {
      setOvError(e.message || 'Export failed');
    } finally {
      setOvLoading(false);
    }
  }

  async function exportOne(payee) {
    try {
      const qs = new URLSearchParams({
        type: ovType,
        period: ovPeriod,
        payee,
      });
      await apiDownload(
        `/override-statements/export-xlsx?${qs.toString()}`,
        filenameForHouseExcel(ovType, ovPeriod, payee)
      );
    } catch (e) {
      setOvError(e.message || 'Export failed');
    }
  }

  return (
    <div>
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-title" style={{ fontSize: 15, marginBottom: 14 }}>{month ? `House statements — ${formatPeriodLabel(month) || month}` : 'House statements'}</div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div>
            <div className="form-label">Type</div>
            <select
              className="filter-select"
              value={ovType}
              onChange={(e) => {
                setOvType(e.target.value);
                setPreview(null);
                setShowSourceUploads(false);
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
          {month && cycleOptions.length > 1 && (
            <div>
              <div className="form-label">Pay cycle</div>
              <select
                className="filter-select"
                aria-label="House pay cycle"
                value={ovPeriod}
                onChange={(e) => {
                  setOvPeriod(e.target.value);
                  setPreview(null);
                  setShowSourceUploads(false);
                  setAutoLoaded(false);
                }}
                style={{ minWidth: 160 }}
              >
                {cycleOptions.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </div>
          )}
          {!month && (
          <div>
            <div className="form-label">Period</div>
            <select
              className="filter-select"
              value={ovPeriod}
              onChange={(e) => {
                setOvPeriod(e.target.value);
                setPreview(null);
                setShowSourceUploads(false);
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
          )}
          <button className="btn btn-primary" onClick={loadPreview} disabled={!ovType || !ovPeriod || ovLoading}>
            {ovLoading ? 'Loading…' : 'Refresh'}
          </button>
          {preview && (
            <button className="btn" onClick={exportAll} disabled={ovLoading}>
              Export all Excel
            </button>
          )}
          {ovPeriod && (
            <button className="btn" onClick={exportAllTypes} disabled={ovLoading}>
              Export all types
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
          {preview.unsplitBsiWarning && (
            <div style={{ padding: '8px 14px', borderBottom: '0.5px solid var(--border)', fontSize: 12, fontWeight: 600, color: '#b45309' }}>
              ⚠ {formatPeriodsInText(preview.unsplitBsiWarning.message)}
            </div>
          )}
          {(preview.sourceUploads || []).length > 0 && (
            <div style={{ padding: '10px 14px', borderBottom: '0.5px solid var(--border)', fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.45 }}>
              <button
                type="button"
                onClick={() => setShowSourceUploads((v) => !v)}
                style={{
                  background: 'none',
                  border: 'none',
                  padding: 0,
                  cursor: 'pointer',
                  fontWeight: 600,
                  color: 'var(--text)',
                  fontSize: 12,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{showSourceUploads ? '▾' : '▸'}</span>
                Source uploads ({preview.sourceUploads.length})
              </button>
              {showSourceUploads && preview.sourceUploads.map((u) => (
                <div key={u.id} style={{ marginTop: 4 }}>
                  {u.original_name} — {u.row_count} rows
                </div>
              ))}
            </div>
          )}
          {(preview.statements || []).length === 0 ? (
            <div className="empty-state">
              <div className="empty-title">No override lines for this type/period</div>
            </div>
          ) : (
            (preview.statements || []).map((s) => {
              const lockKey = houseLockName(ovType, s.payee);
              const sent = !!(paidStatus && paidStatus[lockKey]);
              const badge = sent
                ? sentToCommissionsBadge(lockPeriod(ovPeriod), paidDates && paidDates[lockKey], periodToMmYyyy)
                : '';
              return (
                <OverridePayeeRow
                  key={s.payeeGroupKey || s.payee}
                  s={s}
                  exportLabel="Excel"
                  onExport={() => exportOne(s.payee)}
                  sentBadge={badge}
                  lock={locks && locks[lockKey]}
                  meta={meta}
                  onMarkSent={() => onMarkSent && onMarkSent({
                    agent: lockKey,
                    label: s.payee,
                    total: s.total,
                    period: lockPeriod(ovPeriod),
                  })}
                  onUnlock={() => onUnlock && onUnlock(lockKey)}
                />
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

export default function Payroll({ user, initialTab = 'payroll', onNavigate, initialPeriod }) {
  const tab =
    initialTab === 'overrides' || initialTab === 'loa' || initialTab === 'history' ||
    initialTab === 'close' || initialTab === 'changelog'
      ? initialTab
      : 'payroll';

  const [periods, setPeriods] = useState([]);
  const [selectedPeriod, setSelectedPeriod] = useState('');
  const [payouts, setPayouts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [paidStatus, setPaidStatus] = useState({});
  const [paidDates, setPaidDates] = useState({});
  const [paidAmounts, setPaidAmounts] = useState({});
  const [carryMap, setCarryMap] = useState({});
  const [history, setHistory] = useState([]);
  const [historySearch, setHistorySearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('unpaid'); // unpaid | paid | all
  const [search, setSearch] = useState('');
  const [linaBusy, setLinaBusy] = useState(false);
  const [linaError, setLinaError] = useState('');
  const [statusBusy, setStatusBusy] = useState(false);
  const [truncationWarning, setTruncationWarning] = useState(null);
  const [periodState, setPeriodState] = useState(null);
  const [payFor, setPayFor] = useState(null);
  const [sendFor, setSendFor] = useState(null);
  const [payBusy, setPayBusy] = useState(false);
  const [payError, setPayError] = useState('');
  const [unlockFor, setUnlockFor] = useState(null);
  const meta = usePayrollMeta();
  const isBSI = (user.agency || '').toLowerCase().includes('broker society');
  const agencyParam = encodeURIComponent(user.agency || 'thei');

  async function loadPayoutHistory() {
    try {
      const data = await apiFetch(`/payroll/payout-history?limit=200&agency=${agencyParam}`);
      setHistory(data.history || []);
    } catch (e) {
      console.error(e);
    }
  }

  async function loadPaidStatus(period) {
    if (!period || period === 'all') {
      setPaidStatus({});
      setPaidDates({});
      setPaidAmounts({});
      return;
    }
    try {
      const data = await apiFetch(
        `/payroll/payout-status?period=${encodeURIComponent(period)}&agency=${agencyParam}`
      );
      setPaidStatus(data.paid || {});
      setPaidDates(data.dates || {});
      setPaidAmounts(data.amounts || {});
    } catch (e) {
      console.error(e);
      setPaidStatus({});
      setPaidDates({});
      setPaidAmounts({});
    }
  }

  /** Locks, adjustments, payments, close state and suggested corrections for one period. */
  async function loadPeriodState(period) {
    if (!period || !/^\d{6}$/.test(String(period))) { setPeriodState(null); return; }
    try {
      setPeriodState(await apiFetch(`/payroll-close/period?period=${encodeURIComponent(period)}&agency=${agencyParam}`));
    } catch (e) {
      console.error(e);
      setPeriodState(null);
    }
  }

  async function downloadPayeeStatement(payee, period) {
    if (!period) return;
    setLinaBusy(true);
    setLinaError('');
    try {
      await apiDownload(
        `/payee-statements/preview-download?payee=${encodeURIComponent(payee)}&period=${encodeURIComponent(period)}`,
        `${payee}-statement-${period}.xlsx`
      );
    } catch (e) {
      setLinaError(e.message || 'Failed to download statement');
    } finally {
      setLinaBusy(false);
    }
  }

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
        // Statements page needs a single month (YYYYMM); other tabs keep the newest period.
        const first = tab === 'overrides' ? statementsMonth(list, initialPeriod) : (list[0] || '');
        if (first) setSelectedPeriod(first);
      })
      .catch((e) => setLoadError(e.message || 'Failed to load periods'));
    loadPayoutHistory();
  }, [user.agency]);

  useEffect(() => {
    if (selectedPeriod) loadPayouts(selectedPeriod);
  }, [selectedPeriod, user.agency]); // loadPayouts intentionally omitted — reload on period/agency change

  async function loadPayouts(period) {
    if (!period) return;
    setLoading(true);
    setLoadError('');
    setTruncationWarning(null);
    try {
      // light=1: this page never reads is_termed or the sums payload off /records
      // (payable amounts come from recordAmount(), which only looks at
      // sub_agent_override / producer_payable / commission on the row itself).
      //
      // The second param is a safe server-side superset prefilter matching which
      // classification family loadPayouts filters to below, so period=all (a full-table
      // crawl) doesn't ship every non-payable row to the browser just to drop it a
      // moment later. It narrows, it never changes the result: the exact predicate below
      // still runs unchanged on whatever comes back.
      const candidateParam = isBSI
        ? 'classificationLike=' + encodeURIComponent('new business,chargeback')
        : 'payrollCandidate=1';
      const path =
        period === 'all'
          ? `/records?light=1&${candidateParam}`
          : `/records?period=${encodeURIComponent(period)}&light=1&${candidateParam}`;
      const page = await fetchAllPages(path, { pageSize: 5000 }, apiFetch);
      let allRecs = page.items || [];
      setTruncationWarning(page.warning);

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

          // Integrity agents (Munoz incl. CAM, Mendieta): 50% producer share of the override pot
          if (integrityPayeeName(r.agent_name)) {
            return producerPayable !== 0 && (
              classification.includes('override') ||
              classification.includes('chargeback') ||
              classification.includes('new business')
            );
          }

          if (isAlba) {
            return (
              producerPayable !== 0 &&
              !classification.includes('override') &&
              (classification.includes('new business') ||
                classification.includes('renewal') ||
                classification.includes('chargeback') ||
                classification.includes('agent commission') ||
                classification === 'commission' ||
                // HRA payments on BSI statements are paid 100% to Lina (no splits)
                classification.includes('hra'))
            );
          }

          const hasSubAgentOverride = parseFloat(r.sub_agent_override || 0) > 0;
          const isACAPayable = lob === 'ACA' && producerPayable !== 0;
          // Marco $10 is an agency (Swan) house peel — House Statements only, not Agent Payouts
          return isACAPayable && !isYourTeam(r.agent_name) && !hasSubAgentOverride;
        });
      }

      const grouped = {};
      const seen = new Set();
      for (const r of allRecs) {
        const agent = albaPayrollDisplayName(r.agent_name || 'Unknown');
        const commission = recordAmount(r);
        // Prefer the row id: the old composite key collapsed legitimately distinct lines
        // (e.g. a payment and its same-month chargeback with the same classification text).
        const key = r.id != null
          ? `id:${r.id}`
          : `${agent}|${r.client_full_name}|${r.statement_month || r.carrier}|${r.payment_period}|${r.policy_number}|${r.classification}|${recordAmount(r)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (!grouped[agent]) grouped[agent] = { agent, records: [], total: 0, hasPositivePayable: false };
        grouped[agent].records.push(r);
        grouped[agent].total += commission;

        const classification = (r.classification || '').toLowerCase();
        const isACAPayableCheck = (r.lob || '').toUpperCase() === 'ACA' && parseFloat(r.producer_payable || 0) !== 0;
        const isAlbaRow =
          isAlbaName(r.agent_name) &&
          parseFloat(r.producer_payable || 0) !== 0 &&
          !classification.includes('override');
        const isIntegrityRow = !!integrityPayeeName(r.agent_name);
        if (isACAPayableCheck || isAlbaRow || isIntegrityRow) grouped[agent].hasPositivePayable = true;
      }

      setPayouts(
        Object.values(grouped)
          .filter((p) => p.hasPositivePayable)
          .sort((a, b) => b.total - a.total)
      );
      await loadPaidStatus(period);
      await loadPeriodState(period);
      // Negative balances (chargebacks > earnings) carried in from prior months
      if (!isBSI && /^\d{6}$/.test(String(period))) {
        try {
          setCarryMap(await apiFetch(`/payee-statements/carry?period=${encodeURIComponent(period)}`));
        } catch (e) { setCarryMap({}); }
      } else {
        setCarryMap({});
      }
    } catch (e) {
      console.error(e);
      setLoadError(e.message || 'Failed to load payouts');
      setPayouts([]);
    } finally {
      setLoading(false);
    }
  }

  async function togglePaid(agent) {
    if (!selectedPeriod || selectedPeriod === 'all' || statusBusy) return;
    if (!/^\d{6}$/.test(String(selectedPeriod))) {
      setLoadError('Pick a monthly period (e.g. Sep 2026) to mark payments.');
      return;
    }
    const row = displayPayouts.find((p) => p.agent === agent);
    if (paidStatus[agent]) {
      if (!meta.canUnlock) {
        setLoadError(`${agent} is sent to commissions and locked for ${periodLabel}. Only an admin can unlock it.`);
        return;
      }
      setUnlockFor(agent);
      return;
    }
    if (!meta.isStaff) {
      setLoadError('Your account cannot mark statements as sent.');
      return;
    }
    setPayError('');
    setPayFor(row || { agent, records: [], total: 0, amount: 0 });
  }

  async function submitPay(form) {
    if (!payFor) return;
    setPayBusy(true);
    setPayError('');
    try {
      await apiFetch(`/payroll-close/pay?agency=${agencyParam}`, {
        method: 'POST',
        body: JSON.stringify({
          period: selectedPeriod,
          agent: payFor.agent,
          method: form.method,
          reference: form.reference,
          payDate: form.payDate,
          amount: form.amount,
          notes: form.notes,
          dataTotal: Math.round(payFor.total * 100) / 100,
          rawAgentNames: Array.from(new Set(payFor.records.map((r) => r.agent_name).filter(Boolean))),
          recordIds: payFor.records.map((r) => r.id).filter((x) => x != null),
          agency: user.agency || 'thei',
        }),
      });
      setPayFor(null);
      await loadPayoutHistory();
      await loadPaidStatus(selectedPeriod);
      await loadPeriodState(selectedPeriod);
    } catch (e) {
      setPayError(e.message || 'Failed to record payment');
    } finally {
      setPayBusy(false);
    }
  }

  async function submitSent(form) {
    if (!sendFor) return;
    setPayBusy(true);
    setPayError('');
    try {
      const period = lockPeriod(sendFor.period || selectedPeriod);
      const total = Math.round(Number(sendFor.total || 0) * 100) / 100;
      await apiFetch(`/payroll-close/pay?agency=${agencyParam}`, {
        method: 'POST',
        body: JSON.stringify({
          period,
          agent: sendFor.agent,
          method: 'sent_to_commissions',
          payDate: form.payDate,
          notes: form.notes,
          amount: total,
          dataTotal: total,
          agency: user.agency || 'thei',
        }),
      });
      setSendFor(null);
      await loadPayoutHistory();
      await loadPaidStatus(period);
      await loadPeriodState(period);
    } catch (e) {
      setPayError(e.message || 'Failed to mark sent');
    } finally {
      setPayBusy(false);
    }
  }

  async function submitUnlock(reason) {
    setStatusBusy(true);
    try {
      await apiFetch(`/payroll-close/unlock?agency=${agencyParam}`, {
        method: 'POST',
        body: JSON.stringify({ period: selectedPeriod, agent: unlockFor, reason, agency: user.agency || 'thei' }),
      });
      setUnlockFor(null);
      await loadPayoutHistory();
      await loadPaidStatus(selectedPeriod);
      await loadPeriodState(selectedPeriod);
      await loadPayouts(selectedPeriod);
    } catch (e) {
      setLoadError(e.message || 'Unlock failed');
      setUnlockFor(null);
    } finally {
      setStatusBusy(false);
    }
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
      lines.push(`"Status: ${paidStatus[p.agent] ? `Sent ${paidDates[p.agent]}` : 'Not sent'}"`);
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
      lines.push(`"${bottomLine(net).label}","","","","${fmtCsv(bottomLine(net).amount)}",""`);
      lines.push(``);
    }
    downloadTextFile(`${isBSI ? 'BSI' : 'THEI'}_Payouts_${selectedPeriod}.csv`, lines.join('\n'));
  }

  const periodLabel =
    selectedPeriod === 'all' ? 'All Periods' : formatPeriodLabel(selectedPeriod) || selectedPeriod;

  // What each agent is actually paid this period:
  //   locked (paid / month closed) -> frozen snapshot payable
  //   Lina / Munoz / Mendieta      -> server carry-forward payable (includes adjustments)
  //   everyone else                -> rows + manual adjustments
  const displayPayouts = useMemo(() => {
    const locks = {};
    ((periodState && periodState.locks) || []).forEach((l) => { locks[l.agent_name] = l; });
    const adj = {};
    ((periodState && periodState.adjustments) || []).filter((a) => a.status !== 'void').forEach((a) => {
      adj[a.agent_name] = Math.round(((adj[a.agent_name] || 0) + Number(a.amount)) * 100) / 100;
    });
    const list = payouts.slice();
    Object.keys(adj).concat(Object.keys(locks)).forEach((name) => {
      if (!list.some((p) => p.agent === name)) list.push({ agent: name, records: [], total: 0, hasPositivePayable: true });
    });
    return list.map((p) => {
      const lock = locks[p.agent] || null;
      const carry = carryMap[p.agent];
      const adjTotal = adj[p.agent] || 0;
      const amount = lock
        ? Number(lock.payable)
        : carry ? carry.payable : Math.round((p.total + adjTotal) * 100) / 100;
      // net < 0 = the agent owes it back ("Balance due from agent")
      const net = lock && lock.net != null
        ? Number(lock.net)
        : carry ? carry.net : Math.round((p.total + adjTotal) * 100) / 100;
      return { ...p, lock, adjTotal, amount, net };
    });
  }, [payouts, periodState, carryMap]);

  const filteredPayouts = useMemo(() => {
    const q = search.trim().toLowerCase();
    return displayPayouts
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
        return b.amount - a.amount;
      });
  }, [displayPayouts, paidStatus, statusFilter, search]);

  const qHist = historySearch.trim().toLowerCase();
  const visibleHistory = !qHist
    ? history
    : history.filter((r) => {
        const hay = [r.periodLabel, r.period, r.agent, r.date]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return hay.includes(qHist);
      });

  const totalOwed = displayPayouts.reduce((s, p) => s + p.amount, 0);
  const totalPaid = displayPayouts.filter((p) => paidStatus[p.agent]).reduce((s, p) => s + p.amount, 0);
  const totalUnpaid = totalOwed - totalPaid;
  const paidCount = displayPayouts.filter((p) => paidStatus[p.agent]).length;
  const unpaidCount = displayPayouts.length - paidCount;
  const monthlyPeriods = periods.filter((p) => /^\d{6}$/.test(String(p)));

  const pageMeta = {
    payroll: {
      title: 'Agent Payouts',
      sub: 'Send producer statements to commissions (ACA and statement payees). Upload Tailored/Jill and other ACA pay statements under Uploads → Agent Payout Uploads. Marco\'s $10 peel and all statements are under Statements.',
    },
    overrides: {
      title: 'Statements',
      sub: '',
    },
    loa: {
      title: 'LOA Statements',
      sub: 'Manual LOA compensation statements (e.g. Carolina Robles)',
    },
    history: {
      title: 'Payment History',
      sub: 'Shared record of statements sent to commissions',
    },
    close: {
      title: 'Month Close',
      sub: 'Carrier checklist, THEI deposit reconciliation, and closing (locking) a payroll month',
    },
    changelog: {
      title: 'Change Log',
      sub: 'Who uploaded, deleted, renamed, edited, sent to commissions, adjusted, locked or closed what — and when',
    },
  }[tab] || { title: 'Payroll', sub: '' };

  return (
    <div>
      <div className="page-header">
        <div className="page-title">{pageMeta.title}</div>
        {pageMeta.sub && <div className="page-sub">{pageMeta.sub}</div>}
      </div>
      <div className="page-body">
        {tab === 'overrides' && (
          <div>
            <div className="card" style={{ marginBottom: 14 }}>
              <div className="form-label">Month</div>
              <select
                className="filter-select"
                aria-label="Statements month"
                value={/^\d{6}$/.test(String(selectedPeriod)) ? selectedPeriod : ''}
                onChange={(e) => setSelectedPeriod(e.target.value)}
                style={{ minWidth: 160 }}
              >
                <option value="">Select month...</option>
                {monthlyPeriods.map((p) => <option key={p} value={p}>{formatPeriodLabel(p)}</option>)}
              </select>
            </div>

            <div className="card-title" data-section="agent-statements" style={{ fontSize: 16, margin: '4px 0 0' }}>Agents</div>
            {isBSI ? (
              <div className="card" style={{ marginTop: 10, marginBottom: 18, fontSize: 12, color: 'var(--text-muted)' }}>
                Agent statements are issued from the THEI view.
              </div>
            ) : /^\d{6}$/.test(String(selectedPeriod)) ? (
              <div style={{ marginBottom: 18 }}>
                <StoredStatements
                  key={selectedPeriod}
                  period={selectedPeriod}
                  isAdmin={user.role === 'admin'}
                  downloadBusy={linaBusy}
                  downloadError={linaError}
                  onDownloadCurrent={(payee) => downloadPayeeStatement(payee, selectedPeriod)}
                  onDownloadLinaExcel={() => downloadLinaExcel(selectedPeriod)}
                  paidStatus={paidStatus}
                  paidDates={paidDates}
                  locks={((periodState && periodState.locks) || []).reduce((m, l) => { m[l.agent_name] = l; return m; }, {})}
                  meta={meta}
                  onMarkSent={setSendFor}
                  onUnlock={(agent) => setUnlockFor(agent)}
                />
              </div>
            ) : (
              <div className="card" style={{ marginTop: 10, marginBottom: 18 }}>
                <div className="empty-state">
                  <div className="empty-title">Select a month</div>
                </div>
              </div>
            )}

            <div className="card-title" data-section="house-statements" style={{ fontSize: 16, margin: '0 0 10px' }}>House</div>
            {/^\d{6}$/.test(String(selectedPeriod)) ? (
              <HouseOverridesPanel
                month={selectedPeriod}
                paidStatus={paidStatus}
                paidDates={paidDates}
                locks={((periodState && periodState.locks) || []).reduce((m, l) => { m[l.agent_name] = l; return m; }, {})}
                meta={meta}
                onMarkSent={setSendFor}
                onUnlock={(agent) => setUnlockFor(agent)}
              />
              {/^\d{6}$/.test(String(selectedPeriod)) && (
                <AdjustmentsPanel
                  period={selectedPeriod}
                  agents={displayPayouts.map((p) => p.agent)}
                  state={periodState}
                  meta={meta}
                  onChanged={async () => { await loadPeriodState(selectedPeriod); await loadPayouts(selectedPeriod); }}
                />
              )}
            ) : (
              <div className="card">
                <div className="empty-state">
                  <div className="empty-title">Select a month</div>
                </div>
              </div>
            )}
          </div>
        )}
        {tab === 'loa' && <LOAStatements />}

        {tab === 'payroll' && (
          <div>
            <div className="card" style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12, lineHeight: 1.45 }}>
                Agent production only — ACA producer pay (100% pass-through) and{' '}
                <strong>Lina Hernandez</strong> (NB / Renewal / Chargeback / HRA), plus Integrity agents{' '}
                <strong>Christian Munoz</strong> (incl. CAM) and <strong>Horacio Mendieta</strong> (50% producer share).
                Marco (Swan) is under <strong>Statements</strong>.
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
                    Not sent ({unpaidCount})
                  </button>
                  <button style={chipStyle(statusFilter === 'paid')} onClick={() => setStatusFilter('paid')}>
                    Sent ({paidCount})
                  </button>
                  <button style={chipStyle(statusFilter === 'all')} onClick={() => setStatusFilter('all')}>
                    All ({displayPayouts.length})
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

            <TruncationBanner message={truncationWarning} />

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
                    <div className="kpi-label">Not sent</div>
                    <div className={`kpi-value ${totalUnpaid > 0 ? 'amber' : 'green'}`}>{fmt(totalUnpaid)}</div>
                  </div>
                  <div className="kpi-card">
                    <div className="kpi-label">Sent</div>
                    <div className="kpi-value green">{fmt(totalPaid)}</div>
                  </div>
                  <div className="kpi-card">
                    <div className="kpi-label">Agents</div>
                    <div className="kpi-value">
                      {paidCount} / {displayPayouts.length}
                    </div>
                  </div>
                </div>

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
                    All agents marked sent to commissions for {periodLabel}
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
                      {statusFilter === 'unpaid' ? 'Not sent' : statusFilter === 'paid' ? 'Sent' : 'All agents'}
                      {' — '}
                      {filteredPayouts.length}
                    </span>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      Check mark = sent to commissions
                    </span>
                  </div>
                  {linaError && (
                    <div style={{ padding: '8px 14px', fontSize: 12, color: 'var(--red)' }}>{linaError}</div>
                  )}
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
                        paidAmount={paidAmounts[p.agent]}
                        carry={carryMap[p.agent]}
                        lock={p.lock}
                        adjTotal={p.adjTotal}
                        amount={p.amount}
                        net={p.net}
                        onTogglePaid={togglePaid}
                        exportLabel="Statement"
                        exportDisabled={!!STATEMENT_PAYEE_KEYS[p.agent] && linaBusy}
                        onExport={() => {
                          if (STATEMENT_PAYEE_KEYS[p.agent] && selectedPeriod && selectedPeriod !== 'all') {
                            downloadPayeeStatement(STATEMENT_PAYEE_KEYS[p.agent], selectedPeriod);
                          } else {
                            generateStatement(p.agent, p.records, periodLabel, isBSI);
                          }
                        }}
                      />
                    ))
                  )}
                </div>
                {/^\d{6}$/.test(String(selectedPeriod)) && (
                  <AdjustmentsPanel
                    period={selectedPeriod}
                    agents={displayPayouts.map((p) => p.agent)}
                    state={periodState}
                    meta={meta}
                    onChanged={async () => { await loadPeriodState(selectedPeriod); await loadPayouts(selectedPeriod); }}
                  />
                )}
                {!isBSI && (
                  <div data-testid="statements-moved-note" style={{ marginTop: 14, fontSize: 12, color: 'var(--text-muted)' }}>
                    Issuing, re-issuing and downloading statements (agent and house) is now on the{' '}
                    <button
                      type="button"
                      onClick={() => onNavigate && onNavigate('payroll-overrides', /^\d{6}$/.test(String(selectedPeriod)) ? { period: selectedPeriod } : {})}
                      style={{ background: 'none', border: 'none', padding: 0, color: 'var(--accent)', textDecoration: 'underline', cursor: 'pointer', fontSize: 12 }}
                    >
                      Statements
                    </button>{' '}
                    tab.
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {tab === 'close' && (
          <div>
            <div className="card" style={{ marginBottom: 14 }}>
              <div className="form-label">Month</div>
              <select className="filter-select" value={/^\d{6}$/.test(String(selectedPeriod)) ? selectedPeriod : ''}
                onChange={(e) => setSelectedPeriod(e.target.value)} style={{ minWidth: 160 }}>
                <option value="">Select month...</option>
                {monthlyPeriods.map((p) => <option key={p} value={p}>{formatPeriodLabel(p)}</option>)}
              </select>
              {loading && <span style={{ marginLeft: 10, fontSize: 12, color: 'var(--text-muted)' }}>Loading payouts…</span>}
            </div>
            {/^\d{6}$/.test(String(selectedPeriod)) && !loading && (
              <MonthClosePanel
                key={selectedPeriod}
                period={selectedPeriod}
                meta={meta}
                payeesForClose={async () => displayPayouts.map((p) => ({
                  agent: p.agent,
                  dataTotal: Math.round(p.total * 100) / 100,
                  rawAgentNames: Array.from(new Set(p.records.map((r) => r.agent_name).filter(Boolean))),
                  recordIds: p.records.map((r) => r.id).filter((x) => x != null),
                }))}
              />
            )}
          </div>
        )}

        {tab === 'changelog' && <ChangeLogPanel />}

        {tab === 'history' && <PaymentRecords />}

        {sendFor && (
          <SentToCommissionsModal
            label={sendFor.label || sendFor.agent}
            period={formatPeriodLabel(sendFor.period || selectedPeriod) || sendFor.period || selectedPeriod}
            busy={payBusy}
            error={payError}
            onCancel={() => { setSendFor(null); setPayError(''); }}
            onSubmit={submitSent}
          />
        )}
        {payFor && (
          <PayModal
            agent={payFor.agent}
            period={periodLabel}
            payable={payFor.amount}
            net={payFor.net}
            meta={meta}
            busy={payBusy}
            error={payError}
            onCancel={() => setPayFor(null)}
            onSubmit={submitPay}
          />
        )}
        {unlockFor && (
          <ReasonModal
            title={`Unlock ${unlockFor} — ${periodLabel}`}
            help="Clears the sent mark and voids its payment record. The frozen amounts are kept in the change log. Admin only."
            confirmLabel="Unlock"
            busy={statusBusy}
            onCancel={() => setUnlockFor(null)}
            onSubmit={submitUnlock}
          />
        )}

        {tab === 'history' && (
          <div className="card" style={{ padding: 0 }}>
            <div style={{ padding: '10px 14px', borderBottom: '0.5px solid var(--border)', fontSize: 13, fontWeight: 500 }}>
              Payment history
              {qHist ? ` (${visibleHistory.length} of ${history.length})` : ''}
              <span style={{ marginLeft: 8, fontWeight: 400, color: 'var(--text-muted)', fontSize: 11 }}>
                Shared team record (saved in database)
              </span>
            </div>
            {history.length === 0 ? (
              <div className="empty-state">
                <div className="empty-title">No sent records yet</div>
                <div className="empty-sub">Mark statements as sent to commissions on Statements to track them here</div>
              </div>
            ) : (
              <>
              <div style={{ padding: '10px 14px 0' }}>
                <UploadListSearch
                  value={historySearch}
                  onChange={setHistorySearch}
                  placeholder="Search agent or period…"
                />
              </div>
              {visibleHistory.length === 0 ? (
                <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
                  No payments match “{historySearch.trim()}”
                </div>
              ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Period</th>
                      <th>Agent</th>
                      <th>Amount</th>
                      <th>Date sent</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleHistory.map((r) => (
                      <tr key={r.id || `${r.period}-${r.agent}-${r.date}`}>
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
                                setStatusFilter('all');
                                if (onNavigate) onNavigate('payroll-payouts', { period: r.period });
                              }}
                            >
                              View
                            </button>
                            <button
                              className="btn btn-danger"
                              style={{ fontSize: 11, padding: '3px 10px' }}
                              onClick={async () => {
                                if (!r.id) return;
                                try {
                                  await apiFetch(`/payroll/payout-status/${r.id}?agency=${agencyParam}`, {
                                    method: 'DELETE',
                                  });
                                  await loadPayoutHistory();
                                  if (selectedPeriod === r.period) await loadPaidStatus(r.period);
                                } catch (e) {
                                  setLoadError(e.message || 'Failed to delete sent mark');
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
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
