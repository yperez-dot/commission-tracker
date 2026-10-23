'use strict';

/*
 * Monthly close checklist (pure logic, shared with the frontend).
 * NOTE: no destructuring / spread — see src/bsiStatementTitle.js.
 *
 * Expected carriers for a period = the five BSI carriers below, plus any other
 * carrier that showed up on a BSI statement upload in the 3 months before.
 * Each upload is flagged when:
 *   - zero_total:       it has records for the period but they add up to $0.00
 *   - carrier_mismatch: the filename / title names a different carrier than the
 *                       one the rows were stored under (e.g. an Aetna file stored
 *                       as UnitedHealthcare)
 * "Close month" is allowed only when every expected carrier has an upload or is
 * marked "none this month" with a reason. Other flags and deposit differences are
 * warnings, not blockers.
 */

var DEFAULT_EXPECTED_CARRIERS = ['UnitedHealthcare', 'Humana', 'Devoted', 'Aetna', 'Freedom'];

// Order matters: "devoted" before "humana" so "Humana/Devoted" text still picks both.
var CARRIER_PATTERNS = [
  { name: 'UnitedHealthcare', re: /\b(uhc|united\s*health\s*care|unitedhealthcare|united\s*healthcare)\b/i },
  { name: 'Humana', re: /\bhumana\b/i },
  { name: 'Devoted', re: /\bdevoted\b/i },
  { name: 'Aetna', re: /\baetna\b/i },
  { name: 'Freedom', re: /\bfreedom\b/i },
  { name: 'Wellcare', re: /\bwell\s*care\b/i },
  { name: 'Cigna', re: /\bcigna\b/i },
  { name: 'Simply', re: /\bsimply\b/i },
  { name: 'Optimum', re: /\boptimum\b/i },
  { name: 'Solis', re: /\bsolis\b/i },
];

/** Canonical carrier name ("UHC", "UnitedHealthcare Med Adv" -> "UnitedHealthcare"). */
function canonicalCarrier(raw) {
  var s = String(raw || '').trim();
  if (!s) return '';
  for (var i = 0; i < CARRIER_PATTERNS.length; i += 1) {
    if (CARRIER_PATTERNS[i].re.test(s)) return CARRIER_PATTERNS[i].name;
  }
  return s;
}

/** All known carriers named in a free-text string (filename / title). */
function carriersInText(text) {
  var s = String(text || '').replace(/[_.\-]+/g, ' ');
  var out = [];
  CARRIER_PATTERNS.forEach(function (p) {
    if (p.re.test(s)) out.push(p.name);
  });
  return out;
}

