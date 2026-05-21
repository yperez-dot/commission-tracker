const express = require('express');
const router = express.Router();
const multer = require('multer');
const csv = require('csv-parser');
const { getPool } = require('../db/database');
const { requireAuth } = require('./auth');

const upload = multer({ storage: multer.memoryStorage() });

function parseCSV(buffer) {
  return new Promise((resolve, reject) => {
    const rows = [];
    const stream = require('stream');
    
    stream.Readable.from([buffer.toString()])
      .pipe(csv())
      .on('data', (row) => {
        // Strip ALL quotes from column names (CSV headers might have unmatched quotes)
        const cleanedRow = {};
        for (const [key, value] of Object.entries(row)) {
          const cleanKey = key.replace(/"/g, '').trim();  // Remove ALL quotes
          cleanedRow[cleanKey] = value;
        }
        rows.push(cleanedRow);
      })
      .on('end', () => resolve(rows))
      .on('error', reject);
  });
}

// POST /api/medicarepro/upload
router.post('/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file provided' });
    }

    if (!req.file.originalname.toLowerCase().endsWith('.csv')) {
      return res.status(400).json({ error: 'File must be CSV' });
    }

    const rows = await parseCSV(req.file.buffer);
    if (rows.length === 0) {
      return res.status(400).json({ error: 'CSV is empty' });
    }

    const pool = getPool();
    const uploadDate = new Date();
    const uploadMonth = `${uploadDate.getFullYear()}-${String(uploadDate.getMonth() + 1).padStart(2, '0')}`;

    let inserted = 0;
    let skipped = 0;

    // Detect CSV format by checking column names
    const hasAgentColumns = rows[0] && ('Agent First' in rows[0] || 'Agent Last' in rows[0]);
    const formatType = hasAgentColumns ? 'sales_by_agency' : 'client_list';

    console.log(`Detected CSV format: ${formatType}`);
    if (rows[0]) {
      console.log('=== DEBUG: First row ALL keys ===');
      console.log(JSON.stringify(Object.keys(rows[0]), null, 2));
      console.log('=== DEBUG: First row FULL DATA ===');
      console.log(JSON.stringify(rows[0], null, 2));
    }

    // Process each row
    for (const row of rows) {
      let clientName, carrier, policyType, statusValue, policyNumber, planName, agentName;

      if (formatType === 'sales_by_agency') {
        // New format with agent names
        const agentFirst = (row['Agent First'] || '').trim();
        const agentLast = (row['Agent Last'] || '').trim();
        agentName = `${agentFirst} ${agentLast}`.trim().substring(0, 100);
        
        // Debug log EVERY row to see what's happening
        console.log(`Row ${inserted + 1}: agentFirst="${agentFirst}" agentLast="${agentLast}" => agentName="${agentName}"`);
        
        const memberFirst = (row['Member First'] || '').trim();
        const memberLast = (row['Member Last'] || '').trim();
        clientName = `${memberFirst} ${memberLast}`.trim().substring(0, 255);
        
        carrier = (row['Company Name'] || '').substring(0, 100);
        policyType = (row['Policy Type'] || '').substring(0, 50);
        statusValue = (row['Policy Status'] || '').substring(0, 50);
        policyNumber = (row['Policy #'] || '').substring(0, 100);
        planName = (row['Plan Name'] || '').substring(0, 255);
      } else {
        // Old format without agent names
        clientName = (row.Name || '').substring(0, 255);
        carrier = (row.Company || '').substring(0, 100);
        policyType = (row['Policy Type'] || '').substring(0, 50);
        statusValue = (row.Status || '').substring(0, 50);
        policyNumber = (row['Policy Number'] || '').substring(0, 100);
        planName = (row.Policy || '').substring(0, 255);
        agentName = null;
      }
      
      let effectiveDate = null;
      const effDateField = formatType === 'sales_by_agency' ? row['Policy Effective Date'] : row['Effective Date'];
      if (effDateField) {
        try {
          const d = new Date(effDateField);
          if (!isNaN(d.getTime())) {
            effectiveDate = d.toISOString().split('T')[0];
          }
        } catch (e) {
          // Invalid date, leave as null
        }
      }

      // Check for exact duplicate (same client + carrier + eff_date + policy_number in this batch)
      const existingQuery = `
        SELECT id FROM medicarepro_sales 
        WHERE upload_batch = $1 
          AND client_name = $2
          AND carrier = $3
          AND effective_date = $4
          AND policy_number = $5
        LIMIT 1
      `;
      
      const existingResult = await pool.query(existingQuery, [
        uploadMonth,
        clientName,
        carrier,
        effectiveDate,
        policyNumber
      ]);

      if (existingResult.rows.length > 0) {
        skipped++;
        continue;
      }

      // Insert the row
      try {
        await pool.query(
          `INSERT INTO medicarepro_sales 
           (client_name, agent_name, carrier, policy_type, effective_date, status, policy_number, plan_name, upload_batch, uploaded_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            clientName,
            agentName,
            carrier,
            policyType,
            effectiveDate,
            statusValue,
            policyNumber,
            planName,
            uploadMonth,
            uploadDate
          ]
        );
        inserted++;
      } catch (err) {
        console.error('Row insert error:', err.message);
        skipped++;
      }
    }

    // Log the upload to medicarepro_uploads table
    const uploadedBy = req.user?.name || req.body.uploadedBy || 'Unknown';
    await pool.query(
      `INSERT INTO medicarepro_uploads (filename, upload_batch, uploaded_by, record_count)
       VALUES ($1, $2, $3, $4)`,
      [req.file.originalname, uploadMonth, uploadedBy, inserted]
    );

    return res.json({
      success: true,
      inserted: inserted,
      skipped: skipped,
      upload_batch: uploadMonth,
      total_processed: rows.length,
      message: `Uploaded ${inserted} records, skipped ${skipped} duplicates for batch ${uploadMonth}`
    });

  } catch (err) {
    console.error('Upload error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// GET /api/medicarepro
router.get('/', requireAuth, async (req, res) => {
  try {
    const pool = getPool();
    const { batch, status, limit = 100, offset = 0 } = req.query;

    let query = 'SELECT * FROM medicarepro_sales WHERE 1=1';
    const params = [];

    if (batch) {
      query += ` AND upload_batch = $${params.length + 1}`;
      params.push(batch);
    }

    if (status) {
      query += ` AND status = $${params.length + 1}`;
      params.push(status);
    }

    query += ` ORDER BY effective_date DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(parseInt(limit), parseInt(offset));

    const result = await pool.query(query, params);

    let countQuery = 'SELECT COUNT(*) as count FROM medicarepro_sales WHERE 1=1';
    const countParams = [];
    if (batch) {
      countQuery += ` AND upload_batch = $${countParams.length + 1}`;
      countParams.push(batch);
    }
    if (status) {
      countQuery += ` AND status = $${countParams.length + 1}`;
      countParams.push(status);
    }

    const countResult = await pool.query(countQuery, countParams);
    const total = parseInt(countResult.rows[0].count);

    return res.json({
      sales: result.rows,
      total: total,
      limit: parseInt(limit),
      offset: parseInt(offset)
    });

  } catch (err) {
    console.error('Fetch error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// GET /api/medicarepro/batches
router.get('/batches', requireAuth, async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.query(
      `SELECT 
        upload_batch,
        COUNT(*) as record_count,
        MIN(uploaded_at) as first_uploaded,
        MAX(uploaded_at) as last_uploaded,
        COUNT(CASE WHEN status = 'Active' THEN 1 END) as active_count,
        COUNT(CASE WHEN status = 'Pending' THEN 1 END) as pending_count
       FROM medicarepro_sales
       GROUP BY upload_batch
       ORDER BY upload_batch DESC`
    );

    return res.json({ batches: result.rows });

  } catch (err) {
    console.error('Batches error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// GET /api/medicarepro/stats
router.get('/stats', requireAuth, async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.query(
      `SELECT 
        COUNT(*) as total_sales,
        COUNT(DISTINCT upload_batch) as total_batches,
        COUNT(DISTINCT client_name) as unique_clients,
        COUNT(CASE WHEN status = 'Active' THEN 1 END) as active_sales,
        COUNT(CASE WHEN status = 'Pending' THEN 1 END) as pending_sales,
        COUNT(DISTINCT carrier) as unique_carriers
       FROM medicarepro_sales`
    );

    return res.json(result.rows[0]);

  } catch (err) {
    console.error('Stats error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// GET /api/medicarepro/uploads - Fetch upload history
router.get('/uploads', requireAuth, async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.query(
      `SELECT * FROM medicarepro_uploads ORDER BY uploaded_at DESC`
    );

    return res.json({ uploads: result.rows });

  } catch (err) {
    console.error('Upload history error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// DELETE /api/medicarepro/batch/:batch - Delete a batch and all its records
router.delete('/batch/:batch', requireAuth, async (req, res) => {
  try {
    const { batch } = req.params;
    const pool = getPool();

    // Delete all sales records for this batch
    const salesResult = await pool.query(
      'DELETE FROM medicarepro_sales WHERE upload_batch = $1',
      [batch]
    );

    // Delete upload log entries for this batch
    const uploadsResult = await pool.query(
      'DELETE FROM medicarepro_uploads WHERE upload_batch = $1',
      [batch]
    );

    return res.json({
      success: true,
      deleted_sales: salesResult.rowCount,
      deleted_uploads: uploadsResult.rowCount,
      message: `Deleted batch ${batch} (${salesResult.rowCount} sales, ${uploadsResult.rowCount} upload logs)`
    });

  } catch (err) {
    console.error('Delete batch error:', err);
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
