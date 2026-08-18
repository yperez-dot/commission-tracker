'use strict';

const { enrichBobClientsWithIdentifiers, formatIdentifierDate } = require('./bobClientIdentifiers');

const DOB_FROM_JSON = `
  COALESCE(
    NULLIF(TRIM(j->>'DOB'), ''),
    NULLIF(TRIM(j->>'Date of Birth'), ''),
    NULLIF(TRIM(j->>'date_of_birth'), ''),
    NULLIF(TRIM(j->>'Date_of_Birth'), ''),
    NULLIF(TRIM(j->>'DATE_OF_BIRTH'), ''),
    NULLIF(TRIM(j->>'Birth Date'), ''),
    NULLIF(TRIM(j->>'Birth_Date'), ''),
    NULLIF(TRIM(j->>'BIRTH_DATE'), ''),
    NULLIF(TRIM(j->>'birthdate'), ''),
    NULLIF(TRIM(j->>'BirthDate'), ''),
    NULLIF(TRIM(j->>'DateOfBirth'), ''),
    NULLIF(TRIM(j->>'Member DOB'), ''),
    NULLIF(TRIM(j->>'Member_DOB'), ''),
    NULLIF(TRIM(j->>'MEMBER_DOB'), ''),
    NULLIF(TRIM(j->>'Member Date of Birth'), ''),
    NULLIF(TRIM(j->>'Member_Birth_Date'), ''),
    NULLIF(TRIM(j->>'BirthDt'), '')
  )
`;

async function fetchRelatedIdentifierRows(pool) {
  const [commission, production, medicarepro] = await Promise.all([
    pool.query(`
      SELECT client_full_name, carrier, policy_number, mbi, carrier_member_id,
             ${DOB_FROM_JSON} AS date_of_birth,
             'commission' AS identifier_source
      FROM commission_records
      LEFT JOIN LATERAL (
        SELECT CASE WHEN raw_data ~ '^\\s*\\{' THEN raw_data::jsonb ELSE '{}'::jsonb END AS j
      ) x ON true
      WHERE client_full_name IS NOT NULL AND TRIM(client_full_name) <> ''
    `).catch(async (err) => {
      console.error('BOB identifier backfill: commission lookup with DOB failed:', err.message);
      return pool.query(`
        SELECT client_full_name, carrier, policy_number, mbi, carrier_member_id,
               NULL AS date_of_birth,
               'commission' AS identifier_source
        FROM commission_records
        WHERE client_full_name IS NOT NULL AND TRIM(client_full_name) <> ''
      `).catch((err2) => {
        console.error('BOB identifier backfill: commission lookup failed:', err2.message);
        return { rows: [] };
      });
    }),
    pool.query(`
      SELECT client_name AS client_full_name, carrier, policy_number, policy_number_production,
             mbi, carrier_member_id, raw_data,
             ${DOB_FROM_JSON} AS date_of_birth,
             'production' AS identifier_source
      FROM agency_production
      LEFT JOIN LATERAL (
        SELECT COALESCE(raw_data, '{}'::jsonb) AS j
      ) x ON true
      WHERE client_name IS NOT NULL AND TRIM(client_name) <> ''
    `).catch((err) => {
      console.error('BOB identifier backfill: production lookup failed:', err.message);
      return { rows: [] };
    }),
    pool.query(`
      SELECT client_name AS client_full_name, carrier, policy_number,
             ${DOB_FROM_JSON} AS date_of_birth,
             'medicarepro' AS identifier_source
      FROM medicarepro_sales
      LEFT JOIN LATERAL (
        SELECT COALESCE(raw_data, '{}'::jsonb) AS j
      ) x ON true
      WHERE client_name IS NOT NULL AND TRIM(client_name) <> ''
    `).catch((err) => {
      console.error('BOB identifier backfill: MedicarePro lookup failed:', err.message);
      return { rows: [] };
    }),
  ]);

  return [...production.rows, ...medicarepro.rows, ...commission.rows];
}

function summarize(rows, updated) {
  return {
    total: rows.length,
    updated,
    withMemberId: rows.filter((r) => r.member_id).length,
    withPolicy: rows.filter((r) => r.policy_number).length,
    withDob: rows.filter((r) => r.date_of_birth).length,
  };
}

async function backfillBobIdentifiers(pool) {
  const bob = await pool.query(
    `SELECT id, client_full_name, carrier, member_id, policy_number, date_of_birth
     FROM book_of_business`
  );
  if (!bob.rows.length) return summarize([], 0);

  const related = await fetchRelatedIdentifierRows(pool);
  const enriched = enrichBobClientsWithIdentifiers(bob.rows, related);
  const origById = new Map(bob.rows.map((r) => [r.id, r]));

  const toUpdate = enriched.filter((row) => {
    const orig = origById.get(row.id) || {};
    const filledMember = row.member_id && !(orig.member_id || '');
    const filledPolicy = row.policy_number && !(orig.policy_number || '');
    const filledDob = row.date_of_birth && !(orig.date_of_birth || '');
    return filledMember || filledPolicy || filledDob;
  });

  if (!toUpdate.length) return summarize(enriched, 0);

  await pool.query(
    `UPDATE book_of_business b SET
       member_id = COALESCE(NULLIF(v.member_id, ''), b.member_id),
       policy_number = COALESCE(NULLIF(v.policy_number, ''), b.policy_number),
       date_of_birth = COALESCE(NULLIF(v.date_of_birth, ''), b.date_of_birth)
     FROM unnest($1::int[], $2::text[], $3::text[], $4::text[])
       AS v(id, member_id, policy_number, date_of_birth)
     WHERE b.id = v.id`,
    [
      toUpdate.map((r) => r.id),
      toUpdate.map((r) => r.member_id || ''),
      toUpdate.map((r) => r.policy_number || ''),
      toUpdate.map((r) => formatIdentifierDate(r.date_of_birth) || r.date_of_birth || ''),
    ]
  );

  return summarize(enriched, toUpdate.length);
}

module.exports = {
  fetchRelatedIdentifierRows,
  backfillBobIdentifiers,
};