/** Stored upload carrier column may be "UnitedHealthcare, Humana". */
function storedCarriers(carrierField) {
  var seen = {};
  String(carrierField || '').split(',').forEach(function (c) {
    var k = canonicalCarrier(c);
    if (k) seen[k] = true;
  });
  return Object.keys(seen);
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/** The n YYYYMM periods before `period` (newest first). */
function previousPeriods(period, n) {
  var y = parseInt(String(period).slice(0, 4), 10);
  var m = parseInt(String(period).slice(4, 6), 10);
  var out = [];
  for (var i = 0; i < n; i += 1) {
    m -= 1;
    if (m < 1) { m = 12; y -= 1; }
    out.push(String(y) + (m < 10 ? '0' : '') + String(m));
  }
  return out;
}

/** Flags for one upload: { zeroTotal, carrierMismatch, namedCarriers, storedCarriers } */
function uploadFlags(u) {
  var stored = storedCarriers(u.carrier);
  var named = carriersInText(String(u.original_name || '') + ' ' + String(u.display_title || ''));
  var mismatch = false;
  if (named.length && stored.length) {
    // mismatch when the filename or title names a carrier the rows weren't stored under
    // (auto titles are built from the stored carrier, so the filename usually gives it away)
    mismatch = named.some(function (n) { return stored.indexOf(n) === -1; });
  }
  var count = Number(u.record_count) || 0;
  return {
    storedCarriers: stored,
    namedCarriers: named,
    zeroTotal: count > 0 && Math.abs(round2(u.total)) < 0.005,
    carrierMismatch: mismatch,
  };
}

/**
 * @param {Object} opts
 *   period
 *   uploads:        [{id, original_name, display_title, carrier, record_count, total, uploaded_at, uploaded_by_name}]
 *   recentCarriers: carriers seen on BSI uploads in the 3 prior months
 *   nones:          [{carrier, reason, entered_by, created_at}] "none this month" marks
 *   depositWarnings: [{payer, expected, received, difference}] (optional, never blocks)
 */
function buildCloseChecklist(opts) {
  var o = opts || {};
  var expectedSet = {};
  DEFAULT_EXPECTED_CARRIERS.forEach(function (c) { expectedSet[c] = true; });
  (o.recentCarriers || []).forEach(function (c) {
    var k = canonicalCarrier(c);
    if (k) expectedSet[k] = true;
  });

  var uploads = (o.uploads || []).map(function (u) {
    var f = uploadFlags(u);
    return {
      id: u.id,
      name: u.display_title || u.original_name || '',
      fileName: u.original_name || '',
      carrier: u.carrier || '',
      storedCarriers: f.storedCarriers,
      namedCarriers: f.namedCarriers,
      recordCount: Number(u.record_count) || 0,
      total: round2(u.total),
      uploadedAt: u.uploaded_at || null,
      uploadedBy: u.uploaded_by_name || null,
      flags: { zeroTotal: f.zeroTotal, carrierMismatch: f.carrierMismatch },
    };
  });

  var nones = {};
  (o.nones || []).forEach(function (n) { nones[canonicalCarrier(n.carrier)] = n; });

  var carriers = Object.keys(expectedSet).sort(function (a, b) {
    var ia = DEFAULT_EXPECTED_CARRIERS.indexOf(a);
    var ib = DEFAULT_EXPECTED_CARRIERS.indexOf(b);
    if (ia !== -1 || ib !== -1) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    return a.localeCompare(b);
  }).map(function (c) {
    var ups = uploads.filter(function (u) { return u.storedCarriers.indexOf(c) !== -1; });
    var none = nones[c] || null;
    var count = ups.reduce(function (s, u) { return s + u.recordCount; }, 0);
    var total = round2(ups.reduce(function (s, u) { return s + u.total; }, 0));
    var status = ups.length ? 'present' : (none ? 'none_this_month' : 'missing');
    return {
      carrier: c,
      status: status,
      uploads: ups.map(function (u) { return u.id; }),
      recordCount: count,
      total: total,
      none: none,
      flags: {
        missing: status === 'missing',
        zeroTotal: ups.some(function (u) { return u.flags.zeroTotal; }),
        carrierMismatch: ups.some(function (u) { return u.flags.carrierMismatch; }),
      },
    };
  });

  // Carriers that were uploaded but aren't in the expected list still show.
  uploads.forEach(function (u) {
    u.storedCarriers.forEach(function (c) {
      if (!expectedSet[c] && !carriers.some(function (x) { return x.carrier === c; })) {
        carriers.push({
          carrier: c, status: 'present', uploads: [u.id], recordCount: u.recordCount, total: u.total, none: null,
          flags: { missing: false, zeroTotal: u.flags.zeroTotal, carrierMismatch: u.flags.carrierMismatch },
        });
      }
    });
  });

  var blockers = [];
  var warnings = [];
  carriers.forEach(function (c) {
    if (c.flags.missing) blockers.push({ type: 'missing_carrier', carrier: c.carrier, message: c.carrier + ': no statement uploaded for this month' });
  });
  uploads.forEach(function (u) {
    if (u.flags.zeroTotal) warnings.push({ type: 'zero_total', uploadId: u.id, message: u.name + ': ' + u.recordCount + ' records but $0.00 total' });
    if (u.flags.carrierMismatch) {
      warnings.push({
        type: 'carrier_mismatch', uploadId: u.id,
        message: u.name + ': name says ' + u.namedCarriers.join('/') + ' but rows are stored as ' + u.storedCarriers.join('/'),
      });
    }
  });
  (o.missingShareWarnings || []).forEach(function (m) {
    warnings.push({ type: 'missing_thei_share', payer: m.payer, message: m.payer + ': ' + m.rows + ' row(s) have no stored THEI share (counted as $0 in expected deposit)' });
  });
  (o.depositWarnings || []).forEach(function (d) {
    warnings.push({
      type: 'deposit_difference', payer: d.payer,
      message: d.payer + ': expected ' + round2(d.expected).toFixed(2) + ', received ' + round2(d.received).toFixed(2) +
        ' (difference ' + round2(d.difference).toFixed(2) + ')',
    });
  });

  return {
    period: o.period,
    expectedCarriers: Object.keys(expectedSet),
    carriers: carriers,
    uploads: uploads,
    blockers: blockers,
    warnings: warnings,
    canClose: blockers.length === 0,
  };
}

module.exports = {
  DEFAULT_EXPECTED_CARRIERS: DEFAULT_EXPECTED_CARRIERS,
  canonicalCarrier: canonicalCarrier,
  carriersInText: carriersInText,
  storedCarriers: storedCarriers,
  previousPeriods: previousPeriods,
  uploadFlags: uploadFlags,
  buildCloseChecklist: buildCloseChecklist,
};
