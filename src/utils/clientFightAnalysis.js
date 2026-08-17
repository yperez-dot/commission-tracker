import { isOverrideStatementRow } from '../agencyOverrideReconMatch';
import { clientNameKey } from '../clientNameKey';
import { normalizeCarrier } from '../matchingNormalize';
import { detectUploadDestination } from './uploadDestination';
import CARRIER_FIGHT_PACK_INDEX from './carrierFightPackIndex';

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function rowAmount(row) {
  const payable = parseFloat(row.producer_payable || 0);
  if (payable !== 0) return payable;
  return parseFloat(row.commission) || 0;
}

function isBsiStatementRow(row) {
  if (String(row.upload_category || '').toLowerCase() === 'bsi_statement') return true;
  const dest = detectUploadDestination(row.upload_name || '');
  return dest.id === 'bsi_statement';
}

function isPaidOnBsiRow(row) {
  const c = String(row.classification || '').toLowerCase();
  const amt = rowAmount(row);
  if (amt <= 0) return false;
  return (
    c.includes('new business') ||
    c.includes('renewal') ||
    (c.includes('agency override') && !c.includes('chargeback')) ||
    (c.includes('override') && !c.includes('agent') && !c.includes('chargeback'))
  );
}

function isClawOnBsiRow(row) {
  const c = String(row.classification || '').toLowerCase();
  const amt = rowAmount(row);
  if (c.includes('chargeback')) return Math.abs(amt) > 0;
  return amt < 0;
}

function formatLineSummary(row) {
  const period = row.payment_period ? String(row.payment_period) : '—';
  const type = row.classification || '—';
  const amt = rowAmount(row);
  const src = row.upload_name ? ` · ${row.upload_name}` : '';
  return `${period} · ${type} · $${Math.abs(amt).toFixed(2)}${src}`;
}

export function lookupFightPackEntry(client, carrier) {
  const ck = clientNameKey(client);
  const car = normalizeCarrier(carrier);
  if (!ck || !car) return null;

  for (const entry of Object.values(CARRIER_FIGHT_PACK_INDEX)) {
    if (clientNameKey(entry.client) === ck && normalizeCarrier(entry.carrier) === car) {
      return entry;
    }
  }
  return null;
}

function isAgencyBsiRow(row) {
  return isPaidOnBsiRow(row) || isClawOnBsiRow(row);
}

function analyzeBsiCarrierFight(bsiRows) {
  const paidLines = [];
  const clawLines = [];
  let paid = 0;
  let clawed = 0;
  let net = 0;

  for (const row of bsiRows) {
    if (!isAgencyBsiRow(row)) continue;
    const amt = rowAmount(row);
    net += amt;
    if (isPaidOnBsiRow(row) && amt > 0) {
      paid += amt;
      paidLines.push(row);
    }
    if (isClawOnBsiRow(row)) {
      clawed += Math.abs(amt);
      clawLines.push(row);
    }
  }

  paid = round2(paid);
  clawed = round2(clawed);
  net = round2(net);
  const overClaw = net < -0.01 ? round2(Math.abs(net)) : 0;

  let errorCode = null;
  if (overClaw > 0) {
    const cbCount = clawLines.length;
    if (cbCount >= 2 && paid > 0) errorCode = 'DOUBLE_CLAW';
    else errorCode = 'OVER_CLAW';
  }

  return {
    paid,
    clawed,
    net,
    overClaw,
    errorCode,
    paidLines,
    clawLines,
    lineSummaries: [...paidLines, ...clawLines].map(formatLineSummary),
  };
}

function analyzeTheiRemittance(theiRows) {
  const overrideRows = theiRows.filter(isOverrideStatementRow);
  let net = 0;
  let paid = 0;
  let clawed = 0;

  for (const row of overrideRows) {
    const amt = rowAmount(row);
    net += amt;
    if (amt > 0) paid += amt;
    else clawed += Math.abs(amt);
  }

  net = round2(net);
  paid = round2(paid);
  clawed = round2(clawed);
  const theiAskBsi = net < -0.01 ? round2(Math.abs(net)) : 0;

  return {
    net,
    paid,
    clawed,
    theiAskBsi,
    overrideRows,
    lineSummaries: overrideRows.map(formatLineSummary),
  };
}

