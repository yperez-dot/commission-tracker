#!/usr/bin/env node

/**
 * BOB Name Cleanup Script (FIXED VERSION)
 * 
 * CRITICAL BUG FIX: Now updates ONLY by ID, never by name matching
 * Prevents duplicate BOB entries
 * 
 * Usage:
 *   node scripts/cleanup-bob-names-FIXED.js                    # Dry run
 *   node scripts/cleanup-bob-names-FIXED.js --apply            # Apply changes
 *   node scripts/cleanup-bob-names-FIXED.js --carrier=Humana --apply
 */

const { Pool } = require('pg');

const DRY_RUN = !process.argv.includes('--apply');
const CARRIER_FILTER = process.argv.find(arg => arg.startsWith('--carrier='))?.split('=')[1];

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Levenshtein distance for fuzzy matching
function levenshtein(a, b) {
  const matrix = [];
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  return matrix[b.length][a.length];
}

function normalizeName(name) {
  return name.toLowerCase().trim().replace(/\s+/g, ' ');
}

function reverseNameFormat(name) {
  const normalized = name.trim();
  if (normalized.includes(',')) {
    const parts = normalized.split(',').map(p => p.trim());
    return `${parts[1]} ${parts[0]}`;
  }
  const parts = normalized.split(/\s+/);
  if (parts.length === 2) {
    return `${parts[1]}, ${parts[0]}`;
  }
  if (parts.length >= 3) {
    const lastName = parts[parts.length - 1];
    const firstAndMiddle = parts.slice(0, -1).join(' ');
    return `${lastName}, ${firstAndMiddle}`;
  }
  return null;
}

async function findMatchInCommissionRecords(bobClient) {
  const bobName = normalizeName(bobClient.client_full_name);
  const carrier = bobClient.carrier;
  const agent = bobClient.agent_name;
  
  const query = `
    SELECT DISTINCT client_full_name, policy_number, effective_date, commission
    FROM commission_records
    WHERE LOWER(carrier) = LOWER($1)
      AND LOWER(agent_name) = LOWER($2)
      AND commission > 0
    ORDER BY created_at DESC
    LIMIT 100
  `;
  
  const result = await pool.query(query, [carrier, agent]);
  
  if (result.rows.length === 0) {
    return null;
  }
  
  let bestMatch = null;
  let bestScore = Infinity;
  
  for (const row of result.rows) {
    const commName = normalizeName(row.client_full_name);
    
    if (bobName === commName) {
      return {
        matched_name: row.client_full_name,
        policy_number: row.policy_number,
        commission: row.commission,
        match_type: 'exact'
      };
    }
    
    const reversed = reverseNameFormat(bobClient.client_full_name);
    if (reversed && normalizeName(reversed) === commName) {
      return {
        matched_name: row.client_full_name,
        policy_number: row.policy_number,
        commission: row.commission,
        match_type: 'reversed'
      };
    }
    
    const distance = levenshtein(bobName, commName);
    const maxLen = Math.max(bobName.length, commName.length);
    const similarity = 1 - (distance / maxLen);
    
    if (similarity > 0.80 && distance < bestScore) {
      bestScore = distance;
      bestMatch = {
        matched_name: row.client_full_name,
        policy_number: row.policy_number,
        commission: row.commission,
        match_type: 'fuzzy',
        similarity: (similarity * 100).toFixed(1) + '%'
      };
    }
  }
  
  return bestMatch;
}

