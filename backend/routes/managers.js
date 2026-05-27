'use strict';

const { Router } = require('express');
const { sql, poolPromise } = require('../db');
const { parseDateParam, buildDateFilter, buildCentreExclusion, buildPatientExclusion } = require('../lib/queryHelpers');
const { abbreviateCentre } = require('../lib/formatters');
const { getCoreMetrics } = require('../services/metricsService');
const { EVENT_TYPES, toSqlIn } = require('../utils/metrics');
const { TERMINAL_STATUSES } = require('../utils/assessmentState');

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
    const centreExclusion = buildCentreExclusion('c');
    const dateFilter      = buildDateFilter('pal.CreatedDateTime', '@dateFrom', '@dateTo');

    const [metrics, rosterResult, consistencyResult, pendingResult] = await Promise.all([
      getCoreMetrics({ dateFrom, dateTo, centreId }),

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

      // Per-manager core-job day counts
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
            MAX(pal.CreatedDateTime) AS lastActiveDate
          FROM AdminUser au
          JOIN AdminUserRole aur ON aur.UserId = au.Id
          JOIN AdminRole ar      ON ar.Id = aur.RoleId
            AND ar.Name NOT IN ('Clinician', 'Super Admin', 'SuperAdmin')
          JOIN AdminUserCentre auc ON auc.AdminUserId = au.Id
          JOIN Centre c            ON c.Id = auc.CentreId
          LEFT JOIN PatientAuditLog pal ON pal.AdminUserId = au.Id
            AND ${dateFilter}
          WHERE au.FirstName NOT LIKE '%(Ops)%'
            AND au.LastName  NOT LIKE '%(Ops)%'
            AND au.Email     NOT LIKE '%(Ops)%'
            AND (@centreId IS NULL OR c.Id = @centreId)
            AND ${centreExclusion}
            AND LOWER(au.FirstName) NOT LIKE '%test%'
            AND LOWER(au.LastName)  NOT LIKE '%test%'
            AND LOWER(au.Email)     NOT LIKE '%@webority.com'
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
    ]);

    // Build lookup maps from shared service per-manager arrays
    const casesByMgr   = new Map(metrics.cases.byManager.map((r) => [r.userId, r.count]));
    const reportsByMgr = new Map(metrics.reports.byManager.map((r) => [r.userId, r.approved]));
    const goalsByMgr   = new Map(metrics.goals.byManager.map((r) => [r.userId, r.approved]));
    const consistencyMap = new Map(consistencyResult.recordset.map((r) => [r.userId, r]));
    const pendingMap   = new Map(pendingResult.recordset.map((r) => [r.userId, r]));

    const totalWorkingDays = countWorkingDays(dateFrom, dateTo);

    const managers = rosterResult.recordset.map((r) => {
      const cons    = consistencyMap.get(r.Id) || {};
      const pend    = pendingMap.get(r.Id)     || {};
      const coreJobDays        = cons.coreJobDays ?? 0;
      const consistencyPercent = totalWorkingDays > 0
        ? Math.round((coreJobDays / totalWorkingDays) * 100)
        : 0;
      const lastActiveDate = cons.lastActiveDate || null;
      const lastActiveDaysAgo = lastActiveDate
        ? Math.max(0, Math.floor((Date.now() - new Date(lastActiveDate).getTime()) / 86400000))
        : null;

      return {
        id:               r.Id,
        firstName:        r.FirstName,
        lastName:         r.LastName,
        email:            r.Email,
        roleName:         r.roleName || null,
        centreId:         r.centreId,
        centreName:       abbreviateCentre(r.CentreName) || null,
        // ── From shared metrics service ─────────────────────────────────────────
        casesRegistered:    casesByMgr.get(r.Id)   ?? 0,
        reportsApproved:    reportsByMgr.get(r.Id) ?? 0,
        goalsApproved:      goalsByMgr.get(r.Id)   ?? 0,
        // ── Manager-specific data ────────────────────────────────────────────────
        totalActions:       r.totalActions       ?? 0,
        lastActivityDate:   r.lastActivityDate   || null,
        lastLoginDate:      r.LastLoginDateTimeUtc || null,
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
      };
    });

    res.json(managers);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
