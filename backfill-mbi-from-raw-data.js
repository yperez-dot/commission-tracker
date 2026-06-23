// Backfill MBI and carrier_member_id for existing agency_production rows
// Extracts from raw_data JSONB column using same logic as parser

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: 'postgresql://postgres:LyahRMtjzhkPkaPpXtgysioPUBUVPAOi@metro.proxy.rlwy.net:24676/railway'
});

// Validate MBI format (fixed regex - tested against real data)
function validateMBI(value) {
  if (!value) return null;
  const cleaned = String(value).trim().toUpperCase();
  if (cleaned.length !== 11) return null;
  // Real MBI pattern: positions 3, 6, and 9 can be digit OR letter
  const mbiPattern = /^[1-9][A-Z][0-9A-Z][0-9][A-Z][0-9A-Z][0-9][A-Z][0-9A-Z][0-9]{2}$/;
  if (!mbiPattern.test(cleaned)) return null;
  return cleaned;
}

// Extract identifiers from raw_data based on carrier
function extractMemberIdentifiers(rawData, carrier) {
  let mbi = null;
  let carrier_member_id = null;
  let policy_number_production = null;
  
  switch(carrier) {
    case 'Anthem':
      mbi = validateMBI(rawData.Beneficiary_Claim_Number);
      carrier_member_id = rawData.HCID ? String(rawData.HCID).trim() : null;
      break;
    case 'Humana':
      mbi = validateMBI(rawData.MEDICARE_IDENTIFIER);
      carrier_member_id = rawData.UMID ? String(rawData.UMID).trim() : null;
      break;
    case 'UnitedHealthcare':
      if (rawData['Policy Number'] && rawData['HICN/MBI']) {
        // UHC Med Supp
        mbi = validateMBI(rawData['HICN/MBI']);
        policy_number_production = rawData['Policy Number'] ? String(rawData['Policy Number']).trim() : null;
      } else if (rawData.HIC) {
        // UHC MA
        mbi = validateMBI(rawData.HIC);
      }
      break;
    case 'Devoted':
      mbi = validateMBI(rawData.MBI);
      carrier_member_id = rawData.MemberRecordLocator ? String(rawData.MemberRecordLocator).trim() : null;
      break;
    case 'HealthSpring':
      mbi = validateMBI(rawData.Medicare_Number);
      carrier_member_id = rawData.Member_ID ? String(rawData.Member_ID).trim() : null;
      break;
    case 'Freedom':
      mbi = validateMBI(rawData['HIC#'] || rawData.HIC);
      carrier_member_id = (rawData.POLICY_NUMBER || rawData.CONTRACT) ? String(rawData.POLICY_NUMBER || rawData.CONTRACT).trim() : null;
      break;
    default:
      // Try common MBI column names
      const possibleMBI = rawData.MBI || rawData.HICN || rawData['HICN/MBI'] || rawData.HIC || rawData['HIC#'] || rawData.Medicare_Number || rawData.MEDICARE_IDENTIFIER;
      mbi = validateMBI(possibleMBI);
  }
  
  return { mbi, carrier_member_id, policy_number_production };
}

async function backfillMBI(dryRun = true) {
  try {
    console.log('=== MBI Backfill Script ===\n');
    console.log(`Mode: ${dryRun ? '🔍 DRY RUN (no changes)' : '✍️  LIVE (will update database)'}\n`);
    
    // Get all rows with NULL mbi
    const result = await pool.query(`
      SELECT id, carrier, raw_data
      FROM agency_production
      WHERE mbi IS NULL
      ORDER BY id
    `);
    
    console.log(`Found ${result.rows.length} rows with NULL mbi\n`);
    
    if (result.rows.length === 0) {
      console.log('✅ No backfill needed - all rows already have MBI');
      await pool.end();
      return;
    }
    
    let updated = 0;
    let skipped = 0;
    let errors = 0;
    
    const carrierStats = {};
    
    for (const row of result.rows) {
      try {
        const identifiers = extractMemberIdentifiers(row.raw_data, row.carrier);
        
        if (!carrierStats[row.carrier]) {
          carrierStats[row.carrier] = { total: 0, withMBI: 0, withoutMBI: 0 };
        }
        carrierStats[row.carrier].total++;
        
        if (identifiers.mbi || identifiers.carrier_member_id || identifiers.policy_number_production) {
          carrierStats[row.carrier].withMBI++;
          
          if (!dryRun) {
            await pool.query(
              `UPDATE agency_production
               SET mbi = $1, carrier_member_id = $2, policy_number_production = $3
               WHERE id = $4`,
              [identifiers.mbi, identifiers.carrier_member_id, identifiers.policy_number_production, row.id]
            );
          }
          updated++;
        } else {
          carrierStats[row.carrier].withoutMBI++;
          skipped++;
        }
      } catch (err) {
        console.error(`Error processing row ${row.id}:`, err.message);
        errors++;
      }
    }
    
    console.log('=== Results by Carrier ===\n');
    for (const [carrier, stats] of Object.entries(carrierStats)) {
      const extractionRate = ((stats.withMBI / stats.total) * 100).toFixed(1);
      console.log(`${carrier}:`);
      console.log(`  Total rows: ${stats.total}`);
      console.log(`  ✅ MBI extracted: ${stats.withMBI} (${extractionRate}%)`);
      console.log(`  ❌ No MBI found: ${stats.withoutMBI}`);
      console.log('');
    }
    
    console.log('=== Summary ===\n');
    console.log(`Total rows processed: ${result.rows.length}`);
    console.log(`✅ Would update: ${updated}`);
    console.log(`⏭️  Would skip (no MBI): ${skipped}`);
    console.log(`❌ Errors: ${errors}`);
    
    if (dryRun) {
      console.log('\n🔍 This was a DRY RUN - no changes made');
      console.log('To apply changes, run: node backfill-mbi-from-raw-data.js --live');
    } else {
      console.log('\n✅ Backfill complete!');
    }
    
    await pool.end();
  } catch (error) {
    console.error('Fatal error:', error);
    await pool.end();
    process.exit(1);
  }
}

// Check if --live flag provided
const isLive = process.argv.includes('--live');
backfillMBI(!isLive);
