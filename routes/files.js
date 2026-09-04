const express = require('express');
const router = express.Router();
const multer = require('multer');
const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');
const Anthropic = require('@anthropic-ai/sdk');
const { getPool } = require('../db/database');
const { requireAuth, requireAdmin } = require('./auth');
const { normalizeAgentName } = require('./normalize');
const { detectPlanChanges } = require('./planChanges');
const { resolveChasedRenewals } = require('../src/renewalsAutoResolve');
const { collapseInternalDuplicates } = require('../src/uploadBatchDedupe');
const { resolvePassThroughLiableAgent } = require('../src/writerPassThroughAgents');
const { ensurePassThroughSchema } = require('./pass-through');
const { safeUploadFilename, isAllowedUploadName } = require('./uploadSafe');
const {
  isAgentViewCommissionReport,
  parseAgentViewCommissionReportPDF,
  tryParseAgentViewUpload,
} = require('../src/agentViewCommissionReport');
const {
  resolveNhpUploadOriginalName,
} = require('../src/nhpUploadName');
const { classifyTHECarrierTransaction, classifyHumanaDevotedBSITransaction } = require('../src/theCarrierStatementClassify');
let pdfParse;
try { pdfParse = require('pdf-parse'); } catch(e) { console.log('pdf-parse not installed'); }

const UPLOADS_DIR = path.join('/tmp', 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: UPLOADS_DIR,
  filename: (req, file, cb) => cb(null, safeUploadFilename(file.originalname))
});
const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    cb(null, isAllowedUploadName(file.originalname));
  }
});
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─── BSI split rules ──────────────────────────────────────────────────────────
const NO_SPLIT_AGENTS = [
  'patsy pernia',
  'eduardo pernia',
  'josseline silber',
  'josseline mena',
  'jessica sifontes',
  'sabri perez',
  'jill taylor',
  'osmary orozco',
];

const ACA_CARRIERS_LIST = [
  'molina',
  'cigna',
  'ambetter',
  'florida blue',
  'oscar health',
  'oscar',
];

const ACA_AGENCY_PAYS_PRODUCER = ['molina', 'cigna', 'ambetter', 'florida blue'];

function shouldSplit(agentName, carrier) {
  const car = String(carrier || '').toLowerCase().trim();
  if (ACA_CARRIERS_LIST.some(c => car.includes(c))) return false;
  return true;
}

function isAcaAgencyPaysProducer(carrier) {
  const car = String(carrier || '').toLowerCase().trim();
  return ACA_AGENCY_PAYS_PRODUCER.some(c => car.includes(c));
}

// ─── Client name validation (skip statement artifacts) ───────────────────────

function isValidClientName(clientName) {
  if (!clientName) return false;
  const name = String(clientName).trim();
  if (name === '') return false;
  
  // Skip statement artifacts (case-insensitive)
  const lower = name.toLowerCase();
  const artifacts = ['summary', 'deduction', 'total', 'balance', 'subtotal', 'grand total'];
  
  for (const artifact of artifacts) {
    if (lower.includes(artifact)) return false;
  }
  
  return true;
}

// ─── Plan type derivation ────────────────────────────────────────────────────

