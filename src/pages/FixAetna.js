import React, { useState } from 'react';
import { apiFetch } from '../api';

export default function FixAetna() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  async function runFix() {
    setLoading(true);
    setError(null);
    setResult(null);
    
    try {
      const data = await apiFetch('/files/fix-aetna-classifications', {
        method: 'POST'
      });
      setResult(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <div className="page-header">
        <div className="page-title">🔧 Fix Aetna Classifications</div>
        <div className="page-sub">Update incorrect "New Business" → "Renewal" for January 2026 Aetna statement</div>
      </div>

      <div className="page-body">
        <div className="card">
          <div className="card-title">Aetna January 2026 Statement Fix</div>
          
          <div style={{marginBottom: 16, color: 'var(--text-muted)'}}>
            <p>This will update Aetna records where:</p>
            <ul style={{paddingLeft: 20, marginTop: 8}}>
              <li>Period = 202601 (January 2026 payment)</li>
              <li>Effective date is NOT in January 2026</li>
              <li>Currently classified as "New Business"</li>
            </ul>
            <p style={{marginTop: 12}}>
              <strong>Expected changes:</strong> ~12 records from "New Business" → "Renewal"
            </p>
          </div>

          <button 
            className="btn btn-primary" 
            onClick={runFix}
            disabled={loading}
            style={{marginBottom: 16}}
          >
            {loading ? '⏳ Fixing...' : '🔧 Fix Classifications Now'}
          </button>

          {error && (
            <div style={{padding: 12, background: 'var(--red-light)', border: '1px solid var(--red)', borderRadius: 6, marginTop: 12}}>
              <div style={{color: 'var(--red-dark)', fontWeight: 500}}>❌ Error: {error}</div>
            </div>
          )}

          {result && (
            <div style={{padding: 12, background: 'var(--green-light)', border: '1px solid var(--green)', borderRadius: 6, marginTop: 12}}>
              <div style={{color: 'var(--green-dark)', fontWeight: 500, marginBottom: 8}}>
                ✅ {result.message}
              </div>
              {result.records && result.records.length > 0 && (
                <div style={{marginTop: 12}}>
                  <div style={{fontWeight: 500, marginBottom: 8}}>Updated records:</div>
                  <ul style={{paddingLeft: 20, fontSize: 13}}>
                    {result.records.map(r => (
                      <li key={r.id}>
                        {r.client_full_name} - {r.effective_date} - ${r.commission}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
