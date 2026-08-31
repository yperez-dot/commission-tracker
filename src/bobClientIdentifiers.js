'use strict';

const { clientNameKey } = require('./clientNameKey');
const { namesLooseMatch, normalizeCarrier, carriersMatch } = require('./matchingNormalize.cjs');

function normalizeHeader(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function normalizeId(value) {
  return String(value || '').trim().toUpperCase().replace(/[\s\-]/g, '');
}

function stripPolicySuffix(value) {
  return normalizeId(value).replace(/_(MA|MAPD|HMO|PPO|PDP|MS|MSUP|MEDSUPP)$/i, '');
}

function idsEquivalent(a, b) {
  const na = normalizeId(a);
  const nb = normalizeId(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const sa = stripPolicySuffix(na);
  const sb = stripPolicySuffix(nb);
  return Boolean(sa && sb && sa === sb && sa.length >= 8);
}

function idIndexKeys(value) {
  const id = normalizeId(value);
  if (!id) return [];
  const keys = [id];
  const stripped = stripPolicySuffix(id);
  if (stripped && stripped !== id) keys.push(stripped);
  return keys;
}

/**
 * Given name + surname for identifier matching.
 * Handles "A Palacio", "Palacio A", "PALACIO, DORA", and "Dora Palacio".
 * Does not use normName() because that strips single-letter tokens.
 */
function parseGivenSurname(name) {
  const s = String(name || '').trim();
  if (!s) return { given: '', surname: '' };

  if (s.includes(',')) {
    let [last, first] = s.split(',').map((p) => p.trim());
    last = last.replace(/\b(JR|SR|III|II|IV|V)\.?$/i, '').trim();
    const given = (first.split(/\s+/).filter(Boolean)[0] || '').replace(/\./g, '');
    return { given, surname: last };
  }

  const parts = s
    .replace(/\s+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .filter((p) => !/^(JR|SR|III|II|IV|V)\.?$/i.test(p));
  if (!parts.length) return { given: '', surname: '' };
  if (parts.length === 1) return { given: '', surname: parts[0] };
  if (parts[0].replace(/\./g, '').length === 1) {
    return { given: parts[0].replace(/\./g, ''), surname: parts.slice(1).join(' ') };
  }
  if (parts[parts.length - 1].replace(/\./g, '').length === 1) {
    return { given: parts[parts.length - 1].replace(/\./g, ''), surname: parts.slice(0, -1).join(' ') };
  }
  return { given: parts[0], surname: parts[parts.length - 1] };
}

function surnamesMatch(a, b) {
  const sa = parseGivenSurname(a).surname.toLowerCase().replace(/[^a-z]/g, '');
  const sb = parseGivenSurname(b).surname.toLowerCase().replace(/[^a-z]/g, '');
  return Boolean(sa && sb && sa === sb);
}

function firstInitialCompatible(a, b) {
  const pa = parseGivenSurname(a);
  const pb = parseGivenSurname(b);
  const ga = pa.given.toLowerCase().replace(/[^a-z]/g, '');
  const gb = pb.given.toLowerCase().replace(/[^a-z]/g, '');
  if (!ga || !gb) return false;
  if (ga === gb) return true;
  if (ga.length === 1 && gb.startsWith(ga)) return true;
  if (gb.length === 1 && ga.startsWith(gb)) return true;
  return false;
}

/**
 * Name match for filling BOB identifiers.
 * Full fuzzy match, or same surname + first initial (e.g. "A Palacio" ↔ "Ana Palacio").
 * Does not match "A Palacio" to "Dora Palacio".
 */
function namesMatchForIdentifiers(a, b) {
  if (!a || !b) return false;
  if (namesLooseMatch(a, b)) return true;
  return surnamesMatch(a, b) && firstInitialCompatible(a, b);
}

function agentsMatch(a, b) {
  if (!a || !b) return true;
  return namesLooseMatch(a, b) || namesMatchForIdentifiers(a, b);
}

function datesMatch(a, b) {
  const fa = formatIdentifierDate(a);
  const fb = formatIdentifierDate(b);
  if (!fa || !fb) return false;
  return fa === fb;
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
  if (/^\d{5,6}(\.\d+)?$/.test(s)) return formatIdentifierDate(Number(s));
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
  'dobdt', 'dob_dt', 'birth_dt', 'member_birth_dt', 'memberbirthdt',
  'member_birth_date', 'mbr_dob', 'mbrdob', 'member_dob_dt',
  'dateofbirthdt', 'birthdate_dt',
];

const PLAN_RAW_KEYS = [
  'plan_name', 'planname', 'plan name', 'plan_type', 'plantype', 'plan type',
  'product_description', 'product description', 'productdescription',
  'plan_desc', 'plandesc', 'plan description', 'marketing_name', 'marketingname',
  'mkt_name', 'pbp_name', 'pbpname', 'product',
];

function lookupRawKey(obj, wanted) {
  if (!obj || typeof obj !== 'object') return '';
  const entries = Object.entries(obj).map(([key, value]) => [normalizeHeader(key), value]);
  for (const term of wanted) {
    const n = normalizeHeader(term);
    const found = entries.find(([k, value]) => k === n && value != null && String(value).trim() !== '');
    if (found) return found[1];
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
    if (!n) continue;
    if (DOB_EXCLUDE.some((ex) => n.includes(normalizeHeader(ex)))) continue;
    const looksLikeDob = n.includes('dob') || n.includes('birth');
    if (!looksLikeDob) continue;
    const formatted = formatIdentifierDate(val);
    if (formatted) return formatted;
  }
  return '';
}

function extractPlanFromRaw(raw) {
  const obj = parseRawObject(raw);
  const value = lookupRawKey(obj, PLAN_RAW_KEYS);
  if (value) return String(value).trim();
  if (!obj) return '';
  for (const [key, val] of Object.entries(obj)) {
    const n = normalizeHeader(key);
    if (n !== 'plan' && n !== 'product' && !n.endsWith('planname')) continue;
    if (n.includes('status') || n.includes('effective')) continue;
    const s = String(val || '').trim();
    if (s) return s;
  }
  return '';
}

function derivePlanFromPolicy(carrier, policyNumber) {
  const p = String(policyNumber || '');
  if (!p) return '';
  const prefix = String(carrier || '').trim() || 'Plan';
  if (/_HMO/i.test(p)) return `${prefix} HMO`;
  if (/_PPO/i.test(p)) return `${prefix} PPO`;
  if (/_PDP/i.test(p)) return `${prefix} PDP`;
  if (/_MA\b|_MAPD/i.test(p)) return `${prefix} MA`;
  if (/MSup|MSUP|MedSupp|_MS\b/i.test(p)) return `${prefix} MedSupp`;
  return '';
}

function pickRaw(obj, keys) {
  const value = lookupRawKey(obj, keys);
  return value ? String(value).trim() : '';
}

/**
 * Humana / UHC / Devoted production files store IDs in carrier-specific columns.
 * Prefer those so UMID, HIC, and MemberRecordLocator win over generic scanning.
 */
function identifiersFromProductionRaw(carrier, raw) {
  const obj = parseRawObject(raw);
  if (!obj) return { memberId: '', policyNumber: '', dateOfBirth: '', planType: '' };
  const c = normalizeCarrier(carrier);
  let memberId = '';
  let policyNumber = '';

  if (c === 'humana') {
    memberId = pickRaw(obj, ['UMID', 'Member ID', 'MEDICARE_IDENTIFIER', 'MBI']);
    policyNumber = pickRaw(obj, ['Policy Number', 'POLICY_NUMBER', 'Contract Number']);
  } else if (c === 'unitedhealthcare') {
    memberId = pickRaw(obj, ['HICN/MBI', 'HIC', 'MBI', 'Medicare Beneficiary Identifier (MBI)']);
    policyNumber = pickRaw(obj, ['Policy Number', 'POLICY_NUMBER', 'Contract Number', 'CONTRACT']);
  } else if (c === 'devoted health') {
    memberId = pickRaw(obj, ['MemberRecordLocator', 'Member Record Locator', 'Member ID', 'MBI']);
    policyNumber = pickRaw(obj, ['Policy Number', 'POLICY_NUMBER']);
  }

  return {
    memberId,
    policyNumber,
    dateOfBirth: extractDobFromRaw(obj),
    planType: extractPlanFromRaw(obj),
  };
}

function identifiersFromRecord(rec = {}) {
  const fromProd = identifiersFromProductionRaw(rec.carrier, rec.raw_data);
  const memberId = String(
    rec.member_id || rec.memberId || rec.carrier_member_id || rec.mbi
      || fromProd.memberId || extractMemberIdFromRaw(rec.raw_data) || ''
  ).trim();
  const policyNumber = String(
    rec.policy_number || rec.policyNumber || rec.policy_number_production
      || fromProd.policyNumber || ''
  ).trim();
  const dateOfBirth = String(
    rec.date_of_birth || rec.dateOfBirth || fromProd.dateOfBirth || extractDobFromRaw(rec.raw_data) || ''
  ).trim();
  const planType = String(
    rec.plan_type || rec.planType || rec.plan_name || rec.planName || rec.policy_type
      || fromProd.planType || extractPlanFromRaw(rec.raw_data) || ''
  ).trim();
  return { memberId, policyNumber, dateOfBirth, planType };
}

function mergeClientIdentifiers(sources) {
  const merged = { memberId: '', policyNumber: '', dateOfBirth: '', planType: '' };
  let carrier = '';
  for (const source of sources || []) {
    if (!source) continue;
    if (!carrier && source.carrier) carrier = source.carrier;
    const ids = identifiersFromRecord(source);
    if (!merged.memberId && ids.memberId) merged.memberId = ids.memberId;
    if (!merged.policyNumber && ids.policyNumber) merged.policyNumber = ids.policyNumber;
    if (!merged.dateOfBirth && ids.dateOfBirth) merged.dateOfBirth = formatIdentifierDate(ids.dateOfBirth);
    if (!merged.planType && ids.planType) merged.planType = ids.planType;
  }
  if (!merged.planType) {
    merged.planType = derivePlanFromPolicy(carrier, merged.policyNumber);
  }
  return merged;
}

function policyNumberForDisplay(memberId, policyNumber) {
  if (!policyNumber) return '';
  if (memberId && normalizeId(memberId) === normalizeId(policyNumber)) return '';
  return policyNumber;
}

function relatedClientName(rec) {
  return rec.client_full_name || rec.client_name || rec.client || '';
}

function identifierLookupKey(name, carrier) {
  return `${clientNameKey(name)}|${normalizeCarrier(carrier)}`;
}

function sourceRank(rec) {
  const source = rec.identifier_source || rec.source;
  if (source === 'production') return 0;
  if (source === 'medicarepro') return 1;
  return 2;
}

function sortRelated(rows) {
  return [...(rows || [])].sort((a, b) => sourceRank(a) - sourceRank(b));
}

function addIdLookups(add, carrier, rawId, byMemberId, byPolicy) {
  for (const id of idIndexKeys(rawId)) {
    const key = `${normalizeCarrier(carrier)}|${id}`;
    add(byMemberId.get(key));
    add(byPolicy.get(key));
  }
}

function chainIdsFromCollected(add, collected, bob, byMemberId, byPolicy) {
  for (const rec of collected) {
    const ids = identifiersFromRecord(rec);
    addIdLookups(add, bob.carrier, ids.memberId, byMemberId, byPolicy);
    addIdLookups(add, bob.carrier, rec.carrier_member_id, byMemberId, byPolicy);
    addIdLookups(add, bob.carrier, rec.mbi, byMemberId, byPolicy);
    addIdLookups(add, bob.carrier, ids.policyNumber, byMemberId, byPolicy);
    addIdLookups(add, bob.carrier, rec.policy_number_production, byMemberId, byPolicy);
  }
}

function uniqueLastNameFallback(bob, carrierRows) {
  const matches = (carrierRows || []).filter((rec) => {
    if (!surnamesMatch(bob.client_full_name, relatedClientName(rec))) return false;
    if (bob.agent_name && rec.agent_name && !agentsMatch(bob.agent_name, rec.agent_name)) return false;
    return true;
  });
  if (!matches.length) return [];

  const initialHits = matches.filter((rec) => namesMatchForIdentifiers(bob.client_full_name, relatedClientName(rec)));
  if (initialHits.length) return initialHits;

  if (bob.effective_date) {
    const byDate = matches.filter((rec) => datesMatch(bob.effective_date, rec.effective_date));
    if (byDate.length === 1) return byDate;
  }

  if (matches.length === 1) return matches;
  return [];
}

function relatedRowsForClient(bob, byKey, byCarrier, byMemberId, byPolicy) {
  const seen = new Set();
  const collected = [];
  const add = (rows) => {
    for (const rec of rows || []) {
      if (!rec || seen.has(rec)) continue;
      if (rec.carrier && bob.carrier && !carriersMatch(rec.carrier, bob.carrier)) continue;
      seen.add(rec);
      collected.push(rec);
    }
  };

  add(byKey.get(identifierLookupKey(bob.client_full_name, bob.carrier)));

  const carrierRows = byCarrier.get(normalizeCarrier(bob.carrier)) || [];
  add(carrierRows.filter((rec) => namesMatchForIdentifiers(bob.client_full_name, relatedClientName(rec))));
  add(uniqueLastNameFallback(bob, carrierRows));

  addIdLookups(add, bob.carrier, bob.member_id, byMemberId, byPolicy);
  addIdLookups(add, bob.carrier, bob.mbi, byMemberId, byPolicy);
  addIdLookups(add, bob.carrier, bob.policy_number, byMemberId, byPolicy);

  chainIdsFromCollected(add, collected, bob, byMemberId, byPolicy);

  return sortRelated(collected);
}

function indexId(map, carrier, value, rec) {
  for (const id of idIndexKeys(value)) {
    const key = `${normalizeCarrier(carrier)}|${id}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(rec);
  }
}

function collectIdTargets(ids, extraRows) {
  const targets = new Set();
  for (const value of [ids.memberId, ids.policyNumber]) {
    const stripped = stripPolicySuffix(value);
    if (stripped.length >= 8) targets.add(stripped);
  }
  for (const rec of extraRows || []) {
    const recIds = identifiersFromRecord(rec);
    for (const value of [recIds.memberId, recIds.policyNumber, rec.mbi, rec.carrier_member_id, rec.policy_number_production]) {
      const stripped = stripPolicySuffix(value);
      if (stripped.length >= 8) targets.add(stripped);
    }
  }
  return [...targets];
}

function fillDobFromAnyCarrier(ids, matchedRows, allRelatedRows) {
  if (ids.dateOfBirth) return ids;
  const targets = collectIdTargets(ids, matchedRows);
  if (!targets.length) return ids;
  for (const rec of allRelatedRows || []) {
    const recIds = identifiersFromRecord(rec);
    const recKeys = [
      recIds.memberId, recIds.policyNumber, rec.mbi, rec.carrier_member_id, rec.policy_number_production,
    ].map(stripPolicySuffix).filter(Boolean);
    if (!recKeys.some((k) => targets.includes(k))) continue;
    if (recIds.dateOfBirth) {
      ids.dateOfBirth = recIds.dateOfBirth;
      return ids;
    }
  }
  return ids;
}

function enrichBobClientsWithIdentifiers(bobRows, relatedRows) {
  const byKey = new Map();
  const byCarrier = new Map();
  const byMemberId = new Map();
  const byPolicy = new Map();
  for (const rec of relatedRows || []) {
    const name = relatedClientName(rec);
    const key = identifierLookupKey(name, rec.carrier);
    if (clientNameKey(name)) {
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push(rec);
    }
    const carrierKey = normalizeCarrier(rec.carrier);
    if (carrierKey) {
      if (!byCarrier.has(carrierKey)) byCarrier.set(carrierKey, []);
      byCarrier.get(carrierKey).push(rec);
    }
    const ids = identifiersFromRecord(rec);
    indexId(byMemberId, rec.carrier, ids.memberId, rec);
    indexId(byMemberId, rec.carrier, rec.carrier_member_id, rec);
    indexId(byMemberId, rec.carrier, rec.mbi, rec);
    indexId(byPolicy, rec.carrier, ids.policyNumber, rec);
    indexId(byPolicy, rec.carrier, rec.policy_number_production, rec);
  }

  return (bobRows || []).map((bob) => {
    const related = relatedRowsForClient(bob, byKey, byCarrier, byMemberId, byPolicy);
    const ids = fillDobFromAnyCarrier(
      mergeClientIdentifiers([bob, ...related]),
      related,
      relatedRows
    );
    return {
      ...bob,
      member_id: ids.memberId || '',
      policy_number: ids.policyNumber || '',
      date_of_birth: ids.dateOfBirth || '',
      plan_type: ids.planType || '',
    };
  });
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
  extractPlanFromRaw,
  derivePlanFromPolicy,
  identifiersFromRecord,
  mergeClientIdentifiers,
  policyNumberForDisplay,
  identifierLookupKey,
  enrichBobClientsWithIdentifiers,
  identifiersFromProductionRaw,
  namesMatchForIdentifiers,
  parseGivenSurname,
  idsEquivalent,
  stripPolicySuffix,
};
