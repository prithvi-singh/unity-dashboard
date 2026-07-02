'use strict';

const { Router } = require('express');
const { sql, poolPromise } = require('../db');
const { parseDateParam, buildDateFilter, buildCentreExclusion, buildPatientExclusion } = require('../lib/queryHelpers');
const { abbreviateCentre } = require('../lib/formatters');
const { getCoreMetrics } = require('../services/metricsService');
const { EVENT_TYPES, toSqlIn } = require('../utils/metrics');
const { TERMINAL_STATUSES } = require('../utils/assessmentState');
const { getProgressNoteCountsByUser } = require('../utils/goalProgress');
const persistentCache = require('../services/persistentCache');
const { getTodayIncrementalMetrics, getMatchingWindow, isDateRangeCacheable, isTodayIncluded } = require('../services/incrementalService');
const { mergeMetrics } = require('../utils/cacheMerge');

const AP_ACTIVE = TERMINAL_STATUSES.map((s) => `'${s}'`).join(', ');

const router = Router();

// Build the SQL IN-list from canonical constants — never hardcode event names.
const MANAGER_CORE_EVENTS = toSqlIn(
  EVENT_TYPES.REPORT_PDF_GENERATED,
  EVENT_TYPES.GOAL_ADDED,
  EVENT_TYPES.GOAL_UPDATED,
  EVENT_TYPES.ACTIVITY_ADDED,
  EVENT_TYPES.CASE_REGISTERED,
);

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
 * GET /api/managers
 * One row per manager × centre assignment.
 *
 * Shared metrics (cases registered, reports approved, goals approved)
 * come from metricsService and match the numbers shown on Overview.
 * Manager-specific data (totalActions, lastActivityDate) is fetched via
 * a supplementary query.
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
    const centreExclusion    = buildCentreExclusion('c');
    const centreExclusion2   = buildCentreExclusion('c2');
    const dateFilter         = buildDateFilter('pal.CreatedDateTime',     '@dateFrom', '@dateTo');
    const dateFilterPdfPal   = buildDateFilter('pdf_pal.CreatedDateTime', '@dateFrom', '@dateTo');

    // ── Cache-first metrics resolution ──────────────────────────────────────
    let metrics = null;
    const cacheable = isDateRangeCacheable(dateFrom, dateTo);
    const windowLabel = cacheable ? getMatchingWindow(dateFrom) : null;
    const needTodayDelta = dateTo ? isTodayIncluded(dateTo) : true;

    if (windowLabel) {
      try {
        const [cached, todayDelta] = await Promise.all([
          persistentCache.get('metrics', windowLabel),
          needTodayDelta ? getTodayIncrementalMetrics({ centreId }) : Promise.resolve(null),
        ]);
        if (cached && cached.data) {
          metrics = mergeMetrics(cached.data, todayDelta);
          console.log(`[managers] Cache HIT window=${windowLabel} needDelta=${needTodayDelta}`);
        }
      } catch (err) {
        console.warn('[managers] Cache merge failed, falling back to live:', err.message);
      }
    } else {
      console.log(`[managers] Cache SKIPPED — ${dateFrom ? 'no matching window' : 'no dateFrom'}`);
    }

    if (!metrics) {
      console.log('[managers] Cache MISS — running live metrics query');
      metrics = await getCoreMetrics({ dateFrom, dateTo, centreId });
    }

    const [rosterResult, consistencyResult, pendingResult, progressMap, avgApprovalResult] = await Promise.all([

      // Manager-specific: roster, total actions, last activity
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
            ar.Name      AS roleName,
            c.Id         AS centreId,
            c.CentreName,
            SUM(CASE WHEN p.CentreId = c.Id THEN 1 ELSE 0 END) AS totalActions,
            MAX(CASE WHEN p.CentreId = c.Id THEN pal.CreatedDateTime END) AS lastActivityDate
          FROM AdminUser au
          JOIN AdminUserRole aur ON aur.UserId = au.Id
          JOIN AdminRole ar      ON ar.Id = aur.RoleId
            AND ar.Name NOT IN ('Clinician', 'Super Admin', 'SuperAdmin')
          JOIN AdminUserCentre auc ON auc.AdminUserId = au.Id
          JOIN Centre c            ON c.Id = auc.CentreId
          LEFT JOIN PatientAuditLog pal ON pal.AdminUserId = au.Id
            AND ${dateFilter}
          LEFT JOIN Patient p ON p.Id = pal.PatientId
          WHERE au.FirstName NOT LIKE '%(Ops)%'
            AND au.LastName  NOT LIKE '%(Ops)%'
            AND au.Email     NOT LIKE '%(Ops)%'
            AND (@centreId IS NULL OR c.Id = @centreId)
            AND ${centreExclusion}
            AND (p.Id IS NULL OR (${buildPatientExclusion('p')}))
            AND LOWER(au.FirstName) NOT LIKE '%test%'
            AND LOWER(au.LastName)  NOT LIKE '%test%'
            AND LOWER(au.Email)     NOT LIKE '%@webority.com'
          GROUP BY
            au.Id, au.FirstName, au.LastName, au.Email,
            au.LastLoginDateTimeUtc, ar.Name, c.Id, c.CentreName
          ORDER BY ar.Name, au.LastName, au.FirstName, c.CentreName
        `),

      // Per-manager personal output counts (RULE 1: filter by AdminUserId, never join through centres).
      // The AdminUserCentre/Centre join was removed here because it created one row per centre
      // assignment, causing SUM() aggregates to multiply every audit event N times (where N is
      // the number of centres assigned). For Mansi Sharma (120 centres) this produced 234
      // instead of the correct value of 2. An EXISTS subquery is used instead so managers
      // without any valid centre assignment are excluded without row multiplication.
      pool.request()
        .input('centreId', sql.BigInt, centreId)
        .input('dateFrom', sql.DateTimeOffset, dateFrom)
        .input('dateTo',   sql.DateTimeOffset, dateTo)
        .query(`
          SELECT
            au.Id AS userId,
            COUNT(DISTINCT
              CASE WHEN pal.Type IN (${MANAGER_CORE_EVENTS})
              THEN CAST(pal.CreatedDateTime AS DATE) END
            ) AS coreJobDays,
            SUM(CASE WHEN pal.Type = '${EVENT_TYPES.REPORT_PDF_GENERATED}' THEN 1 ELSE 0 END) AS reportsApproved,
            SUM(CASE WHEN pal.Type IN (${toSqlIn(EVENT_TYPES.GOAL_ADDED, EVENT_TYPES.GOAL_UPDATED)}) THEN 1 ELSE 0 END) AS goalsApproved,
            SUM(CASE WHEN pal.Type = '${EVENT_TYPES.ASSESSMENT_RESULT_GENERATED}' THEN 1 ELSE 0 END) AS assessmentsScored,
            SUM(CASE WHEN pal.Type = '${EVENT_TYPES.REPORT_ADDED}' THEN 1 ELSE 0 END) AS reportsDrafted,
            MAX(pal_all.CreatedDateTime) AS lastActiveDate
          FROM AdminUser au
          JOIN AdminUserRole aur ON aur.UserId = au.Id
          JOIN AdminRole ar      ON ar.Id = aur.RoleId
            AND ar.Name NOT IN ('Clinician', 'Super Admin', 'SuperAdmin')
          LEFT JOIN PatientAuditLog pal     ON pal.AdminUserId     = au.Id
            AND ${dateFilter}
          LEFT JOIN PatientAuditLog pal_all ON pal_all.AdminUserId = au.Id
          WHERE au.FirstName NOT LIKE '%(Ops)%'
            AND au.LastName  NOT LIKE '%(Ops)%'
            AND au.Email     NOT LIKE '%(Ops)%'
            AND LOWER(au.FirstName) NOT LIKE '%test%'
            AND LOWER(au.LastName)  NOT LIKE '%test%'
            AND LOWER(au.Email)     NOT LIKE '%@webority.com'
            AND EXISTS (
              SELECT 1 FROM AdminUserCentre auc2
              JOIN Centre c2 ON c2.Id = auc2.CentreId
              WHERE auc2.AdminUserId = au.Id
                AND ${centreExclusion2}
                AND (@centreId IS NULL OR c2.Id = @centreId)
            )
          GROUP BY au.Id
        `),

      // ── Per-manager pending approval counts ────────────────────────────────
      // CTEs pre-compute per-AllocatePatient flags so that we avoid using
      // EXISTS inside an aggregate (SQL Server does not allow that).
      pool.request()
        .input('centreId', sql.BigInt, centreId)
        .query(`
          WITH ApFlags AS (
            SELECT
              ap.Id         AS apId,
              ap.PatientId,
              ap.Status,
              ap.Assessment,
              MAX(CASE WHEN pal2.Type = 'ReportAdded'        THEN 1 ELSE 0 END) AS hasReport,
              MAX(CASE WHEN pal2.Type = 'ReportPDFGenerated' THEN 1 ELSE 0 END) AS hasPdf
            FROM AllocatePatient ap
            LEFT JOIN PatientAuditLog pal2
              ON pal2.AllocatePatientId = ap.Id
             AND pal2.Type IN ('ReportAdded', 'ReportPDFGenerated')
            GROUP BY ap.Id, ap.PatientId, ap.Status, ap.Assessment
          ),
          GoalFlags AS (
            SELECT
              ap.Id AS apId,
              MAX(CASE WHEN pgar.Id IS NOT NULL                THEN 1 ELSE 0 END) AS hasGoal,
              MAX(CASE WHEN pgarg2.Status = 'Approved'         THEN 1 ELSE 0 END) AS hasApproved
            FROM AllocatePatient ap
            LEFT JOIN PatientGoalApprovalRequest pgar
              ON pgar.AllocatePatientId = ap.Id
            LEFT JOIN PatientGoalApprovalRequestGoal pgarg2
              ON pgarg2.PatientGoalApprovalRequestId = pgar.Id
            GROUP BY ap.Id
          )
          SELECT
            au.Id AS userId,
            COUNT(DISTINCT CASE WHEN
              af.Status NOT IN (${AP_ACTIVE})
              AND af.hasReport = 1
              AND af.hasPdf    = 0
            THEN af.apId END) AS reportsToApprove,
            COUNT(DISTINCT CASE WHEN
              af.Status NOT IN (${AP_ACTIVE})
              AND gf.hasGoal    = 1
              AND gf.hasApproved = 0
            THEN af.apId END) AS goalsToApprove
          FROM AdminUser au
          JOIN AdminUserRole aur ON aur.UserId = au.Id
          JOIN AdminRole ar      ON ar.Id = aur.RoleId
            AND ar.Name NOT IN ('Clinician', 'Super Admin', 'SuperAdmin')
          JOIN AdminUserCentre auc ON auc.AdminUserId = au.Id
          JOIN Centre c            ON c.Id = auc.CentreId
          JOIN Patient pt          ON pt.CentreId = c.Id
          JOIN ApFlags af          ON af.PatientId = pt.Id
          LEFT JOIN GoalFlags gf   ON gf.apId = af.apId
          WHERE au.FirstName NOT LIKE '%(Ops)%'
            AND au.LastName  NOT LIKE '%(Ops)%'
            AND au.Email     NOT LIKE '%(Ops)%'
            AND (@centreId IS NULL OR c.Id = @centreId)
            AND LOWER(c.CentreName) NOT LIKE '%test%'
            AND LOWER(c.CentreName) NOT LIKE '%delete%'
            AND pt.FirstName NOT LIKE '%test%' AND pt.LastName NOT LIKE '%test%'
            AND LOWER(au.FirstName) NOT LIKE '%test%'
            AND LOWER(au.LastName)  NOT LIKE '%test%'
            AND LOWER(au.Email)     NOT LIKE '%@webority.com'
            AND af.Assessment IN ('SPM', 'DP3', 'REELS', 'ISAA')
          GROUP BY au.Id
        `),

      // Progress note counts per manager in the selected period
      getProgressNoteCountsByUser(dateFrom, dateTo, centreId),

      // Avg approval time: avg days from first draft to PDF approval, per manager.
      // Role filtering is skipped here — we join to known manager IDs at mapping time via rosterResult.
      // Inner draft_sub is bounded to 180 days before @dateFrom to avoid a full-table scan.
      pool.request()
        .input('centreId', sql.BigInt, centreId)
        .input('dateFrom', sql.DateTimeOffset, dateFrom)
        .input('dateTo',   sql.DateTimeOffset, dateTo)
        .query(`
          SELECT
            pdf_pal.AdminUserId AS userId,
            AVG(CAST(DATEDIFF(day, draft_sub.firstDraftDate, pdf_pal.CreatedDateTime) AS FLOAT)) AS avgApprovalDays
          FROM PatientAuditLog pdf_pal WITH (NOLOCK)
          JOIN (
            SELECT AllocatePatientId, MIN(CreatedDateTime) AS firstDraftDate
            FROM PatientAuditLog WITH (NOLOCK)
            WHERE Type = 'ReportAdded'
              AND AllocatePatientId IS NOT NULL
              AND CreatedDateTime >= DATEADD(day, -180, @dateFrom)
            GROUP BY AllocatePatientId
          ) draft_sub ON draft_sub.AllocatePatientId = pdf_pal.AllocatePatientId
                      AND draft_sub.firstDraftDate <= pdf_pal.CreatedDateTime
          JOIN Patient p WITH (NOLOCK) ON p.Id = pdf_pal.PatientId
          JOIN Centre  c WITH (NOLOCK) ON c.Id = p.CentreId
          WHERE pdf_pal.Type = 'ReportPDFGenerated'
            AND pdf_pal.AllocatePatientId IS NOT NULL
            AND pdf_pal.AdminUserId IS NOT NULL
            AND ${centreExclusion}
            AND ${dateFilterPdfPal}
            AND (${buildPatientExclusion('p')})
            AND (@centreId IS NULL OR c.Id = @centreId)
          GROUP BY pdf_pal.AdminUserId
        `),
    ]);

    // Build lookup maps from shared service per-manager arrays
    const casesByMgr            = new Map(metrics.cases.byManager.map((r) => [r.userId, r.count]));
    const assignmentsByMgr      = new Map((metrics.assessments.byManager || []).map((r) => [r.userId, r.assigned]));
    const reportsByMgr          = new Map(metrics.reports.byManager.map((r) => [r.userId, r.approved]));
    const goalsByMgr            = new Map(metrics.goals.byManager.map((r) => [r.userId, r.approved]));
    const goalsByMgrItems       = new Map(metrics.goals.byManager.map((r) => [r.userId, r.approvedItems ?? 0]));
    const consistencyMap        = new Map(consistencyResult.recordset.map((r) => [r.userId, r]));
    const pendingMap            = new Map(pendingResult.recordset.map((r) => [r.userId, r]));
    const avgApprovalMap        = new Map(avgApprovalResult.recordset.map((r) => [
      r.userId,
      r.avgApprovalDays != null ? Math.round(r.avgApprovalDays * 10) / 10 : null,
    ]));

    const totalWorkingDays = countWorkingDays(dateFrom, dateTo);

    // Deduplicate roster: the SQL query returns one row per manager × centre.
    // Collapse to one entry per manager, accumulating totalActions across all
    // their centres and collecting the full list of centre assignments.
    // We also track per-centre action counts so the primary centre can be
    // chosen as the most-active one rather than the alphabetically-first one.
    const managerRosterMap = new Map();
    for (const r of rosterResult.recordset) {
      const centreEntry = {
        centreId:   r.centreId,
        centreName: abbreviateCentre(r.CentreName) || r.CentreName,
      };
      const centreActions = r.totalActions ?? 0;
      const existing = managerRosterMap.get(r.Id);
      if (existing) {
        existing._centres.push(centreEntry);
        existing._centreActions.push(centreActions);
        existing._totalActions += centreActions;
        if (r.lastActivityDate) {
          const d = new Date(r.lastActivityDate);
          if (!existing._lastActivityDate || d > existing._lastActivityDate) {
            existing._lastActivityDate = d;
          }
        }
      } else {
        managerRosterMap.set(r.Id, {
          _row:              r,
          _centres:          [centreEntry],
          _centreActions:    [centreActions],
          _totalActions:     centreActions,
          _lastActivityDate: r.lastActivityDate ? new Date(r.lastActivityDate) : null,
        });
      }
    }

    const managers = [...managerRosterMap.values()].map(({ _row: r, _centres, _centreActions, _totalActions, _lastActivityDate }) => {
      const cons    = consistencyMap.get(r.Id) || {};
      const pend    = pendingMap.get(r.Id)     || {};
      const prog    = progressMap.get(r.Id)    || { notesAdded: 0, goalsDocumented: 0, lastNoteDate: null };
      const coreJobDays        = cons.coreJobDays ?? 0;
      const consistencyPercent = totalWorkingDays > 0
        ? Math.round((coreJobDays / totalWorkingDays) * 100)
        : 0;
      const lastActiveDate = cons.lastActiveDate || null;
      const lastActiveDaysAgo = lastActiveDate
        ? Math.max(0, Math.floor((Date.now() - new Date(lastActiveDate).getTime()) / 86400000))
        : null;

      // Primary centre: the centre where this manager has the most actual patient activity
      // (totalActions = audit events for patients AT that centre). This avoids attributing
      // a manager's cases to an empty centre like MB LAKSHAYA that happens to sort first
      // alphabetically but has zero patients. Falls back to index 0 if no activity anywhere.
      let primaryIdx = 0;
      for (let i = 1; i < _centreActions.length; i++) {
        if (_centreActions[i] > _centreActions[primaryIdx]) primaryIdx = i;
      }
      const primary = _centres[primaryIdx] || {};

      return {
        id:               r.Id,
        firstName:        r.FirstName,
        lastName:         r.LastName,
        email:            r.Email,
        roleName:         r.roleName || null,
        // All centre assignments for this manager
        centres:          _centres,
        centreCount:      _centres.length,
        // Primary centre (first) — kept for backward compatibility
        centreId:         primary.centreId   ?? null,
        centreName:       primary.centreName ?? null,
        // ── From shared metrics service ─────────────────────────────────────────
        casesRegistered:      casesByMgr.get(r.Id)         ?? 0,
        assessmentsAssigned:  assignmentsByMgr.get(r.Id)  ?? 0,
        reportsApproved:      reportsByMgr.get(r.Id)      ?? 0,
        goalsApproved:        goalsByMgr.get(r.Id)        ?? 0,
        goalsApprovedItems:   goalsByMgrItems.get(r.Id)   ?? 0,
        // ── Manager-specific data ────────────────────────────────────────────────
        totalActions:        _totalActions,
        lastActivityDate:    _lastActivityDate ? _lastActivityDate.toISOString() : null,
        lastLoginDate:       r.LastLoginDateTimeUtc || null,
        // ── Consistency data ──────────────────────────────────────────────────
        consistencyPercent,
        consistencyStatus: consistencyStatus(consistencyPercent),
        coreJobDays,
        totalWorkingDays,
        coreOutput: {
          reportsApproved: cons.reportsApproved ?? 0,
          goalsApproved:   cons.goalsApproved   ?? 0,
        },
        lastActiveDate,
        lastActiveDaysAgo,
        // ── Pending approval counts (point-in-time) ───────────────────────────
        reportsToApprove: pend.reportsToApprove ?? 0,
        goalsToApprove:   pend.goalsToApprove   ?? 0,
        pendingApprovals: (pend.reportsToApprove ?? 0) + (pend.goalsToApprove ?? 0),
        // ── Clinician-like output (when manager personally scores/drafts) ─────
        assessmentsScored: cons.assessmentsScored  ?? 0,
        reportsDrafted:    cons.reportsDrafted     ?? 0,
        // ── Approval efficiency ───────────────────────────────────────────────
        avgApprovalDays:   avgApprovalMap.get(r.Id) ?? null,
        // ── Goal progress (period-scoped) ─────────────────────────────────────
        progressNotes:    prog.notesAdded      ?? 0,
        goalsDocumented:  prog.goalsDocumented ?? 0,
        lastNoteDate:     prog.lastNoteDate    ?? null,
      };
    });

    res.json(managers);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
