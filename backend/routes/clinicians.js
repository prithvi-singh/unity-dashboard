'use strict';

const { Router } = require('express');
const { sql, poolPromise } = require('../db');
const { parseDateParam, buildDateFilter, buildCentreExclusion, buildPatientExclusion } = require('../lib/queryHelpers');
const { abbreviateCentre } = require('../lib/formatters');
const { getCoreMetrics } = require('../services/metricsService');
const { activeCaseloadWhere } = require('../utils/queries');
const { EVENT_TYPES, toSqlIn } = require('../utils/metrics');
const { TERMINAL_STATUSES } = require('../utils/assessmentState');
const { getProgressNoteCountsByUser } = require('../utils/goalProgress');
const persistentCache = require('../services/persistentCache');
const { getTodayIncrementalMetrics, getMatchingWindow, isDateRangeCacheable } = require('../services/incrementalService');
const { mergeMetrics } = require('../utils/cacheMerge');

// SQL fragment for excluding terminal (completed) AllocatePatient rows
const AP_ACTIVE = TERMINAL_STATUSES.map((s) => `'${s}'`).join(', ');

const router = Router();

// Build the SQL IN-list from canonical constants — never hardcode event names.
const CLINICIAN_CORE_EVENTS = toSqlIn(
  EVENT_TYPES.ASSESSMENT_RESULT_GENERATED,
  EVENT_TYPES.REPORT_ADDED,
  EVENT_TYPES.UPDATE_REPORT,
  EVENT_TYPES.GOAL_ADDED,
  EVENT_TYPES.ACTIVITY_ADDED,
);

/**
 * Count Mon–Fri working days between two Date boundaries (inclusive).
 * Uses UTC noon so results are correct regardless of the timezone carried
 * by the Date objects (parseDateParam produces IST midnight = prev-day UTC eve).
 */
function countWorkingDays(from, to) {
  const start = from ? new Date(from) : new Date(Date.now() - 30 * 86400000);
  const end   = to   ? new Date(to)   : new Date();
  let count = 0;
  const d = new Date(start);
  d.setUTCHours(12, 0, 0, 0);
  const endNoon = new Date(end);
  endNoon.setUTCHours(12, 0, 0, 0);
  while (d <= endNoon) {
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) count++;
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return count;
}

function consistencyStatus(pct) {
  if (pct === 0) return 'silent';
  if (pct < 30)  return 'inactive';
  if (pct < 70)  return 'irregular';
  return 'consistent';
}

/**
 * GET /api/clinicians
 * One row per clinician × centre assignment.
 *
 * Shared metrics (scoringComplete, reportsDrafted, reportEdits, goals added)
 * come from metricsService so they are guaranteed to match what Overview shows.
 * Only clinician-specific data that doesn't belong in shared metrics
 * (activeCaseload, lastLoginDate, lastActivityDate, totalAuditActions) is
 * fetched by a supplementary query here.
 */
