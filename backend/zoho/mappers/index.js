'use strict';
// Mappers are the firewall between Zoho field names (display-label-derived,
// change when someone renames a field in the Creator builder) and Unity's
// stable internal shape. A Zoho-side rename should break ONE mapper file,
// never the frontend.
//
// STATUS: passthrough until first live fetch. Once creds are in, hit
// GET /api/zoho/leads, look at a real record, then write explicit field
// whitelists per module (see leads.js for the pattern). Do NOT ship
// passthrough to the frontend long-term — it forfeits the firewall.

const leads = require('./leads');
const patients = require('./patients');

// Default: passthrough with the Zoho record ID normalised.
const passthrough = (record) => ({ id: record.ID || record.id || null, ...record });

const MAPPERS = {
  patients,
  invoices: passthrough,
  appointments: passthrough,
  receipts: passthrough,
  cycles: passthrough,
  leads,
  'crm-leads': passthrough,
};

function mapRecords(moduleKey, rawRecords) {
  const mapper = MAPPERS[moduleKey] || passthrough;
  const out = [];
  let dropped = 0;
  for (const raw of rawRecords) {
    try {
      const mapped = mapper(raw);
      if (mapped) out.push(mapped);
      else dropped++;
    } catch (err) {
      dropped++;
    }
  }
  if (dropped > 0) console.warn(`[zoho/mappers] ${moduleKey}: dropped ${dropped} bad record(s)`);
  return out;
}

module.exports = { mapRecords };
