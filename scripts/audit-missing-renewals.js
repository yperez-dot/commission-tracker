'use strict';

/**
 * Audit Missing Renewals against production DB using the same logic as
 * GET /api/bob/missing-renewals-check.
 */
const { Pool } = require('pg');
const {
  buildMissingRenewalRows,
  buildLastPaidLookup,
  normName,
  normCarrier,
  normPeriod,
  isTheiPrincipalAgent,
  nameVariants,
  namesLooseMatch,
  heldIdentityKey,
  policyStatusKey,
} = require('../src/missingRenewalsLogic');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : undefined,
});

if (!process.env.DATABASE_URL) {
  console.error('Set DATABASE_URL to run this audit against production.');
  process.exit(1);
}

async function loadForPeriod(period) {
  const bobResult = await pool.query(
    `SELECT * FROM book_of_business
     WHERE status = 'active'
       AND (
         LOWER(agent_name) LIKE '%yahoska%'
         OR LOWER(agent_name) LIKE '%katy%'
         OR LOWER(agent_name) LIKE '%perez, yahoska%'
         OR LOWER(agent_name) LIKE '%robles, katy%'
       )
     ORDER BY agent_name, client_full_name`
  );

  const recResult = await pool.query(
    `SELECT id, client_full_name, carrier, agent_name, commission, classification,
            lob, payment_period, effective_date
     FROM commission_records
     WHERE payment_period = $1
        OR payment_period = $2
        OR payment_period = $3`,
    [
      period,
      `${period.slice(4, 6)}/${period.slice(0, 4)}`,
      `${period.slice(4, 6)}/01/${period.slice(0, 4)}`,
    ]
  );

  const periodRecords = recResult.rows.filter((r) => normPeriod(r.payment_period) === period);

  const heldResult = await pool.query(`
    SELECT cr.client_full_name, cr.carrier
    FROM commission_records cr
    JOIN uploads u ON cr.upload_id = u.id
    WHERE u.category = 'bsi_statement'
      AND cr.classification = 'Held'
      AND (
        cr.raw_data::jsonb->>'Hold Reason' ILIKE '%not licensed%'
        OR cr.raw_data::jsonb->>'Hold Reason' ILIKE '%not appointed%'
      )
      AND cr.client_full_name IS NOT NULL
  `);
  const heldKeySet = new Set();
  for (const h of heldResult.rows) {
    const key = heldIdentityKey(h.client_full_name, h.carrier);
    if (key) heldKeySet.add(key);
  }

  const psResult = await pool.query(
    `SELECT client_full_name, carrier, agent_name, status, termed_date, notes FROM policy_status`
  );
  const policyStatusMap = {};
  for (const ps of psResult.rows) {
    const key = policyStatusKey(ps.client_full_name, ps.carrier, ps.agent_name);
    if (key) policyStatusMap[key] = ps;
  }

  const histResult = await pool.query(
    `SELECT client_full_name, carrier, payment_period, commission, classification
     FROM commission_records
     WHERE commission IS NOT NULL AND commission > 0`
  );
  const lastPaidByKey = buildLastPaidLookup(histResult.rows);

  const bobClients = bobResult.rows.filter((c) => isTheiPrincipalAgent(c.agent_name));

  return {
    bobClients,
    periodRecords,
    heldKeySet,
    policyStatusMap,
    lastPaidByKey,
    rawBobCount: bobResult.rows.length,
  };
}

