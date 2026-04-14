const express = require('express');
const router = express.Router();
const multer = require('multer');
const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');
const Anthropic = require('@anthropic-ai/sdk');
const { getPool } = require('../db/database');
const { requireAuth } = require('./auth');
const { normalizeAgentName } = require('../normalize');

const UPLOADS_DIR = path.join('/tmp', 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: UPLOADS_DIR,
  filename: (req, file, cb) => cb(null, `${Date.now()}_${file.originalname.replace(/\s+/g, '_')}`)
});
const upload = multer({ storage, limits: { fileSize: 20 * 1024 * 1024 } });
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─── Plan type derivation ────────────────────────────────────────────────────

function derivePlanType(carrier, rawPlanType, policyNumber, lob) {
  const pt = String(rawPlanType || '').toLowerCase().trim();
  const pn = String(policyNumber || '').toLowerCase().trim();
  const lb = String(lob || '').toLowerCase().trim();

  if (carrier === 'UnitedHealthcare') {
    if (['mapd','dsnp','csnp'].includes(pt)) return 'UnitedHealthcare Med Adv';
    if (pt.includes('medsup') || pt.includes('modmedsup')) return 'UnitedHealthcare Med Supp';
    if (pt.includes('partd') || pt === 'partd') return 'UnitedHealthcare PDP';
    return 'UnitedHealthcare Med Adv';
  }

  if (carrier === 'Humana' || carrier === 'Humana/Devoted') {
    if (pn.includes('_pdp') || pt.includes('pdp')) return 'Humana PDP';
    if (pt.includes('dental') || pt === 'idv') return 'Humana Dental';
    if (pn.includes('_hmo') || pn.includes('_ppo') || pt === 'ma') return 'Humana Med Adv';
    return 'Humana Med Adv';
  }

  if (carrier === 'Devoted') return 'Devoted Med Adv';

  if (carrier === 'Aetna') {
    if (pt.includes('pdp') || pn.includes('pdp')) return 'Aetna PDP';
    return 'Aetna MAPD';
  }

  if (carrier === 'Cigna') return 'Cigna ACA';
  if (carrier === 'Oscar Health') return 'Oscar Health ACA';
  if (carrier === 'Florida Blue') return 'Florida Blue Med Adv';
  if (carrier === 'Gold Kidney') return 'Gold Kidney Med Adv';
  if (carrier === 'Simply') return 'Simply Med Adv';
  if (carrier === 'Molina') return 'Molina Med Adv';
  if (carrier === 'WellCare') return 'WellCare Med Adv';

  if (lb === 'aca') return `${carrier} ACA`;
  if (lb === 'ma') return `${carrier} Med Adv`;

  return carrier;
}

// ─── Filename detection ──────────────────────────────────────────────────────

function detectCarrierFromFilename(filename) {
  const f = filename.toLowerCase().replace(/\s+/g, '_');
  if (f.includes('commission_statement_2737247') || f.includes('uhc') || f.includes('united')) return 'UnitedHealthcare';
  if (f.includes('producerstatementreport')) return 'Aetna';
  if (f.includes('16326554') || f.includes('devoted')) return 'Devoted';
  if (f.includes('the_health_experts_insurance_med_comm')) return 'Aetna';
  if (f.includes('commissiondata') || f.includes('yahoska_perez_med_comm') || f.includes('humana')) return 'Humana';
  if (f.includes('statement-health_experts') || f.includes('statement_health_experts')) return 'BSI';
  if (f.includes('the_health_experts_insurance_statement') || f.includes('nhp')) return 'NHP';
  if (f.includes('commissions_ledger') || f.includes('solis')) return 'Solis';
  if (f.includes('commission-statement') || f.includes('integrity')) return 'Integrity';
  if (f.includes('cigna')) return 'Cigna';
  if (f.includes('wellcare')) return 'WellCare';
  if (f.includes('sunshine')) return 'Sunshine Health';
  if (f.includes('molina')) return 'Molina';
  if (f.includes('ambetter')) return 'Ambetter';
  if (f.includes('florida_blue') || f.includes('bcbs') || f.includes('floridablue')) return 'Florida Blue';
  if (f.includes('oscar')) return 'Oscar Health';
  if (f.includes('avmed') || f.includes('av_med')) return 'AVMED';
  if (f.includes('doctors') || f.includes('doctor_')) return 'DOCTORS';
  if (f.includes('sunshine')) return 'Sunshine Health';
  if (f.includes('gold_kidney') || f.includes('goldkidney')) return 'Gold Kidney';
  if (f.includes('simply')) return 'Simply';
  if (f.includes('ambetter')) return 'Ambetter';
  return 'Unknown';
}

