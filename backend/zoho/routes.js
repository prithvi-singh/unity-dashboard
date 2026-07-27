'use strict';
// Zoho routes — mounted at /api/zoho by server.js.
// SERVE-FROM-STORE ONLY: no route ever triggers a Zoho API call. The sync
// engine (background) is the sole consumer of API quota. With daily limits
// as low as 250 calls, user traffic must cost zero.

const { Router } = require('express');
const { REPORTS } = require('./config');
const { budgetStatus, truncatedStatus } = require('./client');
const { tokenStatus } = require('./auth');
const store = require('./store');

const router = Router();

// GET /api/zoho/health
router.get('/health', (_req, res) => {
  res.json({
    source: 'zoho',
    configured: true,
    token: tokenStatus(),
    apiBudget: budgetStatus(),
    truncated: truncatedStatus(),
    snapshots: store.snapshotsEnabled(),
    store: store.status(),
    modules: Object.keys(REPORTS),
  });
});

// GET /api/zoho/summary — counts for all modules (store-only, instant)
router.get('/summary', (_req, res) => {
  const summary = {};
  for (const key of Object.keys(REPORTS)) {
    const mod = store.getModule(key);
    summary[key] = mod
      ? { count: mod.data.length, asOf: new Date(mod.asOf).toISOString() }
      : { count: null, warming: true };
  }
  res.json({ source: 'zoho', summary });
});

// GET /api/zoho/:module — paginated list from store
// Query: limit (default 50, max 200), offset, search
router.get('/:module', (req, res) => {
  const key = req.params.module;
  if (!REPORTS[key]) {
    return res.status(404).json({ error: `Unknown Zoho module '${key}'`, modules: Object.keys(REPORTS) });
  }

  const mod = store.getModule(key);
  if (!mod) {
    return res.status(503).json({ source: 'zoho', module: key, warming: true, error: 'Zoho data still syncing — try again shortly' });
  }

  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
  const search = (req.query.search || '').toString().trim().toLowerCase();

  let filtered = mod.data;
  if (search) {
    filtered = mod.data.filter((rec) =>
      Object.values(rec).some((v) => typeof v === 'string' && v.toLowerCase().includes(search))
    );
  }

  res.json({
    source: 'zoho',
    module: key,
    asOf: new Date(mod.asOf).toISOString(),
    stale: Date.now() - mod.asOf > REPORTS[key].ttlMs * 2,
    total: filtered.length,
    limit,
    offset,
    data: filtered.slice(offset, offset + limit),
  });
});

// GET /api/zoho/:module/:id — single record from store (zero API cost)
router.get('/:module/:id', (req, res) => {
  const key = req.params.module;
  if (!REPORTS[key]) {
    return res.status(404).json({ error: `Unknown Zoho module '${key}'` });
  }
  const mod = store.getModule(key);
  if (!mod) {
    return res.status(503).json({ source: 'zoho', module: key, warming: true });
  }
  const record = mod.data.find((r) => String(r.id) === String(req.params.id));
  if (!record) return res.status(404).json({ error: 'Record not found' });
  res.json({ source: 'zoho', module: key, data: record });
});

module.exports = router;