function analyzeFalsePositives(rows, periodRecords) {
  // For each "missing" row, check if a same-carrier commission exists under a near name
  // that our matcher failed to pick up — and also if last_paid is already >= period.
  const byCarrier = new Map();
  for (const r of periodRecords) {
    const ck = normCarrier(r.carrier);
    if (!byCarrier.has(ck)) byCarrier.set(ck, []);
    byCarrier.get(ck).push(r);
  }

  const suspects = [];
  for (const row of rows.filter((r) => r.isMissing)) {
    const nc = normCarrier(row.carrier);
    const poolRecs = byCarrier.get(nc) || [];

    // Exact variant miss?
    const variants = nameVariants(row.client);
    let anyVariantHit = false;
    for (const v of variants) {
      if (poolRecs.some((r) => nameVariants(r.client_full_name).includes(v))) {
        anyVariantHit = true;
        break;
      }
    }

    // Loose token overlap (shared >=1 surname-like)
    const loose = poolRecs.filter((r) => namesLooseMatch(row.client, r.client_full_name));
    const softHits = poolRecs.filter((r) => {
      const ta = normName(row.client).toLowerCase().split(/\s+/);
      const tb = normName(r.client_full_name).toLowerCase().split(/\s+/);
      const shared = ta.filter((t) => tb.includes(t) && t.length > 2);
      return shared.length >= 1;
    }).slice(0, 5);

    if (anyVariantHit || loose.length || softHits.length) {
      suspects.push({
        client: row.client,
        agent: row.agent,
        carrier: row.carrier,
        lastPaidPeriod: row.lastPaidPeriod,
        monthsMissing: row.monthsMissing,
        matchCount: row.matchCount,
        isHeld: row.isHeld,
        anyVariantHit,
        looseHits: loose.slice(0, 3).map((r) => ({
          name: r.client_full_name,
          class: r.classification,
          commission: r.commission,
        })),
        softHits: softHits.slice(0, 3).map((r) => ({
          name: r.client_full_name,
          class: r.classification,
          commission: r.commission,
        })),
      });
    }
  }
  return suspects;
}

function summarize(payload) {
  const rows = payload.rows || [];
  const missing = rows.filter((r) => r.isMissing && !r.isHeld);
  const held = rows.filter((r) => r.isHeld);
  const paid = rows.filter((r) => !r.isMissing);
  const dismissed = rows.filter((r) =>
    ['plan_change', 'ignore', 'termed'].includes(r.policyStatus)
  );
  const chase = rows.filter((r) => r.policyStatus === 'chase');

  const byCarrier = {};
  for (const r of missing) {
    const c = r.carrier || '(blank)';
    if (!byCarrier[c]) byCarrier[c] = { missing: 0, neverPaid: 0, monthsSum: 0 };
    byCarrier[c].missing++;
    if (!r.lastPaidPeriod) byCarrier[c].neverPaid++;
    byCarrier[c].monthsSum += r.monthsMissing || 0;
  }

  const byAgent = {};
  for (const r of missing) {
    const a = r.agent || '(blank)';
    if (!byAgent[a]) byAgent[a] = 0;
    byAgent[a]++;
  }

  const byMonths = {};
  for (const r of missing) {
    const m = String(r.monthsMissing || 0);
    byMonths[m] = (byMonths[m] || 0) + 1;
  }

  // Sample missing that look "paid elsewhere" via lastPaidPeriod == period (shouldn't happen)
  const lastPaidCaughtUpButMissing = missing.filter((r) => {
    const lp = normPeriod(r.lastPaidPeriod);
    return lp && lp >= payload.period;
  });

  return {
    period: payload.period,
    periodLabel: payload.periodLabel,
    checkedClients: payload.checkedClients,
    periodRecordCount: payload.periodRecordCount,
    summary: payload.summary,
    dismissedFromList: dismissed.length,
    chaseCount: chase.length,
    paidSample: paid.slice(0, 5).map((r) => ({
      client: r.client,
      carrier: r.carrier,
      commission: r.commission,
      matchCount: r.matchCount,
    })),
    missingByCarrier: Object.entries(byCarrier)
      .map(([carrier, v]) => ({
        carrier,
        missing: v.missing,
        neverPaid: v.neverPaid,
        avgMonthsMissing: +(v.monthsSum / v.missing).toFixed(1),
      }))
      .sort((a, b) => b.missing - a.missing),
    missingByAgent: byAgent,
    missingByMonthsMissing: byMonths,
    lastPaidCaughtUpButMissing: lastPaidCaughtUpButMissing.length,
    topMissing: missing
      .slice()
      .sort((a, b) => (b.monthsMissing || 0) - (a.monthsMissing || 0))
      .slice(0, 25)
      .map((r) => ({
        client: r.client,
        agent: r.agent,
        carrier: r.carrier,
        lastPaid: r.lastPaidPeriod,
        months: r.monthsMissing,
        lastAmt: r.lastKnownCommission,
        status: r.policyStatus,
        matches: r.matchCount,
      })),
  };
}

