'use strict';

/**
 * Filename → upload destination detection (frontend).
 * Mirrors the important routing rules in routes/files.js so the UI can
 * confirm before committing to the wrong tab.
 */

function norm(filename) {
  return String(filename || '')
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/['()]/g, '');
}

/**
 * @returns {{
 *   id: 'commission_statement'|'bsi_statement'|'agent_payout'|'medicarepro'|'agency_production'|'unknown',
 *   label: string,
 *   reason: string,
 *   confidence: 'high'|'medium'|'low'
 * }}
 */
export function detectUploadDestination(filename) {
  const f = norm(filename);
  if (!f) {
    return { id: 'unknown', label: 'Unknown', reason: 'No filename', confidence: 'low' };
  }

  // MedicarePro sales exports
  if (
    f.includes('medicarepro') ||
    f.includes('medicare_pro') ||
    (f.includes('sales') && (f.includes('enrollment') || f.includes('book')))
  ) {
    return {
      id: 'medicarepro',
      label: 'MedicarePro Sales',
      reason: 'Filename looks like a MedicarePro sales/enrollment export',
      confidence: 'high',
    };
  }

  // Hector agency production
  if (
    f.includes('agency_production') ||
    f.includes('agency-production') ||
    (f.includes('hector') && (f.includes('production') || f.includes('override')))
  ) {
    return {
      id: 'agency_production',
      label: 'Agency Production',
      reason: 'Filename looks like Hector agency production',
      confidence: 'high',
    };
  }

  // BSI → THE remittance (belongs on Commission Statements)
  if (
    f.includes('t.h.e_statements') ||
    f.includes('the_statements') ||
    f.includes('july_-_the') ||
    f.includes('the_remittance') ||
    (f.includes('-_the') && f.endsWith('.csv')) ||
    /\b(january|february|march|april|may|june|july|august|september|october|november|december)_-_the\b/.test(f)
  ) {
    return {
      id: 'commission_statement',
      label: 'Commission Statements',
      reason: 'Looks like a BSI→THE remittance file (money paid to THEI)',
      confidence: 'high',
    };
  }

  // Explicit BSI carrier feeds (carrier → BSI)
  if (
    f.includes('aetna_bsi') ||
    f.includes('humana_bsi') ||
    f.includes('devoted_bsi') ||
    f.includes('uhc_bsi') ||
    f.includes('_bsi_statement') ||
    f.includes('bsi_statement')
  ) {
    return {
      id: 'bsi_statement',
      label: 'BSI Statements',
      reason: 'Filename marked as a carrier→BSI statement feed',
      confidence: 'high',
    };
  }

  // Classic BSI consolidator naming
  if (f.includes('statement-health_experts') || f.includes('statement_health_experts')) {
    return {
      id: 'bsi_statement',
      label: 'BSI Statements',
      reason: 'Matches BSI consolidator statement naming',
      confidence: 'high',
    };
  }

  // Agent payout NHP / Tailored ACA (before generic THEI NHP — filenames also include THE HEALTH EXPERST)
  const isTheiPrincipalNhp =
    (f.includes('yahoska') && f.includes('katy')) ||
    f.includes('principal') ||
    (f.includes('yahoska_perez') && f.includes('nhp'));
  if (
    f.includes('tailored') ||
    f.includes('jill_taylor') ||
    f.includes('jill-taylor') ||
    ((f.includes('nhp_commission_report') || (f.includes('nhp') && f.includes('commission'))) &&
      !isTheiPrincipalNhp)
  ) {
    return {
      id: 'agent_payout',
      label: 'Agent Payout Uploads',
      reason: 'Looks like a producer payout statement (Tailored / writing-agent NHP report)',
      confidence: 'high',
    };
  }

  // NHP agency statements → Commission Statements (THEI house / principal)
  if (
    f.includes('the_health_experts_insurance_statement') ||
    f.includes('the_health_experst_insurance') ||
    f.includes('agency-statement-the_health_experts') ||
    f.includes('agency_statement_the_health_experts') ||
    (f.includes('nhp') && f.includes('statement'))
  ) {
    return {
      id: 'commission_statement',
      label: 'Commission Statements',
      reason: 'Looks like an NHP / THEI agency commission statement',
      confidence: 'high',
    };
  }

  // AgentView CNHIC / HealthSpring Med Supp commission report
  if (
    f.includes('agentview') ||
    f.includes('agent_view') ||
    f.includes('agentcommissionreport') ||
    f.includes('agent_commission_report') ||
    /agent.?commission.?report/.test(f)
  ) {
    return {
      id: 'commission_statement',
      label: 'Commission Statements',
      reason: 'Looks like an AgentView (CNHIC/HealthSpring) commission report',
      confidence: 'high',
    };
  }

  // Direct carrier commission statements (UHC/Humana/Aetna/etc. to THEI)
  if (
    f.includes('commission_statement_2737247') ||
    f.includes('commission_statement_706381') ||
    f.includes('uhc_statement') ||
    f.includes('producerstatementreport') ||
    f.includes('commissiondata') ||
    f.includes('yahoska_perez_med_comm') ||
    f.includes('the_health_experts_insurance_med_comm') ||
    f.includes('commissions_ledger') ||
    f.includes('contracts_commission')
  ) {
    return {
      id: 'commission_statement',
      label: 'Commission Statements',
      reason: 'Looks like a direct carrier commission statement',
      confidence: 'high',
    };
  }

  // Soft signals
  if (f.includes('bsi') && (f.includes('humana') || f.includes('uhc') || f.includes('aetna') || f.includes('devoted'))) {
    return {
      id: 'bsi_statement',
      label: 'BSI Statements',
      reason: 'Carrier + BSI in filename — likely a carrier→BSI feed',
      confidence: 'medium',
    };
  }

  if (f.includes('commission') || f.includes('statement')) {
    return {
      id: 'commission_statement',
      label: 'Commission Statements',
      reason: 'Generic commission/statement filename — defaulting to Commission Statements',
      confidence: 'low',
    };
  }

  return {
    id: 'unknown',
    label: 'Unknown',
    reason: 'Could not classify from filename — pick the tab that matches the file type',
    confidence: 'low',
  };
}

export const UPLOAD_PAGE_BY_DEST = {
  commission_statement: 'upload',
  bsi_statement: 'bsi-statements-upload',
  agent_payout: 'agent-payout-uploads',
  medicarepro: 'medicarepro-upload',
  agency_production: 'agency-production-upload',
};

export function destinationMatchesTab(detectedId, currentTabId) {
  if (!detectedId || detectedId === 'unknown') return true;
  if (currentTabId === 'commission_statement') return detectedId === 'commission_statement';
  if (currentTabId === 'bsi_statement') return detectedId === 'bsi_statement';
  if (currentTabId === 'agent_payout') return detectedId === 'agent_payout';
  if (currentTabId === 'medicarepro') return detectedId === 'medicarepro';
  if (currentTabId === 'agency_production') return detectedId === 'agency_production';
  return true;
}
