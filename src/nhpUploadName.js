'use strict';

/**
 * NHP portal downloads often reuse the same filename every cycle.
 * Keep the human name recognizable; suffix a stamp so Uploads uniqueness allows multiple Jan files.
 */
function isNhpUploadName(filename) {
  const f = String(filename || '').toLowerCase().replace(/[\s()]/g, '_');
  return (
    f.includes('the_health_experts_insurance_statement') ||
    f.includes('the_health_experst_insurance') ||
    (f.includes('the_health_experts') && f.includes('statement')) ||
    (f.includes('yahoska') && f.includes('katy') && f.includes('statement')) ||
    (f.includes('agency-statement') && f.includes('health_experts')) ||
    (f.includes('agency_statement') && f.includes('health_experts')) ||
    (f.endsWith('.pdf') && f.includes('agency') && f.includes('statement') && f.includes('nhp'))
  );
}

function stampNhpOriginalName(originalName, when = new Date()) {
  const name = String(originalName || 'nhp_statement.xlsx');
  const extMatch = name.match(/(\.[^.]+)$/);
  const ext = extMatch ? extMatch[1] : '';
  const base = ext ? name.slice(0, -ext.length) : name;
  const stamp = when.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return `${base}__${stamp}${ext}`;
}

/**
 * If this NHP filename already exists in uploads, return a stamped name; else return as-is.
 */
function resolveNhpUploadOriginalName(originalName, alreadyExists) {
  if (!alreadyExists) return String(originalName || '');
  if (!isNhpUploadName(originalName)) return null; // caller should 409
  return stampNhpOriginalName(originalName);
}

module.exports = {
  isNhpUploadName,
  stampNhpOriginalName,
  resolveNhpUploadOriginalName,
};