async function main() {
  const periodsRes = await pool.query(`
    SELECT payment_period, COUNT(*)::int AS n
    FROM commission_records
    WHERE payment_period IS NOT NULL AND TRIM(payment_period) <> ''
    GROUP BY payment_period
    ORDER BY COUNT(*) DESC
    LIMIT 40
  `);

  // Normalize to YYYYMM and pick recent distinct
  const periodCounts = new Map();
  for (const row of periodsRes.rows) {
    const n = normPeriod(row.payment_period);
    if (!n) continue;
    periodCounts.set(n, (periodCounts.get(n) || 0) + row.n);
  }
  const recent = [...periodCounts.entries()].sort((a, b) => b[0].localeCompare(a[0])).slice(0, 8);

  console.log('=== Period inventory (normalized) ===');
  console.log(JSON.stringify(recent.map(([p, n]) => ({ period: p, records: n })), null, 2));

  // Also check how many distinct payment_period strings exist for latest months
  const formatSamples = await pool.query(`
    SELECT payment_period, COUNT(*)::int AS n
    FROM commission_records
    WHERE payment_period ILIKE '%2026%' OR payment_period ILIKE '2026%'
    GROUP BY payment_period
    ORDER BY n DESC
    LIMIT 40
  `);
  console.log('=== Raw 2026 period formats ===');
  console.log(JSON.stringify(formatSamples.rows, null, 2));

  const targetPeriods = recent.map(([p]) => p).slice(0, 4);
  // Prefer Jul/Jun/May 2026 if present
  for (const prefer of ['202607', '202606', '202605', '202604']) {
    if (periodCounts.has(prefer) && !targetPeriods.includes(prefer)) targetPeriods.unshift(prefer);
  }
  const uniqueTargets = [...new Set(targetPeriods)].slice(0, 4);

  const audits = [];
  for (const period of uniqueTargets) {
    const { bobClients, periodRecords, heldKeySet, policyStatusMap, lastPaidByKey, rawBobCount } =
      await loadForPeriod(period);
    const payload = buildMissingRenewalRows({
      bobClients,
      periodRecords,
      period,
      heldKeySet,
      policyStatusMap,
      lastPaidByKey,
    });
      heldKeySet,
      policyStatusMap,
    });
    const summary = summarize(payload);
    summary.rawBobBeforePrincipalFilter = rawBobCount;
    summary.principalBob = bobClients.length;

    // Match rate among renewal-eligible
    const matchRate =
      payload.rows.length === 0
        ? null
        : +(
            (100 * payload.rows.filter((r) => !r.isMissing).length) / payload.rows.length
          ).toFixed(1);

    // Among missing: how many have zero period matches vs held-only
    const missingRows = payload.rows.filter((r) => r.isMissing);
    const zeroMatch = missingRows.filter((r) => !r.matchCount).length;
    const heldOnly = missingRows.filter((r) => r.isHeld).length;
    const withMatchesButMissing = missingRows.filter((r) => r.matchCount > 0 && !r.isHeld).length;

    summary.matchRatePaidPct = matchRate;
    summary.missingBreakdown = {
      totalMissingInclHeld: missingRows.length,
      zeroCommissionMatch: zeroMatch,
      heldLicensing: heldOnly,
      matchedButStillMissingNonHeld: withMatchesButMissing,
    };

    const suspects = analyzeFalsePositives(payload.rows, periodRecords);
    summary.possibleMatcherMisses = suspects.length;
    summary.possibleMatcherMissSamples = suspects.slice(0, 15);

    // Carrier coverage: BOB carriers vs period record carriers
    const bobCarriers = {};
    for (const c of bobClients) {
      const k = normCarrier(c.carrier);
      bobCarriers[k] = (bobCarriers[k] || 0) + 1;
    }
    const recCarriers = {};
    for (const r of periodRecords) {
      const k = normCarrier(r.carrier);
      recCarriers[k] = (recCarriers[k] || 0) + 1;
    }
    summary.carrierCoverage = Object.keys({ ...bobCarriers, ...recCarriers })
      .sort()
      .map((k) => ({
        carrier: k,
        bobActive: bobCarriers[k] || 0,
        periodRecords: recCarriers[k] || 0,
      }))
      .filter((x) => x.bobActive > 0)
      .sort((a, b) => b.bobActive - a.bobActive);

    audits.push(summary);
  }

  console.log('=== AUDIT RESULTS ===');
  console.log(JSON.stringify(audits, null, 2));

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
