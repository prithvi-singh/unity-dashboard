'use strict';

const { Router } = require('express');
const { sql, poolPromise } = require('../db');
const { parseDateParam, buildDateFilter, buildCentreExclusion, buildPatientExclusion } = require('../lib/queryHelpers');
const { abbreviateCentre } = require('../lib/formatters');

const router = Router();

/**
 * GET /api/workload
 * Query params: centreId (optional), dateFrom (optional), dateTo (optional)
 *
 * Returns per-centre workload metrics for ALL centres (no limit).
 * Sorted by caseload descending.
 *
 * Metrics:
 *   caseload        — active non-closed AllocatePatient records (live snapshot, not date-filtered)
 *   reportsDrafted  — ReportAdded events only (NOT UpdateReport)
 *   reportEdits     — UpdateReport events (informational; shows potential padding)
 *   reportsApproved — ReportPDFGenerated events (distinct AllocatePatientId)
 *   goalsAdded      — GoalAdded events
 *   goalsApproved           — PatientGoalApprovalRequestGoal rows WHERE Status = 'Approved'
 *   managerReportsApproved  — ReportPDFGenerated events actioned by manager-role users (not Clinician/Super Admin)
 *   managerGoalsApproved    — Approved goals at centres that have a manager-role user assigned
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

    const centreFilter    = '(@centreId IS NULL OR c.Id = @centreId)';
    const centreFilterPt  = '(@centreId IS NULL OR c.Id = @centreId)';
    const centreExcl      = buildCentreExclusion('c');
    const patExclP        = buildPatientExclusion('p');
    const patExclPt       = buildPatientExclusion('pt');
    const dateFilterPal   = buildDateFilter('pal.CreatedDateTime', '@dateFrom', '@dateTo');
    const dateFilterGoals = buildDateFilter('pgarg.UpdatedDateTimeUtc', '@dateFrom', '@dateTo');

    const result = await pool.request()
      .input('centreId', sql.BigInt, centreId)
      .input('dateFrom', sql.DateTimeOffset, dateFrom)
      .input('dateTo',   sql.DateTimeOffset, dateTo)
      .query(`
        WITH centre_base AS (
          SELECT c.Id AS centreId, c.CentreName
          FROM Centre c
          WHERE ${centreExcl}
            AND ${centreFilter}
        ),
        -- Active (non-closed) caseload — live snapshot, not date-filtered
        caseload_cte AS (
          SELECT pt.CentreId, COUNT(ap.Id) AS caseload
          FROM AllocatePatient ap
          JOIN Patient pt ON pt.Id = ap.PatientId
          JOIN Centre  c  ON c.Id  = pt.CentreId
          WHERE ap.Status IN ('NotStarted', 'InProgress', 'OnHold')
            AND ${centreExcl}
            AND ${patExclPt}
            AND ${centreFilterPt}
          GROUP BY pt.CentreId
        ),
        -- Reports Drafted: ReportAdded events only (UpdateReport intentionally excluded)
        drafted_cte AS (
          SELECT p.CentreId, COUNT(*) AS reportsDrafted
          FROM PatientAuditLog pal
          JOIN Patient p ON p.Id = pal.PatientId
          JOIN Centre  c ON c.Id = p.CentreId
          WHERE pal.Type = 'ReportAdded'
            AND ${centreExcl}
            AND ${patExclP}
            AND ${centreFilter}
            AND ${dateFilterPal}
          GROUP BY p.CentreId
        ),
        -- Report Edits: UpdateReport events (informational — flags potential padding)
        edits_cte AS (
          SELECT p.CentreId, COUNT(*) AS reportEdits
          FROM PatientAuditLog pal
          JOIN Patient p ON p.Id = pal.PatientId
          JOIN Centre  c ON c.Id = p.CentreId
          WHERE pal.Type = 'UpdateReport'
            AND ${centreExcl}
            AND ${patExclP}
            AND ${centreFilter}
            AND ${dateFilterPal}
          GROUP BY p.CentreId
        ),
        -- Reports Approved: distinct ReportPDFGenerated events per assessment
        approved_cte AS (
          SELECT p.CentreId, COUNT(DISTINCT pal.AllocatePatientId) AS reportsApproved
          FROM PatientAuditLog pal
          JOIN Patient p ON p.Id = pal.PatientId
          JOIN Centre  c ON c.Id = p.CentreId
          WHERE pal.Type = 'ReportPDFGenerated'
            AND pal.AllocatePatientId IS NOT NULL
            AND ${centreExcl}
            AND ${patExclP}
            AND ${centreFilter}
            AND ${dateFilterPal}
          GROUP BY p.CentreId
        ),
        -- Goals Added: GoalAdded events
        goals_added_cte AS (
          SELECT p.CentreId, COUNT(*) AS goalsAdded
          FROM PatientAuditLog pal
          JOIN Patient p ON p.Id = pal.PatientId
          JOIN Centre  c ON c.Id = p.CentreId
          WHERE pal.Type = 'GoalAdded'
            AND ${centreExcl}
            AND ${patExclP}
            AND ${centreFilter}
            AND ${dateFilterPal}
          GROUP BY p.CentreId
        ),
        -- Goals Approved: PatientGoalApprovalRequestGoal rows approved in the period
        goals_approved_cte AS (
          SELECT pt.CentreId, COUNT(*) AS goalsApproved
          FROM PatientGoalApprovalRequestGoal pgarg
          JOIN PatientGoalApprovalRequest pgar ON pgar.Id = pgarg.PatientGoalApprovalRequestId
          JOIN AllocatePatient ap              ON ap.Id   = pgar.AllocatePatientId
          JOIN Patient pt                      ON pt.Id   = ap.PatientId
          JOIN Centre  c                       ON c.Id    = pt.CentreId
          WHERE pgarg.Status = 'Approved'
            AND ${centreExcl}
            AND ${patExclPt}
            AND ${centreFilterPt}
            AND ${dateFilterGoals}
          GROUP BY pt.CentreId
        ),
        -- Manager Reports Approved: ReportPDFGenerated events actioned by manager-role users
        -- (excludes Clinician and Super Admin roles)
        mgr_reports_cte AS (
          SELECT p.CentreId, COUNT(DISTINCT pal.AllocatePatientId) AS managerReportsApproved
          FROM PatientAuditLog pal
          JOIN Patient p   ON p.Id  = pal.PatientId
          JOIN Centre  c   ON c.Id  = p.CentreId
          JOIN AdminUser au        ON au.Id  = pal.AdminUserId
          JOIN AdminUserRole aur   ON aur.UserId = au.Id
          JOIN AdminRole ar        ON ar.Id  = aur.RoleId
            AND ar.Name NOT IN ('Clinician', 'Super Admin')
          WHERE pal.Type = 'ReportPDFGenerated'
            AND pal.AllocatePatientId IS NOT NULL
            AND ${centreExcl}
            AND ${patExclP}
            AND ${centreFilter}
            AND ${dateFilterPal}
          GROUP BY p.CentreId
        ),
        -- Manager Goals Approved: goal approvals at centres assigned to manager-role users.
        -- PatientGoalApprovalRequestGoal does not store the approver UserId directly;
        -- all Status='Approved' rows are managerial actions by workflow design.
        mgr_goals_cte AS (
          SELECT pt.CentreId, COUNT(*) AS managerGoalsApproved
          FROM PatientGoalApprovalRequestGoal pgarg
          JOIN PatientGoalApprovalRequest pgar ON pgar.Id = pgarg.PatientGoalApprovalRequestId
          JOIN AllocatePatient ap              ON ap.Id   = pgar.AllocatePatientId
          JOIN Patient pt                      ON pt.Id   = ap.PatientId
          JOIN Centre  c                       ON c.Id    = pt.CentreId
          WHERE pgarg.Status = 'Approved'
            AND ${centreExcl}
            AND ${patExclPt}
            AND ${centreFilterPt}
            AND ${dateFilterGoals}
            -- Confirm at least one manager-role user is assigned to this centre
            AND EXISTS (
              SELECT 1
              FROM AdminUserCentre auc2
              JOIN AdminUserRole aur2  ON aur2.UserId = auc2.AdminUserId
              JOIN AdminRole ar2       ON ar2.Id      = aur2.RoleId
                AND ar2.Name NOT IN ('Clinician', 'Super Admin')
              WHERE auc2.CentreId = pt.CentreId
            )
          GROUP BY pt.CentreId
        )
        SELECT
          cb.centreId,
          cb.CentreName,
          ISNULL(cl.caseload,                  0) AS caseload,
          ISNULL(d.reportsDrafted,             0) AS reportsDrafted,
          ISNULL(e.reportEdits,                0) AS reportEdits,
          ISNULL(a.reportsApproved,            0) AS reportsApproved,
          ISNULL(ga.goalsAdded,               0) AS goalsAdded,
          ISNULL(gap.goalsApproved,            0) AS goalsApproved,
          ISNULL(mr.managerReportsApproved,    0) AS managerReportsApproved,
          ISNULL(mg.managerGoalsApproved,      0) AS managerGoalsApproved
        FROM centre_base cb
        LEFT JOIN caseload_cte       cl  ON cl.CentreId  = cb.centreId
        LEFT JOIN drafted_cte        d   ON d.CentreId   = cb.centreId
        LEFT JOIN edits_cte          e   ON e.CentreId   = cb.centreId
        LEFT JOIN approved_cte       a   ON a.CentreId   = cb.centreId
        LEFT JOIN goals_added_cte    ga  ON ga.CentreId  = cb.centreId
        LEFT JOIN goals_approved_cte gap ON gap.CentreId = cb.centreId
        LEFT JOIN mgr_reports_cte    mr  ON mr.CentreId  = cb.centreId
        LEFT JOIN mgr_goals_cte      mg  ON mg.CentreId  = cb.centreId
        ORDER BY ISNULL(cl.caseload, 0) DESC, cb.CentreName
      `);

    res.json(result.recordset.map((r) => ({
      centreId:                r.centreId,
      centreName:              abbreviateCentre(r.CentreName),
      caseload:                r.caseload,
      reportsDrafted:          r.reportsDrafted,
      reportEdits:             r.reportEdits,
      reportsApproved:         r.reportsApproved,
      goalsAdded:              r.goalsAdded,
      goalsApproved:           r.goalsApproved,
      managerReportsApproved:  r.managerReportsApproved,
      managerGoalsApproved:    r.managerGoalsApproved,
    })));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
