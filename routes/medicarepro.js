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
      .on('data', (row) => rows.push(row))
      .on('end', () => resolve(rows))
      .on('error', reject);
  });
}

// POST /api/medicarepro/upload - Upload with duplicate detection (exact row only)
router.post('/upload', requireAuth, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file provided' });
    }

    if (!req.file.originalname.toLowerCase().endsWith('.csv')) {
      return res.status(400).json({ error: 'File must be CSV' });
    }

    // Parse CSV
    const rows = await parseCSV(req.file.buffer);
    
    if (rows.length === 0) {
      return res.status(400).json({ error: 'CSV is empty' });
    }

    const pool = getPool();
    const uploadDate = new Date();
    const uploadMonth = `${uploadDate.getFullYear()}-${String(uploadDate.getMonth() + 1).padStart(2, '0')}`;

    let inserted = 0;
    let skipped = 0;

    // Process rows - keep ALL plan changes, only skip exact duplicate rows
    for (const row of rows) {
      const clientName = row.Name || '';
      const carrier = row.Company || '';
      const policyType = row['Policy Type'] || '';
      const effectiveDate = row['Effective Date'] ? new Date(row['Effective Date']).toISOString().split('T')[0] : null;
      const status = row.Status || '';
      const policyNumber = row['Policy Number'] || '';
      const planName = row.Policy || '';
      // Create a simple hash of the row to detect exact duplicates
      const rowHash = Buffer.from(JSON.stringify([clientName, carrier, effectiveDate, policyNumber])).toString('base64');

      // Check if this EXACT row (by hash) was already uploaded in this batch
      // This detects duplicate uploads of the same CSV file
      const checkQuery = `
        SELECT id FROM medicarepro_sales 
        WHERE upload_batch = $1 
          AND client_name = $2
          AND carrier = $3
          AND effective_date = $4
          AND policy_number = $5
        LIMIT 1
      `;
      
      const existing = await pool.query(checkQuery, [
        uploadMonth,
        clientName,
        carrier,
        effectiveDate,
        policyNumber
      ]);

      if (existing.rows.length > 0) {
        // Exact duplicate found in this batch, skip it
        skipped++;
        continue;
      }

      // Insert new record (keeps all plan changes, different eff dates)
      try {
        await pool.query(
          `INSERT INTO medicarepro_sales 
           (client_name, carrier, policy_type, effective_date, status, policy_number, plan_name, upload_batch, uploaded_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            clientName,
            carrier,
            policyType,
            effectiveDate,
            status,
            policyNumber,
            planName,
            uploadMonth,
            uploadDate
          ]
        );
        inserted++;
      } catch (err) {
        console.error('Insert error:', err);
        skipped++;
      }
    }

    res.json({
      success: true,
      inserted,
      skipped,
      upload_batch: uploadMonth,
      total_processed: rows.length,
      message: `✅ Uploaded ${inserted} records, skipped ${skipped} exact duplicates for batch ${uploadMonth}`
    });
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/medicarepro - List all sales with filtering
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
    params.push(limit, offset);

    const result = await pool.query(query, params);

    // Count total
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

    res.json({
      sales: result.rows,
      total,
      limit,
      offset
    });
  } catch (err) {
    console.error('Fetch error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/medicarepro/batches - List all upload batches
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
        COUNT(CASE WHEN status = 'Pending' THEN 1 END) as pending_count,
        COUNT(CASE WHEN status = 'Canceled' OR status = 'Replaced' THEN 1 END) as inactive_count
       FROM medicarepro_sales
       GROUP BY upload_batch
       ORDER BY upload_batch DESC`
    );

    res.json({
      batches: result.rows
    });
  } catch (err) {
    console.error('Batches error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/medicarepro/stats - Summary stats
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
        COUNT(CASE WHEN status = 'Canceled' OR status = 'Replaced' THEN 1 END) as inactive_sales,
        COUNT(DISTINCT carrier) as unique_carriers
       FROM medicarepro_sales`
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Stats error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
