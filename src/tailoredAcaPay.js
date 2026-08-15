'use strict';

/**
 * Tailored Insurance Solutions ACA (NHP) — paid straight to the writing agent
 * (e.g. Jill Taylor), not THEI house.
 *
 * Statement title example:
 *   THE HEALTH EXPERST INSURANCE - TAILORED INSURANCE SOLUTIONS AGCY - JILL TAYLOR
 * Agency column:
 *   The Health Experts Insurance-Tailored Insurance Solutions Agency
 * Agent Name: Jill Taylor · Comm Class: Commission · Molina ACA
 */

function normText(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Agency / title branding — Tailored book under THEI. */
function isTailoredAgency(agencyOrTitle) {
  const n = normText(agencyOrTitle);
  if (!n) return false;
  return n.includes('tailored insurance') || /\btailored\b/.test(n);
}

/** Legacy: agent name itself was Tailored (rare). */
function isTailoredInsuranceAgent(agentName) {
  return isTailoredAgency(agentName);
}

/**
 * True when this ACA row is Tailored pass-through to the writing agent.
 */
function isTailoredAcaPassThrough({ agentName, agency, statementTitle } = {}) {
  return (
    isTailoredAgency(agency) ||
    isTailoredAgency(statementTitle) ||
    isTailoredInsuranceAgent(agentName)
  );
}

/**
 * ACA $ → producer_payable for the writing agent (Jill Taylor, etc.).
 * Prefer Commission column; fall back to Override if that's how NHP booked it.
 */
function resolveTailoredAcaPay({ commissionAmount = 0, overrideAmount = 0 } = {}) {
  const comm = Number(commissionAmount) || 0;
  const ov = Number(overrideAmount) || 0;
  const amount = comm !== 0 ? comm : ov;
  if (amount === 0) {
    return {
      theiShare: 0,
      bsiShare: 0,
      producerPayable: 0,
      splitApplies: false,
      recordType: 'ACA Zero Amount',
      mga: 'Tailored Insurance Solutions',
    };
  }
  return {
    theiShare: 0,
    bsiShare: 0,
    producerPayable: amount,
    splitApplies: false,
    recordType: amount < 0 ? 'ACA Agent Chargeback' : 'ACA Agent Commission',
    mga: 'Tailored Insurance Solutions',
  };
}

/**
 * Pull Payment/Statement Date + Tailored title from NHP sheet preamble cells.
 * Example: "PAYMENT/STATEMENT DATE:  JUN 15TH, 2026"
 */
function extractTailoredStatementMeta(sheetRows = []) {
  let statementTitle = '';
  let paymentStatementDate = null;
  const blob = sheetRows
    .slice(0, 25)
    .map((r) => (Array.isArray(r) ? r : Object.values(r || {})).map((c) => String(c || '')).join(' '))
    .join('\n');

  if (isTailoredAgency(blob)) {
    const titleLine = blob.split('\n').find((l) => isTailoredAgency(l));
    statementTitle = (titleLine || 'Tailored Insurance Solutions').trim();
  }

  const dateMatch = blob.match(
    /PAYMENT\s*\/?\s*STATEMENT\s*DATE\s*:?\s*([A-Za-z]{3,9}\s+\d{1,2}(?:ST|ND|RD|TH)?,?\s*20\d{2}|\d{1,2}\/\d{1,2}\/20\d{2})/i
  );
  if (dateMatch) {
    paymentStatementDate = dateMatch[1].replace(/(ST|ND|RD|TH)/gi, '');
  }

  return { statementTitle, paymentStatementDate, isTailoredStatement: !!statementTitle };
}

module.exports = {
  isTailoredAgency,
  isTailoredInsuranceAgent,
  isTailoredAcaPassThrough,
  resolveTailoredAcaPay,
  extractTailoredStatementMeta,
};
