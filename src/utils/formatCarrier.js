/**
 * Format carrier names for consistent display
 * - "DOCTORS" → "Doctors"
 * - "SOLIS" → "Solis"
 * - "HUMANA" → "Humana"
 * etc.
 */
export function formatCarrier(carrier) {
  if (!carrier) return '';
  
  const c = carrier.trim();
  
  // Special cases
  if (c.toUpperCase() === 'DOCTORS' || c.toLowerCase() === 'doctors healthcare plans') return 'Doctors';
  if (c.toUpperCase() === 'SOLIS') return 'Solis';
  if (c.toUpperCase() === 'UHC' || c.toUpperCase() === 'UNITED HEALTHCARE' || c.toUpperCase() === 'UNITEDHEALTHCARE') return 'UnitedHealthcare';
  if (c.toUpperCase() === 'HUMANA') return 'Humana';
  if (c.toUpperCase() === 'AETNA') return 'Aetna';
  if (c.toUpperCase() === 'CAREPLUS' || c.toUpperCase() === 'CARE PLUS') return 'CarePlus';
  if (c.toUpperCase() === 'DEVOTED' || c.toUpperCase() === 'DEVOTED HEALTH') return 'Devoted Health';
  if (c.toUpperCase() === 'WELLCARE') return 'WellCare';
  if (c.toUpperCase() === 'OSCAR') return 'Oscar';
  if (c.toUpperCase() === 'AARP' || c.includes('AARP')) return c; // Keep AARP uppercase
  if (c.toUpperCase().includes('MED SUPP')) return c; // Keep Med Supp as-is
  
  // Default: Title case
  return c.split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}
