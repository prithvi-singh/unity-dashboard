'use strict';

/**
 * cacheMerge — merges pre-computed historical metrics with today's incremental
 * delta to produce a complete response. The frontend never knows the difference.
 *
 * Two strategies:
 *   1. mergeMetrics — for the canonical metrics object from getCoreMetrics
 *   2. mergeByKey — generic array merge for byCentre, byClinician, etc.
 */

/**
 * mergeMetrics(historical, todayDelta)
 *
 * Merges two getCoreMetrics result objects by summing numeric fields
 * and merging array fields (byCentre, byClinician, etc.).
 *
 * If either input is null/undefined, returns the other as-is.
 */
function mergeMetrics(historical, todayDelta) {
  if (!historical && !todayDelta) return null;
  if (!historical) return todayDelta;
  if (!todayDelta) return historical;

  // Start with a deep-clone of historical to avoid mutating the cache
  const merged = JSON.parse(JSON.stringify(historical));

  // ── Pipeline ────────────────────────────────────────────────────────────
  if (todayDelta.pipeline) {
    const hp = merged.pipeline || {};
    const tp = todayDelta.pipeline;
    for (const key of Object.keys(tp)) {
      if (typeof tp[key] === 'number') {
        hp[key] = (hp[key] || 0) + tp[key];
      }
      // For array/drill-through pipeline fields, merge by apId
      if (key === 'drillThrough' && Array.isArray(tp[key])) {
        hp[key] = mergeByKey(hp[key] || [], tp[key], 'apId');
      }
    }
  }

  // ── Cases ───────────────────────────────────────────────────────────────
  if (todayDelta.cases) {
    merged.cases = merged.cases || {};
    merged.cases.total = (merged.cases.total || 0) + (todayDelta.cases.total || 0);
    merged.cases.byCentre = mergeByKey(
      merged.cases.byCentre, todayDelta.cases.byCentre, 'centreId', 'count'
    );
    merged.cases.byClinician = mergeByKey(
      merged.cases.byClinician, todayDelta.cases.byClinician, 'userId', 'count'
    );
    merged.cases.byManager = mergeByKey(
      merged.cases.byManager, todayDelta.cases.byManager, 'userId', 'count'
    );
    merged.cases.byOps = mergeByKey(
      merged.cases.byOps, todayDelta.cases.byOps, 'userId', 'count'
    );
  }

  // ── Assessments ─────────────────────────────────────────────────────────
  if (todayDelta.assessments) {
    merged.assessments = merged.assessments || {};
    const ha = merged.assessments;
    const ta = todayDelta.assessments;
    ha.assigned = (ha.assigned || 0) + (ta.assigned || 0);
    ha.scored = (ha.scored || 0) + (ta.scored || 0);
    ha.completionRate = ha.assigned > 0
      ? parseFloat(((ha.scored / ha.assigned) * 100).toFixed(1))
      : 0;
    ha.byCentre = mergeByKey(ha.byCentre, ta.byCentre, 'centreId');
    ha.byType = mergeByType(ha.byType, ta.byType);
    ha.byClinician = mergeByKey(ha.byClinician, ta.byClinician, 'userId');
    ha.byManager = mergeByKey(ha.byManager, ta.byManager, 'userId');
  }

  // ── Reports ─────────────────────────────────────────────────────────────
  if (todayDelta.reports) {
    merged.reports = merged.reports || {};
    const hr = merged.reports;
    const tr = todayDelta.reports;
    hr.drafted = (hr.drafted || 0) + (tr.drafted || 0);
    hr.edits = (hr.edits || 0) + (tr.edits || 0);
    hr.approved = (hr.approved || 0) + (tr.approved || 0);
    hr.byCentre = mergeByKey(hr.byCentre, tr.byCentre, 'centreId');
    hr.byClinician = mergeByKey(hr.byClinician, tr.byClinician, 'userId');
    hr.byManager = mergeByKey(hr.byManager, tr.byManager, 'userId');
  }

  // ── Goals ───────────────────────────────────────────────────────────────
  if (todayDelta.goals) {
    merged.goals = merged.goals || {};
    const hg = merged.goals;
    const tg = todayDelta.goals;
    hg.added = (hg.added || 0) + (tg.added || 0);
    hg.approved = (hg.approved || 0) + (tg.approved || 0);
    hg.byCentre = mergeByKey(hg.byCentre, tg.byCentre, 'centreId');
    hg.byClinician = mergeByKey(hg.byClinician, tg.byClinician, 'userId');
    hg.byManager = mergeByKey(hg.byManager, tg.byManager, 'userId');
  }

  // ── Users (use today's values for active/quiet counts, take max for totals) ─
  if (todayDelta.users && merged.users) {
    merged.users.active = (merged.users.active || 0) + (todayDelta.users.active || 0);
    merged.users.total = Math.max(merged.users.total || 0, todayDelta.users.total || 0);
    // byRole and byCentre: use the larger value (snapshot, not additive)
    merged.users.byRole = todayDelta.users.byRole || merged.users.byRole;
    merged.users.byCentre = todayDelta.users.byCentre || merged.users.byCentre;
  }

  // ── Centres (use today's snapshot for active/idle) ─────────────────────
  if (todayDelta.centres && merged.centres) {
    merged.centres.active = Math.max(merged.centres.active || 0, todayDelta.centres.active || 0);
    // total centres shouldn't change day to day, use max
    merged.centres.total = Math.max(merged.centres.total || 0, todayDelta.centres.total || 0);
    merged.centres.idle = merged.centres.total - merged.centres.active;
  }

  // ── Period — update to reflect combined range ───────────────────────────
  if (merged.period && todayDelta.period) {
    merged.period.dateTo = todayDelta.period.dateTo || merged.period.dateTo;
  }

  return merged;
}

