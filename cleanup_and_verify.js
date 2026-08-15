
if (!process.env.DATABASE_URL) { console.error('DATABASE_URL required'); process.exit(1); }
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

async function cleanupAndVerify() {
  try {
    console.log('Checking for duplicate April uploads...\n');
    
    // Find all April statement uploads
    const uploads = await pool.query(`
      SELECT id, original_name, uploaded_at, 
             (SELECT COUNT(*) FROM commission_records WHERE upload_id = uploads.id) as record_count
      FROM uploads
      WHERE original_name LIKE '%Medicare%Statement%THE%April%'
      ORDER BY uploaded_at DESC
    `);
    
    console.log(`Found ${uploads.rows.length} April THE Statement uploads:`);
    uploads.rows.forEach(u => {
      console.log(`- Upload ${u.id}: ${u.record_count} records (${u.uploaded_at.toISOString().slice(0,16)})`);
    });
    
    if (uploads.rows.length > 1) {
      const oldUploadIds = uploads.rows.slice(1).map(u => u.id);
      console.log(`\nDeleting old uploads: ${oldUploadIds.join(', ')}`);
      
      // Delete old commission records
      const deleteRecords = await pool.query(`
        DELETE FROM commission_records 
        WHERE upload_id = ANY($1)
      `, [oldUploadIds]);
      console.log(`✅ Deleted ${deleteRecords.rowCount} old records`);
      
      // Delete old uploads
      const deleteUploads = await pool.query(`
        DELETE FROM uploads 
        WHERE id = ANY($1)
      `, [oldUploadIds]);
      console.log(`✅ Deleted ${deleteUploads.rowCount} old uploads`);
    } else {
      console.log('\n✅ Only one April upload found - no cleanup needed');
    }
    
  } catch (err) {
    console.error('❌ Error:', err.message);
  } finally {
    await pool.end();
  }
}

cleanupAndVerify();
