'use strict';
// Lead→Unity conversion funnel.
//
// Cohorts leads by registrationDate month and tracks the pipeline:
//   leads → converted → registeredInUnity
//
// The gap (converted but no Unity match) is the ops-actionable list this
// entire feature exists to surface. Don't average it away.
//
// Isolation rule: this file lives inside backend/zoho/, so it MUST NOT
// import from ../utils/, ../services/, or ../routes/. Data comes from
// ./store.js and ./crosswalk.js only.
//
// NAME-FALLBACK (2026-07-27): If no lead has a populated patientCode after
// mapping, the leads mapper couldn't find a patient-linking field. In that
// case getConversionGap() falls back to matching converted leads to Zoho
// patients by childName — a best-effort join that is weaker and WILL produce
// false positives/negatives. Flag this clearly in the PR description.

const store = require('./store');
const { findByCode } = require('./crosswalk');

const DEFAULT_MONTHS = 6;

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Determine whether a lead is converted.
 * Prefers the explicit boolean field `convertedAsPatient` (confirmed field:
 * Converted_as_patient, a Zoho string "true"/"false" normalized to boolean
 * by the leads mapper). Falls back to `status === 'Converted'` for leads
 * that pre-date the field.
 *
 * Logs a warning when the two signals disagree — disagreement is itself
 * useful ops signal (inconsistent data entry).
 */
function _isConverted(lead) {
  const byField = lead.convertedAsPatient === true;
  const byStatus = lead.status === 'Converted';

  if (byField !== byStatus && (byField || byStatus)) {
    console.warn(
      `[zoho/funnel] conversion signal mismatch for lead ${lead.id}: ` +
      `convertedAsPatient=${lead.convertedAsPatient} status="${lead.status}"`
    );
  }

  return byField || byStatus;
}

function _monthKey(dateStr) {
  if (!dateStr) return null;
  // Accept YYYY-MM-DD or DD-MMM-YYYY (Zoho date formats)
  const m = /(\d{4})-(\d{2})-\d{2}/.exec(dateStr);
  if (m) return `${m[1]}-${m[2]}`;

  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const d = new Date(dateStr);
  if (!isNaN(d.getTime())) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }
  // Try DD-MMM-YYYY
  const m2 = /(\d{2})-(\w{3})-(\d{4})/.exec(dateStr);
  if (m2) {
    const idx = MONTHS.indexOf(m2[2]);
    if (idx >= 0) return `${m2[3]}-${String(idx + 1).padStart(2, '0')}`;
  }
  return null;
}

function _lastNMonths(n) {
  const months = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return months;
}

/**
 * Build the last `windowMonths` of monthly window keys (inclusive of current).
 * Returns an array of YYYY-MM strings, newest first.
 */