function isUHCFile(filename) {
  return filename.toLowerCase().replace(/\s+/g, '_').includes('commission_statement_2737247');
}
function isBSIFile(filename) {
  const f = filename.toLowerCase().replace(/\s+/g, '_');
  return f.includes('statement-health_experts') || f.includes('statement_health_experts');
}
function isSolisFile(filename) {
  const f = filename.toLowerCase().replace(/[\s()]/g, '_');
  return f.includes('commissions_ledger') || f.includes('solis');
}
function isAPLFile(filename) {
  const f = filename.toLowerCase().replace(/[\s()]/g, '_');
  return f.includes('commission-statement') || f.includes('commission_statement_2026') && !f.includes('2737247') ||
    f.includes('integrity') || f.includes('apl');
}
function isNHPFile(filename) {
  const f = filename.toLowerCase().replace(/[\s()]/g, '_');
  return f.includes('the_health_experts_insurance_statement') ||
    f.includes('the_health_experst_insurance') ||
    (f.includes('the_health_experts') && f.includes('statement')) ||
    (f.includes('yahoska') && f.includes('katy') && f.includes('statement'));
}
function isHumanaFile(filename) {
  const f = filename.toLowerCase().replace(/\s+/g, '_');
  return f.includes('commissiondata') || f.includes('yahoska_perez_med_comm') || f.includes('humana');
}

// ─── Date formatting ─────────────────────────────────────────────────────────

function formatDate(value) {
  if (!value) return '';
  if (value instanceof Date) {
    const m = String(value.getUTCMonth() + 1).padStart(2, '0');
    const d = String(value.getUTCDate()).padStart(2, '0');
    const y = value.getUTCFullYear();
    return `${m}/${d}/${y}`;
  }
  if (typeof value === 'string') {
    if (value.match(/^\d{1,2}\/\d{1,2}\/\d{4}$/)) return value;
    if (value.match(/^\d{4}-\d{2}-\d{2}/)) {
      const [y, m, d] = value.split('-');
      return `${m}/${d}/${y}`;
    }
    return value;
  }
  if (typeof value === 'number') {
    const s = String(value);
    if (s.match(/^\d{8}$/) && parseInt(s.slice(0,4)) > 1900) {
      const y = s.slice(0,4), m = s.slice(4,6), d = s.slice(6,8);
      return `${m}/${d}/${y}`;
    }
    if (s.match(/^\d{6}$/) && parseInt(s.slice(0,4)) > 1900) return s;
    const date = new Date((value - 25569) * 86400 * 1000);
    if (isNaN(date.getTime()) || date.getUTCFullYear() > 2100) return String(value);
    const m = String(date.getUTCMonth() + 1).padStart(2, '0');
    const d = String(date.getUTCDate()).padStart(2, '0');
    const y = date.getUTCFullYear();
    return `${m}/${d}/${y}`;
  }
  return String(value);
}

// ─── Carrier normalizers ─────────────────────────────────────────────────────

function normalizeBSICarrier(company) {
  const c = String(company || '').toLowerCase();
  if (c.includes('united') || c.includes('uhc')) return 'UnitedHealthcare';
  if (c.includes('humana') && c.includes('devoted')) return 'Humana/Devoted';
  if (c.includes('humana')) return 'Humana';
  if (c.includes('devoted')) return 'Devoted';
  if (c.includes('aetna')) return 'Aetna';
  if (c.includes('nhp')) return 'NHP';
  return String(company || '').trim();
}

function normalizeNHPCarrier(carrierMonth) {
  const c = String(carrierMonth || '').toLowerCase();
  if (c.includes('aetna')) return 'Aetna';
  if (c.includes('cigna')) return 'Cigna';
  if (c.includes('devoted')) return 'Devoted';
  if (c.includes('florida blue') || c.includes('floridablue')) return 'Florida Blue';
  if (c.includes('gold kidney')) return 'Gold Kidney';
  if (c.includes('humana')) return 'Humana';
  if (c.includes('oscar')) return 'Oscar Health';
  if (c.includes('simply')) return 'Simply';
  if (c.includes('united') || c.includes('uhc')) return 'UnitedHealthcare';
  if (c.includes('molina')) return 'Molina';
  if (c.includes('wellcare')) return 'WellCare';
  return String(carrierMonth || '').split(' - ')[0].trim();
}

