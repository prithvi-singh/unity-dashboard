'use strict';

const { Router } = require('express');
const { sql, poolPromise } = require('../db');
const { parseDateParam, buildDateFilter, buildCentreExclusion, buildPatientExclusion } = require('../lib/queryHelpers');
const { abbreviateCentre } = require('../lib/formatters');
const { FILTERS } = require('../utils/metrics');
const { getCoreMetrics } = require('../services/metricsService');
const { TERMINAL_STATUSES } = require('../utils/assessmentState');

const AP_ACTIVE_CENTRES = TERMINAL_STATUSES.map((s) => `'${s}'`).join(', ');

const router = Router();

// ── Shared helpers ────────────────────────────────────────────────────────────

function bindStd(req, { centreId, dateFrom, dateTo }) {
  return req
    .input('centreId',      sql.BigInt,        centreId)
    .input('dateFrom',      sql.DateTimeOffset, dateFrom)
    .input('dateTo',        sql.DateTimeOffset, dateTo);
}

/** Round a floating-point average to 1 decimal, or return null. */
function roundDays(val) {
  if (val == null) return null;
  return Math.round(val * 10) / 10;
}

/**
 * Determine status and status reasons for a centre.
 * Uses pipeline state counts instead of completion rate.
 * Priority: blocked > needs-attention > on-track
 */
function calcStatus(centre) {
  const { stuckUnassigned, pipeline } = centre;
  const activeThisPeriod = centre.staff.activeThisPeriod;

  const stuckScoring21d    = pipeline.stuckScoring21d    ?? 0;
  const stuckScoring14d    = pipeline.stuckScoring14d    ?? 0;
  const pendingApproval7d  = pipeline.pendingApproval7d  ?? 0;
  const pendingApproval5d  = pipeline.pendingApproval5d  ?? 0;
  const goalsNotAdded14d   = pipeline.goalsNotAdded14d   ?? 0;
  const goalsNotAdded7d    = pipeline.goalsNotAdded7d    ?? 0;

  const reasons = [];

  // ── Blocked ───────────────────────────────────────────────────────────────
  if (activeThisPeriod === 0 && centre.staff.total > 0) {
    reasons.push('No staff active in this period');
  }
  if (stuckScoring21d > 3) {
    reasons.push(`${stuckScoring21d} assessment${stuckScoring21d > 1 ? 's' : ''} stuck in scoring for 21+ days`);
  }
  if (pendingApproval7d > 3) {
    reasons.push(`${pendingApproval7d} report${pendingApproval7d > 1 ? 's' : ''} waiting for manager approval`);
  }
  if (goalsNotAdded14d > 3) {
    reasons.push(`${goalsNotAdded14d} case${goalsNotAdded14d > 1 ? 's' : ''} with no goals after report approval`);
  }

  if (
    (activeThisPeriod === 0 && centre.staff.total > 0) ||
    stuckScoring21d > 3 ||
    pendingApproval7d > 3 ||
    goalsNotAdded14d > 3
  ) {
    return { status: 'blocked', statusReasons: reasons };
  }

  // ── Needs Attention ───────────────────────────────────────────────────────
  const naReasons = [];
  if (stuckScoring14d >= 1 && stuckScoring14d <= 3) {
    naReasons.push(`${stuckScoring14d} assessment${stuckScoring14d > 1 ? 's' : ''} stuck in scoring for 14+ days`);
  }
  if (pendingApproval5d >= 1 && pendingApproval5d <= 3) {
    naReasons.push(`${pendingApproval5d} report${pendingApproval5d > 1 ? 's' : ''} awaiting manager approval`);
  }
  if (goalsNotAdded7d >= 1 && goalsNotAdded7d <= 3) {
    naReasons.push(`${goalsNotAdded7d} case${goalsNotAdded7d > 1 ? 's' : ''} with no goals after report approval`);
  }
  if (stuckUnassigned >= 1 && stuckUnassigned <= 3) {
    naReasons.push(`${stuckUnassigned} case${stuckUnassigned > 1 ? 's' : ''} stuck unassigned`);
  }

  if (naReasons.length > 0) {
    return { status: 'needs-attention', statusReasons: naReasons };
  }

  return { status: 'on-track', statusReasons: [] };
}

// ── GET /api/centres/overview ─────────────────────────────────────────────────

