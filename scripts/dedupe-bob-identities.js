#!/usr/bin/env node
'use strict';

/**
 * Soft-dedupe Book of Business identity duplicates — with identifier confirmation.
 *
 * Same person under different name formats (FIRST LAST vs LAST, FIRST) share
 * clientNameKey|carrier. We only inactivate when identifiers confirm the match:
 *   - shared / compatible policy # (BOB + commission_records), OR
 *   - same effective date + complementary name formats, OR
 *   - bob_export + statement pair with complementary formats and no policy conflict
 *
 * Skips groups with conflicting policies (after normalization) or weak name-only matches.
 *
 * Usage:
 *   node scripts/dedupe-bob-identities.js                 # dry run (THEI principals)
 *   node scripts/dedupe-bob-identities.js --apply         # apply THEI principals
 *   node scripts/dedupe-bob-identities.js --all --apply   # all active BOB (confirmed only)
 *   node scripts/dedupe-bob-identities.js --all --strict-policy --apply  # policy confirm required
 */

const fs = require('fs');
const { Pool } = require('pg');
const {
  clientCarrierKey,
  preferBobClient,
  normPeriod,
  isTheiPrincipalAgent,
} = require('../src/missingRenewalsLogic');

const APPLY = process.argv.includes('--apply');
const ALL = process.argv.includes('--all');
const STRICT_POLICY = process.argv.includes('--strict-policy');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false },
});

function pickKeep(list) {
  return list.reduce((best, row) => preferBobClient(best, row));
}

function normPol(p) {
  return String(p || '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toUpperCase();
}

function normEff(d) {
  if (!d) return '';
  const s = String(d).trim();
  const m1 = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m1) return `${m1[3]}-${m1[1].padStart(2, '0')}-${m1[2].padStart(2, '0')}`;
  const m2 = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m2) return `${m2[1]}-${m2[2]}-${m2[3]}`;
  return '';
}

function complementaryNameFormats(list) {
  const comma = list.some((r) => String(r.client_full_name).includes(','));
  const plain = list.some((r) => !String(r.client_full_name).includes(','));
  return comma && plain;
}

/** UHC often stores policy with/without trailing check digit — treat as same family. */
function policiesCompatible(pols) {
  const cleaned = [...new Set((pols || []).map(normPol).filter((p) => p.length >= 6))];
  if (cleaned.length <= 1) return { ok: true, canonical: cleaned[0] || null, families: cleaned };

  // Cluster by prefix: if A starts with B or B starts with A, same family
  const families = [];
  for (const p of cleaned) {
    let placed = false;
    for (const fam of families) {
      if (fam.some((f) => f.startsWith(p) || p.startsWith(f))) {
        fam.push(p);
        placed = true;
        break;
      }
    }
    if (!placed) families.push([p]);
  }

  if (families.length === 1) {
    const canonical = families[0].sort((a, b) => b.length - a.length)[0];
    return { ok: true, canonical, families: cleaned };
  }
  return { ok: false, canonical: null, families: cleaned };
}

/**
 * @returns {{ action: 'keep'|'skip', reason: string, evidence: object }}
 */