function isAgencyName(name) {
  const n = String(name || '').toLowerCase().trim();
  return n.includes('the health experts') || n.includes('health experts insurance');
}

// ─── Parsers ─────────────────────────────────────────────────────────────────

function parseUHCRows(wb) {
  const records = [];
  const sheetName = wb.SheetNames.find(s => s.toLowerCase().includes('commission trans')) || wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(ws, { defval: '', raw: true });

  for (const row of rows) {
    const writingAgentRaw = String(row['Writing Agent Name'] || '').trim();
    const client = String(row['Member Name'] || '').trim();
    const commission = parseFloat(row['Commission']) || 0;
    const policyNumber = String(row['Policy Number'] || '').trim();
    const effectiveDate = formatDate(row['Original Effective Date']);
    const period = String(row['Payment Period'] || '').trim();
    const rawPlanType = String(row['Plan Type'] || '').trim();
    const commAction = String(row['Commission Action'] || '').trim();

    if (!client || commission === 0) continue;

    const isAgency = isAgencyName(writingAgentRaw);
    const agentName = isAgency ? 'The Health Experts Insurance' : normalizeAgentName(writingAgentRaw);
    const planType = derivePlanType('UnitedHealthcare', rawPlanType, policyNumber, '');
    const commActionLower = commAction.toLowerCase();
    const uhcClass = commActionLower === 'new' ? 'New Business'
      : commActionLower === 'renewal' ? 'Renewal'
      : commActionLower.includes('chargeback') ? 'Chargeback'
      : 'Agent Commission';

    records.push({
      agent: agentName,
      carrier: 'UnitedHealthcare',
      planType,
      client,
      effectiveDate,
      premium: parseFloat(row['Prem Amount']) || 0,
      commission,
      classification: commission < 0 ? 'Chargeback' : uhcClass,
      period: String(period),
      policyNumber,
      raw: row
    });
  }
  return records;
}

// ─── Humana parser — SpreadsheetML XML ───────────────────────────────────────
// Humana CommissionData files are SpreadsheetML XML disguised as .xls.
// XLSX.js cannot parse them. We read the raw file buffer as UTF-8 XML.

function parseHumanaRows(wb, filename, rawBuffer) {
  const records = [];

  try {
    if (!rawBuffer) {
      console.error('parseHumanaRows: no rawBuffer provided');
      return records;
    }

    const content = rawBuffer.toString('utf-8');
    // Humana uses broken XML declaration — fix it
    const fixedXml = content.replace('<xml version>', '<?xml version="1.0"?>');

    const monthMap = {
      jan:'01', feb:'02', mar:'03', apr:'04', may:'05', jun:'06',
      jul:'07', aug:'08', sep:'09', oct:'10', nov:'11', dec:'12'
    };

    // Extract rows via regex — no external XML deps needed
    const rowRegex = /<Row[^>]*>([\s\S]*?)<\/Row>/g;
    const cellRegex = /<Cell[^>]*>[\s\S]*?<Data[^>]*>([\s\S]*?)<\/Data>[\s\S]*?<\/Cell>/g;

    const allRows = [];
    let rowMatch;
    while ((rowMatch = rowRegex.exec(fixedXml)) !== null) {
      const rowContent = rowMatch[1];
      const cells = [];
      let cellMatch;
      while ((cellMatch = cellRegex.exec(rowContent)) !== null) {
        cells.push(cellMatch[1].trim());
      }
      if (cells.length > 0) allRows.push(cells);
    }

    if (!allRows.length) {
      console.error('parseHumanaRows: no rows found in XML');
      return records;
    }

    const headers = allRows[0];
    const col = (name) => headers.indexOf(name);

    const grpIdx     = col('GrpName');
    const waIdx      = col('WaName');
    const paidIdx    = col('PaidAmount');
    const monthIdx   = col('MonthPaid');
    const effIdx     = col('EffDate');
    const fyrIdx     = col('FrstYrRnwl');
    const grpNbrIdx  = col('GrpNbr');
    const commRunIdx = col('CommRunDt');
    const blkBusIdx  = col('BlkBusCd');
    const productIdx = col('Product');

    if (grpIdx < 0 || paidIdx < 0) {
      console.error('parseHumanaRows: required columns not found. Headers:', headers);
      return records;
    }

    for (let i = 1; i < allRows.length; i++) {
      const vals = allRows[i];
      const get = (idx) => (idx >= 0 && idx < vals.length ? vals[idx] : '') || '';

      const client     = get(grpIdx).trim();
      const agentRaw   = get(waIdx).trim();
      const commission = parseFloat(get(paidIdx)) || 0;
      const monthPaid  = get(monthIdx).trim().toLowerCase();
      const effDateRaw = get(effIdx).trim();
      const fyr        = get(fyrIdx).trim().toUpperCase();
      const policyNum  = get(grpNbrIdx).trim();
      const commRunDt  = get(commRunIdx).trim();  // e.g. "2025-03-19T00:00:00.000"
      const blkBus     = get(blkBusIdx).trim().toUpperCase();
      const product    = get(productIdx).trim().toUpperCase();

      if (!client || commission === 0) continue;

      // Period: CommRunDt year + MonthPaid month
      // e.g. CommRunDt=2025-03-19, MonthPaid=MAR → 202503
      // e.g. CommRunDt=2025-03-19, MonthPaid=JAN → 202501 (retroactive)
      let period = '';
      if (monthPaid && monthMap[monthPaid] && commRunDt) {
        const yearMatch = commRunDt.match(/^(\d{4})/);
        const year = yearMatch ? yearMatch[1] : new Date().getFullYear().toString();
        period = year + monthMap[monthPaid];
      }

      // EffDate ISO string → MM/DD/YYYY
      let effectiveDate = '';
      const em = effDateRaw.match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (em) effectiveDate = `${em[2]}/${em[3]}/${em[1]}`;

      // Plan type from BlkBusCd + Product
      let planType = 'Humana Med Adv';
      if (blkBus === 'IN' || product === 'DENTAL') planType = 'Humana Dental';
      else if (product === 'PDP' || policyNum.toLowerCase().includes('_pdp')) planType = 'Humana PDP';

      const classification = commission < 0 ? 'Chargeback'
        : fyr === 'F' ? 'New Business'
        : fyr === 'R' ? 'Renewal'
        : 'Agent Commission';

      records.push({
        agent: normalizeAgentName(agentRaw) || 'The Health Experts Insurance',
        carrier: 'Humana',
        planType,
        client,
        effectiveDate,
        premium: 0,
        commission,
        classification,
        period,
        policyNumber: policyNum,
        payee: 'Humana',
        raw: {}
      });
    }
  } catch (err) {
    console.error('parseHumanaRows error:', err.message);
  }

  return records;
}

