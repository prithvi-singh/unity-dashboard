'use strict';
// Whitelist mapper for Zoho appointment records — explicit field mapping firewall.
// Zoho Creator renames break this file, never the frontend.
//
// Rules:
// - Missing/empty field → null. Never throw for a missing field.
// - Nested Zoho objects: use ?.zc_display_value ?? null.
// - Arrays of linked records → joined display string.
// - Return null to drop a record with no ID.
// - Skip records whose name contains 'test' (case-insensitive) — Zoho-local,
//   do NOT import from ../utils/.

module.exports = (r) => {
  if (!r || typeof r !== 'object') return null;

  const id = r.ID ?? null;
  if (id == null) return null;

  const name = r.Contacts?.Customer_Display_Name ?? null;
  if (name && /test/i.test(String(name))) return null;

  return {
    id,
    patientCode: r.Patient_ID ?? null,
    childName: name,
    appointmentNumber: r.Appointment_No ?? null,
    appointmentDate: r.Appointment_Date || null,
    actualDate: r.Actual_Appointment_Date || null,
    slot: r.Slot || null,
    duration: r.Duration || null,
    day: r.Day || null,
    status: r.Status || null,
    appointmentType: r.Appointment_Type || null,
    appointmentCategory: r.Appointment_Category || null,
    therapyName: r.Therapy?.Name ?? null,
    therapyCategory: r.Therapy?.Category_Master?.zc_display_value ?? null,
    therapyPrice: r.Therapy?.Selling_Price ?? null,
    cycleNumber: r.Cycle_Number1?.Cycle_Number ?? null,
    cycleStatus: r.Cycle_Number1?.Cycle_Status ?? null,
    motherName: r.Mother_Name || null,
    fatherName: r.Father_Name || null,
    phone: r.Contacts?.Phone ?? null,
    email: r.Contacts?.Email ?? null,
    therapistName: r.Therapist?.zc_display_value ?? null,
    centreName: r.Center?.zc_display_value ?? null,
    centreAdmin: r.Franchisee_Admin?.zc_display_value ?? null,
    observation: r.Observation || null,
    notes: r.Notes || null,
    callNotes: r.Call_Notes || null,
    addedTime: r.Added_Time || null,
    modifiedTime: r.Modified_Time || null,
  };
};