/**
 * mergeByKey(historical, today, keyField, sumField)
 *
 * Merges two arrays of objects by a key field, summing all numeric values.
 * If sumField is provided, only that specific field is summed.
 *
 * Example: mergeByKey([{id:1, count:5}], [{id:1, count:3}], 'id')
 *          → [{id:1, count:8}]
 */
function mergeByKey(historical, today, keyField, sumField) {
  if (!Array.isArray(historical) || historical.length === 0) return today || [];
  if (!Array.isArray(today) || today.length === 0) return historical;

  const map = new Map();
  for (const h of historical) {
    map.set(h[keyField], { ...h });
  }
  for (const t of today) {
    const existing = map.get(t[keyField]);
    if (existing) {
      if (sumField) {
        existing[sumField] = (existing[sumField] || 0) + (t[sumField] || 0);
      } else {
        // Sum all numeric values
        for (const field of Object.keys(t)) {
          if (typeof t[field] === 'number') {
            existing[field] = (existing[field] || 0) + t[field];
          }
        }
        // For completionRate fields, recalculate
        if (existing.assigned !== undefined && existing.scored !== undefined && existing.assigned > 0) {
          existing.completionRate = parseFloat(((existing.scored / existing.assigned) * 100).toFixed(1));
        }
      }
    } else {
      map.set(t[keyField], { ...t });
    }
  }
  return [...map.values()];
}

/**
 * mergeByType(historical, today)
 *
 * Merges assessment-by-type arrays, keyed by 'type'.
 */
function mergeByType(historical, today) {
  if (!Array.isArray(historical) || historical.length === 0) return today || [];
  if (!Array.isArray(today) || today.length === 0) return historical;

  const map = new Map();
  for (const h of historical) {
    map.set(h.type, { ...h });
  }
  for (const t of today) {
    const existing = map.get(t.type);
    if (existing) {
      existing.assigned = (existing.assigned || 0) + (t.assigned || 0);
      existing.scored = (existing.scored || 0) + (t.scored || 0);
      existing.completionRate = existing.assigned > 0
        ? parseFloat(((existing.scored / existing.assigned) * 100).toFixed(1))
        : 0;
    } else {
      map.set(t.type, { ...t });
    }
  }
  return [...map.values()];
}

module.exports = { mergeMetrics, mergeByKey, mergeByType };
