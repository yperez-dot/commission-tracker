'use strict';

/**
 * commission_records whose upload_id points at a missing uploads row.
 * Production delete used to remove only the uploads row; without ON DELETE
 * CASCADE those commission lines stay and double-count chargebacks.
 */

async function cleanupOrphanCommissionRecords(pool) {
  const r = await pool.query(`
    DELETE FROM commission_records cr
    WHERE cr.upload_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM uploads u WHERE u.id = cr.upload_id)
    RETURNING id
  `);
  return { deleted: (r.rowCount != null ? r.rowCount : (r.rows || []).length) };
}

module.exports = { cleanupOrphanCommissionRecords };
