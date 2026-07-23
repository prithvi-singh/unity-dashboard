'use strict';
// Template mapper — currently a tolerant passthrough plus normalised ID.
// After the first live fetch, replace with an explicit whitelist, e.g.:
//
// module.exports = (r) => ({
//   id: r.ID,
//   name: r.Name?.display_value ?? null,   // Zoho name fields are objects
//   email: r.Email ?? null,
//   phone: r.Phone_Number ?? null,
//   status: r.Lead_Status ?? null,
//   createdAt: r.Added_Time ?? null,
// });
//
// Rules:
// - Unknown/missing field → null. Never throw for a missing field.
// - Return null (not throw) to drop a clearly-garbage record.
// - Keep Unity data-integrity conventions Zoho-local (e.g. skip records
//   whose name contains "test") — do NOT import ../../utils/filters.js.

module.exports = (record) => {
  if (!record || typeof record !== 'object') return null;
  return { id: record.ID || record.id || null, ...record };
};
