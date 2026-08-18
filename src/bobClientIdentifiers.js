'use strict';

/**
 * Book of Business client identifiers: member ID, policy number, date of birth.
 * Used by BOB export parsing and the client-details lookup.
 */

function normalizeHeader(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function normalizeId(value) {
  return String(value || '').trim().toUpperCase().replace(/[\s\-]/g, '');
}

function formatIdentifierDate(value) {
  if (value == null || value === '') return '';
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const m = String(value.getUTCMonth() + 1).padStart(2, '0');
    const d = String(value.getUTCDate()).padStart(2, '0');
    const y = value.getUTCFullYear();
    return `${m}/${d}/${y}`;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    const date = new Date((value - 25569) * 86400 * 1000);
    if (Number.isNaN(date.getTime())) return '';
    const m = String(date.getUTCMonth() + 1).padStart(2, '0');
    const d = String(date.getUTCDate()).padStart(2, '0');
    const y = date.getUTCFullYear();
    return `${m}/${d}/${y}`;
  }
  const s = String(value).trim();
  if (!s) return '';
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(s)) {
    const [m, d, y] = s.split('/');
    return `${m.padStart(2, '0')}/${d.padStart(2, '0')}/${y}`;
  }
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[2]}/${iso[3]}/${iso[1]}`;
  const us = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (us) return `${us[1].padStart(2, '0')}/${us[2].padStart(2, '0')}/${us[3]}`;
  return s;
}

function parseRawObject(raw) {
  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    try { return JSON.parse(trimmed); } catch (_) { return null; }
  }
  return null;
}

function findColumn(headers, terms, { excludeSubstrings = [] } = {}) {
  const keyMap = {};
  (headers || []).forEach((h) => {
    const n = normalizeHeader(h);
    if (n && !keyMap[n]) keyMap[n] = h;
  });

  const excluded = (k) => excludeSubstrings.some((ex) => k.includes(normalizeHeader(ex)));

  for (const term of terms) {
    const n = normalizeHeader(term);
    if (keyMap[n] && !excluded(n)) return keyMap[n];
  }

  for (const term of terms) {
    const n = normalizeHeader(term);
    if (!n) continue;
    const found = Object.keys(keyMap).find((k) => {
      if (excluded(k)) return false;
      return k === n || k.endsWith(n) || (n.length >= 4 && k.includes(n));
    });
    if (found) return keyMap[found];
  }
  return null;
}

const NAME_EXCLUDE = ['id', 'number', 'status', 'dob', 'birth', 'effective', 'agent', 'producer'];
const POLICY_EXCLUDE = ['effective', 'effectivedate', 'startdate', 'enddate', 'term', 'status', 'type', 'name'];
const MEMBER_EXCLUDE = ['firstname', 'lastname', 'fullname', 'membername', 'clientname', 'status', 'effective', 'dob', 'birth'];
const DOB_EXCLUDE = ['effective', 'term', 'issue', 'paid', 'written'];

function detectBobExportColumns(headers) {
  return {
    firstNameCol: findColumn(headers, ['memberfirstname', 'firstname', 'memberfirst', 'first']),
    lastNameCol: findColumn(headers, ['memberlastname', 'lastname', 'memberlast', 'last']),
    clientCol: findColumn(headers, ['membername', 'clientname', 'subscribername', 'insuredname', 'fullname', 'client', 'member', 'name'], {
      excludeSubstrings: NAME_EXCLUDE,
    }),
    agentCol: findColumn(headers, ['writingagentname', 'agentname', 'writingagent', 'producername', 'agent', 'producer']),
    memberIdCol: findColumn(headers, [
      'memberid', 'membernumber', 'member_id', 'carrier_member_id',
      'mbi', 'hicnmbi', 'medicareidentifier', 'medicareid', 'medicarenumber',
      'subscriberid', 'umid', 'hcid', 'memberrecordlocator',
    ], { excludeSubstrings: MEMBER_EXCLUDE }),
    policyCol: findColumn(headers, [
      'policynumber', 'policyid', 'policyno', 'certificate',
      'applicationnumber', 'contractnumber', 'policy_number_production',
    ], { excludeSubstrings: POLICY_EXCLUDE }),
    dobCol: findColumn(headers, [
      'dateofbirth', 'memberdateofbirth', 'memberdob', 'birthdate', 'dob', 'birthdt',
    ], { excludeSubstrings: DOB_EXCLUDE }),
    effDateCol: findColumn(headers, ['policyeffectivedate', 'effectivedate', 'effdate', 'startdate', 'effective']),
    planCol: findColumn(headers, ['planname', 'plantype', 'product', 'benefit', 'plan'], {
      excludeSubstrings: ['status', 'effective'],
    }),
    statusCol: findColumn(headers, ['memberstatus', 'planstatus', 'policystatus', 'status']),
  };
}

function mapBobExportRow(row, columns, { normalizeAgentName } = {}) {
  const cols = columns || {};
  let clientName = '';
  if (cols.firstNameCol && cols.lastNameCol) {
    const first = String(row[cols.firstNameCol] || '').trim();
    const last = String(row[cols.lastNameCol] || '').trim();
    clientName = [first, last].filter(Boolean).join(' ');
  } else if (cols.clientCol) {
    clientName = String(row[cols.clientCol] || '').trim();
  }

  const agentRaw = cols.agentCol ? String(row[cols.agentCol] || '').trim() : '';
  const agent = typeof normalizeAgentName === 'function' ? normalizeAgentName(agentRaw) : agentRaw;

  return {
    client: clientName,
    agent,
    memberId: cols.memberIdCol ? String(row[cols.memberIdCol] || '').trim() : '',
    policyNumber: cols.policyCol ? String(row[cols.policyCol] || '').trim() : '',
    dateOfBirth: cols.dobCol ? formatIdentifierDate(row[cols.dobCol]) : '',
    effectiveDate: cols.effDateCol ? formatIdentifierDate(row[cols.effDateCol]) : '',
    planType: cols.planCol ? String(row[cols.planCol] || '').trim() : '',
    status: cols.statusCol ? String(row[cols.statusCol] || '').trim().toLowerCase() : 'active',
  };
}

const MEMBER_ID_RAW_KEYS = [
  'memberid', 'member_id', 'membernumber', 'member #',
  'carrier_member_id', 'carriermemberid', 'umid', 'hcid',
  'mbi', 'medicareidentifier', 'medicare_identifier', 'medicareid',
  'medicarenumber', 'medicare_number', 'hicnmbi', 'hicn/mbi', 'hic#', 'hic',
  'subscriberid', 'subscriber id', 'memberrecordlocator',
  'beneficiary_claim_number', 'beneficiaryclaimnumber',
];

const DOB_RAW_KEYS = [
  'dob', 'dateofbirth', 'date of birth', 'birthdate', 'birth date',
  'memberdob', 'member dob', 'memberdateofbirth', 'member date of birth',
  'birthdt', 'date_of_birth', 'birth_date',
];

function lookupRawKey(obj, wanted) {
  if (!obj || typeof obj !== 'object') return '';
  const wantedNorm = wanted.map(normalizeHeader);
  for (const [key, value] of Object.entries(obj)) {
    const n = normalizeHeader(key);
    if (wantedNorm.includes(n) && value != null && String(value).trim() !== '') {
      return value;
    }
  }
  return '';
}

function extractMemberIdFromRaw(raw) {
  const obj = parseRawObject(raw);
  const value = lookupRawKey(obj, MEMBER_ID_RAW_KEYS);
  return value ? String(value).trim() : '';
}

function extractDobFromRaw(raw) {
  const obj = parseRawObject(raw);
  const value = lookupRawKey(obj, DOB_RAW_KEYS);
  if (value) return formatIdentifierDate(value);
  if (!obj) return '';
  for (const [key, val] of Object.entries(obj)) {
    const n = normalizeHeader(key);
    if (n.includes('birth') && n.includes('date') && !n.includes('effective')) {
      const formatted = formatIdentifierDate(val);
      if (formatted) return formatted;
    }
  }
  return '';
}

function identifiersFromRecord(rec = {}) {
  const memberId = String(
    rec.member_id || rec.memberId || rec.carrier_member_id || rec.mbi || extractMemberIdFromRaw(rec.raw_data) || ''
  ).trim();
  const policyNumber = String(
    rec.policy_number || rec.policyNumber || rec.policy_number_production || ''
  ).trim();
  const dateOfBirth = String(
    rec.date_of_birth || rec.dateOfBirth || extractDobFromRaw(rec.raw_data) || ''
  ).trim();
  return { memberId, policyNumber, dateOfBirth };
}

function mergeClientIdentifiers(sources) {
  const merged = { memberId: '', policyNumber: '', dateOfBirth: '' };
  for (const source of sources || []) {
    if (!source) continue;
    const ids = identifiersFromRecord(source);
    if (!merged.memberId && ids.memberId) merged.memberId = ids.memberId;
    if (!merged.policyNumber && ids.policyNumber) merged.policyNumber = ids.policyNumber;
    if (!merged.dateOfBirth && ids.dateOfBirth) merged.dateOfBirth = formatIdentifierDate(ids.dateOfBirth);
  }
  return merged;
}

function policyNumberForDisplay(memberId, policyNumber) {
  if (!policyNumber) return '';
  if (memberId && normalizeId(memberId) === normalizeId(policyNumber)) return '';
  return policyNumber;
}

module.exports = {
  normalizeHeader,
  normalizeId,
  formatIdentifierDate,
  findColumn,
  detectBobExportColumns,
  mapBobExportRow,
  extractMemberIdFromRaw,
  extractDobFromRaw,
  identifiersFromRecord,
  mergeClientIdentifiers,
  policyNumberForDisplay,
};
