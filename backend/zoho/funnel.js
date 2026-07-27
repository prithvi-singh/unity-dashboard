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
  // Start from current month and go backward
  for (let i = 0; i < n; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return months;
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
        // Prefer Unity SQL Set when available — this is the real business
        // question ("does the patient exist in Unity's database?").
        // Fall back to the Zoho crosswalk index (which only checks Zoho's
        // own Patients module — auto-created on conversion, always present).
        const inUnity = unityCodeSet
          ? unityCodeSet.has(lead.patientCode)
          : findByCode(lead.patientCode) !== null;
        if (inUnity) bucket.registeredInUnity++;
      }
    }
  }

  // FALLBACK: if NO lead has a patientCode, use name-based matching.
  // This is a weaker join — flag it.
  let fallbackNameMatch = false;
  if (!hasPatientCode) {
    fallbackNameMatch = true;
    // Reset registeredInUnity counts and recompute with name matching
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
 * @param {number}     [months=6]        Number of trailing months to include
 * @param {Set<string>} [unityCodeSet]   Normalized Unity Patient.PatientID values
 * @returns {object} { gap: Array<{ childName, patientCode, registrationDate,
 *                    centreHeadName, leadGeneratedBy, enrollmentAmount }>,
 *                    totalConverted, asOf, fallbackNameMatch }
 */
function getConversionGap(months = DEFAULT_MONTHS, unityCodeSet) {
  const mod = store.getModule('leads');
  if (!mod) return { gap: [], totalConverted: 0, asOf: null, warming: true };

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
      // Unity SQL check: does a matching Patient row exist in Unity's database?
      matchFn = (lead) => {
        if (!lead.patientCode) return false;
        return unityCodeSet.has(lead.patientCode);
      };
    } else {
      // Fallback: Zoho crosswalk index (weaker — checks Zoho's own Patients
      // module, not Unity's database).
      matchFn = (lead) => {
        if (!lead.patientCode) return false;
        return findByCode(lead.patientCode) !== null;
      };
    }
  } else {
    // FALLBACK: name-based matching — weaker join.
    // Each converted lead is matched to a Zoho patient by childName.
    // This WILL produce false positives (same name, different child)
    // and false negatives (name mismatch between systems).
    fallbackNameMatch = true;
    matchFn = (lead) => _matchByName(lead.childName) !== null;
  }

  const gap = convertedLeads
    .filter((lead) => !matchFn(lead))
    .map((lead) => ({
      childName: lead.childName,
      patientCode: lead.patientCode || null,
      registrationDate: lead.registrationDate,
      centreHeadName: lead.centreHeadName || lead.leadGeneratedBy || null,
      leadGeneratedBy: lead.leadGeneratedBy || null,
      enrollmentAmount: lead.enrollmentAmount,
    }));

  return {
    gap,
    totalConverted: convertedLeads.length,
    asOf: new Date(mod.asOf).toISOString(),
    fallbackNameMatch: fallbackNameMatch || undefined,
  };
}

module.exports = { buildFunnel, getConversionGap, _isConverted };
