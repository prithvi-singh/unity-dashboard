'use strict';

/**
 * incrementalService — Today-only delta queries.
 *
 * Provides lightweight queries scoped to today only (CAST AS DATE = today).
 * Used alongside pre-computed historical caches to build full responses
 * without re-querying the entire date range.
 *
 * Target: each function should complete in < 200ms because today has
 * far fewer rows than a 30/60/90-day window.
 */

const { getCoreMetrics } = require('./metricsService');

/**
 * Returns today's date in YYYY-MM-DD format using IST.
 */
function todayIST() {
  const now = new Date();
  // Convert to IST: UTC+5:30
  const ist = new Date(now.getTime() + (5.5 * 60 * 60 * 1000));
  return ist.toISOString().slice(0, 10);
}

/**
 * Parses a YYYY-MM-DD string into a Date object at IST midnight.
 */
function dateAtIST(yyyymmdd) {
  return new Date(`${yyyymmdd}T00:00:00+05:30`);
}

/**
 * getTodayIncrementalMetrics({ centreId })
 *
 * Returns the same metrics shape as getCoreMetrics but for today only.
 * Uses the existing metricsService with a narrow date range.
 * Falls back to null on timeout so partial data can still be served.
 */
async function getTodayIncrementalMetrics({ centreId = null } = {}) {
  const today = todayIST();
  const todayDate = dateAtIST(today);

  try {
    const metrics = await getCoreMetrics({
      dateFrom: todayDate,
      dateTo: todayDate,
      centreId: centreId || null,
    });
    return metrics;
  } catch (err) {
    console.warn('[incremental] Today metrics query failed:', err.message);
    return null;
  }
}

/**
 * isTodayIncluded(dateTo)
 *
 * Returns true if the requested dateTo includes today.
 */
function isTodayIncluded(dateTo) {
  if (!dateTo) return true; // No dateTo = up to now = includes today
  const today = todayIST();
  const toStr = dateTo.toISOString().slice(0, 10);
  return toStr >= today;
}

/**
 * isDateRangeCacheable(dateFrom, dateTo)
 *
 * Returns true if this date range can be served by the cache-merge strategy.
 * Conditions:
 *   1. dateTo includes today (otherwise it's purely historical)
 *   2. The range length matches one of our pre-computed windows (7d, 30d, 60d, 90d)
 */
function isDateRangeCacheable(dateFrom, dateTo) {
  if (!dateFrom) return false;
  if (!isTodayIncluded(dateTo)) return false;

  const today = dateAtIST(todayIST());
  const fromMs = dateFrom.getTime();
  const toMs = today.getTime();
  const daysDiff = Math.round((toMs - fromMs) / 86400000);

  const windows = [7, 30, 60, 90];
  return windows.some((w) => Math.abs(daysDiff - w) <= 1);
}

/**
 * getMatchingWindow(dateFrom)
 *
 * Returns the window label ('7d', '30d', '60d', '90d') that best matches
 * the given dateFrom, or null if none matches.
 */
function getMatchingWindow(dateFrom) {
  if (!dateFrom) return null;

  const today = dateAtIST(todayIST());
  const fromMs = dateFrom.getTime();
  const toMs = today.getTime();
  const daysDiff = Math.round((toMs - fromMs) / 86400000);

  const windows = [7, 30, 60, 90];
  for (const w of windows) {
    if (Math.abs(daysDiff - w) <= 1) return `${w}d`;
  }
  return null;
}

module.exports = {
  getTodayIncrementalMetrics,
  isTodayIncluded,
  isDateRangeCacheable,
  getMatchingWindow,
  todayIST,
  dateAtIST,
};
