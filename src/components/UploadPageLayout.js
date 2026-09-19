import React from 'react';

const DROP_INNER = {
  borderRadius: 8,
  padding: '32px 20px',
  textAlign: 'center',
  transition: 'all 0.2s',
};

const CHOOSE_BTN = {
  background: 'var(--blue)',
  color: '#fff',
  borderRadius: 6,
  padding: '8px 20px',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
  display: 'inline-block',
};

/**
 * Shared chrome for the four Uploads tabs.
 * Header + body match Commission Statements / rest of OliComm.
 */
export function UploadPageShell({ title, subtitle, children }) {
  return (
    <div>
      <div className="page-header">
        <div className="page-title">{title}</div>
        <div className="page-sub">{subtitle}</div>
      </div>
      <div className="page-body">{children}</div>
    </div>
  );
}

export function UploadDropZone({
  dragOver,
  setDragOver,
  onDropFiles,
  uploading,
  dropTitle,
  dropHint,
  accept,
  multiple = false,
  inputId,
  processingLabel = 'Processing file...',
  processingHint = 'Detecting columns and parsing records',
}) {
  function onDragOver(e) {
    e.preventDefault();
    setDragOver(true);
  }
  function onDragLeave() {
    setDragOver(false);
  }
  function onDrop(e) {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files || []);
    if (files.length) onDropFiles(multiple ? files : files.slice(0, 1));
  }
  function onPick(e) {
    const files = Array.from(e.target.files || []);
    if (files.length) onDropFiles(multiple ? files : files.slice(0, 1));
    e.target.value = '';
  }

  return (
    <div
      className="card"
      style={{ marginBottom: 16 }}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div
        style={{
          ...DROP_INNER,
          border: `2px dashed ${dragOver ? 'var(--blue)' : 'var(--border)'}`,
          background: dragOver ? 'var(--blue-light)' : 'transparent',
        }}
      >
        {uploading ? (
          <div>
            <div style={{ fontSize: 14, fontWeight: 600 }}>{processingLabel}</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>{processingHint}</div>
          </div>
        ) : (
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>{dropTitle}</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>{dropHint}</div>
            <label style={CHOOSE_BTN}>
              Choose file{multiple ? 's' : ''}
              <input
                id={inputId}
                type="file"
                accept={accept}
                multiple={multiple}
                style={{ display: 'none' }}
                onChange={onPick}
              />
            </label>
          </div>
        )}
      </div>
    </div>
  );
}

export function UploadAlert({ kind = 'error', title, children }) {
  const styles =
    kind === 'success'
      ? { background: '#EAF3DE', border: '1px solid #C0DD97', color: '#3B6D11' }
      : { background: '#FCE8E8', border: '1px solid #F7C1C1', color: '#A32D2D' };
  return (
    <div style={{ ...styles, borderRadius: 8, padding: '10px 14px', marginBottom: 12, fontSize: 13 }}>
      {title ? <div style={{ fontWeight: 700, marginBottom: 4 }}>{title}</div> : null}
      {children}
    </div>
  );
}

export function UploadHistoryCard({ title, children }) {
  return (
    <div className="card" style={{ padding: 0 }}>
      {title ? (
        <div
          style={{
            padding: '12px 16px',
            borderBottom: '1px solid var(--border)',
            fontSize: 14,
            fontWeight: 600,
          }}
        >
          {title}
        </div>
      ) : null}
      {children}
    </div>
  );
}

/**
 * Generic record-preview modal — shared by every Uploads tab so none of them
 * hand-roll a DOM innerHTML modal (no React event handling, and every field
 * gets interpolated into markup unescaped) or duplicate the same modal chrome
 * five times over. `columns` describes what to show; `rows` is any array of
 * record objects — the caller's `render(row, i)` decides how each cell reads.
 */
