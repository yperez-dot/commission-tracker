'use strict';

/**
 * BSI → payee "Detailed Compensation Statement" PDFs
 * (e.g. Commission Statement issued to Alba Hernandez).
 *
 * Layout (pdf-parse):
 *   Date: MM/DD/YYYY
 *   Detailed Compensation Statement
 *   [Month] Statement          (optional)
 *   AgencyCompanyPolicy #Client NameEffective Date Commission
 *   BROKER SOCIETY INSURANCE
 *   <CARRIER>
 *   <policy+client+date+amount>   (often glued / multi-line)
 *   ...
 *   Balance:$X,XXX.XX
 *
 * Writing agency is always BSI; the payee agent is not on each line —
 * pass agentName (default Alba Hernandez). Amounts are agent commissions
 * (producer_payable), not Agency Override.
 */

const MONTHS = {
  january: '01', jan: '01',
  february: '02', feb: '02',
  march: '03', mar: '03',
  april: '04', apr: '04',
  may: '05',
  june: '06', jun: '06',
  july: '07', jul: '07',
  august: '08', aug: '08',
  september: '09', sep: '09', sept: '09',
  october: '10', oct: '10',
  november: '11', nov: '11',
  december: '12', dec: '12',
};

const CARRIER_MAP = {
  AETNA: 'Aetna',
  HUMANA: 'Humana',
  'UNITED HEALTH CARE': 'UnitedHealthcare',
  'UNITED HEALTHCARE': 'UnitedHealthcare',
  UHC: 'UnitedHealthcare',
  DEVOTED: 'Devoted',
};

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function parseMoney(s) {
  if (s == null) return null;
  const n = Number(String(s).replace(/[$,\s]/g, '').replace(/\(/, '-').replace(/\)/, ''));
  return Number.isFinite(n) ? round2(n) : null;
}

