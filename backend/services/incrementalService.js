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
 * Returns today's date in YYYY-MM-DD format using IST (+05:30).
 */
function todayIST() {
  const now = new Date();
  const ist = new Date(now.getTime() + (5.5 * 60 * 60 * 1000));
  return ist.toISOString().slice(0, 10);
}

/**
 * Returns yesterday's date in YYYY-MM-DD format using IST.
 */
function yesterdayIST() {
  const now = new Date();
  const ist = new Date(now.getTime() + (5.5 * 60 * 60 * 1000));
  ist.setDate(ist.getDate() - 1);
  return ist.toISOString().slice(0, 10);
}

/**
 * Parses a YYYY-MM-DD string into a Date object at IST midnight.
 */
function dateAtIST(yyyymmdd) {
  return new Date(`${yyyymmdd}T00:00:00+05:30`);
}

/**
 * Converts a Date object (which may be in any timezone) into an IST YYYY-MM-DD string.
 * Does NOT use toISOString() because that converts to UTC which can shift the date
 * back by one day for IST dates.
 */
function dateToISTString(date) {
  // date.getTime() is always UTC epoch ms — convert to IST manually
  const istMs = date.getTime() + (5.5 * 60 * 60 * 1000);
  const istDate = new Date(istMs);
  return istDate.getUTCFullYear() + '-' +
    String(istDate.getUTCMonth() + 1).padStart(2, '0') + '-' +
    String(istDate.getUTCDate()).padStart(2, '0');
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
 * Returns true if the requested dateTo includes today (in IST).
 * Uses IST-aware comparison to avoid the toISOString() timezone shift bug.
 */
function isTodayIncluded(dateTo) {
  if (!dateTo) return true; // No dateTo = up to now = includes today
  const today = todayIST();
  const toStr = dateToISTString(dateTo);
  return toStr >= today;
}

/**
 * isDateRangeCacheable(dateFrom, dateTo)
 *
 * Returns true if this date range can be served by the cache-merge strategy.
 * Conditions:
 *   1. dateTo is on or after yesterday (cache covers up to end of yesterday)
 *   2. The range length matches one of our pre-computed windows (7d, 30d, 60d, 90d)
 */
function isDateRangeCacheable(dateFrom, dateTo) {
  if (!dateFrom) return false;

  // DateTo must be on or after yesterday for cache to be useful.
  // If dateTo is before yesterday, it's a purely historical query and the
  // nightly cache already covers it fully — we can still serve cache directly.
  // But for simplicity, we only use cache when dateTo >= yesterday,
  // because that's when we need the merge with today's delta.
  if (dateTo) {
    const toStr = dateToISTString(dateTo);
    const yesterday = yesterdayIST();
    if (toStr < yesterday) return false;
  }
  // If dateTo is null, use today as the endpoint
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
  yesterdayIST,
  dateAtIST,
  dateToISTString,
};
