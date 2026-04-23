const express = require('express');
const router = express.Router();
const multer = require('multer');
const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');
const Anthropic = require('@anthropic-ai/sdk');
const { getPool } = require('../db/database');
const { requireAuth } = require('./auth');
const { normalizeAgentName } = require('./normalize');
let pdfParse;
try { pdfParse = require('pdf-parse'); } catch(e) { console.log('pdf-parse not installed'); }

const UPLOADS_DIR = path.join('/tmp', 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: UPLOADS_DIR,
  filename: (req, file, cb) => cb(null, `${Date.now()}_${file.originalname.replace(/\s+/g, '_')}`)
});
const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /\.(xlsx|xls|csv|pdf)$/i;
    cb(null, allowed.test(file.originalname));
  }
});
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─── BSI split rules ──────────────────────────────────────────────────────────
const NO_SPLIT_AGENTS = ['patsy pernia', 'josseline silber', 'jessica sifontes', 'eduardo pernia'];
const ACA_CARRIERS_LIST = ['oscar health', 'oscar', 'cigna', 'florida blue', 'ambetter'];
function shouldSplit(agentName, carrier) {
  const agent = String(agentName || '').toLowerCase().trim();
  const car = String(carrier || '').toLowerCase().trim();
  if (NO_SPLIT_AGENTS.some(a => agent.includes(a))) return false;
  if (ACA_CARRIERS_LIST.some(c => car.includes(c))) return false;
  return true;
}

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
  if (carrier === 'Mutual of Omaha') return 'Mutual of Omaha Life';
  if (carrier === 'United of Omaha') return 'United of Omaha Life';

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
  if (f.includes('avmed') || f.includes('av_med')) return 'AvMed';
  if (f.includes('doctors') || f.includes('doctor_')) return 'Doctors';
  if (f.includes('contracts_commissionstatements') || f.includes('contracts_commission')) return 'AvMed';
  if (f.includes('moo') || f.includes('mutual_of_omaha') || f.includes('mutualomaha')) return 'Mutual of Omaha';
  return 'Unknown';
}

function isUHCFile(filename) {
  return filename.toLowerCase().replace(/\s+/g, '_').includes('commission_statement_2737247');
}
function isBSIFile(filename) {
  const f = filename.toLowerCase().replace(/\s+/g, '_');
  return f.includes('statement-health_experts') || f.includes('statement_health_experts');
}
function isMOOExcel(filename) {
  const f = filename.toLowerCase();
  return (f.includes('moo') || f.includes('mutual_of_omaha') || f.includes('mutualomaha') || f.includes('moo_statement'))
    && (f.endsWith('.xlsx') || f.endsWith('.xls'));
}

// Prod Num → Agent Name lookup built from MOO statements
const MOO_PROD_NAMES = {
  '968819':  'Yasser Fermin',
  '970159':  'Yamile Dominguez',
  '976782':  'Niurllys Carrera',
  '1058350': 'Eric Del Valle',
  '1070848': 'Mohamed Ali Elbially',
  '1075989': 'Nanette Rosabal-Hernandez',
  '1082299': 'Miguel Osle',
  '1089121': 'Sebastian Quintero',
  '1091926': 'Jose Balboa',
  '1101147': 'Alison Torrez',
  '1119656': 'Aldo Marchant',
  '1120105': 'Alonso Ayllon',
  '1141855': 'Cory Abbondandolo',
  '1167747': 'Francisco Duran',
  '1177474': 'Zoila Linares',
  '1177514': 'Timothy Brittan',
  '1177570': 'Leonardo Aguilar',
  '1179563': 'Kevin Gonzalez',
  '1185706': 'Nora Zamora Rivera',
  '1186104': 'Joan Cabrera',
  '1198664': 'Leandro Garriga',
  '1201698': 'Jorge Eduardo Arce Sarmiento',
  '1204216': 'Michael Zeno',
  '1204800': 'Ricardo Rodriguez',
  '1226393': 'Juan Gomez',
  '1228343': 'Jose Rojo Irizarry',
  '1250189': 'Ana Diaz',
  '1261361': 'Bryan Hernandez',
};

