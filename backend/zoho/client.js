'use strict';
// Zoho Creator v2.1 fetch client.
// - Auth header: Zoho-oauthtoken <access_token>
// - Pagination: response header `record_cursor` → send back as request
//   header `record_cursor` on the next call; loop until absent.
// - 401 → force one token refresh and retry once.
// - Zoho "no records" is code 3100 / HTTP 404 on some reports — treated as [].

const { getAccessToken } = require('./auth');
const { reportUrl } = require('./config');

const MAX_RECORDS = 1000;   // v2.1 max per call (default is 200)
const MAX_PAGES = 50;       // hard safety stop: 50k records
const RETRY_BACKOFF_MS = [1000, 3000];

// ── Daily call budget ────────────────────────────────────────────────────────
// Zoho Creator daily limits are BRUTAL: 250/user/day (Standard),
// 500 (Professional), 1000 (Enterprise). This module must never starve the
// rest of the org's API usage. Counter resets at midnight IST (Zoho resets
// on the super-admin's timezone). Set ZOHO_DAILY_CALL_BUDGET to tune.
const DAILY_BUDGET = parseInt(process.env.ZOHO_DAILY_CALL_BUDGET, 10) || 180;
let _callCount = 0;
let _budgetDay = _istDay();

function _istDay() {
  return new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
}

function _spendCall() {
  const today = _istDay();
  if (today !== _budgetDay) {
    _budgetDay = today;
    _callCount = 0;
  }
  if (_callCount >= DAILY_BUDGET) {
    throw new Error(`[zoho/client] daily call budget exhausted (${DAILY_BUDGET}) — resets midnight IST`);
  }
  _callCount++;
}

function budgetStatus() {
  return { used: _callCount, budget: DAILY_BUDGET, day: _budgetDay };
}

async function _get(url, headers) {
  _spendCall();
  let token = await getAccessToken();
  let res = await fetch(url, {
    headers: { Authorization: `Zoho-oauthtoken ${token}`, ...headers },
  });

  if (res.status === 401) {
    token = await getAccessToken({ force: true });
    res = await fetch(url, {
      headers: { Authorization: `Zoho-oauthtoken ${token}`, ...headers },
    });
  }
  return res;
}

/**
 * Fetch records of a report (paginated). Pass `criteria` for incremental
 * fetches, e.g. `Modified_Time > '23-Jul-2026 00:00:00'` — a delta fetch
 * usually costs 1 API call vs ~22 for a 21k-record full fetch.
 * @returns {Promise<Array<object>>} raw Zoho records
 */
async function fetchReport(linkName, { fieldConfig = 'quick_view', criteria = null } = {}) {
  let base = `${reportUrl(linkName)}?max_records=${MAX_RECORDS}&field_config=${fieldConfig}`;
  if (criteria) base += `&criteria=${encodeURIComponent(criteria)}`;
  const records = [];
  let cursor = null;

  for (let page = 0; page < MAX_PAGES; page++) {
    const headers = cursor ? { record_cursor: cursor } : {};
    let res;

    for (let attempt = 0; ; attempt++) {
      res = await _get(base, headers);
      if (res.status !== 429 && res.status < 500) break;
      if (attempt >= RETRY_BACKOFF_MS.length) break;
      console.warn(`[zoho/client] ${linkName} HTTP ${res.status}, retrying…`);
      await new Promise((r) => setTimeout(r, RETRY_BACKOFF_MS[attempt]));
    }

    if (res.status === 404) break; // empty report on some Creator setups

    const json = await res.json().catch(() => ({}));

    if (!res.ok) {
      throw new Error(`[zoho/client] ${linkName} HTTP ${res.status} code=${json.code || '?'} msg=${JSON.stringify(json.message || json.description || json).slice(0, 300)}`);
    }
    if (json.code === 3100) break; // "no records found"
    if (json.code !== 3000) {
      // Log the FULL body — the code alone is useless for diagnosis
      // (e.g. code 4000 covers everything from bad params to daily API
      // limit exceeded).
      throw new Error(`[zoho/client] ${linkName} code=${json.code} body=${JSON.stringify(json).slice(0, 300)}`);
    }

    records.push(...(json.data || []));

    cursor = res.headers.get('record_cursor');
    if (!cursor) break;
  }

  return records;
}

/** Fetch a single record by Zoho record ID. */
async function fetchRecord(linkName, id) {
  const res = await _get(`${reportUrl(linkName)}/${encodeURIComponent(id)}`, {});
  if (res.status === 404) return null;
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.code !== 3000) {
    throw new Error(`[zoho/client] ${linkName}/${id} HTTP ${res.status} code=${json.code || '?'}`);
  }
  return json.data || null;
}

module.exports = { fetchReport, fetchRecord, budgetStatus };
