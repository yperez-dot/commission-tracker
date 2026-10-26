'use strict';

/**
 * house_statement_payee_groups — which writing-agent ids share one house statement.
 * Self-creates. Empty table is seeded from the Integrity payee registry (already
 * in the codebase) so the primary producer + agency entity share a group and
 * the other producer stays separate. Edit rows later; no data is dropped.
 */

const { INTEGRITY_PAYEES } = require('../src/integrityStatement');
const { groupsFromIntegrityPayees } = require('../src/statementPayeeGroups');

let ready = false;

async function ensureGroupsTable(pool) {
  if (ready) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS house_statement_payee_groups (
      id SERIAL PRIMARY KEY,
      group_key TEXT NOT NULL,
      statement_type TEXT NOT NULL DEFAULT 'integrity',
      display_name TEXT NOT NULL,
      members TEXT[] NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'active',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (statement_type, group_key)
    )`);
  const n = await pool.query(`SELECT COUNT(*)::int AS c FROM house_statement_payee_groups`);
  if ((n.rows[0] && n.rows[0].c) === 0) {
    const seed = groupsFromIntegrityPayees(INTEGRITY_PAYEES);
    for (const g of seed) {
      await pool.query(
        `INSERT INTO house_statement_payee_groups (group_key, statement_type, display_name, members)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (statement_type, group_key) DO NOTHING`,
        [g.groupKey, g.statementType, g.displayName, g.members]
      );
    }
  }
  ready = true;
}

async function loadPayeeGroups(pool, statementType) {
  await ensureGroupsTable(pool);
  const params = [];
  let sql = `SELECT group_key, statement_type, display_name, members
               FROM house_statement_payee_groups WHERE status='active'`;
  if (statementType) {
    params.push(statementType);
    sql += ` AND statement_type = $1`;
  }
  sql += ` ORDER BY group_key`;
  const r = await pool.query(sql, params);
  return r.rows.map((row) => ({
    groupKey: row.group_key,
    statementType: row.statement_type,
    displayName: row.display_name,
    members: row.members || [],
  }));
}

module.exports = { ensureGroupsTable, loadPayeeGroups };
