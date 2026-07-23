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
    const dateFilterPal        = buildDateFilter('pal.CreatedDateTime',       '@dateFrom', '@dateTo');
    const dateFilterPdfPal     = buildDateFilter('pdf_pal.CreatedDateTime',   '@dateFrom', '@dateTo');
    const dateFilterGoalsAdded = buildDateFilter('pgarg.CreatedDateTimeUtc',  '@dateFrom', '@dateTo');
    const dateFilterGoals      = buildDateFilter('pgarg.UpdatedDateTimeUtc',  '@dateFrom', '@dateTo');

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
        -- COUNT(DISTINCT PatientId) matches source of truth: one patient can have
        -- multiple AllocatePatient rows (e.g. multiple assessments) so counting
        -- ap.Id would inflate the figure relative to unique cases.
        caseload_cte AS (
          SELECT pt.CentreId, COUNT(DISTINCT ap.PatientId) AS caseload
          FROM AllocatePatient ap
          JOIN Patient pt ON pt.Id = ap.PatientId
          JOIN Centre  c  ON c.Id  = pt.CentreId
          WHERE ap.Status IN ('NotStarted', 'InProgress', 'OnHold')
            AND ${centreExcl}
            AND ${patExclPt}
            AND ${centreFilterPt}
          GROUP BY pt.CentreId
        ),
        -- Combined single-pass scan of PatientAuditLog for all date-filtered metrics.
        -- Replaces 5 separate CTEs (drafted, edits, scored, progressNotes, approved)
        -- with one table scan, reducing query cost ~5×.
        pal_metrics_cte AS (
          SELECT
            p.CentreId,
            COUNT(DISTINCT CASE WHEN pal.Type = 'ReportAdded'             AND pal.AllocatePatientId IS NOT NULL THEN pal.AllocatePatientId END) AS reportsDrafted,
            SUM(CASE WHEN pal.Type = 'UpdateReport'              THEN 1 ELSE 0 END) AS reportEdits,
            SUM(CASE WHEN pal.Type = 'AssessmentResultGenerated' THEN 1 ELSE 0 END) AS assessmentsScored,
            SUM(CASE WHEN pal.Type = 'ProgressAdded'             THEN 1 ELSE 0 END) AS progressNotes,
            COUNT(DISTINCT CASE WHEN pal.Type = 'ReportPDFGenerated' AND pal.AllocatePatientId IS NOT NULL THEN pal.AllocatePatientId END) AS reportsApproved
          FROM PatientAuditLog pal WITH (NOLOCK)
          JOIN Patient p WITH (NOLOCK) ON p.Id = pal.PatientId
          JOIN Centre  c WITH (NOLOCK) ON c.Id = p.CentreId
          WHERE pal.Type IN ('ReportAdded', 'UpdateReport', 'AssessmentResultGenerated', 'ProgressAdded', 'ReportPDFGenerated')
            AND ${centreExcl}
            AND ${patExclP}
            AND ${centreFilter}
            AND ${dateFilterPal}
          GROUP BY p.CentreId
        ),
        -- Avg Approval Time: avg days from first ReportAdded to ReportPDFGenerated per centre.
        -- Inner draft_sub bounded to 180 days before @dateFrom to prevent full-table scan.
        avg_approval_cte AS (
          SELECT
            p.CentreId,
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
            AND ${centreExcl}
            AND ${patExclP}
            AND ${centreFilter}
            AND ${dateFilterPdfPal}
          GROUP BY p.CentreId
        ),
        -- Goals Added: distinct assessments + individual item count (by submission date).
        goals_added_cte AS (
          SELECT
            pt.CentreId,
            COUNT(DISTINCT pgar.AllocatePatientId) AS goalsAdded,
            COUNT(*)                               AS goalsAddedItems
          FROM PatientGoalApprovalRequestGoal pgarg WITH (NOLOCK)
          JOIN PatientGoalApprovalRequest pgar WITH (NOLOCK) ON pgar.Id = pgarg.PatientGoalApprovalRequestId
          JOIN AllocatePatient ap              WITH (NOLOCK) ON ap.Id   = pgar.AllocatePatientId
          JOIN Patient pt                      WITH (NOLOCK) ON pt.Id   = ap.PatientId
          JOIN Centre  c                       WITH (NOLOCK) ON c.Id    = pt.CentreId
          WHERE ${centreExcl}
            AND ${patExclPt}
            AND ${centreFilterPt}
            AND ${dateFilterGoalsAdded}
          GROUP BY pt.CentreId
        ),
        -- Goals Approved: distinct assessments + individual item count (by approval date).
        goals_approved_cte AS (
          SELECT
            pt.CentreId,
            COUNT(DISTINCT pgar.AllocatePatientId) AS goalsApproved,
            COUNT(*)                               AS goalsApprovedItems
          FROM PatientGoalApprovalRequestGoal pgarg WITH (NOLOCK)
          JOIN PatientGoalApprovalRequest pgar WITH (NOLOCK) ON pgar.Id = pgarg.PatientGoalApprovalRequestId
          JOIN AllocatePatient ap              WITH (NOLOCK) ON ap.Id   = pgar.AllocatePatientId
          JOIN Patient pt                      WITH (NOLOCK) ON pt.Id   = ap.PatientId
          JOIN Centre  c                       WITH (NOLOCK) ON c.Id    = pt.CentreId
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
          FROM PatientAuditLog pal WITH (NOLOCK)
          JOIN Patient p   WITH (NOLOCK) ON p.Id  = pal.PatientId
          JOIN Centre  c   WITH (NOLOCK) ON c.Id  = p.CentreId
          JOIN AdminUser au              ON au.Id  = pal.AdminUserId
          JOIN AdminUserRole aur         ON aur.UserId = au.Id
          JOIN AdminRole ar              ON ar.Id  = aur.RoleId
            AND ar.Name NOT IN ('Clinician', 'Super Admin')
          WHERE pal.Type = 'ReportPDFGenerated'
            AND pal.AllocatePatientId IS NOT NULL
            AND ${centreExcl}
            AND ${patExclP}
            AND ${centreFilter}
            AND ${dateFilterPal}
          GROUP BY p.CentreId
        ),
        -- Manager Goals Approved: distinct assessments + item count at manager-assigned centres.
        mgr_goals_cte AS (
          SELECT
            pt.CentreId,
            COUNT(DISTINCT pgar.AllocatePatientId) AS managerGoalsApproved,
            COUNT(*)                               AS managerGoalsApprovedItems
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
            AND EXISTS (
              SELECT 1
              FROM AdminUserCentre auc2
              JOIN AdminUserRole aur2  ON aur2.UserId = auc2.AdminUserId
              JOIN AdminRole ar2       ON ar2.Id      = aur2.RoleId
                AND ar2.Name NOT IN ('Clinician', 'Super Admin')
              WHERE auc2.CentreId = pt.CentreId
            )
          GROUP BY pt.CentreId
        ),
        -- Manager Goals Added: distinct assessments + item count at manager-assigned centres.
        mgr_goals_added_cte AS (
          SELECT
            pt.CentreId,
            COUNT(DISTINCT pgar.AllocatePatientId) AS managerGoalsAdded,
            COUNT(*)                               AS managerGoalsAddedItems
          FROM PatientGoalApprovalRequestGoal pgarg
          JOIN PatientGoalApprovalRequest pgar ON pgar.Id = pgarg.PatientGoalApprovalRequestId
          JOIN AllocatePatient ap              ON ap.Id   = pgar.AllocatePatientId
          JOIN Patient pt                      ON pt.Id   = ap.PatientId
          JOIN Centre  c                       ON c.Id    = pt.CentreId
          WHERE ${centreExcl}
            AND ${patExclPt}
            AND ${centreFilterPt}
            AND ${dateFilterGoalsAdded}
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
          ISNULL(cl.caseload,                       0) AS caseload,
          ISNULL(pm.assessmentsScored,              0) AS assessmentsScored,
          ISNULL(pm.reportsDrafted,                 0) AS reportsDrafted,
          ISNULL(pm.reportEdits,                    0) AS reportEdits,
          ISNULL(pm.reportsApproved,                0) AS reportsApproved,
          ISNULL(ga.goalsAdded,                     0) AS goalsAdded,
          ISNULL(ga.goalsAddedItems,                0) AS goalsAddedItems,
          ISNULL(gap.goalsApproved,                 0) AS goalsApproved,
          ISNULL(gap.goalsApprovedItems,            0) AS goalsApprovedItems,
          ISNULL(mr.managerReportsApproved,         0) AS managerReportsApproved,
          ISNULL(mg.managerGoalsApproved,           0) AS managerGoalsApproved,
          ISNULL(mg.managerGoalsApprovedItems,      0) AS managerGoalsApprovedItems,
          ISNULL(mga.managerGoalsAdded,             0) AS managerGoalsAdded,
          ISNULL(mga.managerGoalsAddedItems,        0) AS managerGoalsAddedItems,
          ISNULL(pm.progressNotes,                  0) AS progressNotes,
          aa.avgApprovalDays
        FROM centre_base cb
        LEFT JOIN caseload_cte          cl  ON cl.CentreId  = cb.centreId
        LEFT JOIN pal_metrics_cte       pm  ON pm.CentreId  = cb.centreId
        LEFT JOIN goals_added_cte       ga  ON ga.CentreId  = cb.centreId
        LEFT JOIN goals_approved_cte    gap ON gap.CentreId = cb.centreId
        LEFT JOIN mgr_reports_cte       mr  ON mr.CentreId  = cb.centreId
        LEFT JOIN mgr_goals_cte         mg  ON mg.CentreId  = cb.centreId
        LEFT JOIN mgr_goals_added_cte   mga ON mga.CentreId = cb.centreId
        LEFT JOIN avg_approval_cte      aa  ON aa.CentreId  = cb.centreId
        ORDER BY ISNULL(cl.caseload, 0) DESC, cb.CentreName
      `);

    res.json(result.recordset.map((r) => ({
      centreId:                    r.centreId,
      centreName:                  abbreviateCentre(r.CentreName),
      caseload:                    r.caseload,
      assessmentsScored:           r.assessmentsScored,
      reportsDrafted:              r.reportsDrafted,
      reportEdits:                 r.reportEdits,
      reportsApproved:             r.reportsApproved,
      goalsAdded:                  r.goalsAdded,
      goalsAddedItems:             r.goalsAddedItems,
      goalsApproved:               r.goalsApproved,
      goalsApprovedItems:          r.goalsApprovedItems,
      managerReportsApproved:      r.managerReportsApproved,
      managerGoalsApproved:        r.managerGoalsApproved,
      managerGoalsApprovedItems:   r.managerGoalsApprovedItems,
      managerGoalsAdded:           r.managerGoalsAdded,
      managerGoalsAddedItems:      r.managerGoalsAddedItems,
      progressNotes:               r.progressNotes,
      avgApprovalDays:             r.avgApprovalDays != null ? Math.round(r.avgApprovalDays * 10) / 10 : null,
    })));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