function parseBSIRows(wb, filename) {
  function getPeriodFromFilename(fn) {
    if (!fn) return 'Unknown';
    const f = fn.toLowerCase();
    const m1 = f.match(/(20\d{2})(0[1-9]|1[0-2])/);
    if (m1) return m1[1] + m1[2];
    const months = {jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12'};
    const m2 = f.match(/([a-z]{3})[_\-]?(20\d{2})/) || f.match(/(20\d{2})[_\-]([a-z]{3})/);
    if (m2) {
      const mon = months[m2[1]] || months[m2[2]];
      const yr = m2[1].match(/^20/) ? m2[1] : m2[2];
      if (mon && yr) return yr + mon;
    }
    return 'Unknown';
  }
  const filePeriod = getPeriodFromFilename(filename);
  const records = [];
  const ws = wb.Sheets[wb.SheetNames[0]];
  const range = XLSX.utils.decode_range(ws['!ref']);

  let headerRow = -1;
  for (let r = range.s.r; r <= Math.min(range.s.r + 15, range.e.r); r++) {
    const rowVals = [];
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })];
      if (cell) rowVals.push(String(cell.v || '').toLowerCase());
    }
    const str = rowVals.join('|');
    if (str.includes('agent') && str.includes('client') && str.includes('commission')) {
      headerRow = r;
      break;
    }
  }
  if (headerRow < 0) return records;

  const rows = XLSX.utils.sheet_to_json(ws, { defval: '', raw: true, range: headerRow });

  const firstRow = rows[0] || {};
  const keyMap = {};
  Object.keys(firstRow).forEach(k => { keyMap[k.toLowerCase().replace(/[^a-z]/g, '')] = k; });

  const findCol = (terms) => {
    for (const t of terms) {
      if (keyMap[t]) return keyMap[t];
      const found = Object.keys(keyMap).find(k => k.includes(t));
      if (found) return keyMap[found];
    }
    return null;
  };

  const agentCol      = findCol(['agent']);
  const companyCol    = findCol(['company', 'carrier', 'companyname']);
  const policyCol     = findCol(['policy', 'policynumber']);
  const clientCol     = findCol(['clientname', 'client', 'membername', 'member', 'insured']);
  const effDateCol    = findCol(['effectivedate', 'effective', 'effdate']);
  const commissionCol = findCol(['commission', 'amount', 'comp']);

  for (const row of rows) {
    const agent = normalizeAgentName(String(agentCol ? row[agentCol] : '').trim());
    const company = String(companyCol ? row[companyCol] : '').trim();
    const policyNumber = String(policyCol ? row[policyCol] : '').trim();
    const client = String(clientCol ? row[clientCol] : '').trim();
    const effectiveDate = formatDate(effDateCol ? row[effDateCol] : '');
    const commission = parseFloat(commissionCol ? row[commissionCol] : 0) || 0;
    if (!client) continue;
    const carrier = normalizeBSICarrier(company);
    records.push({
      agent: agent || 'The Health Experts Insurance',
      carrier,
      planType: derivePlanType(carrier, '', policyNumber, ''),
      client,
      effectiveDate,
      premium: 0,
      commission,
      classification: commission < 0 ? 'Chargeback' : 'Agency Override',
      period: filePeriod,
      policyNumber,
      payee: 'BSI',
      raw: row
    });
  }
  return records;
}

