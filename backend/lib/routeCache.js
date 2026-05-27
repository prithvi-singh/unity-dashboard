'use strict';

/**
 * routeCache — lightweight in-memory response cache for Express routes.
 *
 * Usage:
 *   const { makeCache } = require('../lib/routeCache');
 *   const issuesCache = makeCache(2 * 60 * 1000); // 2-minute TTL
 *
 *   router.get('/', (req, res, next) => {
 *     const key = issuesCache.key(req); // default: req.url
 *     const hit = issuesCache.get(key);
 *     if (hit) return res.json(hit);
 *     // ... fetch data ...
 *     issuesCache.set(key, data);
 *     res.json(data);
 *   });
 */

function makeCache(ttlMs) {
  const _store = new Map();

  function get(key) {
    const entry = _store.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) { _store.delete(key); return null; }
    return entry.data;
  }

  function set(key, data) {
    _store.set(key, { data, expiresAt: Date.now() + ttlMs });
  }

  function invalidate(key) {
    if (key) _store.delete(key);
    else _store.clear();
  }

  function key(req) {
    return req.url;
  }

  function stats() {
    let valid = 0;
    const now = Date.now();
    for (const entry of _store.values()) {
      if (entry.expiresAt > now) valid++;
    }
    return { total: _store.size, valid, ttlMs };
  }

  return { get, set, invalidate, key, stats };
}

module.exports = { makeCache };
