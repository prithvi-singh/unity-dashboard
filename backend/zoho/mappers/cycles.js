'use strict';
// Whitelist mapper for Zoho cycle records — explicit field mapping firewall.
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
    patientCode: r.Contacts?.Patient_ID ?? null,
    childName: name,
    cycleNumber: r.Cycle_Number ?? null,
    cycleDate: r.Cycle_Date || null,
    status: r.Cycle_Status || null,
    purchased: r.Purchased ?? null,
    completed: r.Completed ?? null,
    available: r.Available ?? null,
    consumed: r.Cons ?? null,
    noShow: r.No_Show ?? null,
    dayFrequency: r.Day_Frequency || null,
    weekly: r.Weekly || null,
    appointmentCategory: r.Appointment_Category || null,
    program: r.Program1?.zc_display_value ?? null,
    invoiceNumber: r.Invoice?.Invoice_No ?? null,
    phone: r.Contacts?.Phone ?? null,
    childUin: r.Contacts?.Child_UIN ?? null,
    centreAdmin: r.Contacts?.Center_Admin?.zc_display_value ?? null,
    addedTime: r.Added_Time || null,
    modifiedTime: r.Modified_Time || null,
  };
};
