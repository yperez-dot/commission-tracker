import React, { useState, useEffect } from 'react';
import { apiFetch } from '../api';
import { periodToMmYyyy, normalizePeriodInput, formatPeriodsInText } from '../periodFormat';

/** Period shown to people: MM.YYYY (internal values stay YYYYMM). */
export function pl(p) {
  return periodToMmYyyy(p) || p;
}

/*
 * Payroll close UI: mark-sent form (sent record + lock), unlock, manual
 * adjustments, prior-period corrections, monthly close checklist, deposit
 * reconciliation, change log. Backend: routes/payroll-close.js, routes/change-log.js.
 */

/** Timestamp in the viewer's local time zone (e.g. ET for the THEI office). */
export function when(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return String(ts);
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
}

export function fmt(n) {
  const v = Number(n || 0);
  return (v < 0 ? '-$' : '$') + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const box = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' };
const panel = { background: 'var(--card-bg, #fff)', borderRadius: 10, padding: 20, width: 420, maxWidth: '92vw', boxShadow: '0 10px 30px rgba(0,0,0,0.2)' };
const row = { display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 10 };
const small = { fontSize: 11, color: 'var(--text-muted)' };
const red = { color: 'var(--red)' };
const warnStyle = { color: '#B45309', fontWeight: 600 };

export const FALLBACK_META = {
  adjustmentCategories: [
    { key: 'clawback_not_on_file', label: 'Clawback not yet on file' },
    { key: 'correction', label: 'Correction' },
    { key: 'advance', label: 'Advance' },
    { key: 'prior_period_correction', label: 'Prior-period correction' },
    { key: 'agent_repayment', label: 'Repayment from agent' },
    { key: 'other', label: 'Other' },
  ],
  paymentMethods: [
    { key: 'sent_to_commissions', label: 'Sent to commissions' },
    { key: 'check', label: 'Check' },
    { key: 'ach', label: 'ACH' },
    { key: 'zelle', label: 'Zelle' },
    { key: 'other', label: 'Other' },
  ],
  payers: ['BSI', 'UnitedHealthcare', 'Humana', 'Devoted', 'Aetna', 'Freedom', 'Other'],
  isStaff: false,
  canUnlock: false,
};

export function usePayrollMeta() {
  const [meta, setMeta] = useState(FALLBACK_META);
  useEffect(() => {
    apiFetch('/payroll-close/meta').then((m) => m && setMeta(m)).catch(() => {});
  }, []);
  return meta;
}

/** Mark sent to commissions: method, optional reference, date sent, amount (defaults to payable). */
export function PayModal({ agent, period, payable, net, meta, onCancel, onSubmit, busy, error }) {
  const balanceDue = net != null && Number(net) < 0 ? Math.round(-Number(net) * 100) / 100 : 0;
  const payableAmount = Number(payable || 0);
  const [method, setMethod] = useState('sent_to_commissions');
  const [reference, setReference] = useState('');
  const [payDate, setPayDate] = useState(new Date().toISOString().slice(0, 10));
  const [amount, setAmount] = useState(Number.isFinite(payableAmount) ? payableAmount.toFixed(2) : '');
  const [notes, setNotes] = useState('');
  const needsReference = method === 'check' || method === 'ach' || method === 'zelle' || method === 'other';
  const submittedAmount = amount === '' || !Number.isFinite(Number(amount))
    ? payableAmount
    : Number(amount);
  return (
    <div style={box} onClick={onCancel} data-testid="pay-modal">
      <div style={panel} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 4 }}>Mark sent to commissions — {agent}</div>
        <div style={{ ...small, marginBottom: 12 }}>
          {period} · payable {fmt(payable)}. Saving marks the statement sent to commissions and locks the month: later
          data changes show up as a suggested prior-period correction instead of changing this month.
        </div>
        {balanceDue > 0 && (
          <div style={{ ...red, fontSize: 12, marginBottom: 12 }}>
            Balance due from agent {fmt(balanceDue)}. Locking records $0.00 sent and the balance carries to the next month,
            where it is netted against what they earn. If the agent pays it back, add a &quot;Repayment from agent&quot; line
            under Adjustments in an open month.
          </div>
        )}
        <div style={row}>
          <span className="form-label">Method</span>
          <select className="filter-select" value={method} onChange={(e) => setMethod(e.target.value)} aria-label="Method">
            {meta.paymentMethods.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
          </select>
        </div>
        {needsReference && (
          <div style={row}>
            <span className="form-label">{method === 'check' ? 'Check #' : 'Reference #'}</span>
            <input className="filter-select" value={reference} onChange={(e) => setReference(e.target.value)} />
          </div>
        )}
        <div style={{ display: 'flex', gap: 10 }}>
          <div style={{ ...row, flex: 1 }}>
            <span className="form-label">Date sent</span>
            <input className="filter-select" type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} aria-label="Date sent" />
          </div>
          <div style={{ ...row, flex: 1 }}>
            <span className="form-label">Amount</span>
            <input className="filter-select" type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="Amount" />
          </div>
        </div>
        {amount !== '' && Number.isFinite(Number(amount)) && Math.abs(Number(amount) - payableAmount) >= 0.01 && (
          <div style={{ ...warnStyle, fontSize: 12, marginBottom: 8 }}>⚠ Amount differs from payable by {fmt(Number(amount) - payableAmount)}</div>
        )}
        <div style={row}>
          <span className="form-label">Notes {method === 'other' ? '(required for Other)' : ''}</span>
          <input className="filter-select" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
        {error && <div style={{ ...red, fontSize: 12, marginBottom: 8 }}>{error}</div>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button className="btn" onClick={onCancel}>Cancel</button>
          <button className="btn btn-primary" disabled={busy}
            onClick={() => onSubmit({ method, reference, payDate, amount: submittedAmount, notes })}>
            {busy ? 'Saving…' : balanceDue > 0 ? 'Lock month ($0 sent)' : 'Mark sent & lock month'}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Reason prompt for admin-only actions (unlock, void, reopen) and deletes. */
export function ReasonModal({ title, help, confirmLabel, onCancel, onSubmit, busy, error, children }) {
  const [reason, setReason] = useState('');
  return (
    <div style={box} onClick={onCancel}>
      <div style={panel} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 4 }}>{title}</div>
        {help && <div style={{ ...small, marginBottom: 12 }}>{help}</div>}
        {children}
        <div style={row}>
          <span className="form-label">Reason (required, saved in the change log)</span>
          <input className="filter-select" autoFocus value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
        {error && <div style={{ ...red, fontSize: 12, marginBottom: 8 }}>{error}</div>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button className="btn" onClick={onCancel}>Cancel</button>
          <button className="btn btn-danger" disabled={busy || !reason.trim()} onClick={() => onSubmit(reason.trim())}>
            {busy ? 'Saving…' : confirmLabel || 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Manual adjustment lines + suggested prior-period corrections for one period. */
export function AdjustmentsPanel({ period, agents, state, meta, onChanged }) {
  const blankForm = { amount: '', category: 'correction', reason: '', correctsPeriod: '', method: 'check', reference: '', payDate: '' };
  const [form, setForm] = useState({ agent: '', ...blankForm });
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [voiding, setVoiding] = useState(null);
  const closed = !!(state && state.close);
  const lockedAgents = new Set(((state && state.locks) || []).map((l) => l.agent_name));
  const adjustments = (state && state.adjustments) || [];
  const corrections = (state && state.corrections) || [];

  async function add(body) {
    setBusy(true); setMsg('');
    try {
      await apiFetch('/payroll-close/adjustments', { method: 'POST', body: JSON.stringify({ ...body, ...(body.correctsPeriod ? { correctsPeriod: normalizePeriodInput(body.correctsPeriod) } : {}), period }) });
      setForm({ agent: body.agent, ...blankForm });
      await onChanged();
    } catch (e) { setMsg(e.message || 'Could not save adjustment'); }
    setBusy(false);
  }

  async function voidOne(reason) {
    setBusy(true); setMsg('');
    try {
      await apiFetch(`/payroll-close/adjustments/${voiding.id}/void`, { method: 'POST', body: JSON.stringify({ reason }) });
      setVoiding(null);
      await onChanged();
    } catch (e) { setMsg(e.message || 'Void failed'); }
    setBusy(false);
  }

  const targetLocked = form.agent && (closed || lockedAgents.has(form.agent));

  return (
    <div className="card" style={{ marginTop: 14 }}>
      <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>Adjustments — {pl(period)}</div>
      <div style={{ ...small, marginBottom: 10 }}>
        Manual lines (clawback not yet on file, correction, advance…). They count in the payout total and carry-forward,
        and print on Lina&apos;s and the Integrity statements. Sent / closed months can&apos;t take new lines.
      </div>
      {msg && <div style={{ ...red, fontSize: 12, marginBottom: 8 }}>{msg}</div>}

      {corrections.length > 0 && (
        <div style={{ background: '#FEF3C7', border: '1px solid #FCD34D', borderRadius: 8, padding: '8px 12px', marginBottom: 12 }}>
          <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 6 }}>⚠ Data changed under months that are already sent / locked</div>
          {corrections.map((c) => (
            <div key={`${c.agent}-${c.lockedPeriod}`} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, padding: '3px 0', flexWrap: 'wrap' }}>
              <span style={{ flex: 1, minWidth: 220 }}>
                <strong>{c.agent}</strong> {pl(c.lockedPeriod)}: locked {fmt(c.lockedDataTotal)}, data now {fmt(c.liveDataTotal)}
                {c.alreadyPosted ? ` (already corrected ${fmt(c.alreadyPosted)})` : ''} → suggested <strong style={c.suggested < 0 ? red : null}>{fmt(c.suggested)}</strong>
              </span>
              {meta.isStaff && !closed && !lockedAgents.has(c.agent) && (
                <button className="btn" style={{ fontSize: 11, padding: '3px 10px' }} disabled={busy}
                  onClick={() => add({
                    agent: c.agent, amount: c.suggested, category: 'prior_period_correction', correctsPeriod: c.lockedPeriod,
                    correctsLockId: c.lockId, reason: `Prior-period correction for ${pl(c.lockedPeriod)}: data changed after it was locked`,
                  })}>
                  Post to {pl(period)}
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {adjustments.length === 0 ? (
        <div style={{ ...small, padding: '6px 0' }}>No adjustments this month.</div>
      ) : (
        <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse', marginBottom: 10 }}>
          <thead>
            <tr>{['Agent', 'Category', 'Reason', 'Entered', 'Amount', ''].map((h) => (
              <th key={h} style={{ textAlign: h === 'Amount' ? 'right' : 'left', padding: '5px 6px', ...small, borderBottom: '0.5px solid var(--border)' }}>{h}</th>
            ))}</tr>
          </thead>
          <tbody>
            {adjustments.map((a) => (
              <tr key={a.id} style={{ borderBottom: '0.5px solid var(--border)', opacity: a.status === 'void' ? 0.5 : 1 }}>
                <td style={{ padding: '5px 6px' }}>{a.agent_name}</td>
                <td style={{ padding: '5px 6px' }}>{a.categoryLabel}{a.corrects_period ? ` (${pl(a.corrects_period)})` : ''}</td>
                <td style={{ padding: '5px 6px' }}>
                  {a.reason}
                  {a.status === 'void' && <span style={small}> · void: {a.void_reason} ({a.voided_by})</span>}
                </td>
                <td style={{ padding: '5px 6px', ...small }}>{a.entered_by} · {when(a.created_at)}</td>
                <td style={{ padding: '5px 6px', textAlign: 'right', fontWeight: 600, ...(a.amount < 0 ? red : {}) }}>{fmt(a.amount)}</td>
                <td style={{ padding: '5px 6px', textAlign: 'right' }}>
                  {meta.canUnlock && a.status !== 'void' && (
                    <button className="btn btn-danger" style={{ fontSize: 10, padding: '2px 8px' }} onClick={() => setVoiding(a)}>Void</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {meta.isStaff && !closed && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap', paddingTop: 8, borderTop: '0.5px solid var(--border)' }}>
          <div style={row}>
            <span className="form-label">Agent</span>
            <input className="filter-select" list="payroll-adj-agents" value={form.agent} style={{ width: 170 }}
              onChange={(e) => setForm({ ...form, agent: e.target.value })} placeholder="Pick or type" />
            <datalist id="payroll-adj-agents">{agents.map((a) => <option key={a} value={a} />)}</datalist>
          </div>
          <div style={row}>
            <span className="form-label">Amount (+/−)</span>
            <input className="filter-select" type="number" step="0.01" style={{ width: 100 }} value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })} />
          </div>
          <div style={row}>
            <span className="form-label">Category</span>
            <select className="filter-select" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              {meta.adjustmentCategories.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
          </div>
          {form.category === 'prior_period_correction' && (
            <div style={row}>
              <span className="form-label">Corrects (MM.YYYY)</span>
              <input className="filter-select" style={{ width: 90 }} placeholder="MM.YYYY" value={form.correctsPeriod}
                onChange={(e) => setForm({ ...form, correctsPeriod: e.target.value })} />
            </div>
          )}
          {form.category === 'agent_repayment' && (
            <>
              <div style={row}>
                <span className="form-label">Received by</span>
                <select className="filter-select" value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })}>
                  {meta.paymentMethods.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
                </select>
              </div>
              <div style={row}>
                <span className="form-label">{form.method === 'check' ? 'Check #' : 'Reference #'}</span>
                <input className="filter-select" style={{ width: 100 }} value={form.reference}
                  onChange={(e) => setForm({ ...form, reference: e.target.value })} />
              </div>
              <div style={row}>
                <span className="form-label">Received on</span>
                <input className="filter-select" type="date" value={form.payDate}
                  onChange={(e) => setForm({ ...form, payDate: e.target.value })} />
              </div>
            </>
          )}
          <div style={{ ...row, flex: 1, minWidth: 180 }}>
            <span className="form-label">Reason (required)</span>
            <input className="filter-select" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
          </div>
          <button className="btn btn-primary" style={{ marginBottom: 10 }}
            disabled={busy || !form.agent.trim() || !form.reason.trim() || !Number(form.amount) || targetLocked
              || (form.category === 'agent_repayment' && Number(form.amount) < 0)}
            onClick={() => add({ ...form, amount: Number(form.amount), payDate: form.payDate || undefined })}>
            Add line
          </button>
          {form.category === 'agent_repayment' && (
            <div style={{ ...small, width: '100%' }}>
              Repayment: enter the amount the agent paid back as a positive number. It reduces their balance due and
              is saved in Payment records as money received.
            </div>
          )}
          {targetLocked && <div style={{ ...warnStyle, fontSize: 11, width: '100%' }}>{form.agent} is locked for {pl(period)}. Post it in an open month.</div>}
        </div>
      )}
      {closed && <div style={{ ...small, marginTop: 6 }}>🔒 {pl(period)} is closed — no new adjustments.</div>}

      {voiding && (
        <ReasonModal title={`Void ${fmt(voiding.amount)} for ${voiding.agent_name}`} confirmLabel="Void line" busy={busy} error={msg}
          onCancel={() => setVoiding(null)} onSubmit={voidOne} />
      )}
    </div>
  );
}

/** Payment records (method / reference) for Payment History. */
export function PaymentRecords() {
  const [rows, setRows] = useState([]);
  const [err, setErr] = useState('');
  useEffect(() => {
    apiFetch('/payroll-close/payments?limit=300').then((r) => setRows(r || [])).catch((e) => setErr(e.message));
  }, []);
  return (
    <div className="card" style={{ padding: 0, marginBottom: 14 }}>
      <div style={{ padding: '10px 14px', borderBottom: '0.5px solid var(--border)', fontSize: 13, fontWeight: 500 }}>
        Sent records <span style={{ ...small, marginLeft: 8, fontWeight: 400 }}>How each statement was sent (commissions / check / ACH)</span>
      </div>
      {err && <div style={{ padding: 10, ...red, fontSize: 12 }}>{err}</div>}
      {rows.length === 0 ? (
        <div style={{ padding: 16, ...small }}>No sent records yet. Marking an agent sent to commissions on Agent Payouts records one.</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Period</th><th>Agent</th><th>Amount</th><th>Payable</th><th>Method</th><th>Ref #</th><th>Date sent</th><th>Entered by</th><th>Status</th></tr></thead>
            <tbody>
              {rows.map((p) => {
                const amt = Number(p.payment_amount);
                const payable = p.amount_payable != null ? Number(p.amount_payable) : null;
                return (
                  <tr key={p.id} style={{ opacity: p.status === 'void' ? 0.5 : 1 }}>
                    <td style={{ fontSize: 12 }}>{p.payment_period ? pl(p.payment_period) : '—'}</td>
                    <td style={{ fontWeight: 500 }}>{p.agent_name}</td>
                    <td style={{ fontWeight: 500, color: p.kind === 'repayment' ? 'var(--red)' : 'var(--green)' }}>
                      {p.kind === 'repayment' ? `${fmt(-amt)} received from agent` : fmt(amt)}
                    </td>
                    <td style={{ fontSize: 12, ...(payable != null && Math.abs(payable - amt) >= 0.01 ? warnStyle : {}) }}>{payable != null ? fmt(payable) : '—'}</td>
                    <td style={{ fontSize: 12, textTransform: 'uppercase' }}>{p.payment_method || '—'}</td>
                    <td style={{ fontSize: 12 }}>{p.check_number || '—'}</td>
                    <td style={{ fontSize: 12 }}>{String(p.payment_date || '').slice(0, 10)}</td>
                    <td style={{ fontSize: 12 }}>{p.created_by || '—'}</td>
                    <td style={{ fontSize: 11 }}>{p.status === 'void' ? `void: ${p.void_reason || ''}` : (p.lock_status === 'locked' ? '🔒 locked' : 'active')}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** Monthly close checklist + deposit reconciliation for one period. */
export function MonthClosePanel({ period, meta, payeesForClose }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [noneFor, setNoneFor] = useState(null);
  const [reopening, setReopening] = useState(false);
  const [notes, setNotes] = useState('');

  async function load() {
    if (!period) return;
    setErr('');
    try { setData(await apiFetch(`/payroll-close/checklist?period=${encodeURIComponent(period)}`)); }
    catch (e) { setErr(e.message || 'Failed to load checklist'); setData(null); }
  }
  useEffect(() => { load(); }, [period]);

  async function markNone(reason) {
    setBusy(true);
    try {
      await apiFetch('/payroll-close/checklist/none', { method: 'POST', body: JSON.stringify({ period, carrier: noneFor, reason }) });
      setNoneFor(null); await load();
    } catch (e) { setErr(e.message); }
    setBusy(false);
  }
  async function removeNone(id) {
    try { await apiFetch(`/payroll-close/checklist/none/${id}/remove`, { method: 'POST' }); await load(); }
    catch (e) { setErr(e.message); }
  }
  async function closeMonth() {
    setBusy(true); setErr('');
    try {
      const payees = payeesForClose ? await payeesForClose() : [];
      await apiFetch('/payroll-close/close', { method: 'POST', body: JSON.stringify({ period, notes, payees }) });
      await load();
    } catch (e) { setErr(e.message || 'Close failed'); }
    setBusy(false);
  }
  async function reopen(reason) {
    setBusy(true);
    try { await apiFetch('/payroll-close/reopen', { method: 'POST', body: JSON.stringify({ period, reason }) }); setReopening(false); await load(); }
    catch (e) { setErr(e.message); }
    setBusy(false);
  }

  if (!period) return null;
  const close = data && data.close;
  return (
    <div>
      <div className="card" style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontWeight: 600, fontSize: 14 }}>Close checklist — {pl(period)}</div>
            <div style={small}>Every expected carrier needs a BSI statement upload, or a &quot;none this month&quot; mark with a reason.</div>
          </div>
          {close ? (
            <div style={{ fontSize: 12, textAlign: 'right' }}>
              <div style={{ color: 'var(--green)', fontWeight: 600 }}>🔒 Closed by {close.closed_by} · {when(close.closed_at)}</div>
              {meta.canUnlock && <button className="btn" style={{ fontSize: 11, padding: '3px 10px', marginTop: 4 }} onClick={() => setReopening(true)}>Reopen (admin)</button>}
            </div>
          ) : null}
        </div>
        {err && <div style={{ ...red, fontSize: 12, marginTop: 8 }}>{err}</div>}
        {!data ? <div style={{ ...small, padding: 10 }}>Loading…</div> : (
          <>
            <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse', marginTop: 10 }}>
              <thead><tr>{['Carrier', 'Status', 'Uploads', 'Records', 'Total', 'Flags', ''].map((h) => (
                <th key={h} style={{ textAlign: ['Records', 'Total'].includes(h) ? 'right' : 'left', padding: '5px 6px', ...small, borderBottom: '0.5px solid var(--border)' }}>{h}</th>
              ))}</tr></thead>
              <tbody>
                {data.carriers.map((c) => (
                  <tr key={c.carrier} style={{ borderBottom: '0.5px solid var(--border)' }}>
                    <td style={{ padding: '6px', fontWeight: 500 }}>{c.carrier}</td>
                    <td style={{ padding: '6px' }}>
                      {c.status === 'present' && <span style={{ color: 'var(--green)', fontWeight: 600 }}>✓ uploaded</span>}
                      {c.status === 'missing' && <span style={{ ...red, fontWeight: 600 }}>✗ missing</span>}
                      {c.status === 'none_this_month' && <span style={small}>none this month — {c.none.reason} ({c.none.entered_by})</span>}
                    </td>
                    <td style={{ padding: '6px', ...small }}>
                      {data.uploads.filter((u) => c.uploads.includes(u.id)).map((u) => <div key={u.id}>{u.name}</div>)}
                    </td>
                    <td style={{ padding: '6px', textAlign: 'right' }}>{c.recordCount || '—'}</td>
                    <td style={{ padding: '6px', textAlign: 'right' }}>{c.uploads.length ? fmt(c.total) : '—'}</td>
                    <td style={{ padding: '6px' }}>
                      {c.flags.zeroTotal && <div style={warnStyle}>⚠ $0 with records</div>}
                      {c.flags.carrierMismatch && <div style={warnStyle}>⚠ carrier ≠ file name</div>}
                    </td>
                    <td style={{ padding: '6px', textAlign: 'right' }}>
                      {!close && c.status === 'missing' && meta.isStaff && (
                        <button className="btn" style={{ fontSize: 10, padding: '2px 8px' }} onClick={() => setNoneFor(c.carrier)}>None this month</button>
                      )}
                      {!close && c.status === 'none_this_month' && meta.isStaff && (
                        <button className="btn" style={{ fontSize: 10, padding: '2px 8px' }} onClick={() => removeNone(c.none.id)}>Undo</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {data.warnings.length > 0 && (
              <div style={{ marginTop: 10, fontSize: 12 }}>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>Warnings (don&apos;t block closing)</div>
                {data.warnings.map((w, i) => <div key={i} style={warnStyle}>⚠ {formatPeriodsInText(w.message)}</div>)}
              </div>
            )}
            {!close && meta.isStaff && (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 12, paddingTop: 12, borderTop: '0.5px solid var(--border)', flexWrap: 'wrap' }}>
                <input className="filter-select" style={{ flex: 1, minWidth: 200 }} placeholder="Close notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
                <button className="btn btn-primary" disabled={busy || !data.canClose} onClick={closeMonth}
                  title={data.canClose ? 'Locks every payee for this month' : 'Resolve missing carriers first'}>
                  {busy ? 'Closing…' : 'Close month'}
                </button>
                {!data.canClose && <span style={{ ...red, fontSize: 12 }}>{data.blockers.length} carrier(s) missing</span>}
              </div>
            )}
            {(data.closeHistory || []).filter((h) => h.status === 'reopened').map((h) => (
              <div key={h.id} style={{ ...small, marginTop: 6 }}>
                Closed by {h.closed_by} {String(h.closed_at || '').slice(0, 10)} · reopened by {h.reopened_by} {String(h.reopened_at || '').slice(0, 10)}: {h.reopen_reason}
              </div>
            ))}
          </>
        )}
      </div>
      <DepositsPanel period={period} meta={meta} recon={data && data.deposits} onChanged={load} />
      {noneFor && (
        <ReasonModal title={`${noneFor}: none this month`} help="Use this when the carrier really sent nothing for this month."
          confirmLabel="Mark none" busy={busy} onCancel={() => setNoneFor(null)} onSubmit={markNone} />
      )}
      {reopening && (
        <ReasonModal title={`Reopen ${pl(period)}`} help="Payees locked by the close are unlocked. Months marked sent stay locked."
          confirmLabel="Reopen" busy={busy} onCancel={() => setReopening(false)} onSubmit={reopen} />
      )}
    </div>
  );
}

function emptyDeposit(period, payers) {
  return { id: null, depositDate: new Date().toISOString().slice(0, 10), payer: payers[0] || 'BSI', payerOther: '', amount: '', reference: '', memo: '', allocations: [{ period: pl(period), amount: '' }] };
}

/** THEI bank deposits vs what the uploaded statements say THEI should receive. */
export function DepositsPanel({ period, meta, recon, onChanged }) {
  const [form, setForm] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [editReason, setEditReason] = useState('');
  const [deposits, setDeposits] = useState([]);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function loadDeposits() {
    try { setDeposits(await apiFetch(`/payroll-close/deposits?period=${encodeURIComponent(period)}`)); } catch (e) { setErr(e.message); }
  }
  useEffect(() => { loadDeposits(); }, [period, recon]);

  async function save() {
    setBusy(true); setErr('');
    const allocations = form.allocations.filter((a) => a.period && Number(a.amount)).map((a) => ({ period: normalizePeriodInput(a.period), amount: Number(a.amount) }));
    const body = { depositDate: form.depositDate, payer: form.payer, payerOther: form.payerOther, amount: Number(form.amount), reference: form.reference, memo: form.memo, allocations };
    try {
      if (form.id) await apiFetch(`/payroll-close/deposits/${form.id}`, { method: 'PUT', body: JSON.stringify({ ...body, reason: editReason }) });
      else await apiFetch('/payroll-close/deposits', { method: 'POST', body: JSON.stringify(body) });
      setForm(null); setEditReason('');
      await onChanged();
    } catch (e) { setErr(e.message || 'Save failed'); }
    setBusy(false);
  }
  async function remove(reason) {
    setBusy(true);
    try { await apiFetch(`/payroll-close/deposits/${deleting.id}/delete`, { method: 'POST', body: JSON.stringify({ reason }) }); setDeleting(null); await onChanged(); }
    catch (e) { setErr(e.message); }
    setBusy(false);
  }
  function edit(d) {
    setForm({
      id: d.id, depositDate: d.deposit_date, payer: d.payer, payerOther: d.payer_other || '', amount: String(d.amount),
      reference: d.reference || '', memo: d.memo || '',
      allocations: d.allocations.length ? d.allocations.map((a) => ({ period: pl(a.payment_period), amount: String(a.amount) })) : [{ period: pl(period), amount: '' }],
    });
  }

  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontWeight: 600, fontSize: 14 }}>Deposit reconciliation — {pl(period)}</div>
          <div style={small}>
            Expected: BSI = THEI&apos;s share only (the split stored on each BSI statement line — BSI pays the agents
            directly); direct carriers = their statement totals. Received = THEI bank deposits tagged to this month.
          </div>
        </div>
        {meta.isStaff && !form && <button className="btn btn-primary" onClick={() => setForm(emptyDeposit(period, meta.payers))}>Add deposit</button>}
      </div>
      {err && <div style={{ ...red, fontSize: 12, marginTop: 8 }}>{err}</div>}
      {recon && (
        <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse', marginTop: 10 }}>
          <thead><tr>{['Payer', 'Expected', 'Received', 'Difference', ''].map((h) => (
            <th key={h} style={{ textAlign: h === 'Payer' ? 'left' : 'right', padding: '5px 6px', ...small, borderBottom: '0.5px solid var(--border)' }}>{h}</th>
          ))}</tr></thead>
          <tbody>
            {recon.rows.length === 0 && <tr><td colSpan={5} style={{ padding: 8, ...small }}>No statements or deposits for this month yet.</td></tr>}
            {recon.rows.map((r) => (
              <tr key={r.payer} style={{ borderBottom: '0.5px solid var(--border)' }}>
                <td style={{ padding: 6, fontWeight: 500 }}>
                  {r.payer}
                  {r.missingShareRows > 0 && <div style={{ ...warnStyle, fontSize: 11 }}>⚠ {r.missingShareRows} row(s) with no THEI share stored (counted as $0)</div>}
                </td>
                <td style={{ padding: 6, textAlign: 'right' }}>{fmt(r.expected)}</td>
                <td style={{ padding: 6, textAlign: 'right' }}>{fmt(r.received)}</td>
                <td style={{ padding: 6, textAlign: 'right', ...(r.ok ? {} : red) }}>{fmt(r.difference)}</td>
                <td style={{ padding: 6, textAlign: 'right', fontWeight: 700, color: r.ok ? 'var(--green)' : 'var(--red)' }}>{r.ok ? '✓' : '✗'}</td>
              </tr>
            ))}
            {recon.rows.length > 0 && (
              <tr><td style={{ padding: 6, fontWeight: 600 }}>Total</td>
                <td style={{ padding: 6, textAlign: 'right', fontWeight: 600 }}>{fmt(recon.totals.expected)}</td>
                <td style={{ padding: 6, textAlign: 'right', fontWeight: 600 }}>{fmt(recon.totals.received)}</td>
                <td style={{ padding: 6, textAlign: 'right', fontWeight: 600 }}>{fmt(recon.totals.difference)}</td><td /></tr>
            )}
          </tbody>
        </table>
      )}
      {recon && recon.unmatched.length > 0 && (
        <div style={{ marginTop: 10, fontSize: 12 }}>
          <div style={{ fontWeight: 600 }}>Unmatched deposits (not fully assigned to a month)</div>
          {recon.unmatched.map((u) => <div key={u.id} style={warnStyle}>⚠ {u.payer} {fmt(u.amount)} on {u.date}{u.reference ? ` ref ${u.reference}` : ''} — {fmt(u.unallocated)} unassigned</div>)}
        </div>
      )}
      {deposits.length > 0 && (
        <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse', marginTop: 12 }}>
          <thead><tr>{['Date', 'Payer', 'Amount', 'Months', 'Ref / memo', 'Entered by', ''].map((h) => (
            <th key={h} style={{ textAlign: 'left', padding: '5px 6px', ...small, borderBottom: '0.5px solid var(--border)' }}>{h}</th>
          ))}</tr></thead>
          <tbody>
            {deposits.map((d) => (
              <tr key={d.id} style={{ borderBottom: '0.5px solid var(--border)' }}>
                <td style={{ padding: 6 }}>{d.deposit_date}</td>
                <td style={{ padding: 6 }}>{d.payer === 'Other' ? d.payer_other : d.payer}</td>
                <td style={{ padding: 6 }}>{fmt(d.amount)}</td>
                <td style={{ padding: 6, ...small }}>{d.allocations.map((a) => `${pl(a.payment_period)}: ${fmt(a.amount)}`).join(' · ') || 'unassigned'}</td>
                <td style={{ padding: 6, ...small }}>{[d.reference, d.memo].filter(Boolean).join(' · ')}</td>
                <td style={{ padding: 6, ...small }}>{d.entered_by}</td>
                <td style={{ padding: 6, textAlign: 'right', whiteSpace: 'nowrap' }}>
                  {meta.isStaff && <>
                    <button className="btn" style={{ fontSize: 10, padding: '2px 8px', marginRight: 4 }} onClick={() => edit(d)}>Edit</button>
                    <button className="btn btn-danger" style={{ fontSize: 10, padding: '2px 8px' }} onClick={() => setDeleting(d)}>Delete</button>
                  </>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {form && (
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: '0.5px solid var(--border)' }}>
          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>{form.id ? 'Edit deposit' : 'New deposit'}</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <div style={row}><span className="form-label">Deposit date</span>
              <input className="filter-select" type="date" value={form.depositDate} onChange={(e) => setForm({ ...form, depositDate: e.target.value })} /></div>
            <div style={row}><span className="form-label">Payer</span>
              <select className="filter-select" value={form.payer} onChange={(e) => setForm({ ...form, payer: e.target.value })}>
                {meta.payers.map((p) => <option key={p} value={p}>{p}</option>)}
              </select></div>
            {form.payer === 'Other' && <div style={row}><span className="form-label">Payer name</span>
              <input className="filter-select" value={form.payerOther} onChange={(e) => setForm({ ...form, payerOther: e.target.value })} /></div>}
            <div style={row}><span className="form-label">Amount</span>
              <input className="filter-select" type="number" step="0.01" style={{ width: 110 }} value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></div>
            <div style={row}><span className="form-label">Reference #</span>
              <input className="filter-select" value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} /></div>
            <div style={{ ...row, flex: 1, minWidth: 160 }}><span className="form-label">Memo</span>
              <input className="filter-select" value={form.memo} onChange={(e) => setForm({ ...form, memo: e.target.value })} /></div>
          </div>
          <div style={{ fontSize: 12, fontWeight: 500, margin: '4px 0' }}>Months this deposit covers</div>
          {form.allocations.map((a, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
              <input className="filter-select" placeholder="MM.YYYY" style={{ width: 100 }} value={a.period}
                onChange={(e) => { const al = form.allocations.slice(); al[i] = { ...a, period: e.target.value }; setForm({ ...form, allocations: al }); }} />
              <input className="filter-select" type="number" step="0.01" placeholder="Amount" style={{ width: 110 }} value={a.amount}
                onChange={(e) => { const al = form.allocations.slice(); al[i] = { ...a, amount: e.target.value }; setForm({ ...form, allocations: al }); }} />
              {form.allocations.length > 1 && <button className="btn" style={{ fontSize: 10 }} onClick={() => setForm({ ...form, allocations: form.allocations.filter((_, j) => j !== i) })}>✕</button>}
            </div>
          ))}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <button className="btn" style={{ fontSize: 11 }} onClick={() => setForm({ ...form, allocations: form.allocations.concat([{ period: '', amount: '' }]) })}>+ Split to another month</button>
            <span style={small}>
              Assigned {fmt(form.allocations.reduce((s, a) => s + (Number(a.amount) || 0), 0))} of {fmt(Number(form.amount) || 0)}
            </span>
            {form.allocations.length === 1 && !form.allocations[0].amount && Number(form.amount) > 0 && (
              <button className="btn" style={{ fontSize: 11 }} onClick={() => setForm({ ...form, allocations: [{ period: form.allocations[0].period || pl(period), amount: form.amount }] })}>Assign all to {form.allocations[0].period || pl(period)}</button>
            )}
          </div>
          {form.id && (
            <div style={{ ...row, marginTop: 8 }}><span className="form-label">Reason for the edit (required)</span>
              <input className="filter-select" value={editReason} onChange={(e) => setEditReason(e.target.value)} /></div>
          )}
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button className="btn" onClick={() => { setForm(null); setEditReason(''); }}>Cancel</button>
            <button className="btn btn-primary" disabled={busy || (form.id && !editReason.trim())} onClick={save}>{busy ? 'Saving…' : 'Save deposit'}</button>
          </div>
        </div>
      )}
      {deleting && (
        <ReasonModal title={`Delete ${fmt(deleting.amount)} deposit from ${deleting.payer === 'Other' ? deleting.payer_other : deleting.payer}`}
          confirmLabel="Delete deposit" busy={busy} onCancel={() => setDeleting(null)} onSubmit={remove} />
      )}
    </div>
  );
}

const LOG_TYPES = [
  { key: '', label: 'All events' },
  { key: 'upload', label: 'Uploads (created / deleted / renamed)' },
  { key: 'record', label: 'Record edits / deletes' },
  { key: 'payroll', label: 'Payroll (lock, adjustments, payments, close)' },
  { key: 'statement', label: 'Statements' },
  { key: 'deposit', label: 'Deposits' },
];

/** Change log viewer with user / type / period filters. */
export function ChangeLogPanel({ defaultPeriod }) {
  const [filters, setFilters] = useState({ type: '', user: '', period: defaultPeriod || '', q: '' });
  const [data, setData] = useState({ entries: [], users: [] });
  const [err, setErr] = useState('');
  const [open, setOpen] = useState(null);

  async function load() {
    setErr('');
    const qs = Object.keys(filters).filter((k) => filters[k])
      .map((k) => `${k}=${encodeURIComponent(k === 'period' ? normalizePeriodInput(filters[k]) : filters[k])}`).join('&');
    try { setData(await apiFetch(`/change-log?limit=300${qs ? '&' + qs : ''}`)); }
    catch (e) { setErr(e.message || 'Failed to load change log'); }
  }
  useEffect(() => { load(); }, [filters.type, filters.user, filters.period]);

  return (
    <div className="card" style={{ padding: 0 }}>
      <div style={{ padding: '10px 14px', borderBottom: '0.5px solid var(--border)', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div style={row}><span className="form-label">Type</span>
          <select className="filter-select" value={filters.type} onChange={(e) => setFilters({ ...filters, type: e.target.value })}>
            {LOG_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
          </select></div>
        <div style={row}><span className="form-label">User</span>
          <select className="filter-select" value={filters.user} onChange={(e) => setFilters({ ...filters, user: e.target.value })}>
            <option value="">Everyone</option>
            {data.users.map((u) => <option key={u} value={u}>{u}</option>)}
          </select></div>
        <div style={row}><span className="form-label">Period (MM.YYYY)</span>
          <input className="filter-select" style={{ width: 100 }} placeholder="MM.YYYY" value={filters.period} onChange={(e) => setFilters({ ...filters, period: e.target.value.trim() })} /></div>
        <div style={{ ...row, flex: 1, minWidth: 160 }}><span className="form-label">Search</span>
          <input className="filter-select" value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') load(); }} /></div>
        <button className="btn" style={{ marginBottom: 10 }} onClick={load}>Refresh</button>
      </div>
      {err && <div style={{ padding: 10, ...red, fontSize: 12 }}>{err}</div>}
      {data.entries.length === 0 ? (
        <div style={{ padding: 16, ...small }}>No changes recorded for these filters. (Logging starts when this update is deployed.)</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>When</th><th>User</th><th>Event</th><th>Period</th><th>What happened</th></tr></thead>
            <tbody>
              {data.entries.map((e) => (
                <React.Fragment key={e.id}>
                  <tr style={{ cursor: e.details ? 'pointer' : 'default' }} onClick={() => setOpen(open === e.id ? null : e.id)}>
                    <td style={{ fontSize: 11, whiteSpace: 'nowrap' }}>{when(e.created_at)}</td>
                    <td style={{ fontSize: 12 }}>{e.actor || '—'}</td>
                    <td style={{ fontSize: 11 }}>{e.event_type}</td>
                    <td style={{ fontSize: 11 }}>{e.payment_period ? pl(e.payment_period) : '—'}</td>
                    <td style={{ fontSize: 12 }}>{formatPeriodsInText(e.summary)}</td>
                  </tr>
                  {open === e.id && e.details && (
                    <tr><td colSpan={5}><pre style={{ fontSize: 10, whiteSpace: 'pre-wrap', margin: 0 }}>{JSON.stringify(e.details, null, 2)}</pre></td></tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