function parseNHPRows(wb) {
  const records = [];
  const ws = wb.Sheets[wb.SheetNames[0]];
  const range = XLSX.utils.decode_range(ws['!ref']);
  let headerRow = -1;
  for (let r = range.s.r; r <= Math.min(range.s.r + 20, range.e.r); r++) {
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })];
      if (cell && String(cell.v || '').toLowerCase().trim() === 'override') {
        headerRow = r;
        break;
      }
    }
    if (headerRow >= 0) break;
  }
  if (headerRow < 0) return records;
  const rows = XLSX.utils.sheet_to_json(ws, { raw: true, defval: '', range: headerRow });

  for (const row of rows) {
    const agent = normalizeAgentName(String(row['Agent'] || '').trim());
    const carrierRaw = String(row['Carrier-Statement Month'] || '').trim();
    const client = String(row['Subscriber Name'] || '').trim();
    const policyNumber = String(row['Policy Number'] || '').trim();
    const effectiveDate = formatDate(row['Policy Effective Date']);
    const rawPeriod = row['Commission Month'];
    let period = '';
    if (rawPeriod instanceof Date || (typeof rawPeriod === 'object' && rawPeriod !== null)) {
      const dt = new Date(rawPeriod);
      if (!isNaN(dt)) period = String(dt.getUTCFullYear()) + String(dt.getUTCMonth()+1).padStart(2,'0');
    } else if (typeof rawPeriod === 'number') {
      const s = String(rawPeriod);
      if (s.match(/^\d{8}$/) && parseInt(s.slice(0,4)) > 1900) {
        period = s.slice(0,6);
      } else if (s.match(/^\d{6}$/) && parseInt(s.slice(0,4)) > 1900) {
        period = s;
      } else {
        const dt = new Date((rawPeriod - 25569) * 86400 * 1000);
        if (!isNaN(dt) && dt.getUTCFullYear() < 2100) {
          period = String(dt.getUTCFullYear()) + String(dt.getUTCMonth()+1).padStart(2,'0');
        }
      }
    } else if (typeof rawPeriod === 'string') {
      const s = rawPeriod.trim();
      if (s.match(/^\d{6}$/)) period = s;
      else if (s.match(/^\d{8}$/)) period = s.slice(0,6);
      else if (s.match(/^\d{4}-\d{2}-\d{2}/)) period = s.replace(/-/g,'').slice(0,6);
      else {
        const months = {jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12'};
        const m = s.toLowerCase().match(/^([a-z]{3})/);
        if (m && months[m[1]]) period = new Date().getFullYear() + months[m[1]];
      }
    }
    const nhpType = String(row['Type'] || '').trim();
    const lob = String(row['LOB'] || '').trim();
    const commission = nhpType.toLowerCase().includes('commission')
      ? (parseFloat(row['Commission']) || 0)
      : (parseFloat(row['Override']) || 0);
    if (!client || commission === 0) continue;

    const carrier = normalizeNHPCarrier(carrierRaw);
    const recordType = nhpType.toLowerCase().includes('commission') ? 'Agent Commission' : 'Agency Override';
    const planType = derivePlanType(carrier, '', policyNumber, lob);

    records.push({
      agent: agent || 'Unknown',
      carrier,
      planType,
      client,
      effectiveDate,
      premium: 0,
      commission,
      classification: commission < 0 ? 'Chargeback' : recordType,
      period: period || 'Unknown',
      policyNumber,
      raw: row
    });
  }
  return records;
}

