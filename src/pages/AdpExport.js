import React, { useEffect, useState } from 'react';
import { apiFetch } from '../api';
import { buildAdpCsv } from '../adpExport';

function fmt(n) {
  return '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function downloadCsv(filename, producers) {
  const blob = new Blob([buildAdpCsv(producers)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function AdpExport({ user }) {
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(String(currentYear));
  const [period, setPeriod] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [data, setData] = useState(null);

  const years = [];
  for (let y = currentYear; y >= currentYear - 4; y -= 1) years.push(String(y));

  async function load() {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (period.trim()) params.set('period', period.trim());
      else params.set('year', year);
      const result = await apiFetch(`/records/adp-payable?${params}`);
      setData(result);
    } catch (e) {
      setError(e.message || 'Failed to load ADP totals');
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year]);

  const producers = data?.producers || [];
  const label = period.trim() || `${year} (all months)`;

  return (
    <div>
      <div className="page-header">
        <div className="page-title">ADP / 1099 Export</div>
        <div className="page-sub">Producer payable totals for payroll and year-end reporting</div>
      </div>
      <div className="page-body">
        <div className="card" style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12, lineHeight: 1.45 }}>
            Totals use <code>producer_payable &gt; 0</code> from commission records
            {user?.agency ? ` for ${user.agency}` : ''}. Use year for 1099-style annual rollups, or a YYYYMM period for one payroll month.
          </div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div>
              <div className="form-label">Year</div>
              <select
                className="filter-select"
                value={year}
                disabled={!!period.trim()}
                onChange={(e) => setYear(e.target.value)}
                style={{ minWidth: 120 }}
              >
                {years.map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </div>
            <div>
              <div className="form-label">Or period (YYYYMM)</div>
              <input
                className="filter-select"
                style={{ width: 140, cursor: 'text' }}
                placeholder="e.g. 202607"
                value={period}
                onChange={(e) => setPeriod(e.target.value)}
              />
            </div>
            <button className="btn btn-primary" onClick={load} disabled={loading}>
              {loading ? 'Loading…' : 'Refresh'}
            </button>
            {producers.length > 0 && (
              <button
                className="btn"
                onClick={() => downloadCsv(
                  `ADP_payable_${(period.trim() || year)}.csv`,
                  producers
                )}
              >
                Export CSV
              </button>
            )}
          </div>
        </div>

        {error && (
          <div className="card" style={{ marginBottom: 14, borderColor: '#E5C8B8', background: '#F5EAE4', color: '#7A3D1F', fontSize: 13 }}>
            {error}
          </div>
        )}

        {loading && !data ? (
          <div className="card">
            <div className="empty-state">
              <div className="empty-title" style={{ color: 'var(--text-muted)' }}>Loading…</div>
            </div>
          </div>
        ) : (
          <div className="card" style={{ padding: 0 }}>
            <div style={{ padding: '12px 16px', borderBottom: '0.5px solid var(--border)', fontSize: 13 }}>
              <strong>{label}</strong>
              {data?.totals && (
                <span style={{ color: 'var(--text-muted)', marginLeft: 10 }}>
                  {data.totals.producer_count} producers · {data.totals.record_count.toLocaleString()} rows ·{' '}
                  <span style={{ color: 'var(--green)', fontWeight: 600 }}>{fmt(data.totals.gross)}</span>
                </span>
              )}
            </div>
            {producers.length === 0 ? (
              <div className="empty-state">
                <div className="empty-title">No producer payables</div>
                <div className="empty-sub">No rows with producer_payable &gt; 0 for this filter</div>
              </div>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Agent</th>
                      <th style={{ textAlign: 'right' }}>Records</th>
                      <th style={{ textAlign: 'right' }}>Total payable</th>
                    </tr>
                  </thead>
                  <tbody>
                    {producers.map((p, i) => (
                      <tr key={p.name + i}>
                        <td style={{ color: 'var(--text-muted)', fontSize: 12 }}>{i + 1}</td>
                        <td style={{ fontWeight: 500 }}>{p.name}</td>
                        <td style={{ textAlign: 'right', fontSize: 12 }}>{p.record_count}</td>
                        <td style={{ textAlign: 'right', fontWeight: 600, color: 'var(--green)' }}>{fmt(p.total_payable)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr style={{ background: 'var(--bg-subtle)', fontWeight: 600 }}>
                      <td colSpan={2} style={{ padding: '10px 12px' }}>Total</td>
                      <td style={{ textAlign: 'right', padding: '10px 12px' }}>{data?.totals?.record_count || 0}</td>
                      <td style={{ textAlign: 'right', padding: '10px 12px', color: 'var(--green)' }}>{fmt(data?.totals?.gross)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
