'use strict';

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/**
 * Compare OliComm's live total, the stored issued statement, and BSI's copy.
 * Flags: issued statement is stale (data changed since issuing), and
 * OliComm vs BSI variance.
 */
function compareStatementTotals({ liveTotal, issuedTotal, receivedTotal, issued = null, received = null }) {
  const live = round2(liveTotal);
  const out = {
    liveTotal: live,
    issuedTotal: issuedTotal == null ? null : round2(issuedTotal),
    receivedTotal: receivedTotal == null ? null : round2(receivedTotal),
    issued, received,
    issuedStale: false,
    staleBy: null,
    varianceVsBsi: null,
    matchesBsi: null,
  };
  if (out.issuedTotal != null && Math.abs(live - out.issuedTotal) >= 0.01) {
    out.issuedStale = true;
    out.staleBy = round2(live - out.issuedTotal);
  }
  if (out.receivedTotal != null) {
    const basis = out.issuedTotal != null ? out.issuedTotal : live;
    out.varianceVsBsi = round2(basis - out.receivedTotal);
    out.matchesBsi = Math.abs(out.varianceVsBsi) < 0.01;
  }
  return out;
}

module.exports = { compareStatementTotals };
