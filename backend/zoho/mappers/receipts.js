'use strict';
// Whitelist mapper for Zoho receipt records — explicit field mapping firewall.
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

  const name = r.Child_Name ?? null;
  if (name && /test/i.test(name)) return null;

  return {
    id,
    patientCode: r.Contacts?.Patient_ID ?? null,
    childName: name,
    receiptNumber: r.Receipt_Number ?? null,
    receiptDate: r.Receipt_Date || null,
    amount: r.Receipt || null,
    status: r.Receipt_Status || null,
    paymentMode: r.Payment_Mode || null,
    transactionNumber: r.Transaction_Number || null,
    account: r.Account || null,
    invoiceNumber: r.Invoice_Number || null,
    motherName: r.Mother_Name || null,
    fatherName: r.Father || null,
    serviceList: r.Service_List || null,
    notes: r.Notes || null,
    centreAdmin: r.Contacts?.Center_Admin?.zc_display_value ?? null,
    addedTime: r.Added_Time || null,
    modifiedTime: r.Modified_Time || null,
  };
};
