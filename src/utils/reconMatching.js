/**
 * CONSOLIDATED RECONCILIATION MATCHING LOGIC
 * 
 * Shared by ALL three recon screens:
 * 1. Sales Reconciliation (Reconciliation.js)
 * 2. Agency Override Reconciliation (AgencyProductionRecon.js)
 * 3. Missing Renewals (MissingRenewals.js)
 * 
 * Fixes applied ONCE, used EVERYWHERE:
 * - normName() compound Hispanic surnames
 * - Type-aware netting (separate override_net and sale_net)
 * - Deduplication
 * - BOB deceased/termed status propagation
 * - Paid verdict based on net > 0 (not just existence)
 */

// ============================================================================
// NAME NORMALIZATION
// ============================================================================

/**
 * Normalize client name for matching
 * Handles compound Hispanic surnames (VAZQUEZ VELEZ, REYES DE GATON, etc.)
 * 
 * @param {string} name - Raw client name
 * @returns {string} - Normalized name in "First Last" format
 */
export function normName(name) {
  if (!name) return '';
  const s = String(name).trim();
  
  // Helper: Convert to Title Case
  function toTitleCase(str) {
    return str.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
  }
  
  // Handle comma-separated "LAST, FIRST" format
  // Everything before the comma is the full surname (handles compound surnames)
  if (s.includes(',')) {
    let [last, first] = s.split(',').map(p => p.trim());
    
    // Strip common suffixes from surname
    last = last.replace(/\b(JR|SR|III|II|IV|V)\.?$/i, '').trim();
    
    // Return "FIRST LAST" in Title Case
    const normalized = `${first} ${last}`.replace(/\s+/g, ' ').trim();
    return toTitleCase(normalized);
  }
  
  // For non-comma format, just normalize spaces and title case
  const normalized = s.replace(/\s+/g, ' ').trim();
  return toTitleCase(normalized);
}

/**
 * Normalize carrier name for matching
 * @param {string} carrier - Raw carrier name
 * @returns {string} - Normalized carrier name
 */
export function normalizeCarrier(carrier) {
  if (!carrier) return '';
  const c = carrier.toLowerCase().trim();

  if (c.includes('humana')) return 'humana';
  if (c.includes('aetna')) return 'aetna';
  if (c.includes('uhc') || c.includes('united')) return 'unitedhealthcare';
  if (c.includes('doctors')) return 'doctors';
  if (c.includes('careplus') || c.includes('care plus')) return 'careplus';
  if (c.includes('devoted')) return 'devoted';
  if (c.includes('solis')) return 'solis';
  if (c.includes('healthsun') || c.includes('health sun')) return 'healthsun';
  if (c.includes('oscar')) return 'oscar health';
  if (c.includes('molina')) return 'molina';
  if (c.includes('wellcare')) return 'wellcare';
  if (c.includes('florida blue') || c.includes('bcbs') || c.includes('blue cross')) return 'florida blue';
  if (c.includes('cigna')) return 'cigna';
  if (c.includes('avmed')) return 'avmed';
  if (c.includes('simply')) return 'simply';
  if (c.includes('gold kidney') || c.includes('goldkidney')) return 'gold kidney';
  if (c.includes('elevance') || c.includes('anthem')) return 'elevance medicare';
  if (c.includes('freedom')) return 'freedom';
  if (c.includes('nhp')) return 'nhp';

  return c;
}

// ============================================================================
// TYPE-AWARE MATCHING WITH NETTING
// ============================================================================

/**
 * Find ALL matching commission records for a production/sale record
 * Returns type-aware nets: override_net (for Override Recon) and sale_net (for Sales Recon)
 * 
 * @param {Object} source - Production or sale record to match
 * @param {Array} commissions - All commission records
 * @param {Object} options - { matchType: 'override'|'sale'|'all', clientField: 'client_name'|'client_full_name', policyField: 'policy_number' }
 * @returns {Object|null} - Match object with allMatches, override_net, sale_net, classification
 */
