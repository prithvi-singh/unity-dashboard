'use strict';
// Whitelist mapper for Zoho lead records — explicit field mapping firewall.
// Zoho Creator renames break this file, never the frontend.
//
// Rules:
// - Missing/empty field → null. Never throw for a missing field.
// - Nested Zoho objects: use ?.zc_display_value ?? null.
// - Arrays of linked records → joined display string.
// - Return null to drop a record with no ID.
// - Skip records whose name contains 'test' (case-insensitive) — Zoho-local,
//   do NOT import from ../utils/.

const therapyJoin = (arr) =>
  arr?.map((t) => t.Single_Line ?? t.zc_display_value).filter(Boolean).join(', ') || null;

// Candidate fields that may contain the patient code on a converted lead.
// Inspected in priority order; first non-empty value wins.
//
// PATIENT LINK FIELD (verified 2026-07-27 against 2 real Converted leads):
//   Patient_ID1 is THE correct field — shaped as a Zoho lookup object:
//   { "Patient_ID": "24612", "ID": "...", "zc_display_value": "24612" }
//   The flat Patient_ID field also exists on lead records but is ALWAYS
//   empty string — it's a decoy, do not use it.
//   Detection order: Patient_ID1 lookup first, then fallback candidates.
const PATIENT_LINK_CANDIDATES = [
  'PatientID', 'Converted_Patient',
  'Converted_Contact', 'Contact', 'Patient_Contact',
  'Related_Patient', 'Contact_ID',
];

const DIGIT_RE = /\D/g;

function _normalizePatientCode(raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  // If it's a lookup object (Zoho nested type), prefer inner Patient_ID
  // (the actual patient code in Patient_ID1.Patient_ID), then
  // zc_display_value, then ID.
  if (typeof raw === 'object') {
    const str = raw.Patient_ID ?? raw.zc_display_value ?? raw.ID ?? raw.id ?? null;
    if (str == null || str === '') return null;
    raw = String(str);
  }
  const str = typeof raw === 'number' ? String(raw) : String(raw);
  const digits = str.trim().replace(DIGIT_RE, '');
  const stripped = digits.replace(/^0+/, '');
  return stripped || null;
}

function _detectPatientCode(r) {
  // Check Patient_ID1 FIRST — this is the confirmed linking field.
  // Shaped as { Patient_ID: "24612", ID: "...", zc_display_value: "24612" }.
  // _normalizePatientCode extracts Patient_ID from the lookup object.
  const code = _normalizePatientCode(r.Patient_ID1);
  if (code) return code;

  // Fall back to the flat-field candidate list (deprioritized, harmless).
  for (const candidate of PATIENT_LINK_CANDIDATES) {
    const raw = r[candidate];
    const result = _normalizePatientCode(raw);
    if (result) return result;
  }
  return null;
}

module.exports = (r) => {
  if (!r || typeof r !== 'object') return null;

  const id = r.ID ?? null;
  if (id == null) return null;

  const name = r.Child_Name ?? null;
  if (name && /test/i.test(name)) return null;

  return {
    id,
    childName: name,
    therapy: therapyJoin(r.Therapy),
    consultationDate: r.Consultation_Date || null,
    consultationType: r.Consultation_Type || null,
    registrationDate: r.Registration_Date || null,
    leadGeneratedBy: r.Lead_Generated_By || null,
    centreHeadName: r.Centre_Head_Name || null,
    schoolName: r.School_Name || null,
    motherName: r.Mother_Name1?.zc_display_value ?? null,
    gender: r.Gender || null,
    enrollmentAmount: r.Enrollment_Amount || null,
    address1: r.Address_1 || null,
    address2: r.Address_2 || null,
    alternatePhone: r.Alternate_Phone || null,
    status: r.Status || null,
    // Converted_as_patient is a string "true"/"false" in Zoho, not a real boolean.
    // Normalize to actual boolean for downstream consumers.
    convertedAsPatient: r.Converted_as_patient === 'true',
    enrollmentDate: r.Enrollment_Date || null,
    patientCode: _detectPatientCode(r),
    addedTime: r.Added_Time || null,
    modifiedTime: r.Modified_Time || null,
  };
};
