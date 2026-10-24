'use strict';

/**
 * Last-resort split for a house line that no specific rule (Integrity, Marco, BSI full pot,
 * agent production, direct carrier) claimed.
 *
 * Only THE remittance lines (payee "THE") carry THEI's half already, so only they are
 * mirrored to BSI (gross = 2 × amount). Every other BSI-book line holds the FULL pot and is
 * split 50/50 — a BSI line whose payee reads "Direct", "Humana", "Devoted", " bsi " etc. must
 * never be mirrored, or THEI and BSI would each get the whole amount (a double count).
 * Non-BSI sources (NHP, manual) keep the historic half-model.
 */

const round2 = (n) => Math.round(Number(n) * 100) / 100;

function isTheRemittancePayee(payee) {
  return String(payee == null ? '' : payee).trim().toLowerCase() === 'the';
}

function isBsiBookSource(source) {
  return ['BSI', 'BSI_PAYEE'].includes(String(source == null ? '' : source).trim().toUpperCase());
}

/**
 * @param {number} netCommission
 * @param {{ source?: string, payee?: string }} ctx
 * @returns {{ splitApplies, grossCommission, theiShare, bsiShare, producerPayable, model }}
 */
function houseFallbackSplit(netCommission, ctx = {}) {
  const net = round2(Number(netCommission) || 0);
  if (isBsiBookSource(ctx.source) && !isTheRemittancePayee(ctx.payee)) {
    const thei = round2(net / 2);
    return {
      splitApplies: true,
      grossCommission: net,
      theiShare: thei,
      bsiShare: round2(net - thei),
      producerPayable: 0,
      model: 'full_pot',
    };
  }
  return {
    splitApplies: true,
    grossCommission: round2(net * 2),
    theiShare: net,
    bsiShare: net,
    producerPayable: 0,
    model: 'half',
  };
}

module.exports = { houseFallbackSplit, isTheRemittancePayee, isBsiBookSource };