function derivePlanType(carrier, rawPlanType, policyNumber, lob) {
  const pt = String(rawPlanType || '').toLowerCase().trim();
  const pn = String(policyNumber || '').toLowerCase().trim();
  const lb = String(lob || '').toLowerCase().trim();

  if (carrier === 'UnitedHealthcare') {
    // DEBUG: Log UHC plan type detection
    if (pt.includes('partd') || pt.includes('pdp')) {
      console.log('[UHC-PLAN-TYPE] PartD detected:', { rawPlanType, pt });
    }
    if (pt.includes('medsup') || pt.includes('modmedsup') || pt.includes('supplement')) {
      console.log('[UHC-PLAN-TYPE] Med Supp detected:', { rawPlanType, pt });
    }
    
    // Check PDP/PartD first (before MAPD)
    if (pt.includes('partd') || pt.includes('part d') || pt.includes('pdp')) return 'UnitedHealthcare PDP';
    // Check Med Supp (includes AARPMODMEDSUP)
    if (pt.includes('medsup') || pt.includes('modmedsup') || pt.includes('supplement')) return 'UnitedHealthcare Med Supp';
    // Check MA variants
    if (['mapd','dsnp','csnp'].includes(pt) || pt.includes('med adv') || pt.includes('advantage')) return 'UnitedHealthcare Med Adv';
    // Default fallback
    console.log('[UHC-PLAN-TYPE] Defaulting to Med Adv for:', { rawPlanType, pt });
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
  const f = filename.toLowerCase().replace(/\s+/g, '_');
  return f.includes('commission_statement_2737247') || f.includes('uhc_statement') || (f.includes('uhc') && f.includes('statement'));
}

function isUHCDirectFile(filename) {
  const f = filename.toLowerCase().replace(/\s+/g, '_');
  // Match: commission_statement_706381_YYYY-MM-DD.xlsx
  return f.includes('commission_statement_706381');
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
    const sheetName = wb.SheetNames.find(s => s.toUpperCase() === 'DETAILS') || wb.SheetNames[0];
    const ws = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(ws, { defval: '', raw: true });
    if (!rows.length) return records;

    let period = '';
    const fnMatch = filename.match(/(20\d{2})(0[1-9]|1[0-2])/);
    if (fnMatch) period = fnMatch[1] + fnMatch[2];

    for (const row of rows) {
      const commAmt = parseFloat(row['Comm Amt']) || 0;
      if (commAmt === 0) continue;

      const prodNum = String(row['Prod Num'] || '').trim().replace(/^0+/, '');
      const agentName = MOO_PROD_NAMES[prodNum] || MOO_PROD_NAMES[String(row['Prod Num']).trim()] || `Producer ${String(row['Prod Num']).trim()}`;
      const clientRaw = String(row['Insureds Name'] || '').trim();
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
  if (isDoctorsFile(filename)) return false;
  return f.includes('commissions_ledger') || f.includes('solis');
}

function isHealthSpringFile(filename) {
  const f = filename.toLowerCase().replace(/[\s().]/g, '_');
  return f.includes('healthspring') || f.includes('healthspting') || f.includes('health_spring');
}

function isHealthSpringWb(wb) {
  if (!wb || !wb.Sheets || !wb.SheetNames) return false;
  const hasSummary = wb.SheetNames.some(s => s.toLowerCase() === 'summary');
  const hasDetail = wb.SheetNames.some(s => s.toLowerCase() === 'detail');
  if (!hasSummary || !hasDetail) return false;
  const summaryName = wb.SheetNames.find(s => s.toLowerCase() === 'summary');
  const ws = wb.Sheets[summaryName];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  return rows.length > 0 && String(rows[0][0] || '').toLowerCase().includes('healthsping');
}

function parseHealthSpringRows(wb, filename) {
  const records = [];
  try {
    const sheetsToProcess = ['Detail', 'Legacy'].filter(s => wb.SheetNames.includes(s));
    for (const sheetName of sheetsToProcess) {
      const ws = wb.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json(ws, { defval: '', raw: true });
      for (const row of rows) {
        const paymentType = String(row['Payment Type'] || '').trim();
        const paymentDesc = String(row['Payment Description'] || '').trim();
        const writingBrokerName = String(row['Writing Broker Name'] || '').trim();
        const memberName = String(row['Member Name'] || '').trim();
        const memberId = row['Member ID'];
        const mbi = String(row['Medicare Beneficiary Identifier (MBI)'] || '').trim();
        const payPeriod = row['Pay Period'];
        const paymentAmount = parseFloat(row['Payment Amount']) || 0;
        const effectiveDateRaw = row['Original Effective Date'] || row['Effective Date'];
        const planTypeRaw = String(row['Plan Type'] || '').trim();
        if (!memberName || paymentAmount === 0) continue;
        // Period from Pay Period
        let period = '';
        if (payPeriod instanceof Date) {
          period = `${payPeriod.getFullYear()}${String(payPeriod.getMonth()+1).padStart(2,'0')}`;
        } else if (typeof payPeriod === 'number' && payPeriod > 40000) {
          const d = new Date((payPeriod - 25569) * 86400 * 1000);
          period = `${d.getUTCFullYear()}${String(d.getUTCMonth()+1).padStart(2,'0')}`;
        }
        // Classification
        const ptLower = paymentType.toLowerCase();
        const pdLower = paymentDesc.toLowerCase();
        let classification;
        if (paymentAmount < 0 || ptLower.includes('disenroll')) {
          classification = 'Chargeback';
        } else if (pdLower === 'service fee') {
          classification = 'Agency Override';
        } else if (ptLower.includes('initial') || ptLower.includes('new')) {
          classification = 'New Business';
        } else if (ptLower.includes('renewal') || ptLower === 'legacy') {
          classification = 'Renewal';
        } else {
          classification = 'Agent Commission';
        }
        // Plan type
        const ptRaw = planTypeRaw.toUpperCase();
        let planType = 'HealthSpring Med Adv';
        if (ptRaw.includes('PDP')) planType = 'HealthSpring PDP';
        // Normalize member ID (can be numeric)
        const policyNumber = typeof memberId === 'number'
          ? String(Math.round(memberId))
          : String(memberId || mbi || '').trim();
        records.push({
          agent: normalizeAgentName(writingBrokerName) || 'The Health Experts Insurance',
          carrier: 'HealthSpring',
          planType,
          client: memberName,
          effectiveDate: formatDate(effectiveDateRaw),
          premium: 0,
          commission: paymentAmount,
          classification,
          period,
          policyNumber: policyNumber || mbi,
          payee: 'HealthSpring',
          raw: row
        });
      }
    }
    console.log(`[HEALTHSPRING] Parsed ${records.length} records, total $${records.reduce((s,r)=>s+r.commission,0).toFixed(2)}`);
  } catch (err) {
    console.error('[HEALTHSPRING] Parser error:', err.message);
  }
  return records;
}

function isHealthSunFile(filename) {
  const f = filename.toLowerCase().replace(/[\s-]+/g, '_');  // normalize spaces and hyphens
  return (f.includes('healthsun') || f.includes('commission_report') || f.includes('_hs_statement')) &&
         (f.endsWith('.csv') || f.endsWith('.xlsx'));
}

function isDevotedFile(filename) {
  const f = filename.toLowerCase().replace(/\s+/g, '_');
  // Pattern 1: Yahoska's NPN + name
  // Pattern 2: Just "devoted" in filename
  // Pattern 3: {NPN}_{Name}_{Date}.xls format
  return (f.includes('16326554') && f.includes('yahoska')) || 
         f.includes('devoted') ||
         /^\d{8}_[a-z_]+_\d{8}\.(xls|xlsx)$/.test(f);
}

function isDevotedXLS(wb) {
  // Check for Summary + Detail sheet structure
  if (!wb || !wb.Sheets || !wb.SheetNames) return false;
  
  const hasSummary = wb.SheetNames.some(s => s.toLowerCase() === 'summary');
  const hasDetail = wb.SheetNames.some(s => s.toLowerCase() === 'detail');
  
  if (hasSummary && hasDetail) {
    // Check if Detail sheet has expected Devoted columns
    const detailSheet = wb.SheetNames.find(s => s.toLowerCase() === 'detail');
    const ws = wb.Sheets[detailSheet];
    const rows = XLSX.utils.sheet_to_json(ws, { defval: '', raw: true, header: 1 });
    
    if (rows.length) {
      const headers = rows[0] || [];
      const headerStr = headers.map(h => String(h || '').toLowerCase()).join(' ');
      // Check for Devoted-specific columns: MBI, Member, Amount
      return headerStr.includes('mbi') || 
             (headerStr.includes('member') && headerStr.includes('amount'));
    }
  }
  
  return false;
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
    (f.includes('yahoska') && f.includes('katy') && f.includes('statement')) ||
    (f.includes('nhp') && f.includes('commission') && f.includes('tailored')) ||
    (f.includes('nhp') && f.includes('commission') && f.includes('jill')) ||
    (f.includes('nhp_commission_report'));
}

function isMolinaACAFile(filename) {
  const f = filename.toLowerCase().replace(/[\s()]/g, '_');
  return f.includes('tailored_insurance_solutions') || 
         (f.includes('molina') && f.includes('aca'));
}

function isOscarIFPFile(wb) {
  console.log('[OSCAR-IFP-DETECT] Starting detection...');
  
  if (!wb || !wb.Sheets || !wb.SheetNames || !wb.SheetNames.length) {
    console.log('[OSCAR-IFP-DETECT] No workbook/sheets');
    return false;
  }
  
  console.log('[OSCAR-IFP-DETECT] Sheet names:', wb.SheetNames);
  
  // Pattern 1: Single sheet "IFP Commissions"
  const hasIFPSheet = wb.SheetNames.some(s => s.toLowerCase().includes('ifp commissions'));
  console.log('[OSCAR-IFP-DETECT] Has IFP sheet:', hasIFPSheet);
  
  if (hasIFPSheet) {
    const sheetName = wb.SheetNames.find(s => s.toLowerCase().includes('ifp commissions'));
    console.log('[OSCAR-IFP-DETECT] Using sheet:', sheetName);
    
    const ws = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(ws, { defval: '', raw: true, header: 1 });
    
    if (!rows.length) {
      console.log('[OSCAR-IFP-DETECT] No rows found');
      return false;
    }
    
    const headers = rows[0] || [];
    const hasCommissionMonth = headers.some(h => 
      String(h || '').toLowerCase().includes('commission month')
    );
    
    if (hasCommissionMonth) {
      console.log('[OSCAR-IFP-DETECT] Pattern 1 matched: IFP Commissions sheet with Commission month');
      return true;
    }
  }
  
  // Pattern 2: Summary + Detail sheets with Commission month in Detail
  const hasSummary = wb.SheetNames.some(s => s.toLowerCase() === 'summary');
  const hasDetail = wb.SheetNames.some(s => s.toLowerCase() === 'detail');
  
  console.log('[OSCAR-IFP-DETECT] Has Summary sheet:', hasSummary);
  console.log('[OSCAR-IFP-DETECT] Has Detail sheet:', hasDetail);
  
  if (hasSummary && hasDetail) {
    const detailSheet = wb.SheetNames.find(s => s.toLowerCase() === 'detail');
    const ws = wb.Sheets[detailSheet];
    const rows = XLSX.utils.sheet_to_json(ws, { defval: '', raw: true, header: 1 });
    
    if (rows.length) {
      const headers = rows[0] || [];
      const hasCommissionMonth = headers.some(h => 
        String(h || '').toLowerCase().includes('commission month')
      );
      
      if (hasCommissionMonth) {
        console.log('[OSCAR-IFP-DETECT] Pattern 2 matched: Summary+Detail sheets with Commission month in Detail');
        return true;
      }
    }
  }
  
  console.log('[OSCAR-IFP-DETECT] No pattern matched');
  return false;
}

// ─── CMS Maximum FMV Caps ───────────────────────────────────────────────────
// 2026: Yahoska Perez 2026-07-01
// 2027: Aetna Schedule One Agent 4 AG4 (National $725/$363, CT/PA/DC $816/$408, CA/NJ $902/$451)
const { getCmsFmvCap } = require('../src/cmsFmvCaps');

// ─── AETNA BSI CSV ────────────────────────────────────────────────────────────
// Format: Aetna-to-BSI consolidated statement CSV
// Filename pattern: AETNA_BSI_STATEMENT_YYYYMM[---uuid].csv
// Alba Hernandez (NPN 21209073) is BSI's principal licensed agent;
// her rows are individual agent commissions — skip CMS cap validation.

function isAetnaBSICSVFilename(filename) {
  const f = filename.toLowerCase().replace(/[\s()]/g, '_');
  return f.includes('aetna_bsi_statement') || f.includes('aetna_bsi');
}

function parseAetnaBSICSV(wb, filename) {
  const records = [];
  console.log('[AETNA-BSI] Parser triggered for:', filename);

  function classifySalesEvent(se) {
    const s = (se || '').trim().toLowerCase();
    if (s === 'new business' || s === 'pronew') return 'initial';
    if (s === 'renewal' || s.includes('residual')) return 'renewal';
    // chargebacks, disenrollments, CMS trueups, HRA → skip
    return 'skip';
  }

  function parseDate(raw) {
    if (!raw) return null;
    const s = String(raw).trim();
    const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
    if (m) {
      let y = m[3]; if (y.length === 2) y = `20${y}`;
      return `${m[1].padStart(2,'0')}/${m[2].padStart(2,'0')}/${y}`;
    }
    return s || null;
  }

  try {
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rawRows = XLSX.utils.sheet_to_json(ws, { defval: '', raw: false });
    // Strip BOM from column names
    const rows = rawRows.map(row => {
      const clean = {};
      for (const [k, v] of Object.entries(row)) {
        clean[k.replace(/^[\ufeff\uFEFF]/, '').trim()] = v;
      }
      return clean;
    });

    console.log('[AETNA-BSI] Total rows (raw):', rows.length);

    for (const row of rows) {
      const paymentDate  = String(row['Payment Date'] || '').trim();
      const memberName   = String(row['Member Name']  || '').trim();
      const amtRaw       = row['Payee Amount'];
      const memberStateRaw = String(row['State'] || row['Member State'] || '').trim().split('-')[0].toUpperCase();
      const memberState    = /^[A-Z]{2}$/.test(memberStateRaw) ? memberStateRaw : null;
      const salesEvent   = String(row['Sales Event']  || '').trim();
      const writingNPN   = String(row['Writing Agent NPN']   || '').trim();
      const writingAgent = String(row['Writing Agent Name']  || '').trim();
      const memberId     = String(row['Member ID']     || '').trim();
      const coveragePeriod = String(row['Coverage Period'] || '').trim();
      const effectiveDateRaw = row['Effective Date'];
      const product      = String(row['Product'] || '').trim();

      // Skip summary rows (no Payment Date) or total rows
      if (!paymentDate || paymentDate.toLowerCase().startsWith('total')) continue;

      // Parse amount
      let amount = 0;
      if (typeof amtRaw === 'number') {
        amount = amtRaw;
      } else {
        amount = parseFloat(String(amtRaw).replace(/[$,]/g, '')) || 0;
      }
      if (amount === 0 && !memberName) continue; // blank row

      // Derive period from Coverage Period (MM/DD/YYYY → YYYYMM)
      let period = '';
      const pm = coveragePeriod.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
      if (pm) {
        let y = pm[3]; if (y.length === 2) y = `20${y}`;
        period = `${y}${pm[1].padStart(2,'0')}`;
      }

      const effectiveDate = parseDate(effectiveDateRaw);

      // Plan type
      let planType = 'Aetna MAPD';
      const prodL = product.toLowerCase();
      if (prodL.includes('pdp')) planType = 'Aetna PDP';
      else if (prodL.includes('ppo') || prodL.includes('mapd')) planType = 'Aetna MAPD';

      const eventType  = classifySalesEvent(salesEvent);
      // Aetna→BSI carrier feed (payee BSI). Writing-agent Alba/Lina rows are her
      // agent production that BSI remits; upload attribution sets producer_payable.
      // Agency-level override dollars appear under other BSI feeds / remittance.
      let classification;
      if (amount < 0 || eventType === 'skip') {
        classification = 'Chargeback';
      } else {
        classification = eventType === 'renewal' ? 'Renewal' : 'New Business';
      }

      // CMS cap anomaly check on all non-chargeback rows (plan-year aware)
      let anomaly = false;
      if (amount > 0 && eventType !== 'skip') {
        const cap = getCmsFmvCap(memberState, eventType, effectiveDate || period);
        if (amount > cap) {
          anomaly = true;
          console.log(`[AETNA-BSI] ⚠️  ANOMALY: ${memberName} | ${memberState} | ${salesEvent} | $${amount} > cap $${cap}`);
        }
      }

      // Normalize agent name: "Hernandez, Alba" → "Alba Hernandez"
      const agentNormalized = writingAgent
        ? writingAgent.replace(/^([^,]+),\s*(.+)$/, '$2 $1').trim()
        : 'Broker Society Insurance';

      records.push({
        agent:          agentNormalized,
        carrier:        'Aetna',
        planType,
        client:         memberName,
        effectiveDate,
        premium:        0,
        commission:     amount,
        classification,
        period,
        policyNumber:   memberId,
        payee:          'BSI',
        mga:            '',
        anomaly,
        memberState,
        raw: row,
      });
    }

    const total = records.reduce((s, r) => s + r.commission, 0);
    console.log(`[AETNA-BSI] Parsed ${records.length} records, total $${total.toFixed(2)}`);
  } catch (err) {
    console.error('[AETNA-BSI] Parser error:', err.message);
  }

  return records;
}

function isAetnaFile(filename) {
  const f = filename.toLowerCase().replace(/[\s()]/g, '_');
  return f.includes('aetna') || f.includes('producerstatement');
}

function isAetnaDirectCSVFilename(filename) {
  const f = filename.toLowerCase().replace(/[\s()]/g, '_');
  // Match: The_Health_Experts_Insurance_med_comm_YYYYMM.csv
  return f.includes('health_experts_insurance_med_comm') || 
         (f.includes('med_comm') && f.endsWith('.csv'));
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
  return f.includes('commissions_commissiondetails') || 
         f.includes('commissiondetails_88892') ||
         f.includes('commissionstatement') ||
         f.includes('agent.xcelerator') ||
         f.includes('yourfmo');
}

function isMutualOmahaPDF(filename) {
  const f = filename.toLowerCase();
  return f.endsWith('.pdf') && (
    f.includes('moo') ||
    f.includes('mutual') ||
    f.includes('mutual_of_omaha') ||
    f.includes('mutualomaha')
  );
}

function isNHPAgencyStatementPDF(filename) {
  const f = filename.toLowerCase().replace(/\s+/g, '_');
  return f.endsWith('.pdf') && (
    f.includes('agency-statement-the_health_experts_insurance') ||
    f.includes('agency_statement_the_health_experts_insurance')
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
    // Doctors Healthcare format: 20260101 → 01/01/2026
    if (value.match(/^\d{8}$/) && parseInt(value.slice(0,4)) > 1900) {
      const y = value.slice(0,4), m = value.slice(4,6), d = value.slice(6,8);
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

function normalizePeriod(value) {
  if (!value && value !== 0) return 'Unknown';
  const s = String(value).trim();

  if (s.match(/^\d{6}$/) && parseInt(s.slice(0,4)) > 1900) return s;

  if (s.match(/^\d{8}$/) && parseInt(s.slice(0,4)) > 1900) return s.slice(0,6);

  const mdy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdy) return mdy[3] + mdy[1].padStart(2,'0');

  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return iso[1] + iso[2];

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
  if ((c.includes('united') && !c.includes('omaha')) || c.includes('uhc')) return 'UnitedHealthcare';
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
  if ((c.includes('united') && !c.includes('omaha')) || c.includes('uhc')) return 'UnitedHealthcare';
  if (c.includes('molina')) return 'Molina';
  if (c.includes('wellcare')) return 'WellCare';
  return String(carrierMonth || '').split(' - ')[0].trim();
}

function isAgencyName(name) {
  const n = String(name || '').toLowerCase().trim();
  return n.includes('the health experts') || n.includes('health experts insurance');
}

// ─── UHC PARSERS ─────────────────────────────────────────────────────────────

/**
 * FIXED: Parse UHC Commission Summary sheet (monthly totals)
 * KEY FIXES:
 * 1. Handle both number AND string formats for Commission Activity
 * 2. Removed the error throw that was blocking the parser
 * 3. Added explicit parseFloat with currency symbol handling
 */
function parseUHCSummary(wb) {
  const sheetName = wb.SheetNames.find(s => s.toLowerCase().includes('commission summary'));
  if (!sheetName) return null;
  
  const ws = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(ws, { defval: '', raw: true });
  
  let totalCommissionEarned = 0;
  let totalChargebacks = 0;
  let totalPaymentReceived = 0;
  let hasNegativeBalance = false;
  let agentName = '';
  
  for (const row of rows) {
    // FIX: Handle both number and string formats for Commission Activity
    const commActivityRaw = row['Commission Activity'];
    let commissionActivity = 0;
    if (typeof commActivityRaw === 'number') {
      commissionActivity = commActivityRaw;
    } else if (typeof commActivityRaw === 'string') {
      commissionActivity = parseFloat(commActivityRaw.replace(/[$,]/g, '')) || 0;
    }
    
    const paymentAmount = parseFloat(row['Payment Amount']) || 0;
    const endingBalance = parseFloat(row['Ending Balance']) || 0;
    

    if (commissionActivity > 0) {
      totalCommissionEarned += commissionActivity;
    } else if (commissionActivity < 0) {
      totalChargebacks += commissionActivity;
    }
    
    totalPaymentReceived += paymentAmount;
    
    if (endingBalance < 0) {
      hasNegativeBalance = true;
    }
  }
  
  const transSheet = wb.SheetNames.find(s => s.toLowerCase().includes('commission trans'));
  if (transSheet) {
    const transWs = wb.Sheets[transSheet];
    const transRows = XLSX.utils.sheet_to_json(transWs, { defval: '', raw: true });
    if (transRows.length > 0) {
      agentName = String(transRows[0]['Writing Agent Name'] || transRows[0]['Agent Name'] || '').trim();
    }
  }
  
  const result = {
    commissionEarned: totalCommissionEarned,
    chargebacks: totalChargebacks,
    netActivity: totalCommissionEarned + totalChargebacks,
    paymentReceived: totalPaymentReceived,
    hasBalance: hasNegativeBalance,
    agentName: agentName || 'Unknown Agent'
  };
  
  return result;
}

/**
 * FIXED: Parse UHC Commission Transactions sheet
 * KEY FIX: Handle both string and number commission values (same issue as summary parser)
 */
function parseUHCRows(wb, filename) {
  const records = [];
  
  // Extract period from filename (KR_UHC_STATEMENT_FEBRUARY_2026.xlsx → 202602)
  let statementPeriod = null;
  if (filename) {
    const monthMap = {
      january: '01', february: '02', march: '03', april: '04',
      may: '05', june: '06', july: '07', august: '08',
      september: '09', october: '10', november: '11', december: '12'
    };
    
    const fnLower = filename.toLowerCase();
    for (const [month, num] of Object.entries(monthMap)) {
      if (fnLower.includes(month)) {
        const yearMatch = filename.match(/(20\d{2})/);
        if (yearMatch) {
          statementPeriod = yearMatch[1] + num;
          console.log(`[UHC] Extracted statement period from filename: ${statementPeriod}`);
          break;
        }
      }
    }
  }
  
  // SKIP SUMMARY RECORDS - these create fake BOB clients
  // Summary data is useful for validation but should NOT be imported as commission records
  console.log('[UHC] Skipping summary record creation (prevents fake BOB clients)');
  
  const sheetName = wb.SheetNames.find(s => s.toLowerCase().includes('commission trans')) || wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(ws, { defval: '', raw: true });

  for (const row of rows) {
    const writingAgentRaw = String(row['Writing Agent Name'] || '').trim();
    const client = String(row['Member Name'] || '').trim();
    
    // FIX: Handle both string and number commission values
    const commissionRaw = row['Commission'];
    let commission = 0;
    if (typeof commissionRaw === 'number') {
      commission = commissionRaw;
    } else if (typeof commissionRaw === 'string') {
      commission = parseFloat(commissionRaw.replace(/[$,]/g, '')) || 0;
    }
    
    const policyNumber = String(row['Policy Number'] || '').trim();
    const effectiveDate = formatDate(row['Original Effective Date']);
    let period = String(row['Payment Period'] || '').trim();
    const rawPlanType = String(row['Plan Type'] || '').trim();
    const commAction = String(row['Commission Action'] || '').trim();

    // Skip invalid client names (empty or statement artifacts)
    if (!isValidClientName(client)) continue;
    
    // SKIP SUMMARY ROWS - these create fake BOB clients like "Commission Earned & Paid"
    const clientLower = client.toLowerCase();
    if (clientLower.includes('commission earned') ||
        clientLower.includes('chargebacks') ||
        clientLower.includes('applied to balance') ||
        clientLower.includes('total commission') ||
        clientLower.includes('payment received')) {
      console.log(`[UHC] Skipping summary row: ${client}`);
      continue;
    }
    
    // Assign statement period to blank-period records (New Business & Chargebacks often lack periods)
    if (!period && statementPeriod) {
      period = statementPeriod;
      console.log(`[UHC] Assigned statement period ${statementPeriod} to ${client} (${commAction})`);
    }

    const isAgency = isAgencyName(writingAgentRaw);
    const agentName = isAgency ? 'The Health Experts Insurance' : normalizeAgentName(writingAgentRaw);
    const planType = derivePlanType('UnitedHealthcare', rawPlanType, policyNumber, '');
    const commActionLower = commAction.toLowerCase();
    const uhcClass = commActionLower === 'new' ? 'New Business'
      : commActionLower === 'renewal' ? 'Renewal'
      : commActionLower.includes('chargeback') ? 'Chargeback'
      : 'Agent Commission';

    // DEBUG: Log PartD and Med Supp records
    if (planType.includes('PDP') || planType.includes('PartD') || rawPlanType.toLowerCase().includes('partd')) {
      console.log('[UHC-PARTD] Found PartD record:', {
        client,
        rawPlanType,
        planType,
        commission,
        period,
        policyNumber
      });
    }
    if (planType.includes('Supp') || rawPlanType.toLowerCase().includes('medsup') || rawPlanType.toLowerCase().includes('supplement')) {
      console.log('[UHC-MEDSUP] Found Med Supp record:', {
        client,
        rawPlanType,
        planType,
        commission,
        period
      });
    }

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

// ─── OTHER PARSERS (kept from original) ───────────────────────────────────────

// ─── UHC DIRECT COMMISSION PARSER (706381) ────────────────────────────────────
function parseUHCDirectRows(wb, filename) {
  const records = [];
  try {
    // Find Commission Transactions sheet
    const sheetName = wb.SheetNames.find(s => s.toLowerCase().includes('commission trans'));
    if (!sheetName) {
      console.log('[UHC-DIRECT] No "Commission Transactions" sheet found');
      return records;
    }
    
    console.log('[UHC-DIRECT] Using sheet:', sheetName);
    const ws = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(ws, { defval: '', raw: false });
    
    console.log('[UHC-DIRECT] Total rows:', rows.length);
    
    let skippedCount = 0;
    let includedCount = 0;
    
    for (const row of rows) {
      const writingAgentRaw = String(row['Writing Agent Name'] || row['Agent Name'] || '').trim();
      const client = String(row['Member Name'] || row['Client Name'] || '').trim();
      const policyNumber = String(row['Policy Number'] || row['Member ID'] || '').trim();
      const effectiveDate = formatDate(row['Original Effective Date'] || row['Effective Date']);
      const period = String(row['Payment Period'] || row['Period'] || '').trim();
      const rawPlanType = String(row['Plan Type'] || row['Product'] || '').trim();
      const commAction = String(row['Commission Action'] || row['Transaction Type'] || '').trim();
      
      // Parse commission
      const commissionRaw = row['Commission'] || row['Commission Amount'];
      let commission = 0;
      if (typeof commissionRaw === 'number') {
        commission = commissionRaw;
      } else if (typeof commissionRaw === 'string') {
        commission = parseFloat(commissionRaw.replace(/[$,]/g, '')) || 0;
      }
      
      if (!isValidClientName(client) || commission === 0) continue;
      
      // FILTER: Include ONLY AARPMODMEDSUP + PartD
      // Skip MAPD/DSNP/CSNP (these come through BSI to avoid duplicates)
      const planTypeLower = rawPlanType.toLowerCase();
      
      // Skip Medicare Advantage plans (duplicates with BSI)
      if (planTypeLower.includes('mapd') || planTypeLower.includes('dsnp') || planTypeLower.includes('csnp') || planTypeLower.includes('ma ')) {
        skippedCount++;
        if (skippedCount <= 3) {
          console.log(`[UHC-DIRECT] Skipping MA plan (BSI duplicate): ${rawPlanType}`);
        }
        continue;
      }
      
      // Include ONLY AARPMODMEDSUP and PartD
      if (!planTypeLower.includes('aarpmodmedsup') && !planTypeLower.includes('partd') && !planTypeLower.includes('part d') && !planTypeLower.includes('pdp')) {
        skippedCount++;
        if (skippedCount <= 3) {
          console.log(`[UHC-DIRECT] Skipping non-MedSup/PartD plan: ${rawPlanType}`);
        }
        continue;
      }
      
      includedCount++;
      
      // Determine plan type
      let planType = 'UHC MedSup';
      if (planTypeLower.includes('partd') || planTypeLower.includes('part d') || planTypeLower.includes('pdp')) {
        planType = 'UHC Part D';
      } else if (planTypeLower.includes('aarpmodmedsup') || planTypeLower.includes('medsup')) {
        planType = 'UHC MedSup';
      }
      
      // Classification
      let classification = 'Agent Commission';
      const actionLower = commAction.toLowerCase();
      if (commission < 0) {
        classification = 'Chargeback';
      } else if (actionLower.includes('new') || actionLower.includes('initial')) {
        classification = 'New Business';
      } else if (actionLower.includes('renewal')) {
        classification = 'Renewal';
      }
      
      // Normalize agent name
      const agent = normalizeAgentName(writingAgentRaw) || 'Katy Robles';
      
      records.push({
        agent,
        carrier: 'UnitedHealthcare',
        planType,
        client,
        effectiveDate,
        premium: 0,
        commission,
        classification,
        period,
        policyNumber,
        payee: 'UnitedHealthcare',
        lob: planTypeLower.includes('partd') || planTypeLower.includes('part d') ? 'PDP' : 'MedSup',
        raw: row
      });
    }
    
    console.log(`[UHC-DIRECT] Included: ${includedCount} records (MedSup + Part D)`);
    console.log(`[UHC-DIRECT] Skipped: ${skippedCount} records (MA plans or other)`);
    console.log(`[UHC-DIRECT] Total commission: $${records.reduce((sum, r) => sum + r.commission, 0).toFixed(2)}`);
  } catch (err) {
    console.error('[UHC-DIRECT] Parser error:', err.message);
  }
  return records;
}

// THEI carrier statements are CSV/XLSX exports with a title block above the
// transaction header. They are distinct from the legacy carrier exports.
function parseTHECarrierStatementRows(wb, filename) {
  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false });
    const headerRowIndex = rows.findIndex((row) =>
      String(row[0] || '').trim() === 'Policy #' &&
      String(row[1] || '').trim() === 'Name of Insured'
    );

    if (headerRowIndex < 0) continue;

    const headers = rows[headerRowIndex].map((header) => String(header || '').trim());
    const columnIndex = (name) => headers.indexOf(name);
    const policyIdx = columnIndex('Policy #');
    const clientIdx = columnIndex('Name of Insured');
    const transactionIdx = columnIndex('Transaction Type');
    const productIdx = columnIndex('Product');
    const effectiveDateIdx = columnIndex('Effective Date');
    const originalEffectiveDateIdx = columnIndex('Original Effective Date');
    const netCommissionIdx = columnIndex('Net Comm');

    if (policyIdx < 0 || clientIdx < 0 || netCommissionIdx < 0) {
      return [];
    }

    const statementText = rows
      .slice(0, headerRowIndex)
      .flat()
      .map((value) => String(value || '').trim())
      .join(' ');
    const statementDateMatch = statementText.match(/Statement Date:\s*(\d{1,2})\/\d{1,2}\/(\d{2,4})/i);
    const period = statementDateMatch
      ? `${statementDateMatch[2].length === 2 ? `20${statementDateMatch[2]}` : statementDateMatch[2]}${statementDateMatch[1].padStart(2, '0')}`
      : 'Unknown';
    const carrier = /devoted/i.test(statementText) ? 'Devoted' : 'Humana';
    const agentRow = rows.slice(headerRowIndex + 1).find((row) =>
      String(row[0] || '').includes('Agent Number:')
    );
    const agentMatch = String(agentRow?.[0] || '').match(/^(.*?)\s*\(/);
    const agent = normalizeAgentName(agentMatch?.[1].trim()) || 'The Health Experts Insurance';
    const records = [];

    for (const row of rows.slice(headerRowIndex + 1)) {
      const policyNumber = String(row[policyIdx] || '').trim();
      const client = String(row[clientIdx] || '').trim();
      const commissionText = String(row[netCommissionIdx] || '').trim();
      const isNegative = /^\(.*\)$/.test(commissionText);
      let commission = parseFloat(commissionText.replace(/[$,()]/g, '')) || 0;
      if (isNegative) commission = -commission;

      if (!policyNumber || !isValidClientName(client) || commission === 0) continue;

      const transactionType = String(row[transactionIdx] || '').trim();
      let classification = classifyTHECarrierTransaction({
        transactionType,
        commission,
        carrier,
      });

      const product = String(row[productIdx] || '').trim();
      records.push({
        agent,
        carrier,
        planType: derivePlanType(carrier, product, policyNumber, ''),
        client,
        effectiveDate: formatDate(row[effectiveDateIdx] || row[originalEffectiveDateIdx]),
        premium: 0,
        commission,
        classification,
        period,
        policyNumber,
        payee: carrier,
        raw: row
      });
    }

    return records;
  }

  return null;
}

function parseHumanaRows(wb, filename, rawBuffer) {
  const records = [];

  try {
    const theiStatementRecords = parseTHECarrierStatementRows(wb, filename);
    if (theiStatementRecords !== null) {
      console.log(`[HUMANA] Parsed ${theiStatementRecords.length} THEI statement records`);
      return theiStatementRecords;
    }

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

    // Track section headers for classification (similar to NHP agent tracking)
    let currentSection = '';

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

      // Check if this row is a section header
      const firstCol = vals[0] ? String(vals[0]).trim().toUpperCase() : '';
      if (firstCol === 'NEW BUSINESS') {
        currentSection = 'New Business';
        continue;
      }
      if (firstCol === 'RENEWAL' || firstCol === 'RENEWALS') {
        currentSection = 'Renewal';
        continue;
      }
      if (firstCol === 'CHARGEBACK' || firstCol === 'CHARGEBACKS') {
        currentSection = 'Chargeback';
        continue;
      }

      if (!isValidClientName(client) || commission === 0) continue;

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

      // Classification priority: section header > fyr column > default
      let classification;
      if (currentSection) {
        classification = currentSection;
      } else if (commission < 0) {
        classification = 'Chargeback';
      } else if (fyr === 'F') {
        classification = 'New Business';
      } else if (fyr === 'R') {
        classification = 'Renewal';
      } else {
        classification = 'Agent Commission';
      }

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
    if (str.includes('agent') && str.includes('client') && (str.includes('commission') || str.includes('commision'))) {
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
  // BSI THE remittance CSVs often misspell the column as COMMISION
  const commissionCol = findCol(['commission', 'commision', 'amount', 'comp']);

  for (const row of rows) {
    const agent = normalizeAgentName(String(agentCol ? row[agentCol] : '').trim());
    const company = String(companyCol ? row[companyCol] : '').trim();
    const policyNumber = String(policyCol ? row[policyCol] : '').trim();
    const client = String(clientCol ? row[clientCol] : '').trim();
    const effectiveDate = formatDate(effDateCol ? row[effDateCol] : '');
    const commission = parseFloat(commissionCol ? row[commissionCol] : 0) || 0;
    
    // Skip invalid client names (empty or statement artifacts)
    if (!isValidClientName(client)) continue;
    
    // FIX: Determine classification by commission amount (same as PDF parser)
    let classification;
    if (commission < 0) {
      classification = 'Chargeback';
    } else if (Math.abs(commission) >= 300) {
      classification = 'New Business';
    } else if (Math.abs(commission) >= 20) {
      classification = 'Renewal';
    } else {
      classification = 'Agency Override';
    }
    
    const carrier = normalizeBSICarrier(company);
    records.push({
      agent: agent || 'The Health Experts Insurance',
      carrier,
      planType: derivePlanType(carrier, '', policyNumber, ''),
      client,
      effectiveDate,
      premium: 0,
      commission,
      classification,
      period: filePeriod,
      policyNumber,
      payee: 'BSI',
      raw: row
    });
  }
  return records;
}

/**
 * Detect BSI → THE remittance workbook (e.g. "JULY - THE" / T.H.E_STATEMENTS.csv).
 * Implementation lives in src/theRemittanceStatement.js
 */
const {
  isTheRemittanceStatement,
  parseTheRemittanceStatement,
} = require('../src/theRemittanceStatement');

const { applyBsiBookAgentProduction } = require('../src/bsiBookAttribution');
const {
  resolveNhpPaymentPeriod,
} = require('../src/nhpPeriod');
const { parseNhpWorkbook } = require('../src/nhpStatementParse');

function parseNHPRows(wb, uploadPeriod, filename = '') {
  return parseNhpWorkbook(wb, uploadPeriod, filename, {
    formatDate,
    derivePlanType,
    normalizeAgentName,
    normalizeNHPCarrier,
    isValidClientName,
  });
}

// ─── MOLINA ACA PARSER ────────────────────────────────────────────────────────
function parseMolinaACARows(wb, filename) {
  const records = [];
  try {
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { defval: '', raw: false });
    
    console.log('[MOLINA-ACA] Parsing file:', filename, 'Rows:', rows.length);
    
    for (const row of rows) {
      // Extract fields (adapt these based on actual Molina ACA format)
      const client = String(row['Member Name'] || row['Subscriber Name'] || row['Client Name'] || '').trim();
      const agent = String(row['Agent Name'] || row['Writing Agent'] || '').trim();
      const policyNumber = String(row['Policy Number'] || row['Member ID'] || '').trim();
      const effectiveDate = formatDate(row['Effective Date'] || row['Policy Effective']);
      
      // Commission is typically $27/record for Molina ACA
      let commission = parseFloat(row['Commission'] || row['Amount'] || 0);
      if (commission === 0) commission = 27; // Default to $27 if not provided
      
      // Period format: "3-2026" → "202603" or "March 2026" → "202603"
      const periodRaw = String(row['Period'] || row['Statement Period'] || row['Commission Period'] || '').trim();
      let period = '';
      if (periodRaw) {
        // Try "3-2026" format
        const dashMatch = periodRaw.match(/^(\d{1,2})-(\d{4})$/);
        if (dashMatch) {
          period = dashMatch[2] + dashMatch[1].padStart(2, '0'); // "202603"
        } else {
          // Try "March 2026" or "03/2026" format
          period = normalizePeriod(periodRaw);
        }
      }
      
      if (!isValidClientName(client) || commission === 0) continue;
      
      records.push({
        agent: normalizeAgentName(agent) || 'The Health Experts Insurance',
        carrier: 'Molina',
        planType: 'Molina ACA',
        client,
        effectiveDate,
        premium: 0,
        commission,
        classification: 'Agent Commission',
        period,
        policyNumber,
        payee: 'Molina',
        raw: row
      });
    }
    
    console.log('[MOLINA-ACA] Parsed', records.length, 'records, Total:', records.reduce((sum, r) => sum + r.commission, 0).toFixed(2));
  } catch (err) {
    console.error('[MOLINA-ACA] Parser error:', err.message);
  }
  return records;
}

// ─── OSCAR IFP COMMISSION PARSER ────────────────────────────────────────────────
function parseOscarIFPRows(wb, filename) {
  const records = [];
  try {
    // Find the data sheet: "IFP Commissions" or "Detail"
    let sheetName = wb.SheetNames.find(s => s.toLowerCase().includes('ifp commissions'));
    if (!sheetName) {
      // Try Detail sheet (Summary+Detail format)
      sheetName = wb.SheetNames.find(s => s.toLowerCase() === 'detail');
    }
    
    if (!sheetName) {
      console.log('[OSCAR-IFP] No data sheet found (tried "IFP Commissions" and "Detail")');
      return records;
    }
    
    console.log('[OSCAR-IFP] Using sheet:', sheetName);
    const ws = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(ws, { defval: '', raw: false });
    
    console.log('[OSCAR-IFP] Parsing file:', filename, 'Rows:', rows.length);
    console.log('[OSCAR-IFP] Sample headers:', Object.keys(rows[0] || {}).slice(0, 10));
    
    let skippedCount = 0;
    let parsedCount = 0;
    
    for (const row of rows) {
      // Explicitly read Commission column by name
      const commissionRaw = row['Commission'] || row['Commission Amount'] || '0';
      const commission = parseFloat(commissionRaw);
      const blockReason = String(row['Block Reason'] || row['Block reason'] || '').trim();
      
      if (parsedCount < 3) {
        console.log(`[OSCAR-IFP] Row ${parsedCount + 1} Commission: raw="${commissionRaw}" (${typeof commissionRaw}) → parsed=${commission} (${typeof commission})`);
      }
      
      // Debug log for skip condition check
      console.log('[OSCAR-IFP] Row check: commission=', commission, 'blockReason=', JSON.stringify(blockReason));
      
      // Skip rows where Commission = 0 AND Block Reason is not null/empty
      if (commission === 0 && blockReason !== '') {
        skippedCount++;
        if (skippedCount <= 2) {
          console.log(`[OSCAR-IFP] Skipping blocked row: client="${row['Subscriber name'] || row['Member Name']}" commission=${commission} reason="${blockReason}"`);
        }
        continue;
      }
      
      const client = String(row['Subscriber name'] || row['Member Name'] || row['Subscriber Name'] || '').trim();
      const policyNumber = String(row['Policy Number'] || row['Member ID'] || row['Subscriber ID'] || '').trim();
      const effectiveDate = formatDate(row['Effective Date'] || row['Policy Effective']);
      
      // Debug: check if client is invalid (empty or statement artifact)
      if (!isValidClientName(client)) {
        console.log('[OSCAR-IFP] Row skipped - invalid client name. Member Name:', JSON.stringify(row['Member Name']), 'Subscriber name:', JSON.stringify(row['Subscriber name']));
      }
      
      // Period conversion: "2025-12-01" → "202512" (YYYY-MM-DD to YYYYMM)
      const commissionMonthRaw = String(row['Commission month'] || row['Commission Month'] || '').trim();
      let period = '';
      if (commissionMonthRaw) {
        // Match YYYY-MM-DD format
        const dateMatch = commissionMonthRaw.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (dateMatch) {
          period = dateMatch[1] + dateMatch[2]; // "202512"
        } else {
          // Fallback to normalizePeriod for other formats
          period = normalizePeriod(commissionMonthRaw);
        }
      }
      
      // Skip invalid client names (empty or statement artifacts)
      if (!isValidClientName(client)) continue;
      
      parsedCount++;
      
      records.push({
        agent: 'Yahoska Perez', // This is Yahoska's report only
        carrier: 'Oscar',
        planType: 'Oscar IFP',
        client,
        effectiveDate,
        premium: 0,
        commission,
        classification: commission < 0 ? 'Chargeback' : 'Agent Commission',
        period,
        policyNumber,
        payee: 'Oscar',
        lob: 'ACA',
        raw: row
      });
    }
    
    const totalCommission = records.reduce((sum, r) => sum + r.commission, 0).toFixed(2);
    console.log('[OSCAR-IFP] Parsed', records.length, 'records');
    console.log('[OSCAR-IFP] Total commission:', totalCommission);
    console.log('[OSCAR-IFP] Skipped', skippedCount, 'blocked rows');
    console.log('[OSCAR-IFP] Commission values:', records.map(r => r.commission).join(', '));
  } catch (err) {
    console.error('[OSCAR-IFP] Parser error:', err.message);
  }
  return records;
}

// ─── DEVOTED HEALTH PARSER ─────────────────────────────────────────────────────
function parseDevotedRows(wb, filename) {
  const records = [];
  try {
    // Use Detail sheet if it exists (Summary+Detail format), otherwise use first sheet
    const detailSheet = wb.SheetNames.find(s => s.toLowerCase() === 'detail');
    const sheetName = detailSheet || wb.SheetNames[0];
    console.log('[DEVOTED] Using sheet:', sheetName);
    
    const ws = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(ws, { defval: '', raw: false });
    
    console.log('[DEVOTED] Parsing file:', filename, 'Rows:', rows.length);
    
    for (const row of rows) {
      // Column mappings from Devoted format
      const agentRaw = String(row['Agent'] || '').trim();
      const client = String(row['Member'] || '').trim();
      const mbi = String(row['MBI'] || '').trim(); // Use as policy number
      const commission = parseFloat(row['Amount'] || row['Commission'] || 0);
      const periodRaw = String(row['Period'] || '').trim(); // "Mar 26" format
      const effectiveDateRaw = String(row['Effective'] || row['Effective Date'] || '').trim();
      const typeRaw = String(row['Type'] || row['Classification'] || '').trim();
      
      if (!isValidClientName(client) || commission === 0) continue;
      
      // Parse period: "Mar 26" → "202603"
      let period = 'Unknown';
      if (periodRaw) {
        const months = {
          jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
          jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12'
        };
        // Match "Mar 26" or "March 2026" format
        const match = periodRaw.match(/^([A-Za-z]{3})\w*\s*(\d{2,4})$/);
        if (match) {
          const monthAbbr = match[1].toLowerCase();
          let year = match[2];
          // Convert 2-digit year to 4-digit
          if (year.length === 2) {
            const yearNum = parseInt(year);
            year = yearNum < 50 ? `20${year}` : `19${year}`;
          }
          const month = months[monthAbbr];
          if (month) {
            period = year + month; // "202603"
          }
        }
      }
      
      // Parse effective date
      const effectiveDate = formatDate(effectiveDateRaw);
      
      // Classification from Type column
      let classification = 'Agent Commission';
      const typeLower = typeRaw.toLowerCase();
      if (commission < 0) {
        classification = 'Chargeback';
      } else if (typeLower.includes('renewal')) {
        classification = 'Renewal';
      } else if (typeLower.includes('initial') || typeLower.includes('new')) {
        classification = 'New Business';
      }
      
      records.push({
        agent: normalizeAgentName(agentRaw) || 'Yahoska Perez',
        carrier: 'Devoted',
        planType: 'Devoted Med Adv',
        client,
        effectiveDate,
        premium: 0,
        commission,
        classification,
        period,
        policyNumber: mbi,
        payee: 'Devoted',
        lob: 'MA',
        raw: row
      });
    }
    
    console.log('[DEVOTED] Parsed', records.length, 'records, Total:', records.reduce((sum, r) => sum + r.commission, 0).toFixed(2));
  } catch (err) {
    console.error('[DEVOTED] Parser error:', err.message);
  }
  return records;
}

// ─── DEVOTED HEALTH PDF PARSER ────────────────────────────────────────────────
async function parseDevotedPDF(filePath, filename) {
  const records = [];
  if (!pdfParse) { 
    console.error('[DEVOTED-PDF] pdf-parse not installed'); 
    return records; 
  }
  
  try {
    const dataBuffer = fs.readFileSync(filePath);
    const data = await pdfParse(dataBuffer);
    const text = data.text;
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    
    console.log('[DEVOTED-PDF] Parsing file:', filename);
    console.log('[DEVOTED-PDF] Total lines:', lines.length);
    
    // Extract period from text or filename
    let period = 'Unknown';
    // Try to find period in format "Mar 26" or "March 2026" in PDF text
    const periodMatch = text.match(/(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+(\d{2,4})/i);
    if (periodMatch) {
      const months = {jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12'};
      const monthMatch = text.match(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i);
      if (monthMatch) {
        const monthAbbr = monthMatch[1].toLowerCase().slice(0,3);
        let year = periodMatch[1];
        if (year.length === 2) {
          const yearNum = parseInt(year);
          year = yearNum < 50 ? `20${year}` : `19${year}`;
        }
        period = year + months[monthAbbr];
      }
    }
    
    // CRITICAL: PDF extracts text with line breaks INSIDE transactions
    // Example (one transaction split across 3 lines):
    //   Yahoska Perez 5TE9EA2CR15 ESTELA 01-01-25 H1290 $28.91 Mar 26 Renewal - No
    //   - 16326554 IGLESIAS Monthly
    //   MORALES
    
    // Strategy: Find header, collect ALL remaining lines, use MBI as anchor
    
    let headerIndex = -1;
    for (let i = 0; i < lines.length; i++) {
      const lineLower = lines[i].toLowerCase();
      // Find Transactions table header (Agent + MBI + Member)
      if (lineLower.includes('agent') && lineLower.includes('mbi') && lineLower.includes('member')) {
        console.log('[DEVOTED-PDF] Found Transactions header at line', i);
        headerIndex = i;
        break;
      }
    }
    
    if (headerIndex === -1) {
      console.log('[DEVOTED-PDF] No Transactions header found');
      return records;
    }
    
    // Collect all lines after header into one text block
    const transactionLines = lines.slice(headerIndex + 1);
    const transactionText = transactionLines.join(' ');
    
    console.log('[DEVOTED-PDF] Transaction text length:', transactionText.length);
    console.log('[DEVOTED-PDF] Sample:', transactionText.substring(0, 200));
    
    // Find all MBIs (11 alphanumeric characters - this is the anchor)
    // Pattern: Negative lookbehind (no alphanumeric before) + 11 chars + positive lookahead (uppercase letter after)
    // This matches MBI immediately followed by name: 5TE9EA2CR15ESTELA
    const mbiPattern = /(?<![A-Z0-9])([A-Z0-9]{11})(?=[A-Z])/g;
    const mbis = [];
    let match;
    while ((match = mbiPattern.exec(transactionText)) !== null) {
      mbis.push({ mbi: match[1], index: match.index });
    }
    
    console.log('[DEVOTED-PDF] Found', mbis.length, 'MBI patterns');
    
    // Extract data around each MBI
    for (let i = 0; i < mbis.length; i++) {
      const { mbi, index } = mbis[i];
      
      // Get text around this MBI (from previous MBI to next MBI)
      const startIdx = i > 0 ? mbis[i-1].index + 11 : 0;
      const endIdx = i < mbis.length - 1 ? mbis[i+1].index : transactionText.length;
      const recordText = transactionText.substring(startIdx, endIdx);
      
      console.log(`[DEVOTED-PDF] ===== Processing MBI ${i+1}/${mbis.length} =====`);
      console.log('[DEVOTED-PDF] MBI:', mbi);
      console.log('[DEVOTED-PDF] Text chunk (first 150 chars):', recordText.substring(0, 150));
      
      // Extract Amount: $XX.XX
      const amountMatch = recordText.match(/\$(\d+\.\d{2})/);
      console.log('[DEVOTED-PDF] Amount match:', amountMatch ? amountMatch[0] : 'NOT FOUND');
      if (!amountMatch) {
        console.log('[DEVOTED-PDF] ❌ Skipping - no amount found');
        continue;
      }
      const commission = parseFloat(amountMatch[1]);
      
      // Extract Period: "Jan 26" (month name + 2-digit year)
      // No word boundaries - text is concatenated without spaces
      const periodMatch = recordText.match(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{2})/i);
      console.log('[DEVOTED-PDF] Period match:', periodMatch ? `${periodMatch[1]} ${periodMatch[2]}` : 'NOT FOUND');
      let rowPeriod = period; // default
      if (periodMatch) {
        const months = {jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12'};
        const monthAbbr = periodMatch[1].toLowerCase();
        let year = periodMatch[2];
        const yearNum = parseInt(year);
        year = yearNum < 50 ? `20${year}` : `19${year}`;
        const month = months[monthAbbr];
        if (month) {
          rowPeriod = year + month;
        }
      }
      
      // Extract Member Name (immediately after MBI, no space required)
      // Format: 5TE9EA2CR15ESTELA IGLESIAS MORALES 01-01-25
      // Pattern: MBI + uppercase letters/spaces until date pattern
      const nameMatch = recordText.match(new RegExp(mbi + '([A-Z][A-Z\\s]*?)(?=\\s*\\d{2}-\\d{2}-\\d{2})'));
      let memberName = 'Unknown';
      if (nameMatch) {
        memberName = nameMatch[1].trim();
      }
      console.log('[DEVOTED-PDF] Member name extracted:', memberName);
      
      // Extract Effective Date: DD-MM-YY
      // No word boundaries - text is concatenated without spaces
      let effectiveDate = '';
      const dateMatch = recordText.match(/(\d{2})-(\d{2})-(\d{2})/);
      if (dateMatch) {
        const mm = dateMatch[1];
        const dd = dateMatch[2];
        let yy = dateMatch[3];
        const yyNum = parseInt(yy);
        const yyyy = yyNum < 50 ? `20${yy}` : `19${yy}`;
        effectiveDate = `${mm}/${dd}/${yyyy}`;
      }
      
      // Classification from text
      let classification = 'Agent Commission';
      const textLower = recordText.toLowerCase();
      if (commission < 0) {
        classification = 'Chargeback';
      } else if (textLower.includes('renewal')) {
        classification = 'Renewal';
      } else if (textLower.includes('initial') || textLower.includes('new')) {
        classification = 'New Business';
      }
      
      if (commission === 0) {
        console.log('[DEVOTED-PDF] ❌ Skipping - commission is 0');
        continue;
      }
      
      if (memberName === 'Unknown') {
        console.log('[DEVOTED-PDF] ❌ Skipping - member name not found');
        continue;
      }
      
      console.log('[DEVOTED-PDF] ✅ Record valid - adding to results');
      
      records.push({
        agent: 'Yahoska Perez',
        carrier: 'Devoted',
        planType: 'Devoted Med Adv',
        client: memberName,
        effectiveDate,
        premium: 0,
        commission,
        classification,
        period: rowPeriod,
        policyNumber: mbi,
        payee: 'Devoted',
        lob: 'MA'
      });
      
      if (records.length <= 3) {
        console.log('[DEVOTED-PDF] 📊 Parsed record', records.length, ':', { mbi, memberName, commission, period: rowPeriod });
      }
    }
    
    console.log('[DEVOTED-PDF] Total MBIs found:', mbis.length);
    console.log('[DEVOTED-PDF] Parsed', records.length, 'records, Total:', records.reduce((sum, r) => sum + r.commission, 0).toFixed(2));
  } catch (err) {
    console.error('[DEVOTED-PDF] Parser error:', err.message);
  }
  return records;
}

function parseHealthSunRows(ws, filename) {
  const records = [];
  const rows = XLSX.utils.sheet_to_json(ws, { defval: '', raw: true });

  for (const row of rows) {
    const client = String(row['Member Name'] || '').trim();
    const policyNumber = String(row['Member ID'] || '').trim();
    const agentRaw = String(row['Agent Name'] || '').trim();
    const commission = parseFloat(row['PaidAmount']) || 0;
    const effectiveDateRaw = String(row['Effective Date'] || '').trim();
    const compensationMonthRaw = row['Compensation Month'];
    const compensationMonth = String(compensationMonthRaw || '').trim();
    const commissionType = String(row['Commission Type'] || '').trim();
    const initialRenewal = String(row['Initial / Renewal'] || '').trim();
    const planName = String(row['Product Plan Name'] || '').trim();
    const productType = String(row['Product Type'] || '').trim();

    if (!isValidClientName(client) || commission === 0) continue;

    // Parse period — handles Excel serial (number), YYYY-MM-DD, and M/D/YYYY
    let period = 'Unknown';
    if (typeof compensationMonthRaw === 'number' && compensationMonthRaw > 40000) {
      const d = new Date(Date.UTC(1899, 11, 30));
      d.setUTCDate(d.getUTCDate() + compensationMonthRaw);
      period = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    } else {
      const isoMatch = compensationMonth.match(/^(\d{4})-(\d{2})/);
      const mdyMatch = compensationMonth.match(/^(\d{1,2})\/\d{1,2}\/(\d{4})$/);
      if (isoMatch) period = isoMatch[1] + isoMatch[2];
      else if (mdyMatch) period = mdyMatch[2] + mdyMatch[1].padStart(2, '0');
    }

    // Parse effective date
    const effectiveDate = formatDate(effectiveDateRaw);

    // Classification
    const classification = commission < 0 ? 'Chargeback'
      : commissionType.toLowerCase().includes('audit') ? 'Adjustment'
      : initialRenewal.toLowerCase() === 'initial' ? 'New Business'
      : 'Renewal';

    // Plan type
    const planType = productType.toLowerCase().includes('snp') || productType.toLowerCase().includes('d-snp')
      ? 'HealthSun D-SNP'
      : 'HealthSun Med Adv';

    records.push({
      agent: normalizeAgentName(agentRaw) || 'The Health Experts Insurance',
      carrier: 'HealthSun',
      planType,
      client,
      effectiveDate,
      premium: 0,
      commission,
      classification,
      period,
      policyNumber,
      payee: 'HealthSun',
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

    if (!isValidClientName(client) || commission === 0) continue;

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

function parseAetnaRows(wb, filename) {
  const records = [];
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { defval: '', raw: true });

  for (const row of rows) {
    // Skip empty rows and total rows
    const memberName = String(row['Member Name'] || '').trim();
    if (!memberName || memberName.toLowerCase().includes('total')) continue;

    // Parse agent name - prefer Payee Name, fallback to Writing Agent Name
    let agentName = String(row['Payee Name'] || row['Writing Agent Name'] || '').trim();
    // Aetna format: "robles, katy" (lowercase, last first) - normalize it
    if (agentName) {
      const parts = agentName.split(',').map(p => p.trim());
      if (parts.length === 2) {
        // "robles, katy" → "Katy Robles"
        agentName = parts[1].charAt(0).toUpperCase() + parts[1].slice(1) + ' ' +
                    parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
      }
    }
    const agent = normalizeAgentName(agentName);

    const commission = parseFloat(row['Payee Amount']) || 0;
    if (commission === 0) continue;

    // Parse dates for smart classification
    const rawEffectiveDate = row['Effective Date'];
    const rawPaymentDate = row['Payment Date'];
    const effectiveDate = formatDate(rawEffectiveDate);
    
    // Determine if this is New Business or Renewal based on dates
    let isNewBusiness = false;
    if (rawEffectiveDate && rawPaymentDate) {
      const effDate = new Date(rawEffectiveDate);
      const payDate = new Date(rawPaymentDate);
      if (!isNaN(effDate.getTime()) && !isNaN(payDate.getTime())) {
        // Compare year/month: if effective date is same month/year as payment, it's New Business
        const effYM = effDate.getUTCFullYear() * 100 + (effDate.getUTCMonth() + 1);
        const payYM = payDate.getUTCFullYear() * 100 + (payDate.getUTCMonth() + 1);
        isNewBusiness = (effYM === payYM);
      }
    }
    
    // Classification logic
    const salesEvent = String(row['Sales Event'] || '').trim();
    let classification = 'Agent Commission';
    
    if (commission < 0 || salesEvent.toLowerCase().includes('chargeback')) {
      classification = 'Chargeback';
    } else if (isNewBusiness) {
      classification = 'New Business';
    } else {
      // Older effective date = Renewal (regardless of what Aetna says)
      classification = 'Renewal';
    }
    const policyNumber = String(row['Member ID'] || row['Legacy Member ID'] || '').trim();
    const product = String(row['Product'] || '').trim();
    
    // Determine plan type
    let planType = 'Aetna Med Adv';
    if (product.toLowerCase().includes('pdp')) planType = 'Aetna PDP';
    else if (product.toLowerCase().includes('mapd')) planType = 'Aetna MAPD';

    // Parse period from Payment Date
    let period = '';
    const paymentDate = row['Payment Date'];
    if (paymentDate) {
      let d;
      // Handle Excel serial date numbers
      if (typeof paymentDate === 'number') {
        d = new Date(Date.UTC(1899, 11, 30) + paymentDate * 86400000);
      } else {
        d = new Date(paymentDate);
      }
      if (!isNaN(d.getTime())) {
        period = String(d.getUTCFullYear()) + String(d.getUTCMonth() + 1).padStart(2, '0');
      }
    }

    records.push({
      agent: agent || 'The Health Experts Insurance',
      carrier: 'Aetna',
      planType,
      client: memberName,
      effectiveDate,
      premium: 0,
      commission,
      classification,
      period,
      policyNumber,
      payee: 'Aetna',
      raw: row
    });
  }
  return records;
}

// ─── AETNA DIRECT CSV PARSER ─────────────────────────────────────────────────

/**
 * Detection function for Aetna Direct CSV format
 * Matches files with columns: Medicare Number, Member ID, Payee Amount, Coverage Period
 * Example: The_Health_Experts_Insurance_med_comm_202606.csv
 */
function isAetnaDirectCSV(wb) {
  if (!wb || !wb.Sheets || !wb.SheetNames || !wb.SheetNames.length) {
    return false;
  }
  
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { defval: '', raw: true });
  if (!rows.length) {
    return false;
  }
  
  // Strip BOM (\ufeff) and other invisible characters from all headers
  const rawHeaders = Object.keys(rows[0]);
  const headers = rawHeaders.map(h => h.replace(/^[\ufeff\uFEFF]/, '').toLowerCase().trim());
  
  // Must have at least 3 of these key columns
  const keyColumns = ['paymentdate', 'memberid', 'payeeamount', 'coverageperiod', 'membername'];
  const matchCount = keyColumns.filter(col => 
    headers.some(h => h.replace(/[\s_-]/g, '') === col)
  ).length;
  
  return matchCount >= 3;
}

/**
 * Parser for Aetna Direct CSV format
 * Format: carrier statement CSV with member-level commission data
 */
function parseAetnaDirectCSV(wb, filename) {
  const records = [];
  
  console.log('[AETNA-DIRECT] Parser triggered for file:', filename);
  
  // Helper function to find column value by trying multiple name variations
  function getColumnValue(row, columnNames) {
    for (const name of columnNames) {
      if (row[name] !== undefined && row[name] !== null) {
        return row[name];
      }
    }
    return '';
  }
  
  try {
    const ws = wb.Sheets[wb.SheetNames[0]];
    // Read with raw: false to handle strings, then strip BOM from column names
    const rawRows = XLSX.utils.sheet_to_json(ws, { defval: '', raw: false });
    
    // Strip BOM (\ufeff) from all column names
    const rows = rawRows.map(row => {
      const cleanedRow = {};
      for (const [key, value] of Object.entries(row)) {
        const cleanKey = key.replace(/^[\ufeff\uFEFF]/, '').trim();
        cleanedRow[cleanKey] = value;
      }
      return cleanedRow;
    });
    
    console.log('[AETNA-DIRECT] Total rows:', rows.length);
    const sampleHeaders = Object.keys(rows[0] || {});
    console.log('[AETNA-DIRECT] Sample headers:', sampleHeaders);
    console.log('[AETNA-DIRECT] Raw first row sample:', JSON.stringify(rows[0]).substring(0, 200));
    
    for (const row of rows) {
      // EXPLICIT COLUMN MAPPING - Try multiple variations of each column name
      const paymentDate = String(getColumnValue(row, ['Payment Date', 'PaymentDate', 'Payment_Date'])).trim();
      const memberName = String(getColumnValue(row, ['Member Name', 'MemberName', 'Member_Name'])).trim();
      const payeeAmountRaw = getColumnValue(row, ['Payee Amount', 'PayeeAmount', 'Payee_Amount']);
      const coveragePeriod = String(getColumnValue(row, ['Coverage Period', 'CoveragePeriod', 'Coverage_Period'])).trim();
      const effectiveDateRaw = getColumnValue(row, ['Effective Date', 'EffectiveDate', 'Effective_Date']);
      const writingAgentName = String(getColumnValue(row, ['Writing Agent Name', 'WritingAgentName', 'Writing_Agent_Name'])).trim();
      const memberId = String(getColumnValue(row, ['Member ID', 'MemberID', 'Member_ID'])).trim();
      const product = String(getColumnValue(row, ['Product', 'Plan Type', 'PlanType'])).trim();
      const salesEvent = String(getColumnValue(row, ['Sales Event', 'SalesEvent', 'Sales_Event'])).trim();
      
      console.log('[AETNA-DIRECT] Row values:', {
        paymentDate: paymentDate.substring(0, 20),
        memberName: memberName.substring(0, 30),
        payeeAmount: payeeAmountRaw,
        coveragePeriod: coveragePeriod.substring(0, 20),
        agent: writingAgentName.substring(0, 30)
      });
      
      // BUG FIX #5: Skip summary rows
      if (paymentDate.toLowerCase().startsWith('total') || 
          memberName.toLowerCase().startsWith('total') ||
          memberName.toLowerCase().includes('grand total')) {
        console.log('[AETNA-DIRECT] Skipping total row');
        continue;
      }
      
      // BUG FIX #4: Client = Member Name (not Member ID)
      const client = memberName;
      
      // BUG FIX #1: Payee Amount - handle both number and string currency formats
      let payeeAmount = 0;
      if (typeof payeeAmountRaw === 'number') {
        payeeAmount = payeeAmountRaw;
      } else if (typeof payeeAmountRaw === 'string') {
        // Remove currency symbols and commas: "$1,234.56" → 1234.56
        payeeAmount = parseFloat(payeeAmountRaw.replace(/[$,]/g, '')) || 0;
      }
      
      // Skip if no client name or zero commission
      if (!isValidClientName(client) || payeeAmount === 0) continue;
      
      // FIX #2: Period = Coverage Period date string → "202606"
      let period = '';
      if (coveragePeriod) {
        // Convert to string in case it's an Excel serial number or Date object
        const coverageStr = String(coveragePeriod).trim();
        
        // Try ISO format first: "2026-06-01" or "2026-06-01 00:00:00"
        const isoMatch = coverageStr.match(/(\d{4})-(\d{2})/);
        if (isoMatch) {
          period = isoMatch[1] + isoMatch[2]; // "202606"
          console.log('[AETNA-DIRECT] Period parsed (ISO):', coverageStr, '→', period);
        } else {
          // Try MM/DD/YYYY or MM/D/YY format (handles "6/1/26")
          const slashMatch = coverageStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
          if (slashMatch) {
            let year = slashMatch[3];
            // Handle 2-digit year: 26 → 2026
            if (year.length === 2) {
              const yearNum = parseInt(year);
              year = yearNum < 50 ? `20${year}` : `19${year}`; // 00-49 = 2000s, 50-99 = 1900s
            }
            period = year + slashMatch[1].padStart(2, '0'); // "202606"
            console.log('[AETNA-DIRECT] Period parsed (slash):', coverageStr, '→', period);
          } else if (/^\d{5}$/.test(coverageStr)) {
            // Excel serial number (e.g., 46174 for 2026-06-01)
            try {
              const serialNum = parseInt(coverageStr);
              const excelEpoch = new Date(1899, 11, 30); // Excel epoch
              const date = new Date(excelEpoch.getTime() + serialNum * 86400000);
              period = String(date.getFullYear()) + String(date.getMonth() + 1).padStart(2, '0');
              console.log('[AETNA-DIRECT] Period parsed (Excel serial):', coverageStr, '→', period);
            } catch (e) {
              console.log('[AETNA-DIRECT] Excel serial parse failed:', coverageStr);
            }
          } else {
            console.log('[AETNA-DIRECT] Period parse FAILED:', coverageStr, 'Type:', typeof coveragePeriod);
          }
        }
      } else {
        console.log('[AETNA-DIRECT] Coverage Period is empty/null');
      }
      
      // Format effective date
      const effectiveDate = formatDate(effectiveDateRaw);
      
      // BUG FIX #2: Agent = Writing Agent Name (not Writing Agent NPN)
      const agent = normalizeAgentName(writingAgentName) || 'The Health Experts Insurance';
      
      // Determine plan type from Product field
      let planType = 'Aetna MAPD';
      const productLower = product.toLowerCase();
      if (productLower.includes('pdp')) {
        planType = 'Aetna PDP';
      } else if (productLower.includes('mapd')) {
        planType = 'Aetna MAPD';
      }
      
      // FIX #1: Classification - map Sales Event directly (strip ALL whitespace)
      // Note: Some fields have trailing spaces (e.g., "N " for CMS New)
      const salesEventClean = salesEvent.replace(/\s+/g, ' ').trim().toLowerCase();
      let classification = 'Agent Commission';
      
      console.log('[AETNA-DIRECT] Sales Event raw:', JSON.stringify(salesEvent));
      console.log('[AETNA-DIRECT] Sales Event clean:', salesEventClean);
      
      if (payeeAmount < 0) {
        classification = 'Chargeback';
      } else if (salesEventClean === 'renewal' || salesEventClean.includes('renewal')) {
        classification = 'Renewal';
      } else if (salesEventClean === 'new' || salesEventClean === 'new business' || salesEventClean.includes('new')) {
        classification = 'New Business';
      }
      
      console.log('[AETNA-DIRECT] Classification:', classification);
      
      records.push({
        agent,
        carrier: 'Aetna',
        planType,
        client, // BUG FIX #4: Use client (Member Name), not memberId
        effectiveDate,
        premium: 0,
        commission: payeeAmount,
        classification,
        period,
        policyNumber: memberId,
        payee: 'Aetna',
        raw: row
      });
    }
    
    console.log('[AETNA-DIRECT] Parsed', records.length, 'records, Total:', records.reduce((sum, r) => sum + r.commission, 0).toFixed(2));
  } catch (err) {
    console.error('[AETNA-DIRECT] Parser error:', err.message);
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
      const cellValue = String(cell?.v || '').toLowerCase().replace(/\s+/g, '');
      // Match both "Member Name" and "MemberName" formats
      if (cell && cellValue.includes('membername')) {
        headerRow = r;
        break;
      }
    }
    if (headerRow >= 0) break;
  }
  if (headerRow < 0) return records;

  const rows = XLSX.utils.sheet_to_json(ws, { defval: '', raw: true, range: headerRow });

  for (const row of rows) {
    // Handle both Solis (with spaces) and Doctors (no spaces) column formats
    const client = String(row['Member Name'] || row['MemberName'] || '').trim();
    const agent = normalizeAgentName(String(row['Agent Name'] || row['AgentName'] || '').trim());
    const commission = parseFloat(row['Payment Amt'] || row['PaymentAmt']) || 0;
    const commissionEffDate = row['Commission Eff. Date'] || row['CommissionEffectiveDate'];
    const memberEnrollDate = row['Member Enrollment Date'] || row['MemberEnrollmentDate'];
    
    // Both Doctors and Solis use Member Enrollment Date for EFFECTIVE column
    const isDoctor = isDoctorsFile(filename);
    const effectiveDate = formatDate(memberEnrollDate);
    // Normalize payment type: lowercase and collapse multiple spaces
    const paymentType = String(row['Payment Type'] || row['PaymentType'] || '').toLowerCase().replace(/\s+/g, ' ').trim();
    const policyNumber = String(row['Plan Member ID'] || row['PlanMemberID'] || '').trim();

    if (!isValidClientName(client) || commission === 0) continue;

    // Determine if New Business vs Renewal by comparing enrollment date to commission date
    let isNewBusiness = false;
    if (memberEnrollDate && commissionEffDate) {
      // Helper to convert any date format to Date object
      const parseAnyDate = (val) => {
        if (typeof val === 'number') {
          // Excel serial number
          return new Date(Date.UTC(1899, 11, 30) + val * 86400000);
        }
        const str = String(val);
        if (str.length === 8 && /^\d{8}$/.test(str)) {
          // YYYYMMDD format (Doctors)
          const y = parseInt(str.substring(0, 4));
          const m = parseInt(str.substring(4, 6));
          const d = parseInt(str.substring(6, 8));
          return new Date(Date.UTC(y, m - 1, d));
        }
        // Standard date string
        return new Date(val);
      };
      
      const enrollDate = parseAnyDate(memberEnrollDate);
      const commDate = parseAnyDate(commissionEffDate);
      
      if (!isNaN(enrollDate.getTime()) && !isNaN(commDate.getTime())) {
        const enrollYM = enrollDate.getUTCFullYear() * 100 + (enrollDate.getUTCMonth() + 1);
        const commYM = commDate.getUTCFullYear() * 100 + (commDate.getUTCMonth() + 1);
        isNewBusiness = (enrollYM === commYM);
      }
    }

    // Solis/Doctors payment type mapping
    // Use enrollment vs commission date comparison to determine New Business vs Renewal
    const classification = commission < 0 ? 'Chargeback'
      : paymentType.includes('chargeback') ? 'Chargeback'
      : isNewBusiness ? 'New Business'
      : paymentType.includes('agent retention') ? 'Renewal'
      : paymentType.includes('agent renewal compensation') ? 'Renewal'
      : paymentType.includes('initial') ? 'New Business'
      : paymentType.includes('renewal') ? 'Renewal'
      : paymentType.includes('new') ? 'New Business'
      : 'Renewal';

    let period = '';
    if (commissionEffDate) {
      let d;
      // Handle Excel serial date numbers (e.g., 46143 = days since 1900)
      if (typeof commissionEffDate === 'number') {
        // Convert Excel serial to JS Date (Excel epoch is Dec 30, 1899)
        d = new Date(Date.UTC(1899, 11, 30) + commissionEffDate * 86400000);
      } else {
        d = new Date(commissionEffDate);
      }
      if (!isNaN(d.getTime())) {
        period = String(d.getUTCFullYear()) + String(d.getUTCMonth() + 1).padStart(2, '0');
      }
    }

    const carrierName = isDoctor ? 'Doctors' : 'Solis';
    const planTypeName = isDoctor ? 'Doctors Med Adv' : 'Solis Med Adv';
    records.push({
      agent: agent || 'The Health Experts Insurance',
      carrier: carrierName,
      planType: planTypeName,
      client,
      effectiveDate,
      premium: 0,
      commission,
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
  const isDevoted = carrier === 'Devoted' || filename.toLowerCase().includes('devoted');
  
  // Try to extract period from filename as fallback
  // Extract LAST 8 consecutive digits before extension (skip NPN numbers at start)
  let filenamePeriod = 'Unknown';
  
  // Remove extension first
  const nameWithoutExt = filename.replace(/\.(xls|xlsx|csv|pdf)$/i, '');
  
  // Try to find last 8 digits (YYYYMMDD format) and convert to YYYYMM
  const date8Match = nameWithoutExt.match(/(\d{8})(?!.*\d{8})/);
  if (date8Match) {
    // Found YYYYMMDD at end: 20260327 → 202603
    const yyyymmdd = date8Match[1];
    filenamePeriod = yyyymmdd.substring(0, 6); // YYYYMM
  } else {
    // Fallback: try to find YYYYMM or "Month YYYY" pattern
    const fnMatch = nameWithoutExt.match(/(\d{4})(\d{2})|([A-Z][a-z]{2,8})\s*(\d{4})/i);
    if (fnMatch) {
      if (fnMatch[1] && fnMatch[2]) {
        filenamePeriod = fnMatch[1] + fnMatch[2]; // YYYYMM
      } else if (fnMatch[3] && fnMatch[4]) {
        const months = {jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12'};
        const m = months[fnMatch[3].toLowerCase().slice(0,3)];
        if (m) filenamePeriod = fnMatch[4] + m;
      }
    }
  }
  
  if (isDevoted) {
    console.log('[DEVOTED-PARSER] Processing file:', filename);
    console.log('[DEVOTED-PARSER] Mapping:', JSON.stringify(mapping));
    console.log('[DEVOTED-PARSER] Filename period:', filenamePeriod);
  }
  
  return rows.map((row, idx) => {
    const agent = normalizeAgentName(mapping.agent ? String(row[mapping.agent] || '').trim() : '');
    const rawPlanType = mapping.planType ? String(row[mapping.planType] || '').trim() : '';
    const policyNumber = mapping.policyNumber ? String(row[mapping.policyNumber] || '').trim() : '';
    const commission = mapping.commission ? parseFloat(row[mapping.commission]) || 0 : 0;
    const rawClass = mapping.classification ? String(row[mapping.classification] || '').trim() : '';
    const agencyType = isAgencyName(agent) ? 'Agent Commission' : 'Agency Override';
    const classification = normalizeClassification(rawClass, commission) || agencyType;
    
    // Try to get period from mapped column first
    let period = 'Unknown';
    if (mapping.period) {
      const rawPeriod = String(row[mapping.period] || '').trim();
      period = normalizePeriod(rawPeriod);
      
      if (isDevoted && idx < 2) {
        console.log(`[DEVOTED-PARSER] Row ${idx + 1} period: raw="${rawPeriod}" → normalized="${period}"`);
      }
    }
    
    // Fallback to filename period if still unknown
    if (period === 'Unknown' && filenamePeriod !== 'Unknown') {
      period = filenamePeriod;
      if (isDevoted && idx < 2) {
        console.log(`[DEVOTED-PARSER] Row ${idx + 1} using filename period: ${period}`);
      }
    }
    
    return {
      agent: agent || 'The Health Experts Insurance',
      carrier,
      planType: derivePlanType(carrier, rawPlanType, policyNumber, ''),
      client: mapping.client ? String(row[mapping.client] || '').trim() : '',
      effectiveDate: mapping.effectiveDate ? formatDate(row[mapping.effectiveDate]) : '',
      premium: mapping.premium ? parseFloat(row[mapping.premium]) || 0 : 0,
      commission,
      classification,
      period,
      policyNumber,
      raw: row
    };
  }).filter(r => r.commission > 0 || r.premium > 0 || r.client);
}

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

async function parseBSIPDF(filePath, filename) {
  const records = [];
  try {
    const dataBuffer = fs.readFileSync(filePath);
    const data = await pdfParse(dataBuffer);
    const text = data.text;

    // FIX: More flexible period extraction
    const periodMatch = text.match(/(JANUARY|FEBRUARY|MARCH|APRIL|MAY|JUNE|JULY|AUGUST|SEPTEMBER|OCTOBER|NOVEMBER|DECEMBER)\s+STATEMENT\s+(\d{4})/i)
      || text.match(/(JANUARY|FEBRUARY|MARCH|APRIL|MAY|JUNE|JULY|AUGUST|SEPTEMBER|OCTOBER|NOVEMBER|DECEMBER)\s+(\d{4})/i)
      || text.match(/Statement Date[:\s]+(\d{1,2})\/(\d{1,2})\/(\d{4})/i)
      || filename.match(/(\d{4})[-_](\d{2})/);  // Fallback to filename YYYY-MM
    
    const monthMap = { JANUARY:'01', FEBRUARY:'02', MARCH:'03', APRIL:'04', MAY:'05', JUNE:'06', JULY:'07', AUGUST:'08', SEPTEMBER:'09', OCTOBER:'10', NOVEMBER:'11', DECEMBER:'12' };
    
    let period = 'Unknown';
    if (periodMatch) {
      if (periodMatch[3] && periodMatch[4]) {
        // Statement Date: MM/DD/YYYY format
        period = `${periodMatch[4]}${periodMatch[3].padStart(2, '0')}`;
      } else if (monthMap[periodMatch[1]?.toUpperCase()]) {
        // Month name + year
        period = `${periodMatch[2]}${monthMap[periodMatch[1].toUpperCase()]}`;
      } else if (periodMatch[1] && periodMatch[2]) {
        // Filename YYYY-MM
        period = periodMatch[1] + periodMatch[2];
      }
    }
    
    console.log('[BSI-PDF] Extracted period:', period, 'from:', periodMatch ? periodMatch[0] : 'no match');

    const sectionRegex = /Detailed Compensation Statement\s*\(([^)]+)\)/gi;
    const sections = [];
    let m;
    while ((m = sectionRegex.exec(text)) !== null) {
      sections.push({ rawCarrier: m[1].trim(), startIdx: m.index });
    }

    for (let si = 0; si < sections.length; si++) {
      const { rawCarrier, startIdx } = sections[si];
      const endIdx = (si + 1 < sections.length) ? sections[si + 1].startIdx : text.length;
      const sectionText = text.slice(startIdx, endIdx);

      let carrier = rawCarrier.toUpperCase().trim();
      if (carrier === 'UHC' || carrier.includes('UNITED')) carrier = 'UnitedHealthcare';
      else if (carrier.includes('HUMANA')) carrier = 'Humana';
      else if (carrier === 'AETNA') carrier = 'Aetna';
      else if (carrier.includes('DEVOTED')) carrier = 'Devoted';
      else carrier = normalizeBSICarrier(rawCarrier);

      const lines = sectionText.split('\n').map(l => l.trim()).filter(Boolean);
      const carrierPattern = /^(UNITED\s+HEA?L?T?H?\s+CARE|HUMANA|AETNA|DEVOTED)\s*$/i;
      // NAME-BLEED FIX: plan suffixes are a CLOSED set. '[A-Z]{2,5}' was greedy
      // and consumed surname letters ("_HMO"+"DOUGLAS" → "_HMODO"+"UGLAS").
      // MBI alternative added: Devoted rows (11-char MBI policies) previously
      // matched no alternative and were silently dropped.
      // Note: [A-Z]\d{8,12} removed — strict subset of [A-Z]\d{6,12}.
      const PLAN_SUFFIX = '(?:HMO|PPO|PDP|MSUP|MA)';
      const MBI = '[1-9][A-Z][0-9A-Z][0-9][A-Z][0-9A-Z][0-9][A-Z][0-9A-Z][0-9]{2}';
      const policyAlternatives = [
        `[A-Z0-9]{6,15}_${PLAN_SUFFIX}`,
        MBI,
        '[A-Z]{2,3}\\d{8,15}',
        '\\d{9,15}',
        '[A-Z]\\d{6,12}',
      ];
      const policyChars = `(?:${policyAlternatives.join('|')})`;
      const dataLinePattern = new RegExp(`^(${policyChars})([A-Z][A-Z\\s,'\\.\\-]+?)(\\d{2}\\/\\d{2}\\/\\d{4})(-?\\$[\\d,]+\\.\\d{2})$`);

      const carrierAlternatives = '(?:UNITED\\s*HEA?L?T?H?\\s*CARE|HUMANA/DEVOTED|HUMANA|AETNA|DEVOTED)';
      const singleLinePattern = new RegExp(
        `^([A-Z][A-Z\\s,'\\.\\-]+?)(${carrierAlternatives})(${policyChars})([A-Z][A-Z\\s,'\\.\\-]+?)(\\d{2}\\/\\d{2}\\/\\d{4})(-?\\$[\\d,]+\\.\\d{2})$`,
        'i'
      );

      const parsedRows = [];

      const consumedIndices = new Set();
      for (let i = 0; i < lines.length - 2; i++) {
        const lineA = lines[i];
        const lineB = lines[i + 1];
        const lineC = lines[i + 2];
        if (!carrierPattern.test(lineB)) continue;
        if (!/^[A-Z][A-Z\s,'\.\-]+$/.test(lineA)) continue;
        const dm = lineC.match(dataLinePattern);
        if (!dm) continue;
        parsedRows.push({
          agentRaw: lineA,
          policyNumber: dm[1],
          clientRaw: dm[2],
          effectiveDate: dm[3],
          amountStr: dm[4],
        });
        consumedIndices.add(i);
        consumedIndices.add(i + 1);
        consumedIndices.add(i + 2);
        i += 2;
      }

      for (let i = 0; i < lines.length; i++) {
        if (consumedIndices.has(i)) continue;
        const single = lines[i].match(singleLinePattern);
        if (!single) continue;
        parsedRows.push({
          agentRaw: single[1],
          policyNumber: single[3],
          clientRaw: single[4],
          effectiveDate: single[5],
          amountStr: single[6],
        });
      }

      for (const t of parsedRows) {
        const agentRaw = t.agentRaw.trim().replace(/\s+/g, ' ');
        const policyNumber = t.policyNumber;
        const clientRaw = t.clientRaw.trim().replace(/\s+/g, ' ');
        const effectiveDate = t.effectiveDate;
        const amountStr = t.amountStr;
        const commission = parseFloat(amountStr.replace(/[$,]/g, '')) || 0;

        if (!agentRaw || !clientRaw) continue;
        if (agentRaw.length < 3 || clientRaw.length < 3) continue;

        const agent = normalizeAgentName(agentRaw);
        const client = clientRaw
          .split(/\s+/)
          .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
          .join(' ');
        const planType = derivePlanType(carrier);

        const isChargeback = commission < 0;
        
        // FIX: Determine classification by commission amount (Humana/Medicare commission tiers)
        // New Business: $300+ (first year)
        // Renewal: $20-$100 (ongoing)
        // Agency Override: <$10 (small override)
        let classification;
        if (isChargeback) {
          classification = 'Chargeback';
        } else if (Math.abs(commission) >= 300) {
          classification = 'New Business';
        } else if (Math.abs(commission) >= 20) {
          classification = 'Renewal';
        } else {
          classification = 'Agency Override';
        }
        
        const BSI_SPLIT_START_DATE = '2025-09-01';
        const isBsiEligible = effectiveDate && effectiveDate >= BSI_SPLIT_START_DATE;
        const splitApplies = shouldSplit(agent, carrier) && isBsiEligible;
        const grossCommission = commission;

        const isAcaProducerHere = NO_SPLIT_AGENTS.some(a => String(agent).toLowerCase().includes(a));
        const passThrough = isAcaAgencyPaysProducer(carrier) && isAcaProducerHere;

        const theiShare = passThrough
          ? 0
          : (splitApplies ? Math.round(commission * 0.5 * 100) / 100 : commission);
        const bsiShare = (passThrough || !splitApplies)
          ? 0
          : Math.round(commission * 0.5 * 100) / 100;
        const producerPayable = passThrough ? commission : 0;
        const lob = /humana|aetna|devoted|united.?health/i.test(carrier) ? 'MA' : 'Unknown';

        records.push({
          agent,
          carrier,
          planType,
          client,
          effectiveDate,
          commission: theiShare,
          classification,
          period,
          policyNumber,
          payee: 'BSI',
          source: 'BSI',
          policyWrittenDate: effectiveDate,
          grossCommission,
          theiShare,
          bsiShare,
          producerPayable,
          splitApplies,
          lob,
          _agentRaw: agentRaw,
          _clientRaw: clientRaw,
          _rawCarrier: rawCarrier,
        });
      }
    }
  } catch (err) {
    console.error('parseBSIPDF error:', err.message);
  }
  return records;
}

async function parseTHEStatementPDF(filePath, filename) {
  const records = [];
  if (!pdfParse) { console.error('pdf-parse not installed'); return records; }
  try {
    const dataBuffer = fs.readFileSync(filePath);
    const data = await pdfParse(dataBuffer);
    const lines = data.text.split('\n').map(l => l.trim()).filter(l => l.length > 0);

    const carrierMap = {
      'UNITED HEALTH CARE': 'UnitedHealthcare',
      'HUMANA': 'Humana',
      'AETNA': 'Aetna',
    };

    const toTitleCase = (str) =>
      str.trim().toLowerCase().replace(/\b\w/g, c => c.toUpperCase());

    const normalizeAgent = (raw) => {
      raw = raw.trim();
      if (raw.includes(',')) {
        const parts = raw.split(',');
        return toTitleCase(`${parts[1].trim()} ${parts[0].trim()}`);
      }
      return toTitleCase(raw);
    };

    const dateToPeriod = (dateStr) => {
      const parts = dateStr.trim().split('/');
      return parts.length === 3 ? parts[2] + parts[0] : null;
    };

    // Parse UHC data line: "930822526ESPINOZA, JOAQUIN H.11/01/2025"
    // Policy = leading alphanum, date = trailing MM/DD/YYYY, client = middle
    const parseUHCDataLine = (line) => {
      const dateMatch = line.match(/(\d{2}\/\d{2}\/\d{4})$/);
      if (!dateMatch) return null;
      const dateStr = dateMatch[1];
      const beforeDate = line.slice(0, line.length - 10);
      const policyMatch = beforeDate.match(/^([A-Z]?\d{6,15})/);
      if (!policyMatch) return null;
      const policyPart = policyMatch[1];
      const clientPart = beforeDate.slice(policyPart.length).trim();
      return { policy: policyPart, client: clientPart, date: dateStr };
    };

    // Parse Humana/Aetna single line: "PAULETTE ROSTRANHUMANA9UY3E86YV04_MAJorge Gilete01/01/2026$40.63"
    // or Aetna: "CHRISTIAN MUNOZAETNAXXXXXXXXXXSOTOMAYOR F,JAYNE01/01/2026-$82.50"
    const parseSingleLine = (line) => {
      // Must end with DATE + AMOUNT (no space between them in pdf-parse output)
      const m = line.match(/(\d{2}\/\d{2}\/\d{4})(-?\$[\d,]+\.\d{2})$/);
      if (!m) return null;
      const dateStr = m[1];
      const amountStr = m[2];
      const before = line.slice(0, m.index);

      for (const [token, carrier] of Object.entries(carrierMap)) {
        const idx = before.toUpperCase().indexOf(token);
        if (idx === -1) continue;
        const agentRaw = before.slice(0, idx).trim();
        const rest = before.slice(idx + token.length).trim();

        // Try suffix-based split first (_HMO, _PPO, _MA, _PDP, _MSUP)
        const suffixMatch = rest.match(/^([A-Z0-9_]+?(?:_HMO|_PPO|_MSUP|_MA|_PDP|K_HMO|K_PPO))(.+)$/i);
        if (suffixMatch) {
          const policyPart = suffixMatch[1];
          const clientPart = suffixMatch[2].trim();
          if (!agentRaw || !clientPart) continue;
          return {
            agent: agentRaw, carrier,
            policy: policyPart, client: clientPart,
            date: dateStr, amount: parseFloat(amountStr.replace(/[$,]/g, '')) || 0,
            period: dateToPeriod(dateStr),
          };
        }

        // Fallback: policy is leading alphanumeric block up to first comma or space+uppercase
        // Works for Aetna: "NG102212364200SOTOMAYOR F,JAYNE"
        
        // PREPROCESSING: Fix name-bleed for policies with trailing surname letters
        // Example: "929779560RODRIGUEZ JR, GUIDO A." → "929779560 RODRIGUEZ JR, GUIDO A."
        // Pattern: digits followed immediately by uppercase letters (surname)
        let preprocessedRest = rest.replace(/(\d{6,15})([A-Z][A-Z\s,]+)/g, '$1 $2');
        
        const plainMatch = preprocessedRest.match(/^([A-Z0-9]{6,20})(.+)$/);
        if (plainMatch) {
          const policyPart = plainMatch[1];
          const clientPart = plainMatch[2].trim();
          if (!agentRaw || !clientPart) continue;
          return {
            agent: agentRaw, carrier,
            policy: policyPart, client: clientPart,
            date: dateStr, amount: parseFloat(amountStr.replace(/[$,]/g, '')) || 0,
            period: dateToPeriod(dateStr),
          };
        }
      }
      return null;
    };

    let currentCarrier = null;
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];

      // Section headers
      if (line.includes('Detailed Compensation Statement (UHC)')) { currentCarrier = 'UnitedHealthcare'; i++; continue; }
      if (line.includes('Detailed Compensation Statement (HUMANA)') || line.includes('Detailed Compensation Statement(HUMANA)')) { currentCarrier = 'Humana'; i++; continue; }
      if (line.includes('Detailed Compensation Statement (AETNA)') || line.includes('Detailed Compensation Statement(AETNA)')) { currentCarrier = 'Aetna'; i++; continue; }

      if (!currentCarrier) { i++; continue; }

      // Skip known non-data lines
      if (line.startsWith('Balance:') || line.startsWith('Agent') ||
          line.startsWith('CARRIER SUMMARY') || line.match(/STATEMENT\s+20\d{2}/) ||
          line.match(/^(UNITED HEALTH CARE|HUMANA\/DEVOTED|AETNA)\s*\(\$/) ||
          line.startsWith('Detailed Compensation')) {
        i++; continue;
      }

      // UHC: 4-line pattern
      if (currentCarrier === 'UnitedHealthcare' && i + 3 < lines.length) {
        const agentLine = lines[i];
        const carrierLine = lines[i + 1];
        const dataLine = lines[i + 2];
        const amountLine = lines[i + 3];

        const carrierKey = Object.keys(carrierMap).find(k => carrierLine.toUpperCase() === k);
        const amountMatch = amountLine.match(/^-?\$[\d,]+\.\d{2}$/);
        const parsed = parseUHCDataLine(dataLine);
        const agentValid = agentLine.match(/^[A-Z][A-Z\s,\.]+$/) && agentLine.length > 3;

        if (carrierKey && amountMatch && parsed && agentValid) {
          const commission = parseFloat(amountLine.replace(/[$,]/g, '')) || 0;
          records.push({
            agent: normalizeAgent(agentLine),
            carrier: carrierMap[carrierKey],
            planType: derivePlanType(carrierMap[carrierKey], 'MAPD', parsed.policy, ''),
            client: toTitleCase(parsed.client),
            effectiveDate: parsed.date,
            premium: 0,
            commission,
            classification: commission < 0 ? 'Chargeback' : 'Agency Override',
            period: dateToPeriod(parsed.date),
            policyNumber: parsed.policy,
            payee: 'THE',
            raw: {}
          });
          i += 4;
          continue;
        }
      }

      // Single concatenated line — works for Humana, Aetna, AND some UHC records
      if (currentCarrier === 'Humana' || currentCarrier === 'Aetna' || currentCarrier === 'UnitedHealthcare') {
        const parsed = parseSingleLine(line);
        if (parsed) {
          records.push({
            agent: normalizeAgent(parsed.agent),
            carrier: parsed.carrier,
            planType: derivePlanType(parsed.carrier, 'MAPD', parsed.policy, ''),
            client: toTitleCase(parsed.client),
            effectiveDate: parsed.date,
            premium: 0,
            commission: parsed.amount,
            classification: parsed.amount < 0 ? 'Chargeback' : 'Agency Override',
            period: parsed.period,
            policyNumber: parsed.policy,
            payee: 'THE',
            raw: {}
          });
          i++;
          continue;
        }

        // Handle 3-part split: LINE=agent+carrier+policy+client, LINE+1=date, LINE+2=amount
        if (i + 2 < lines.length) {
          const dateLine = lines[i + 1];
          const amountLine = lines[i + 2];
          const dateOnly = dateLine.match(/^(\d{2}\/\d{2}\/\d{4})$/);
          const amountOnly = amountLine.match(/^(-?\$[\d,]+\.\d{2})$/);
          if (dateOnly && amountOnly) {
            const combined = line + dateOnly[1] + amountOnly[1];
            const parsedCombined = parseSingleLine(combined);
            if (parsedCombined) {
              records.push({
                agent: normalizeAgent(parsedCombined.agent),
                carrier: parsedCombined.carrier,
                planType: derivePlanType(parsedCombined.carrier, 'MAPD', parsedCombined.policy, ''),
                client: toTitleCase(parsedCombined.client),
                effectiveDate: parsedCombined.date,
                premium: 0,
                commission: parsedCombined.amount,
                classification: parsedCombined.amount < 0 ? 'Chargeback' : 'Agency Override',
                period: parsedCombined.period,
                policyNumber: parsedCombined.policy,
                payee: 'THE',
                raw: {}
              });
              i += 3;
              continue;
            }
          }
        }


      }

      i++;
    }

    console.log(`[THE] parsed ${records.length} records:`,
      records.reduce((acc, r) => { acc[r.carrier] = (acc[r.carrier]||0)+1; return acc; }, {}));

  } catch (err) {
    console.error('parseTHEStatementPDF error:', err.message);
  }
  return records;
}

function isTHEStatementPDF(filename) {
  const f = filename.toLowerCase().replace(/\s+/g, '_');
  if (!f.endsWith('.pdf')) return false;
  if (f.includes('medicare_statement_-the-')) return false;
  return (
    f.includes('medicare_statement-the') ||
    f.includes('medicare_statement_the') ||
    f.includes('the_statement') ||
    (f.includes('statement') && f.includes('-the-'))
  );
}

function isBSIPDF(filename) {
  const f = filename.toLowerCase().replace(/\s+/g, '_');
  if (!f.endsWith('.pdf')) return false;
  // Exclude THE upline statements — those have their own parser
  if (isTHEStatementPDF(filename)) return false;
  return f.includes('bsi') ||
         f.includes('broker_society') ||
         f.includes('brokersociety');
}

function isBSIConsolidatedPDF(filename) {
  const f = filename.toLowerCase().replace(/\s+/g, '_');
  if (!f.endsWith('.pdf')) return false;
  return f.includes('statement-health_experts') ||
         f.includes('statement_health_experts') ||
         f.includes('health_experts-') ||
         f.includes('health_experts_') ||
         f.includes('medicare_statement_-the-');
}

async function parseBSIConsolidatedPDF(filePath, filename) {
  const records = [];
  if (!pdfParse) { console.error('pdf-parse not installed'); return records; }
  try {
    const dataBuffer = fs.readFileSync(filePath);
    const data = await pdfParse(dataBuffer);
    const lines = data.text.split('\n').map(l => l.trim()).filter(l => l.length > 0);

    const now = new Date();
    const uploadPeriod = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;

    const toTitleCase = (str) =>
      str.trim().toLowerCase().replace(/\b\w/g, c => c.toUpperCase());

    const normalizeAgent = (raw) => {
      raw = raw.trim();
      if (raw.includes(',') && raw === raw.toUpperCase()) {
        const parts = raw.split(',');
        return toTitleCase(`${parts[1].trim()} ${parts[0].trim()}`);
      }
      return toTitleCase(raw);
    };

    const carrierMap = {
      'UNITED HEALH CARE': 'UnitedHealthcare',
      'UNITED HEALTH CARE': 'UnitedHealthcare',
      'DEVOTED HEALTH': 'Devoted',
      'HUMANA': 'Humana',
      'AETNA': 'Aetna',
    };

    const skipLines = new Set([
      'CARRIER SUMMARY DETAILS',
      'AgentCompanyPolicy #Client NameEffective Date Commission',
      'Agent Company Policy # Client Name Effective Date Commission',
    ]);

    const skipPatterns = [
      /^CARRIER SUMMARY/i,
      /^UNITED HEALTH(?: CARE)?\s*\(\$/i,
      /^HUMANA\/DEVOTED/i,
      /^NHP/i,
      /^TOTAL\s*\(\$/i,
      /^Balance:/i,
      /^Detailed Compensation/i,
      /^\(\$\(/i,
      /^AETNA\s*\(\$/i,
    ];



    let i = 0;
    while (i < lines.length) {
      const line = lines[i];

      if (skipLines.has(line) || skipPatterns.some(p => p.test(line))) {
        i++; continue;
      }

      // Helper: try to parse a complete data string (agent+carrier+policy+client+date+amount)
      const tryParseLine = (str) => {
        const m = str.match(/(\d{1,2}\/\d{1,2}\/\d{4})\s*(-?\$[\d,]+\.\d{2})$/);
        if (!m) return null;
        const dateStr = m[1];
        const amountStr = m[2];
        const before = str.slice(0, m.index).trim();
        for (const [token, carrier] of Object.entries(carrierMap)) {
          const idx = before.toUpperCase().indexOf(token.toUpperCase());
          if (idx === -1) continue;
          const agentRaw = before.slice(0, idx).trim();
          const rest = before.slice(idx + token.length).trim();
          // Try suffix split first (_HMO, _PPO, _MA, etc.)
          const suffixMatch = rest.match(/^([A-Z0-9_]+?(?:_HMO|_PPO|_MA|_PDP|_MSUP|K_HMO|K_PPO))(.+)$/i);
          // Fallback: policy is leading alphanumeric block, stop before client name
          // Client names for Aetna contain commas — find the policy by stopping before first lowercase or comma
          const plainMatch = !suffixMatch ? rest.match(/^([A-Z]{2}\d{12})(.+)$/) : null;
          const policyPart = suffixMatch ? suffixMatch[1] : (plainMatch ? plainMatch[1] : null);
          const clientPart = suffixMatch ? suffixMatch[2].trim() : (plainMatch ? plainMatch[2].trim() : null);
          if (!agentRaw || !policyPart || !clientPart) continue;
          const dateParts = dateStr.split('/');
          const period = dateParts.length === 3 ? dateParts[2] + dateParts[0].padStart(2, '0') : uploadPeriod;
          return {
            agent: normalizeAgent(agentRaw), carrier,
            planType: derivePlanType(carrier, 'MAPD', policyPart, ''),
            client: toTitleCase(clientPart), effectiveDate: dateStr,
            premium: 0, commission: parseFloat(amountStr.replace(/[$,]/g, '')) || 0,
            classification: (parseFloat(amountStr.replace(/[$,]/g, '')) || 0) < 0 ? 'Chargeback' : 'Agency Override',
            period, policyNumber: policyPart, payee: 'BSI', raw: {}
          };
        }
        return null;
      };

      // Pattern 1: UHC 3-line block (agent / carrier / data+amount)
      if (i + 2 < lines.length) {
        const agentLine = lines[i];
        const carrierLine = lines[i + 1];
        const dataLine = lines[i + 2];
        const carrierKey = Object.keys(carrierMap).find(k => carrierLine.toUpperCase() === k.toUpperCase());
        const agentValid = agentLine.length > 2 && !/\d/.test(agentLine) &&
          !skipPatterns.some(p => p.test(agentLine)) && !skipLines.has(agentLine);
        if (carrierKey && agentValid) {
          // Parse data line directly
          const dm = dataLine.match(/(\d{1,2}\/\d{1,2}\/\d{4})(-?\$[\d,]+\.\d{2}|\$-)$/);
          if (dm && dm[2] !== '$-') {
            const dateStr = dm[1];
            const amountStr = dm[2];
            const beforeDate = dataLine.slice(0, dataLine.length - dateStr.length - amountStr.length);
            // NAME-BLEED FIX: '[A-Z0-9]{8,20}' greedily swallowed uppercase
            // surnames into the policy field. Closed set of known formats.
            // ORDER MATTERS: Humana suffix must come before generic numeric
            // or '00023852293' matches before '00023852293K_HMO' can.
            const MBI_PAT = '[1-9][A-Z][0-9A-Z][0-9][A-Z][0-9A-Z][0-9][A-Z][0-9A-Z][0-9]{2}';
            const pm = beforeDate.match(new RegExp(
              '^(' +
              '[A-Z0-9]{6,15}_(?:HMO|PPO|PDP|MSUP|MA)' + // Humana suffix (FIRST — more specific)
              '|[A-Z]{2,3}\\d{8,15}' +                   // Aetna (NG + 12 digits)
              '|' + MBI_PAT +                             // Devoted MBI
              '|[A-Z]?\\d{6,15}' +                       // UHC numeric (LAST)
              ')([A-Z].+)$'
            ));
            if (pm) {
              const dateParts = dateStr.split('/');
              const period = dateParts.length === 3 ? dateParts[2] + dateParts[0].padStart(2, '0') : uploadPeriod;
              const commission = parseFloat(amountStr.replace(/[$,]/g, '')) || 0;
              records.push({
                agent: normalizeAgent(agentLine), carrier: carrierMap[carrierKey],
                planType: derivePlanType(carrierMap[carrierKey], 'MAPD', pm[1], ''),
                client: toTitleCase(pm[2].trim()), effectiveDate: dateStr,
                premium: 0, commission,
                classification: commission < 0 ? 'Chargeback' : 'Agency Override',
                period, policyNumber: pm[1], payee: 'BSI', raw: {}
              });
              i += 3; continue;
            }
          }
        }
      }

      // Pattern 2: 2-line block (agent+carrier+policy+client+date / $amount)
      if (i + 1 < lines.length) {
        const nextLine = lines[i + 1];
        const amountOnly = nextLine.match(/^(-?\$[\d,]+\.\d{2})$/);
        if (amountOnly) {
          const combined = line + amountOnly[1];
          const rec = tryParseLine(combined);
          if (rec) {
            records.push(rec); i += 2; continue;
          }
        }
      }

      // Pattern 3: Single complete line (date + amount with space)
      const rec = tryParseLine(line);
      if (rec) {
        records.push(rec); i++; continue;
      }

      i++;
    }

    // Add summary deduction records from carrier summary
    // NHP deduction and unnamed deduction visible in carrier summary header
    const summaryDeductions = [];

    // Scan first 20 lines for NHP and unnamed deduction amounts
    for (let j = 0; j < Math.min(20, lines.length); j++) {
      const l = lines[j];
      // NHP deduction: "NHP($(10,572.50)" or similar
      const nhpMatch = l.match(/^NHP[\s\(]*\$\(?([0-9,]+\.\d{2})\)?/i);
      if (nhpMatch) {
        summaryDeductions.push({
          agent: 'The Health Experts Insurance',
          carrier: 'NHP',
          planType: 'NHP Med Adv',
          client: 'NHP Deduction Summary',
          effectiveDate: '',
          premium: 0,
          commission: -(parseFloat(nhpMatch[1].replace(/,/g, '')) || 0),
          classification: 'Chargeback',
          period: uploadPeriod,
          policyNumber: 'NHP-DEDUCTION',
          payee: 'BSI',
          raw: {}
        });
      }
      // Unnamed deduction: line starting with "($(2,750.00)" — no carrier label
      const unnamedMatch = l.match(/^\(\$\(?([0-9,]+\.\d{2})\)?/);
      if (unnamedMatch) {
        summaryDeductions.push({
          agent: 'The Health Experts Insurance',
          carrier: 'BSI',
          planType: 'Adjustment',
          client: 'BSI Deduction Summary',
          effectiveDate: '',
          premium: 0,
          commission: -(parseFloat(unnamedMatch[1].replace(/,/g, '')) || 0),
          classification: 'Chargeback',
          period: uploadPeriod,
          policyNumber: 'BSI-DEDUCTION',
          payee: 'BSI',
          raw: {}
        });
      }
    }

    summaryDeductions.forEach(r => records.push(r));

    // BSI consolidated PDFs store the FULL override pot. Apply THEI/BSI 50/50 here so
    // upload-time map (which skips when source is set) cannot mis-label as direct_carrier
    // 100% THEI — that bug made override statements look nothing like a 50/50 split.
    const { splitFullOverridePot } = require('../src/overrideSplitMath');
    const deducted = new Set();
    for (const r of records) {
      const cls = String(r.classification || '').toLowerCase();
      const isSplitRow = cls.includes('override') || cls === 'chargeback';
      if (!isSplitRow) {
        r.source = r.source || 'BSI';
        r.grossCommission = r.grossCommission != null ? r.grossCommission : r.commission;
        r.theiShare = r.theiShare != null ? r.theiShare : r.commission;
        r.bsiShare = r.bsiShare != null ? r.bsiShare : 0;
        r.producerPayable = r.producerPayable != null ? r.producerPayable : 0;
        r.splitApplies = false;
        continue;
      }
      const already = deducted.has(r.policyNumber);
      const split = splitFullOverridePot(r.commission, {
        agentName: r.agent,
        paymentPeriod: r.period,
        alreadyDeducted: already,
      });
      if (split.subAgentOverride) deducted.add(r.policyNumber);
      r.source = 'BSI';
      r.grossCommission = split.grossCommission;
      r.theiShare = split.theiShare;
      r.bsiShare = split.bsiShare;
      r.producerPayable = split.producerPayable;
      r.subAgentOverride = split.subAgentOverride;
      r.splitApplies = split.splitApplies;
      // Keep commission = full pot for audit; shares hold the 50/50 payable amounts.
      r.commission = split.grossCommission;
    }

    console.log(`[BSI-CONSOLIDATED] parsed ${records.length} records:`,
      records.reduce((acc, r) => { acc[r.carrier] = (acc[r.carrier]||0)+1; return acc; }, {}));

  } catch (err) {
    console.error('parseBSIConsolidatedPDF error:', err.message);
  }
  return records;
}

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

async function parseNHPAgencyStatementPDF(filePath, filename) {
  const records = [];
  if (!pdfParse) { console.error('pdf-parse not installed'); return records; }
  
  try {
    const dataBuffer = fs.readFileSync(filePath);
    const data = await pdfParse(dataBuffer);
    const text = data.text;
    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);

    // Payment cycle batch for this statement file (not per-row commission coverage date).
    const now = new Date();
    const uploadPeriod = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
    const cyclePeriod = resolveNhpPaymentPeriod({
      filename,
      statementDate: (text.match(/Statement\s*Date[:\s]+([A-Za-z]+\s+\d{1,2},?\s+20\d{2}|\d{1,2}\/\d{1,2}\/20\d{2})/i) || [])[1],
      cycleDate: (text.match(/Payment\s*Cycle[:\s]+([A-Za-z]+\s+\d{1,2},?\s+20\d{2}|\d{1,2}\/\d{1,2}\/20\d{2})/i) || [])[1],
      uploadPeriod,
    });

    // Helper: Title Case
    const toTitleCase = (str) =>
      str.trim().toLowerCase().replace(/\b\w/g, c => c.toUpperCase());

    let currentCarrier = null;
    let currentLOB = null;
    let currentAgent = null;
    let currentNPN = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Detect section header: "Oscar · ACA"
      const sectionMatch = line.match(/^(\w+)\s*·\s*(ACA|Medicare|Life)$/i);
      if (sectionMatch) {
        currentCarrier = sectionMatch[1].trim();
        currentLOB = sectionMatch[2].trim().toUpperCase();
        // Map carrier name
        if (currentCarrier.toLowerCase() === 'oscar') {
          currentCarrier = 'Oscar Health';
        }
        console.log(`[NHP] Section: ${currentCarrier} · ${currentLOB}`);
        continue;
      }

      // Detect agent header: "Eduardo Pernia · NPN 17676534"
      const agentMatch = line.match(/^(.+?)\s*·\s*NPN\s+(\d+)$/i);
      if (agentMatch) {
        currentAgent = toTitleCase(agentMatch[1].trim());
        currentNPN = agentMatch[2].trim();
        console.log(`[NHP] Agent: ${currentAgent} (NPN ${currentNPN})`);
        continue;
      }

      // Skip non-data lines
      if (!currentCarrier || !currentAgent) continue;
      if (line.startsWith('Policy') || line.startsWith('Commission Date') || line.startsWith('Name')) continue;
      if (line.startsWith('Agent subtotal') || line.startsWith('Generated ') || line.startsWith('Agency Statement')) continue;

      // Parse concatenated row: OSC75522291-01May 1, 2026Michelle DayFL2$7.00$7.00
      const rowMatch = line.match(/^(OSC\d{8}-\d{2})([A-Za-z]{3}\s+\d{1,2},\s+\d{4})(.+?)([A-Z]{2})(\d+)\$([\d,]+\.\d{2})\$([\d,]+\.\d{2})$/);
      
      if (rowMatch) {
        const policy = rowMatch[1].trim();
        const commDate = rowMatch[2].trim();
        const client = rowMatch[3].trim();
        const state = rowMatch[4].trim();
        const members = parseInt(rowMatch[5].trim());
        const amount = parseFloat(rowMatch[6].replace(/,/g, ''));

        if (!cyclePeriod || cyclePeriod === 'Unknown') {
          console.log(`[NHP] Skip - no payment cycle period for ${filename}`);
          continue;
        }

        // Validate: Lives × $3.50 should equal commission (ACA rate)
        const expectedAmount = members * 3.50;
        if (Math.abs(amount - expectedAmount) > 0.01) {
          console.log(`[NHP] Warning - amount mismatch: ${policy} (expected $${expectedAmount.toFixed(2)}, got $${amount.toFixed(2)})`);
        }

        console.log(`[NHP] Record: ${currentAgent} | ${client} | ${policy} | $${amount}`);

        records.push({
          agent: currentAgent,
          carrier: currentCarrier,
          planType: `${currentCarrier} ${currentLOB}`,
          client: toTitleCase(client),
          effectiveDate: null,  // Not available in statement
          premium: 0,
          commission: amount,
          classification: 'Agency Override',
          period: cyclePeriod,
          policyNumber: policy,
          payee: 'NHP',
          source: 'NHP',
          statementMonth: commDate, // coverage / commission date on the row
          raw: {}
        });
      }
    }

    const totalCommission = records.reduce((sum, r) => sum + (r.commission || 0), 0);
    console.log(`[NHP] Cycle period ${cyclePeriod} — parsed ${records.length} records, total: $${totalCommission.toFixed(2)}`);
  } catch (err) {
    console.error('parseNHPAgencyStatementPDF error:', err.message);
  }
  
  return records;
}

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
      if (!isValidClientName(client) || commission === 0) continue;
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
  
  const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  
  if (data.length < 5) return records;
  
  let headerRowIdx = -1;
  for (let i = 0; i < Math.min(10, data.length); i++) {
    const row = data[i];
    if (row.some(cell => String(cell).includes('Policy #')) && 
        row.some(cell => String(cell).includes('Name of Insured'))) {
      headerRowIdx = i;
      break;
    }
  }
  
  if (headerRowIdx === -1) return records;
  
  const headers = data[headerRowIdx];
  
  const colIdx = {
    policy: headers.findIndex(h => String(h).includes('Policy #')),
    name: headers.findIndex(h => String(h).includes('Name of Insured')),
    transType: headers.findIndex(h => String(h).includes('Transaction Type')),
    premium: headers.findIndex(h => String(h).includes('Premium Type')),
    product: headers.findIndex(h => String(h).includes('Product')),
    effectiveDate: headers.findIndex(h => String(h).includes('Effective Date') && !String(h).includes('Original')),
    commAmount: headers.findIndex(h => String(h).includes('Net Comm')),
  };
  
  let currentAgent = 'Yahoska G Perez';
  
  for (let i = headerRowIdx + 1; i < data.length; i++) {
    const row = data[i];
    const firstCell = String(row[0] || '').trim();
    
    if (firstCell === 'Commission Summary' || firstCell.startsWith('Note:')) {
      break;
    }
    
    if (firstCell.includes('Agent Number')) {
      const nameMatch = firstCell.match(/^(.+?)\s*\(Agent Number/);
      if (nameMatch) {
        currentAgent = nameMatch[1].trim();
      }
      continue;
    }
    
    if (firstCell.includes('NEW BUSINESS') || 
        firstCell.includes('RENEWAL BUSINESS') ||
        firstCell === 'ADJUSTMENT' ||
        firstCell === '') {
      continue;
    }
    
    const policy = String(row[colIdx.policy] || '').trim().split('_')[0];
    const client = String(row[colIdx.name] || '').trim();
    const transType = String(row[colIdx.transType] || '').trim();
    const product = String(row[colIdx.product] || '').trim();
    const effectiveDate = formatDate(row[colIdx.effectiveDate]);
    const commission = parseFloat(row[colIdx.commAmount]) || 0;
    
    if (!policy || !client || client === '') continue;
    
    let carrier = 'Humana';
    if (product.toLowerCase().includes('devoted')) carrier = 'Devoted';

    let classification = classifyTHECarrierTransaction({
      transactionType: transType,
      commission,
      carrier,
    });
    if (classification === 'Agent Commission' && transType.toLowerCase().includes('adjustment')) {
      classification = 'Adjustment';
    }

    const planType = derivePlanType(carrier, product, policy, '');
    
    let period = '';
    if (data[1]) {
      const statementRow = data[1].join(' ');
      const dateMatch = statementRow.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
      if (dateMatch) {
        const [_, month, day, year] = dateMatch;
        period = `${year}${month.padStart(2, '0')}`;
      }
    }
    
    records.push({
      agent: currentAgent,
      carrier,
      planType,
      client,
      effectiveDate,
      premium: 0,
      commission,
      classification,
      period,
      policyNumber: policy,
      payee: 'YourFMO',
      raw: Object.fromEntries(headers.map((h, i) => [h, row[i]]))
    });
  }
  
  return records;
}

// ─── Gold Kidney Parser ───────────────────────────────────────────────────────

function isGoldKidneyFile(wb) {
  if (!wb || !wb.SheetNames) return false;
  
  // Must have both 'Summary' and 'Detail' sheets
  const hasRequiredSheets = wb.SheetNames.includes('Summary') && wb.SheetNames.includes('Detail');
  if (!hasRequiredSheets) return false;
  
  // Check Detail sheet for required columns
  const detailSheet = wb.Sheets['Detail'];
  if (!detailSheet) return false;
  
  const data = XLSX.utils.sheet_to_json(detailSheet, { header: 1, defval: '', range: 0 });
  if (data.length < 2) return false;
  
  const headers = data[0].map(h => String(h || '').trim());
  const hasRepName = headers.some(h => h === 'Rep Name');
  const hasMemberHIC = headers.some(h => h === 'Member HIC');
  
  return hasRepName && hasMemberHIC;
}

function parseGoldKidneyRows(wb, filename) {
  const records = [];
  
  try {
    const detailSheet = wb.Sheets['Detail'];
    if (!detailSheet) {
      console.error('[GOLD_KIDNEY] Detail sheet not found');
      return records;
    }
    
    const data = XLSX.utils.sheet_to_json(detailSheet, { header: 1, defval: '' });
    if (data.length < 2) {
      console.error('[GOLD_KIDNEY] No data rows found');
      return records;
    }
    
    const headers = data[0].map(h => String(h || '').trim());
    const colIdx = {};
    
    // Map column indices
    headers.forEach((h, i) => {
      if (h === 'Rep Name') colIdx.repName = i;
      if (h === 'NPN') colIdx.npn = i;
      if (h === 'Member First Name') colIdx.memberFirst = i;
      if (h === 'Member Last Name') colIdx.memberLast = i;
      if (h === 'Member ID') colIdx.memberId = i;
      if (h === 'Member HIC') colIdx.memberHIC = i;
      if (h === 'Effective Date') colIdx.effectiveDate = i;
      if (h === 'Payment') colIdx.payment = i;
      if (h === 'Plan Group Name') colIdx.planGroup = i;
      if (h === 'Member Year') colIdx.memberYear = i;
      if (h === 'Level') colIdx.level = i;
    });
    
    // Extract period from filename: JANUARY_2026 → 202601
    let period = '';
    const monthMap = {
      JANUARY: '01', FEBRUARY: '02', MARCH: '03', APRIL: '04',
      MAY: '05', JUNE: '06', JULY: '07', AUGUST: '08',
      SEPTEMBER: '09', OCTOBER: '10', NOVEMBER: '11', DECEMBER: '12'
    };
    
    const fnUpper = String(filename || '').toUpperCase();
    for (const [monthName, monthNum] of Object.entries(monthMap)) {
      const match = fnUpper.match(new RegExp(`${monthName}[_\\s]*(\\d{4})`));
      if (match) {
        period = match[1] + monthNum;
        break;
      }
    }
    
    // Fallback: Use upload date
    if (!period) {
      const now = new Date();
      period = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
    }
    
    // Process data rows
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      
      const repName = String(row[colIdx.repName] || '').trim();
      const npn = String(row[colIdx.npn] || '').trim();
      const memberFirst = String(row[colIdx.memberFirst] || '').trim();
      const memberLast = String(row[colIdx.memberLast] || '').trim();
      const memberId = String(row[colIdx.memberId] || '').trim();
      const memberHIC = String(row[colIdx.memberHIC] || '').trim();
      const effectiveDateRaw = row[colIdx.effectiveDate];
      const payment = parseFloat(row[colIdx.payment]) || 0;
      const planGroup = String(row[colIdx.planGroup] || '').trim();
      const memberYear = row[colIdx.memberYear];
      const level = String(row[colIdx.level] || '').trim();
      
      // Skip empty rows
      if (!memberFirst || !memberLast || payment === 0) continue;
      
      // Combine first + last name, title case
      const clientFullName = `${memberFirst} ${memberLast}`
        .split(' ')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(' ');
      
      const effectiveDate = formatDate(effectiveDateRaw);
      
      // Classification logic based on Member Year
      let classification;
      if (payment < 0) {
        classification = 'Chargeback';
      } else if (memberYear === 1 || memberYear === '1') {
        classification = 'New Business';
      } else if (memberYear > 1 || (typeof memberYear === 'string' && parseInt(memberYear) > 1)) {
        classification = 'Renewal';
      } else {
        classification = 'Agent Commission';
      }
      
      const agent = normalizeAgentName(repName) || 'The Health Experts Insurance';
      
      records.push({
        agent,
        carrier: 'Gold Kidney',
        planType: planGroup || 'Gold Kidney Med Adv',
        client: clientFullName,
        effectiveDate,
        premium: 0,
        commission: payment,
        classification,
        period,
        policyNumber: memberId,
        payee: 'Gold Kidney',
        lob: 'MA',
        raw: {
          npn,
          memberHIC,
          memberYear,
          level
        }
      });
    }
    
  } catch (err) {
    console.error('[GOLD_KIDNEY] Parser error:', err.message);
  }
  
  return records;
}

// ─── Duplicate Detection ──────────────────────────────────────────────────────

// Within-batch: src/uploadBatchDedupe.js (keep first exact duplicate line)
function findInternalDuplicates(records) {
  return require('../src/uploadBatchDedupe').findInternalDuplicates(records);
}

// Check for duplicates against EXISTING database records
async function findDuplicates(pool, records) {
  if (!records.length) return [];
  const filtered = records.filter(r => r.client && r.effectiveDate && r.policyNumber);
  if (!filtered.length) return [];

  // Match key: policy_number + client_name + effective_date + commission_amount + payment_period
  // payment_period is required: monthly renewals repeat the same policy/client/date/amount every month
  // Without it, every renewal upload after the first gets flagged as a cross-month duplicate
  const conditions = filtered.map((r, i) =>
    `(policy_number = $${i*5+1} AND LOWER(client_full_name) = LOWER($${i*5+2}) AND effective_date = $${i*5+3} AND commission = $${i*5+4} AND payment_period = $${i*5+5})`
  ).join(' OR ');

  const params = filtered.flatMap(r => [r.policyNumber, r.client, r.effectiveDate, r.commission, r.period || '']);

  const result = await pool.query(
    `SELECT policy_number, client_full_name, effective_date, commission, payment_period FROM commission_records WHERE ${conditions}`,
    params
  );

  const existingSet = new Set(result.rows.map(r =>
    `${r.policy_number}|${r.client_full_name.toLowerCase()}|${r.effective_date}|${r.commission}|${r.payment_period || ''}`
  ));

  return filtered.filter(r =>
    existingSet.has(`${r.policyNumber}|${r.client.toLowerCase()}|${r.effectiveDate}|${r.commission}|${r.period || ''}`)
  ).map(r => ({
    client: r.client,
    carrier: r.carrier,
    date: r.effectiveDate,
    amount: r.commission,
    agent: r.agent,
    policy: r.policyNumber,
    type: r.classification
  }));
}

// ─── Upload route ─────────────────────────────────────────────────────────────
router.post('/upload', requireAuth, requireAdmin, upload.single('file'), async (req, res) => {
  console.log('[UPLOAD] ===== FILE RECEIVED =====');
  console.log('[UPLOAD] Filename:', req.file?.originalname);
  console.log('[UPLOAD] Mimetype:', req.file?.mimetype);
  console.log('[UPLOAD] Size:', req.file?.size, 'bytes');
  
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  try {
    const fnLc = String(req.file.originalname || '').toLowerCase();
    if (/moo|mutual.?of.?omaha|united.?of.?omaha/i.test(fnLc)) {
      try { fs.unlinkSync(req.file.path); } catch (e) {}
      return res.status(400).json({
        error: 'Mutual / United of Omaha statements are not part of THEI\'s books. Upload to the partner agency\'s system instead.',
      });
    }

    const pool = getPool();
    let storedOriginalName = req.file.originalname;
    const existing = await pool.query('SELECT id FROM uploads WHERE original_name = $1', [storedOriginalName]);
    if (existing.rows.length > 0) {
      const renamed = resolveNhpUploadOriginalName(storedOriginalName, true);
      if (!renamed) {
        try { fs.unlinkSync(req.file.path); } catch (e) {}
        return res.status(409).json({ error: `"${storedOriginalName}" has already been uploaded. Delete it first.` });
      }
      console.log(`[UPLOAD] NHP duplicate filename — storing as ${renamed}`);
      storedOriginalName = renamed;
    }

    const determinePayee = (filename) => {
      // Normalize spaces → underscores so "Statement-health experts.pdf" matches
      // the same patterns as "Statement-health_experts.pdf".
      const f = String(filename || '').toLowerCase().replace(/\s+/g, '_');
      if (f.includes('medicare_statement_-the-')) return 'BSI'; // consolidated BSI book PDF
      if (f.includes('medicare_statement-the') || f.includes('medicare_statement_the')) return 'THE';
      if (f.includes('commission_statement_2737247')) return 'UnitedHealthcare';
      if (f.includes('statement-health_experts') || f.includes('statement_health_experts')) return 'BSI';
      if (f.includes('health_experts-') || (f.includes('health_experts') && f.includes('statement'))) return 'BSI';
      if (f.includes('the_health_experts_insurance_statement') || f.includes('the_health_experst_insurance') || (f.includes('yahoska') && f.includes('katy'))) return 'NHP';
      if (f.includes('commission-statement') || f.includes('integrity') || f.includes('apl')) return 'APL';
      if (f.includes('commissions_ledger') || f.includes('solis')) return 'Solis';
      if (f.includes('moo') || f.includes('mutual')) return 'Mutual of Omaha';
      if (f.includes('contracts_commissiondetails')) return 'BSI'; // AML portal export
      if (f.includes('yourfmo') || f.includes('commissiondetails')) return 'YourFMO';
      if (f.includes('commissiondata') || f.includes('humana')) return 'Humana';
      if (f.includes('devoted')) return 'Devoted';
      if (f.includes('aetna') || f.includes('producerstatement')) return 'Aetna';
      if (f.includes('agentview') || f.includes('agentcommissionreport') || f.includes('cnhic')) return 'Direct';
      return 'Direct';
    };
    const defaultPayee = determinePayee(req.file.originalname);

    let records;

    // AgentView CNHIC / HealthSpring — filename OR PDF text sniff
    {
      const agentViewRows = await tryParseAgentViewUpload(
        req.file.path,
        req.file.originalname,
        pdfParse
      );
      if (agentViewRows) {
        console.log('[UPLOAD] Using AgentView CNHIC Commission Report PDF parser');
        if (!pdfParse) {
          try { fs.unlinkSync(req.file.path); } catch(e) {}
          return res.status(500).json({ error: 'PDF parsing not available on server.' });
        }
        records = agentViewRows;
        if (!records.length) {
          try { fs.unlinkSync(req.file.path); } catch(e) {}
          return res.status(400).json({
            error: 'No earnings rows found in AgentView Commission Report. Confirm CNHIC/HealthSpring Med Supp earnings are on the PDF.',
          });
        }
      }
    }

    if (records) {
      // already parsed (AgentView)
    } else if (isMOOExcel(req.file.originalname)) {
      const wb = XLSX.readFile(req.file.path);
      records = parseMOOExcelRows(wb, req.file.originalname);
      if (!records.length) {
        try { fs.unlinkSync(req.file.path); } catch(e) {}
        return res.status(400).json({ error: 'No payable records found in MOO Excel statement.' });
      }
    } else if (isTHEStatementPDF(req.file.originalname)) {
      if (!pdfParse) {
        try { fs.unlinkSync(req.file.path); } catch(e) {}
        return res.status(500).json({ error: 'PDF parsing not available on server.' });
      }
      records = await parseTHEStatementPDF(req.file.path, req.file.originalname);
      if (!records.length) {
        try { fs.unlinkSync(req.file.path); } catch(e) {}
        return res.status(400).json({ error: 'No records found in THE statement PDF.' });
      }
    } else if (isNHPAgencyStatementPDF(req.file.originalname)) {
      console.log('[UPLOAD] Using NHP Agency Statement PDF parser');
      if (!pdfParse) {
        try { fs.unlinkSync(req.file.path); } catch(e) {}
        return res.status(500).json({ error: 'PDF parsing not available on server.' });
      }
      records = await parseNHPAgencyStatementPDF(req.file.path, req.file.originalname);
      if (!records.length) {
        try { fs.unlinkSync(req.file.path); } catch(e) {}
        return res.status(400).json({ error: 'No records found in NHP Agency Statement PDF. Verify this is an NHP agency override statement.' });
      }
    } else if (isBSIConsolidatedPDF(req.file.originalname)) {
      if (!pdfParse) {
        try { fs.unlinkSync(req.file.path); } catch(e) {}
        return res.status(500).json({ error: 'PDF parsing not available on server.' });
      }
      records = await parseBSIConsolidatedPDF(req.file.path, req.file.originalname);
      if (!records.length) {
        try { fs.unlinkSync(req.file.path); } catch(e) {}
        return res.status(400).json({ error: 'No records found in BSI statement PDF.' });
      }
    } else if (isBSIPDF(req.file.originalname)) {
      if (!pdfParse) {
        try { fs.unlinkSync(req.file.path); } catch(e) {}
        return res.status(500).json({ error: 'PDF parsing not available on server.' });
      }
      records = await parseBSIPDF(req.file.path, req.file.originalname);
      if (!records.length) {
        try { fs.unlinkSync(req.file.path); } catch(e) {}
        return res.status(400).json({ error: 'No records found in BSI PDF. Verify this is a BSI monthly statement.' });
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
    } else if (req.file.originalname.toLowerCase().endsWith('.pdf') && isDevotedFile(req.file.originalname)) {
      console.log('[UPLOAD] Using Devoted Health PDF parser');
      if (!pdfParse) {
        try { fs.unlinkSync(req.file.path); } catch(e) {}
        return res.status(500).json({ error: 'PDF parsing not available on server.' });
      }
      records = await parseDevotedPDF(req.file.path, req.file.originalname);
      if (!records.length) {
        try { fs.unlinkSync(req.file.path); } catch(e) {}
        return res.status(400).json({ error: 'No records found in Devoted PDF. Verify this is a Devoted Health commission statement.' });
      }
    } else {
      console.log('[UPLOAD] Reading Excel file:', req.file.originalname);
      const wb = XLSX.readFile(req.file.path);
      const ws = wb.Sheets[wb.SheetNames[0]];
      console.log('[UPLOAD] Workbook sheets:', wb.SheetNames);
      console.log('[UPLOAD] Starting parser detection chain...');

      // BSI → THE remittance CSV (e.g. "JULY - THE" / T.H.E_STATEMENTS) — Commission Statements tab
      if (isTheRemittanceStatement(wb, req.file.originalname)) {
        console.log('[UPLOAD] Using BSI→THE remittance statement parser');
        records = parseTheRemittanceStatement(wb, req.file.originalname);
      } else if (isYourFMOXLSX(req.file.originalname)) {
        console.log('[UPLOAD] Using YourFMO XLSX parser');
        records = parseYourFMOXLSXRows(wb);
      } else if (isUHCDirectFile(req.file.originalname)) {
        console.log('[UPLOAD] Using UHC Direct Commission parser (706381 - MedSup + Part D only)');
        records = parseUHCDirectRows(wb, req.file.originalname);
      } else if (isUHCFile(req.file.originalname)) {
        console.log('[UPLOAD] Using UHC parser');
        records = parseUHCRows(wb, req.file.originalname);
      } else if (isBSIFile(req.file.originalname)) {
        console.log('[UPLOAD] Using BSI parser');
        records = parseBSIRows(wb, req.file.originalname);
      } else if (parseTHECarrierStatementRows(wb, req.file.originalname) !== null) {
        console.log('[UPLOAD] Using THEI carrier statement parser');
        records = parseTHECarrierStatementRows(wb, req.file.originalname);
      } else if (isDevotedFile(req.file.originalname) || isDevotedXLS(wb)) {
        console.log('[UPLOAD] Using Devoted Health parser');
        records = parseDevotedRows(wb, req.file.originalname);
      } else if ((console.log('[UPLOAD] Testing Oscar IFP...'), isOscarIFPFile(wb))) {
        console.log('[UPLOAD] ✓ Oscar IFP detection MATCHED!');
        console.log('[UPLOAD] Using Oscar IFP parser');
        records = parseOscarIFPRows(wb, req.file.originalname);
      } else if (isGoldKidneyFile(wb)) {
        console.log('[UPLOAD] ✓ Gold Kidney detection MATCHED!');
        console.log('[UPLOAD] Using Gold Kidney parser');
        records = parseGoldKidneyRows(wb, req.file.originalname);
      } else if (isMolinaACAFile(req.file.originalname)) {
        records = parseMolinaACARows(wb, req.file.originalname);
      } else if (isNHPFile(req.file.originalname)) {
        // One file = one NHP payment-cycle batch (deposit/statement), not coverage month.
        const now = new Date();
        const uploadPeriod = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
        records = parseNHPRows(wb, uploadPeriod, req.file.originalname);
        const periods = {};
        for (const r of records) {
          periods[r.period] = (periods[r.period] || 0) + 1;
        }
        console.log('[UPLOAD] NHP payment-cycle period breakdown:', periods);
      } else if (isYourFMOFile(req.file.originalname)) {
        records = parseYourFMORows(wb, req.file.originalname);
      } else if (isHumanaFile(req.file.originalname)) {
        const rawBuffer = fs.readFileSync(req.file.path);
        records = parseHumanaRows(wb, req.file.originalname, rawBuffer);
      } else if (isDoctorsFile(req.file.originalname)) {
        records = parseSolisRows(wb, req.file.originalname);
      } else if (isSolisFile(req.file.originalname)) {
        records = parseSolisRows(wb, req.file.originalname);
      } else if (isHealthSunFile(req.file.originalname)) {
        const ws = wb ? wb.Sheets[wb.SheetNames[0]] : null;
        // Handle CSV — parse manually
        const csvText = fs.readFileSync(req.file.path, 'utf-8');
        const csvWb = XLSX.read(csvText, { type: 'string' });
        records = parseHealthSunRows(csvWb.Sheets[csvWb.SheetNames[0]], req.file.originalname);
        if (!records.length) {
          try { fs.unlinkSync(req.file.path); } catch(e) {}
          return res.status(400).json({ error: 'No records found in HealthSun commission report.' });
        }
      } else if (isAPLFile(req.file.originalname)) {
        records = parseAPLRows(wb);
      } else if (isAetnaBSICSVFilename(req.file.originalname)) {
        console.log('[ROUTING] Matched Aetna BSI CSV parser for:', req.file.originalname);
        records = parseAetnaBSICSV(wb, req.file.originalname);
      } else if (isAetnaDirectCSVFilename(req.file.originalname) || isAetnaDirectCSV(wb)) {
        console.log('[ROUTING] Matched Aetna Direct CSV parser for:', req.file.originalname);
        records = parseAetnaDirectCSV(wb, req.file.originalname);
      } else if (isAMLPortalExportFile(req.file.originalname, wb)) {
        console.log('[ROUTING] Matched AML portal export parser for:', req.file.originalname);
        records = parseAMLPortalRows(wb, req.file.originalname);
        if (!records.length) {
          try { fs.unlinkSync(req.file.path); } catch(e) {}
          return res.status(400).json({ error: 'No records found in AML portal export. Verify this is a Contracts/CommissionDetails CSV.' });
        }
      } else if (isHealthSpringFile(req.file.originalname) || isHealthSpringWb(wb)) {
        console.log('[ROUTING] Matched HealthSpring parser for:', req.file.originalname);
        records = parseHealthSpringRows(wb, req.file.originalname);
      } else if (isAetnaFile(req.file.originalname)) {
        console.log('[ROUTING] Matched generic Aetna parser for:', req.file.originalname);
        records = parseAetnaRows(wb, req.file.originalname);
      } else {
        console.log('[UPLOAD] No specific parser matched, using generic AI mapper');
        const rows = XLSX.utils.sheet_to_json(ws, { defval: '', raw: true });
        if (!rows.length) return res.status(400).json({ error: 'File is empty' });
        const headers = Object.keys(rows[0]);
        console.log('[UPLOAD] Generic parser headers:', headers.slice(0, 10));
        const mapping = await mapColumnsWithAI(headers, rows.slice(0, 3));
        records = parseRows(rows, mapping, req.file.originalname);
      }
    }

    records = records.map(r => ({ ...r, payee: r.payee || defaultPayee }));

    {
      const fnLc = String(req.file.originalname || '').toLowerCase();
      const fnNorm = fnLc.replace(/\s+/g, '_');
      const payeeLc = String(defaultPayee || '').toLowerCase();
      let inferredSource = 'direct_carrier';
      // NHP agency statements BEFORE BSI patterns — "Agency-Statement-The_Health_Experts…"
      // previously matched /statement-the/ and was mistagged BSI (Oscar/ACA landed on BSI house).
      if (
        payeeLc === 'nhp' ||
        /agency[-_]statement.*health_experts|the_health_experts_insurance_statement|the_health_experst|\/nhp|nhp_commission|(^|_)nhp(_|$)/.test(fnNorm) ||
        (fnNorm.includes('health_experts') && fnNorm.includes('statement') && !/statement-health_experts|statement_health_experts/.test(fnNorm))
      ) {
        inferredSource = 'NHP';
      } else if (
        payeeLc === 'bsi' ||
        /statement-the(?![_\s-]?health)|statement_-the(?![_\s-]?health)|broker_society|(^|_)bsi(_|$)|statement-health_experts|statement_health_experts/.test(fnNorm)
      ) {
        inferredSource = 'BSI';
      }

      // Build overrideSet for agent-direct pass-through detection (mirrors /backfill-business-rules logic)
      const overrideRowsUpload = await pool.query(`
        SELECT DISTINCT LOWER(agent_name) AS agent, LOWER(carrier) AS carrier
        FROM commission_records
        WHERE classification = 'Agency Override' AND source IS NOT NULL
      `);
      const overrideSetUpload = new Set(overrideRowsUpload.rows.map(r => `${r.agent}|${r.carrier}`));

      // Integrity Partners agents: 50% producer / 25% THEI / 25% BSI
      const INTEGRITY_AGENTS_UPLOAD = ['christian munoz', 'horacio mendieta', 'cam insurance solutions corp'];

      // Marco agents: $10 deduction per policy first occurrence, then 50/50 THEI/BSI
      const MARCO_AGENTS_UPLOAD = ['jena brewer','kelly carpenter','adrian cruz','long khuu',
        'nicholas mccalla','tyler payton','anthony portorreal','michael rivera',
        'cristy witcher','michael mateo','miriam jimenez','jendy vanheyningen'];

      // Pre-existing deducted policies — prevents re-deducting on re-upload of same statement
      const alreadyDeductedUpload = await pool.query(`
        SELECT DISTINCT policy_number FROM commission_records
        WHERE classification = 'Agency Override' AND sub_agent_override > 0
      `);
      const deductedPoliciesUpload = new Set(alreadyDeductedUpload.rows.map(r => r.policy_number));

      // Sort by period ASC so Marco's $10 deduction always hits earliest occurrence per policy
      records.sort((a, b) => (a.period || '').localeCompare(b.period || ''));

      records = records.map(r => {
        if (r.source) return r;

        const agentLc = String(r.agent || '').toLowerCase();
        const carrierLc = String(r.carrier || '').toLowerCase();
        const classification = String(r.classification || '').toLowerCase();
        const isCommissionRow = classification.includes('agent commission') || classification === 'commission';
        const isAcaCarrier = ACA_CARRIERS_LIST.some(c => carrierLc.includes(c));
        const isAcaPassThroughAgent = NO_SPLIT_AGENTS.some(a => agentLc.includes(a));

        const netCommission = parseFloat(r.commission) || 0;
        const recordPayeeLc = String(r.payee || defaultPayee || '').toLowerCase().trim();
        // BSI payee books store the FULL override pot in commission → split 50/50.
        // THE remittance files (payee THE, source BSI) store THEI's half already.
        const isBsiFullPot = recordPayeeLc === 'bsi';

        // Agent-direct rows: NB/Renewal/Chargeback for agents with a known Agency Override relationship
        const isAgentDirectRow = classification === 'new business' || classification === 'renewal' || classification === 'chargeback';
        const hasMatchingOverride = overrideSetUpload.has(`${agentLc}|${carrierLc}`);
        const isIntegrityPartnersUpload = INTEGRITY_AGENTS_UPLOAD.some(n => agentLc.includes(n));
        const isJendyPostCutoffUpload = agentLc.includes('jendy vanheyningen') && (r.period || '') >= '202606';
        const isMarcoAgentUpload = MARCO_AGENTS_UPLOAD.some(n => agentLc.includes(n)) && !isJendyPostCutoffUpload;

        let splitApplies, theiShare, bsiShare, producerPayable, grossCommission;
        let subAgentOverride = 0;

        if (isCommissionRow) {
          splitApplies = false;
          grossCommission = netCommission;
          theiShare = 0;
          bsiShare = 0;
          producerPayable = grossCommission;
        } else if (isAcaCarrier) {
          splitApplies = false;
          grossCommission = netCommission;
          if (isAcaAgencyPaysProducer(r.carrier) && isAcaPassThroughAgent) {
            theiShare = 0; bsiShare = 0; producerPayable = grossCommission;
          } else {
            theiShare = grossCommission; bsiShare = 0; producerPayable = 0;
          }
        } else if (inferredSource === 'direct_carrier' && recordPayeeLc !== 'bsi') {
          // True direct-carrier pulls keep 100% THEI. Never treat payee=BSI this way.
          splitApplies = false;
          grossCommission = netCommission;
          theiShare = netCommission;
          bsiShare = 0;
          producerPayable = 0;
        } else if (isAgentDirectRow && hasMatchingOverride) {
          splitApplies = false;
          grossCommission = netCommission;
          theiShare = 0;
          bsiShare = 0;
          producerPayable = grossCommission;
        } else if (classification === 'agency override' && isIntegrityPartnersUpload) {
          // Integrity Partners (Christian Munoz, Horacio Mendieta, CAM): 50% producer / 25% THEI / 25% BSI
          splitApplies = false;
          grossCommission = netCommission;
          producerPayable = Math.round(grossCommission * 0.50 * 100) / 100;
          theiShare = Math.round(grossCommission * 0.25 * 100) / 100;
          bsiShare = Math.round(grossCommission * 0.25 * 100) / 100;
        } else if (classification === 'agency override' && isMarcoAgentUpload) {
          // Marco agents: $10 flat deduction on first Override occurrence per policy, then 50/50 THEI/BSI
          // records sorted by period ASC above so earliest occurrence gets the deduction
          splitApplies = false;
          grossCommission = netCommission;
          producerPayable = 0;
          const alreadyDeductedU = deductedPoliciesUpload.has(r.policyNumber);
          if (!alreadyDeductedU && Math.abs(grossCommission) >= 10) {
            subAgentOverride = grossCommission < 0 ? -10 : 10;
            theiShare = Math.round((grossCommission - subAgentOverride) / 2 * 100) / 100;
            bsiShare = Math.round((grossCommission - subAgentOverride) / 2 * 100) / 100;
            deductedPoliciesUpload.add(r.policyNumber);
          } else {
            subAgentOverride = 0;
            theiShare = Math.round(grossCommission / 2 * 100) / 100;
            bsiShare = Math.round(grossCommission / 2 * 100) / 100;
          }
        } else if (classification === 'agency override' && isBsiFullPot) {
          // BSI book: statement amount is the FULL override pot → THEI/BSI 50/50
          splitApplies = true;
          grossCommission = netCommission;
          theiShare = Math.round(netCommission * 0.5 * 100) / 100;
          bsiShare = Math.round(netCommission * 0.5 * 100) / 100;
          producerPayable = 0;
        } else {
          // THE remittance half-model: amount is already THEI's half → mirror to BSI
          splitApplies = true;
          grossCommission = Math.round(netCommission * 2 * 100) / 100;
          theiShare = netCommission;
          bsiShare = netCommission;
          producerPayable = 0;
        }

        let lob = null;
        const planTypeLc = String(r.planType || r.plan_type || '').toLowerCase();
        // FIX: Check PDP and MedSupp BEFORE generic MA check
        if (/pdp|partd|part d/.test(planTypeLc)) lob = 'PDP';
        else if (/med ?supp|medigap|supplement/.test(planTypeLc)) lob = 'MedSupp';
        else if (/med adv|mapd|advantage/.test(planTypeLc)) lob = 'MA';
        else if (/aca|marketplace/.test(planTypeLc) || isAcaCarrier) lob = 'ACA';
        else if (/dental/.test(planTypeLc)) lob = 'Dental';
        else if (/vision/.test(planTypeLc)) lob = 'Vision';
        else if (/life/.test(planTypeLc)) lob = 'Life';
        else if (/humana|aetna|united|devoted|wellcare|cigna|solis|doctors|healthsun|avmed|simply|molina/.test(carrierLc)) lob = 'MA';

        return {
          ...r,
          // Keep parser-set source (e.g. NHP Agency Statement PDF) over filename inference.
          source: r.source || inferredSource,
          policyWrittenDate: r.policyWrittenDate || r.effectiveDate || null,
          grossCommission,
          theiShare,
          bsiShare,
          producerPayable,
          splitApplies,
          lob,
          subAgentOverride: subAgentOverride,
        };
      });
    }

    if (!records.length) return res.status(400).json({ error: 'No records found in file' });

    // Collapse exact duplicate lines within this file (Upload 374 class).
    // Commission is part of the key so pay/chargeback pairs with different amounts are kept.
    const beforeInternal = records.length;
    const collapsed = collapseInternalDuplicates(records);
    records = collapsed.records;
    const internalDuplicatesRemoved = collapsed.removedCount;
    if (internalDuplicatesRemoved > 0) {
      console.warn(
        `[UPLOAD] Collapsed ${internalDuplicatesRemoved} within-batch duplicate(s) ` +
        `(${beforeInternal} → ${records.length})`
      );
    }

    // Duplicate detection against database (policy + client + date + amount)
    const skipDuplicates = req.body.skipDuplicates === 'true';
    const ignoreDuplicates = req.body.ignoreDuplicates === 'true';

    if (!ignoreDuplicates) {
      const duplicates = await findDuplicates(pool, records);
      if (duplicates.length > 0 && !skipDuplicates) {
        try { fs.unlinkSync(req.file.path); } catch(e) {}
        return res.status(409).json({
          duplicateWarning: true,
          sourceType: 'statement', // Commission statement upload (softer warning for reconciliation)
          duplicateCount: duplicates.length,
          totalCount: records.length,
          duplicates: duplicates.slice(0, 23),
        });
      }
      if (duplicates.length > 0 && skipDuplicates) {
        // Parse selectedDuplicates from FormData (checkboxes)
        const selectedKeys = req.body.selectedDuplicates
          ? new Set(JSON.parse(req.body.selectedDuplicates).map(d =>
              `${d.client.toLowerCase()}|${d.carrier.toLowerCase()}|${d.date}`
            ))
          : new Set();

        const dupKeys = new Set(duplicates.map(d =>
          `${d.client.toLowerCase()}|${d.carrier.toLowerCase()}|${d.date}`
        ));

        records = records.filter(r => {
          const key = `${r.client?.toLowerCase()}|${r.carrier?.toLowerCase()}|${r.effectiveDate}`;
          if (!dupKeys.has(key)) return true; // not a duplicate, always include
          return selectedKeys.has(key); // duplicate — only include if user selected it
        });
      }
    }

    const commissionSum = records.reduce((s, r) => s + (r.commission || 0), 0);
    const carriers = [...new Set(records.map(r => r.carrier).filter(Boolean))];

    // Optional category from form: commission_statement (default) | agent_payout
    const rawCategory = String(req.body?.category || '').toLowerCase().trim();
    const uploadCategory = rawCategory === 'agent_payout' ? 'agent_payout' : 'commission_statement';

    try { await pool.query(`ALTER TABLE uploads ADD COLUMN IF NOT EXISTS category TEXT`); } catch (e) {}

    const uploadResult = await pool.query(
      'INSERT INTO uploads (filename, original_name, carrier, row_count, commission_sum, uploaded_by, category) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id',
      [req.file.filename, storedOriginalName, carriers.join(', '), records.length, commissionSum, req.user.id, uploadCategory]
    );
    const uploadId = uploadResult.rows[0].id;

    try { await pool.query(`ALTER TABLE commission_records ADD COLUMN IF NOT EXISTS plan_type TEXT DEFAULT ''`); } catch(e) {}
    try { await pool.query(`ALTER TABLE commission_records ADD COLUMN IF NOT EXISTS mga TEXT DEFAULT ''`); } catch(e) {}
    try { await pool.query(`ALTER TABLE commission_records ADD COLUMN IF NOT EXISTS payee TEXT DEFAULT ''`); } catch(e) {}
    try { await pool.query(`ALTER TABLE commission_records ADD COLUMN IF NOT EXISTS sub_agent_override NUMERIC DEFAULT 0`); } catch(e) {}
    try { await pool.query(`ALTER TABLE commission_records ADD COLUMN IF NOT EXISTS statement_month TEXT`); } catch(e) {}
    try { await pool.query(`ALTER TABLE commission_records ADD COLUMN IF NOT EXISTS members INTEGER DEFAULT 0`); } catch(e) {}
    try { await pool.query(`ALTER TABLE commission_records ADD COLUMN IF NOT EXISTS anomaly BOOLEAN DEFAULT false`); } catch(e) {}
    await ensurePassThroughSchema(pool);

    for (const r of records) {
      const liableAgent = resolvePassThroughLiableAgent({
        agentName: r.agent,
        clientName: r.client,
        commission: r.commission,
      });
      await pool.query(
        `INSERT INTO commission_records (
           upload_id, agent_name, carrier, plan_type, client_full_name, effective_date,
           premium, commission, classification, payment_period, policy_number, payee, mga,
           raw_data,
           source, policy_written_date, gross_commission, thei_share, bsi_share,
           producer_payable, split_applies, lob, sub_agent_override, statement_month, members,
           anomaly, member_state, liable_agent
         )
         VALUES (
           $1,$2,$3,$4,$5,$6,
           $7,$8,$9,$10,$11,$12,$13,
           $14,
           $15,$16,$17,$18,$19,
           $20,$21,$22,$23,$24,$25,
           $26,$27,$28
         )`,
        [
          uploadId, r.agent, r.carrier, r.planType || '', r.client, r.effectiveDate,
          r.premium || 0, r.commission || 0, r.classification, r.period, r.policyNumber, r.payee || '', r.mga || '',
          JSON.stringify(r.raw),
          r.source || null,
          (() => {
            const v = r.policyWrittenDate;
            if (!v) return null;
            const m = String(v).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
            if (m) return `${m[3]}-${m[1]}-${m[2]}`;
            const m2 = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
            if (m2) return `${m2[1]}-${m2[2]}-${m2[3]}`;
            return null;
          })(),
          r.grossCommission != null ? r.grossCommission : null,
          r.theiShare != null ? r.theiShare : null,
          r.bsiShare != null ? r.bsiShare : null,
          r.producerPayable != null ? r.producerPayable : null,
          r.splitApplies != null ? r.splitApplies : null,
          r.lob || null,
          r.subAgentOverride != null ? r.subAgentOverride : 0,
          r.statementMonth || null,
          r.members || 0,
          r.anomaly === true,
          r.memberState || null,
          liableAgent,
        ]
      );
    }

    try { fs.unlinkSync(req.file.path); } catch (e) {}
    
    // Auto-resolve chased/pending Missing Renewals when this upload pays them
    let resolvedRenewals = [];
    try {
      const resolvedBy = req.user?.email || req.user?.name || 'system';
      const result = await resolveChasedRenewals(pool, uploadId, resolvedBy);
      resolvedRenewals = result.resolved || [];
      if (resolvedRenewals.length) {
        console.log(`[UPLOAD] Auto-resolved ${resolvedRenewals.length} chased/pending renewals`);
      }
    } catch (err) {
      console.error('[UPLOAD] Renewals auto-resolve failed:', err.message);
    }

    // Run plan change detection asynchronously (don't block response)
    detectPlanChanges(pool, uploadId).catch(err => {
      console.error('[UPLOAD] Plan change detection failed:', err.message);
    });
    
    const response = { 
      uploadId, 
      filename: storedOriginalName,
      originalFilename: req.file.originalname,
      rowCount: records.length, 
      commissionSum, 
      carriers, 
      preview: records.slice(0, 5),
      resolvedRenewals,
      resolvedRenewalsCount: resolvedRenewals.length,
      internalDuplicatesRemoved: internalDuplicatesRemoved || 0,
      nhpRenamed: storedOriginalName !== req.file.originalname,
    };
    
    res.json(response);

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
    const category = req.query.category; // Filter by category if provided

    // Best-effort: Devoted overpay guards (THEI agent commission + BSI override)
    if (!category || category === 'commission_statement' || category === 'bsi_statement') {
      try {
        const { backfillDevotedCommissionGuards } = require('../src/theCarrierStatementClassify');
        const { agentFixed, bsiFixed } = await backfillDevotedCommissionGuards(pool);
        if (agentFixed || bsiFixed) {
          console.log(`[uploads] Devoted guards: agentCommission=${agentFixed}, bsiOverride=${bsiFixed}`);
        }
      } catch (e) {
        console.warn('[uploads] Devoted commission guards', e.message);
      }
    }

    let query, params = [];
    
    if (category === 'bsi_statement') {
      // BSI Statements only
      query = `SELECT u.*, usr.name as uploaded_by_name FROM uploads u LEFT JOIN users usr ON u.uploaded_by = usr.id WHERE u.category = 'bsi_statement' ORDER BY u.uploaded_at DESC`;
    } else if (category === 'agent_payout') {
      query = `SELECT u.*, usr.name as uploaded_by_name FROM uploads u LEFT JOIN users usr ON u.uploaded_by = usr.id WHERE u.category = 'agent_payout' ORDER BY u.uploaded_at DESC`;
    } else if (req.user.role === 'agent') {
      query = `SELECT u.*, usr.name as uploaded_by_name FROM uploads u LEFT JOIN users usr ON u.uploaded_by = usr.id WHERE u.uploaded_by = $1 AND (u.category IS NULL OR u.category = 'commission_statement') ORDER BY u.uploaded_at DESC`;
      params = [req.user.id];
    } else if (agency) {
      const isBSI = agency.toLowerCase().includes('broker society');
      const bsiCarriers = ['Mutual of Omaha','United of Omaha','Fidelity Life','Instabrain','F&G','Fidelity & Guaranty','American Amicable','Transamerica','Ethos','American Home Life','National Life Group'];
      const carrierClause = isBSI
        ? `carrier = ANY($1)`
        : `carrier != ALL($1)`;
      query = `SELECT DISTINCT u.*, usr.name as uploaded_by_name FROM uploads u LEFT JOIN users usr ON u.uploaded_by = usr.id WHERE u.id IN (SELECT DISTINCT upload_id FROM commission_records WHERE ${carrierClause}) AND (u.category IS NULL OR u.category = 'commission_statement') ORDER BY u.uploaded_at DESC`;
      params = [bsiCarriers];
    } else {
      query = `SELECT u.*, usr.name as uploaded_by_name FROM uploads u LEFT JOIN users usr ON u.uploaded_by = usr.id WHERE (u.category IS NULL OR u.category = 'commission_statement') ORDER BY u.uploaded_at DESC`;
    }
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/uploads/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const pool = getPool();
    await pool.query('DELETE FROM uploads WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/**
 * GET /api/files/uploads/:id/export?format=xlsx|csv
 * Download all commission_records for one upload (Commission / BSI / Agent Payout).
 */
router.get('/uploads/:id/export', requireAuth, async (req, res) => {
  try {
    const {
      sendTabularExport,
      COMMISSION_EXPORT_COLUMNS,
    } = require('../src/uploadDataExport');
    const pool = getPool();
    const uploadId = parseInt(req.params.id, 10);
    if (!Number.isFinite(uploadId)) {
      return res.status(400).json({ error: 'Invalid upload id' });
    }
    const uploadResult = await pool.query(
      `SELECT id, original_name, category FROM uploads WHERE id = $1`,
      [uploadId]
    );
    if (!uploadResult.rows.length) {
      return res.status(404).json({ error: 'Upload not found' });
    }
    const upload = uploadResult.rows[0];
    const records = await pool.query(
      `SELECT agent_name, carrier, plan_type, lob, client_full_name, policy_number,
              effective_date, payment_period, statement_month, classification,
              premium, commission, gross_commission, thei_share, bsi_share,
              producer_payable, sub_agent_override, payee, mga, source
       FROM commission_records
       WHERE upload_id = $1
       ORDER BY id`,
      [uploadId]
    );
    if (!records.rows.length) {
      return res.status(404).json({ error: 'No records found for this upload' });
    }
    return sendTabularExport(res, {
      rows: records.rows,
      columns: COMMISSION_EXPORT_COLUMNS,
      originalName: upload.original_name,
      format: req.query.format,
      sheetName: 'Commission Records',
    });
  } catch (err) {
    console.error('[files] upload export', err);
    res.status(500).json({ error: err.message });
  }
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

router.post('/fix-periods', requireAuth, requireAdmin, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  try {
    const pool = getPool();
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

router.post('/apply-bsi-split', requireAuth, requireAdmin, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  try {
    const pool = getPool();
    await pool.query(`ALTER TABLE commission_records ADD COLUMN IF NOT EXISTS bsi_split_applied BOOLEAN DEFAULT FALSE`).catch(() => {});

    const records = await pool.query(`
      SELECT cr.id, cr.agent_name, cr.carrier, cr.commission, cr.classification, u.original_name
      FROM commission_records cr
      JOIN uploads u ON cr.upload_id = u.id
      WHERE (
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
      const isOverride = String(r.classification || '').toLowerCase().includes('override');

      if (!isNoSplit && !isACA && isOverride) {
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

// POST /api/files/fix-aetna-classifications - Fix Aetna New Business → Renewal where effective date ≠ payment month
router.post('/fix-aetna-classifications', requireAuth, requireAdmin, async (req, res) => {
  try {
    const pool = getPool();
    
    // Update classification from "New Business" to "Renewal" where:
    // - Carrier = Aetna
    // - Period = 202601 (January 2026 payment)
    // - Effective date is NOT in January 2026
    // - Commission > 0 (don't change chargebacks)
    const result = await pool.query(`
      UPDATE commission_records
      SET classification = 'Renewal'
      WHERE carrier = 'Aetna'
        AND classification = 'New Business'
        AND payment_period = '202601'
        AND (effective_date < '2026-01-01' OR effective_date >= '2026-02-01')
        AND commission > 0
      RETURNING id, client_full_name, effective_date, commission
    `);

    res.json({
      success: true,
      updated: result.rowCount,
      records: result.rows,
      message: `Fixed ${result.rowCount} Aetna records from New Business → Renewal`
    });
  } catch (err) {
    console.error('Fix Aetna classifications error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── BSI CARRIER STATEMENT EXCEL PARSER ─────────────────────────────────────
// Handles BSI-provided carrier Excel statements (UHC, etc.)
// Different from THEI-direct UHC files: Agent Name/ID fields contain BSI,
// not THEI — so we use Writing Agent Name directly without isAgencyName() gating.
// Detect Humana/Devoted BSI split files by filename prefix
// ─── AML AGENCY PORTAL EXPORT PARSER ────────────────────────────────────────
// Format: Contracts_CommissionDetails_AMLAgency_{id}_{timestamp}.CSV
// One row per Writing Agent per week — payee-level cash flow, NOT per-policy.
// Policy # and Insured Name ARE present → feeds existing isIntegrityPartners/isMarcoAgent splits.
// source is NOT set here — determinePayee() returns 'BSI' for this filename pattern,
// so the upload-time map() assigns source = 'BSI' and runs the correct split branches.
function isAMLPortalExportFile(filename, wb) {
  const f = (filename || '').toLowerCase().replace(/[\s-]+/g, '_');
  if (f.includes('contracts_commissiondetails')) return true;
  // Fallback: header signature check (filename may vary)
  try {
    const ws = wb && wb.Sheets[wb.SheetNames[0]];
    if (!ws) return false;
    const firstRow = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })[0] || [];
    const headers = firstRow.map(h => String(h || '').trim());
    return headers.includes('Writing Agent') &&
           headers.includes('Policy #') &&
           headers.includes('Commission Type');
  } catch (e) { return false; }
}

function parseAMLPortalRows(wb, filename) {
  const records = [];
  const ws = wb.Sheets[wb.SheetNames[0]];
  // raw:true preserves numeric types — Commission ($) arrives as float, Statement Date as Excel serial
  const rows = XLSX.utils.sheet_to_json(ws, { defval: '', raw: true });

  // Currency: handles '$648.96', '-$50.00', '($289.17)', '$0.00'
  // Under raw:true, double-quoted CSV currency values arrive as numbers already parsed by XLSX
  function parseCurrency(val) {
    const s = String(val || '').trim();
    const negative = (s.startsWith('(') && s.endsWith(')')) || s.startsWith('-');
    const num = parseFloat(s.replace(/[$,()/]/g, '').replace(/^-/, '')) || 0;
    return negative ? -num : num;
  }

  // Period from Excel serial OR 'MM/DD/YYYY' string -> 'YYYYMM'
  // Statement Date arrives as Excel serial under raw:true (1899-12-30 epoch, same as HealthSun/Solis)
  function parsePeriod(val) {
    if (typeof val === 'number' && val > 40000) {
      const d = new Date(Date.UTC(1899, 11, 30));
      d.setUTCDate(d.getUTCDate() + Math.floor(val));
      return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    }
    // Fallback: string 'MM/DD/YYYY' — 4-digit year required, 2-digit falls through to Unknown
    const m = String(val || '').match(/^(\d{2})\/\d{2}\/(20\d{2})$/);
    if (m) return m[2] + m[1];
    return 'Unknown';
  }

  for (const row of rows) {
    const writingAgentRaw   = String(row['Writing Agent'] || '').trim();
    const insuredName       = String(row['Insured Name'] || '').trim();
    const policyNumber      = String(row['Policy #'] || '').trim();
    const carrierRaw        = String(row['Carrier'] || '').trim();
    const statementDate     = row['Statement Date'] ?? ''; // preserve number type for Excel serial conversion in parsePeriod
    const originalEffDate   = row['Original EffectiveDate'] || row['Effective Date'] || '';
    const commissionType    = String(row['Commission Type'] || '').trim();
    const productRaw        = String(row['Product'] || '').trim();
    const stateRaw          = String(row['State'] || '').trim();
    const commission        = parseCurrency(row['Commission ($)']);
    // Status field: ignored per spec — include every row regardless

    if (!isValidClientName(insuredName)) continue;
    if (!policyNumber) continue;

    // Classification: 'Agency Override' for positive, 'Chargeback' for negative
    // Commission Type confirmed 100% 'Override' in sample; log if different
    let classification;
    if (commission < 0) {
      classification = 'Chargeback';
    } else {
      classification = 'Agency Override';
      if (commissionType && commissionType.toUpperCase() !== 'OVERRIDE') {
        console.warn(`[AML-PORTAL] Unexpected Commission Type '${commissionType}' for policy ${policyNumber} — classifying as Agency Override`);
      }
    }

    // Writing Agent is the individual; normalize same as other parsers
    const agent = isAgencyName(writingAgentRaw)
      ? 'The Health Experts Insurance'
      : (normalizeAgentName(writingAgentRaw) || writingAgentRaw || 'BSI Agent');

    // Carrier
    const carrierLower = carrierRaw.toLowerCase();
    let carrier;
    if (carrierLower.includes('humana'))        carrier = 'Humana';
    else if (carrierLower.includes('devoted'))  carrier = 'Devoted Health';
    else                                         carrier = carrierRaw;

    const period        = parsePeriod(statementDate);
    const effectiveDate = formatDate(originalEffDate);
    const planType      = derivePlanType(carrier, productRaw, policyNumber, '');

    // source NOT set here — determinePayee() returns 'BSI' for this filename,
    // so the upload-time map() assigns source='BSI' and runs split branches correctly
    records.push({
      agent,
      carrier,
      planType,
      client: insuredName,
      effectiveDate,
      premium: 0,
      commission,
      classification,
      period,
      policyNumber,
      payee: 'BSI',
      memberState: stateRaw,
      statementMonth: carrierRaw,
      raw: row,
    });
  }

  const total = records.reduce((s, r) => s + (r.commission || 0), 0);
  console.log(`[AML-PORTAL] ${filename} | ${records.length} records | total $${total.toFixed(2)}`);
  return records;
}

function isHumanaDevotedBSIFile(filename) {
  const f = filename.toLowerCase().replace(/\s+/g, '_');
  return f.includes('humana_bsi_statement') || f.includes('devoted_bsi_statement');
}

// Parser for Humana/Devoted BSI split Excel files.
// Format: blank row 0, real headers at row 1, data from row 2.
// Agent column is "Writing Agent" (NOT "Agent Name" = BSI agency, NOT "Writing Agent Name").
// Carrier is explicit in "Carrier" column ("HUMANA" or "Devoted Health").
// Commission in "Commission ($)", dates as Excel serials, classification from "First Year/Renewal".
function parseHumanaDevotedBSIRows(wb, filename) {
  const records = [];

  // Period from YYYY-MM-DD in filename
  const dateMatch = filename.match(/(20\d{2})-(0[1-9]|1[0-2])-\d{2}/);
  const statementPeriod = dateMatch ? dateMatch[1] + dateMatch[2] : 'Unknown';

  const ws = wb.Sheets[wb.SheetNames[0]];
  const rawRows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

  // Row 0 is blank, row 1 is the real header row
  // Auto-detect header row: original format has blank row 0 then real headers at row 1.
  // AML portal CSV exports have headers directly at row 0 (no blank lead row).
  const row0Vals = (rawRows[0] || []).map(v => String(v || '').toLowerCase());
  const headerRowIdx = row0Vals.some(v => v.includes('insured') || v.includes('policy') || v.includes('writing agent')) ? 0 : 1;
  const headers = rawRows[headerRowIdx];
  if (!headers || headers.length === 0) {
    console.warn('[HUMANA-DEVOTED-BSI] No header row found in', filename);
    return records;
  }

  const rows = XLSX.utils.sheet_to_json(ws, { header: headers, defval: '', range: headerRowIdx + 1 });
  console.log(`[HUMANA-DEVOTED-BSI] ${filename} | Period: ${statementPeriod} | Rows: ${rows.length}`);

  for (const row of rows) {
    const client = String(row['Insured Name'] || '').trim();
    if (!client || !isValidClientName(client)) continue;

    const writingAgentRaw = String(row['Writing Agent'] || '').trim();
    const carrierRaw      = String(row['Carrier'] || '').trim();
    const policyNumber    = String(row['Policy #'] || '').trim();
    const productRaw      = String(row['Product'] || '').trim();
    const statusRaw       = String(row['Status'] || '').trim();

    // Commission ($) may be a number or a string with $ sign
    const commissionRaw = row['Commission ($)'];
    const commission = typeof commissionRaw === 'number'
      ? commissionRaw
      : parseFloat(String(commissionRaw || '').replace(/[$,]/g, '')) || 0;

    // Effective date — Excel serial number
    const effectiveDate = formatDate(row['Original EffectiveDate']);

    // Normalize carrier
    const carrierLower = carrierRaw.toLowerCase();
    let carrier;
    if (carrierLower.includes('humana'))       carrier = 'Humana';
    else if (carrierLower.includes('devoted')) carrier = 'Devoted';
    else                                        carrier = carrierRaw;

    // BSI Humana/Devoted feeds are the house override pot (split with BSI).
    // First Year/Renewal is enrollment metadata — not OliComm New Business.
    let classification = classifyHumanaDevotedBSITransaction({ commission });

    // Agent name — "Writing Agent" is the individual; "Agent Name" is the BSI agency
    const agentName = isAgencyName(writingAgentRaw)
      ? 'The Health Experts Insurance'
      : (normalizeAgentName(writingAgentRaw) || writingAgentRaw || 'BSI Agent');

    records.push({
      agent: agentName,
      carrier,
      planType: derivePlanType(carrier, productRaw, policyNumber, ''),
      client,
      effectiveDate,
      premium: 0,
      commission,
      classification,
      period: statementPeriod,
      policyNumber,
      payee: 'BSI',
      mga: statusRaw === 'Open' ? 'Held — Open status' : '',
      raw: row
    });
  }

  const total = records.reduce((s, r) => s + (r.commission || 0), 0);
  console.log(`[HUMANA-DEVOTED-BSI] Parsed ${records.length} records, total $${total.toFixed(2)}`);
  return records;
}

function parseBSICarrierStatementRows(wb, filename) {
  const records = [];

  // Extract period from YYYY-MM-DD in filename (e.g. UHC_BSI_STATEMENT_2026-01-01.xlsx → 202601)
  let statementPeriod = null;
  const dateMatch = filename.match(/(20\d{2})-(0[1-9]|1[0-2])-\d{2}/);
  if (dateMatch) {
    statementPeriod = dateMatch[1] + dateMatch[2];
  }
  // Also try month-name extraction as fallback
  if (!statementPeriod) {
    const monthMap = { january:'01',february:'02',march:'03',april:'04',may:'05',june:'06',
      july:'07',august:'08',september:'09',october:'10',november:'11',december:'12' };
    const fnLower = filename.toLowerCase();
    for (const [month, num] of Object.entries(monthMap)) {
      if (fnLower.includes(month)) {
        const ym = filename.match(/(20\d{2})/);
        if (ym) { statementPeriod = ym[1] + num; break; }
      }
    }
  }
  console.log(`[BSI-CARRIER] Period: ${statementPeriod || 'unknown'} from "${filename}"`);

  // Use "Commission Transactions" sheet; fall back to first sheet
  const sheetName = wb.SheetNames.find(s => s.toLowerCase().includes('commission trans')) || wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(ws, { defval: '', raw: true });
  console.log(`[BSI-CARRIER] Sheet "${sheetName}": ${rows.length} rows`);

  // Summary row keywords to skip
  const SKIP_KEYWORDS = ['commission earned','chargebacks','applied to balance',
    'total commission','payment received','commission activity'];

  for (const row of rows) {
    // Use Writing Agent Name — this is the actual individual agent, not BSI
    const writingAgentRaw = String(row['Writing Agent Name'] || '').trim();
    const client = String(row['Member Name'] || '').trim();

    if (!client || !isValidClientName(client)) continue;
    if (SKIP_KEYWORDS.some(kw => client.toLowerCase().includes(kw))) continue;

    const commissionRaw = row['Commission'];
    const commission = typeof commissionRaw === 'number'
      ? commissionRaw
      : parseFloat(String(commissionRaw || '').replace(/[$,]/g, '')) || 0;

    const policyNumber = String(row['Policy Number'] || '').trim();
    const effectiveDate = formatDate(row['Original Effective Date']);
    const period = statementPeriod || String(row['Payment Period'] || '').trim(); // filename period is authoritative
    const rawPlanType = String(row['Plan Type'] || '').trim();
    const commAction = String(row['Commission Action'] || '').trim().toLowerCase();

    // Map agent: isAgencyName check for THEI, otherwise normalize directly
    const agentName = isAgencyName(writingAgentRaw)
      ? 'The Health Experts Insurance'
      : (normalizeAgentName(writingAgentRaw) || writingAgentRaw || 'BSI Agent');

    const planType = derivePlanType('UnitedHealthcare', rawPlanType, policyNumber, '');
    const classification = commission < 0 ? 'Chargeback'
      : commAction === 'new' ? 'New Business'
      : commAction === 'renewal' ? 'Renewal'
      : commAction.includes('chargeback') ? 'Chargeback'
      : 'Agent Commission';

    const memberStateRaw = String(row['Member State'] || row['State'] || '').trim().toUpperCase().split(/[-/\s]/)[0];
    const memberState = /^[A-Z]{2}$/.test(memberStateRaw) ? memberStateRaw : null;

    records.push({
      agent: agentName,
      carrier: 'UnitedHealthcare',
      planType,
      client,
      effectiveDate,
      premium: parseFloat(row['Prem Amount']) || 0,
      commission,
      classification,
      period,
      policyNumber,
      payee: 'BSI',
      memberState,
      raw: row
    });
  }

  console.log(`[BSI-CARRIER] Commission Transactions: ${records.length} records, total $${records.reduce((s,r)=>s+(r.commission||0),0).toFixed(2)}`);

  // ── Held Transactions — ingest, flagged as "Held", do NOT drop silently ──
  const heldSheet = wb.SheetNames.find(s => s.toLowerCase().includes('held'));
  if (heldSheet) {
    const heldRows = XLSX.utils.sheet_to_json(wb.Sheets[heldSheet], { defval: '', raw: true });
    let heldCount = 0;
    for (const row of heldRows) {
      const writingAgentRaw = String(row['Writing Agent Name'] || '').trim();
      const client = String(row['Member Name'] || '').trim();
      if (!client || !isValidClientName(client)) continue;

      const commissionRaw = row['Commission'];
      const commission = typeof commissionRaw === 'number' ? commissionRaw
        : parseFloat(String(commissionRaw || '').replace(/[$,]/g, '')) || 0;

      const period = statementPeriod || String(row['Payment Period'] || '').trim(); // filename period is authoritative
      const agentName = isAgencyName(writingAgentRaw)
        ? 'The Health Experts Insurance'
        : (normalizeAgentName(writingAgentRaw) || writingAgentRaw || 'BSI Agent');
      const holdReason = String(row['Hold Reason'] || '').trim();

      records.push({
        agent: agentName,
        carrier: 'UnitedHealthcare',
        planType: derivePlanType('UnitedHealthcare', String(row['Plan Type']||'').trim(), String(row['Policy Number']||'').trim(), ''),
        client,
        effectiveDate: formatDate(row['Original Effective Date']),
        premium: 0,
        commission,  // typically $0 for held records
        classification: 'Held',
        period,
        policyNumber: String(row['Policy Number'] || '').trim(),
        payee: 'BSI',
        mga: holdReason || 'Held — reason not specified',
        raw: row
      });
      heldCount++;
    }
    console.log(`[BSI-CARRIER] Held Transactions: ${heldCount} records ingested (flagged as "Held")`);
  }

  console.log(`[BSI-CARRIER] Total: ${records.length} records`);
  return records;
}

module.exports = router;

// BSI Statements Upload - separate from commission statements
router.post('/upload-bsi-statement', requireAuth, requireAdmin, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  try {
    const pool = getPool();
    const fs = require('fs');

    // Check for duplicate filename
    const existing = await pool.query('SELECT id FROM uploads WHERE original_name = $1 AND category = $2',
      [req.file.originalname, 'bsi_statement']);
    if (existing.rows.length > 0) {
      try { fs.unlinkSync(req.file.path); } catch (e) {}
      return res.status(409).json({ error: `"${req.file.originalname}" has already been uploaded as a BSI statement.` });
    }

    // ── Parse the file using existing parsers ──────────────────────────────
    let records = [];
    const origName = req.file.originalname;
    const nameLower = origName.toLowerCase().replace(/\s+/g, '_');

    // Helper: extract period from YYYY-MM-DD date in filename (e.g. UHC_BSI_STATEMENT_2026-01-01.xlsx → 202601)
    function extractPeriodFromDateFilename(fn) {
      const m = fn.match(/(20\d{2})-(0[1-9]|1[0-2])-\d{2}/);
      if (m) return m[1] + m[2];
      return null;
    }

    if (origName.endsWith('.pdf') || origName.endsWith('.PDF')) {
      // PDF — use existing BSI/THE PDF parsers
      if (isBSIConsolidatedPDF(origName)) {
        records = await parseBSIConsolidatedPDF(req.file.path, origName);
      } else if (isBSIPDF(origName)) {
        records = await parseBSIPDF(req.file.path, origName);
      } else if (isTHEStatementPDF(origName)) {
        records = await parseTHEStatementPDF(req.file.path, origName);
      } else {
        records = await parseBSIConsolidatedPDF(req.file.path, origName);
      }
    } else {
      // Excel / CSV — route to correct parser
      // Carrier→BSI statements only (Humana/Devoted/Aetna/UHC carrier feeds).
      // BSI→THE remittance CSVs ("JULY - THE" / T.H.E_STATEMENTS) go to Commission Statements.
      const wb = XLSX.readFile(req.file.path);
      if (isAetnaBSICSVFilename(origName)) {
        console.log('[BSI-UPLOAD] Matched Aetna BSI CSV parser for:', origName);
        records = parseAetnaBSICSV(wb, origName);
      } else if (isAMLPortalExportFile(origName, wb)) {
        console.log('[BSI-UPLOAD] Matched AML portal export parser for:', origName);
        records = parseAMLPortalRows(wb, origName);
        if (!records.length) {
          try { fs.unlinkSync(req.file.path); } catch(e) {}
          return res.status(400).json({ error: 'No records found in AML portal export. Verify this is a Contracts/CommissionDetails CSV.' });
        }
      } else if (isHumanaDevotedBSIFile(origName)) {
        console.log('[BSI-UPLOAD] Matched Humana/Devoted BSI parser for:', origName);
        records = parseHumanaDevotedBSIRows(wb, origName);
      } else if (isBSIFile(origName) || /statement-health_experts|statement_health_experts/.test(nameLower)) {
        console.log('[BSI-UPLOAD] Matched generic BSI rows parser for:', origName);
        records = parseBSIRows(wb, origName);
      } else {
        // Dedicated BSI carrier statement parser (handles files where Agent = BSI, not THEI)
        records = parseBSICarrierStatementRows(wb, origName);
      }
    }

    if (!records || records.length === 0) {
      try { fs.unlinkSync(req.file.path); } catch (e) {}
      return res.status(400).json({ error: 'No records found in BSI statement. Please verify the file format.' });
    }

    // Alba/Lina only: remap house/NPN/name agent-production → Alba, then peel
    // carrier×state override rates into producer_payable (Lina pay) + THEI/BSI shares.
    // Agency Override / Held stay under Broker Society; other agents unchanged.
    applyBsiBookAgentProduction(records);

    const beforeInternal = records.length;
    const collapsed = collapseInternalDuplicates(records);
    records = collapsed.records;
    const internalDuplicatesRemoved = collapsed.removedCount;
    if (internalDuplicatesRemoved > 0) {
      console.warn(
        `[BSI-UPLOAD] Collapsed ${internalDuplicatesRemoved} within-batch duplicate(s) ` +
        `(${beforeInternal} → ${records.length})`
      );
    }

    if (!records.length) {
      try { fs.unlinkSync(req.file.path); } catch (e) {}
      return res.status(400).json({ error: 'No records left after within-batch dedupe.' });
    }

    const commissionSum = records.reduce((s, r) => s + (parseFloat(r.commission) || 0), 0);
    const carriers = [...new Set(records.map(r => r.carrier).filter(Boolean))];

    // Insert upload metadata
    const uploadResult = await pool.query(
      `INSERT INTO uploads (filename, original_name, carrier, row_count, commission_sum, uploaded_by, category)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [req.file.filename, origName, carriers.join(', '), records.length, commissionSum, req.user.id, 'bsi_statement']
    );
    const uploadId = uploadResult.rows[0].id;

    // Ensure columns exist
    try { await pool.query(`ALTER TABLE commission_records ADD COLUMN IF NOT EXISTS plan_type TEXT DEFAULT ''`); } catch(e) {}
    try { await pool.query(`ALTER TABLE commission_records ADD COLUMN IF NOT EXISTS mga TEXT DEFAULT ''`); } catch(e) {}
    try { await pool.query(`ALTER TABLE commission_records ADD COLUMN IF NOT EXISTS payee TEXT DEFAULT ''`); } catch(e) {}
    try { await pool.query(`ALTER TABLE commission_records ADD COLUMN IF NOT EXISTS sub_agent_override NUMERIC DEFAULT 0`); } catch(e) {}
    try { await pool.query(`ALTER TABLE commission_records ADD COLUMN IF NOT EXISTS statement_month TEXT`); } catch(e) {}
    try { await pool.query(`ALTER TABLE commission_records ADD COLUMN IF NOT EXISTS members INTEGER DEFAULT 0`); } catch(e) {}
    try { await pool.query(`ALTER TABLE commission_records ADD COLUMN IF NOT EXISTS anomaly BOOLEAN DEFAULT false`); } catch(e) {}
    await ensurePassThroughSchema(pool);

    // Insert records into commission_records
    for (const r of records) {
      const liableAgent = resolvePassThroughLiableAgent({
        agentName: r.agent,
        clientName: r.client,
        commission: r.commission,
      });
      await pool.query(
        `INSERT INTO commission_records (
           upload_id, agent_name, carrier, plan_type, client_full_name, effective_date,
           premium, commission, classification, payment_period, policy_number, payee, mga,
           raw_data,
           source, policy_written_date, gross_commission, thei_share, bsi_share,
           producer_payable, split_applies, lob, sub_agent_override, statement_month, members,
           anomaly, member_state, liable_agent
         )
         VALUES (
           $1,$2,$3,$4,$5,$6,
           $7,$8,$9,$10,$11,$12,$13,
           $14,
           $15,$16,$17,$18,$19,
           $20,$21,$22,$23,$24,$25,
           $26,$27,$28
         )`,
        [
          uploadId, r.agent, r.carrier, r.planType || '', r.client, r.effectiveDate,
          r.premium || 0, r.commission || 0, r.classification, r.period, r.policyNumber, r.payee || '', r.mga || '',
          JSON.stringify(r.raw),
          r.source || null,
          (() => {
            const v = r.policyWrittenDate;
            if (!v) return null;
            const m = String(v).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
            if (m) return `${m[3]}-${m[1]}-${m[2]}`;
            const m2 = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
            if (m2) return `${m2[1]}-${m2[2]}-${m2[3]}`;
            return null;
          })(),
          r.grossCommission != null ? r.grossCommission : null,
          r.theiShare != null ? r.theiShare : null,
          r.bsiShare != null ? r.bsiShare : null,
          r.producerPayable != null ? r.producerPayable : null,
          r.splitApplies != null ? r.splitApplies : null,
          r.lob || null,
          r.subAgentOverride != null ? r.subAgentOverride : 0,
          r.statementMonth || null,
          r.members || 0,
          r.anomaly === true,
          r.memberState || null,
          liableAgent,
        ]
      );
    }

    try { fs.unlinkSync(req.file.path); } catch (e) {}

    let resolvedRenewals = [];
    try {
      const resolvedBy = req.user?.email || req.user?.name || 'system';
      const result = await resolveChasedRenewals(pool, uploadId, resolvedBy);
      resolvedRenewals = result.resolved || [];
      if (resolvedRenewals.length) {
        console.log(`[BSI-UPLOAD] Auto-resolved ${resolvedRenewals.length} chased/pending renewals`);
      }
    } catch (err) {
      console.error('[BSI-UPLOAD] Renewals auto-resolve failed:', err.message);
    }

    detectPlanChanges(pool, uploadId).catch(err => {
      console.error('[BSI-UPLOAD] Plan change detection failed:', err.message);
    });

    res.json({
      success: true,
      message: `BSI statement uploaded: ${records.length} records imported`,
      filename: origName,
      uploadId,
      rowCount: records.length,
      commissionSum,
      carriers,
      preview: records.slice(0, 5),
      resolvedRenewals,
      resolvedRenewalsCount: resolvedRenewals.length,
      internalDuplicatesRemoved: internalDuplicatesRemoved || 0,
    });

  } catch (err) {
    console.error('BSI upload error:', err);
    res.status(500).json({ error: err.message });
  }
});

