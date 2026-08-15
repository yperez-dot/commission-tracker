'use strict';

/**
 * Dollar + count for dashboard LOB cards.
 * ACA agent pay is producer_payable; Medicare/other agent production coalesces
 * per-row payable (NHP) with carrier commission (UHC/Humana direct).
 */
function lobCardMetrics(lobData, lobName, viewMode) {
  const isACA = lobName === 'ACA';
  const num = (v) => {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  };
  if (isACA && viewMode === 'agency') {
    return {
      amount: num(lobData.thei_total),
      count: parseInt(lobData.override_count ?? lobData.count ?? 0, 10),
    };
  }
  if (isACA && viewMode === 'agent') {
    return {
      amount: num(lobData.agent_payable),
      count: parseInt(lobData.count || 0, 10),
    };
  }
  if (viewMode === 'agency') {
    return {
      amount: num(lobData.thei_total) || num(lobData.total),
      count: parseInt(lobData.count || 0, 10),
    };
  }
  return {
    amount: num(lobData.agent_production) || num(lobData.total),
    count: parseInt(lobData.count || 0, 10),
  };
}

module.exports = { lobCardMetrics };
