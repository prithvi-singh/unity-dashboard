'use strict';
// Whitelist mapper for Zoho patient records — explicit field mapping firewall.
// Zoho Creator renames break this file, never the frontend.
//
// Rules:
// - Missing/empty field → null. Never throw for a missing field.
// - Nested Zoho objects: use ?.zc_display_value ?? null.
// - Return null to drop a record with no ID.
// - Skip records whose name contains 'test' (case-insensitive) — Zoho-local,
//   do NOT import from ../utils/.
//
// Next full sync (weekly or forced) applies this slim shape to old snapshot
// data; merged deltas will be slim immediately.

module.exports = (r) => {
  if (!r || typeof r !== 'object') return null;

  // Drop records with no ID
  const id = r.ID ?? null;
  if (id == null) return null;

  // Skip test records — Zoho-local, no ../utils/ import
  const name = r.Customer_Display_Name ?? null;
  if (name && /test/i.test(name)) return null;

  return {
    id,
    patientCode: r.Patient_ID ?? null,
    name,
    status: r.Child_Status ?? null,
    holdReason: r.Reason_of_Hold ?? null,
    registrationDate: r.Registration_Date ?? null,
    dateOfBirth: r.Date_of_Birth ?? null,
    gender: r.Gender ?? null,
    fatherName: r.Father_Name?.zc_display_value ?? null,
    motherName: r.Mother_Name?.zc_display_value ?? null,
    phone: r.Phone ?? null,
    email: r.Email ?? null,
    address: r.Country_Region2?.zc_display_value ?? null,
    city: r.City ?? null,
    state: r.State ?? null,
    zip: r.Zip_Code ?? null,
    centreName: r.Franchisee_Admin2?.zc_display_value ?? null,
    centreAdmin: r.Center_Admin?.zc_display_value ?? null,
    childUin: r.Child_UIN ?? null,
    addedTime: r.Added_Time ?? null,
    modifiedTime: r.Modified_Time ?? null,
  };
};