function toTitleCase(str) {
  return String(str || '')
    .trim()
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function normalizeClient(raw) {
  const s = String(raw || '').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  if (s.includes(',')) return s.toUpperCase();
  return toTitleCase(s);
}

function normalizeCarrier(raw) {
  const key = String(raw || '').toUpperCase().replace(/\s+/g, ' ').trim();
  return CARRIER_MAP[key] || toTitleCase(raw);
}

function classifyAgentCommission(amount) {
  const a = Number(amount) || 0;
  if (a < 0) return 'Chargeback';
  if (Math.abs(a) >= 300) return 'New Business';
  return 'Renewal';
}

function periodFromText(text, filename, statementDate, now = new Date()) {
  const t = String(text || '');
  const f = String(filename || '').toLowerCase();

  const monthStmt = t.match(
    /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+Statement\b/i
  );
  if (monthStmt) {
    const mon = MONTHS[monthStmt[1].toLowerCase()];
    const dateY = (statementDate && String(statementDate).match(/(\d{4})/)) || t.match(/Date:\s*\d{1,2}\/\d{1,2}\/(\d{4})/i);
    let year = dateY ? dateY[1] : null;
    // Issued early next month → statement month year may be prior calendar year in Dec
    if (!year) year = String(now.getUTCFullYear());
    // If statement is December and issue date is January, use prior year
    if (statementDate) {
      const dm = String(statementDate).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      if (dm) {
        const issueMonth = parseInt(dm[1], 10);
        const issueYear = parseInt(dm[3], 10);
        const stmtMonth = parseInt(mon, 10);
        year = String(stmtMonth <= issueMonth ? issueYear : issueYear - 1);
        // July Statement dated 08/06/2026 → 202607 (stmtMonth 7 < issueMonth 8)
        // June dated 07/09 → need filename; if "June Statement" absent use filename
      }
    }
    return `${year}${mon}`;
  }

  for (const [name, num] of Object.entries(MONTHS)) {
    if (name.length < 3) continue;
    if (new RegExp(`\\b${name}\\b`, 'i').test(f)) {
      const y =
        (f.match(/\b(20\d{2})\b/) ||
          (statementDate && String(statementDate).match(/(\d{4})/)) ||
          t.match(/Date:\s*\d{1,2}\/\d{1,2}\/(\d{4})/i) ||
          [])[1] || String(now.getUTCFullYear());
      // CarrierStatement-June dated 07/09/2026 → June 2026
      let year = y;
      if (statementDate) {
        const dm = String(statementDate).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
        if (dm) {
          const issueMonth = parseInt(dm[1], 10);
          const issueYear = parseInt(dm[3], 10);
          const stmtMonth = parseInt(num, 10);
          year = String(stmtMonth <= issueMonth ? issueYear : issueYear - 1);
        }
      }
      return `${year}${num}`;
    }
  }

  // Fallback: month before statement date
  if (statementDate) {
    const dm = String(statementDate).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (dm) {
      let m = parseInt(dm[1], 10) - 1;
      let y = parseInt(dm[3], 10);
      if (m === 0) {
        m = 12;
        y -= 1;
      }
      return `${y}${String(m).padStart(2, '0')}`;
    }
  }
  return 'Unknown';
}

/**
 * Split glued policy + client for common carrier patterns.
 */
function splitPolicyClient(beforeDate) {
  const s = String(beforeDate || '').trim();
  if (!s) return null;

  // Explicit HRA fee rows
  if (/^HRA\b/i.test(s)) {
    return { policyNumber: 'HRA', clientName: s.replace(/^HRA\s*/i, '').trim() };
  }

  // Humana: digits + optional letter + _HMO/_PPO/...
  const humana = s.match(/^(\d{8,12}[A-Z]?_(?:HMO|PPO|PDP|MA|MSUP))(.+)$/i);
  if (humana) {
    return { policyNumber: humana[1], clientName: humana[2].trim() };
  }

  // Aetna NG + 12 digits
  const aetna = s.match(/^(NG\d{12})(.+)$/i);
  if (aetna) {
    return { policyNumber: aetna[1], clientName: aetna[2].trim() };
  }

  // Aetna / other long alpha member ids (e.g. MEQNDVZM00000182763)
  const longAlpha = s.match(/^([A-Z]{4,}\d{8,})(.+)$/i);
  if (longAlpha) {
    return { policyNumber: longAlpha[1], clientName: longAlpha[2].trim() };
  }

  // UHC 9-digit policy
  const uhc = s.match(/^(\d{9})(.+)$/);
  if (uhc) {
    return { policyNumber: uhc[1], clientName: uhc[2].trim() };
  }

  // Generic: leading alnum block then name
  const gen = s.match(/^([A-Z0-9_]{6,24})([A-Z].*)$/i);
  if (gen) {
    return { policyNumber: gen[1], clientName: gen[2].trim() };
  }

  return null;
}

function parseItemChunk(carrierRaw, chunkLines) {
  const carrier = normalizeCarrier(carrierRaw);
  const lines = (chunkLines || []).map((l) => String(l).trim()).filter(Boolean);
  if (!lines.length) return null;

  // HRA multi-line: HRA / CLIENT / -$50.00
  if (/^HRA$/i.test(lines[0]) || (lines[0] === 'HRA' && lines.length >= 2)) {
    const amount = parseMoney(lines[lines.length - 1]);
    const clientName = lines.slice(1, -1).join(' ').trim() || 'HRA';
    if (amount == null) return null;
    return {
      carrier,
      policyNumber: 'HRA',
      clientName: normalizeClient(clientName),
      effectiveDate: null,
      amount,
    };
  }

  // Glued HRA: HRATEXAS, JOE-$55.00
  const hraGlue = lines.join(' ').match(/^HRA\s*(.+?)(-?\$[\d,]+\.\d{2})$/i);
  if (hraGlue && !/^\d/.test(lines[0])) {
    return {
      carrier,
      policyNumber: 'HRA',
      clientName: normalizeClient(hraGlue[1].replace(/-\s*$/, '').trim()),
      effectiveDate: null,
      amount: parseMoney(hraGlue[2]),
    };
  }

  const blob = lines.join(' ');
  const moneyM = blob.match(/(-?\$[\d,]+\.\d{2})\s*$/);
  if (!moneyM) return null;
  const amount = parseMoney(moneyM[1]);
  let rest = blob.slice(0, moneyM.index).trim();

  let effectiveDate = null;
  const dateM = rest.match(/(\d{1,2}\/\d{1,2}\/\d{4})\s*$/);
  if (dateM) {
    effectiveDate = dateM[1];
    rest = rest.slice(0, dateM.index).trim();
  }

  const split = splitPolicyClient(rest);
  if (!split || !split.policyNumber) return null;

  return {
    carrier,
    policyNumber: split.policyNumber,
    clientName: normalizeClient(split.clientName),
    effectiveDate,
    amount,
  };
}

/**
 * Detect BSI→payee compensation PDF from extracted text / filename.
 */
function isBsiPayeeCompensationStatement(text, filename) {
  const t = String(text || '');
  const f = String(filename || '').toLowerCase().replace(/\s+/g, '_');
  if (!/detailed\s+compensation\s+statement/i.test(t)) return false;
  // Carrier-section form uses "Detailed Compensation Statement (UHC)" — different parser
  if (/detailed\s+compensation\s+statement\s*\(/i.test(t)) return false;
  if (!/broker\s+society\s+insurance/i.test(t)) return false;
  if (!/agency\s*company\s*policy/i.test(t.replace(/\s+/g, ''))) {
    // header often glued: AgencyCompanyPolicy #Client...
    if (!/AgencyCompanyPolicy/i.test(t)) return false;
  }
  // Filename hints (optional boost — text is enough)
  if (
    /commission_statement|carrierstatement|carrier_statement|alba|lina/.test(f) ||
    /broker\s+society\s+insurance/i.test(t)
  ) {
    return true;
  }
  return true;
}

/**
 * Parse PDF text into importable commission records.
 *
 * @param {string} text - pdf-parse text
 * @param {object} opts
 * @param {string} [opts.filename]
 * @param {string} [opts.agentName='Alba Hernandez']
 */
function parseBsiPayeeCompensationStatement(text, opts = {}) {
  const filename = opts.filename || '';
  const agentName = opts.agentName || 'Alba Hernandez';
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const dateLine = lines.find((l) => /^Date:\s*/i.test(l));
  const statementDate = dateLine ? dateLine.replace(/^Date:\s*/i, '').trim() : null;
  const period = periodFromText(text, filename, statementDate);

  let statedBalance = null;
  const balLine = lines.find((l) => /^Balance:/i.test(l));
  if (balLine) statedBalance = parseMoney(balLine.replace(/^Balance:\s*/i, ''));

  const items = [];
  let i = 0;
  while (i < lines.length) {
    if (!/^BROKER SOCIETY INSURANCE$/i.test(lines[i])) {
      i += 1;
      continue;
    }
    const carrierRaw = lines[i + 1];
    if (!carrierRaw || /^BROKER SOCIETY INSURANCE$/i.test(carrierRaw) || /^Balance:/i.test(carrierRaw)) {
      i += 1;
      continue;
    }
    let j = i + 2;
    const chunk = [];
    while (
      j < lines.length &&
      !/^BROKER SOCIETY INSURANCE$/i.test(lines[j]) &&
      !/^Balance:/i.test(lines[j])
    ) {
      chunk.push(lines[j]);
      j += 1;
    }
    const parsed = parseItemChunk(carrierRaw, chunk);
    if (parsed && parsed.amount != null) {
      items.push(parsed);
    }
    i = j;
  }

  const records = items.map((it) => {
    const amount = round2(it.amount);
    const classification = classifyAgentCommission(amount);
    const lob = /humana|aetna|devoted|united/i.test(it.carrier) ? 'MA' : 'Unknown';
    return {
      agent: agentName,
      carrier: it.carrier,
      planType: '',
      client: it.clientName,
      effectiveDate: it.effectiveDate,
      premium: 0,
      commission: amount,
      classification,
      period,
      policyNumber: it.policyNumber,
      payee: agentName,
      mga: '',
      source: 'BSI_PAYEE',
      policyWrittenDate: it.effectiveDate,
      grossCommission: amount,
      theiShare: 0,
      bsiShare: 0,
      producerPayable: amount,
      splitApplies: false,
      lob,
      subAgentOverride: 0,
      raw: {
        writingAgency: 'BROKER SOCIETY INSURANCE',
        statementDate,
        statedBalance,
        statementType: 'bsi_payee_compensation',
      },
    };
  });

  const commissionSum = round2(records.reduce((s, r) => s + (Number(r.commission) || 0), 0));

  return {
    agentName,
    period,
    statementDate,
    statedBalance,
    commissionSum,
    records,
  };
}

module.exports = {
  isBsiPayeeCompensationStatement,
  parseBsiPayeeCompensationStatement,
  periodFromText,
  splitPolicyClient,
  classifyAgentCommission,
  parseItemChunk,
};
