#!/usr/bin/env node

/**
 * UHC PartD Extraction Script
 * 
 * Extracts missed PartD records from already-uploaded UHC files
 * Target uploads: 318-325, 332-333
 * 
 * DOES NOT re-upload files - reads from existing uploads table raw_data
 * 
 * Usage:
 *   node scripts/extract-uhc-partd-from-uploads.js              # Dry run
 *   node scripts/extract-uhc-partd-from-uploads.js --apply      # Apply changes
 */

const { Pool } = require('pg');
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

const DRY_RUN = !process.argv.includes('--apply');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const TARGET_UPLOAD_IDS = [318, 319, 320, 321, 322, 323, 324, 325, 332, 333];

function normalizePeriod(value) {
  if (!value) return 'Unknown';
  const s = String(value).trim();
  if (s.match(/^\d{6}$/) && parseInt(s.slice(0,4)) > 1900) return s;
  const m1 = s.match(/^(\d{1,2})\/(\d{4})$/);
  if (m1) return m1[2] + m1[1].padStart(2, '0');
  const m2 = s.match(/^(\d{1,2})\/\d{1,2}\/(\d{4})$/);
  if (m2) return m2[2] + m2[1].padStart(2, '0');
  return 'Unknown';
}

function formatDate(value) {
  if (!value) return '';
  if (value instanceof Date) {
    const m = String(value.getUTCMonth() + 1).padStart(2, '0');
    const d = String(value.getUTCDate()).padStart(2, '0');
    const y = value.getUTCFullYear();
    return `${m}/${d}/${y}`;
  }
  if (typeof value === 'string') {
    if (value.match(/^\d{1,2}\/\d{1,2}\/\d{4}$/)) return value;
    if (value.match(/^\d{4}-\d{2}-\d{2}/)) {
      const [y, m, d] = value.split('-');
      return `${m}/${d}/${y}`;
    }
    return value;
  }
  if (typeof value === 'number') {
    const date = new Date((value - 25569) * 86400 * 1000);
    if (isNaN(date.getTime())) return String(value);
    const m = String(date.getUTCMonth() + 1).padStart(2, '0');
    const d = String(date.getUTCDate()).padStart(2, '0');
    const y = date.getUTCFullYear();
    return `${m}/${d}/${y}`;
  }
  return String(value);
}

function normalizeAgentName(name) {
  if (!name) return '';
  const n = String(name).trim();
  const normalized = n.replace(/\s+/g, ' ')
    .replace(/\b[A-Z]\b\.?/g, m => m.toUpperCase())
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
  return normalized;
}

function isAgencyName(name) {
  const n = String(name || '').toLowerCase().trim();
  return n.includes('the health experts') || n.includes('health experts insurance');
}

function isValidClientName(clientName) {
  if (!clientName) return false;
  const name = String(clientName).trim();
  if (name === '') return false;
  const lower = name.toLowerCase();
  const artifacts = ['summary', 'deduction', 'total', 'balance', 'subtotal', 'grand total'];
  for (const artifact of artifacts) {
    if (lower.includes(artifact)) return false;
  }
  return true;
}