router.get('/overview', async (req, res, next) => {
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

    const centreExcl     = buildCentreExclusion('c');
    const patExclP       = buildPatientExclusion('p');
    const patExclPt      = buildPatientExclusion('pt');
    const dateFilterPal  = buildDateFilter('pal.CreatedDateTime', '@dateFrom', '@dateTo');
        const dateFilterGoals      = buildDateFilter('pgarg.UpdatedDateTimeUtc', '@dateFrom', '@dateTo');
        const dateFilterGoalsAdded = buildDateFilter('pgarg.CreatedDateTimeUtc', '@dateFrom', '@dateTo');
    const userExclStrict = FILTERS.userExclusionStrict('au');
    const superAdminExcl = FILTERS.superAdminExclusion('ar');

    // Run the big per-centre query in parallel with metricsService so we get
    // the canonical period-based idle/active centre counts from the single source
    // of truth (Q15 in metricsService) instead of recomputing them here.
    const [metrics, result, pipelineResult] = await Promise.all([
      getCoreMetrics({ dateFrom, dateTo, centreId }),
      bindStd(pool.request(), { centreId, dateFrom, dateTo })
      .query(`
        WITH centre_base AS (
          SELECT c.Id AS centreId, c.CentreName
          FROM Centre c
          WHERE ${centreExcl}
            AND (@centreId IS NULL OR c.Id = @centreId)
        ),

        -- ── Active caseload (live snapshot) ─────────────────────────────────
        caseload_cte AS (
          SELECT pt.CentreId, COUNT(ap.Id) AS activeCaseload
          FROM AllocatePatient ap
          JOIN Patient pt ON pt.Id = ap.PatientId
          JOIN Centre c   ON c.Id  = pt.CentreId
          WHERE ap.Status IN ('NotStarted', 'InProgress', 'OnHold')
            AND ${buildCentreExclusion('c')}
            AND ${patExclPt}
          GROUP BY pt.CentreId
        ),

        -- ── Assessments scored in period ─────────────────────────────────────
        scored_cte AS (
          SELECT p.CentreId, COUNT(DISTINCT pal.AllocatePatientId) AS assessmentsScored
          FROM PatientAuditLog pal
          JOIN Patient p ON p.Id = pal.PatientId
          JOIN Centre c  ON c.Id = p.CentreId
          WHERE pal.Type = 'AssessmentResultGenerated'
            AND pal.AllocatePatientId IS NOT NULL
            AND ${centreExcl}
            AND ${patExclP}
            AND ${dateFilterPal}
          GROUP BY p.CentreId
        ),

        -- ── Cases registered in period ───────────────────────────────────────
        registered_cte AS (
          SELECT p.CentreId, COUNT(DISTINCT pal.PatientId) AS casesRegistered
          FROM PatientAuditLog pal
          JOIN Patient p ON p.Id = pal.PatientId
          JOIN Centre c  ON c.Id = p.CentreId
          WHERE pal.Type = 'CaseRegistered'
            AND ${centreExcl}
            AND ${patExclP}
            AND ${dateFilterPal}
          GROUP BY p.CentreId
        ),

        -- ── Average days from registration to first assignment ───────────────
        assign_time_cte AS (
          SELECT p.CentreId,
            AVG(CAST(DATEDIFF(hour, reg.registeredAt, asgn.assignedAt) AS FLOAT) / 24.0) AS avgDaysToAssign
          FROM (
            SELECT pal.PatientId, MIN(pal.CreatedDateTime) AS registeredAt
            FROM PatientAuditLog pal
            WHERE pal.Type = 'CaseRegistered'
              AND ${dateFilterPal}
            GROUP BY pal.PatientId
          ) reg
          JOIN (
            SELECT pal2.PatientId, MIN(pal2.CreatedDateTime) AS assignedAt
            FROM PatientAuditLog pal2
            WHERE pal2.Type = 'CaseAssigned'
            GROUP BY pal2.PatientId
          ) asgn ON asgn.PatientId = reg.PatientId AND asgn.assignedAt >= reg.registeredAt
          JOIN Patient p ON p.Id = reg.PatientId
          JOIN Centre c  ON c.Id = p.CentreId
          WHERE ${centreExcl}
            AND ${patExclP}
            AND (@centreId IS NULL OR c.Id = @centreId)
          GROUP BY p.CentreId
        ),

        -- ── Cases stuck unassigned: registered in selected period, never assigned ever ─
        stuck_cte AS (
          SELECT p.CentreId, COUNT(DISTINCT reg.PatientId) AS stuckUnassigned
          FROM (
            SELECT pal.PatientId, MIN(pal.CreatedDateTime) AS registeredAt
            FROM PatientAuditLog pal
            WHERE pal.Type = 'CaseRegistered'
              AND ${dateFilterPal}
            GROUP BY pal.PatientId
          ) reg
          JOIN Patient p ON p.Id = reg.PatientId
          JOIN Centre c  ON c.Id = p.CentreId
          WHERE ${centreExcl}
            AND ${patExclP}
            AND (@centreId IS NULL OR c.Id = @centreId)
            AND reg.registeredAt < DATEADD(hour, -48, SYSDATETIMEOFFSET())
            AND NOT EXISTS (
              SELECT 1 FROM PatientAuditLog pal2
              WHERE pal2.PatientId = reg.PatientId
                AND pal2.Type = 'CaseAssigned'
            )
          GROUP BY p.CentreId
        ),

        -- ── Cases assigned in period ─────────────────────────────────────────
        assigned_cte AS (
          SELECT p.CentreId, COUNT(DISTINCT pal.PatientId) AS casesAssigned
          FROM PatientAuditLog pal
          JOIN Patient p ON p.Id = pal.PatientId
          JOIN Centre c  ON c.Id = p.CentreId
          WHERE pal.Type = 'CaseAssigned'
            AND ${centreExcl}
            AND ${patExclP}
            AND ${dateFilterPal}
          GROUP BY p.CentreId
        ),

        -- ── Reports drafted and approved ─────────────────────────────────────
        output_cte AS (
          SELECT
            p.CentreId,
            SUM(CASE WHEN pal.Type = 'ReportAdded' THEN 1 ELSE 0 END)          AS reportsDrafted,
            COUNT(DISTINCT CASE WHEN pal.Type = 'ReportPDFGenerated'
                                     AND pal.AllocatePatientId IS NOT NULL
                                THEN pal.AllocatePatientId END)                  AS reportsApproved
          FROM PatientAuditLog pal
          JOIN Patient p ON p.Id = pal.PatientId
          JOIN Centre c  ON c.Id = p.CentreId
          WHERE pal.Type IN ('ReportAdded', 'ReportPDFGenerated')
            AND ${centreExcl}
            AND ${patExclP}
            AND ${dateFilterPal}
          GROUP BY p.CentreId
        ),

        -- ── Goals Added: distinct assessments + individual item count ─────────
        goals_added_cte AS (
          SELECT
            pt.CentreId,
            COUNT(DISTINCT pgar.AllocatePatientId) AS goalsAdded,
            COUNT(*)                               AS goalsAddedItems
          FROM PatientGoalApprovalRequestGoal pgarg
          JOIN PatientGoalApprovalRequest pgar ON pgar.Id = pgarg.PatientGoalApprovalRequestId
          JOIN AllocatePatient ap              ON ap.Id   = pgar.AllocatePatientId
          JOIN Patient pt                      ON pt.Id   = ap.PatientId
          JOIN Centre c                        ON c.Id    = pt.CentreId
          WHERE ${buildCentreExclusion('c')}
            AND ${patExclPt}
            AND (@centreId IS NULL OR c.Id = @centreId)
            AND ${dateFilterGoalsAdded}
          GROUP BY pt.CentreId
        ),

        -- ── Goals Approved: distinct assessments + individual item count ──────
        goals_approved_cte AS (
          SELECT
            pt.CentreId,
            COUNT(DISTINCT pgar.AllocatePatientId) AS goalsApproved,
            COUNT(*)                               AS goalsApprovedItems
          FROM PatientGoalApprovalRequestGoal pgarg
          JOIN PatientGoalApprovalRequest pgar ON pgar.Id = pgarg.PatientGoalApprovalRequestId
          JOIN AllocatePatient ap              ON ap.Id   = pgar.AllocatePatientId
          JOIN Patient pt                      ON pt.Id   = ap.PatientId
          JOIN Centre c                        ON c.Id    = pt.CentreId
          WHERE pgarg.Status = 'Approved'
            AND ${buildCentreExclusion('c')}
            AND ${patExclPt}
            AND (@centreId IS NULL OR c.Id = @centreId)
            AND ${dateFilterGoals}
          GROUP BY pt.CentreId
        ),

        -- ── Avg days from ReportAdded to ReportPDFGenerated (per patient) ────
        report_approval_time_cte AS (
          SELECT p.CentreId,
            AVG(CAST(DATEDIFF(hour, ra.addedAt, pdf.pdfAt) AS FLOAT) / 24.0) AS avgDaysToApproveReport
          FROM (
            SELECT pal.PatientId, MIN(pal.CreatedDateTime) AS addedAt
            FROM PatientAuditLog pal
            WHERE pal.Type = 'ReportAdded'
              AND ${dateFilterPal}
            GROUP BY pal.PatientId
          ) ra
          JOIN (
            SELECT pal2.PatientId, MIN(pal2.CreatedDateTime) AS pdfAt
            FROM PatientAuditLog pal2
            WHERE pal2.Type = 'ReportPDFGenerated'
            GROUP BY pal2.PatientId
          ) pdf ON pdf.PatientId = ra.PatientId AND pdf.pdfAt >= ra.addedAt
          JOIN Patient p ON p.Id = ra.PatientId
          JOIN Centre c  ON c.Id = p.CentreId
          WHERE ${centreExcl}
            AND ${patExclP}
            AND (@centreId IS NULL OR c.Id = @centreId)
          GROUP BY p.CentreId
        ),

        -- ── Avg days from goal submission to goal approval ───────────────────
        goal_approval_time_cte AS (
          SELECT pt.CentreId,
            AVG(
              CAST(DATEDIFF(hour, pgar.CreatedDateTimeUtc, pgarg.UpdatedDateTimeUtc) AS FLOAT) / 24.0
            ) AS avgDaysToApproveGoal
          FROM PatientGoalApprovalRequestGoal pgarg
          JOIN PatientGoalApprovalRequest pgar ON pgar.Id = pgarg.PatientGoalApprovalRequestId
          JOIN AllocatePatient ap              ON ap.Id   = pgar.AllocatePatientId
          JOIN Patient pt                      ON pt.Id   = ap.PatientId
          JOIN Centre c                        ON c.Id    = pt.CentreId
          WHERE pgarg.Status = 'Approved'
            AND pgarg.UpdatedDateTimeUtc > pgar.CreatedDateTimeUtc
            AND ${buildCentreExclusion('c')}
            AND ${patExclPt}
            AND (@centreId IS NULL OR c.Id = @centreId)
            AND ${dateFilterGoals}
          GROUP BY pt.CentreId
        ),

        -- ── Staff roster counts ──────────────────────────────────────────────
        staff_cte AS (
          SELECT
            auc.CentreId,
            COUNT(DISTINCT au.Id) AS totalStaff,
            COUNT(DISTINCT CASE WHEN ar.Name = 'Clinician' THEN au.Id END) AS clinicians,
            COUNT(DISTINCT CASE WHEN ar.Name NOT IN ('Clinician','SuperAdmin','Super Admin')
                                     AND au.FirstName NOT LIKE '%(Ops)%'
                                     AND au.LastName  NOT LIKE '%(Ops)%'
                                     AND au.Email     NOT LIKE '%(Ops)%'
                                THEN au.Id END) AS managers,
            COUNT(DISTINCT CASE WHEN au.FirstName LIKE '%(Ops)%'
                                      OR au.LastName  LIKE '%(Ops)%'
                                      OR au.Email     LIKE '%(Ops)%'
                                THEN au.Id END) AS ops
          FROM AdminUserCentre auc
          JOIN AdminUser au     ON au.Id  = auc.AdminUserId
          JOIN AdminUserRole aur ON aur.UserId = au.Id
          JOIN AdminRole ar      ON ar.Id  = aur.RoleId
          JOIN Centre c          ON c.Id   = auc.CentreId
          WHERE ${superAdminExcl}
            AND ${centreExcl}
            AND ${userExclStrict}
            AND (@centreId IS NULL OR c.Id = @centreId)
          GROUP BY auc.CentreId
        ),

        -- ── Staff active in selected period ──────────────────────────────────
        staff_active_cte AS (
          SELECT auc.CentreId, COUNT(DISTINCT pal.AdminUserId) AS activeThisPeriod
          FROM AdminUserCentre auc
          JOIN AdminUser au     ON au.Id  = auc.AdminUserId
          JOIN AdminUserRole aur ON aur.UserId = au.Id
          JOIN AdminRole ar      ON ar.Id  = aur.RoleId
          JOIN Centre c          ON c.Id   = auc.CentreId
          JOIN PatientAuditLog pal ON pal.AdminUserId = au.Id
            AND ${dateFilterPal}
          WHERE ${superAdminExcl}
            AND ${centreExcl}
            AND ${userExclStrict}
            AND (@centreId IS NULL OR c.Id = @centreId)
          GROUP BY auc.CentreId
        ),

        -- ── Staff who have never had any audit activity ──────────────────────
        staff_never_active_cte AS (
          SELECT auc.CentreId, COUNT(DISTINCT au.Id) AS neverActive
          FROM AdminUserCentre auc
          JOIN AdminUser au     ON au.Id  = auc.AdminUserId
          JOIN AdminUserRole aur ON aur.UserId = au.Id
          JOIN AdminRole ar      ON ar.Id  = aur.RoleId
          JOIN Centre c          ON c.Id   = auc.CentreId
          WHERE ${superAdminExcl}
            AND ${centreExcl}
            AND ${userExclStrict}
            AND (@centreId IS NULL OR c.Id = @centreId)
            AND NOT EXISTS (
              SELECT 1 FROM PatientAuditLog pal2 WHERE pal2.AdminUserId = au.Id
            )
          GROUP BY auc.CentreId
        ),

        -- ── Last activity date per centre ────────────────────────────────────
        last_activity_cte AS (
          SELECT p.CentreId, MAX(pal.CreatedDateTime) AS lastActivityDate
          FROM PatientAuditLog pal
          JOIN Patient p ON p.Id = pal.PatientId
          JOIN Centre c  ON c.Id = p.CentreId
          WHERE ${centreExcl}
            AND ${patExclP}
            AND (@centreId IS NULL OR c.Id = @centreId)
          GROUP BY p.CentreId
        )

        SELECT
          cb.centreId,
          cb.CentreName,
          -- Intake
          ISNULL(reg.casesRegistered,     0) AS casesRegistered,
          ISNULL(asgn.casesAssigned,      0) AS casesAssigned,
          at.avgDaysToAssign,
          ISNULL(sk.stuckUnassigned,      0) AS stuckUnassigned,
          -- Throughput
          ISNULL(cl.activeCaseload,       0) AS activeCaseload,
          ISNULL(sc.assessmentsScored,    0) AS assessmentsScored,
          -- Output
          ISNULL(out.reportsDrafted,      0) AS reportsDrafted,
          ISNULL(out.reportsApproved,     0) AS reportsApproved,
          rat.avgDaysToApproveReport,
          ISNULL(ga.goalsAdded,           0) AS goalsAdded,
          ISNULL(ga.goalsAddedItems,      0) AS goalsAddedItems,
          ISNULL(gap.goalsApproved,       0) AS goalsApproved,
          ISNULL(gap.goalsApprovedItems,  0) AS goalsApprovedItems,
          gat.avgDaysToApproveGoal,
          -- Staff
          ISNULL(st.totalStaff,           0) AS totalStaff,
          ISNULL(st.clinicians,           0) AS clinicians,
          ISNULL(st.managers,             0) AS managers,
          ISNULL(st.ops,                  0) AS ops,
          ISNULL(sa.activeThisPeriod,     0) AS activeThisPeriod,
          ISNULL(sna.neverActive,         0) AS neverActive,
          -- Last activity
          la.lastActivityDate
        FROM centre_base cb
        LEFT JOIN caseload_cte              cl   ON cl.CentreId   = cb.centreId
        LEFT JOIN scored_cte                sc   ON sc.CentreId   = cb.centreId
        LEFT JOIN registered_cte            reg  ON reg.CentreId  = cb.centreId
        LEFT JOIN assigned_cte              asgn ON asgn.CentreId = cb.centreId
        LEFT JOIN assign_time_cte           at   ON at.CentreId   = cb.centreId
        LEFT JOIN stuck_cte                 sk   ON sk.CentreId   = cb.centreId
        LEFT JOIN output_cte                out  ON out.CentreId  = cb.centreId
        LEFT JOIN goals_added_cte           ga   ON ga.CentreId   = cb.centreId
        LEFT JOIN goals_approved_cte        gap  ON gap.CentreId  = cb.centreId
        LEFT JOIN report_approval_time_cte  rat  ON rat.CentreId  = cb.centreId
        LEFT JOIN goal_approval_time_cte    gat  ON gat.CentreId  = cb.centreId
        LEFT JOIN staff_cte                 st   ON st.CentreId   = cb.centreId
        LEFT JOIN staff_active_cte          sa   ON sa.CentreId   = cb.centreId
        LEFT JOIN staff_never_active_cte    sna  ON sna.CentreId  = cb.centreId
        LEFT JOIN last_activity_cte         la   ON la.CentreId   = cb.centreId
        ORDER BY cb.CentreName
      `),
      // Pipeline state counts per centre (point-in-time snapshot)
      bindStd(pool.request(), { centreId, dateFrom, dateTo })
      .query(`
        WITH centre_base AS (
          SELECT c.Id AS centreId
          FROM Centre c
          WHERE ${centreExcl}
            AND (@centreId IS NULL OR c.Id = @centreId)
        ),
        active_ap AS (
          SELECT ap.Id AS apId, pt.CentreId,
            DATEDIFF(day, ap.CreatedDateTimeUtc, GETDATE()) AS agedays,
            ap.Status,
            -- has any report been added?
            CASE WHEN EXISTS (
              SELECT 1 FROM PatientAuditLog pal
              WHERE pal.AllocatePatientId = ap.Id
                AND pal.Type IN ('ReportAdded','ReportPDFGenerated')
            ) THEN 1 ELSE 0 END AS hasReport,
            -- has the report been approved (goals_not_added or beyond)?
            CASE WHEN EXISTS (
              SELECT 1 FROM PatientAuditLog pal
              WHERE pal.AllocatePatientId = ap.Id
                AND pal.Type = 'AssessmentResultGenerated'
            ) THEN 1 ELSE 0 END AS hasApproval,
            -- has any result been generated (scoring complete)?
            CASE WHEN EXISTS (
              SELECT 1 FROM PatientAuditLog pal
              WHERE pal.AllocatePatientId = ap.Id
                AND pal.Type = 'AssessmentResultGenerated'
            ) THEN 1 ELSE 0 END AS scoringComplete,
            -- pending approval: report or goals awaiting manager action
            CASE WHEN (
              EXISTS (
                SELECT 1 FROM PatientAuditLog pal
                WHERE pal.AllocatePatientId = ap.Id
                  AND pal.Type = 'ReportAdded'
              ) AND NOT EXISTS (
                SELECT 1 FROM PatientAuditLog pal
                WHERE pal.AllocatePatientId = ap.Id
                  AND pal.Type = 'AssessmentResultGenerated'
              )
            ) OR (
              EXISTS (
                SELECT 1 FROM PatientAuditLog pal
                WHERE pal.AllocatePatientId = ap.Id
                  AND pal.Type = 'GoalsAdded'
              ) AND NOT EXISTS (
                SELECT 1 FROM PatientGoalApprovalRequestGoal pgar
                JOIN PatientGoalApprovalRequest pga ON pga.Id = pgar.PatientGoalApprovalRequestId
                WHERE pga.AllocatePatientId = ap.Id
                  AND pgar.Status = 'Approved'
              )
            ) THEN 1 ELSE 0 END AS pendingApproval,
            -- goals approved?
            CASE WHEN EXISTS (
              SELECT 1 FROM PatientGoalApprovalRequestGoal pgar
              JOIN PatientGoalApprovalRequest pga ON pga.Id = pgar.PatientGoalApprovalRequestId
              WHERE pga.AllocatePatientId = ap.Id
                AND pgar.Status = 'Approved'
            ) THEN 1 ELSE 0 END AS goalsApproved
          FROM AllocatePatient ap
          JOIN Patient pt ON pt.Id = ap.PatientId
          JOIN centre_base cb ON cb.centreId = pt.CentreId
          WHERE ap.Status NOT IN (${AP_ACTIVE_CENTRES})
            AND ${patExclPt}
        )
        SELECT
          centreId,
          -- scoring: in not_started / in_progress (no scoring complete yet)
          SUM(CASE WHEN scoringComplete = 0 THEN 1 ELSE 0 END) AS scoring,
          -- scoring stuck > 14 days
          SUM(CASE WHEN scoringComplete = 0 AND agedays > 14 THEN 1 ELSE 0 END) AS stuckScoring14d,
          -- scoring stuck > 21 days
          SUM(CASE WHEN scoringComplete = 0 AND agedays > 21 THEN 1 ELSE 0 END) AS stuckScoring21d,
          -- report not drafted (scoring done, no report yet, not pending)
          SUM(CASE WHEN scoringComplete = 1 AND hasReport = 0 AND pendingApproval = 0 AND goalsApproved = 0 THEN 1 ELSE 0 END) AS reportNotDrafted,
          -- pending approval (report/goals waiting for manager)
          SUM(CASE WHEN pendingApproval = 1 AND goalsApproved = 0 THEN 1 ELSE 0 END) AS pendingApproval,
          -- pending approval > 5 days
          SUM(CASE WHEN pendingApproval = 1 AND goalsApproved = 0 AND agedays > 5 THEN 1 ELSE 0 END) AS pendingApproval5d,
          -- pending approval > 7 days
          SUM(CASE WHEN pendingApproval = 1 AND goalsApproved = 0 AND agedays > 7 THEN 1 ELSE 0 END) AS pendingApproval7d,
          -- goals not added (approved, but no goals yet)
          SUM(CASE WHEN hasApproval = 1 AND goalsApproved = 0 AND pendingApproval = 0 THEN 1 ELSE 0 END) AS goalsNotAdded,
          -- goals not added > 7 days
          SUM(CASE WHEN hasApproval = 1 AND goalsApproved = 0 AND pendingApproval = 0 AND agedays > 7 THEN 1 ELSE 0 END) AS goalsNotAdded7d,
          -- goals not added > 14 days
          SUM(CASE WHEN hasApproval = 1 AND goalsApproved = 0 AND pendingApproval = 0 AND agedays > 14 THEN 1 ELSE 0 END) AS goalsNotAdded14d
        FROM active_ap
        GROUP BY centreId
      `),
    ]);

    // Build lookup map: centreId -> pipeline counts
    const pipelineMap = {};
    for (const r of pipelineResult.recordset) {
      pipelineMap[r.centreId] = r;
    }

    const centres = result.recordset.map((r) => {
      const activeCaseload     = r.activeCaseload      ?? 0;
      const assessmentsScored  = r.assessmentsScored   ?? 0;
      const assessmentsAssigned = assessmentsScored + activeCaseload;

      const totalStaff       = r.totalStaff        ?? 0;
      const activeThisPeriod = r.activeThisPeriod   ?? 0;
      const neverActive      = r.neverActive        ?? 0;
      const idle             = Math.max(0, totalStaff - activeThisPeriod - neverActive);

      const pRow = pipelineMap[r.centreId] ?? {};
      const pipeline = {
        scoring:           pRow.scoring          ?? 0,
        stuckScoring14d:   pRow.stuckScoring14d  ?? 0,
        stuckScoring21d:   pRow.stuckScoring21d  ?? 0,
        reportNotDrafted:  pRow.reportNotDrafted  ?? 0,
        pendingApproval:   pRow.pendingApproval   ?? 0,
        pendingApproval5d: pRow.pendingApproval5d ?? 0,
        pendingApproval7d: pRow.pendingApproval7d ?? 0,
        goalsNotAdded:     pRow.goalsNotAdded     ?? 0,
        goalsNotAdded7d:   pRow.goalsNotAdded7d   ?? 0,
        goalsNotAdded14d:  pRow.goalsNotAdded14d  ?? 0,
      };

      const centre = {
        centreId:   r.centreId,
        centreName: abbreviateCentre(r.CentreName) || r.CentreName,

        intake: {
          casesRegistered: r.casesRegistered ?? 0,
          casesAssigned:   r.casesAssigned   ?? 0,
          avgDaysToAssign: roundDays(r.avgDaysToAssign),
          stuckUnassigned: r.stuckUnassigned ?? 0,
        },
        throughput: {
          activeCaseload,
          assessmentsScored,
          assessmentsAssigned,
        },
        pipeline,
        output: {
          reportsDrafted:          r.reportsDrafted       ?? 0,
          reportsApproved:         r.reportsApproved      ?? 0,
          avgDaysToApproveReport:  roundDays(r.avgDaysToApproveReport),
          goalsAdded:              r.goalsAdded           ?? 0,
          goalsAddedItems:         r.goalsAddedItems      ?? 0,
          goalsApproved:           r.goalsApproved        ?? 0,
          goalsApprovedItems:      r.goalsApprovedItems   ?? 0,
          avgDaysToApproveGoal:    roundDays(r.avgDaysToApproveGoal),
        },
        staff: {
          total:             totalStaff,
          clinicians:        r.clinicians        ?? 0,
          managers:          r.managers          ?? 0,
          ops:               r.ops               ?? 0,
          activeThisPeriod,
          idle,
          neverActive,
          activePercent:     totalStaff > 0 ? Math.round((activeThisPeriod / totalStaff) * 100) : 0,
        },
        lastActivityDate: r.lastActivityDate ? r.lastActivityDate.toISOString() : null,
      };

      // Derive status after computing all fields
      const stuckUnassigned = centre.intake.stuckUnassigned;
      const statusResult = calcStatus({ stuckUnassigned, pipeline, throughput: centre.throughput, staff: centre.staff });
      return { ...centre, ...statusResult };
    });

    // Summary across all centres.
    // idleCentres is derived from the same row data the drawer uses, ensuring the
    // card count matches the drawer's record count exactly.
    // The drawer filters allRows where staff.activeThisPeriod === 0 && staff.total > 0.
    const onTrack        = centres.filter((c) => c.status === 'on-track').length;
    const needsAttention = centres.filter((c) => c.status === 'needs-attention').length;
    const blocked        = centres.filter((c) => c.status === 'blocked').length;
    const idleCentres    = centres.filter((c) => c.staff.activeThisPeriod === 0 && c.staff.total > 0).length;

    res.json({
      summary: {
        totalCentres: centres.length,
        onTrack,
        needsAttention,
        blocked,
        idleCentres,
      },
      centres,
    });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/centres/:centreId/detail ─────────────────────────────────────────

router.get('/:centreId/detail', async (req, res, next) => {
  try {
    const centreId = parseInt(req.params.centreId, 10);
    const dateFrom = parseDateParam(req.query.dateFrom);
    const dateTo   = parseDateParam(req.query.dateTo);

    if (isNaN(centreId)) {
      return res.status(400).json({ error: 'centreId must be a number' });
    }
    if (req.query.dateFrom && !dateFrom) {
      return res.status(400).json({ error: 'dateFrom must be a valid ISO date' });
    }
    if (req.query.dateTo && !dateTo) {
      return res.status(400).json({ error: 'dateTo must be a valid ISO date' });
    }

    const pool = await poolPromise;

    const centreExcl       = buildCentreExclusion('c');
    const patExclP         = buildPatientExclusion('p');
    const patExclPt        = buildPatientExclusion('pt');
    const dateFilterPal    = buildDateFilter('pal.CreatedDateTime', '@dateFrom', '@dateTo');
    const dateFilterGoals  = buildDateFilter('pgarg.UpdatedDateTimeUtc', '@dateFrom', '@dateTo');
    const userExclStrict   = FILTERS.userExclusionStrict('au');
    const superAdminExcl   = FILTERS.superAdminExclusion('ar');

    function bind(req2) {
      return req2
        .input('centreId', sql.BigInt, centreId)
        .input('dateFrom', sql.DateTimeOffset, dateFrom)
        .input('dateTo',   sql.DateTimeOffset, dateTo);
    }

    const AP_NOT_TERM = TERMINAL_STATUSES.map((s) => `'${s}'`).join(', ');

    // Run all detail sub-queries in parallel
    const [staffResult, activeCasesResult, overdueResult, auditResult, pipelineDetailResult] = await Promise.all([

      // ── Staff list with per-user activity ──────────────────────────────────
      bind(pool.request()).query(`
        SELECT
          au.Id,
          au.FirstName,
          au.LastName,
          au.Email,
          au.LastLoginDateTimeUtc,
          ar.Name AS roleName,
          SUM(CASE WHEN ${dateFilterPal} THEN 1 ELSE 0 END) AS actionsInPeriod,
          MAX(pal.CreatedDateTime) AS lastActivityDate,
          COUNT(pal.Id) AS totalActionsEver
        FROM AdminUserCentre auc
        JOIN AdminUser au     ON au.Id  = auc.AdminUserId
        JOIN AdminUserRole aur ON aur.UserId = au.Id
        JOIN AdminRole ar      ON ar.Id  = aur.RoleId
        JOIN Centre c          ON c.Id   = auc.CentreId
        LEFT JOIN PatientAuditLog pal ON pal.AdminUserId = au.Id
        WHERE ${superAdminExcl}
          AND ${centreExcl}
          AND ${userExclStrict}
          AND c.Id = @centreId
        GROUP BY au.Id, au.FirstName, au.LastName, au.Email, au.LastLoginDateTimeUtc, ar.Name
        ORDER BY
          CASE WHEN SUM(CASE WHEN ${dateFilterPal} THEN 1 ELSE 0 END) > 0 THEN 0
               WHEN COUNT(pal.Id) > 0 THEN 1
               ELSE 2 END,
          MAX(pal.CreatedDateTime) DESC
      `),

      // ── Active cases ───────────────────────────────────────────────────────
      bind(pool.request()).query(`
        SELECT
          pt.Id AS patientId,
          pt.PatientID AS PatientDisplayId,
          pt.FirstName,
          pt.LastName,
          CONCAT(clinician.FirstName, ' ', clinician.LastName) AS clinicianName,
          ap.Status,
          DATEDIFF(day, ap.CreatedDateTimeUtc, GETDATE()) AS daysOpen,
          ap.Assessment AS assessmentType
        FROM AllocatePatient ap
        JOIN Patient pt            ON pt.Id  = ap.PatientId
        JOIN Centre c              ON c.Id   = pt.CentreId
        LEFT JOIN AdminUser clinician ON clinician.Id = ap.ClinicianUserId
        WHERE ap.Status IN ('NotStarted', 'InProgress', 'OnHold')
          AND c.Id = @centreId
          AND ${buildCentreExclusion('c')}
          AND ${buildPatientExclusion('pt')}
        ORDER BY daysOpen DESC
      `),

      // ── Overdue assessments (assigned 14+ days, no result) ─────────────────
      bind(pool.request()).query(`
        SELECT
          pt.Id AS patientId,
          pt.PatientID AS PatientDisplayId,
          pt.FirstName,
          pt.LastName,
          ap.Assessment AS assessmentType,
          CONCAT(clinician.FirstName, ' ', clinician.LastName) AS clinicianName,
          ap.Status AS assessmentStatus,
          DATEDIFF(day, ap.CreatedDateTimeUtc, GETDATE()) AS daysPending
        FROM AllocatePatient ap
        JOIN Patient pt            ON pt.Id  = ap.PatientId
        JOIN Centre c              ON c.Id   = pt.CentreId
        LEFT JOIN AdminUser clinician ON clinician.Id = ap.ClinicianUserId
        WHERE ap.Status IN ('NotStarted', 'InProgress')
          AND ap.IsResultGenerate = 0
          AND ap.CreatedDateTimeUtc < DATEADD(day, -14, GETDATE())
          AND c.Id = @centreId
          AND ${buildCentreExclusion('c')}
          AND ${buildPatientExclusion('pt')}
        ORDER BY daysPending DESC
      `),

      // ── Recent audit log (last 20 events at this centre) ───────────────────
      bind(pool.request()).query(`
        SELECT TOP 20
          pal.Id,
          pal.Type,
          pal.CreatedDateTime,
          pal.Description,
          au.FirstName AS actorFirst,
          au.LastName  AS actorLast,
          pt.PatientID AS PatientDisplayId
        FROM PatientAuditLog pal
        JOIN Patient pt      ON pt.Id  = pal.PatientId
        JOIN Centre c        ON c.Id   = pt.CentreId
        LEFT JOIN AdminUser au ON au.Id = pal.AdminUserId
        WHERE c.Id = @centreId
          AND ${buildCentreExclusion('c')}
          AND ${buildPatientExclusion('pt')}
        ORDER BY pal.CreatedDateTime DESC
      `),

      // ── Pipeline breakdown (point-in-time stage counts for this centre) ────
      bind(pool.request()).query(`
        SELECT
          SUM(CASE WHEN scoringDone = 0 THEN 1 ELSE 0 END) AS inScoring,
          SUM(CASE WHEN scoringDone = 1 AND hasReport = 0 AND pendingApproval = 0 AND goalsApproved = 0 THEN 1 ELSE 0 END) AS awaitingReport,
          SUM(CASE WHEN pendingApproval = 1 AND goalsApproved = 0 THEN 1 ELSE 0 END) AS awaitingApproval,
          SUM(CASE WHEN scoringDone = 1 AND pendingApproval = 0 AND goalsApproved = 0 AND hasReport = 1 THEN 1 ELSE 0 END) AS goalsNotAdded,
          SUM(CASE WHEN goalsApproved = 1 THEN 1 ELSE 0 END) AS completed
        FROM (
          SELECT
            ap.Id,
            CASE WHEN EXISTS (
              SELECT 1 FROM PatientAuditLog pal
              WHERE pal.AllocatePatientId = ap.Id
                AND pal.Type = 'AssessmentResultGenerated'
            ) THEN 1 ELSE 0 END AS scoringDone,
            CASE WHEN EXISTS (
              SELECT 1 FROM PatientAuditLog pal
              WHERE pal.AllocatePatientId = ap.Id
                AND pal.Type IN ('ReportAdded','ReportPDFGenerated')
            ) THEN 1 ELSE 0 END AS hasReport,
            CASE WHEN (
              EXISTS (
                SELECT 1 FROM PatientAuditLog pal
                WHERE pal.AllocatePatientId = ap.Id AND pal.Type = 'ReportAdded'
              ) AND NOT EXISTS (
                SELECT 1 FROM PatientAuditLog pal
                WHERE pal.AllocatePatientId = ap.Id AND pal.Type = 'AssessmentResultGenerated'
              )
            ) OR (
              EXISTS (
                SELECT 1 FROM PatientAuditLog pal
                WHERE pal.AllocatePatientId = ap.Id AND pal.Type = 'GoalsAdded'
              ) AND NOT EXISTS (
                SELECT 1 FROM PatientGoalApprovalRequestGoal pgar
                JOIN PatientGoalApprovalRequest pga ON pga.Id = pgar.PatientGoalApprovalRequestId
                WHERE pga.AllocatePatientId = ap.Id AND pgar.Status = 'Approved'
              )
            ) THEN 1 ELSE 0 END AS pendingApproval,
            CASE WHEN EXISTS (
              SELECT 1 FROM PatientGoalApprovalRequestGoal pgar
              JOIN PatientGoalApprovalRequest pga ON pga.Id = pgar.PatientGoalApprovalRequestId
              WHERE pga.AllocatePatientId = ap.Id AND pgar.Status = 'Approved'
            ) THEN 1 ELSE 0 END AS goalsApproved
          FROM AllocatePatient ap
          JOIN Patient pt ON pt.Id = ap.PatientId
          JOIN Centre c   ON c.Id  = pt.CentreId
          WHERE c.Id = @centreId
            AND ${buildCentreExclusion('c')}
            AND ${buildPatientExclusion('pt')}
            AND ap.Status NOT IN (${AP_NOT_TERM})
        ) sub
      `),
    ]);

    // Staff status classification
    const staff = staffResult.recordset.map((r) => {
      let status;
      if (r.actionsInPeriod > 0) status = 'active';
      else if (r.totalActionsEver === 0) status = 'never-active';
      else {
        const daysSince = r.lastActivityDate
          ? Math.floor((Date.now() - new Date(r.lastActivityDate).getTime()) / 86_400_000)
          : 999;
        status = daysSince <= 14 ? 'idle' : 'silent';
      }
      return {
        id:               r.Id,
        firstName:        r.FirstName,
        lastName:         r.LastName,
        email:            r.Email,
        roleName:         r.roleName,
        actionsInPeriod:  r.actionsInPeriod  ?? 0,
        lastActivityDate: r.lastActivityDate ? r.lastActivityDate.toISOString() : null,
        lastLoginDate:    r.LastLoginDateTimeUtc ? r.LastLoginDateTimeUtc.toISOString() : null,
        status,
      };
    });

    const activeCases = activeCasesResult.recordset.map((r) => ({
      patientId:        r.patientId,
      patientDisplayId: r.PatientDisplayId || null,
      patientName:      `${r.FirstName} ${r.LastName}`,
      clinicianName:    r.clinicianName || null,
      status:           r.Status,
      daysOpen:         r.daysOpen ?? 0,
      assessmentType:   r.assessmentType || null,
    }));

    const overdueAssessments = overdueResult.recordset.map((r) => ({
      patientId:        r.patientId,
      patientDisplayId: r.PatientDisplayId || null,
      patientName:      `${r.FirstName} ${r.LastName}`,
      clinicianName:    r.clinicianName || null,
      assessmentStatus: r.assessmentStatus,
      assessmentType:   r.assessmentType || null,
      daysPending:      r.daysPending ?? 0,
    }));

    const recentAudit = auditResult.recordset.map((r) => ({
      id:               r.Id,
      type:             r.Type,
      createdAt:        r.CreatedDateTime ? r.CreatedDateTime.toISOString() : null,
      description:      r.Description || null,
      actorName:        r.actorFirst ? `${r.actorFirst} ${r.actorLast}` : null,
      patientDisplayId: r.PatientDisplayId || null,
    }));

    const pdRow = pipelineDetailResult.recordset[0] ?? {};
    const pipelineBreakdown = {
      inScoring:       pdRow.inScoring       ?? 0,
      awaitingReport:  pdRow.awaitingReport   ?? 0,
      awaitingApproval: pdRow.awaitingApproval ?? 0,
      goalsNotAdded:   pdRow.goalsNotAdded    ?? 0,
      completed:       pdRow.completed        ?? 0,
    };

    res.json({ staff, activeCases, overdueAssessments, recentAudit, pipelineBreakdown });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
