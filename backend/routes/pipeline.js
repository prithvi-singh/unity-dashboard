'use strict';

const { Router } = require('express');
const { sql, poolPromise } = require('../db');
const { parseDateParam, buildDateFilter, buildCentreExclusion } = require('../lib/queryHelpers');

const router = Router();

/**
 * GET /api/pipeline
 * Query params: centreId (optional), dateFrom (optional), dateTo (optional)
 *
 * Returns the full clinical workflow pipeline with per-stage metrics,
 * manager approval performance, and stuck cases requiring ops attention.
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

    console.log('[pipeline] GET /api/pipeline centreId=%s dateFrom=%s dateTo=%s',
      centreId, req.query.dateFrom || 'none', req.query.dateTo || 'none');

    const centreExclusion = buildCentreExclusion('c');
    const centreFilter    = '(@centreId IS NULL OR c.Id = @centreId)';
    const palDateFilter   = buildDateFilter('pal.CreatedDateTime', '@dateFrom', '@dateTo');
    const apDateFilter    = buildDateFilter('ap.CreatedDateTimeUtc', '@dateFrom', '@dateTo');

    function bindAll(request) {
      return request
        .input('centreId', sql.BigInt, centreId)
        .input('dateFrom', sql.DateTimeOffset, dateFrom)
        .input('dateTo',   sql.DateTimeOffset, dateTo);
    }

    // ── Run all queries in parallel ─────────────────────────────────────────
    const [
      stageCountsResult,
      avgDaysResult,
      managerApprovalResult,
      byManagerResult,
      stuckCasesResult,
    ] = await Promise.all([

      // ── Q1: Stage counts ─────────────────────────────────────────────────
      // ap_scope has NO date filter so current-state stages (in_progress,
      // report_drafted, etc.) show ALL active cases, not just those assigned
      // in the selected period. The intake metrics (onboarded, assigned) are
      // still date-filtered via palDateFilter on PatientAuditLog events.
      // Event timestamps are pre-joined to avoid correlated subqueries.
      bindAll(pool.request()).query(`
        WITH ap_scope AS (
          SELECT ap.Id AS apId, ap.PatientId, ap.Status, ap.IsResultGenerate,
                 ap.ClinicianUserId, ap.CreatedDateTimeUtc AS assignedAt, p.CentreId
          FROM AllocatePatient ap
          JOIN Patient p ON p.Id = ap.PatientId
          JOIN Centre c  ON c.Id = p.CentreId
          WHERE (${centreFilter})
            AND ${centreExclusion}
        ),
        result_time AS (
          SELECT AllocatePatientId, MIN(CreatedDateTime) AS resultAt
          FROM PatientAuditLog
          WHERE Type = 'AssessmentResultGenerated'
            AND AllocatePatientId IS NOT NULL
          GROUP BY AllocatePatientId
        ),
        pdf_time AS (
          SELECT AllocatePatientId, MIN(CreatedDateTime) AS pdfAt
          FROM PatientAuditLog
          WHERE Type = 'ReportPDFGenerated'
            AND AllocatePatientId IS NOT NULL
          GROUP BY AllocatePatientId
        ),
        first_goal_approval AS (
          SELECT pgar.Id AS requestId,
            MIN(pgarg.UpdatedDateTimeUtc) AS firstApprovedAt
          FROM PatientGoalApprovalRequestGoal pgarg
          JOIN PatientGoalApprovalRequest pgar ON pgar.Id = pgarg.PatientGoalApprovalRequestId
          WHERE pgarg.Status = 'Approved'
          GROUP BY pgar.Id
        ),
        onboarded AS (
          SELECT COUNT(DISTINCT pal.PatientId) AS cnt,
            AVG(CAST(DATEDIFF(hour,
              pal.CreatedDateTime,
              asnTime.firstAssignedAt
            ) AS FLOAT) / 24.0) AS avgDays
          FROM PatientAuditLog pal
          JOIN Patient p  ON p.Id = pal.PatientId
          JOIN Centre c   ON c.Id = p.CentreId
          OUTER APPLY (
            SELECT MIN(a.CreatedDateTime) AS firstAssignedAt
            FROM PatientAuditLog a
            WHERE a.PatientId = pal.PatientId AND a.Type = 'CaseAssigned'
          ) asnTime
          WHERE pal.Type = 'CaseRegistered'
            AND (${centreFilter})
            AND ${centreExclusion}
            AND ${palDateFilter}
        ),
        assigned AS (
          SELECT COUNT(DISTINCT pal.AllocatePatientId) AS cnt,
            SUM(CASE
              WHEN aps.apId IS NOT NULL
               AND aps.IsResultGenerate = 0
               AND DATEDIFF(day, aps.assignedAt, SYSDATETIMEOFFSET()) > 7
              THEN 1 ELSE 0
            END) AS stuckCount
          FROM PatientAuditLog pal
          JOIN Patient p  ON p.Id = pal.PatientId
          JOIN Centre c   ON c.Id = p.CentreId
          LEFT JOIN ap_scope aps ON aps.apId = pal.AllocatePatientId
          WHERE pal.Type = 'CaseAssigned'
            AND pal.AllocatePatientId IS NOT NULL
            AND (${centreFilter})
            AND ${centreExclusion}
            AND ${palDateFilter}
        ),
        in_progress AS (
          SELECT COUNT(*) AS cnt
          FROM ap_scope aps
          WHERE aps.Status IN ('NotStarted', 'InProgress', 'OnHold')
            AND aps.IsResultGenerate = 0
        ),
        report_drafted AS (
          SELECT COUNT(*) AS cnt,
            SUM(CASE
              WHEN pt.pdfAt IS NULL
               AND rt.resultAt IS NOT NULL
               AND DATEDIFF(day, rt.resultAt, SYSDATETIMEOFFSET()) > 7
              THEN 1 ELSE 0
            END) AS stuckCount,
            AVG(CASE
              WHEN rt.resultAt IS NOT NULL AND pt.pdfAt IS NOT NULL
              THEN CAST(DATEDIFF(hour, rt.resultAt, pt.pdfAt) AS FLOAT) / 24.0
              ELSE NULL
            END) AS avgDays
          FROM ap_scope aps
          LEFT JOIN result_time rt ON rt.AllocatePatientId = aps.apId
          LEFT JOIN pdf_time    pt ON pt.AllocatePatientId = aps.apId
          WHERE aps.IsResultGenerate = 1
        ),
        report_pending AS (
          SELECT COUNT(*) AS cnt,
            SUM(CASE
              WHEN DATEDIFF(day, pt.pdfAt, SYSDATETIMEOFFSET()) > 3
              THEN 1 ELSE 0
            END) AS stuckCount,
            CAST(NULL AS FLOAT) AS avgDays
          FROM ap_scope aps
          JOIN pdf_time pt ON pt.AllocatePatientId = aps.apId
          WHERE NOT EXISTS (
            SELECT 1 FROM AllocatePatientReport apr WHERE apr.AllocatePatientId = aps.apId
          )
        ),
        goals_set AS (
          SELECT COUNT(DISTINCT pgar.AllocatePatientId) AS cnt,
            AVG(CAST(DATEDIFF(hour, pgar.CreatedDateTimeUtc, fga.firstApprovedAt) AS FLOAT) / 24.0) AS avgDays
          FROM PatientGoalApprovalRequest pgar
          JOIN ap_scope aps ON aps.apId = pgar.AllocatePatientId
          LEFT JOIN first_goal_approval fga ON fga.requestId = pgar.Id
        ),
        goals_pending AS (
          SELECT COUNT(DISTINCT pgar.AllocatePatientId) AS cnt,
            SUM(CASE
              WHEN DATEDIFF(day, pgar.CreatedDateTimeUtc, SYSDATETIMEOFFSET()) > 7
              THEN 1 ELSE 0
            END) AS stuckCount,
            AVG(CAST(DATEDIFF(hour, pgar.CreatedDateTimeUtc, SYSDATETIMEOFFSET()) AS FLOAT) / 24.0) AS avgDays
          FROM PatientGoalApprovalRequest pgar
          JOIN ap_scope aps ON aps.apId = pgar.AllocatePatientId
          WHERE EXISTS (
            SELECT 1 FROM PatientGoalApprovalRequestGoal pgarg
            WHERE pgarg.PatientGoalApprovalRequestId = pgar.Id
              AND pgarg.Status NOT IN ('Approved', 'Rejected')
          )
        ),
        closed AS (
          SELECT COUNT(*) AS cnt
          FROM ap_scope aps
          WHERE aps.Status NOT IN ('NotStarted', 'InProgress', 'OnHold')
             OR aps.IsResultGenerate = 1
        )
        SELECT
          ob.cnt          AS onboardedCount,
          ob.avgDays      AS onboardedAvgDays,
          asn.cnt         AS assignedCount,
          asn.stuckCount  AS assignedStuck,
          ip.cnt          AS inProgressCount,
          rd.cnt          AS reportDraftedCount,
          rd.stuckCount   AS reportDraftedStuck,
          rd.avgDays      AS reportDraftedAvgDays,
          rp.cnt          AS reportPendingCount,
          rp.stuckCount   AS reportPendingStuck,
          rp.avgDays      AS reportPendingAvgDays,
          gs.cnt          AS goalsSetCount,
          gs.avgDays      AS goalsSetAvgDays,
          gp.cnt          AS goalsPendingCount,
          gp.stuckCount   AS goalsPendingStuck,
          gp.avgDays      AS goalsPendingAvgDays,
          cl.cnt          AS closedCount
        FROM onboarded ob
        CROSS JOIN assigned asn
        CROSS JOIN in_progress ip
        CROSS JOIN report_drafted rd
        CROSS JOIN report_pending rp
        CROSS JOIN goals_set gs
        CROSS JOIN goals_pending gp
        CROSS JOIN closed cl
      `),

      // ── Q2: Avg days: assignment → result (for assigned-stage avg) ────────
      bindAll(pool.request()).query(`
        WITH assigned_pairs AS (
          SELECT
            pal.AllocatePatientId,
            MIN(pal.CreatedDateTime) AS assignedAt
          FROM PatientAuditLog pal
          JOIN Patient p ON p.Id = pal.PatientId
          JOIN Centre c  ON c.Id = p.CentreId
          WHERE pal.Type = 'CaseAssigned'
            AND pal.AllocatePatientId IS NOT NULL
            AND (${centreFilter})
            AND ${centreExclusion}
            AND ${palDateFilter}
          GROUP BY pal.AllocatePatientId
        ),
        result_dates AS (
          SELECT ap.AllocatePatientId, MIN(ap.CreatedDateTime) AS resultAt
          FROM PatientAuditLog ap
          WHERE ap.Type = 'AssessmentResultGenerated'
          GROUP BY ap.AllocatePatientId
        )
        SELECT AVG(CAST(DATEDIFF(hour, p.assignedAt, r.resultAt) AS FLOAT) / 24.0) AS avgDays
        FROM assigned_pairs p
        JOIN result_dates r ON r.AllocatePatientId = p.AllocatePatientId
        WHERE r.resultAt > p.assignedAt
      `),

      // ── Q3: Overall manager approval stats ───────────────────────────────
      bindAll(pool.request()).query(`
        WITH ap_scope AS (
          SELECT ap.Id AS apId
          FROM AllocatePatient ap
          JOIN Patient p ON p.Id = ap.PatientId
          JOIN Centre c  ON c.Id = p.CentreId
          WHERE (${centreFilter})
            AND ${centreExclusion}
            AND ${apDateFilter}
        )
        SELECT
          -- Report: PDF generated (total drafted reports)
          (SELECT COUNT(DISTINCT pal.AllocatePatientId)
           FROM PatientAuditLog pal
           JOIN ap_scope ON ap_scope.apId = pal.AllocatePatientId
           WHERE pal.Type = 'ReportPDFGenerated') AS reportPdfTotal,

          -- Report: Shared with family (approved by manager)
          (SELECT COUNT(DISTINCT apr.AllocatePatientId)
           FROM AllocatePatientReport apr
           JOIN ap_scope ON ap_scope.apId = apr.AllocatePatientId) AS reportSharedTotal,

          -- Report avg approval hours (PDF → Shared)
          (SELECT AVG(CAST(DATEDIFF(minute,
             pdfTime.generatedAt,
             apr.CreatedDateTimeUtc
           ) AS FLOAT) / 60.0)
           FROM AllocatePatientReport apr
           JOIN ap_scope ON ap_scope.apId = apr.AllocatePatientId
           CROSS APPLY (
             SELECT MIN(pal.CreatedDateTime) AS generatedAt
             FROM PatientAuditLog pal
             WHERE pal.AllocatePatientId = apr.AllocatePatientId
               AND pal.Type = 'ReportPDFGenerated'
           ) pdfTime
           WHERE pdfTime.generatedAt IS NOT NULL
             AND apr.CreatedDateTimeUtc > pdfTime.generatedAt
          ) AS reportAvgApprovalHours,

          -- Goal: total goal lines submitted
          (SELECT COUNT(*)
           FROM PatientGoalApprovalRequestGoal pgarg
           JOIN PatientGoalApprovalRequest pgar ON pgar.Id = pgarg.PatientGoalApprovalRequestId
           JOIN ap_scope ON ap_scope.apId = pgar.AllocatePatientId) AS goalTotal,

          -- Goal: approved
          (SELECT COUNT(*)
           FROM PatientGoalApprovalRequestGoal pgarg
           JOIN PatientGoalApprovalRequest pgar ON pgar.Id = pgarg.PatientGoalApprovalRequestId
           JOIN ap_scope ON ap_scope.apId = pgar.AllocatePatientId
           WHERE pgarg.Status = 'Approved') AS goalApproved,

          -- Goal avg approval hours
          (SELECT AVG(CAST(DATEDIFF(minute, pgar.CreatedDateTimeUtc, pgarg.UpdatedDateTimeUtc) AS FLOAT) / 60.0)
           FROM PatientGoalApprovalRequestGoal pgarg
           JOIN PatientGoalApprovalRequest pgar ON pgar.Id = pgarg.PatientGoalApprovalRequestId
           JOIN ap_scope ON ap_scope.apId = pgar.AllocatePatientId
           WHERE pgarg.Status = 'Approved'
             AND pgarg.UpdatedDateTimeUtc > pgar.CreatedDateTimeUtc) AS goalAvgApprovalHours
      `),

      // ── Q4: Per-manager approval stats ───────────────────────────────────
      bindAll(pool.request()).query(`
        WITH manager_list AS (
          SELECT DISTINCT
            au.Id AS managerId,
            au.FirstName,
            au.LastName,
            c.Id AS centreId,
            c.CentreName
          FROM AdminUser au
          JOIN AdminUserRole aur ON aur.UserId = au.Id
          JOIN AdminRole ar      ON ar.Id = aur.RoleId
            AND ar.Name NOT IN ('Clinician', 'Super Admin')
          JOIN AdminUserCentre auc ON auc.AdminUserId = au.Id
          JOIN Centre c            ON c.Id = auc.CentreId
          WHERE au.FirstName NOT LIKE '%(Ops)%'
            AND au.LastName  NOT LIKE '%(Ops)%'
            AND au.Email     NOT LIKE '%@webority.com'
            AND LOWER(au.FirstName) NOT LIKE '%test%'
            AND LOWER(au.LastName)  NOT LIKE '%test%'
            AND LOWER(c.CentreName) NOT LIKE '%test%'
            AND LOWER(c.CentreName) NOT LIKE '%delete%'
            AND (@centreId IS NULL OR c.Id = @centreId)
        ),
        ap_scope AS (
          SELECT ap.Id AS apId, p.CentreId
          FROM AllocatePatient ap
          JOIN Patient p ON p.Id = ap.PatientId
          JOIN Centre c  ON c.Id = p.CentreId
          WHERE (@centreId IS NULL OR c.Id = @centreId)
            AND LOWER(c.CentreName) NOT LIKE '%test%'
            AND LOWER(c.CentreName) NOT LIKE '%delete%'
            AND ${apDateFilter}
        ),
        report_pdf_by_centre AS (
          SELECT aps.CentreId,
            COUNT(DISTINCT pal.AllocatePatientId) AS pdfTotal
          FROM PatientAuditLog pal
          JOIN ap_scope aps ON aps.apId = pal.AllocatePatientId
          WHERE pal.Type = 'ReportPDFGenerated'
          GROUP BY aps.CentreId
        ),
        report_shared_by_centre AS (
          SELECT aps.CentreId,
            COUNT(DISTINCT apr.AllocatePatientId) AS sharedTotal,
            AVG(CAST(DATEDIFF(minute,
              pdfTime.generatedAt,
              apr.CreatedDateTimeUtc
            ) AS FLOAT) / 60.0) AS avgReportHours
          FROM AllocatePatientReport apr
          JOIN ap_scope aps ON aps.apId = apr.AllocatePatientId
          CROSS APPLY (
            SELECT MIN(pal.CreatedDateTime) AS generatedAt
            FROM PatientAuditLog pal
            WHERE pal.AllocatePatientId = apr.AllocatePatientId
              AND pal.Type = 'ReportPDFGenerated'
          ) pdfTime
          WHERE pdfTime.generatedAt IS NOT NULL
            AND apr.CreatedDateTimeUtc > pdfTime.generatedAt
          GROUP BY aps.CentreId
        ),
        goals_by_centre AS (
          SELECT aps.CentreId,
            COUNT(*)                                                                AS goalTotal,
            SUM(CASE WHEN pgarg.Status = 'Approved' THEN 1 ELSE 0 END)             AS goalApproved,
            SUM(CASE WHEN pgarg.Status NOT IN ('Approved','Rejected') THEN 1 ELSE 0 END) AS goalPending,
            AVG(CASE
              WHEN pgarg.Status = 'Approved'
               AND pgarg.UpdatedDateTimeUtc > pgar.CreatedDateTimeUtc
              THEN CAST(DATEDIFF(minute, pgar.CreatedDateTimeUtc, pgarg.UpdatedDateTimeUtc) AS FLOAT) / 60.0
              ELSE NULL
            END) AS avgGoalHours
          FROM PatientGoalApprovalRequestGoal pgarg
          JOIN PatientGoalApprovalRequest pgar ON pgar.Id = pgarg.PatientGoalApprovalRequestId
          JOIN ap_scope aps ON aps.apId = pgar.AllocatePatientId
          GROUP BY aps.CentreId
        )
        SELECT
          ml.managerId,
          ml.FirstName,
          ml.LastName,
          ml.CentreName,
          ISNULL(rp.pdfTotal, 0)    AS reportPdfTotal,
          ISNULL(rs.sharedTotal, 0) AS reportSharedTotal,
          rs.avgReportHours,
          ISNULL(gc.goalTotal, 0)   AS goalTotal,
          ISNULL(gc.goalApproved, 0) AS goalApproved,
          ISNULL(gc.goalPending, 0)  AS goalPending,
          gc.avgGoalHours
        FROM manager_list ml
        LEFT JOIN report_pdf_by_centre rp ON rp.CentreId = ml.centreId
        LEFT JOIN report_shared_by_centre rs ON rs.CentreId = ml.centreId
        LEFT JOIN goals_by_centre gc ON gc.CentreId = ml.centreId
        WHERE ISNULL(rp.pdfTotal, 0) + ISNULL(gc.goalTotal, 0) > 0
        ORDER BY
          CASE WHEN ISNULL(rp.pdfTotal, 0) = 0 THEN 1 ELSE 0 END,
          (ISNULL(rs.sharedTotal, 0) * 1.0 / NULLIF(rp.pdfTotal, 0)) ASC,
          ml.LastName, ml.FirstName
      `),

      // ── Q5: Stuck cases (no movement in 7+ days, still active) ──────────
      bindAll(pool.request()).query(`
        WITH ap_scope AS (
          SELECT ap.Id AS apId, ap.PatientId, ap.Status, ap.IsResultGenerate,
                 ap.ClinicianUserId, ap.Assessment AS assessmentType
          FROM AllocatePatient ap
          JOIN Patient p ON p.Id = ap.PatientId
          JOIN Centre c  ON c.Id = p.CentreId
          WHERE ap.Status IN ('NotStarted', 'InProgress', 'OnHold')
            AND (${centreFilter})
            AND ${centreExclusion}
        ),
        last_action AS (
          SELECT pal.AllocatePatientId,
            MAX(pal.CreatedDateTime) AS lastAt
          FROM PatientAuditLog pal
          WHERE pal.AllocatePatientId IS NOT NULL
          GROUP BY pal.AllocatePatientId
        ),
        stage_resolved AS (
          SELECT
            aps.apId, aps.PatientId, aps.ClinicianUserId, aps.assessmentType,
            la.lastAt,
            DATEDIFF(day, la.lastAt, SYSDATETIMEOFFSET()) AS daysStuck,
            CASE
              WHEN EXISTS (
                SELECT 1
                FROM PatientGoalApprovalRequestGoal pgarg
                JOIN PatientGoalApprovalRequest pgar
                  ON pgar.Id = pgarg.PatientGoalApprovalRequestId
                WHERE pgar.AllocatePatientId = aps.apId
                  AND pgarg.Status NOT IN ('Approved', 'Rejected')
              ) THEN 'Goals Pending Approval'
              WHEN EXISTS (
                SELECT 1 FROM PatientGoalApprovalRequest pgar
                WHERE pgar.AllocatePatientId = aps.apId
              ) THEN 'Goals Set'
              WHEN EXISTS (
                SELECT 1 FROM AllocatePatientReport apr
                WHERE apr.AllocatePatientId = aps.apId
              ) THEN 'Report Approved'
              WHEN EXISTS (
                SELECT 1 FROM PatientAuditLog pal2
                WHERE pal2.AllocatePatientId = aps.apId
                  AND pal2.Type = 'ReportPDFGenerated'
              ) AND aps.IsResultGenerate = 1 THEN 'Report Pending Approval'
              WHEN aps.IsResultGenerate = 1 THEN 'Report Drafted'
              ELSE 'Assessment In Progress'
            END AS currentStage
          FROM ap_scope aps
          LEFT JOIN last_action la ON la.AllocatePatientId = aps.apId
          WHERE la.lastAt IS NULL
             OR DATEDIFF(day, la.lastAt, SYSDATETIMEOFFSET()) >= 7
        ),
        manager_per_centre AS (
          SELECT auc.CentreId,
            LTRIM(RTRIM(CONCAT(
              ISNULL(MIN(au.FirstName), ''),
              ' ',
              ISNULL(MIN(au.LastName), '')
            ))) AS managerName
          FROM AdminUser au
          JOIN AdminUserRole aur ON aur.UserId = au.Id
          JOIN AdminRole ar      ON ar.Id = aur.RoleId
            AND ar.Name NOT IN ('Clinician', 'Super Admin')
          JOIN AdminUserCentre auc ON auc.AdminUserId = au.Id
          WHERE au.FirstName NOT LIKE '%(Ops)%'
            AND au.LastName  NOT LIKE '%(Ops)%'
            AND LOWER(au.FirstName) NOT LIKE '%test%'
          GROUP BY auc.CentreId
        )
        SELECT TOP 100
          p.Id          AS patientId,
          p.PatientID   AS patientDisplayId,
          p.FirstName   AS firstName,
          p.LastName    AS lastName,
          c.CentreName  AS centreName,
          sr.currentStage,
          sr.daysStuck,
          sr.assessmentType,
          LTRIM(RTRIM(CONCAT(ISNULL(cl.FirstName,''), ' ', ISNULL(cl.LastName,'')))) AS clinicianName,
          mpc.managerName
        FROM stage_resolved sr
        JOIN Patient p   ON p.Id = sr.PatientId
        JOIN Centre c    ON c.Id = p.CentreId
        LEFT JOIN AdminUser cl  ON cl.Id = sr.ClinicianUserId
        LEFT JOIN manager_per_centre mpc ON mpc.CentreId = p.CentreId
        WHERE sr.currentStage NOT IN ('Report Approved')
        ORDER BY sr.daysStuck DESC, c.CentreName, p.LastName
      `),
    ]);

    // ── Build response ─────────────────────────────────────────────────────
    const sc = stageCountsResult.recordset[0] || {};
    const ad = avgDaysResult.recordset[0] || {};
    const ma = managerApprovalResult.recordset[0] || {};

    const toNum = (v) => (v != null ? parseFloat(Number(v).toFixed(2)) : null);
    const toInt = (v) => parseInt(v ?? 0, 10);

    const reportPdfTotal  = toInt(ma.reportPdfTotal);
    const reportSharedTotal = toInt(ma.reportSharedTotal);
    const goalTotal       = toInt(ma.goalTotal);
    const goalApproved    = toInt(ma.goalApproved);

    const stages = [
      {
        stage: 'Onboarded',
        count: toInt(sc.onboardedCount),
        avgDaysInStage: toNum(sc.onboardedAvgDays),
      },
      {
        stage: 'Assessment Assigned',
        count: toInt(sc.assignedCount),
        avgDaysInStage: toNum(ad.avgDays),
        stuckCount: toInt(sc.assignedStuck),
      },
      {
        stage: 'Assessment In Progress',
        count: toInt(sc.inProgressCount),
        avgDaysInStage: null,
        stuckCount: null,
      },
      {
        stage: 'Report Drafted',
        count: toInt(sc.reportDraftedCount),
        avgDaysInStage: toNum(sc.reportDraftedAvgDays),
        stuckCount: toInt(sc.reportDraftedStuck),
      },
      {
        stage: 'Report Pending Approval',
        count: toInt(sc.reportPendingCount),
        avgDaysInStage: toNum(sc.reportPendingAvgDays),
        stuckCount: toInt(sc.reportPendingStuck),
      },
      {
        stage: 'Goals Set',
        count: toInt(sc.goalsSetCount),
        avgDaysInStage: toNum(sc.goalsSetAvgDays),
      },
      {
        stage: 'Goals Pending Approval',
        count: toInt(sc.goalsPendingCount),
        avgDaysInStage: toNum(sc.goalsPendingAvgDays),
        stuckCount: toInt(sc.goalsPendingStuck),
      },
      {
        stage: 'Closed',
        count: toInt(sc.closedCount),
      },
    ];

    const managerApprovalStats = {
      reportApprovalRate: reportPdfTotal > 0
        ? parseFloat(((reportSharedTotal / reportPdfTotal) * 100).toFixed(1))
        : 0,
      reportAvgApprovalHours: toNum(ma.reportAvgApprovalHours),
      goalApprovalRate: goalTotal > 0
        ? parseFloat(((goalApproved / goalTotal) * 100).toFixed(1))
        : 0,
      goalAvgApprovalHours: toNum(ma.goalAvgApprovalHours),
      byManager: byManagerResult.recordset.map((r) => {
        const rPdf   = toInt(r.reportPdfTotal);
        const rShare = toInt(r.reportSharedTotal);
        const gTotal = toInt(r.goalTotal);
        const gApprv = toInt(r.goalApproved);
        return {
          managerId:          r.managerId,
          firstName:          r.FirstName,
          lastName:           r.LastName,
          centreName:         r.CentreName,
          reportApprovalRate: rPdf > 0 ? parseFloat(((rShare / rPdf) * 100).toFixed(1)) : 0,
          reportPending:      rPdf - rShare > 0 ? rPdf - rShare : 0,
          goalApprovalRate:   gTotal > 0 ? parseFloat(((gApprv / gTotal) * 100).toFixed(1)) : 0,
          goalPending:        toInt(r.goalPending),
          avgApprovalHours:   toNum(r.avgGoalHours ?? r.avgReportHours),
        };
      }),
    };

    const stuckCases = stuckCasesResult.recordset.map((r) => ({
      patientId:       r.patientId,
      patientDisplayId: r.patientDisplayId ?? null,
      firstName:       r.firstName ?? '',
      lastName:        r.lastName ?? '',
      centreName:      r.centreName ?? '',
      currentStage:    r.currentStage,
      daysStuck:       r.daysStuck ?? 0,
      assessmentType:  r.assessmentType ?? null,
      clinicianName:   (r.clinicianName ?? '').trim() || null,
      managerName:     (r.managerName ?? '').trim() || null,
    }));

    res.json({ stages, managerApprovalStats, stuckCases });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
