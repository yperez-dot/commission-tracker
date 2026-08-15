
if (!process.env.DATABASE_URL) { console.error('DATABASE_URL required'); process.exit(1); }
// Test MBI extraction against real production data in database
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

// Import validation function (FIXED - position 6 can be digit or letter)
function validateMBI(value) {
  if (!value) return null;
  const cleaned = String(value).trim().toUpperCase();
  if (cleaned.length !== 11) return null;
  // Real MBI pattern: positions 3, 6, and 9 can be digit OR letter
  const mbiPattern = /^[1-9][A-Z][0-9A-Z][0-9][A-Z][0-9A-Z][0-9][A-Z][0-9A-Z][0-9]{2}$/;
  if (!mbiPattern.test(cleaned)) return null;
  return cleaned;
}

async function testRealData() {
  try {
    console.log('=== Testing MBI Extraction Against Real Production Data ===\n');
    
    // Get sample rows per carrier from agency_production
    const carriers = ['Humana', 'Anthem', 'UnitedHealthcare', 'Devoted', 'HealthSpring', 'Freedom'];
    
    for (const carrier of carriers) {
      console.log(`\n--- ${carrier} ---`);
      
      const result = await pool.query(
        `SELECT id, client_name, status, raw_data 
         FROM agency_production 
         WHERE carrier = $1 
         ORDER BY id 
         LIMIT 5`,
        [carrier]
      );
      
      if (result.rows.length === 0) {
        console.log(`  ⚠️  No ${carrier} data found in database`);
        continue;
      }
      
      console.log(`  Found ${result.rows.length} sample records`);
      
      // Test MBI extraction for each row
      result.rows.forEach((row, idx) => {
        const rawData = row.raw_data;
        let mbiValue = null;
        let mbiSource = null;
        
        // Try to extract MBI based on carrier
        switch(carrier) {
          case 'Anthem':
            mbiValue = rawData.Beneficiary_Claim_Number;
            mbiSource = 'Beneficiary_Claim_Number';
            break;
          case 'Humana':
            mbiValue = rawData.MEDICARE_IDENTIFIER;
            mbiSource = 'MEDICARE_IDENTIFIER';
            break;
          case 'UnitedHealthcare':
            if (rawData['HICN/MBI']) {
              mbiValue = rawData['HICN/MBI'];
              mbiSource = 'HICN/MBI (Med Supp)';
            } else if (rawData.HIC) {
              mbiValue = rawData.HIC;
              mbiSource = 'HIC (MA)';
            }
            break;
          case 'Devoted':
            mbiValue = rawData.MBI;
            mbiSource = 'MBI';
            break;
          case 'HealthSpring':
            mbiValue = rawData.Medicare_Number;
            mbiSource = 'Medicare_Number';
            break;
          case 'Freedom':
            mbiValue = rawData['HIC#'] || rawData.HIC;
            mbiSource = 'HIC#';
            break;
        }
        
        const validated = validateMBI(mbiValue);
        const statusIcon = validated ? '✅' : '❌';
        
        console.log(`  ${idx + 1}. ${row.client_name} (${row.status})`);
        console.log(`     Raw MBI (${mbiSource}): "${mbiValue}"`);
        console.log(`     Validated: ${validated || 'NULL'} ${statusIcon}`);
      });
    }
    
    // Humana status breakdown test
    console.log('\n\n=== Humana Status Filter Test ===');
    const humanaStats = await pool.query(`
      SELECT 
        status,
        COUNT(*) as count
      FROM agency_production
      WHERE carrier = 'Humana'
      GROUP BY status
      ORDER BY count DESC
    `);
    
    if (humanaStats.rows.length > 0) {
      console.log('\nHumana production status breakdown:');
      let activeCount = 0;
      let inactiveCount = 0;
      
      humanaStats.rows.forEach(row => {
        const status = (row.status || '').toUpperCase();
        const isInactive = ['CANCELLED', 'CANCELED', 'INACTIVE', 'TERMINATED', 'TERMED'].some(s => status.includes(s));
        
        if (isInactive) {
          inactiveCount += parseInt(row.count);
          console.log(`  ❌ ${row.status}: ${row.count} (FILTERED OUT)`);
        } else {
          activeCount += parseInt(row.count);
          console.log(`  ✅ ${row.status}: ${row.count} (INCLUDED)`);
        }
      });
      
      console.log(`\nSummary:`);
      console.log(`  ✅ Active (would be included): ${activeCount}`);
      console.log(`  ❌ Inactive (would be filtered): ${inactiveCount}`);
      console.log(`  📊 Total: ${activeCount + inactiveCount}`);
      
      if (activeCount > 0 && inactiveCount > 0) {
        console.log(`\n✅ Status filter would work: ${inactiveCount} rows prevented from creating false "Override Missing"`);
      }
    } else {
      console.log('  ⚠️  No Humana data found');
    }
    
    // Check for real MBIs that might fail validation
    console.log('\n\n=== Real MBI Validation Check ===');
    const sampleMBIs = await pool.query(`
      SELECT DISTINCT 
        carrier,
        raw_data->>'MEDICARE_IDENTIFIER' as humana_mbi,
        raw_data->>'Beneficiary_Claim_Number' as anthem_mbi,
        raw_data->>'HIC' as uhc_ma_mbi,
        raw_data->>'HICN/MBI' as uhc_ms_mbi,
        raw_data->>'MBI' as devoted_mbi,
        raw_data->>'Medicare_Number' as hs_mbi,
        raw_data->>'HIC#' as freedom_mbi
      FROM agency_production
      WHERE carrier IN ('Humana', 'Anthem', 'UnitedHealthcare', 'Devoted', 'HealthSpring', 'Freedom')
      LIMIT 20
    `);
    
    const realMBIs = [];
    sampleMBIs.rows.forEach(row => {
      const mbi = row.humana_mbi || row.anthem_mbi || row.uhc_ma_mbi || row.uhc_ms_mbi || row.devoted_mbi || row.hs_mbi || row.freedom_mbi;
      if (mbi) realMBIs.push({ carrier: row.carrier, mbi: mbi });
    });
    
    if (realMBIs.length > 0) {
      console.log(`\nTesting ${realMBIs.length} real MBIs from database:\n`);
      let passCount = 0;
      let failCount = 0;
      
      realMBIs.forEach(({ carrier, mbi }) => {
        const validated = validateMBI(mbi);
        if (validated) {
          passCount++;
          console.log(`  ✅ ${carrier}: ${mbi} → ${validated}`);
        } else {
          failCount++;
          console.log(`  ❌ ${carrier}: ${mbi} → REJECTED (length: ${String(mbi).length})`);
        }
      });
      
      console.log(`\n📊 Validation results:`);
      console.log(`  ✅ Passed: ${passCount}/${realMBIs.length}`);
      console.log(`  ❌ Failed: ${failCount}/${realMBIs.length}`);
      
      if (failCount > 0) {
        console.log(`\n⚠️  WARNING: ${failCount} real MBIs rejected by validator - regex may be too strict!`);
      }
    }
    
    await pool.end();
  } catch (error) {
    console.error('Error:', error);
    await pool.end();
    process.exit(1);
  }
}

testRealData();
