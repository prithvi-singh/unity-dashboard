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
// PATIENT LINK INVESTIGATION (2026-07-27): Zoho credentials not available
// locally during implementation. These candidates cover the most common
// Zoho Creator patterns for lead→patient/contact linking:
//   - Patient_ID / PatientID: direct patient code (same as patient mapper)
//   - Converted_Contact: lookup object on converted leads
//   - Related_Patient / Contact_ID / Contact: common alternative names
// If NONE of these fields exist on the lead records in production, the
// funnel module's getConversionGap() falls back to name-based matching
// (childName vs Zoho patient name) — a weaker join flagged in the PR.
const PATIENT_LINK_CANDIDATES = [
  'Patient_ID', 'PatientID',
  'Converted_Contact', 'Contact', 'Patient_Contact', 'Converted_Patient',
  'Related_Patient', 'Contact_ID',
];

const DIGIT_RE = /\D/g;

function _normalizePatientCode(raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  // If it's a lookup object (Zoho nested type), try zc_display_value first,
  // then fall back to ID.
  if (typeof raw === 'object') {
    const str = raw.zc_display_value ?? raw.ID ?? raw.id ?? null;
    if (str == null || str === '') return null;
    raw = String(str);
  }
  const str = typeof raw === 'number' ? String(raw) : String(raw);
  const digits = str.trim().replace(DIGIT_RE, '');
  const stripped = digits.replace(/^0+/, '');
  return stripped || null;
}

function _detectPatientCode(r) {
  for (const candidate of PATIENT_LINK_CANDIDATES) {
    const raw = r[candidate];
    const code = _normalizePatientCode(raw);
    if (code) return code;
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
    patientCode: _detectPatientCode(r),
    addedTime: r.Added_Time || null,
    modifiedTime: r.Modified_Time || null,
  };
};
