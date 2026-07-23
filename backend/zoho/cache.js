'use strict';
// Module-local TTL cache with stale-while-revalidate.
// Deliberately NOT ../services/cacheService — the Zoho module owns its cache
// so a change on either side can't break the other.
//
// Behaviour:
// - Within TTL          → serve cached.
// - Past TTL            → serve cached immediately, refresh in background.
// - Refresh fails       → keep serving last-good data, flagged stale.
// - Nothing cached yet  → block on first fetch.

const _store = new Map(); // key → { data, asOf, refreshing }

async function getOrRefresh(key, ttlMs, fetcher) {
  const entry = _store.get(key);
  const now = Date.now();

  if (entry) {
    const expired = now - entry.asOf > ttlMs;
    if (expired && !entry.refreshing) {
      entry.refreshing = true;
      fetcher()
        .then((data) => _store.set(key, { data, asOf: Date.now(), refreshing: false }))
        .catch((err) => {
          entry.refreshing = false;
          console.warn(`[zoho/cache] background refresh failed for ${key}:`, err.message);
        });
    }
    return { data: entry.data, asOf: new Date(entry.asOf).toISOString(), stale: expired };
  }

  // Cold: block once.
  const data = await fetcher();
  _store.set(key, { data, asOf: now, refreshing: false });
  return { data, asOf: new Date(now).toISOString(), stale: false };
}

function status() {
  const out = {};
  for (const [key, { data, asOf }] of _store) {
    out[key] = { records: Array.isArray(data) ? data.length : null, asOf: new Date(asOf).toISOString() };
  }
  return out;
}

module.exports = { getOrRefresh, status };
