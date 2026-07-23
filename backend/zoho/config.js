'use strict';
// Zoho module config — the ONLY place Zoho report link names live.
// Isolation rule: nothing in /backend/zoho imports from ../utils, ../services,
// or ../routes. Nothing outside imports from here except the server.js mount.

const OWNER = 'it_momsbelief';
const APP = 'app-master-module';

// Report registry. `linkName` must match Zoho exactly (yes, "Appointmenta"
// is misspelled in Zoho — do not "fix" it here). `ttlMs` drives the cache
// and the background warm loop.
const REPORTS = {
  patients:     { linkName: 'All_Contacts',            ttlMs: 60 * 60 * 1000 },
  invoices:     { linkName: 'All_Invoices',            ttlMs: 30 * 60 * 1000 },
  appointments: { linkName: 'All_Appointmenta_Report', ttlMs: 10 * 60 * 1000 },
  receipts:     { linkName: 'All_Receipts1_Report',    ttlMs: 30 * 60 * 1000 },
  cycles:       { linkName: 'All_Cycles',              ttlMs: 60 * 60 * 1000 },
  leads:        { linkName: 'All_Leads',               ttlMs: 10 * 60 * 1000 },
  'crm-leads':  { linkName: 'CRM_Lead_Report',         ttlMs: 10 * 60 * 1000 },
};

const env = {
  clientId:     process.env.ZOHO_CLIENT_ID,
  clientSecret: process.env.ZOHO_CLIENT_SECRET,
  refreshToken: process.env.ZOHO_REFRESH_TOKEN,
  accountsUrl:  process.env.ZOHO_ACCOUNTS_URL || 'https://accounts.zoho.com',
  apiBase:      process.env.ZOHO_API_BASE || 'https://www.zohoapis.com',
};

const isConfigured = () =>
  Boolean(env.clientId && env.clientSecret && env.refreshToken);

const reportUrl = (linkName) =>
  `${env.apiBase}/creator/v2.1/data/${OWNER}/${APP}/report/${linkName}`;

module.exports = { REPORTS, env, isConfigured, reportUrl, OWNER, APP };