function parseAPLRows(wb) {
  const records = [];
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { defval: '', raw: true });

  for (const row of rows) {
    const payee = String(row['Generated From'] || '').trim();
    const client = String(row['Insured'] || '').trim();
    const agentRaw = String(row['Writing Agent Name'] || '').trim();
    const carrierRaw = String(row['Carrier'] || '').trim();
    const policyNumber = String(row['Policy'] || '').trim();
    const effectiveDate = formatDate(row['Effective Date']);
    const paymentDate = formatDate(row['Payment Date']);
    const payoutType = String(row['Payout Type'] || '').trim();
    const transactionType = String(row['Transaction Type'] || '').trim();
    const commission = parseFloat(row['Amount']) || 0;

    if (!client || commission === 0) continue;

    const carrier = carrierRaw.replace(/[-–].*delegated.*/i, '').replace(/[-–].*direct.*/i, '').trim();
    const normalizedCarrier = carrier.toLowerCase().includes('humana') ? 'Humana'
      : carrier.toLowerCase().includes('aetna') ? 'Aetna'
      : carrier.toLowerCase().includes('united') ? 'UnitedHealthcare'
      : carrier.toLowerCase().includes('cigna') ? 'Cigna'
      : carrier;

    let period = '';
    if (paymentDate) {
      const parts = paymentDate.split('/');
      if (parts.length === 3) period = parts[2] + parts[0].padStart(2,'0');
    }

    const classification = commission < 0 ? 'Chargeback'
      : transactionType.toLowerCase().includes('override') ? 'Agency Override'
      : payoutType.toLowerCase() === 'renewal' ? 'Renewal'
      : payoutType.toLowerCase().includes('new') ? 'New Business'
      : 'Agency Override';

    records.push({
      agent: normalizeAgentName(agentRaw) || 'The Health Experts Insurance',
      carrier: normalizedCarrier,
      planType: derivePlanType(normalizedCarrier, 'MA', policyNumber, ''),
      client,
      effectiveDate,
      premium: 0,
      commission,
      classification,
      period: period || paymentDate,
      policyNumber,
      payee: payee || 'APL',
      raw: row
    });
  }
  return records;
}

function parseSolisRows(wb, filename) {
  const records = [];
  const ws = wb.Sheets[wb.SheetNames[0]];
  const range = XLSX.utils.decode_range(ws['!ref']);

  let headerRow = -1;
  for (let r = range.s.r; r <= Math.min(range.s.r + 10, range.e.r); r++) {
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })];
      if (cell && String(cell.v || '').toLowerCase().includes('member name')) {
        headerRow = r;
        break;
      }
    }
    if (headerRow >= 0) break;
  }
  if (headerRow < 0) return records;

  const rows = XLSX.utils.sheet_to_json(ws, { defval: '', raw: true, range: headerRow });

  for (const row of rows) {
    const client = String(row['Member Name'] || '').trim();
    const agent = normalizeAgentName(String(row['Agent Name'] || '').trim());
    const commission = parseFloat(row['Payment Amt']) || 0;
    const effectiveDate = formatDate(row['Commission Eff. Date'] || row['Member Enrollment Date']);
    const paymentType = String(row['Payment Type'] || '').toLowerCase();
    const policyNumber = String(row['Plan Member ID'] || '').trim();

    if (!client || commission === 0) continue;

    // Solis labels AEP new enrollments as "Renewal Compensation"
    // Override: if eff date is in the current year, it's a new enrollment
    const effRaw = row['Commission Eff. Date'];
    const effYearCheck = effRaw ? new Date(effRaw).getFullYear() : null;
    const currentYear = new Date().getFullYear();
    const isNewEnrollment = effYearCheck && effYearCheck >= currentYear;

    const classification = commission < 0 ? 'Chargeback'
      : paymentType.includes('chargeback') ? 'Chargeback'
      : paymentType.includes('initial') ? 'New Business'
      : isNewEnrollment ? 'New Business'
      : paymentType.includes('renewal') ? 'Renewal'
      : 'Agency Override';
    let period = '';
    if (effRaw) {
      const d = new Date(effRaw);
      if (!isNaN(d)) {
        period = String(d.getFullYear()) + String(d.getMonth() + 1).padStart(2, '0');
      }
    }

    records.push({
      agent: agent || 'The Health Experts Insurance',
      carrier: 'Solis',
      planType: 'Solis Med Adv',
      client,
      effectiveDate,
      premium: 0,
      commission,
      classification,
      period,
      policyNumber,
      payee: 'Solis',
      raw: row
    });
  }
  return records;
}

