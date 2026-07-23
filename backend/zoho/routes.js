'use strict';
// Zoho routes — mounted at /api/zoho by server.js.
// Every response includes { source: 'zoho', asOf, stale } so the frontend
// can show "as of HH:MM" badges when serving last-good data.

const { Router } = require('express');
const { REPORTS } = require('./config');
const { fetchReport, fetchRecord } = require('./client');
const { getOrRefresh, status: cacheStatus } = require('./cache');
const { tokenStatus } = require('./auth');
const { mapRecords } = require('./mappers');

const router = Router();

async function loadModule(key) {
  const { linkName, ttlMs } = REPORTS[key];
  return getOrRefresh(key, ttlMs, async () => {
    const raw = await fetchReport(linkName);
    return mapRecords(key, raw);
  });
}

// GET /api/zoho/health
router.get('/health', (_req, res) => {
  res.json({
    source: 'zoho',
    configured: true,
    token: tokenStatus(),
    cache: cacheStatus(),
    modules: Object.keys(REPORTS),
  });
});

// GET /api/zoho/summary — record counts for all modules (for summary cards)
router.get('/summary', async (_req, res, next) => {
  try {
    const keys = Object.keys(REPORTS);
    const results = await Promise.allSettled(keys.map(loadModule));
    const summary = {};
    let anyStale = false;

    results.forEach((r, i) => {
      const key = keys[i];
      if (r.status === 'fulfilled') {
        summary[key] = { count: r.value.data.length, asOf: r.value.asOf, stale: r.value.stale };
        anyStale = anyStale || r.value.stale;
      } else {
        console.warn(`[zoho/routes] summary: ${key} failed:`, r.reason?.message);
        summary[key] = { count: null, error: true };
      }
    });

    res.json({ source: 'zoho', stale: anyStale, summary });
  } catch (err) { next(err); }
});

// GET /api/zoho/:module — full mapped list
router.get('/:module', async (req, res, next) => {
  const key = req.params.module;
  if (!REPORTS[key]) {
    return res.status(404).json({ error: `Unknown Zoho module '${key}'`, modules: Object.keys(REPORTS) });
  }
  try {
    const { data, asOf, stale } = await loadModule(key);
    res.json({ source: 'zoho', module: key, asOf, stale, count: data.length, data });
  } catch (err) {
    console.error(`[zoho/routes] ${key} failed:`, err.message);
    res.status(503).json({ source: 'zoho', module: key, error: 'Zoho data unavailable' });
  }
});

// GET /api/zoho/:module/:id — single record (bypasses cache, live fetch)
router.get('/:module/:id', async (req, res, next) => {
  const key = req.params.module;
  if (!REPORTS[key]) {
    return res.status(404).json({ error: `Unknown Zoho module '${key}'` });
  }
  try {
    const record = await fetchRecord(REPORTS[key].linkName, req.params.id);
    if (!record) return res.status(404).json({ error: 'Record not found' });
    res.json({ source: 'zoho', module: key, data: record });
  } catch (err) {
    console.error(`[zoho/routes] ${key}/${req.params.id} failed:`, err.message);
    res.status(503).json({ source: 'zoho', module: key, error: 'Zoho data unavailable' });
  }
});

module.exports = router;
