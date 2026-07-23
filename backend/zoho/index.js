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
// (almost) never hit Zoho directly. Staggered start to avoid a burst.
function startWarmLoop() {
  const { getOrRefresh } = require('./cache');
  const { fetchReport } = require('./client');
  const { mapRecords } = require('./mappers');

  Object.entries(REPORTS).forEach(([key, { linkName, ttlMs }], i) => {
    const warm = () =>
      getOrRefresh(key, ttlMs, async () => mapRecords(key, await fetchReport(linkName)))
        .catch((err) => console.warn(`[zoho/warm] ${key}:`, err.message));

    setTimeout(() => {
      warm();
      setInterval(warm, ttlMs);
    }, 60_000 + i * 15_000); // first warm 1 min after boot, 15 s apart
  });
  console.log('[zoho] warm loop scheduled');
}

module.exports = { router: buildRouter() };