function normalizeClassification(raw, commission) {
  if (commission < 0) return 'Chargeback';
  const c = String(raw || '').trim().toUpperCase();
  if (c === 'F') return 'New Business';
  if (c === 'R') return 'Renewal';
  if (c === 'NEW' || c === 'NEW BUSINESS') return 'New Business';
  if (c === 'RENEWAL') return 'Renewal';
  if (c === 'ADVANCE') return 'New Business';
  if (c === 'CHARGEBACK') return 'Chargeback';
  if (c === 'AGENT COMMISSION') return 'Agent Commission';
  if (c === 'AGENCY OVERRIDE' || c === 'OVERRIDE') return 'Agency Override';
  return raw ? raw : null;
}

function parseRows(rows, mapping, filename) {
  const carrier = detectCarrierFromFilename(filename);
  return rows.map(row => {
    const agent = normalizeAgentName(mapping.agent ? String(row[mapping.agent] || '').trim() : '');
    const rawPlanType = mapping.planType ? String(row[mapping.planType] || '').trim() : '';
    const policyNumber = mapping.policyNumber ? String(row[mapping.policyNumber] || '').trim() : '';
    const commission = mapping.commission ? parseFloat(row[mapping.commission]) || 0 : 0;
    const rawClass = mapping.classification ? String(row[mapping.classification] || '').trim() : '';
    const agencyType = isAgencyName(agent) ? 'Agent Commission' : 'Agency Override';
    const classification = normalizeClassification(rawClass, commission) || agencyType;
    return {
      agent: agent || 'The Health Experts Insurance',
      carrier,
      planType: derivePlanType(carrier, rawPlanType, policyNumber, ''),
      client: mapping.client ? String(row[mapping.client] || '').trim() : '',
      effectiveDate: mapping.effectiveDate ? formatDate(row[mapping.effectiveDate]) : '',
      premium: mapping.premium ? parseFloat(row[mapping.premium]) || 0 : 0,
      commission,
      classification,
      period: mapping.period ? String(row[mapping.period] || '').trim() : 'Unknown',
      policyNumber,
      raw: row
    };
  }).filter(r => r.commission > 0 || r.premium > 0 || r.client);
}

// ─── Upload route ─────────────────────────────────────────────────────────────