async function extractPartDFromUpload(uploadId, filename) {
  console.log(`\n📄 Processing upload ${uploadId}: ${filename}`);
  
  // Read file from uploads directory
  const filePath = path.join('/tmp', 'uploads', filename);
  
  if (!fs.existsSync(filePath)) {
    console.log(`  ⚠️  File not found: ${filePath}`);
    return [];
  }
  
  try {
    const wb = XLSX.readFile(filePath);
    const sheetName = wb.SheetNames.find(s => s.toLowerCase().includes('commission trans')) || wb.SheetNames[0];
    const ws = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(ws, { defval: '', raw: true });
    
    const partDRecords = [];
    
    for (const row of rows) {
      const rawPlanType = String(row['Plan Type'] || '').trim().toLowerCase();
      
      // Only process PartD/PDP records
      if (!rawPlanType.includes('partd') && rawPlanType !== 'partd') {
        continue;
      }
      
      const writingAgentRaw = String(row['Writing Agent Name'] || '').trim();
      const client = String(row['Member Name'] || '').trim();
      
      const commissionRaw = row['Commission'];
      let commission = 0;
      if (typeof commissionRaw === 'number') {
        commission = commissionRaw;
      } else if (typeof commissionRaw === 'string') {
        commission = parseFloat(commissionRaw.replace(/[$,]/g, '')) || 0;
      }
      
      if (!isValidClientName(client) || commission === 0) continue;
      
      const policyNumber = String(row['Policy Number'] || '').trim();
      const effectiveDate = formatDate(row['Original Effective Date']);
      const period = normalizePeriod(String(row['Payment Period'] || '').trim());
      const commAction = String(row['Commission Action'] || '').trim();
      
      const isAgency = isAgencyName(writingAgentRaw);
      const agentName = isAgency ? 'The Health Experts Insurance' : normalizeAgentName(writingAgentRaw);
      
      const commActionLower = commAction.toLowerCase();
      const classification = commActionLower === 'new' ? 'New Business'
        : commActionLower === 'renewal' ? 'Renewal'
        : commActionLower.includes('chargeback') ? 'Chargeback'
        : 'Agent Commission';
      
      partDRecords.push({
        uploadId,
        agent: agentName,
        carrier: 'UnitedHealthcare',
        planType: 'UnitedHealthcare PDP',
        client,
        effectiveDate,
        premium: parseFloat(row['Prem Amount']) || 0,
        commission,
        classification: commission < 0 ? 'Chargeback' : classification,
        period,
        policyNumber,
        lob: 'PDP',
        raw: row
      });
    }
    
    console.log(`  ✓ Found ${partDRecords.length} PartD records`);
    return partDRecords;
    
  } catch (err) {
    console.error(`  ✗ Error processing file: ${err.message}`);
    return [];
  }
}

async function main() {
  console.log('🔍 UHC PartD Extraction Script\n');
  console.log(`Mode: ${DRY_RUN ? '🔎 DRY RUN (no changes)' : '✅ APPLY CHANGES'}`);
  console.log(`Target uploads: ${TARGET_UPLOAD_IDS.join(', ')}\n`);
  
  try {
    // Get upload info
    const uploadsResult = await pool.query(
      `SELECT id, filename, original_name, uploaded_at 
       FROM uploads 
       WHERE id = ANY($1)
       ORDER BY id`,
      [TARGET_UPLOAD_IDS]
    );
    
    if (uploadsResult.rows.length === 0) {
      console.log('No uploads found');
      await pool.end();
      return;
    }
    
    console.log(`Found ${uploadsResult.rows.length} uploads to process\n`);
    
    let allPartDRecords = [];
    
    for (const upload of uploadsResult.rows) {
      const records = await extractPartDFromUpload(upload.id, upload.filename);
      allPartDRecords = allPartDRecords.concat(records.map(r => ({ ...r, uploadId: upload.id })));
    }
    
    console.log('\n' + '='.repeat(60));
    console.log('SUMMARY');
    console.log('='.repeat(60));
    console.log(`Total PartD records found: ${allPartDRecords.length}`);
    
    if (allPartDRecords.length > 0) {
      console.log('\nSample PartD records:');
      allPartDRecords.slice(0, 5).forEach((r, i) => {
        console.log(`${i + 1}. ${r.client} | ${r.planType} | $${r.commission} | ${r.period}`);
      });
      
      if (!DRY_RUN) {
        console.log('\n💾 Inserting records into database...');
        
        let inserted = 0;
        for (const r of allPartDRecords) {
          try {
            await pool.query(
              `INSERT INTO commission_records (
                 upload_id, agent_name, carrier, plan_type, client_full_name, effective_date,
                 premium, commission, classification, payment_period, policy_number,
                 lob, raw_data
               )
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
              [
                r.uploadId, r.agent, r.carrier, r.planType, r.client, r.effectiveDate,
                r.premium, r.commission, r.classification, r.period, r.policyNumber,
                r.lob, JSON.stringify(r.raw)
              ]
            );
            inserted++;
          } catch (err) {
            console.error(`  ✗ Error inserting record for ${r.client}: ${err.message}`);
          }
        }
        
        console.log(`\n✅ Inserted ${inserted} PartD records`);
      } else {
        console.log('\n⚠️  DRY RUN MODE - No changes applied');
        console.log('Run with --apply to insert these records into the database');
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
