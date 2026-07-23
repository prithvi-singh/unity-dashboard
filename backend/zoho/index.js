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

// Background warm loop: refresh each module on its TTL so user requests
// (almost) never hit Zoho directly.
// STRICTLY SEQUENTIAL — exactly one module fetch in flight at any time.
// Modules run 20k+ records each; concurrent full fetches OOM-kill a 1Gi
// container (learned in production, 2026-07-23).
function startWarmLoop() {
  const { getOrRefresh } = require('./cache');
  const { fetchReport } = require('./client');
  const { mapRecords } = require('./mappers');

  const entries = Object.entries(REPORTS);
  const lastWarmed = new Map(); // key → ts of last successful warm

  const warmOne = async ([key, { linkName, ttlMs }]) => {
    const due = !lastWarmed.has(key) || Date.now() - lastWarmed.get(key) >= ttlMs;
    if (!due) return;
    try {
      await getOrRefresh(key, ttlMs, async () => mapRecords(key, await fetchReport(linkName)));
      lastWarmed.set(key, Date.now());
      console.log(`[zoho/warm] ${key} warmed`);
    } catch (err) {
      console.warn(`[zoho/warm] ${key}:`, err.message);
    }
  };

  const cycle = async () => {
    for (const entry of entries) {
      await warmOne(entry); // sequential — never parallel
    }
    setTimeout(cycle, 60_000); // re-check due-ness every minute after a full pass
  };

  setTimeout(cycle, 60_000); // first pass 1 min after boot
  console.log('[zoho] warm loop scheduled (sequential)');
}

module.exports = { router: buildRouter() };
