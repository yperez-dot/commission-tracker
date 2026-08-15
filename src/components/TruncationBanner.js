import React from 'react';

/** Amber banner when a recon/payroll dataset was truncated. */
export default function TruncationBanner({ message }) {
  if (!message) return null;
  return (
    <div
      role="alert"
      style={{
        marginBottom: 12,
        padding: '10px 14px',
        borderRadius: 8,
        border: '1px solid #E0B84A',
        background: '#FFF8E6',
        color: '#5C4813',
        fontSize: 13,
        lineHeight: 1.4,
      }}
    >
      <strong style={{ fontWeight: 600 }}>Incomplete data loaded. </strong>
      {message}
    </div>
  );
}
