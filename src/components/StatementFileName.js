import React from 'react';
import { statementDisplayName } from '../utils/statementDisplayName';

export default function StatementFileName({ filename, category, as = 'div' }) {
  const name = String(filename || '');
  const label = statementDisplayName(name, { category });
  const showOriginal = Boolean(name) && label !== name && !name.startsWith(label);
  const Tag = as;
  return (
    <Tag>
      <div style={{ fontWeight: 600 }}>{label || name || '—'}</div>
      {showOriginal && (
        <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 400, marginTop: 2, wordBreak: 'break-word' }}>
          {name}
        </div>
      )}
    </Tag>
  );
}
