const express = require('express');
const router = express.Router();
const { getPool } = require('../db/database');
const { requireAuth } = require('./auth');

function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  next();
}

// ─── Name Parsing Utilities ──────────────────────────────────────────────────

/**
 * Parse client name into first and last name components
 * Handles:
 *   - "FIRST LAST" → {first: "FIRST", last: "LAST"}
 *   - "LAST, FIRST" → {first: "FIRST", last: "LAST"}
 *   - "FIRST MIDDLE LAST" → {first: "FIRST", last: "LAST"}
 */
function parseName(fullName) {
  if (!fullName) return { first: '', last: '' };
  
  const normalized = fullName.trim().toUpperCase();
  
  // Format: "LAST, FIRST"
  if (normalized.includes(',')) {
    const [last, first] = normalized.split(',').map(s => s.trim());
    return {
      first: first.split(' ')[0] || '',  // Take first word after comma
      last: last || ''
    };
  }
  
  // Format: "FIRST [MIDDLE] LAST"
  const parts = normalized.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: '', last: '' };
  if (parts.length === 1) return { first: parts[0], last: '' };
  
  return {
    first: parts[0],
    last: parts[parts.length - 1]  // Take last word as last name
  };
}

/**
 * Check if two names fuzzy match
 * Rules:
 *   - Last name: Exact match (case-insensitive)
 *   - First name: Starts with same 3+ characters (case-insensitive)
 */
function namesMatch(name1, name2) {
  const parsed1 = parseName(name1);
  const parsed2 = parseName(name2);
  
  // Last name must match exactly
  if (parsed1.last !== parsed2.last) return false;
  
  // First name must start with same 3 characters
  const first1 = parsed1.first.slice(0, 3);
  const first2 = parsed2.first.slice(0, 3);
  
  if (first1.length < 3 || first2.length < 3) {
    // If either name is too short, require exact match
    return parsed1.first === parsed2.first;
  }
  
  return first1 === first2;
}

/**
 * Calculate confidence score for name match
 * 1.0 = exact match
 * 0.9 = first 4+ chars match
 * 0.8 = first 3 chars match
 */
function calculateConfidence(name1, name2) {
  const parsed1 = parseName(name1);
  const parsed2 = parseName(name2);
  
  if (parsed1.first === parsed2.first && parsed1.last === parsed2.last) {
    return 1.0;  // Exact match
  }
  
  if (parsed1.first.slice(0, 4) === parsed2.first.slice(0, 4)) {
    return 0.9;  // First 4 chars match
  }
  
  return 0.8;  // First 3 chars match (minimum for namesMatch to return true)
}

// ─── Plan Change Detection ───────────────────────────────────────────────────

/**
 * Detect potential plan changes for newly uploaded records
 * Called automatically after successful upload
 */