export function findCommissionMatches(source, commissions, options = {}) {
  const {
    matchType = 'all',          // 'override' | 'sale' | 'all'
    clientField = 'client_name',
    policyField = 'policy_number'
  } = options;
  
  const sourceClientNorm = normName(source[clientField]);
  const sourceCarrier = normalizeCarrier(source.carrier);
  const sourcePolicy = (source[policyField] || '').trim().toLowerCase();
  
  // Collect ALL matching commission records (not just first)
  const matches = [];
  
  for (const comm of commissions) {
    const commClientNorm = normName(comm.client_full_name);
    const commCarrier = normalizeCarrier(comm.carrier);
    const commPolicy = (comm.policy_number || '').trim().toLowerCase();
    
    // Client name match using normName() (handles compound surnames)
    const clientMatch = sourceClientNorm === commClientNorm;
    
    // Carrier match
    const carrierMatch = sourceCarrier === commCarrier || 
                        sourceCarrier.includes(commCarrier) || 
                        commCarrier.includes(sourceCarrier);
    
    // Policy number match (fallback for name mismatches)
    const policyMatch = sourcePolicy && commPolicy && sourcePolicy === commPolicy;
    
    // Match if (client + carrier) OR (policy + carrier)
    if ((clientMatch && carrierMatch) || (policyMatch && carrierMatch)) {
      matches.push(comm);
    }
  }
  
  if (matches.length === 0) {
    return null;  // No matches found
  }
  
  // TYPE-AWARE NETTING: Separate override and sale-side money streams
  const overrideMatches = [];
  const saleMatches = [];
  
  matches.forEach(m => {
    const cls = (m.classification || '').toLowerCase();
    // Override side: contains 'override' or 'agency override'
    if (cls.includes('override')) {
      overrideMatches.push(m);
    } else {
      // Sale side: New Business, Agent Commission, Renewal, or unclassified
      saleMatches.push(m);
    }
  });
  
  const override_net = overrideMatches.reduce((sum, m) => sum + parseFloat(m.commission || 0), 0);
  const sale_net = saleMatches.reduce((sum, m) => sum + parseFloat(m.commission || 0), 0);
  const combined_net = override_net + sale_net;
  
  const hasChargeback = matches.some(m => parseFloat(m.commission || 0) < 0);
  
  // Determine classification based on matchType
  let classification;
  let isPaid = false;
  
  if (matchType === 'override') {
    // Override Recon: verdict based on override_net
    if (override_net > 0) {
      classification = hasChargeback ? 'Override Paid (net +)' : 'Override Paid';
      isPaid = true;
    } else if (override_net === 0 && overrideMatches.length > 0) {
      classification = 'Override Paid & reversed (net $0)';
      isPaid = false;  // Net $0 = NOT paid
    } else if (override_net < 0) {
      classification = 'Override Chargeback expected';
      isPaid = false;
    } else {
      classification = 'No Override';
      isPaid = false;
    }
  } else if (matchType === 'sale') {
    // Sales Recon: verdict based on sale_net
    if (sale_net > 0) {
      classification = hasChargeback ? 'Sale Paid (net +)' : 'Sale Paid';
      isPaid = true;
    } else if (sale_net === 0 && saleMatches.length > 0) {
      classification = 'Sale Paid & reversed (net $0)';
      isPaid = false;  // Net $0 = NOT paid
    } else if (sale_net < 0) {
      classification = 'Sale Chargeback expected';
      isPaid = false;
    } else if (override_net > 0) {
      // No sale records, but override was paid (shouldn't happen in Sales Recon)
      classification = 'Override only (no sale commission)';
      isPaid = false;
    } else {
      classification = 'No Payment';
      isPaid = false;
    }
  } else {
    // 'all': Combined verdict (for general use)
    if (combined_net > 0) {
      classification = hasChargeback ? 'Paid (net +)' : 'Paid';
      isPaid = true;
    } else if (combined_net === 0 && matches.length > 0) {
      classification = 'Paid & reversed (net $0)';
      isPaid = false;
    } else if (combined_net < 0) {
      classification = 'Chargeback expected';
      isPaid = false;
    } else {
      classification = 'No Payment';
      isPaid = false;
    }
  }
  
  // Return first match as primary (for backward compatibility)
  // but include TYPE-AWARE nets and full matches array
  return {
    ...matches[0],              // Spread first match for backward compatibility
    allMatches: matches,
    matchCount: matches.length,
    overrideMatches,
    saleMatches,
    override_net,               // Override side only (for Override Recon verdict)
    sale_net,                   // Sale side only (for Sales Recon verdict)
    combined_net,               // Total (for display/reporting)
    hasChargeback,
    classification,
    isPaid                      // Boolean: true only if relevant net > 0
  };
}

// ============================================================================
// DEDUPLICATION
// ============================================================================

/**
 * Deduplicate records by client + carrier + effective_date
 * @param {Array} records - Array of records to deduplicate
 * @param {Object} options - { clientField: 'client_name', carrierField: 'carrier', dateField: 'effective_date' }
 * @returns {Array} - Deduplicated records
 */
export function deduplicateRecords(records, options = {}) {
  const {
    clientField = 'client_name',
    carrierField = 'carrier',
    dateField = 'effective_date'
  } = options;
  
  const deduped = [];
  const seen = new Set();
  
  records.forEach(rec => {
    const key = [
      normName(rec[clientField] || ''),
      normalizeCarrier(rec[carrierField] || ''),
      (rec[dateField] || '')
    ].join('|').toLowerCase();
    
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(rec);
    }
  });
  
  const removedCount = records.length - deduped.length;
  if (removedCount > 0) {
    console.log(`[DEDUP] Records: ${records.length} → ${deduped.length} (removed ${removedCount} duplicates)`);
  }
  
  return deduped;
}

// ============================================================================
// BOB STATUS RESOLUTION
// ============================================================================

/**
 * Resolve client status (prioritize BOB status over CSV status)
 * @param {Object} record - Record with status and BOB fields
 * @returns {string} - Resolved status
 */
export function resolveStatus(record) {
  // BOB status takes priority (most current)
  if (record.bob_status) {
    return record.bob_status;  // e.g., "Deceased", "Termed", "Active"
  }
  
  // BOB boolean flags
  if (record.deceased_date || record.is_deceased) {
    return 'Deceased';
  }
  
  if (record.is_termed || record.termed_date) {
    return 'Termed';
  }
  
  // Fallback to CSV status
  return record.status || 'Active';
}

// ============================================================================
// EXPORT ALL
// ============================================================================

export default {
  normName,
  normalizeCarrier,
  findCommissionMatches,
  deduplicateRecords,
  resolveStatus
};
