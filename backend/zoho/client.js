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

async function _get(url, headers) {
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
 * Fetch ALL records of a report (paginated).
 * @returns {Promise<Array<object>>} raw Zoho records
 */
async function fetchReport(linkName, { fieldConfig = 'quick_view' } = {}) {
  const base = `${reportUrl(linkName)}?max_records=${MAX_RECORDS}&field_config=${fieldConfig}`;
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
      throw new Error(`[zoho/client] ${linkName} HTTP ${res.status} code=${json.code || '?'}`);
    }
    if (json.code === 3100) break; // "no records found"
    if (json.code !== 3000) {
      throw new Error(`[zoho/client] ${linkName} unexpected code ${json.code}`);
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

module.exports = { fetchReport, fetchRecord };
