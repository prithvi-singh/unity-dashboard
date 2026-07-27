'use strict';
// Whitelist mapper for Zoho invoice records — explicit field mapping firewall.
// Zoho Creator renames break this file, never the frontend.
//
// Rules:
// - Missing/empty field → null. Never throw for a missing field.
// - Nested Zoho objects: use ?.zc_display_value ?? null.
// - Arrays of linked records → joined display string.
// - Return null to drop a record with no ID.
// - Skip records whose name contains 'test' (case-insensitive) — Zoho-local,
//   do NOT import from ../utils/.

const serviceJoin = (arr) =>
  arr?.map((s) => s.zc_display_value ?? null).filter(Boolean).join(', ') || null;

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
    invoiceNumber: r.Invoice_No ?? null,
    invoiceDate: r.Invoice_Date || null,
    dueDate: r.Due_Date || null,
    status: r.Invoice_Status || null,
    invoiceType: r.Invoice_Type || null,
    totalAmount: r.Total_Invoice_Amount || null,
    discountAmount: r.Discount_Amount || null,
    discountType: r.Discount_Type || null,
    totalDiscount: r.Total_Discount || null,
    total: r.Total || null,
    balance: r.Balance || null,
    paid: r.Paid || null,
    services: serviceJoin(r.Service_Details),
    motherName: r.Contacts?.Mother_Name?.zc_display_value ?? null,
    fatherName: r.Contacts?.Father_Name?.zc_display_value ?? null,
    phone: r.Contacts?.Phone ?? null,
    email: r.Contacts?.Email ?? null,
    centreName: r.Center?.zc_display_value ?? null,
    centreAdmin: r.Center_Admin?.zc_display_value ?? null,
    addedTime: r.Added_Time || null,
    modifiedTime: r.Modified_Time || null,
  };
};