export function UploadRecordPreviewModal({
  open,
  onClose,
  title,
  subtitle,
  loading,
  columns,
  rows,
  emptyLabel = 'No records found',
  footer,
}) {
  if (!open) return null;
  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'var(--bg, #fff)', borderRadius: 12, width: '90%', maxWidth: 1000,
          maxHeight: '85vh', display: 'flex', flexDirection: 'column',
          boxShadow: '0 8px 40px rgba(0,0,0,0.25)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15 }}>{title}</div>
            {subtitle ? <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{subtitle}</div> : null}
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--text-muted)', padding: '0 4px' }}>✕</button>
        </div>
        <div style={{ overflowY: 'auto', flex: 1 }}>
          {loading ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>Loading records...</div>
          ) : !rows || rows.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>{emptyLabel}</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead style={{ position: 'sticky', top: 0, background: '#f8f9fa', zIndex: 1 }}>
                <tr>
                  {columns.map((c) => (
                    <th
                      key={c.key}
                      style={{ padding: '8px 12px', textAlign: c.align || 'left', fontWeight: 600, fontSize: 11, color: 'var(--text-muted)', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}
                    >
                      {c.header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.id != null ? r.id : i} style={{ borderBottom: '1px solid var(--border)' }}>
                    {columns.map((c) => (
                      <td key={c.key} style={{ padding: '7px 12px', textAlign: c.align || 'left' }}>
                        {c.render ? c.render(r, i) : (r[c.key] ?? '—')}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
              {footer ? (
                <tfoot>
                  <tr style={{ background: '#f8f9fa', fontWeight: 700 }}>{footer(rows, columns)}</tr>
                </tfoot>
              ) : null}
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Shared search + optional carrier filter + optional sort toolbar for an
 * uploads list — generalizes Commission Statements' toolbar so the other
 * tabs stop hand-rolling their own search bar (or, for MedicarePro/Agency
 * Production, using UploadListSearch alone with no filter/sort at all).
 */
export function UploadListToolbar({
  search,
  onSearchChange,
  searchPlaceholder = 'Search…',
  filterValue,
  onFilterChange,
  filterOptions,
  filterAllLabel = 'All carriers',
  sortValue,
  onSortChange,
  sortOptions,
  onClear,
  showClear,
}) {
  return (
    <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
      <input
        type="text"
        placeholder={searchPlaceholder}
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
        style={{ flex: '1 1 220px', minWidth: 180, padding: '6px 10px', borderRadius: 6, border: '0.5px solid var(--border)', fontSize: 13, background: 'var(--bg)', color: 'var(--text)' }}
      />
      {filterOptions ? (
        <select
          value={filterValue}
          onChange={(e) => onFilterChange(e.target.value)}
          style={{ padding: '6px 10px', borderRadius: 6, border: '0.5px solid var(--border)', fontSize: 13, background: 'var(--bg)', color: 'var(--text)', cursor: 'pointer' }}
        >
          <option value="">{filterAllLabel}</option>
          {filterOptions.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      ) : null}
      {sortOptions ? (
        <select
          value={sortValue}
          onChange={(e) => onSortChange(e.target.value)}
          style={{ padding: '6px 10px', borderRadius: 6, border: '0.5px solid var(--border)', fontSize: 13, background: 'var(--bg)', color: 'var(--text)', cursor: 'pointer' }}
        >
          {sortOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      ) : null}
      {showClear ? (
        <button
          type="button"
          onClick={onClear}
          style={{ background: 'none', border: '0.5px solid var(--border)', borderRadius: 6, padding: '5px 12px', fontSize: 12, cursor: 'pointer', color: 'var(--text-muted)' }}
        >
          Clear filters
        </button>
      ) : null}
    </div>
  );
}

/**
 * Shared selectable row-list — the "Commission Statements" list family
 * (checkbox select, icon, primary/meta text, badges, inline actions) that
 * Brief E migrates the other four Uploads tabs onto, instead of each one
 * keeping its own HistoryCard/table markup. `selected` is a Set of keys
 * from `getKey`; pass `selectable={false}` for a page with no bulk-delete
 * (e.g. Agent Payout keeps its per-row-only delete pattern if desired).
 */
export function UploadRowList({
  items,
  getKey,
  selectable = false,
  selected,
  onToggleSelect,
  onSelectAll,
  allSelected,
  headerLabel,
  bulkActions,
  icon = '📄',
  renderPrimary,
  renderMeta,
  renderBadges,
  renderActions,
  hasAnyItems,
  emptyState,
  noMatchState,
}) {
  return (
    <div className="card" style={{ padding: 0 }}>
      <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10 }}>
        {selectable ? (
          <input type="checkbox" checked={allSelected} onChange={onSelectAll} style={{ cursor: 'pointer' }} />
        ) : null}
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', flex: 1 }}>
          {headerLabel}
        </span>
        {bulkActions}
      </div>
      {!hasAnyItems
        ? emptyState
        : items.length === 0
        ? noMatchState
        : items.map((item, i) => {
            const key = getKey(item, i);
            return (
              <div
                key={key}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px',
                  borderBottom: '1px solid var(--border)',
                  background: selectable && selected && selected.has(key) ? 'var(--blue-light)' : 'transparent',
                }}
              >
                {selectable ? (
                  <input
                    type="checkbox"
                    checked={selected.has(key)}
                    onChange={() => onToggleSelect(key)}
                    style={{ cursor: 'pointer', flexShrink: 0 }}
                  />
                ) : null}
                <span style={{ fontSize: 20, flexShrink: 0 }}>{icon}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text)', marginBottom: 2 }}>{renderPrimary(item, i)}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{renderMeta(item, i)}</div>
                </div>
                {renderBadges ? <div style={{ display: 'flex', gap: 6, flexShrink: 0, alignItems: 'center' }}>{renderBadges(item, i)}</div> : null}
                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>{renderActions(item, i)}</div>
              </div>
            );
          })}
    </div>
  );
}

export function UploadListSearch({ value, onChange, placeholder = 'Search…' }) {
  const q = String(value || '').trim();
  return (
    <div style={{ padding: '0 0 12px', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <input
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          flex: '1 1 240px',
          minWidth: 180,
          padding: '8px 12px',
          borderRadius: 6,
          border: '0.5px solid var(--border)',
          fontSize: 13,
          background: 'var(--bg)',
          color: 'var(--text)',
        }}
      />
      {q ? (
        <button
          type="button"
          onClick={() => onChange('')}
          style={{
            background: 'none',
            border: '0.5px solid var(--border)',
            borderRadius: 6,
            padding: '7px 12px',
            fontSize: 12,
            cursor: 'pointer',
            color: 'var(--text-muted)',
          }}
        >
          Clear
        </button>
      ) : null}
    </div>
  );
}
