const express = require('express');
const router = express.Router();
const { getPool } = require('../db/database');
const { requireAuth } = require('./auth');
const ExcelJS = require('exceljs');

// Require admin for all LOA statement operations
function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin only' });
  }
  next();
}

// GET /api/loa-statements - List all LOA statements
router.get('/', requireAuth, requireAdmin, async (req, res) => {
  try {
    const pool = getPool();
    const { agent, status, limit = 100 } = req.query;
    
    let query = 'SELECT * FROM loa_statements WHERE 1=1';
    const params = [];
    let paramIndex = 1;
    
    if (agent) {
      query += ` AND agent_name = $${paramIndex++}`;
      params.push(agent);
    }
    
    if (status) {
      query += ` AND status = $${paramIndex++}`;
      params.push(status);
    }
    
    query += ` ORDER BY created_at DESC LIMIT $${paramIndex}`;
    params.push(parseInt(limit));
    
    const result = await pool.query(query, params);
    res.json({ statements: result.rows });
  } catch (err) {
    console.error('Error fetching LOA statements:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/loa-statements/:id - Get single statement with items
// GET /api/loa-statements/:id/export - Generate Excel file
router.get('/:id/export', requireAuth, async (req, res) => {
  try {
    const pool = getPool();
    const { id } = req.params;
    
    console.log(`📥 Export request for LOA statement ID: ${id}`);
    console.log(`   User: ${req.user.name} (${req.user.role})`);
    
    // Get statement and items
    const statementResult = await pool.query('SELECT * FROM loa_statements WHERE id = $1', [id]);
    if (statementResult.rows.length === 0) {
      console.error(`❌ Statement not found: ${id}`);
      return res.status(404).json({ error: 'Statement not found' });
    }
    
    const statement = statementResult.rows[0];
    const itemsResult = await pool.query(
      'SELECT * FROM loa_statement_items WHERE statement_id = $1 ORDER BY sort_order, id',
      [id]
    );
    const items = itemsResult.rows;
    
    // Create Excel workbook matching the user's format
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Payment Statement');
    
    // Row 1: Company name
    worksheet.getRow(1).getCell(1).value = 'THE HEALTH EXPERTS INSURANCE';
    worksheet.getRow(1).getCell(1).font = { bold: true, size: 14 };
    
    // Row 2: Statement title
    worksheet.getRow(2).getCell(1).value = 'PRODUCER PAYMENT STATEMENT';
    worksheet.getRow(2).getCell(1).font = { bold: true, size: 12 };
    
    // Row 4-6: Statement info
    worksheet.getRow(4).getCell(1).value = 'Agent:';
    worksheet.getRow(4).getCell(2).value = statement.agent_name;
    
    worksheet.getRow(5).getCell(1).value = 'Payment Date:';
    worksheet.getRow(5).getCell(2).value = new Date(statement.payment_date).toLocaleDateString('en-US');
    
    worksheet.getRow(6).getCell(1).value = 'Statement Period:';
    worksheet.getRow(6).getCell(2).value = statement.period_label || `${statement.period_start} - ${statement.period_end}`;
    
    // Row 8: Headers
    worksheet.getRow(8).values = ['Client', 'Carrier', 'Type', 'Amount'];
    worksheet.getRow(8).font = { bold: true };
    worksheet.getRow(8).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFD3D3D3' }
    };
    
    // Rows 9+: Line items
    let currentRow = 9;
    items.forEach(item => {
      worksheet.getRow(currentRow).values = [
        item.client_name,
        item.carrier,
        item.transaction_type,
        parseFloat(item.amount)
      ];
      worksheet.getRow(currentRow).getCell(4).numFmt = '$#,##0.00';
      currentRow++;
    });
    
    // Total row
    currentRow += 1;
    worksheet.getRow(currentRow).getCell(3).value = 'TOTAL PAYMENT DUE:';
    worksheet.getRow(currentRow).getCell(3).font = { bold: true };
    worksheet.getRow(currentRow).getCell(4).value = { formula: `SUM(D9:D${currentRow-2})` };
    worksheet.getRow(currentRow).getCell(4).numFmt = '$#,##0.00';
    worksheet.getRow(currentRow).getCell(4).font = { bold: true };
    
    // Commission structure
    currentRow += 2;
    let commStructure;
    try {
      commStructure = typeof statement.commission_structure === 'string' 
        ? JSON.parse(statement.commission_structure)
        : statement.commission_structure || {
            plan_changes: '$100 flat',
            new_to_medicare: '$150 flat',
            lead_generated: 'Full commission'
          };
    } catch (e) {
      commStructure = {
        plan_changes: '$100 flat',
        new_to_medicare: '$150 flat',
        lead_generated: 'Full commission'
      };
    }
    
    worksheet.getRow(currentRow).getCell(1).value = 'COMMISSION STRUCTURE (LOA Agreement)';
    worksheet.getRow(currentRow).getCell(1).font = { bold: true };
    currentRow++;
    
    worksheet.getRow(currentRow).getCell(1).value = '  •  Plan Changes:';
    worksheet.getRow(currentRow).getCell(3).value = commStructure.plan_changes;
    currentRow++;
    
    worksheet.getRow(currentRow).getCell(1).value = '  •  New to Medicare:';
    worksheet.getRow(currentRow).getCell(3).value = commStructure.new_to_medicare;
    currentRow++;
    
    worksheet.getRow(currentRow).getCell(1).value = '  •  Lead generated by agent:';
    worksheet.getRow(currentRow).getCell(3).value = commStructure.lead_generated;
    currentRow += 2;
    
    // Notes section
    worksheet.getRow(currentRow).getCell(1).value = 'NOTES';
    worksheet.getRow(currentRow).getCell(1).font = { bold: true };
    currentRow++;
    
    items.forEach(item => {
      if (item.note) {
        worksheet.getRow(currentRow).getCell(1).value = `${item.client_name}:`;
        worksheet.getRow(currentRow).getCell(2).value = item.note;
        currentRow++;
      }
    });
    
    // Footer
    currentRow += 1;
    worksheet.getRow(currentRow).getCell(1).value = 'Payment approved by:';
    worksheet.getRow(currentRow).getCell(2).value = 'Yahoska Perez';
    currentRow++;
    
    worksheet.getRow(currentRow).getCell(1).value = 'Date:';
    worksheet.getRow(currentRow).getCell(2).value = new Date(statement.payment_date).toLocaleDateString('en-US');
    
    // Column widths
    worksheet.getColumn(1).width = 25;
    worksheet.getColumn(2).width = 20;
    worksheet.getColumn(3).width = 20;
    worksheet.getColumn(4).width = 15;
    
    // Send file
    const filename = `THEI_Payment_Statement_${statement.agent_name.replace(/\s+/g, '_')}_${statement.period_label?.replace(/\s+/g, '_') || 'statement'}.xlsx`;
    
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('Error exporting LOA statement:', err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const pool = getPool();
    const { id } = req.params;
    
    const statementResult = await pool.query(
      'SELECT * FROM loa_statements WHERE id = $1',
      [id]
    );
    
    if (statementResult.rows.length === 0) {
      return res.status(404).json({ error: 'Statement not found' });
    }
    
    const itemsResult = await pool.query(
      'SELECT * FROM loa_statement_items WHERE statement_id = $1 ORDER BY sort_order, id',
      [id]
    );
    
    const statement = statementResult.rows[0];
    statement.items = itemsResult.rows;
    
    res.json({ statement });
  } catch (err) {
    console.error('Error fetching LOA statement:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