function parseMOOExcelRows(wb, filename) {
  const records = [];
  try {
    // Use DETAILS sheet if available, otherwise first sheet
    const sheetName = wb.SheetNames.find(s => s.toUpperCase() === 'DETAILS') || wb.SheetNames[0];
    const ws = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(ws, { defval: '', raw: true });
    if (!rows.length) return records;

    // Extract period from filename e.g. MOO_STATEMENT_1.xlsx → try activity date
    let period = '';
    const fnMatch = filename.match(/(20\d{2})(0[1-9]|1[0-2])/);
    if (fnMatch) period = fnMatch[1] + fnMatch[2];

    for (const row of rows) {
      const commAmt = parseFloat(row['Comm Amt']) || 0;
      if (commAmt === 0) continue; // skip held/unpaid records

      const prodNum = String(row['Prod Num'] || '').trim().replace(/^0+/, '');
      const agentName = MOO_PROD_NAMES[prodNum] || MOO_PROD_NAMES[String(row['Prod Num']).trim()] || `Producer ${String(row['Prod Num']).trim()}`;
      const clientRaw = String(row['Insureds Name'] || '').trim();
      // Convert "LAST FIRST" all-caps → "First Last"
      const clientName = clientRaw === clientRaw.toUpperCase() && clientRaw.length > 2
        ? clientRaw.toLowerCase().replace(/\b\w/g, c => c.toUpperCase())
        : clientRaw;

      const company = String(row['Company'] || '').trim();
      const carrier = company.toUpperCase() === 'MUTUAL' ? 'Mutual of Omaha' : 'United of Omaha';
      const policyNumber = String(row['Policy'] || '').trim();
      const activityDate = String(row['Activity Date'] || '').trim();
      const issueDate = String(row['Issue Date'] || '').trim();
      const effectiveDate = issueDate || activityDate;
      const activityType = String(row['Activity Type'] || '').trim().toUpperCase();
      const mga = String(row['MGA Name'] || '').trim();

      // Period from activity date MM/DD/YYYY → YYYYMM
      if (!period && activityDate.match(/\d{2}\/\d{2}\/\d{4}/)) {
        const parts = activityDate.split('/');
        period = parts[2] + parts[0];
      }

      const classification = commAmt < 0 ? 'Chargeback'
        : activityType.includes('NEW COV ISS') || activityType.includes('NEW ISS') || activityType.includes('REISS') ? 'New Business'
        : activityType.includes('BFY PAYMENT') ? 'Renewal'
        : activityType.includes('REVERSAL') || activityType.includes('LAPSE') ? 'Chargeback'
        : 'Renewal';

      records.push({
        agent: agentName,
        carrier,
        planType: carrier === 'Mutual of Omaha' ? 'Mutual of Omaha Life' : 'United of Omaha Life',
        client: clientName,
        effectiveDate: formatDate(effectiveDate),
        premium: parseFloat(row['Comm Premium']) || 0,
        commission: commAmt,
        classification,
        period,
        policyNumber,
        payee: 'Mutual of Omaha',
        mga: mga || 'Brokers Alliance',
        raw: row
      });
    }
  } catch (err) {
    console.error('parseMOOExcelRows error:', err.message);
  }
  return records;
}

