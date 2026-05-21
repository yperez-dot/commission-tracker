const express = require('express');
const router = express.Router();
const multer = require('multer');
const XLSX = require('xlsx');
const { getPool } = require('../db/database');
const { requireAuth } = require('./auth');

const upload = multer({ storage: multer.memoryStorage() });

// POST /api/agency-production/upload
router.post('/upload', requireAuth, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file provided' });
    }

    const filename = req.file.originalname.toLowerCase();
    if (!filename.endsWith('.xlsx') && !filename.endsWith('.xls')) {
      return res.status(400).json({ error: 'File must be Excel format (.xlsx or .xls)' });
    }

    // Parse Excel file
    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(worksheet);

    if (rows.length === 0) {
      return res.status(400).json({ error: 'Excel file is empty' });
    }

    const pool = getPool();
    const uploadDate = new Date();
    const uploadMonth = `${uploadDate.getFullYear()}-${String(uploadDate.getMonth() + 1).padStart(2, '0')}`;

    // Detect carrier from filename or first row
    let carrier = 'Unknown';
    if (filename.includes('humana')) carrier = 'Humana';
    else if (filename.includes('uhc') || filename.includes('united')) carrier = 'UnitedHealthcare';
    else if (filename.includes('aetna')) carrier = 'Aetna';
    else if (filename.includes('careplus')) carrier = 'CarePlus';

    let inserted = 0;
    let skipped = 0;

    console.log(`Processing agency production file: ${req.file.originalname}`);
    console.log(`Detected carrier: ${carrier}`);
    console.log(`Total rows: ${rows.length}`);

    // Process each row
    for (const row of rows) {
      const agentName = (row.AGENT || row['Agent Name'] || '').substring(0, 255);
      const clientName = (row.MEMBER || row['Member Name'] || '').substring(0, 255);
      const planName = (row.PLAN_NAME || row['Plan Name'] || '').substring(0, 255);
      const policyNumber = (row.DOC_ID || row['Policy Number'] || '').toString().substring(0, 100);
      const statusValue = (row.Status || '').substring(0, 50);
      const policyType = (row.PRODUCT_DESCRIPTION || row['Policy Type'] || '').substring(0, 50);
      const enrollmentType = (row.Enrollment_Type || row['Enrollment Type'] || '').substring(0, 50);
      const state = (row.STATE || row.State || '').substring(0, 2);
      const county = (row.COUNTY || row.County || '').substring(0, 100);

      // Parse effective date
      let effectiveDate = null;
      if (row.EFF_DT || row['Effective Date']) {
        try {
          const dateValue = row.EFF_DT || row['Effective Date'];
          if (dateValue instanceof Date) {
            effectiveDate = dateValue.toISOString().split('T')[0];
          } else {
            const d = new Date(dateValue);
            if (!isNaN(d.getTime())) {
              effectiveDate = d.toISOString().split('T')[0];
            }
          }
        } catch (e) {
          // Invalid date, leave as null
        }
      }

      // Parse transaction date
      let transactionDate = null;
      if (row.TRANSACTION_DATE || row['Transaction Date']) {
        try {
          const dateValue = row.TRANSACTION_DATE || row['Transaction Date'];
          if (dateValue instanceof Date) {
            transactionDate = dateValue.toISOString().split('T')[0];
          } else {
            const d = new Date(dateValue);
            if (!isNaN(d.getTime())) {
              transactionDate = d.toISOString().split('T')[0];
            }
          }
        } catch (e) {
          // Invalid date, leave as null
        }
      }

      // Skip if missing essential data
      if (!clientName || !agentName) {
        skipped++;
        continue;
      }

      // Check for duplicate (same agent + client + effective_date in same batch)
      const existingQuery = `
        SELECT id FROM agency_production 
        WHERE upload_batch = $1 
          AND agent_name = $2
          AND client_name = $3
          AND effective_date = $4
        LIMIT 1
      `;
      
      const existingResult = await pool.query(existingQuery, [
        uploadMonth,
        agentName,
        clientName,
        effectiveDate
      ]);

      if (existingResult.rows.length > 0) {
        skipped++;
        continue;
      }

      // Insert the row
      try {
        await pool.query(
          `INSERT INTO agency_production 
           (agent_name, client_name, carrier, plan_name, policy_number, effective_date, 
            transaction_date, status, policy_type, enrollment_type, state, county, 
            upload_batch, uploaded_at, raw_data)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
          [
            agentName,
            clientName,
            carrier,
            planName,
            policyNumber,
            effectiveDate,
            transactionDate,
            statusValue,
            policyType,
            enrollmentType,
            state,
            county,
            uploadMonth,
            uploadDate,
            JSON.stringify(row)
          ]
        );
        inserted++;
      } catch (err) {
        console.error('Row insert error:', err.message);
        skipped++;
      }
    }

    // Log the upload to agency_production_uploads table
    const uploadedBy = req.user?.name || 'Unknown';
    await pool.query(
      `INSERT INTO agency_production_uploads (filename, carrier, upload_batch, uploaded_by, record_count)
       VALUES ($1, $2, $3, $4, $5)`,
      [req.file.originalname, carrier, uploadMonth, uploadedBy, inserted]
    );

    return res.json({
      success: true,
      inserted: inserted,
      skipped: skipped,
      carrier: carrier,
      upload_batch: uploadMonth,
      total_processed: rows.length,
      message: `Uploaded ${inserted} ${carrier} production records, skipped ${skipped} duplicates for batch ${uploadMonth}`
    });

  } catch (err) {
    console.error('Upload error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// GET /api/agency-production
router.get('/', requireAuth, async (req, res) => {
  try {
    const pool = getPool();
    const { batch, carrier, agent, limit = 100, offset = 0 } = req.query;

    let query = 'SELECT * FROM agency_production WHERE 1=1';
    const params = [];

    if (batch) {
      query += ` AND upload_batch = $${params.length + 1}`;
      params.push(batch);
    }

    if (carrier) {
      query += ` AND carrier = $${params.length + 1}`;
      params.push(carrier);
    }

    if (agent) {
      query += ` AND agent_name ILIKE $${params.length + 1}`;
      params.push(`%${agent}%`);
    }

    query += ` ORDER BY effective_date DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(parseInt(limit), parseInt(offset));

    const result = await pool.query(query, params);

    // Get total count
    let countQuery = 'SELECT COUNT(*) as count FROM agency_production WHERE 1=1';
    const countParams = [];
    if (batch) {
      countQuery += ` AND upload_batch = $${countParams.length + 1}`;
      countParams.push(batch);
    }
    if (carrier) {
      countQuery += ` AND carrier = $${countParams.length + 1}`;
      countParams.push(carrier);
    }
    if (agent) {
      countQuery += ` AND agent_name ILIKE $${countParams.length + 1}`;
      countParams.push(`%${agent}%`);
    }

    const countResult = await pool.query(countQuery, countParams);
    const total = parseInt(countResult.rows[0].count);

    return res.json({
      production: result.rows,
      total: total,
      limit: parseInt(limit),
      offset: parseInt(offset)
    });

  } catch (err) {
    console.error('Fetch error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// GET /api/agency-production/uploads - Fetch upload history
router.get('/uploads', requireAuth, async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.query(
      `SELECT * FROM agency_production_uploads ORDER BY uploaded_at DESC`
    );

    return res.json({ uploads: result.rows });

  } catch (err) {
    console.error('Upload history error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// DELETE /api/agency-production/batch/:batch - Delete a batch
router.delete('/batch/:batch', requireAuth, async (req, res) => {
  try {
    const { batch } = req.params;
    const pool = getPool();

    // Delete all production records for this batch
    const productionResult = await pool.query(
      'DELETE FROM agency_production WHERE upload_batch = $1',
      [batch]
    );

    // Delete upload log entries for this batch
    const uploadsResult = await pool.query(
      'DELETE FROM agency_production_uploads WHERE upload_batch = $1',
      [batch]
    );

    return res.json({
      success: true,
      deleted_production: productionResult.rowCount,
      deleted_uploads: uploadsResult.rowCount,
      message: `Deleted batch ${batch} (${productionResult.rowCount} production records, ${uploadsResult.rowCount} upload logs)`
    });

  } catch (err) {
    console.error('Delete batch error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// GET /api/agency-production/stats
router.get('/stats', requireAuth, async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.query(
      `SELECT 
        COUNT(*) as total_production,
        COUNT(DISTINCT agent_name) as unique_agents,
        COUNT(DISTINCT carrier) as carriers,
        COUNT(DISTINCT upload_batch) as batches,
        COUNT(CASE WHEN status ILIKE '%active%' THEN 1 END) as active_policies
       FROM agency_production`
    );

    return res.json(result.rows[0]);

  } catch (err) {
    console.error('Stats error:', err);
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
