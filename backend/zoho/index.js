'use strict';
// Zoho module entry point — the ONLY file server.js touches.
// If env vars are missing, exports a stub router so the rest of the app
// boots and runs exactly as before. Zoho can never take Unity down.

const { Router } = require('express');
const { isConfigured, REPORTS, env } = require('./config');

function buildRouter() {
  if (!isConfigured()) {
    console.warn('[zoho] ZOHO_CLIENT_ID/SECRET/REFRESH_TOKEN not set — mounting stub router');
    const stub = Router();
    stub.all('*', (_req, res) =>
      res.status(503).json({
        source: 'zoho',
        configured: false,
        error: 'Zoho integration not configured — set ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_REFRESH_TOKEN',
      })
    );
    return stub;
  }

  console.log(`[zoho] configured — api=${env.apiBase} modules=${Object.keys(REPORTS).join(',')}`);
  const router = require('./routes');
  startWarmLoop();
  return router;
}

// Background sync loop: incremental sync per module on its TTL.
// - Snapshots load at boot (0 API calls after a restart)
// - Delta fetches (Modified_Time criteria) cost ~1 call vs ~22 for full
// - STRICTLY SEQUENTIAL — one fetch in flight (concurrent full fetches
//   OOM-kill a 1Gi container; learned in production 2026-07-23)
// - Exponential backoff on failure: 5m→15m→45m→2h (without it, a persistent
//   failure like quota exhaustion got hammered 10k×/night, killing the next
//   day's quota too; learned in production 2026-07-24)
function startWarmLoop() {
  const store = require('./store');
  const { syncModule } = require('./sync');

  const keys = Object.keys(REPORTS);
  store.loadSnapshots(keys);

  const failures = new Map(); // key → { count, nextTryAt }
  const BACKOFF_MS = [5 * 60_000, 15 * 60_000, 45 * 60_000, 120 * 60_000];

  const syncOne = async (key) => {
    const now = Date.now();
    const fail = failures.get(key);
    if (fail && now < fail.nextTryAt) return; // backing off
    try {
      const result = await syncModule(key); // TTL-aware; skips if fresh
      if (result.mode !== 'skip') failures.delete(key);
    } catch (err) {
      const count = (fail?.count ?? 0) + 1;
      const backoff = BACKOFF_MS[Math.min(count - 1, BACKOFF_MS.length - 1)];
      failures.set(key, { count, nextTryAt: now + backoff });
      console.warn(`[zoho/sync] ${key} failed (attempt ${count}, next try in ${Math.round(backoff / 60000)}m):`, err.message);
    }
  };

  const cycle = async () => {
    for (const key of keys) {
      await syncOne(key); // sequential — never parallel
    }
    setTimeout(cycle, 60_000);
  };

  setTimeout(cycle, 60_000); // first pass 1 min after boot
  console.log('[zoho] sync loop scheduled (incremental, sequential)');
}

module.exports = { router: buildRouter() };