function classifyGroup(list, histPols = []) {
  const bobPols = list.map((r) => normPol(r.policy_number)).filter(Boolean);
  const allPols = [...bobPols, ...histPols.map(normPol).filter(Boolean)];
  const pol = policiesCompatible(allPols);
  const effs = [...new Set(list.map((r) => normEff(r.effective_date)).filter(Boolean))];
  const sources = [...new Set(list.map((r) => r.source || ''))];
  const agents = [
    ...new Set(
      list.map((r) =>
        String(r.agent_name || '')
          .toLowerCase()
          .replace(/[^a-z]/g, '')
      )
    ),
  ].filter(Boolean);
  const nameFlip = complementaryNameFormats(list);
  const exportPlusStatement =
    sources.includes('bob_export') && (sources.includes('statement') || sources.includes('bob'));

  const evidence = {
    policies: pol.families,
    policyCanonical: pol.canonical,
    effectiveDates: effs,
    sources,
    agents,
    nameFlip,
  };

  if (!pol.ok) {
    return { action: 'skip', reason: 'conflicting_policies', evidence };
  }

  if (STRICT_POLICY && !pol.canonical) {
    return { action: 'skip', reason: 'strict_policy_required', evidence };
  }

  // Strong: shared compatible policy
  if (pol.canonical) {
    if (nameFlip || exportPlusStatement || agents.length <= 1 || effs.length === 1) {
      return { action: 'keep', reason: 'policy_confirmed', evidence };
    }
    // policy alone is still strong for same name-key + carrier
    return { action: 'keep', reason: 'policy_confirmed', evidence };
  }

  // Medium: same effective date + name format flip
  if (effs.length === 1 && nameFlip) {
    return { action: 'keep', reason: 'same_eff_name_flip', evidence };
  }

  // Medium: classic BOB export + statement name flip, same agent, no policy conflict
  if (nameFlip && exportPlusStatement && agents.length === 1) {
    return { action: 'keep', reason: 'export_statement_same_agent', evidence };
  }

  // Medium-weak but common: export + statement name flip, eff within 2 years
  if (nameFlip && exportPlusStatement && effs.length >= 1) {
    const years = effs.map((e) => parseInt(e.slice(0, 4), 10)).filter(Boolean);
    if (years.length && Math.max(...years) - Math.min(...years) <= 2) {
      return { action: 'keep', reason: 'export_statement_eff_close', evidence };
    }
  }

  return { action: 'skip', reason: 'insufficient_identifiers', evidence };
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL required');
    process.exit(1);
  }

  console.log(
    `BOB identity dedupe — ${APPLY ? 'APPLY' : 'DRY RUN'} — scope=${ALL ? 'all active' : 'Yahoska/Katy'}${STRICT_POLICY ? ' — strict-policy' : ''}\n`
  );

  const { rows } = await pool.query(`
    SELECT id, client_full_name, carrier, agent_name, effective_date, policy_number,
           last_commission_date, last_commission_amount, status, source, resolution, notes
    FROM book_of_business
    WHERE status = 'active'
    ORDER BY id
  `);

  // Commission history policies for confirmation (and MBI rarely on BOB)
  const hist = await pool.query(`
    SELECT client_full_name, carrier, policy_number
    FROM commission_records
    WHERE policy_number IS NOT NULL AND TRIM(policy_number) <> ''
  `);
  const histPolByKey = new Map();
  for (const r of hist.rows) {
    const key = clientCarrierKey(r.client_full_name, r.carrier);
    if (!key) continue;
    if (!histPolByKey.has(key)) histPolByKey.set(key, []);
    histPolByKey.get(key).push(r.policy_number);
  }

  const groups = new Map();
  for (const r of rows) {
    if (!ALL && !isTheiPrincipalAgent(r.agent_name)) continue;
    const key = clientCarrierKey(r.client_full_name, r.carrier);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }

  // Expand THEI-scoped groups to include non-principal twins (house agent rows)
  if (!ALL) {
    for (const key of [...groups.keys()]) {
      groups.set(
        key,
        rows.filter((r) => clientCarrierKey(r.client_full_name, r.carrier) === key)
      );
    }
  }

  const dupGroups = [...groups.entries()].filter(([, list]) => list.length > 1);
  const actions = [];
  const skipped = [];
  const reasonCounts = {};

  for (const [key, list] of dupGroups) {
    const histPols = histPolByKey.get(key) || [];
    const verdict = classifyGroup(list, histPols);
    reasonCounts[verdict.reason] = (reasonCounts[verdict.reason] || 0) + 1;

    if (verdict.action === 'skip') {
      skipped.push({
        key,
        reason: verdict.reason,
        evidence: verdict.evidence,
        names: list.map((r) => r.client_full_name),
        ids: list.map((r) => r.id),
      });
      continue;
    }

    const keep = pickKeep(list);
    for (const row of list) {
      if (row.id === keep.id) continue;
      // Prefer copying policy onto keep if keep lacks it
      actions.push({
        key,
        confirmReason: verdict.reason,
        evidence: verdict.evidence,
        keepId: keep.id,
        keepName: keep.client_full_name,
        keepLast: normPeriod(keep.last_commission_date) || '',
        keepAmt: keep.last_commission_amount || 0,
        keepSource: keep.source || '',
        keepPolicy: keep.policy_number || '',
        dupId: row.id,
        dupName: row.client_full_name,
        dupLast: normPeriod(row.last_commission_date) || '',
        dupAmt: row.last_commission_amount || 0,
        dupSource: row.source || '',
        dupPolicy: row.policy_number || '',
        carrier: keep.carrier || row.carrier,
        agent: row.agent_name || '',
        enrichPolicy: !keep.policy_number && row.policy_number ? row.policy_number : null,
        enrichPolicyFromHist:
          !keep.policy_number && !row.policy_number && verdict.evidence.policyCanonical
            ? verdict.evidence.policyCanonical
            : null,
      });
    }
  }

  console.log(`Active rows scanned: ${rows.length}`);
  console.log(`Duplicate identity groups: ${dupGroups.length}`);
  console.log(`Confirmed groups to clean: ${reasonCounts.policy_confirmed || 0} policy + others below`);
  console.log(`Rows to inactivate: ${actions.length}`);
  console.log(`Groups skipped: ${skipped.length}`);
  console.log('Reason breakdown:', JSON.stringify(reasonCounts, null, 2));

  console.log('\nIdentifiers used for confirmation:');
  console.log('  • policy_number on BOB (normalized; trailing-digit variants OK)');
  console.log('  • policy_number from commission_records for same name-key|carrier');
  console.log('  • effective_date (same / within 2 years)');
  console.log('  • source pair bob_export + statement');
  console.log('  • complementary name formats (FIRST LAST ↔ LAST, FIRST)');
  console.log('  • agent (same-agent strengthens; not required if policy confirms)');
  console.log('  • BOB has no MBI column — commission mbi not required for this pass');

  const preview = actions.slice(0, 12);
  console.log('\nSample KEEP ← DUP (first 12):');
  for (const a of preview) {
    console.log(
      `  [${a.confirmReason}] KEEP #${a.keepId} ${a.keepName} (pol=${a.keepPolicy || a.enrichPolicy || '—'})  ←  DUP #${a.dupId} ${a.dupName}`
    );
  }
  if (actions.length > preview.length) console.log(`  ... +${actions.length - preview.length} more`);

  if (skipped.length) {
    console.log('\nSkipped samples (first 8):');
    for (const s of skipped.slice(0, 8)) {
      console.log(`  [${s.reason}] ${s.names.join(' | ')} pols=${(s.evidence.policies || []).join(',') || '—'}`);
    }
  }

  const outPath = '/opt/cursor/artifacts/bob-dedupe-actions-all.csv';
  const skipPath = '/opt/cursor/artifacts/bob-dedupe-skipped.csv';
  fs.mkdirSync('/opt/cursor/artifacts', { recursive: true });
  fs.writeFileSync(
    outPath,
    [
      'identity_key,confirm_reason,keep_id,keep_name,keep_policy,keep_last,keep_amt,dup_id,dup_name,dup_policy,dup_source,carrier,agent,policies_evidence',
      ...actions.map((a) =>
        [
          a.key,
          a.confirmReason,
          a.keepId,
          JSON.stringify(a.keepName),
          JSON.stringify(a.keepPolicy || a.enrichPolicy || ''),
          a.keepLast,
          a.keepAmt,
          a.dupId,
          JSON.stringify(a.dupName),
          JSON.stringify(a.dupPolicy),
          a.dupSource,
          JSON.stringify(a.carrier),
          JSON.stringify(a.agent),
          JSON.stringify((a.evidence.policies || []).join('|')),
        ].join(',')
      ),
    ].join('\n')
  );
  fs.writeFileSync(
    skipPath,
    [
      'identity_key,reason,names,ids,policies,effective_dates',
      ...skipped.map((s) =>
        [
          s.key,
          s.reason,
          JSON.stringify(s.names.join(' | ')),
          s.ids.join('|'),
          JSON.stringify((s.evidence.policies || []).join('|')),
          JSON.stringify((s.evidence.effectiveDates || []).join('|')),
        ].join(',')
      ),
    ].join('\n')
  );
  console.log(`\nWrote ${outPath}`);
  console.log(`Wrote ${skipPath}`);

  if (!APPLY) {
    console.log('\nDry run only. Re-run with --apply to inactivate confirmed duplicates.');
    await pool.end();
    return;
  }

  const client = await pool.connect();
  let updated = 0;
  let enriched = 0;
  try {
    await client.query('BEGIN');
    for (const a of actions) {
      if (a.enrichPolicy || a.enrichPolicyFromHist) {
        const pol = a.enrichPolicy || a.enrichPolicyFromHist;
        const er = await client.query(
          `UPDATE book_of_business
           SET policy_number = COALESCE(NULLIF(policy_number,''), $1),
               updated_at = NOW()
           WHERE id = $2 AND status = 'active'
           RETURNING id`,
          [pol, a.keepId]
        );
        enriched += er.rowCount;
      }
      const res = await client.query(
        `UPDATE book_of_business
         SET status = 'inactive',
             resolution = 'Duplicate identity',
             notes = COALESCE(notes, '') || CASE
               WHEN notes IS NULL OR notes = '' THEN $1
               ELSE E'\\n' || $1
             END,
             updated_at = NOW()
         WHERE id = $2 AND status = 'active'
         RETURNING id`,
        [
          `Duplicate of BOB #${a.keepId} (${a.keepName}); confirmed via ${a.confirmReason}`,
          a.dupId,
        ]
      );
      updated += res.rowCount;
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  // Remaining dups in scope after apply
  const still = await pool.query(
    `SELECT id, client_full_name, carrier, agent_name, policy_number, effective_date, source
     FROM book_of_business WHERE status = 'active'`
  );
  const stillGroups = new Map();
  for (const r of still.rows) {
    if (!ALL && !isTheiPrincipalAgent(r.agent_name)) continue;
    const key = clientCarrierKey(r.client_full_name, r.carrier);
    if (!key) continue;
    if (!stillGroups.has(key)) stillGroups.set(key, []);
    stillGroups.get(key).push(r);
  }
  if (!ALL) {
    for (const key of [...stillGroups.keys()]) {
      stillGroups.set(
        key,
        still.rows.filter((r) => clientCarrierKey(r.client_full_name, r.carrier) === key)
      );
    }
  }
  let remainingConfirmed = 0;
  let remainingAny = 0;
  for (const [key, list] of stillGroups) {
    if (list.length < 2) continue;
    remainingAny++;
    const histPols = histPolByKey.get(key) || [];
    if (classifyGroup(list, histPols).action === 'keep') remainingConfirmed++;
  }

  console.log(`\nUpdated (inactivated): ${updated}`);
  console.log(`Keep rows enriched with policy #: ${enriched}`);
  console.log(`Remaining active identity-dup groups (any): ${remainingAny}`);
  console.log(`Remaining that would still pass confirm rules: ${remainingConfirmed}`);
  console.log('\n✅ Confirmed dedupe complete (soft inactive).');
  await pool.end();
}

main().catch(async (err) => {
  console.error(err);
  try {
    await pool.end();
  } catch (_) {}
  process.exit(1);
});
