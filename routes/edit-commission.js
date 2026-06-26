const express = require('express');
const router = express.Router();
const { getPool } = require('../db/database');

/**
 * Manual Edit Commission Record with Audit Trail
 * 
 * PUT /api/commission/:id/edit
 * 
 * Body: {
 *   commission?: number,
 *   theiShare?: number,
 *   bsiShare?: number,
 *   classification?: string, // 'Override' | 'Agent Comp' | 'New Business' | 'Chargeback'
 *   editedBy: string, // required - who made the change
 *   notes?: string
 * }
 */
router.put('/commission/:id/edit', async (req, res) => {
  const pool = getPool();
  const { id } = req.params;
  const { commission, theiShare, bsiShare, classification, editedBy, notes } = req.body;

  if (!editedBy) {
    return res.status(400).json({ error: 'editedBy is required for audit trail' });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Fetch current record
    const current = await client.query(
      'SELECT * FROM commission_records WHERE id = $1',
      [id]
    );

    if (current.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Commission record not found' });
    }

    const record = current.rows[0];

    // Build audit log entries
    const auditEntries = [];

    // Preserve original values on first edit
    const updates = [];
    const params = [];
    let paramIndex = 1;

    // If this is the first edit, save original values
    if (!record.is_manually_edited) {
      if (record.original_commission === null) {
        updates.push(`original_commission = $${paramIndex++}`);
        params.push(record.commission);
      }
      if (record.original_thei_share === null) {
        updates.push(`original_thei_share = $${paramIndex++}`);
        params.push(record.thei_share);
      }
      if (record.original_bsi_share === null) {
        updates.push(`original_bsi_share = $${paramIndex++}`);
        params.push(record.bsi_share);
      }
      if (record.original_classification === null) {
        updates.push(`original_classification = $${paramIndex++}`);
        params.push(record.classification);
      }
    }

    // Update fields and create audit entries
    if (commission !== undefined && commission !== record.commission) {
      updates.push(`commission = $${paramIndex++}`);
      params.push(commission);
      auditEntries.push({
        field: 'commission',
        oldValue: record.commission,
        newValue: commission
      });
    }

    if (theiShare !== undefined && theiShare !== record.thei_share) {
      updates.push(`thei_share = $${paramIndex++}`);
      params.push(theiShare);
      auditEntries.push({
        field: 'thei_share',
        oldValue: record.thei_share,
        newValue: theiShare
      });
    }

    if (bsiShare !== undefined && bsiShare !== record.bsi_share) {
      updates.push(`bsi_share = $${paramIndex++}`);
      params.push(bsiShare);
      auditEntries.push({
        field: 'bsi_share',
        oldValue: record.bsi_share,
        newValue: bsiShare
      });
    }

    if (classification !== undefined && classification !== record.classification) {
      updates.push(`classification = $${paramIndex++}`);
      params.push(classification);
      auditEntries.push({
        field: 'classification',
        oldValue: record.classification,
        newValue: classification
      });
    }

    // Mark as manually edited
    updates.push(`is_manually_edited = TRUE`);
    updates.push(`edited_by = $${paramIndex++}`);
    params.push(editedBy);
    updates.push(`edited_at = NOW()`);
    
    if (notes) {
      updates.push(`edit_notes = $${paramIndex++}`);
      params.push(notes);
    }

    // Update the record
    params.push(id);
    const updateQuery = `
      UPDATE commission_records
      SET ${updates.join(', ')}
      WHERE id = $${paramIndex}
      RETURNING *
    `;

    const updated = await client.query(updateQuery, params);

    // Insert audit log entries
    for (const entry of auditEntries) {
      await client.query(
        `INSERT INTO commission_edit_audit (record_id, edited_by, field_name, old_value, new_value, notes)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [id, editedBy, entry.field, String(entry.oldValue), String(entry.newValue), notes || null]
      );
    }

    await client.query('COMMIT');

    res.json({
      success: true,
      record: updated.rows[0],
      changesLogged: auditEntries.length,
      message: `Record updated successfully. ${auditEntries.length} change(s) logged.`
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error editing commission record:', error);
    res.status(500).json({ error: 'Failed to edit record', details: error.message });
  } finally {
    client.release();
  }
});

/**
 * Get audit history for a commission record
 * 
 * GET /api/commission/:id/audit
 */
router.get('/commission/:id/audit', async (req, res) => {
  const pool = getPool();
  const { id } = req.params;

  try {
    const audit = await pool.query(
      `SELECT * FROM commission_edit_audit 
       WHERE record_id = $1 
       ORDER BY edited_at DESC`,
      [id]
    );

    const record = await pool.query(
      `SELECT id, agent_name, client_full_name, carrier, commission, 
              thei_share, bsi_share, classification,
              original_commission, original_thei_share, original_bsi_share, original_classification,
              is_manually_edited, edited_by, edited_at, edit_notes
       FROM commission_records WHERE id = $1`,
      [id]
    );

    res.json({
      record: record.rows[0] || null,
      auditHistory: audit.rows
    });

  } catch (error) {
    console.error('Error fetching audit history:', error);
    res.status(500).json({ error: 'Failed to fetch audit history', details: error.message });
  }
});

/**
 * Revert a manual edit (restore original values)
 * 
 * POST /api/commission/:id/revert
 * 
 * Body: {
 *   editedBy: string, // required
 *   notes?: string
 * }
 */
router.post('/commission/:id/revert', async (req, res) => {
  const pool = getPool();
  const { id } = req.params;
  const { editedBy, notes } = req.body;

  if (!editedBy) {
    return res.status(400).json({ error: 'editedBy is required for audit trail' });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const current = await pool.query(
      'SELECT * FROM commission_records WHERE id = $1',
      [id]
    );

    if (current.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Commission record not found' });
    }

    const record = current.rows[0];

    if (!record.is_manually_edited) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Record has not been manually edited' });
    }

    // Restore original values
    const auditEntries = [];

    const restored = await client.query(
      `UPDATE commission_records
       SET 
         commission = COALESCE(original_commission, commission),
         thei_share = COALESCE(original_thei_share, thei_share),
         bsi_share = COALESCE(original_bsi_share, bsi_share),
         classification = COALESCE(original_classification, classification),
         is_manually_edited = FALSE,
         edited_by = $1,
         edited_at = NOW(),
         edit_notes = $2
       WHERE id = $3
       RETURNING *`,
      [editedBy, notes || 'Reverted to original parsed values', id]
    );

    // Log the reversion
    if (record.original_commission !== null) {
      auditEntries.push({
        field: 'commission',
        oldValue: record.commission,
        newValue: record.original_commission
      });
    }
    if (record.original_thei_share !== null) {
      auditEntries.push({
        field: 'thei_share',
        oldValue: record.thei_share,
        newValue: record.original_thei_share
      });
    }
    if (record.original_bsi_share !== null) {
      auditEntries.push({
        field: 'bsi_share',
        oldValue: record.bsi_share,
        newValue: record.original_bsi_share
      });
    }
    if (record.original_classification !== null) {
      auditEntries.push({
        field: 'classification',
        oldValue: record.classification,
        newValue: record.original_classification
      });
    }

    for (const entry of auditEntries) {
      await client.query(
        `INSERT INTO commission_edit_audit (record_id, edited_by, field_name, old_value, new_value, notes)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [id, editedBy, entry.field, String(entry.oldValue), String(entry.newValue), notes || 'Reverted to original']
      );
    }

    await client.query('COMMIT');

    res.json({
      success: true,
      record: restored.rows[0],
      message: 'Record reverted to original parsed values'
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error reverting commission record:', error);
    res.status(500).json({ error: 'Failed to revert record', details: error.message });
  } finally {
    client.release();
  }
});

module.exports = router;
