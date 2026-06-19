#!/usr/bin/env node

/**
 * BOB Name Cleanup Script
 * 
 * Fixes BOB client names that don't match commission_records format.
 * Finds BOB clients with last_commission_amount = 0 and searches for
 * fuzzy name matches in commission_records to update the name.
 * 
 * Usage:
 *   node scripts/cleanup-bob-names.js              # Dry run (show changes)
 *   node scripts/cleanup-bob-names.js --apply      # Apply changes
 *   node scripts/cleanup-bob-names.js --carrier Humana --apply
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

// Normalize name for comparison
function normalizeName(name) {
  return name.toLowerCase().trim().replace(/\s+/g, ' ');
}

// Try to match "First Last" with "Last, First"
function reverseNameFormat(name) {
  const normalized = name.trim();
  
  // If already "Last, First" format, try "First Last"
  if (normalized.includes(',')) {
    const parts = normalized.split(',').map(p => p.trim());
    return `${parts[1]} ${parts[0]}`;
  }
  
  // If "First Last", try "Last, First"
  const parts = normalized.split(/\s+/);
  if (parts.length === 2) {
    return `${parts[1]}, ${parts[0]}`;
  }
  
  // If "First Middle Last", try "Last, First Middle"
  if (parts.length >= 3) {
    const lastName = parts[parts.length - 1];
    const firstAndMiddle = parts.slice(0, -1).join(' ');
    return `${lastName}, ${firstAndMiddle}`;
  }
  
  return null;
}

// Find best match in commission records
async function findMatchInCommissionRecords(bobClient) {
  const bobName = normalizeName(bobClient.client_full_name);
  const carrier = bobClient.carrier;
  const agent = bobClient.agent_name;
  
  // Build query to find potential matches
  // Match by carrier + agent + similar client name
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
    
    // Exact match
    if (bobName === commName) {
      return {
        matched_name: row.client_full_name,
        policy_number: row.policy_number,
        commission: row.commission,
        match_type: 'exact'
      };
    }
    
    // Try reversed format ("First Last" <-> "Last, First")
    const reversed = reverseNameFormat(bobClient.client_full_name);
    if (reversed && normalizeName(reversed) === commName) {
      return {
        matched_name: row.client_full_name,
        policy_number: row.policy_number,
        commission: row.commission,
        match_type: 'reversed'
      };
    }
    
    // Fuzzy match with Levenshtein distance
    const distance = levenshtein(bobName, commName);
    const maxLen = Math.max(bobName.length, commName.length);
    const similarity = 1 - (distance / maxLen);
    
    // If similarity > 80%, consider it a match
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
  console.log('🔍 BOB Name Cleanup Script\n');
  console.log(`Mode: ${DRY_RUN ? '🔎 DRY RUN (no changes)' : '✅ APPLY CHANGES'}`);
  if (CARRIER_FILTER) {
    console.log(`Carrier filter: ${CARRIER_FILTER}`);
  }
  console.log('');
  
  try {
    // Find all BOB clients with last_commission_amount = 0
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
            match_type: match.match_type
          });
          
          if (!DRY_RUN) {
            await pool.query(
              `UPDATE book_of_business SET client_full_name = $1, updated_at = NOW() WHERE id = $2`,
              [newName, client.id]
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
    
    // Step 2: Recalculate last_commission_amount for updated clients
    if (!DRY_RUN && changes.length > 0) {
      console.log('\n' + '='.repeat(60));
      console.log('RECALCULATING COMMISSION AMOUNTS');
      console.log('='.repeat(60));
      console.log('Updating last_commission_amount and last_commission_date...\n');
      
      const recalcResult = await pool.query(`
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
          AND b.status = 'active'
          AND b.id IN (${changes.map(c => c.id).join(', ')})
      `);
      
      console.log(`✓ Recalculated commission amounts for ${recalcResult.rowCount} clients\n`);
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
      });
      
      if (DRY_RUN) {
        console.log('\n⚠️  DRY RUN MODE - No changes applied');
        console.log('Run with --apply to update the database');
      } else {
        console.log('\n✅ Changes applied to database');
        console.log('✅ Commission amounts recalculated for updated clients');
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