router.get('/', async (req, res, next) => {
  try {
    const centreId = req.query.centreId ? parseInt(req.query.centreId, 10) : null;
    const dateFrom = parseDateParam(req.query.dateFrom);
    const dateTo   = parseDateParam(req.query.dateTo);

    if (req.query.centreId && isNaN(centreId)) {
      return res.status(400).json({ error: 'centreId must be a number' });
    }
    if (req.query.dateFrom && !dateFrom) {
      return res.status(400).json({ error: 'dateFrom must be a valid ISO date' });
    }
    if (req.query.dateTo && !dateTo) {
      return res.status(400).json({ error: 'dateTo must be a valid ISO date' });
    }

    const pool = await poolPromise;
    const centreExclusion = buildCentreExclusion('c');
    const dateFilterPal   = buildDateFilter('pal.CreatedDateTime', '@dateFrom', '@dateTo');

    // ── Cache-first metrics resolution ──────────────────────────────────────
    let metrics = null;
    const cacheable = isDateRangeCacheable(dateFrom, dateTo);
    const windowLabel = cacheable ? getMatchingWindow(dateFrom) : null;

    if (windowLabel) {
      try {
        const [cached, todayDelta] = await Promise.all([
          persistentCache.get('metrics', windowLabel),
          getTodayIncrementalMetrics({ centreId }),
        ]);
        if (cached && cached.data) {
          metrics = mergeMetrics(cached.data, todayDelta);
          console.log(`[clinicians] Cache HIT for ${windowLabel}`);
        }
      } catch (err) {
        console.warn('[clinicians] Cache merge failed, falling back to live:', err.message);
      }
    }

    if (!metrics) {
      console.log('[clinicians] Cache MISS — running live metrics query');
      metrics = await getCoreMetrics({ dateFrom, dateTo, centreId });
    }

    // Run clinician roster, consistency data, pipeline breakdown,
    // and progress note counts in parallel
    const [rosterResult, consistencyResult, pipelineResult, progressMap] = await Promise.all([

      // Clinician-specific data: roster, active caseload, audit activity totals
      pool.request()
        .input('centreId', sql.BigInt, centreId)
        .input('dateFrom', sql.DateTimeOffset, dateFrom)
        .input('dateTo',   sql.DateTimeOffset, dateTo)
        .query(`
          SELECT
            au.Id,
            au.FirstName,
            au.LastName,
            au.Email,
            au.LastLoginDateTimeUtc,
            c.Id         AS centreId,
            c.CentreName,
            SUM(CASE WHEN p.Id IS NOT NULL THEN 1 ELSE 0 END) AS totalAuditActions,
            ISNULL(cs.activeCaseload, 0) AS activeCaseload,
            MAX(CASE WHEN p.Id IS NOT NULL THEN pal.CreatedDateTime END) AS lastActivityDate
          FROM AdminUser au
          JOIN AdminUserRole aur ON aur.UserId = au.Id
          JOIN AdminRole ar      ON ar.Id = aur.RoleId AND ar.Name = 'Clinician'
          JOIN AdminUserCentre auc ON auc.AdminUserId = au.Id
          JOIN Centre c            ON c.Id = auc.CentreId
          LEFT JOIN PatientAuditLog pal ON pal.AdminUserId = au.Id
            AND ${dateFilterPal}
          LEFT JOIN Patient p ON p.Id = pal.PatientId
          LEFT JOIN (
            -- activeCaseloadWhere guarantees identical filtering to the
            -- clinician-caseload drill-down so COUNT always equals rows.
            SELECT
              ap.ClinicianUserId,
              COUNT(*) AS activeCaseload
            FROM AllocatePatient ap
            JOIN Patient pt ON pt.Id = ap.PatientId
            JOIN Centre cc  ON cc.Id = pt.CentreId
            WHERE ${activeCaseloadWhere('ap', 'pt', 'cc')}
            GROUP BY ap.ClinicianUserId
          ) cs ON cs.ClinicianUserId = au.Id
          WHERE (@centreId IS NULL OR c.Id = @centreId)
            AND ${centreExclusion}
            AND LOWER(au.FirstName) NOT LIKE '%test%'
            AND LOWER(au.LastName)  NOT LIKE '%test%'
            AND LOWER(au.Email)     NOT LIKE '%@webority.com'
          GROUP BY
            au.Id, au.FirstName, au.LastName, au.Email,
            au.LastLoginDateTimeUtc, c.Id, c.CentreName, cs.activeCaseload
          ORDER BY au.LastName, au.FirstName, c.CentreName
        `),

      // Per-clinician core-job day counts for consistency data
      pool.request()
        .input('centreId', sql.BigInt, centreId)
        .input('dateFrom', sql.DateTimeOffset, dateFrom)
        .input('dateTo',   sql.DateTimeOffset, dateTo)
        .query(`
          SELECT
            au.Id AS userId,
            COUNT(DISTINCT
              CASE WHEN pal.Type IN (${CLINICIAN_CORE_EVENTS})
              THEN CAST(pal.CreatedDateTime AS DATE) END
            ) AS coreJobDays,
            SUM(CASE WHEN pal.Type = '${EVENT_TYPES.ASSESSMENT_RESULT_GENERATED}' THEN 1 ELSE 0 END) AS assessmentsScored,
            SUM(CASE WHEN pal.Type IN (${toSqlIn(EVENT_TYPES.REPORT_ADDED, EVENT_TYPES.UPDATE_REPORT)}) THEN 1 ELSE 0 END) AS reportsDrafted,
            MAX(pal_all.CreatedDateTime) AS lastActiveDate
          FROM AdminUser au
          JOIN AdminUserRole aur ON aur.UserId = au.Id
          JOIN AdminRole ar      ON ar.Id = aur.RoleId AND ar.Name = 'Clinician'
          JOIN AdminUserCentre auc ON auc.AdminUserId = au.Id
          JOIN Centre c            ON c.Id = auc.CentreId
          LEFT JOIN PatientAuditLog pal     ON pal.AdminUserId     = au.Id
            AND ${dateFilterPal}
          LEFT JOIN PatientAuditLog pal_all ON pal_all.AdminUserId = au.Id
          WHERE (@centreId IS NULL OR c.Id = @centreId)
            AND ${centreExclusion}
            AND LOWER(au.FirstName) NOT LIKE '%test%'
            AND LOWER(au.LastName)  NOT LIKE '%test%'
            AND LOWER(au.Email)     NOT LIKE '%@webority.com'
          GROUP BY au.Id
        `),

      // ── Per-clinician pipeline breakdown ──────────────────────────────────────
      // Point-in-time (no date filter) — counts open cases in each pipeline state.
      // SQL Server forbids correlated subqueries inside aggregate functions, so we
      // pre-compute each signal as a DISTINCT LEFT JOIN then test for NULL/NOT NULL.
      pool.request()
        .input('centreId', sql.BigInt, centreId)
        .query(`
          SELECT
            ap.ClinicianUserId AS userId,
            COUNT(CASE WHEN ap.Status NOT IN (${AP_ACTIVE}) AND scored.AllocatePatientId IS NULL
              THEN 1 END) AS scoring,
            COUNT(CASE WHEN ap.Status NOT IN (${AP_ACTIVE}) AND scored.AllocatePatientId IS NULL
              AND DATEDIFF(day, ap.CreatedDateTimeUtc, SYSDATETIMEOFFSET()) > 14
              THEN 1 END) AS stuckCases,
            COUNT(CASE WHEN ap.Status NOT IN (${AP_ACTIVE})
              AND scored.AllocatePatientId IS NOT NULL AND reported.AllocatePatientId IS NULL
              THEN 1 END) AS reportsToWrite,
            COUNT(CASE WHEN ap.Status NOT IN (${AP_ACTIVE})
              AND pdfed.AllocatePatientId IS NOT NULL AND goalReq.AllocatePatientId IS NULL
              THEN 1 END) AS goalsToAdd,
            COUNT(CASE WHEN ap.Status NOT IN (${AP_ACTIVE}) AND (
              (reported.AllocatePatientId IS NOT NULL AND pdfed.AllocatePatientId IS NULL)
              OR
              (goalReq.AllocatePatientId IS NOT NULL AND goalApproved.AllocatePatientId IS NULL)
            ) THEN 1 END) AS pendingApproval
          FROM AllocatePatient ap
          JOIN Patient pt ON pt.Id = ap.PatientId
          JOIN Centre c   ON c.Id  = pt.CentreId
          LEFT JOIN (SELECT DISTINCT AllocatePatientId FROM PatientAuditLog WHERE Type = 'AssessmentResultGenerated') scored   ON scored.AllocatePatientId   = ap.Id
          LEFT JOIN (SELECT DISTINCT AllocatePatientId FROM PatientAuditLog WHERE Type = 'ReportAdded')               reported ON reported.AllocatePatientId = ap.Id
          LEFT JOIN (SELECT DISTINCT AllocatePatientId FROM PatientAuditLog WHERE Type = 'ReportPDFGenerated')        pdfed    ON pdfed.AllocatePatientId    = ap.Id
          LEFT JOIN (SELECT DISTINCT AllocatePatientId FROM PatientGoalApprovalRequest)                               goalReq  ON goalReq.AllocatePatientId  = ap.Id
          LEFT JOIN (
            SELECT DISTINCT pgar.AllocatePatientId
            FROM PatientGoalApprovalRequest pgar
            JOIN PatientGoalApprovalRequestGoal pgarg ON pgarg.PatientGoalApprovalRequestId = pgar.Id
            WHERE pgarg.Status = 'Approved'
          ) goalApproved ON goalApproved.AllocatePatientId = ap.Id
          WHERE ap.ClinicianUserId IS NOT NULL
            AND ap.Assessment IN ('SPM', 'DP3', 'REELS', 'ISAA')
            AND LOWER(c.CentreName) NOT LIKE '%test%'
            AND LOWER(c.CentreName) NOT LIKE '%delete%'
            AND pt.FirstName NOT LIKE '%test%' AND pt.LastName NOT LIKE '%test%'
            AND (@centreId IS NULL OR c.Id = @centreId)
          GROUP BY ap.ClinicianUserId
        `),

      // Progress note counts per clinician in the selected period
      getProgressNoteCountsByUser(dateFrom, dateTo, centreId),
    ]);

    // Build lookup maps from the shared service's per-clinician arrays
    const assessMap    = new Map(metrics.assessments.byClinician.map((r) => [r.userId, r]));
    const reportsMap   = new Map(metrics.reports.byClinician.map((r) => [r.userId, r]));
    const goalsMap     = new Map(metrics.goals.byClinician.map((r) => [r.userId, r]));
    const consistencyMap = new Map(consistencyResult.recordset.map((r) => [r.userId, r]));
    const pipelineMap  = new Map(pipelineResult.recordset.map((r) => [r.userId, r]));
    // progressMap is already a Map<userId, { notesAdded, goalsDocumented, lastNoteDate }>

    const totalWorkingDays = countWorkingDays(dateFrom, dateTo);

    const clinicians = rosterResult.recordset.map((r) => {
      const assess  = assessMap.get(r.Id)     || {};
      const rep     = reportsMap.get(r.Id)    || {};
      const goal    = goalsMap.get(r.Id)      || {};
      const cons    = consistencyMap.get(r.Id) || {};
      const pl      = pipelineMap.get(r.Id)   || {};
      const prog    = progressMap.get(r.Id)   || { notesAdded: 0, goalsDocumented: 0, lastNoteDate: null };
      const coreJobDays        = cons.coreJobDays ?? 0;
      const consistencyPercent = totalWorkingDays > 0
        ? Math.round((coreJobDays / totalWorkingDays) * 100)
        : 0;
      const lastActiveDate = cons.lastActiveDate || null;
      const lastActiveDaysAgo = lastActiveDate
        ? Math.max(0, Math.floor((Date.now() - new Date(lastActiveDate).getTime()) / 86400000))
        : null;

      return {
        id:                r.Id,
        firstName:         r.FirstName,
        lastName:          r.LastName,
        email:             r.Email,
        centreId:          r.centreId,
        centreName:        abbreviateCentre(r.CentreName) || null,
        // ── From shared metrics service (guaranteed consistent with Overview) ──
        scoringComplete:   assess.scored  ?? 0,
        reportPdfCreated:  assess.scored  ?? 0,
        resultsGenerated:  assess.scored  ?? 0,
        reportsDrafted:    rep.drafted    ?? 0,
        reportEdits:       rep.edits      ?? 0,
        goalsAdded:        goal.added      ?? 0,
        goalsAddedItems:   goal.addedItems ?? 0,
        // ── Clinician-specific data ────────────────────────────────────────────
        activeCaseload:    r.activeCaseload    ?? 0,
        totalAuditActions: r.totalAuditActions ?? 0,
        lastActivityDate:  r.lastActivityDate  || null,
        lastLoginDate:     r.LastLoginDateTimeUtc || null,
        // ── Consistency data ──────────────────────────────────────────────────
        consistencyPercent,
        consistencyStatus: consistencyStatus(consistencyPercent),
        coreJobDays,
        totalWorkingDays,
        coreOutput: {
          assessmentsScored: cons.assessmentsScored ?? 0,
          reportsDrafted:    cons.reportsDrafted    ?? 0,
        },
        lastActiveDate,
        lastActiveDaysAgo,
        // ── Pipeline breakdown (point-in-time state counts) ───────────────────
        stuckCases:       pl.stuckCases   ?? 0,
        reportsNotDrafted: pl.reportsToWrite ?? 0,
        goalsNotAdded:    pl.goalsToAdd   ?? 0,
        pipelineBreakdown: {
          scoring:        pl.scoring       ?? 0,
          reportsToWrite: pl.reportsToWrite ?? 0,
          goalsToAdd:     pl.goalsToAdd    ?? 0,
          pendingApproval: pl.pendingApproval ?? 0,
        },
        // ── Goal progress (period-scoped) ─────────────────────────────────────
        progressNotes:    prog.notesAdded      ?? 0,
        goalsDocumented:  prog.goalsDocumented ?? 0,
        lastNoteDate:     prog.lastNoteDate    ?? null,
      };
    });

    res.json(clinicians);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
