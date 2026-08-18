/**
 * Uniform labels for NHP / BSI uploads.
 * Portal filenames stay on disk (routing still uses them); the list shows NHP/BSI first.
 */

function norm(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/['()]/g, '')
    .replace(/\s+/g, '_');
}

const MONTHS = [
  ['january', '01'], ['february', '02'], ['september', '09'],
  ['october', '10'], ['november', '11'], ['december', '12'],
  ['august', '08'], ['march', '03'], ['april', '04'],
  ['june', '06'], ['july', '07'], ['jan', '01'], ['feb', '02'],
  ['mar', '03'], ['apr', '04'], ['may', '05'], ['jun', '06'],
  ['jul', '07'], ['aug', '08'], ['sep', '09'], ['oct', '10'],
  ['nov', '11'], ['dec', '12'],
];

function pad2(n) {
  return String(n).padStart(2, '0');
}

function formatYyyymmdd(s) {
  if (!/^\d{8}$/.test(s)) return '';
  const y = s.slice(0, 4);
  const m = parseInt(s.slice(4, 6), 10);
  const d = parseInt(s.slice(6, 8), 10);
  if (m < 1 || m > 12 || d < 1 || d > 31) return '';
  return `${pad2(m)}.${pad2(d)}.${y.slice(2)}`;
}

function formatYyyymm(s) {
  if (!/^\d{6}$/.test(s)) return '';
  const y = s.slice(0, 4);
  const m = parseInt(s.slice(4, 6), 10);
  if (m < 1 || m > 12) return '';
  return `${pad2(m)}.${y.slice(2)}`;
}

function dateFromFilename(filename) {
  const raw = String(filename || '');
  const f = norm(raw);
  const blob = `${raw} ${f.replace(/_/g, '-')}`;

  let m = blob.match(/(20\d{2})[-_/](0?[1-9]|1[0-2])[-_/](0?[1-9]|[12]\d|3[01])(?!\d)/);
  if (m) {
    const ymd = `${m[1]}${String(m[2]).padStart(2, '0')}${String(m[3]).padStart(2, '0')}`;
    return formatYyyymmdd(ymd);
  }
  m = blob.match(/(?:^|[^0-9])(0?[1-9]|1[0-2])[-_/](0?[1-9]|[12]\d|3[01])[-_/](20\d{2})(?!\d)/);
  if (m) {
    const ymd = `${m[3]}${String(m[1]).padStart(2, '0')}${String(m[2]).padStart(2, '0')}`;
    return formatYyyymmdd(ymd);
  }
  m = blob.match(/(?:^|[^0-9])(20\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])(?!\d)/);
  if (m) return formatYyyymmdd(m[1] + m[2] + m[3]);

  const spaced = f.replace(/_/g, ' ');
  for (const [key, label] of MONTHS) {
    const re = new RegExp(`\\b${key}\\.?\\s*(\\d{1,2})(?:st|nd|rd|th)?[,_\\s-]+(20\\d{2})`, 'i');
    const dm = raw.match(re) || spaced.match(re);
    if (dm) return `${label}.${pad2(dm[1])}.${dm[2].slice(2)}`;
  }
  for (const [key, label] of MONTHS) {
    const re = new RegExp(`\\b${key}\\b[^0-9]{0,12}(20\\d{2})`, 'i');
    const ym = raw.match(re) || spaced.match(re);
    if (ym) return `${label}.${ym[1].slice(2)}`;
  }
  m = blob.match(/(20\d{2})[-_](0[1-9]|1[0-2])(?!\d)/);
  if (m) return formatYyyymm(`${m[1]}${m[2]}`);
  const stem = f.replace(/\.[^.]+$/, '');
  for (const [key, label] of MONTHS) {
    if (key.length < 3) continue;
    if (
      new RegExp(`\\b${key}\\b`, 'i').test(raw) ||
      stem.includes(`_${key}_`) ||
      stem.endsWith(`_${key}`) ||
      stem.startsWith(`${key}_`)
    ) {
      return label;
    }
  }
  return '';
}

function isNhpFilename(filename) {
  const f = norm(filename);
  return (
    f.includes('the_health_experts_insurance_statement') ||
    f.includes('the_health_experst_insurance') ||
    (f.includes('the_health_experts') && f.includes('statement')) ||
    (f.includes('yahoska') && f.includes('katy')) ||
    (f.includes('agency-statement') && f.includes('health_experts')) ||
    (f.includes('agency_statement') && f.includes('health_experts')) ||
    (f.includes('nhp') && (f.includes('commission') || f.includes('statement')))
  );
}

function isTheRemittanceFilename(filename) {
  const f = norm(filename);
  return (
    f.includes('t.h.e_statements') ||
    f.includes('the_statements') ||
    f.includes('the_remittance') ||
    (f.includes('-_the') && f.endsWith('.csv')) ||
    /\b(january|february|march|april|may|june|july|august|september|october|november|december)_-_the\b/.test(f)
  );
}

function isBsiCarrierFilename(filename) {
  const f = norm(filename);
  return (
    f.includes('aetna_bsi') ||
    f.includes('humana_bsi') ||
    f.includes('devoted_bsi') ||
    f.includes('uhc_bsi') ||
    f.includes('_bsi_statement') ||
    f.includes('bsi_statement') ||
    f.includes('statement-health_experts') ||
    f.includes('statement_health_experts')
  );
}

function nhpKind(filename) {
  const f = norm(filename);
  if (f.includes('tailored') || f.includes('jill')) return 'Jill Taylor';
  if ((f.includes('yahoska') && f.includes('katy')) || f.includes('principal')) return 'THEI principal';
  return '';
}

function bsiKind(filename) {
  const f = norm(filename);
  if (isTheRemittanceFilename(filename)) return 'THE remittance';
  if (f.includes('humana')) return 'Humana';
  if (f.includes('devoted')) return 'Devoted';
  if (f.includes('uhc') || f.includes('united')) return 'UHC';
  if (f.includes('aetna')) return 'Aetna';
  if (f.includes('statement-health_experts') || f.includes('statement_health_experts')) return 'consolidator';
  return '';
}

function joinLabel(parts) {
  return parts.filter(Boolean).join(' · ');
}

/**
 * @param {string} filename
 * @param {{ category?: string }} [opts]
 * @returns {string}
 */
export function statementDisplayName(filename, opts = {}) {
  const name = String(filename || '').trim();
  if (!name) return '';
  const already = /^(nhp|bsi)\s*[·\-—]/i.test(name);
  if (already) return name.replace(/\.[^.]+$/, '');

  const date = dateFromFilename(name);
  const category = String(opts.category || '');

  if (isNhpFilename(name)) {
    return joinLabel(['NHP', date, nhpKind(name)]) || 'NHP';
  }
  if (isTheRemittanceFilename(name)) {
    return joinLabel(['BSI', date, 'THE remittance']);
  }
  if (isBsiCarrierFilename(name) || category === 'bsi_statement') {
    const label = joinLabel(['BSI', date, bsiKind(name)]);
    if (label !== 'BSI') return label;
    return joinLabel(['BSI', name.replace(/\.[^.]+$/, '')]);
  }
  return name;
}

export function statementSearchText(filename, opts = {}) {
  return `${statementDisplayName(filename, opts)} ${filename || ''}`.toLowerCase();
}