function splitWhenPaid(amount) {
  const half = round2(amount / 2);
  return { theiShare: half, bsiShare: round2(amount - half) };
}

function defaultAskCarrier(client, carrier, amount) {
  return `Please reverse the incorrect chargeback and repay Brokerage Solutions Inc (BSI) $${amount.toFixed(2)} for ${client} (${carrier}).`;
}

/**
 * Analyze commission history for carrier/THEI fight signals (Client file modal).
 */
export function analyzeClientFightHistory({ client, carrier, rows }) {
  const bsiRows = (rows || []).filter(isBsiStatementRow);
  const theiRows = (rows || []).filter((r) => !isBsiStatementRow(r));
  const carrierFight = analyzeBsiCarrierFight(bsiRows);
  const theiFight = analyzeTheiRemittance(theiRows);
  const packEntry = lookupFightPackEntry(client, carrier);

  const fights = [];

  if (packEntry?.fightType === 'Missing_pay') {
    const split = splitWhenPaid(packEntry.amount);
    fights.push({
      bucket: 'C',
      bucketLabel: 'Carrier → BSI',
      fightType: 'Missing_pay',
      fightTypePlain: packEntry.fightTypePlain,
      errorCode: 'MISSING_PAY',
      amount: packEntry.amount,
      theiShare: packEntry.theiShare || split.theiShare,
      bsiShare: packEntry.bsiShare || split.bsiShare,
      confidence: packEntry.confidence || 'HIGH',
      inOfficialPacket: true,
      sendOrder: packEntry.sendOrder,
      proof: packEntry.proof,
      askCarrier: packEntry.askCarrier,
      note: packEntry.note,
      source: 'fight_pack',
    });
  } else if (carrierFight.overClaw > 0 || packEntry?.fightType === 'Wrong_claw') {
    const amount = packEntry?.amount || carrierFight.overClaw;
    const split = splitWhenPaid(amount);
    fights.push({
      bucket: 'C',
      bucketLabel: 'Carrier → BSI',
      fightType: 'Wrong_claw',
      fightTypePlain: packEntry?.fightTypePlain || 'Incorrect chargeback — reverse claw',
      errorCode: packEntry?.errorCode || carrierFight.errorCode || 'OVER_CLAW',
      amount,
      theiShare: packEntry?.theiShare ?? split.theiShare,
      bsiShare: packEntry?.bsiShare ?? split.bsiShare,
      confidence: packEntry ? packEntry.confidence : carrierFight.overClaw >= 30 ? 'MEDIUM' : 'LOW',
      inOfficialPacket: Boolean(packEntry),
      sendOrder: packEntry?.sendOrder ?? 1,
      proof: packEntry?.proof || carrierFight.lineSummaries.join('; '),
      askCarrier: packEntry?.askCarrier || defaultAskCarrier(client, carrier, amount),
      note: packEntry
        ? packEntry.note
        : 'Detected from Client file — not yet in official carrier packet',
      detectedAmount: carrierFight.overClaw,
      bsiSummary: carrierFight,
      source: packEntry ? 'fight_pack+history' : 'history',
    });
  }

  if (theiFight.theiAskBsi > 0) {
    fights.push({
      bucket: 'A',
      bucketLabel: 'THEI claws → ask BSI',
      fightType: 'THEI_claw',
      fightTypePlain: 'Bad claw on BSI→THEI remittance',
      errorCode: 'THEI_OVER_CLAW',
      amount: theiFight.theiAskBsi,
      theiShare: theiFight.theiAskBsi,
      bsiShare: 0,
      confidence: theiFight.theiAskBsi >= 20 ? 'MEDIUM' : 'LOW',
      inOfficialPacket: false,
      proof: theiFight.lineSummaries.join('; '),
      note: 'Separate from carrier packet — ask BSI after carrier/THEI remittance review',
      theiSummary: theiFight,
      source: 'history',
    });
  }

  const hasCarrierFight = fights.some((f) => f.bucket === 'C');
  const headline = hasCarrierFight
    ? fights.find((f) => f.bucket === 'C')
    : fights[0] || null;

  return {
    client,
    carrier,
    fights,
    headline,
    packEntry,
    carrierFight,
    theiFight,
    hasFight: fights.length > 0,
    inOfficialPacket: Boolean(packEntry),
  };
}
