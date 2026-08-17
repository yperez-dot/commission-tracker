import React from 'react';
import { analyzeClientFightHistory } from '../utils/clientFightAnalysis';

function fmt(n) {
  return '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function confidenceColor(conf) {
  const c = String(conf || '').toUpperCase();
  if (c === 'HIGH') return '#1B6B3A';
  if (c === 'MEDIUM') return '#8A5A00';
  return '#7A3D1F';
}

function bucketBadgeStyle(bucket) {
  if (bucket === 'A') {
    return { background: '#EDE8F5', color: '#4A2D7A', border: '0.5px solid #C9B8E8' };
  }
  return { background: '#E8F2ED', color: '#1B6B3A', border: '0.5px solid #B8D9C8' };
}

export default function ClientFightPanel({ client, carrier, rows }) {
  const analysis = analyzeClientFightHistory({ client, carrier, rows });

  if (!analysis.hasFight) {
    if (!rows?.length) return null;
    return (
      <div
        style={{
          marginBottom: 16,
          padding: '12px 14px',
          borderRadius: 8,
          background: 'var(--bg-muted, #f7f7f7)',
          border: '0.5px solid var(--border)',
          fontSize: 12,
          color: 'var(--text-muted)',
        }}
      >
        No carrier or THEI fight detected from this history. If you expect a claw or missing pay, check Same agent only or add rows from other uploads.
      </div>
    );
  }

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>
        Fight analysis
      </div>

      {analysis.fights.map((fight, idx) => (
        <div
          key={`${fight.bucket}-${idx}`}
          style={{
            padding: '14px 16px',
            borderRadius: 10,
            border: '0.5px solid var(--border)',
            background: fight.inOfficialPacket ? '#F4FAF6' : '#FFFAF0',
            marginBottom: idx < analysis.fights.length - 1 ? 10 : 0,
          }}
        >
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 10 }}>
            <span
              style={{
                fontSize: 10,
                fontWeight: 600,
                letterSpacing: '0.4px',
                textTransform: 'uppercase',
                padding: '3px 8px',
                borderRadius: 999,
                ...bucketBadgeStyle(fight.bucket),
              }}
            >
              {fight.bucketLabel}
            </span>
            <span style={{ fontSize: 12, fontWeight: 600 }}>{fight.fightTypePlain}</span>
            <span
              style={{
                fontSize: 10,
                fontWeight: 600,
                color: confidenceColor(fight.confidence),
                marginLeft: 'auto',
              }}
            >
              {fight.confidence} confidence
            </span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 10, fontSize: 12 }}>
            <div>
              <div style={{ color: 'var(--text-muted)', fontSize: 10, marginBottom: 2 }}>Carrier ask (BSI)</div>
              <div style={{ fontWeight: 600, fontSize: 15, color: 'var(--red)' }}>{fmt(fight.amount)}</div>
            </div>
            <div>
              <div style={{ color: 'var(--text-muted)', fontSize: 10, marginBottom: 2 }}>THEI when paid</div>
              <div style={{ fontWeight: 500 }}>{fmt(fight.theiShare)}</div>
            </div>
            <div>
              <div style={{ color: 'var(--text-muted)', fontSize: 10, marginBottom: 2 }}>BSI when paid</div>
              <div style={{ fontWeight: 500 }}>{fmt(fight.bsiShare)}</div>
            </div>
            <div>
              <div style={{ color: 'var(--text-muted)', fontSize: 10, marginBottom: 2 }}>Issue code</div>
              <div style={{ fontWeight: 500, fontFamily: 'monospace', fontSize: 11 }}>{fight.errorCode || '—'}</div>
            </div>
          </div>

          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>
            {fight.inOfficialPacket ? (
              <span style={{ color: '#1B6B3A', fontWeight: 500 }}>✓ In official 111-row carrier packet</span>
            ) : (
              <span style={{ color: '#8A5A00', fontWeight: 500 }}>⚠ Not in official packet yet — review before emailing carrier</span>
            )}
            {fight.detectedAmount != null && fight.detectedAmount !== fight.amount && (
              <span> · History detected {fmt(fight.detectedAmount)}</span>
            )}
          </div>

          {fight.proof && (
            <div style={{ fontSize: 11, marginBottom: 8, lineHeight: 1.45 }}>
              <strong style={{ color: 'var(--text-muted)', fontWeight: 500 }}>Proof: </strong>
              {fight.proof}
            </div>
          )}

          {fight.askCarrier && fight.bucket === 'C' && (
            <div
              style={{
                fontSize: 11,
                lineHeight: 1.45,
                padding: '8px 10px',
                borderRadius: 6,
                background: 'rgba(255,255,255,0.7)',
                border: '0.5px solid var(--border)',
              }}
            >
              <strong style={{ color: 'var(--text-muted)', fontWeight: 500 }}>Ask carrier: </strong>
              {fight.askCarrier}
            </div>
          )}

          {fight.note && (
            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 8 }}>{fight.note}</div>
          )}
        </div>
      ))}

      {(analysis.carrierFight?.paid > 0 || analysis.carrierFight?.clawed > 0) && (
        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 6 }}>
          BSI stmt net: paid {fmt(analysis.carrierFight.paid)} · clawed {fmt(analysis.carrierFight.clawed)} · net {fmt(analysis.carrierFight.net)}
          {analysis.theiFight?.overrideRows?.length > 0 && (
            <span> · THEI remittance net {fmt(analysis.theiFight.net)}</span>
          )}
        </div>
      )}
    </div>
  );
}
