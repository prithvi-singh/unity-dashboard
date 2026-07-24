'use strict';
// Incremental sync engine.
//
// Strategy per module:
// - No local data            → FULL fetch (expensive, once)
// - Data older than 7 days
//   since last full          → FULL fetch (trues up deletions, which
//                              delta queries can't see)
// - Otherwise                → DELTA fetch: only records with
//                              Modified_Time after last sync (cheap,
//                              usually 1 API call)
//
// Delta overlap: we query from (lastSync - 30 min) to tolerate clock skew
// between us and Zoho; the by-ID merge makes re-fetched records harmless.
//
// GOTCHA — criteria time format: Zoho Creator criteria date-times must match
// the APP's configured date format. Default here is dd-MMM-yyyy HH:mm:ss;
// override with ZOHO_CRITERIA_TIME_FORMAT=iso if the app uses ISO dates.
// If delta fetches fail with code 4000 mentioning criteria, this is why.

const { REPORTS } = require('./config');
const { fetchReport } = require('./client');
const { mapRecords } = require('./mappers');
const store = require('./store');

const FULL_REFRESH_MS = 7 * 24 * 60 * 60 * 1000; // weekly true-up
const DELTA_OVERLAP_MS = 30 * 60 * 1000;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatCriteriaTime(ts) {
  const d = new Date(ts + 5.5 * 3600_000); // IST — Zoho org timezone
  if (process.env.ZOHO_CRITERIA_TIME_FORMAT === 'iso') {
    return d.toISOString().slice(0, 19).replace('T', ' ');
  }
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getUTCDate())}-${MONTHS[d.getUTCMonth()]}-${d.getUTCFullYear()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

/**
 * Sync one module. Returns { mode: 'full'|'delta'|'skip', changed: number }.
 * Throws on fetch failure (caller handles backoff).
 */
async function syncModule(key) {
  const { linkName, ttlMs } = REPORTS[key];
  const existing = store.getModule(key);
  const now = Date.now();

  // Fresh enough — nothing to do.
  if (existing && now - existing.asOf < ttlMs) {
    return { mode: 'skip', changed: 0 };
  }

  const needFull = !existing || now - existing.lastFullSync > FULL_REFRESH_MS;

  if (needFull) {
    const raw = await fetchReport(linkName);
    const mapped = mapRecords(key, raw);
    store.replaceAll(key, mapped, now);
    console.log(`[zoho/sync] ${key}: FULL sync — ${mapped.length} records`);
    return { mode: 'full', changed: mapped.length };
  }

  const since = formatCriteriaTime(existing.asOf - DELTA_OVERLAP_MS);
  const raw = await fetchReport(linkName, { criteria: `Modified_Time > '${since}'` });
  const mapped = mapRecords(key, raw);
  store.mergeDelta(key, mapped, now);
  if (mapped.length > 0) {
    console.log(`[zoho/sync] ${key}: delta — ${mapped.length} changed since ${since}`);
  }
  return { mode: 'delta', changed: mapped.length };
}

module.exports = { syncModule };
