'use strict';

/**
 * Admin cache management routes.
 *
 *   POST   /api/admin/cache/refresh   — Manually trigger nightly pre-computation
 *   GET    /api/admin/cache/status    — Current cache state
 *   DELETE /api/admin/cache/clear     — Clear all cache (force full recompute)
 *
 * These endpoints are for internal/backend use only. They are not exposed
 * to the frontend directly.
 */

const { Router } = require('express');
const { runNightlyJob, getStatus } = require('../services/nightlyJob');
const persistentCache = require('../services/persistentCache');

const router = Router();

/**
 * POST /api/admin/cache/refresh
 * Triggers the nightly pre-computation job immediately.
 * Use after a data fix, during testing, or after a deployment.
 * Response: { success, windows, errors, durationMs }
 */
router.post('/refresh', async (req, res, next) => {
  try {
    console.log('[admin] Manual cache refresh triggered via API');
    res.json({ message: 'Cache refresh started...' });

    // Don't await — run in background so the response doesn't time out.
    // The status endpoint can be polled to check completion.
    runNightlyJob()
      .then((result) => {
        console.log('[admin] Cache refresh complete:', JSON.stringify(result.windows));
      })
      .catch((err) => {
        console.error('[admin] Cache refresh failed:', err.message);
      });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/admin/cache/status
 * Returns the current cache state: loaded windows, file sizes,
 * when the last/next job runs, and cron status.
 * Response: { lastJobRun, nextJobRun, cronActive, windows, totalSizeBytes, memoryEntries }
 */
router.get('/status', async (req, res, next) => {
  try {
    const status = await getStatus();
    res.json(status);
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/admin/cache/clear
 * Clears all cache files and memory cache.
 * Forces full recompute on the next request.
 * Use only for debugging.
 */
router.delete('/clear', async (req, res, next) => {
  try {
    await persistentCache.clear();
    console.log('[admin] All cache cleared via API');
    res.json({ success: true, message: 'All cache cleared' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