function isDoctorsFile(filename) {
  const f = filename.toLowerCase().replace(/['\s()]/g, '_');
  return f.includes('doctor') || f.startsWith('drs') || f.startsWith('dr_s') || f.includes('dr_s_katy') || f.includes('dr_s_');
}
function isSolisFile(filename) {
  const f = filename.toLowerCase().replace(/['\s()]/g, '_');
  if (isDoctorsFile(filename)) return false; // Doctors files take priority
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
  return (f.includes('commissiondata') || f.includes('yahoska_perez_med_comm') || f.includes('humana'))
    && !f.includes('yourfmo') && !f.endsWith('.pdf');
}
function isYourFMOFile(filename) {
  const f = filename.toLowerCase().replace(/\s+/g, '_');
  return f.includes('yourfmo') && !f.endsWith('.pdf');
}
function isHumanaPDF(filename) {
  const f = filename.toLowerCase();
  return f.endsWith('.pdf') && (f.includes('humana') || f.includes('commissionstatement') || f.includes('yourfmo'));
}
function isYourFMOXLSX(filename) {
  const f = filename.toLowerCase().replace(/\s+/g, '_');
  return f.includes('commissions_commissiondetails') || f.includes('commissiondetails_88892');
}

// ─── NEW: Mutual of Omaha PDF detector ───────────────────────────────────────
function isMutualOmahaPDF(filename) {
  const f = filename.toLowerCase();
  return f.endsWith('.pdf') && (
    f.includes('moo') ||
    f.includes('mutual') ||
    f.includes('mutual_of_omaha') ||
    f.includes('mutualomaha')
  );
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

// ─── Period normalization ─────────────────────────────────────────────────────
// Converts any period value to YYYYMM format, handles Excel serial dates
function normalizePeriod(value) {
  if (!value && value !== 0) return 'Unknown';
  const s = String(value).trim();

  // Already YYYYMM
  if (s.match(/^\d{6}$/) && parseInt(s.slice(0,4)) > 1900) return s;

  // Already YYYYMMDD → take YYYYMM
  if (s.match(/^\d{8}$/) && parseInt(s.slice(0,4)) > 1900) return s.slice(0,6);

  // MM/DD/YYYY or M/D/YYYY
  const mdy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdy) return mdy[3] + mdy[1].padStart(2,'0');

  // YYYY-MM-DD
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return iso[1] + iso[2];

  // Excel serial number (e.g. 46127 or 46127.25)
  const num = parseFloat(s);
  if (!isNaN(num) && num > 40000 && num < 60000) {
    const date = new Date((num - 25569) * 86400 * 1000);
    if (!isNaN(date.getTime()) && date.getUTCFullYear() > 1990 && date.getUTCFullYear() < 2100) {
      return String(date.getUTCFullYear()) + String(date.getUTCMonth()+1).padStart(2,'0');
    }
  }

  return 'Unknown';
}



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

function parseHumanaRows(wb, filename, rawBuffer) {
  const records = [];

  try {
    if (!rawBuffer) {
      console.error('parseHumanaRows: no rawBuffer provided');
      return records;
    }

    const content = rawBuffer.toString('utf-8');
    const fixedXml = content.replace('<xml version>', '<?xml version="1.0"?>');

    const monthMap = {
      jan:'01', feb:'02', mar:'03', apr:'04', may:'05', jun:'06',
      jul:'07', aug:'08', sep:'09', oct:'10', nov:'11', dec:'12'
    };

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
      const commRunDt  = get(commRunIdx).trim();
      const blkBus     = get(blkBusIdx).trim().toUpperCase();
      const product    = get(productIdx).trim().toUpperCase();

      if (!client || commission === 0) continue;

      let period = '';
      if (monthPaid && monthMap[monthPaid] && commRunDt) {
        const yearMatch = commRunDt.match(/^(\d{4})/);
        const year = yearMatch ? yearMatch[1] : new Date().getFullYear().toString();
        period = year + monthMap[monthPaid];
      }

      let effectiveDate = '';
      const em = effDateRaw.match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (em) effectiveDate = `${em[2]}/${em[3]}/${em[1]}`;

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
    const period = normalizePeriod(rawPeriod);
    const nhpType = String(row['Type'] || '').trim();
    const lob = String(row['LOB'] || '').trim();
    const commission = nhpType.toLowerCase().includes('commission')
      ? (parseFloat(row['Commission']) || 0)
      : (parseFloat(row['Override']) || 0);
    if (!client || commission === 0) continue;

    const carrier = normalizeNHPCarrier(carrierRaw);
    const recordType = nhpType.toLowerCase().includes('commission') ? 'Agent Commission' : 'Agency Override';
    const planType = derivePlanType(carrier, '', policyNumber, lob);

    const nhpNet = shouldSplit(agent || '', carrier) ? Math.round(commission * 0.5 * 100) / 100 : commission;
    records.push({
      agent: agent || 'Unknown',
      carrier,
      planType,
      client,
      effectiveDate,
      premium: 0,
      commission: nhpNet,
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

    const period = normalizePeriod(row['Payment Date'] || paymentDate);

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
      period: period,
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

    const isDoctor = isDoctorsFile(filename);
    const carrierName = isDoctor ? 'Doctors' : 'Solis';
    const planTypeName = isDoctor ? 'Doctors Med Adv' : 'Solis Med Adv';
    const solisNet = shouldSplit(agent, carrierName) ? Math.round(commission * 0.5 * 100) / 100 : commission;
    records.push({
      agent: agent || 'The Health Experts Insurance',
      carrier: carrierName,
      planType: planTypeName,
      client,
      effectiveDate,
      premium: 0,
      commission: solisNet,
      classification,
      period,
      policyNumber,
      payee: isDoctor ? 'Doctors' : 'Solis',
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

// ─── Humana PDF parser ───────────────────────────────────────────────────────
async function parseHumanaPDF(filePath, filename) {
  const records = [];
  try {
    const dataBuffer = fs.readFileSync(filePath);
    const data = await pdfParse(dataBuffer);
    const text = data.text;
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

    const dateMatch = text.match(/Statement Date:\s*(\d{2})\/(\d{2})\/(\d{4})/);
    let period = dateMatch ? dateMatch[3] + dateMatch[1] : '';

    let agentName = 'The Health Experts Insurance';
    for (const line of lines) {
      if (line.includes('Agent Number:') || line.includes('NPN:')) {
        const m = line.match(/^([A-Za-z\s\.]+?)\s*\(/);
        if (m) agentName = normalizeAgentName(m[1].trim()) || agentName;
        break;
      }
    }

    let section = '';
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (['NEW BUSINESS', 'RENEWAL BUSINESS', 'ADJUSTMENT'].includes(line)) {
        section = line;
        continue;
      }
      if (!line.match(/^\d{11,}/)) continue;

      const policyMatch = line.match(/^(\d{11,}[A-Z_]*)/);
      const policyFull = policyMatch ? policyMatch[1] : '';
      const policyNumber = policyFull.split('_')[0];
      const isOverride = /override/i.test(line);
      const isAdjustment = /adjustment/i.test(line);
      const context = lines.slice(i, i + 5).join(' ');
      const isHRA = /HRA|BONUS/i.test(context);

      const afterPolicy = line.slice(policyFull.length).trim();
      const clientMatch = afterPolicy.match(/^([A-Za-z\s,\.]+?)\s+(Override|Adjustment|New Business|Renewal)/i);
      const client = clientMatch ? clientMatch[1].trim() : afterPolicy.split(/\s{2,}/)[0].trim();

      const dates = line.match(/(\d{2}\/\d{2}\/\d{4})/g) || [];
      const effectiveDate = dates[1] || dates[0] || '';

      const amountsRaw = line.match(/\(?\$[\d,]+\.\d{2}\)?/g) || [];
      if (!amountsRaw.length) continue;
      const lastAmt = amountsRaw[amountsRaw.length - 1];
      const isNegative = lastAmt.startsWith('(');
      let commission = parseFloat(lastAmt.replace(/[($,)]/g, ''));
      if (isNegative) commission = -commission;
      if (commission === 0) continue;

      let classification;
      if (isHRA) classification = 'HRA/Bonus';
      else if (commission < 0) classification = 'Chargeback';
      else if (isAdjustment) classification = 'Agent Commission';
      else if (section === 'NEW BUSINESS') classification = 'New Business';
      else if (section === 'RENEWAL BUSINESS') classification = 'Renewal';
      else if (isOverride) classification = 'Agency Override';
      else classification = 'Agent Commission';

      records.push({
        agent: agentName, carrier: 'Humana', planType: 'Humana Med Adv',
        client, effectiveDate, premium: 0, commission, classification,
        period, policyNumber,
        payee: filename.toLowerCase().includes('yourfmo') ? 'YourFMO' : 'Humana',
        raw: {}
      });
    }
  } catch(err) { console.error('parseHumanaPDF error:', err.message); }
  return records;
}

// ─── Mutual of Omaha PDF parser ──────────────────────────────────────────────
async function parseMutualOmahaPDF(filePath, filename) {
  const records = [];
  if (!pdfParse) { console.error('pdf-parse not installed'); return records; }
  try {
    const dataBuffer = fs.readFileSync(filePath);
    const data = await pdfParse(dataBuffer);
    const text = data.text;

    const periodMatch = text.match(/For\s*Period\s*Ending\s*\n?\s*(\d{2})\/(\d{2})\/(\d{4})/);
    const period = periodMatch ? periodMatch[3] + periodMatch[1] : '';
    console.log('[MOO] period:', period);

    const mgaMatch = text.match(/MGA:\s+([A-Z][A-Z\s]+?)(?:\s{3,}|PRODUCTION)/);
    const currentMGA = mgaMatch ? mgaMatch[1].trim() : 'Brokers Alliance';
    console.log('[MOO] MGA:', currentMGA);

    const chunks = text.split(/PRODUCTION\s*#:\s*\d+/);
    console.log('[MOO] producer chunks:', chunks.length - 1);

    for (let ci = 1; ci < chunks.length; ci++) {
      const chunk = chunks[ci];

      const nameMatch = chunk.match(/NAME:\s*([A-Z][A-Z\s\-\.]+?)(?:\s{3,}|M\s+A\s+O|POLICY\s+INSURED)/);
      const agentName = nameMatch
        ? nameMatch[1].trim().replace(/\b\w/g, c => c.toUpperCase())
        : 'Unknown';

      // Sum ALL PRODUCER COMMISSION PAYABLE amounts in this producer chunk.
      // A producer can have separate Mutual + United sections each with their own payable line.
      // Only skip if the grand total across ALL sections is zero.
      if (chunk.includes('PRODUCER COMMISSION PAYABLE')) {
        const payRegex = /PRODUCER COMMISSION PAYABLE[\s\S]{0,60}\$([\d,]+\.\d{2})/g;
        const payMatches = Array.from(chunk.matchAll(payRegex));
        if (payMatches.length > 0) {
          const totalPayable = payMatches.reduce((sum, m) => sum + parseFloat(m[1].replace(/,/g, '')), 0);
          if (totalPayable === 0) {
            console.log('[MOO] skip $0 total:', agentName);
            continue;
          }
        } else {
          // No numeric match — check if there is ANY non-zero payable
          const hasNonZero = /PRODUCER COMMISSION PAYABLE[\s\S]{0,60}\$[1-9]/.test(chunk);
          if (!hasNonZero) {
            console.log('[MOO] skip all $.00:', agentName);
            continue;
          }
        }
      }

      const policyRegex = /(BU\d{7,}|\d{6}-\d{2})\s+([A-Z][A-Z\s,\.]+?)\s{2,}([A-Z]{2})\s+(\d{2}\/\d{2}\/\d{4})\s+\S+\s+(\d{2}\/\d{2}\/\d{4})\s+(\d{2}\/\d{2}\/\d{4})/g;
      let pm;
      while ((pm = policyRegex.exec(chunk)) !== null) {
        const policyNumber = pm[1];
        const clientRaw = pm[2].trim();
        const effectiveDate = pm[5] || pm[4] || '';
        const isUnited = policyNumber.startsWith('BU');
        const lineCarrier = isUnited ? 'United of Omaha' : 'Mutual of Omaha';

        const clientName = clientRaw.includes(',')
          ? clientRaw.split(',').reverse().map(p => p.trim()).join(' ')
          : clientRaw;

        const seg = chunk.slice(pm.index + pm[0].length, pm.index + pm[0].length + 300);
        const dollars = seg.match(/\$[\d,]*\.\d{2}/g) || [];

        let commission = 0;
        if (dollars.length >= 2) {
          commission = parseFloat(dollars[dollars.length - 2].replace(/[\$,]/g, ''));
        } else if (dollars.length === 1) {
          commission = parseFloat(dollars[0].replace(/[\$,]/g, ''));
        }
        if (seg.match(/[\d,]+\.\d{2}-/)) commission = -Math.abs(commission);
        if (commission === 0) continue;

        const activity = seg.includes('NEW COV ISS') ? 'New Business'
          : seg.includes('NEW ISS') ? 'New Business'
          : seg.includes('REISS') ? 'New Business'
          : seg.includes('BFY PAYMENT') ? 'Renewal'
          : seg.includes('REVERSAL') ? 'Chargeback'
          : seg.includes('LAPSE') ? 'Chargeback'
          : commission < 0 ? 'Chargeback'
          : 'Renewal';

        console.log('[MOO]', agentName, '|', clientName, '|', policyNumber, '|', commission, '|', activity);

        records.push({
          agent: agentName,
          carrier: lineCarrier,
          planType: lineCarrier === 'Mutual of Omaha' ? 'Mutual of Omaha Life' : 'United of Omaha Life',
          client: clientName,
          effectiveDate,
          premium: 0,
          commission,
          classification: activity,
          period,
          policyNumber,
          payee: 'Mutual of Omaha',
          mga: currentMGA,
          raw: {}
        });
      }
    }
    console.log('[MOO] total records:', records.length);
  } catch(err) { console.error('parseMutualOmahaPDF error:', err.message); }
  return records;
}


// ─── YourFMO Excel parser ────────────────────────────────────────────────────
function parseYourFMORows(wb, filename) {
  const records = [];
  try {
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: true });
    const headerStr = String(rows[0]?.[0] || '');
    const dateMatch = headerStr.match(/Statement Date:\s*(\d{2})\/(\d{2})\/(\d{4})/);
    let period = dateMatch ? dateMatch[3] + dateMatch[1] : '';
    let agentName = 'The Health Experts Insurance';
    for (const row of rows) {
      const cell = String(row[0] || '');
      if (cell.includes('Agent Number:') || cell.includes('NPN:')) {
        const m = cell.match(/^([A-Za-z\s]+?)\s*\(/);
        if (m) agentName = normalizeAgentName(m[1].trim()) || agentName;
        break;
      }
    }
    for (const row of rows) {
      const cell0 = String(row[0] || '').trim();
      const cell1 = String(row[1] || '').trim();
      if (!cell0.match(/^\d{11,}/)) continue;
      const parts0 = cell0.split(/\s{2,}/);
      const policyNumber = (parts0[0] || '').split('_')[0].trim();
      const client = parts0[1] || '';
      const transType = parts0[2] || '';
      const dateMatches = cell1.match(/(\d{2}\/\d{2}\/\d{4})/g) || [];
      const effectiveDate = dateMatches[1] || dateMatches[0] || '';
      const amounts = cell1.match(/\$([\d,]+\.\d{2})/g) || [];
      const commission = amounts.length ? parseFloat(amounts[0].replace(/[$,]/g,'')) : 0;
      if (!client || commission === 0) continue;
      const isHRA = /HRA|BONUS/i.test(cell0);
      const classification = isHRA ? 'HRA/Bonus'
        : commission < 0 ? 'Chargeback'
        : transType.toLowerCase().includes('adjustment') ? 'Agent Commission'
        : transType.toLowerCase().includes('new') ? 'New Business'
        : transType.toLowerCase().includes('renewal') ? 'Renewal'
        : 'Agent Commission';
      records.push({
        agent: agentName, carrier: 'Humana', planType: 'Humana Med Adv',
        client: client.trim(), effectiveDate, premium: 0, commission,
        classification, period, policyNumber, payee: 'YourFMO', raw: {}
      });
    }
  } catch(err) { console.error('parseYourFMORows error:', err.message); }
  return records;
}

function parseYourFMOXLSXRows(wb) {
  const records = [];
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { defval: '', raw: true });
  if (!rows.length) return records;
  for (const row of rows) {
    const client    = String(row['Insured Name'] || '').trim();
    const agentRaw  = String(row['Writing Agent'] || '').trim();
    const commission= parseFloat(row['Commission ($)']) || 0;
    const policyNum = String(row['Policy #'] || row['Carrier Policy ID'] || '').trim().split('_')[0];
    const fyr       = String(row['First Year/Renewal'] || '').trim();
    const commType  = String(row['Commission Type'] || '').trim();
    const carrier   = String(row['Carrier'] || 'Humana').trim();
    if (!client || commission === 0) continue;
    let period = '';
    const stmtDate = row['Statement Date'];
    if (stmtDate) {
      const d = new Date(stmtDate);
      if (!isNaN(d)) period = String(d.getFullYear()) + String(d.getMonth()+1).padStart(2,'0');
    }
    const effectiveDate = formatDate(row['Effective Date']);
    const classification = commission < 0 ? 'Chargeback'
      : fyr === 'First Year' ? 'New Business'
      : fyr === 'Renewal Year' ? 'Renewal'
      : commType.toLowerCase().includes('override') ? 'Agency Override'
      : 'Agent Commission';
    const carrierNorm = carrier.toLowerCase().includes('humana') ? 'Humana'
      : carrier.toLowerCase().includes('united') ? 'UnitedHealthcare'
      : carrier.toLowerCase().includes('aetna') ? 'Aetna'
      : carrier;
    records.push({
      agent: normalizeAgentName(agentRaw) || 'The Health Experts Insurance',
      carrier: carrierNorm,
      planType: derivePlanType(carrierNorm, '', policyNum, ''),
      client, effectiveDate, premium: 0, commission, classification,
      period, policyNumber: policyNum, payee: 'YourFMO', raw: row
    });
  }
  return records;
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

    const determinePayee = (filename) => {
      const f = filename.toLowerCase();
      if (f.includes('commission_statement_2737247')) return 'UnitedHealthcare';
      if (f.includes('statement-health_experts') || f.includes('statement_health_experts')) return 'BSI';
      if (f.includes('the_health_experts_insurance_statement') || f.includes('the_health_experst_insurance') || (f.includes('yahoska') && f.includes('katy'))) return 'NHP';
      if (f.includes('commission-statement') || f.includes('integrity') || f.includes('apl')) return 'APL';
      if (f.includes('commissions_ledger') || f.includes('solis')) return 'Solis';
      if (f.includes('moo') || f.includes('mutual')) return 'Mutual of Omaha';
      if (f.includes('yourfmo') || f.includes('commissiondetails')) return 'YourFMO';
      if (f.includes('commissiondata') || f.includes('humana')) return 'Humana';
      if (f.includes('devoted')) return 'Devoted';
      if (f.includes('aetna') || f.includes('producerstatement')) return 'Aetna';
      return 'Direct';
    };
    const defaultPayee = determinePayee(req.file.originalname);

    let records;

    if (isMOOExcel(req.file.originalname)) {
      const wb = XLSX.readFile(req.file.path);
      records = parseMOOExcelRows(wb, req.file.originalname);
      if (!records.length) {
        try { fs.unlinkSync(req.file.path); } catch(e) {}
        return res.status(400).json({ error: 'No payable records found in MOO Excel statement.' });
      }
    } else if (isMutualOmahaPDF(req.file.originalname)) {
      if (!pdfParse) {
        try { fs.unlinkSync(req.file.path); } catch(e) {}
        return res.status(500).json({ error: 'PDF parsing not available on server.' });
      }
      records = await parseMutualOmahaPDF(req.file.path, req.file.originalname);
      if (!records.length) {
        try { fs.unlinkSync(req.file.path); } catch(e) {}
        return res.status(400).json({ error: 'No records found in PDF. Verify this is a Mutual of Omaha commission statement.' });
      }
    } else if (isHumanaPDF(req.file.originalname)) {
      if (!pdfParse) {
        try { fs.unlinkSync(req.file.path); } catch(e) {}
        return res.status(500).json({ error: 'PDF parsing not available on server.' });
      }
      records = await parseHumanaPDF(req.file.path, req.file.originalname);
      if (!records.length) {
        try { fs.unlinkSync(req.file.path); } catch(e) {}
        return res.status(400).json({ error: 'No records found in PDF.' });
      }
    } else {
      const wb = XLSX.readFile(req.file.path);
      const ws = wb.Sheets[wb.SheetNames[0]];
      if (isYourFMOXLSX(req.file.originalname)) {
        records = parseYourFMOXLSXRows(wb);
      } else if (isUHCFile(req.file.originalname)) {
        records = parseUHCRows(wb);
      } else if (isBSIFile(req.file.originalname)) {
        records = parseBSIRows(wb, req.file.originalname);
      } else if (isNHPFile(req.file.originalname)) {
        records = parseNHPRows(wb);
      } else if (isYourFMOFile(req.file.originalname)) {
        records = parseYourFMORows(wb, req.file.originalname);
      } else if (isHumanaFile(req.file.originalname)) {
        const rawBuffer = fs.readFileSync(req.file.path);
        records = parseHumanaRows(wb, req.file.originalname, rawBuffer);
      } else if (isDoctorsFile(req.file.originalname)) {
        records = parseSolisRows(wb, req.file.originalname);
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
    }

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
    try { await pool.query(`ALTER TABLE commission_records ADD COLUMN IF NOT EXISTS mga TEXT DEFAULT ''`); } catch(e) {}
    try { await pool.query(`ALTER TABLE commission_records ADD COLUMN IF NOT EXISTS payee TEXT DEFAULT ''`); } catch(e) {}

    for (const r of records) {
      await pool.query(
        `INSERT INTO commission_records (upload_id, agent_name, carrier, plan_type, client_full_name, effective_date, premium, commission, classification, payment_period, policy_number, payee, mga, raw_data)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [uploadId, r.agent, r.carrier, r.planType || '', r.client, r.effectiveDate, r.premium || 0, r.commission || 0, r.classification, r.period, r.policyNumber, r.payee || '', r.mga || '', JSON.stringify(r.raw)]
      );
    }

    try { fs.unlinkSync(req.file.path); } catch (e) {}
    res.json({ uploadId, filename: req.file.originalname, rowCount: records.length, commissionSum, carriers, preview: records.slice(0, 5) });

  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: err.message });
  }
});

function getAgency(req) {
  if (req.user.role !== 'admin') return null;
  const override = req.headers['x-agency-override'];
  if (override !== undefined) return override || null;
  return req.user.agency || null;
}

router.get('/uploads', requireAuth, async (req, res) => {
  try {
    const pool = getPool();
    const agency = getAgency(req);
    let query, params = [];
    if (req.user.role === 'agent') {
      query = `SELECT u.*, usr.name as uploaded_by_name FROM uploads u LEFT JOIN users usr ON u.uploaded_by = usr.id WHERE u.uploaded_by = $1 ORDER BY u.uploaded_at DESC`;
      params = [req.user.id];
    } else if (agency) {
      const isBSI = agency.toLowerCase().includes('broker society');
      const bsiCarriers = ['Mutual of Omaha','United of Omaha','Fidelity Life','Instabrain','F&G','Fidelity & Guaranty','American Amicable','Transamerica','Ethos','American Home Life','National Life Group'];
      const carrierClause = isBSI
        ? `carrier = ANY($1)`
        : `carrier != ALL($1)`;
      query = `SELECT DISTINCT u.*, usr.name as uploaded_by_name FROM uploads u LEFT JOIN users usr ON u.uploaded_by = usr.id WHERE u.id IN (SELECT DISTINCT upload_id FROM commission_records WHERE ${carrierClause}) ORDER BY u.uploaded_at DESC`;
      params = [bsiCarriers];
    } else {
      query = `SELECT u.*, usr.name as uploaded_by_name FROM uploads u LEFT JOIN users usr ON u.uploaded_by = usr.id ORDER BY u.uploaded_at DESC`;
    }
    const result = await pool.query(query, params);
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


// ─── Fix bad period values in DB ─────────────────────────────────────────────
router.post('/fix-periods', requireAuth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  try {
    const pool = getPool();
    // Get ALL records with non-YYYYMM periods including empty, null, 0, epoch-based
    const records = await pool.query(
      `SELECT id, payment_period, effective_date, created_at 
       FROM commission_records 
       WHERE payment_period IS NULL 
          OR payment_period = '' 
          OR payment_period = '0'
          OR payment_period = 'Unknown'
          OR NOT (payment_period ~ '^[0-9]{6}$')`
    );
    let fixed = 0, skipped = 0;
    for (const r of records.rows) {
      let cleaned = normalizePeriod(r.payment_period);
      // If still unknown, try to derive from effective_date or created_at
      if (cleaned === 'Unknown' || cleaned === '197001') {
        if (r.effective_date && r.effective_date.match(/\d{2}\/\d{2}\/\d{4}/)) {
          const parts = r.effective_date.split('/');
          cleaned = parts[2] + parts[0].padStart(2,'0');
        } else if (r.created_at) {
          const d = new Date(r.created_at);
          cleaned = String(d.getFullYear()) + String(d.getMonth()+1).padStart(2,'0');
        }
      }
      if (cleaned && cleaned !== 'Unknown' && cleaned !== r.payment_period) {
        await pool.query('UPDATE commission_records SET payment_period = $1 WHERE id = $2', [cleaned, r.id]);
        fixed++;
      } else {
        skipped++;
      }
    }
    res.json({ success: true, fixed, skipped, total: records.rows.length, message: `Fixed ${fixed} bad period records.` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Retroactive BSI split migration ─────────────────────────────────────────
router.post('/apply-bsi-split', requireAuth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  try {
    const pool = getPool();
    await pool.query(`ALTER TABLE commission_records ADD COLUMN IF NOT EXISTS bsi_split_applied BOOLEAN DEFAULT FALSE`).catch(() => {});

    const records = await pool.query(`
      SELECT cr.id, cr.agent_name, cr.carrier, cr.commission, u.original_name
      FROM commission_records cr
      JOIN uploads u ON cr.upload_id = u.id
      WHERE (
        u.original_name ILIKE '%solis%' OR
        u.original_name ILIKE '%commissions_ledger%' OR
        u.original_name ILIKE '%doctor%' OR
        u.original_name ILIKE '%the_health_experts_insurance_statement%' OR
        u.original_name ILIKE '%yahoska%katy%' OR
        u.original_name ILIKE '%nhp%'
      )
      AND (bsi_split_applied IS NULL OR bsi_split_applied = FALSE)
      AND commission > 0
    `);

    const NO_SPLIT = ['patsy pernia', 'josseline silber', 'jessica sifontes', 'eduardo pernia'];
    const ACA = ['oscar health', 'oscar', 'cigna', 'florida blue', 'ambetter'];
    let updated = 0, skipped = 0;

    for (const r of records.rows) {
      const agent = String(r.agent_name || '').toLowerCase();
      const carrier = String(r.carrier || '').toLowerCase();
      const isNoSplit = NO_SPLIT.some(a => agent.includes(a));
      const isACA = ACA.some(c => carrier.includes(c));

      if (!isNoSplit && !isACA) {
        const net = Math.round(r.commission * 0.5 * 100) / 100;
        await pool.query(
          `UPDATE commission_records SET commission = $1, bsi_split_applied = TRUE WHERE id = $2`,
          [net, r.id]
        );
        updated++;
      } else {
        await pool.query(`UPDATE commission_records SET bsi_split_applied = TRUE WHERE id = $1`, [r.id]);
        skipped++;
      }
    }

    res.json({ success: true, updated, skipped, message: `Applied 50% BSI split to ${updated} records. Skipped ${skipped} (ACA or no-split agents).` });
  } catch (err) {
    console.error('BSI split migration error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