router.post('/upload', requireAuth, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  try {
    const pool = getPool();
    const existing = await pool.query('SELECT id FROM uploads WHERE original_name = $1', [req.file.originalname]);
    if (existing.rows.length > 0) {
      try { fs.unlinkSync(req.file.path); } catch (e) {}
      return res.status(409).json({ error: `"${req.file.originalname}" has already been uploaded. Delete it first.` });
    }

    const wb = XLSX.readFile(req.file.path);
    const ws = wb.Sheets[wb.SheetNames[0]];

    let records;
    const determinePayee = (filename) => {
      const f = filename.toLowerCase();
      if (f.includes('commission_statement_2737247')) return 'UnitedHealthcare';
      if (f.includes('statement-health_experts') || f.includes('statement_health_experts')) return 'BSI';
      if (f.includes('the_health_experts_insurance_statement') || f.includes('the_health_experst_insurance') || (f.includes('yahoska') && f.includes('katy'))) return 'NHP';
      if (f.includes('commission-statement') || f.includes('integrity') || f.includes('apl')) return 'APL';
      if (f.includes('commissions_ledger') || f.includes('solis')) return 'Solis';
      if (f.includes('commissiondata') || f.includes('humana')) return 'Humana';
      if (f.includes('devoted')) return 'Devoted';
      if (f.includes('aetna') || f.includes('producerstatement')) return 'Aetna';
      return 'Direct';
    };
    const defaultPayee = determinePayee(req.file.originalname);

    if (isUHCFile(req.file.originalname)) {
      records = parseUHCRows(wb);
    } else if (isBSIFile(req.file.originalname)) {
      records = parseBSIRows(wb, req.file.originalname);
    } else if (isNHPFile(req.file.originalname)) {
      records = parseNHPRows(wb);
    } else if (isHumanaFile(req.file.originalname)) {
      // Read raw buffer BEFORE XLSX tries to parse — Humana files are SpreadsheetML XML
      const rawBuffer = fs.readFileSync(req.file.path);
      records = parseHumanaRows(wb, req.file.originalname, rawBuffer);
    } else if (isSolisFile(req.file.originalname)) {
      records = parseSolisRows(wb, req.file.originalname);
    } else if (isAPLFile(req.file.originalname)) {
      records = parseAPLRows(wb);
    } else {
      const rows = XLSX.utils.sheet_to_json(ws, { defval: '', raw: true });
      if (!rows.length) return res.status(400).json({ error: 'File is empty' });
      const headers = Object.keys(rows[0]);
      const mapping = await mapColumnsWithAI(headers, rows.slice(0, 3));
      records = parseRows(rows, mapping, req.file.originalname);
    }

    // Apply default payee to records that don't have one set
    records = records.map(r => ({ ...r, payee: r.payee || defaultPayee }));

    if (!records.length) return res.status(400).json({ error: 'No records found in file' });

    const commissionSum = records.reduce((s, r) => s + (r.commission || 0), 0);
    const carriers = [...new Set(records.map(r => r.carrier).filter(Boolean))];

    const uploadResult = await pool.query(
      'INSERT INTO uploads (filename, original_name, carrier, row_count, commission_sum, uploaded_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
      [req.file.filename, req.file.originalname, carriers.join(', '), records.length, commissionSum, req.user.id]
    );
    const uploadId = uploadResult.rows[0].id;

    try { await pool.query(`ALTER TABLE commission_records ADD COLUMN IF NOT EXISTS plan_type TEXT DEFAULT ''`); } catch(e) {}
    try { await pool.query(`ALTER TABLE commission_records ADD COLUMN IF NOT EXISTS payee TEXT DEFAULT ''`); } catch(e) {}

    for (const r of records) {
      await pool.query(
        `INSERT INTO commission_records (upload_id, agent_name, carrier, plan_type, client_full_name, effective_date, premium, commission, classification, payment_period, policy_number, payee, raw_data)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [uploadId, r.agent, r.carrier, r.planType || '', r.client, r.effectiveDate, r.premium || 0, r.commission || 0, r.classification, r.period, r.policyNumber, r.payee || '', JSON.stringify(r.raw)]
      );
    }

    try { fs.unlinkSync(req.file.path); } catch (e) {}

    res.json({ uploadId, filename: req.file.originalname, rowCount: records.length, commissionSum, carriers, preview: records.slice(0, 5) });

  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/uploads', requireAuth, async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.query(`SELECT u.*, usr.name as uploaded_by_name FROM uploads u LEFT JOIN users usr ON u.uploaded_by = usr.id ORDER BY u.uploaded_at DESC`);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/uploads/:id', requireAuth, async (req, res) => {
  try {
    const pool = getPool();
    await pool.query('DELETE FROM uploads WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── AI column mapping ────────────────────────────────────────────────────────

async function mapColumnsWithAI(headers, sample) {
  try {
    const prompt = `You are parsing an insurance carrier commission statement Excel file.
Column headers found: ${headers.join(', ')}
Sample row: ${JSON.stringify(sample[0])}
Map these columns to our schema. Respond ONLY with valid JSON, no markdown:
{"agent":"column name or null","carrier":"column name or null","client":"column name or null","effectiveDate":"column name or null","premium":"column name or null","commission":"column name required","classification":"column name or null","period":"column name or null","policyNumber":"column name or null","planType":"column name for plan type/product type or null"}`;

    const msg = await anthropic.messages.create({ model: 'claude-opus-4-5', max_tokens: 500, messages: [{ role: 'user', content: prompt }] });
    const text = msg.content[0].text.replace(/```json|```/g, '').trim();
    return JSON.parse(text);
  } catch (e) {
    console.error('AI mapping failed:', e.message);
    return heuristicMapping(headers);
  }
}

function heuristicMapping(headers) {
  const h = headers.map(x => x.toLowerCase());
  const find = (terms) => headers[h.findIndex(x => terms.some(t => x.includes(t)))] || null;
  return {
    agent: find(['writing agent', 'agent', 'producer', 'rep']),
    carrier: find(['carrier', 'company', 'insurer', 'plan']),
    client: find(['member', 'client', 'subscriber', 'insured', 'name']),
    effectiveDate: find(['effective', 'eff date', 'policy date', 'start']),
    premium: find(['prem', 'premium', 'modal', 'annualized']),
    commission: find(['commission', 'payment', 'amount', 'earned', 'comp']),
    classification: find(['action', 'type', 'class', 'category', 'renewal']),
    period: find(['payment period', 'period', 'month', 'statement']),
    policyNumber: find(['policy', 'member id', 'contract', 'certificate']),
    planType: find(['plan type', 'product', 'line', 'benefit'])
  };
}

module.exports = router;
