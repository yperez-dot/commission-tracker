#!/usr/bin/env node
/**
 * Import Carolina's existing statement into OliComm database
 */

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: 'postgresql://postgres:LyahRMtjzhkPkaPpXtgysioPUBUVPAOi@metro.proxy.rlwy.net:24676/railway',
  ssl: false
});

// Carolina's statement data from May 30, 2026
const statementData = {
  agent_name: 'Carolina Robles',
  payment_date: '2026-05-30',
  period_label: 'January - April 2026',
  commission_structure: {
    plan_changes: '$100 flat',
    new_to_medicare: '$150 flat',
    lead_generated: 'Full commission'
  },
  items: [
    { client_name: 'Camila Hican', carrier: 'Cataplus', transaction_type: 'New to Book', amount: 100.00 },
    { client_name: 'Brenda Montelh', carrier: 'Humana', transaction_type: 'New to Book', amount: 100.00 },
    { client_name: 'Candi Alonso', carrier: 'PCP', transaction_type: 'New to Book', amount: 0.00, note: 'Under Carolina book, Paid by UHC 1/24/26' },
    { client_name: 'David Alonso', carrier: 'PCP', transaction_type: 'New to Book', amount: 0.00, note: 'Under Carolina book, Paid by UHC 1/24/26' },
    { client_name: 'Donald Hardge', carrier: 'Doctors', transaction_type: 'Plan Changes', amount: -247.00, note: 'Under Carolina book, Paid by Drs 1/16/26' },
    { client_name: 'Estela Sosa', carrier: 'PCP', transaction_type: 'New to Book', amount: 100.00 },
    { client_name: 'Gaspe Padron', carrier: 'PCP', transaction_type: 'Plan Changes', amount: 100.00 },
    { client_name: 'Isabel Ferrer', carrier: 'PCP', transaction_type: 'New to Book', amount: -247.00, note: 'Under Carolina book, Paid by UHC 1/24/26' },
    { client_name: 'Vincent S', carrier: 'Doctors', transaction_type: 'New to Book', amount: -247.00, note: 'Under Carolina book, Paid by Drs 1/16/26' },
    { client_name: 'Maria Padron', carrier: 'PCP', transaction_type: 'Plan Changes', amount: 100.00 },
    { client_name: 'Shirley ST hill', carrier: 'PCP', transaction_type: 'New to Book', amount: 100.00, note: 'Paid by Broker Society April' },
    { client_name: 'Fredericks H', carrier: 'SOLIS', transaction_type: 'New to Book', amount: 100.00, note: 'Advance - commission not yet received' },
    { client_name: 'Patricio WillsRomero', carrier: 'AARP MED SUPP', transaction_type: 'Medigap', amount: 436.50, note: 'Under THEI book, UHC paid 4/24/26' }
  ]
};

async function importStatement() {
  try {
    console.log('📊 Importing Carolina statement to OliComm...\n');
    
    // Calculate total
    const total_amount = statementData.items.reduce((sum, item) => sum + item.amount, 0);
    
    // Insert statement
    const statementResult = await pool.query(
      `INSERT INTO loa_statements 
       (agent_name, payment_date, period_label, total_amount, status, commission_structure, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        statementData.agent_name,
        statementData.payment_date,
        statementData.period_label,
        total_amount,
        'approved', // Mark as approved since you already sent it
        JSON.stringify(statementData.commission_structure),
        'Yahoska Perez'
      ]
    );
    
    const statement = statementResult.rows[0];
    console.log(`✅ Statement created - ID: ${statement.id}`);
    console.log(`   Agent: ${statement.agent_name}`);
    console.log(`   Total: $${statement.total_amount}`);
    console.log();
    
    // Insert items
    for (let i = 0; i < statementData.items.length; i++) {
      const item = statementData.items[i];
      await pool.query(
        `INSERT INTO loa_statement_items 
         (statement_id, client_name, carrier, transaction_type, amount, note, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [statement.id, item.client_name, item.carrier, item.transaction_type, item.amount, item.note || null, i]
      );
      
      console.log(`   ✅ ${i+1}. ${item.client_name} - ${item.carrier} - $${item.amount}`);
    }
    
    console.log();
    console.log('🎉 Carolina statement imported successfully!');
    console.log(`   Statement ID: ${statement.id}`);
    console.log(`   Total: $${statement.total_amount}`);
    console.log();
    console.log('You can now view and export it from OliComm → Payroll → LOA Statements');
    
  } catch (err) {
    console.error('❌ Error:', err.message);
  } finally {
    await pool.end();
  }
}

importStatement();
