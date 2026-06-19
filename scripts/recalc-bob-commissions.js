#!/usr/bin/env node

/**
 * BOB Commission Recalculation Script
 * 
 * Updates last_commission_amount and last_commission_date for all BOB clients
 * based on the latest data in commission_records.
 * 
 * Usage:
 *   node scripts/recalc-bob-commissions.js                    # All clients
 *   node scripts/recalc-bob-commissions.js --carrier=Humana   # Specific carrier
 *   node scripts/recalc-bob-commissions.js --zero-only        # Only clients with $0
 */

const { Pool } = require('pg');

const CARRIER_FILTER = process.argv.find(arg => arg.startsWith('--carrier='))?.split('=')[1];
const ZERO_ONLY = process.argv.includes('--zero-only');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  console.log('💰 BOB Commission Recalculation Script\n');
  
  if (CARRIER_FILTER) {
    console.log(`Carrier filter: ${CARRIER_FILTER}`);
  }
  if (ZERO_ONLY) {
    console.log('Mode: Only recalculating clients with $0 commission');
  }
  console.log('');
  
  try {
    // Build WHERE clause for filtering
    let whereClause = `b.status = 'active'`;
    const params = [];
    let paramIndex = 1;
    
    if (CARRIER_FILTER) {
      whereClause += ` AND LOWER(b.carrier) = LOWER($${paramIndex})`;
      params.push(CARRIER_FILTER);
      paramIndex++;
    }
    
    if (ZERO_ONLY) {
      whereClause += ` AND (b.last_commission_amount = 0 OR b.last_commission_amount IS NULL)`;
    }
    
    // Update query
    const updateQuery = `
      UPDATE book_of_business b
      SET 
        last_commission_amount = subq.max_commission,
        last_commission_date = TO_DATE(subq.max_period, 'YYYYMM'),
        updated_at = NOW()
      FROM (
        SELECT 
          cr.client_full_name, 
          cr.carrier,
          cr.agent_name,
          MAX(cr.commission) as max_commission,
          MAX(cr.payment_period) as max_period
        FROM commission_records cr
        WHERE cr.commission > 0
        GROUP BY cr.client_full_name, cr.carrier, cr.agent_name
      ) subq
      WHERE LOWER(TRIM(b.client_full_name)) = LOWER(TRIM(subq.client_full_name))
        AND LOWER(TRIM(b.carrier)) = LOWER(TRIM(subq.carrier))
        AND LOWER(TRIM(b.agent_name)) = LOWER(TRIM(subq.agent_name))
        AND ${whereClause}
      RETURNING b.id, b.client_full_name, b.carrier, b.last_commission_amount, b.last_commission_date
    `;
    
    console.log('Running recalculation...\n');
    
    const result = await pool.query(updateQuery, params);
    
    console.log('='.repeat(60));
    console.log('RESULTS');
    console.log('='.repeat(60));
    console.log(`Total clients updated: ${result.rowCount}\n`);
    
    if (result.rows.length > 0) {
      console.log('Updated clients (showing first 20):');
      result.rows.slice(0, 20).forEach((row, i) => {
        console.log(`${i + 1}. ${row.client_full_name} (${row.carrier})`);
        console.log(`   Amount: $${row.last_commission_amount}`);
        console.log(`   Date: ${row.last_commission_date ? row.last_commission_date.toISOString().split('T')[0] : 'N/A'}`);
      });
      
      if (result.rows.length > 20) {
        console.log(`\n... and ${result.rows.length - 20} more`);
      }
    }
    
    console.log('\n✅ Recalculation complete!');
    
  } catch (err) {
    console.error('Error:', err.message);
    console.error(err.stack);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
