'use strict';

/**
 * Tailored Insurance Solutions — ACA book that Yahoska pays through to "her"
 * (Tailored / Carolina LOA world). These must NOT land on THEI NHP house
 * as Agency Override; they are agent production (producer_payable).
 */

function isTailoredInsuranceAgent(agentName) {
  const n = String(agentName || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!n) return false;
  return n.includes('tailored insurance') || n === 'tailored';
}

/**
 * ACA amount that should pay through to Tailored (agent), never THEI house.
 * Prefer commission column; fall back to override column when that's how NHP booked it.
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
    };
  }
  return {
    theiShare: 0,
    bsiShare: 0,
    producerPayable: amount,
    splitApplies: false,
    recordType: amount < 0 ? 'ACA Agent Chargeback' : 'ACA Agent Commission',
  };
}

module.exports = {
  isTailoredInsuranceAgent,
  resolveTailoredAcaPay,
};
