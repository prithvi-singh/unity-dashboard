'use strict';
// Whitelist mapper for Zoho CRM lead records — explicit field mapping firewall.
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

module.exports = (r) => {
  if (!r || typeof r !== 'object') return null;

  const id = r.ID ?? null;
  if (id == null) return null;

  const name = r.Child_Name ?? null;
  if (name && /test/i.test(name)) return null;

  return {
    id,
    childName: name,
    parentsName: r.Parents_Name || null,
    phone: r.Phone_Number || null,
    email: r.Email || null,
    leadNumber: r.Lead_Number || null,
    leadStatus: r.Lead_Status || null,
    leadStage: r.Lead_Stage1 || null,
    leadSource: r.CRM_Lead_Source || r.Lead_Source || null,
    therapy: therapyJoin(r.Therapy),
    centerName: r.Center_Name?.zc_display_value ?? null,
    franchiseeAdmin: r.Franchisee_Admin?.zc_display_value ?? null,
    centreHeadName: r.Centre_Head_Name || null,
    status: r.Status || null,
    notes: r.Notes || null,
    addedTime: r.Added_Time || null,
    modifiedTime: r.Modified_Time || null,
  };
};
