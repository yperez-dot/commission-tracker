import React, { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../api';

function fmt(n) {
  return '$' + Number(Math.abs(n || 0)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatPeriod(p) {
  if (!p || !String(p).match(/^\d{6}$/)) return p || '—';
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[parseInt(p.slice(4, 6), 10) - 1]} ${p.slice(0, 4)}`;
}

const C = {
  bg: '#FAF8F5',
  card: '#FFFFFF',
  border: '#E8E0D4',
  text: '#1A1209',
  textMuted: '#6B5E52',
  accent: '#C9A96E',
  red: '#A32D2D',
  green: '#3B6D11',
};

export default function PassThroughChargebacks({ user }) {
  const [loading, setLoading] = useState(true);
  const [backfilling, setBackfilling] = useState(false);
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState([]);
  const [periods, setPeriods] = useState([]);
  const [agents, setAgents] = useState([]);
  const [selPeriod, setSelPeriod] = useState('');
  const [selAgent, setSelAgent] = useState('');
  const [collectedFilter, setCollectedFilter] = useState('no');
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams();
      if (selPeriod) p.set('period', selPeriod);
      if (selAgent) p.set('agent', selAgent);
      if (collectedFilter !== 'all') p.set('collected', collectedFilter);
      const data = await apiFetch(`/pass-through/chargebacks?${p}`);
      setRows(data.rows || []);
      setSummary(data.summary || []);
      setPeriods(data.periods || []);
      setAgents(data.agents || []);
    } catch (e) {
      console.error(e);
      setMessage(e.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [selPeriod, selAgent, collectedFilter]);

  useEffect(() => { load(); }, [load]);

  async function runBackfill(dryRun) {
    setBackfilling(true);
    setMessage('');
    try {
      const data = await apiFetch(`/pass-through/backfill${dryRun ? '?dryRun=1' : ''}`, { method: 'POST' });
      setMessage(
        dryRun
          ? `Preview: ${data.matched} chargeback(s) would be tagged (${data.scanned} scanned).`
          : `Tagged ${data.updated} chargeback(s) with liable agent (${data.matched} matched).`
      );
      if (!dryRun) await load();
    } catch (e) {
      setMessage(e.message || 'Backfill failed');
    } finally {
      setBackfilling(false);
    }
  }

  async function toggleCollected(row) {
    try {
      await apiFetch(`/pass-through/collections/${row.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ collected: !row.pass_through_collected }),
      });
      await load();
    } catch (e) {
      setMessage(e.message || 'Update failed');
    }
  }

  const totalOutstanding = summary.reduce((s, r) => s + parseFloat(r.total_outstanding || 0), 0);

  if (user.role !== 'admin') {
    return (
      <div style={{ padding: 24, color: C.textMuted }}>
        Admin access required.
      </div>
    );
  }

  return (
    <div style={{ padding: '24px 28px', background: C.bg, minHeight: '100vh' }}>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 600, color: C.text }}>Writer Pass-Through Chargebacks</h1>
        <p style={{ margin: '6px 0 0', fontSize: 13, color: C.textMuted, maxWidth: 720 }}>
          When a downline agent writes on your UHC / house number and their client cancels, the carrier chargeback hits you.
          This report shows what each agent owes you back. Alan = Katy&apos;s client list. Sabri = MedicarePro sale agent match.
        </p>
      </div>

      {message && (
        <div style={{ marginBottom: 16, padding: '10px 14px', background: '#F5EDD4', borderRadius: 8, fontSize: 13, color: '#6B4E0A' }}>
          {message}
        </div>
      )}

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16, alignItems: 'center' }}>
        <select value={selPeriod} onChange={(e) => setSelPeriod(e.target.value)} style={selectStyle}>
          <option value="">All periods</option>
          {periods.map((p) => (
            <option key={p} value={p}>{formatPeriod(p)}</option>
          ))}
        </select>
        <select value={selAgent} onChange={(e) => setSelAgent(e.target.value)} style={selectStyle}>
          <option value="">All agents</option>
          {agents.map((a) => (
            <option key={a} value={a}>{a}</option>
          ))}
        </select>
        <select value={collectedFilter} onChange={(e) => setCollectedFilter(e.target.value)} style={selectStyle}>
          <option value="no">Outstanding only</option>
          <option value="yes">Collected</option>
          <option value="all">All</option>
        </select>
        <button type="button" onClick={() => runBackfill(true)} disabled={backfilling} style={btnSecondary}>
          Preview tag
        </button>
        <button type="button" onClick={() => runBackfill(false)} disabled={backfilling} style={btnPrimary}>
          {backfilling ? 'Running…' : 'Tag chargebacks'}
        </button>
      </div>

      {summary.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 20 }}>
          {summary.map((s) => (
            <div key={s.liable_agent} style={cardStyle}>
              <div style={{ fontSize: 11, color: C.textMuted, textTransform: 'uppercase', letterSpacing: 0.4 }}>{s.liable_agent}</div>
              <div style={{ fontSize: 20, fontWeight: 600, color: C.red, marginTop: 4 }}>{fmt(s.total_outstanding)}</div>
              <div style={{ fontSize: 12, color: C.textMuted, marginTop: 2 }}>
                owed · {s.chargeback_count} CB · collected {fmt(s.total_collected)}
              </div>
            </div>
          ))}
          <div style={{ ...cardStyle, borderColor: C.accent }}>
            <div style={{ fontSize: 11, color: C.textMuted, textTransform: 'uppercase' }}>Total outstanding</div>
            <div style={{ fontSize: 20, fontWeight: 600, color: C.red, marginTop: 4 }}>{fmt(totalOutstanding)}</div>
          </div>
        </div>
      )}

      <div style={{ ...cardStyle, padding: 0, overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: 24, color: C.textMuted }}>Loading…</div>
        ) : rows.length === 0 ? (
          <div style={{ padding: 24, color: C.textMuted }}>
            No pass-through chargebacks found. Run &quot;Tag chargebacks&quot; to attribute historical UHC chargebacks on house writing.
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#F3EDE4', textAlign: 'left' }}>
                {['Period', 'Liable agent', 'Client', 'Writing agent', 'Carrier', 'Amount', 'Collected', ''].map((h) => (
                  <th key={h} style={{ padding: '10px 12px', fontWeight: 600, color: C.textMuted, fontSize: 11, textTransform: 'uppercase' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} style={{ borderTop: `1px solid ${C.border}` }}>
                  <td style={{ padding: '9px 12px' }}>{formatPeriod(r.payment_period)}</td>
                  <td style={{ padding: '9px 12px', fontWeight: 500 }}>{r.liable_agent}</td>
                  <td style={{ padding: '9px 12px' }}>{r.client_full_name}</td>
                  <td style={{ padding: '9px 12px', color: C.textMuted }}>{r.writing_agent}</td>
                  <td style={{ padding: '9px 12px' }}>{r.carrier}</td>
                  <td style={{ padding: '9px 12px', color: C.red, fontWeight: 500 }}>-{fmt(r.commission)}</td>
                  <td style={{ padding: '9px 12px' }}>
                    {r.pass_through_collected ? (
                      <span style={{ color: C.green, fontWeight: 500 }}>Yes</span>
                    ) : (
                      <span style={{ color: C.red }}>No</span>
                    )}
                  </td>
                  <td style={{ padding: '9px 12px' }}>
                    <button type="button" onClick={() => toggleCollected(r)} style={btnSmall}>
                      {r.pass_through_collected ? 'Mark unpaid' : 'Mark collected'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

const cardStyle = {
  background: C.card,
  border: `1px solid ${C.border}`,
  borderRadius: 10,
  padding: '14px 16px',
};

const selectStyle = {
  padding: '8px 10px',
  borderRadius: 6,
  border: `1px solid ${C.border}`,
  fontSize: 13,
  background: '#fff',
};

const btnPrimary = {
  padding: '8px 14px',
  borderRadius: 6,
  border: 'none',
  background: '#3D2B1F',
  color: '#fff',
  fontSize: 13,
  cursor: 'pointer',
};

const btnSecondary = {
  ...btnPrimary,
  background: '#fff',
  color: '#3D2B1F',
  border: `1px solid ${C.border}`,
};

const btnSmall = {
  padding: '4px 10px',
  borderRadius: 5,
  border: `1px solid ${C.border}`,
  background: '#fff',
  fontSize: 12,
  cursor: 'pointer',
};