function _windowKeys(n) {
  const months = [];
  const now = new Date();
  for (let i = 0; i < n; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return months;
}

// ── Age bucket helpers ──────────────────────────────────────────────────────

/**
 * Parse a date string into a Date object. Accepts YYYY-MM-DD and
 * DD-MMM-YYYY (Zoho date formats). Returns null on failure.
 */
function _parseDate(str) {
  if (!str) return null;
  // YYYY-MM-DD
  const m = /(\d{4})-(\d{2})-(\d{2})/.exec(str);
  if (m) {
    const d = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00`);
    return isNaN(d.getTime()) ? null : d;
  }
  // ISO-like from JS Date
  const d = new Date(str);
  if (!isNaN(d.getTime())) return d;
  // DD-MMM-YYYY
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const m2 = /(\d{2})-(\w{3})-(\d{4})/.exec(str);
  if (m2) {
    const idx = MONTHS.indexOf(m2[2]);
    if (idx >= 0) {
      const d2 = new Date(`${m2[3]}-${String(idx + 1).padStart(2, '0')}-${m2[1]}T00:00:00`);
      return isNaN(d2.getTime()) ? null : d2;
    }
  }
  return null;
}

/**
 * Compute age metrics for a lead. Uses enrollmentDate first, falls back to
 * modifiedTime. Returns ageDays (integer days since the date, or null),
 * dateSource (which field was used), and ageBucket.
 */
function _computeAge(lead) {
  const dateSource = lead.enrollmentDate ? 'enrollmentDate' : 'modifiedTime';
  const dateStr = lead.enrollmentDate || lead.modifiedTime;
  const date = _parseDate(dateStr);
  if (!date) return { ageDays: null, dateSource: null, ageBucket: null };

  const ageDays = Math.floor((Date.now() - date.getTime()) / (1000 * 60 * 60 * 24));

  let ageBucket;
  if (ageDays <= 7) ageBucket = '0-7';
  else if (ageDays <= 30) ageBucket = '8-30';
  else if (ageDays <= 90) ageBucket = '31-90';
  else ageBucket = '90+';

  return { ageDays, dateSource, ageBucket };
}

/**
 * Map an ageBucket filter param value to a predicate function.
 * Returns null for invalid/unsupported values (no filtering).
 */
function _ageBucketPredicate(bucket) {
  if (!bucket) return null;
  if (bucket === '0-7') return (lead) => _computeAge(lead).ageBucket === '0-7';
  if (bucket === '8-30') return (lead) => _computeAge(lead).ageBucket === '8-30';
  if (bucket === '31-90') return (lead) => _computeAge(lead).ageBucket === '31-90';
  if (bucket === '90+') return (lead) => _computeAge(lead).ageBucket === '90+';
  return null;
}

// ── Name-based fallback match ───────────────────────────────────────────────

/**
 * Build a Map<lowercasedName, ZohoPatientRecord> for name-based fallback
 * matching. Only built when no leads have patientCode — because name matching
 * is a last resort. Rebuilds lazily.
 */
let _nameIndex = null;
let _nameIndexTime = 0;

function _buildNameIndex() {
  const mod = store.getModule('patients');
  if (!mod) { _nameIndex = null; return; }
  if (mod.asOf <= _nameIndexTime) return;

  _nameIndex = new Map();
  for (const rec of mod.data) {
    const key = (rec.name || '').toString().trim().toLowerCase();
    if (key) _nameIndex.set(key, rec);
  }
  _nameIndexTime = mod.asOf;
}

function _matchByName(childName) {
  if (!childName) return null;
  _buildNameIndex();
  if (!_nameIndex) return null;
  return _nameIndex.get(childName.trim().toLowerCase()) || null;
}

// ── Core exports ───────────────────────────────────────────────────────────

/**
 * Build conversion funnel data, cohorted by lead registrationDate month.
 *
 * @param {number}     [months=6]        Number of trailing months to include
 * @param {Set<string>} [unityCodeSet]   Normalized Unity Patient.PatientID values.
 *                                       When provided, registeredInUnity checks this
 *                                       Set instead of the Zoho crosswalk index —
 *                                       because the business question is "does a Unity
 *                                       Patient record exist," not "does a Zoho patient
 *                                       record exist." Without this Set the function
 *                                       falls back to crosswalk.findByCode().
 * @returns {object} { cohorts: [{ month, leads, converted, registeredInUnity }], asOf }
 */
function buildFunnel(months = DEFAULT_MONTHS, unityCodeSet) {
  const mod = store.getModule('leads');
  if (!mod) return { cohorts: [], asOf: null, warming: true };

  const leads = mod.data;
  const windows = _windowKeys(months);
  const windowSet = new Set(windows);

  // Accumulate counts
  const acc = new Map();
  for (const w of windows) acc.set(w, { month: w, leads: 0, converted: 0, registeredInUnity: 0 });

  let hasPatientCode = false;

  for (const lead of leads) {
    const key = _monthKey(lead.registrationDate);
    if (!key || !windowSet.has(key)) continue;

    const bucket = acc.get(key);
    bucket.leads++;

    if (_isConverted(lead)) {
      bucket.converted++;

      if (lead.patientCode) {
        hasPatientCode = true;
        const inUnity = unityCodeSet
          ? unityCodeSet.has(lead.patientCode)
          : findByCode(lead.patientCode) !== null;
        if (inUnity) bucket.registeredInUnity++;
      }
    }
  }

  // FALLBACK: if NO lead has a patientCode, use name-based matching.
  let fallbackNameMatch = false;
  if (!hasPatientCode) {
    fallbackNameMatch = true;
    for (const w of windows) acc.get(w).registeredInUnity = 0;

    for (const lead of leads) {
      const key = _monthKey(lead.registrationDate);
      if (!key || !windowSet.has(key)) continue;
      if (!_isConverted(lead)) continue;

      const match = _matchByName(lead.childName);
      if (match) acc.get(key).registeredInUnity++;
    }
  }

  return {
    cohorts: windows.map((w) => acc.get(w)),
    asOf: new Date(mod.asOf).toISOString(),
    fallbackNameMatch: fallbackNameMatch || undefined,
  };
}

/**
 * Return the actual list of converted leads with NO Unity match.
 * This is the ops-actionable gap list — the entire point of the feature.
 *
 * Each entry now includes full attribution and age-bucket data so the
 * frontend can sort/filter without the backend stripping anything for
 * "cleanliness".
 *
 * @param {number}       [months=6]        Number of trailing months to include
 * @param {Set<string>}  [unityCodeSet]    Normalized Unity Patient.PatientID values
 * @param {string|null}  [ageBucket]       Optional ageBucket filter
 * @returns {object} { gap, totalConverted, totalValueAtRisk, asOf, fallbackNameMatch }
 */
function getConversionGap(months = DEFAULT_MONTHS, unityCodeSet, ageBucket = null) {
  const mod = store.getModule('leads');
  if (!mod) return { gap: [], totalConverted: 0, totalValueAtRisk: 0, asOf: null, warming: true };

  const leads = mod.data;
  const windows = _windowKeys(months);
  const windowSet = new Set(windows);

  const convertedLeads = [];
  let hasPatientCode = false;

  for (const lead of leads) {
    const key = _monthKey(lead.registrationDate);
    if (!key || !windowSet.has(key)) continue;
    if (!_isConverted(lead)) continue;

    convertedLeads.push(lead);
    if (lead.patientCode) hasPatientCode = true;
  }

  // Determine match function
  let matchFn;
  let fallbackNameMatch = false;

  if (hasPatientCode) {
    if (unityCodeSet) {
      matchFn = (lead) => {
        if (!lead.patientCode) return false;
        return unityCodeSet.has(lead.patientCode);
      };
    } else {
      matchFn = (lead) => {
        if (!lead.patientCode) return false;
        return findByCode(lead.patientCode) !== null;
      };
    }
  } else {
    fallbackNameMatch = true;
    matchFn = (lead) => _matchByName(lead.childName) !== null;
  }

  // Build the ageBucket predicate if filtering
  const bucketPredicate = _ageBucketPredicate(ageBucket);

  // Build gap entries — include every dimension we have data for.
  // Sort/filter belongs in the frontend; don't strip anything here.
  const gap = convertedLeads
    .filter((lead) => !matchFn(lead))
    .map((lead) => {
      const age = _computeAge(lead);
      return {
        childName: lead.childName,
        patientCode: lead.patientCode || null,
        registrationDate: lead.registrationDate,
        centreHeadName: lead.centreHeadName || null,
        leadGeneratedBy: lead.leadGeneratedBy || null,
        enrollmentAmount: lead.enrollmentAmount,
        schoolName: lead.schoolName || null,
        motherName: lead.motherName || null,
        gender: lead.gender || null,
        therapy: lead.therapy || null,
        consultationDate: lead.consultationDate || null,
        consultationType: lead.consultationType || null,
        enrollmentDate: lead.enrollmentDate || null,
        ageDays: age.ageDays,
        dateSource: age.dateSource,
        ageBucket: age.ageBucket,
      };
    });

  // Apply ageBucket filter AFTER building the full set (so totalValueAtRisk
  // reflects the filtered set, not the page).
  const filteredGap = bucketPredicate ? gap.filter((entry) => {
    // Re-run the filter against the already-computed ageBucket on the entry
    if (ageBucket === '0-7') return entry.ageBucket === '0-7';
    if (ageBucket === '8-30') return entry.ageBucket === '8-30';
    if (ageBucket === '31-90') return entry.ageBucket === '31-90';
    if (ageBucket === '90+') return entry.ageBucket === '90+';
    return true;
  }) : gap;

  const totalValueAtRisk = filteredGap.reduce((sum, entry) => {
    const amt = parseFloat(entry.enrollmentAmount);
    return sum + (isNaN(amt) ? 0 : amt);
  }, 0);

  return {
    gap: filteredGap,
    totalConverted: convertedLeads.length,
    totalValueAtRisk,
    asOf: new Date(mod.asOf).toISOString(),
    fallbackNameMatch: fallbackNameMatch || undefined,
  };
}

module.exports = { buildFunnel, getConversionGap, _isConverted, _computeAge };
