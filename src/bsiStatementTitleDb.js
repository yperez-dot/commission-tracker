'use strict';

/**
 * DB helpers for standardized BSI statement titles (uploads.display_title).
 * Shared by routes/files.js and scripts/backfill-bsi-statement-titles.js.
 */

const { buildBsiStatementTitle, convertTitleDates } = require('./bsiStatementTitle');

/** Idempotent schema: display_title + who set it ('auto' | 'manual'). */
async function ensureTitleColumns(pool) {
  await pool.query(`ALTER TABLE uploads ADD COLUMN IF NOT EXISTS display_title TEXT`);
  await pool.query(`ALTER TABLE uploads ADD COLUMN IF NOT EXISTS display_title_source TEXT`);
}

/** Read-only check so dry runs never alter the schema. */
async function hasTitleColumns(pool) {
  const r = await pool.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_name = 'uploads' AND column_name IN ('display_title', 'display_title_source')`
  );
  return r.rows.length === 2;
}

/** [{ period, count }] from in-memory parsed records (r.period). */
function periodCountsFromRecords(records) {
  const m = new Map();
  for (const r of records || []) {
    const p = String((r && (r.period ?? r.payment_period)) || '').trim();
    if (!p) continue;
    m.set(p, (m.get(p) || 0) + 1);
  }
  return [...m.entries()].map(([period, count]) => ({ period, count }));
}

/** Map upload_id → [{ period, count }] for the given BSI uploads. */
async function loadPeriodCounts(pool, uploadIds) {
  const out = new Map();
  if (!uploadIds || !uploadIds.length) return out;
  const r = await pool.query(
    `SELECT upload_id, payment_period AS period, COUNT(*)::int AS count
       FROM commission_records
      WHERE upload_id = ANY($1::int[])
      GROUP BY upload_id, payment_period`,
    [uploadIds]
  );
  for (const row of r.rows) {
    if (!out.has(row.upload_id)) out.set(row.upload_id, []);
    out.get(row.upload_id).push({ period: row.period, count: row.count });
  }
  return out;
}

/**
 * Compute old → new titles for every BSI statement upload. Read-only.
 * Auto titles are rebuilt (MM.YYYY). Manual titles keep their text; only their
 * MM-YYYY month tokens become MM.YYYY (unless includeManual rebuilds them).
 * @returns {Promise<Array<{ id, original_name, old_title, new_title, new_source, source, confidence, notes, manual, changed }>>}
 */
async function planBsiTitles(pool, { includeManual = false, oldTitleOf } = {}) {
  const withCols = await hasTitleColumns(pool);
  const cols = withCols ? ', display_title, display_title_source' : '';
  const ups = await pool.query(
    `SELECT id, original_name, carrier, row_count, uploaded_at${cols}
       FROM uploads WHERE category = 'bsi_statement' ORDER BY uploaded_at ASC, id ASC`
  );
  const periods = await loadPeriodCounts(pool, ups.rows.map((u) => u.id));
  const plan = ups.rows.map((u) => {
    const manual = withCols && u.display_title_source === 'manual';
    const built = buildBsiStatementTitle({
      filename: u.original_name,
      carrier: u.carrier,
      periods: periods.get(u.id) || [],
      fallbackTitle: u.display_title || '',
      uploadedAt: u.uploaded_at,
    });
    const oldTitle = (withCols && u.display_title) || (oldTitleOf ? oldTitleOf(u) : u.original_name);
    const skip = manual && !includeManual;
    const newTitle = skip ? convertTitleDates(u.display_title) : built.title;
    const manualDateFix = skip && newTitle !== u.display_title;
    return {
      id: u.id,
      original_name: u.original_name,
      carrier: u.carrier,
      row_count: u.row_count,
      uploaded_at: u.uploaded_at,
      old_title: oldTitle,
      new_title: newTitle,
      new_source: skip ? 'manual' : 'auto',
      source: built.source,
      confidence: built.confidence,
      notes: skip ? [manualDateFix ? 'manual title kept; month changed to MM.YYYY' : 'manual title kept'] : built.notes,
      manual,
      changed: skip ? manualDateFix : (!withCols || u.display_title !== built.title || u.display_title_source !== 'auto'),
    };
  });
  // Flag duplicate titles (two uploads that would read the same)
  const seen = new Map();
  for (const p of plan) seen.set(p.new_title, (seen.get(p.new_title) || 0) + 1);
  for (const p of plan) {
    if (seen.get(p.new_title) > 1) p.notes = [...p.notes, `same title as ${seen.get(p.new_title) - 1} other upload(s)`];
  }
  return plan;
}

/**
 * Write a plan from planBsiTitles (only rows with changed=true). One transaction.
 * @returns {Promise<number>} rows updated
 */
async function applyBsiTitlePlan(pool, plan) {
  await ensureTitleColumns(pool);
  const client = await pool.connect();
  let updated = 0;
  try {
    await client.query('BEGIN');
    for (const p of plan) {
      if (!p.changed) continue;
      await client.query(
        `UPDATE uploads SET display_title = $1, display_title_source = $2
          WHERE id = $3 AND category = 'bsi_statement'`,
        [p.new_title, p.new_source || 'auto', p.id]
      );
      updated += 1;
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
  return updated;
}

module.exports = {
  applyBsiTitlePlan,
  ensureTitleColumns,
  hasTitleColumns,
  periodCountsFromRecords,
  loadPeriodCounts,
  planBsiTitles,
};
