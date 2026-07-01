'use strict';

/**
 * nightlyJob — Pre-computation job that runs once per day.
 *
 * Scheduled at 18:30 UTC (00:00 IST) via node-cron.
 * Pre-computes all core metrics for rolling windows (7d, 30d, 60d, 90d)
 * up to the end of yesterday, and persists them to the file cache.
 *
 * Also computable on-demand via POST /api/admin/cache/refresh.
 */

const persistentCache = require('./persistentCache');
const { getCoreMetrics, clearCache: clearMetricsCache } = require('./metricsService');

// Will be set when cron is initialised
let _cronJob = null;
let _lastRunTime = null;
let _nextRunTime = null;

/**
 * daysAgo(n) — returns YYYY-MM-DD for n days ago from today (IST).
 */
function daysAgo(n) {
  const now = new Date();
  const ist = new Date(now.getTime() + (5.5 * 60 * 60 * 1000));
  ist.setDate(ist.getDate() - n);
  return ist.toISOString().slice(0, 10);
}

/**
 * dateAtIST(yyyymmdd) — parses YYYY-MM-DD as IST midnight.
 */
function dateAtIST(yyyymmdd) {
  return new Date(`${yyyymmdd}T00:00:00+05:30`);
}

/**
 * runNightlyJob()
 *
 * Main entry point. Pre-computes metrics for all rollout windows
 * and persists to cache. Safe to call multiple times — it will
 * overwrite previous cache entries.
 *
 * @returns {Object} result — { success, windows, errors, durationMs }
 */
async function runNightlyJob() {
  const startedAt = Date.now();
  console.log('[nightly] Starting pre-computation job...');

  const today = daysAgo(0);
  const yesterday = daysAgo(1);
  const yesterdayDate = dateAtIST(yesterday);

  // Clear the in-memory metrics cache so getCoreMetrics fetches fresh data.
  // The nightly job must compute from real DB data, not stale cache.
  clearMetricsCache();

  // Rolling windows up to end of yesterday
  const windows = [
    { label: '7d',  dateFrom: daysAgo(7),  dateTo: yesterday },
    { label: '30d', dateFrom: daysAgo(30), dateTo: yesterday },
    { label: '60d', dateFrom: daysAgo(60), dateTo: yesterday },
    { label: '90d', dateFrom: daysAgo(90), dateTo: yesterday },
  ];

  const results = { success: true, windows: [], errors: [] };

  for (const window of windows) {
    try {
      console.log(`[nightly] Computing ${window.label} window (${window.dateFrom} → ${window.dateTo})...`);
      const windowStart = Date.now();

      const fromDate = dateAtIST(window.dateFrom);
      const toDate = dateAtIST(window.dateTo);

      // Core metrics for this window (15 parallel queries)
      const metrics = await getCoreMetrics({
        dateFrom: fromDate,
        dateTo: toDate,
        centreId: null,
      });

      await persistentCache.set('metrics', window.label, {
        data: metrics,
        computedAt: new Date().toISOString(),
        window: window.label,
        dateFrom: window.dateFrom,
        dateTo: window.dateTo,
      });

      const elapsed = Date.now() - windowStart;
      results.windows.push({ label: window.label, success: true, durationMs: elapsed });
      console.log(`[nightly] ${window.label} window complete in ${elapsed}ms`);
    } catch (err) {
      console.error(`[nightly] Failed ${window.label} window:`, err.message);
      results.errors.push({ window: window.label, error: err.message });
      // Continue with other windows — partial cache is better than no cache
    }
  }

  // Clean up old cache files (older than 7 days)
  try {
    await persistentCache.cleanup(7);
  } catch (err) {
    console.warn('[nightly] Cache cleanup failed:', err.message);
  }

  _lastRunTime = new Date().toISOString();
  const totalMs = Date.now() - startedAt;
  results.durationMs = totalMs;
  console.log(`[nightly] Pre-computation job complete in ${totalMs}ms — ${results.windows.length} windows, ${results.errors.length} errors`);
  return results;
}

/**
 * startupWarmUp()
 *
 * Called on server startup. Checks if today's cache exists.
 * If not (cold start or new deploy), runs the pre-computation immediately
 * so the first real user doesn't hit a cold cache.
 */
async function startupWarmUp() {
  console.log('[startup] Checking cache state...');

  try {
    // Check if 30d cache exists (our primary window)
    const cached30d = await persistentCache.get('metrics', '30d');
    if (cached30d && cached30d.data) {
      console.log('[startup] Cache warm — skipping pre-computation');
      return { warm: true };
    }

    console.log('[startup] Cache cold — running pre-computation now...');
    const result = await runNightlyJob();
    console.log('[startup] Warm-up complete');
    return { warm: true, result };
  } catch (err) {
    console.error('[startup] Warm-up failed:', err.message);
    return { warm: false, error: err.message };
  }
}

/**
 * initCron()
 *
 * Initialises the cron schedule. Called once from server.js.
 * Schedules runNightlyJob at 18:30 UTC (midnight IST).
 */
function initCron() {
  try {
    // Lazy-require node-cron so it only loads when we need it
    const cron = require('node-cron');

    // 18:30 UTC = 00:00 IST
    _cronJob = cron.schedule('30 18 * * *', async () => {
      console.log('[cron] Triggered nightly pre-computation');
      try {
        await runNightlyJob();
      } catch (err) {
        console.error('[cron] Nightly job failed:', err.message);
      }
    }, {
      scheduled: true,
      timezone: 'UTC',
    });

    _nextRunTime = computeNextRunTime();
    console.log('[cron] Nightly job scheduled at 18:30 UTC (00:00 IST) daily');
  } catch (err) {
    console.warn('[cron] Failed to init — node-cron may not be installed:', err.message);
    console.warn('[cron] Nightly pre-computation will NOT run automatically.');
    console.warn('[cron] Install with: npm install node-cron --save');
  }
}

function computeNextRunTime() {
  const now = new Date();
  const next = new Date(Date.UTC(
    now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 18, 30, 0, 0
  ));
  if (next <= now) {
    next.setUTCDate(next.getUTCDate() + 1);
  }
  return next.toISOString();
}

/**
 * getStatus()
 *
 * Returns current cache and job status for health/admin endpoints.
 */
async function getStatus() {
  const cacheStats = persistentCache.stats();
  const windows = [7, 30, 60, 90].map((d) => {
    const label = `${d}d`;
    const entry = cacheStats.entries.find((e) => e.key.startsWith(`metrics-${label}`));
    return {
      label,
      exists: !!entry,
      sizeBytes: entry ? entry.sizeBytes : 0,
      savedAt: entry ? entry.savedAt : null,
    };
  });

  return {
    lastJobRun: _lastRunTime,
    nextJobRun: _nextRunTime,
    cronActive: _cronJob !== null,
    windows,
    totalSizeBytes: cacheStats.totalSizeBytes,
    memoryEntries: cacheStats.memoryEntries,
  };
}

module.exports = { runNightlyJob, startupWarmUp, initCron, getStatus };