async function main() {
  console.log('🔍 BOB Name Cleanup Script (FIXED VERSION)\n');
  console.log(`Mode: ${DRY_RUN ? '🔎 DRY RUN (no changes)' : '✅ APPLY CHANGES'}`);
  if (CARRIER_FILTER) {
    console.log(`Carrier filter: ${CARRIER_FILTER}`);
  }
  console.log('');
  
  try {
    let query = `
      SELECT id, client_full_name, carrier, agent_name, effective_date, created_at
      FROM book_of_business
      WHERE last_commission_amount = 0
        AND status = 'active'
    `;
    
    const params = [];
    if (CARRIER_FILTER) {
      query += ` AND LOWER(carrier) = LOWER($1)`;
      params.push(CARRIER_FILTER);
    }
    
    query += ` ORDER BY carrier, agent_name, client_full_name`;
    
    const bobClients = await pool.query(query, params);
    
    console.log(`Found ${bobClients.rows.length} BOB clients with $0 commission\n`);
    
    if (bobClients.rows.length === 0) {
      console.log('✓ No clients to process');
      await pool.end();
      return;
    }
    
    const changes = [];
    let matchCount = 0;
    let noMatchCount = 0;
    
    for (const client of bobClients.rows) {
      console.log(`Checking: "${client.client_full_name}" (${client.carrier}, ${client.agent_name})`);
      
      const match = await findMatchInCommissionRecords(client);
      
      if (match) {
        matchCount++;
        const oldName = client.client_full_name;
        const newName = match.matched_name;
        
        if (oldName !== newName) {
          console.log(`  ✓ Found: "${newName}" in commission_records`);
          console.log(`    Policy: ${match.policy_number}`);
          console.log(`    Commission: $${match.commission}`);
          console.log(`    Match type: ${match.match_type}${match.similarity ? ' (' + match.similarity + ')' : ''}`);
          console.log(`    UPDATE: "${oldName}" → "${newName}"\n`);
          
          changes.push({
            id: client.id,
            old_name: oldName,
            new_name: newName,
            carrier: client.carrier,
            agent: client.agent_name,
            policy: match.policy_number,
            commission: match.commission,
            match_type: match.match_type
          });
          
          // FIX: Update name AND commission in single query by ID only
          if (!DRY_RUN) {
            await pool.query(
              `UPDATE book_of_business 
               SET client_full_name = $1, 
                   last_commission_amount = $2,
                   updated_at = NOW() 
               WHERE id = $3`,
              [newName, match.commission, client.id]
            );
          }
        } else {
          console.log(`  ✓ Already matches commission_records format\n`);
        }
      } else {
        noMatchCount++;
        console.log(`  ✗ No match found in commission_records\n`);
      }
    }
    
    // FIX: Recalculate ONLY by ID for records we just updated
    if (!DRY_RUN && changes.length > 0) {
      console.log('\n' + '='.repeat(60));
      console.log('RECALCULATING COMMISSION DATES');
      console.log('='.repeat(60));
      console.log('Updating last_commission_date for updated clients...\n');
      
      // Update each record individually by ID with its specific commission data
      for (const change of changes) {
        // Find the latest payment period for this specific client
        const periodResult = await pool.query(`
          SELECT MAX(payment_period) as max_period
          FROM commission_records
          WHERE LOWER(TRIM(client_full_name)) = LOWER(TRIM($1))
            AND LOWER(TRIM(carrier)) = LOWER(TRIM($2))
            AND LOWER(TRIM(agent_name)) = LOWER(TRIM($3))
            AND commission > 0
        `, [change.new_name, change.carrier, change.agent]);
        
        if (periodResult.rows[0]?.max_period) {
          await pool.query(`
            UPDATE book_of_business 
            SET last_commission_date = TO_DATE($1, 'YYYYMM'),
                updated_at = NOW()
            WHERE id = $2
          `, [periodResult.rows[0].max_period, change.id]);
        }
      }
      
      console.log(`✓ Recalculated commission dates for ${changes.length} clients\n`);
    }
    
    console.log('\n' + '='.repeat(60));
    console.log('SUMMARY');
    console.log('='.repeat(60));
    console.log(`Total clients checked: ${bobClients.rows.length}`);
    console.log(`Matches found: ${matchCount}`);
    console.log(`No matches: ${noMatchCount}`);
    console.log(`Names updated: ${changes.length}`);
    
    if (changes.length > 0) {
      console.log('\nCHANGES:');
      changes.forEach((change, i) => {
        console.log(`${i + 1}. ${change.carrier} | ${change.agent}`);
        console.log(`   OLD: "${change.old_name}"`);
        console.log(`   NEW: "${change.new_name}"`);
        console.log(`   Policy: ${change.policy} (${change.match_type})`);
        console.log(`   Commission: $${change.commission}`);
      });
      
      if (DRY_RUN) {
        console.log('\n⚠️  DRY RUN MODE - No changes applied');
        console.log('Run with --apply to update the database');
      } else {
        console.log('\n✅ Changes applied to database');
        console.log('✅ Commission amounts and dates updated');
      }
    }
    
  } catch (err) {
    console.error('Error:', err.message);
    console.error(err.stack);
  } finally {
    await pool.end();
  }
}

main();