async function detectPlanChanges(pool, uploadId) {
  try {
    console.log(`[PLAN_CHANGE] Starting detection for upload ${uploadId}`);
    
    // Get all new records from this upload
    const newRecordsResult = await pool.query(
      `SELECT id, agent_name, client_full_name, carrier, effective_date, payee
       FROM commission_records
       WHERE upload_id = $1`,
      [uploadId]
    );
    
    const newRecords = newRecordsResult.rows;
    console.log(`[PLAN_CHANGE] Processing ${newRecords.length} new records`);
    
    let candidatesFound = 0;
    
    for (const newRecord of newRecords) {
      const { id: newRecordId, agent_name, client_full_name, carrier: newCarrier, effective_date: newEffDate } = newRecord;
      
      // Parse new record name
      const newParsed = parseName(client_full_name);
      if (!newParsed.last) continue;  // Skip if can't parse last name
      
      // Query BOB for potential matches:
      // - Same agent
      // - Same last name (exact)
      // - Different carrier
      // - Has commission date (not never-paid)
      const bobResult = await pool.query(
        `SELECT 
          bob.id,
          bob.client_full_name,
          bob.carrier,
          bob.last_commission_date,
          bob.effective_date
         FROM book_of_business bob
         WHERE LOWER(bob.agent_name) = LOWER($1)
           AND LOWER(bob.carrier) != LOWER($2)
           AND bob.last_commission_date IS NOT NULL
           AND bob.status != 'termed'
           AND bob.status != 'plan_change'`,
        [agent_name, newCarrier]
      );
      
      // Fuzzy match on first name (client-side since SQL LIKE would be expensive)
      for (const bobEntry of bobResult.rows) {
        if (namesMatch(client_full_name, bobEntry.client_full_name)) {
          // Check date: new effective date > existing last commission date
          const oldDate = new Date(bobEntry.last_commission_date || bobEntry.effective_date);
          const newDate = new Date(newEffDate);
          
          if (newDate > oldDate) {
            const confidence = calculateConfidence(client_full_name, bobEntry.client_full_name);
            
            // Check if candidate already exists
            const existingCheck = await pool.query(
              `SELECT id FROM plan_change_candidates 
               WHERE bob_id = $1 AND new_record_id = $2`,
              [bobEntry.id, newRecordId]
            );
            
            if (existingCheck.rows.length === 0) {
              // Insert new candidate
              await pool.query(
                `INSERT INTO plan_change_candidates 
                 (bob_id, new_record_id, agent_name, client_name, old_carrier, new_carrier, 
                  old_effective_date, new_effective_date, confidence_score)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
                [
                  bobEntry.id,
                  newRecordId,
                  agent_name,
                  client_full_name,
                  bobEntry.carrier,
                  newCarrier,
                  bobEntry.last_commission_date || bobEntry.effective_date,
                  newEffDate,
                  confidence
                ]
              );
              
              candidatesFound++;
              console.log(`[PLAN_CHANGE] ✓ Match: ${client_full_name} (${bobEntry.carrier} → ${newCarrier})`);
            }
          }
        }
      }
    }
    
    console.log(`[PLAN_CHANGE] Detection complete: ${candidatesFound} candidates found`);
    return candidatesFound;
    
  } catch (error) {
    console.error('[PLAN_CHANGE] Detection error:', error);
    throw error;
  }
}

// ─── API Routes ──────────────────────────────────────────────────────────────

// POST /api/plan-changes/detect — Run detection for a specific upload
router.post('/detect', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { uploadId } = req.body;
    if (!uploadId) {
      return res.status(400).json({ error: 'uploadId required' });
    }
    
    const pool = getPool();
    const count = await detectPlanChanges(pool, uploadId);
    
    res.json({ 
      success: true, 
      candidatesFound: count,
      message: `Found ${count} potential plan change(s)`
    });
  } catch (error) {
    console.error('Detect plan changes error:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/plan-changes/candidates — List all pending candidates
router.get('/candidates', requireAuth, async (req, res) => {
  try {
    const pool = getPool();
    const { status = 'pending', agent, carrier } = req.query;
    
    let where = ['pcc.status = $1'];
    let params = [status];
    let idx = 2;
    
    if (agent) {
      where.push(`pcc.agent_name ILIKE $${idx++}`);
      params.push(`%${agent}%`);
    }
    
    if (carrier) {
      where.push(`(pcc.old_carrier ILIKE $${idx++} OR pcc.new_carrier ILIKE $${idx++})`);
      params.push(`%${carrier}%`, `%${carrier}%`);
    }
    
    const result = await pool.query(
      `SELECT 
        pcc.*,
        bob.agent_name as bob_agent,
        bob.client_full_name as bob_client,
        bob.carrier as bob_carrier,
        bob.last_commission_amount as bob_last_amount,
        bob.last_commission_date as bob_last_date,
        cr.client_full_name as new_client,
        cr.carrier as new_carrier_confirmed,
        cr.commission as new_commission,
        cr.effective_date as new_eff_date_confirmed
       FROM plan_change_candidates pcc
       JOIN book_of_business bob ON pcc.bob_id = bob.id
       JOIN commission_records cr ON pcc.new_record_id = cr.id
       WHERE ${where.join(' AND ')}
       ORDER BY pcc.created_at DESC`,
      params
    );
    
    res.json({ candidates: result.rows, total: result.rows.length });
  } catch (error) {
    console.error('Get candidates error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/plan-changes/:id/confirm — Confirm a plan change
router.post('/:id/confirm', requireAuth, requireAdmin, async (req, res) => {
  try {
    const pool = getPool();
    const { id } = req.params;
    const userId = req.user.email || req.user.name;
    
    // Get candidate details
    const candidate = await pool.query(
      `SELECT bob_id, status FROM plan_change_candidates WHERE id = $1`,
      [id]
    );
    
    if (candidate.rows.length === 0) {
      return res.status(404).json({ error: 'Candidate not found' });
    }
    
    if (candidate.rows[0].status !== 'pending') {
      return res.status(400).json({ error: 'Candidate already processed' });
    }
    
    const bobId = candidate.rows[0].bob_id;
    
    // Start transaction
    await pool.query('BEGIN');
    
    try {
      // Update BOB entry status to 'plan_change'
      await pool.query(
        `UPDATE book_of_business 
         SET status = 'plan_change', updated_at = NOW()
         WHERE id = $1`,
        [bobId]
      );
      
      // Update candidate status
      await pool.query(
        `UPDATE plan_change_candidates
         SET status = 'confirmed', confirmed_at = NOW(), confirmed_by = $1
         WHERE id = $2`,
        [userId, id]
      );
      
      await pool.query('COMMIT');
      
      res.json({ 
        success: true, 
        message: 'Plan change confirmed',
        bobId 
      });
    } catch (error) {
      await pool.query('ROLLBACK');
      throw error;
    }
  } catch (error) {
    console.error('Confirm plan change error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/plan-changes/:id/dismiss — Dismiss a false positive
router.post('/:id/dismiss', requireAuth, requireAdmin, async (req, res) => {
  try {
    const pool = getPool();
    const { id } = req.params;
    const userId = req.user.email || req.user.name;
    
    const result = await pool.query(
      `UPDATE plan_change_candidates
       SET status = 'dismissed', confirmed_at = NOW(), confirmed_by = $1
       WHERE id = $2 AND status = 'pending'
       RETURNING id`,
      [userId, id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Candidate not found or already processed' });
    }
    
    res.json({ success: true, message: 'Plan change dismissed' });
  } catch (error) {
    console.error('Dismiss plan change error:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/plan-changes/bob/:bobId — Get pending candidates for a specific BOB entry
router.get('/bob/:bobId', requireAuth, async (req, res) => {
  try {
    const pool = getPool();
    const { bobId } = req.params;
    
    const result = await pool.query(
      `SELECT 
        pcc.*,
        cr.client_full_name as new_client,
        cr.carrier as new_carrier,
        cr.commission as new_commission,
        cr.effective_date as new_effective_date
       FROM plan_change_candidates pcc
       JOIN commission_records cr ON pcc.new_record_id = cr.id
       WHERE pcc.bob_id = $1 AND pcc.status = 'pending'
       ORDER BY pcc.confidence_score DESC, pcc.created_at DESC
       LIMIT 1`,
      [bobId]
    );
    
    res.json({ candidate: result.rows[0] || null });
  } catch (error) {
    console.error('Get BOB candidates error:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = { router, detectPlanChanges };
