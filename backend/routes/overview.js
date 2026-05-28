'use strict';

const { Router } = require('express');
const { sql, poolPromise } = require('../db');
const { parseDateParam, buildDateFilter, buildPatientExclusion } = require('../lib/queryHelpers');
const { abbreviateCentre } = require('../lib/formatters');
const { getCoreMetrics } = require('../services/metricsService');
const { FILTERS } = require('../utils/metrics');
const { getGoalCoverageForOverview } = require('../utils/goalProgress');

const router = Router();

/**
 * Races a DB query promise against a timeout.
 * If the query takes longer than `ms`, resolves with { recordset: [] } so the
 * overview route still returns 200 with empty data for that section rather than
 * blocking the entire Promise.all for 45 seconds.
 */
function withTimeout(queryPromise, ms) {
  const fallback = new Promise(resolve =>
    setTimeout(() => {
      console.warn(`[overview] query timed out after ${ms}ms — returning empty result`);
      resolve({ recordset: [] });
    }, ms)
  );
  return Promise.race([queryPromise, fallback]);
}

// ── Centre status helper (mirrors /api/centres/overview logic) ────────────────
function calcCentreStatus({ stuckUnassigned, completionRate, idle, activeThisPeriod, totalStaff, assessmentsAssigned }) {
  const reasons = [];

  if (activeThisPeriod === 0 && totalStaff > 0) reasons.push('No staff active in this period');
  if (stuckUnassigned > 3) reasons.push(`${stuckUnassigned} cases stuck unassigned`);
  if (completionRate < 30 && assessmentsAssigned > 0) reasons.push(`Completion rate ${completionRate}%`);

  if (
    (activeThisPeriod === 0 && totalStaff > 0) ||
    stuckUnassigned > 3 ||
    (completionRate < 30 && assessmentsAssigned > 0)
  ) {
    return { status: 'blocked', statusReasons: reasons };
  }

  const naReasons = [];
  if (stuckUnassigned >= 1 && stuckUnassigned <= 3) {
    naReasons.push(`${stuckUnassigned} case${stuckUnassigned > 1 ? 's' : ''} stuck unassigned`);
  }
  if (completionRate >= 30 && completionRate < 60 && assessmentsAssigned > 0) {
    naReasons.push(`Completion rate ${completionRate}%`);
  }
  if (idle > 0) naReasons.push(`${idle} idle staff`);

  if (naReasons.length > 0) return { status: 'needs-attention', statusReasons: naReasons };
  return { status: 'on-track', statusReasons: [] };
}

// Sort order for centre health: blocked → needs-attention → on-track
const STATUS_ORDER = { 'blocked': 0, 'needs-attention': 1, 'on-track': 2 };

/**
 * GET /api/overview
 * Query params: centreId (optional), dateFrom (optional), dateTo (optional)
 *
 * Returns aggregate counts from PatientAuditLog, per-centre breakdown for
 * Period Summary drawers, upcoming bottlenecks, and the 8-stage clinical pipeline.
 */
function round1(n) { return Math.round(n * 10) / 10; }

router.get('/', async (req, res, next) => {
  const reqStart = Date.now();
  console.log('[overview] → request received', req.query);
  res.on('finish', () => console.log(`[overview] ← response sent in ${Date.now() - reqStart}ms`));
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

    // ── Previous period date range ─────────────────────────────────────────────
    let prevDateFrom = null;
    let prevDateTo   = null;
    if (dateFrom && dateTo) {
      const periodMs = dateTo.getTime() - dateFrom.getTime();
      // Previous period ends 1 day before dateFrom, same length
      prevDateTo   = new Date(dateFrom.getTime() - 24 * 60 * 60 * 1000);
      prevDateFrom = new Date(prevDateTo.getTime() - periodMs);
    }

    const pool = await poolPromise;

    // AllocatePatient statuses that mean the case is no longer active
    const AP_NOT_TERMINAL_OV = `'Closed','Completed','Cancelled'`;

    const centreExclusion = `LOWER(c.CentreName) NOT LIKE '%test%'
                         AND LOWER(c.CentreName) NOT LIKE '%delete%'`;

    function bindParams(request) {
      return request
        .input('centreId', sql.BigInt, centreId)
        .input('dateFrom', sql.DateTimeOffset, dateFrom)
        .input('dateTo',   sql.DateTimeOffset, dateTo);
    }

    const filteredCasesCte = `
      WITH filtered_cases AS (
        SELECT DISTINCT pal.PatientId
        FROM PatientAuditLog pal
        JOIN Patient p ON p.Id = pal.PatientId
        JOIN Centre c  ON c.Id = p.CentreId
        WHERE pal.Type = 'CaseRegistered'
          AND (@centreId IS NULL OR c.Id = @centreId)
          AND ${centreExclusion}
          AND ${buildPatientExclusion('p')}
          AND ${buildDateFilter('pal.CreatedDateTime', '@dateFrom', '@dateTo')}
      ),
      multi_patients AS (
        SELECT ap.PatientId
        FROM AllocatePatient ap
        INNER JOIN filtered_cases fc ON fc.PatientId = ap.PatientId
        GROUP BY ap.PatientId
        HAVING COUNT(*) >= 2
      )`;

    const CE  = FILTERS.centreExclusion();
    const CF  = FILTERS.centreFilter();

    // Run overview-specific queries in parallel alongside the shared metrics service.
    const [
      metrics,
      prevMetrics,
      centresResult,
      upcomingBottlenecksResult,
      multiAssessmentResult,
      needsActionResult,
    ] = await Promise.all([

      // Shared metrics — single source of truth
      getCoreMetrics({ dateFrom, dateTo, centreId }),

      // Previous period metrics for period-over-period comparison
      prevDateFrom ? getCoreMetrics({ dateFrom: prevDateFrom, dateTo: prevDateTo, centreId }) : Promise.resolve(null),

      // Centre dropdown list (for filter UI)
      pool.request().query(`
        SELECT Id, CentreName AS name
        FROM Centre
        WHERE LOWER(CentreName) NOT LIKE '%test%'
          AND LOWER(CentreName) NOT LIKE '%delete%'
        ORDER BY CentreName
      `),

      // ── Upcoming bottlenecks — assigned 10-13 days ago, no result ────────────
      withTimeout(pool.request()
        .input('centreId', sql.BigInt, centreId)
        .query(`
        SELECT
          LTRIM(RTRIM(CONCAT(ISNULL(pt.FirstName,''),' ',ISNULL(pt.LastName,'')))) AS patientName,
          ISNULL(pt.PatientID, '')                                                  AS patientDisplayId,
          ISNULL(ap.Assessment, 'Unknown')                                          AS assessmentType,
          LTRIM(RTRIM(CONCAT(ISNULL(au.FirstName,''),' ',ISNULL(au.LastName,''))))  AS clinicianName,
          ISNULL(au.Id, 0)                                                          AS clinicianId,
          c.CentreName                                                              AS centreName,
          DATEDIFF(day, ap.CreatedDateTimeUtc, GETDATE())                          AS daysAssigned,
          14 - DATEDIFF(day, ap.CreatedDateTimeUtc, GETDATE())                     AS daysUntilOverdue
        FROM AllocatePatient ap
        JOIN Patient pt ON pt.Id = ap.PatientId
        JOIN Centre  c  ON c.Id  = pt.CentreId
        LEFT JOIN AdminUser au ON au.Id = ap.ClinicianUserId
        WHERE ap.IsResultGenerate = 0
          AND DATEDIFF(day, ap.CreatedDateTimeUtc, GETDATE()) BETWEEN 10 AND 13
          AND ap.Status NOT IN ('Closed','Completed','Cancelled')
          AND ${CE}
          AND ${CF}
          AND pt.FirstName NOT LIKE '%test%'
          AND pt.LastName  NOT LIKE '%test%'
        ORDER BY daysAssigned DESC
      `), 8_000),

      // Patients with 2+ assessment assignments
      withTimeout(bindParams(pool.request()).query(`
        ${filteredCasesCte}
        SELECT
          pt.Id AS patientId,
          pt.PatientID AS patientDisplayId,
          pt.FirstName AS firstName,
          pt.LastName AS lastName,
          c.CentreName AS centreName,
          ap.Id AS allocatePatientId,
          ap.Assessment AS type,
          ap.Status AS status,
          ap.IsResultGenerate AS isResultGenerate,
          ap.CreatedDateTimeUtc AS assignedDate,
          LTRIM(RTRIM(CONCAT(ISNULL(au.FirstName, ''), ' ', ISNULL(au.LastName, '')))) AS clinicianName
        FROM multi_patients mp
        JOIN Patient pt ON pt.Id = mp.PatientId
        JOIN Centre c ON c.Id = pt.CentreId
        JOIN AllocatePatient ap ON ap.PatientId = mp.PatientId
        LEFT JOIN AdminUser au ON au.Id = ap.ClinicianUserId
        ORDER BY c.CentreName, pt.LastName, pt.FirstName, ap.CreatedDateTimeUtc
      `), 12_000),

      // ── Needs-action counts: 4 pipeline health signals ────────────────────
      // Point-in-time — NOT date-filtered. Counts open items exceeding
      // the minimum alert threshold per pipeline state.
      withTimeout(pool.request()
        .input('centreId', sql.BigInt, centreId)
        .query(`
        WITH
        result_gen AS (
          SELECT DISTINCT AllocatePatientId
          FROM PatientAuditLog
          WHERE Type = 'AssessmentResultGenerated' AND AllocatePatientId IS NOT NULL
        ),
        result_gen_ts AS (
          SELECT AllocatePatientId, MIN(CreatedDateTime) AS resultGeneratedAt
          FROM PatientAuditLog
          WHERE Type = 'AssessmentResultGenerated' AND AllocatePatientId IS NOT NULL
          GROUP BY AllocatePatientId
        ),
        report_added AS (
          SELECT DISTINCT AllocatePatientId
          FROM PatientAuditLog
          WHERE Type = 'ReportAdded' AND AllocatePatientId IS NOT NULL
        ),
        report_added_ts AS (
          SELECT AllocatePatientId, MIN(CreatedDateTime) AS draftedAt
          FROM PatientAuditLog
          WHERE Type = 'ReportAdded' AND AllocatePatientId IS NOT NULL
          GROUP BY AllocatePatientId
        ),
        pdf_gen AS (
          SELECT DISTINCT AllocatePatientId
          FROM PatientAuditLog
          WHERE Type = 'ReportPDFGenerated' AND AllocatePatientId IS NOT NULL
        ),
        pdf_gen_ts AS (
          SELECT AllocatePatientId, MIN(CreatedDateTime) AS pdfGeneratedAt
          FROM PatientAuditLog
          WHERE Type = 'ReportPDFGenerated' AND AllocatePatientId IS NOT NULL
          GROUP BY AllocatePatientId
        ),
        goal_req AS (
          SELECT DISTINCT AllocatePatientId
          FROM PatientGoalApprovalRequest
        ),
        goal_req_ts AS (
          SELECT AllocatePatientId, MIN(CreatedDateTimeUtc) AS submittedAt
          FROM PatientGoalApprovalRequest
          GROUP BY AllocatePatientId
        )
        SELECT
          (
            SELECT COUNT(*)
            FROM AllocatePatient ap
            JOIN Patient pt ON pt.Id = ap.PatientId
            JOIN Centre c   ON c.Id  = pt.CentreId
            WHERE ap.Assessment IN ('SPM','DP3','REELS','ISAA')
              AND ap.Status NOT IN (${AP_NOT_TERMINAL_OV})
              AND ap.Id NOT IN (SELECT AllocatePatientId FROM result_gen)
              AND DATEDIFF(day, ap.CreatedDateTimeUtc, SYSDATETIMEOFFSET()) > 14
              AND LOWER(c.CentreName) NOT LIKE '%test%' AND LOWER(c.CentreName) NOT LIKE '%delete%'
              AND pt.FirstName NOT LIKE '%test%' AND pt.LastName NOT LIKE '%test%'
              AND (@centreId IS NULL OR c.Id = @centreId)
          ) AS stuckInScoring,
          (
            SELECT COUNT(*)
            FROM result_gen_ts rg
            JOIN AllocatePatient ap ON ap.Id = rg.AllocatePatientId
            JOIN Patient pt ON pt.Id = ap.PatientId
            JOIN Centre c   ON c.Id  = pt.CentreId
            WHERE ap.Id NOT IN (SELECT AllocatePatientId FROM report_added)
              AND ap.Assessment IN ('SPM','DP3','REELS','ISAA')
              AND ap.Status NOT IN (${AP_NOT_TERMINAL_OV})
              AND DATEDIFF(day, rg.resultGeneratedAt, SYSDATETIMEOFFSET()) > 7
              AND LOWER(c.CentreName) NOT LIKE '%test%' AND LOWER(c.CentreName) NOT LIKE '%delete%'
              AND pt.FirstName NOT LIKE '%test%' AND pt.LastName NOT LIKE '%test%'
              AND (@centreId IS NULL OR c.Id = @centreId)
          ) AS reportsOverdue,
          (
            SELECT COUNT(*) FROM (
              SELECT ap.Id FROM report_added_ts ra
              JOIN AllocatePatient ap ON ap.Id = ra.AllocatePatientId
              JOIN Patient pt ON pt.Id = ap.PatientId
              JOIN Centre c   ON c.Id  = pt.CentreId
              WHERE ap.Id NOT IN (SELECT AllocatePatientId FROM pdf_gen)
                AND ap.Assessment IN ('SPM','DP3','REELS','ISAA')
                AND ap.Status NOT IN (${AP_NOT_TERMINAL_OV})
                AND DATEDIFF(day, ra.draftedAt, SYSDATETIMEOFFSET()) > 5
                AND LOWER(c.CentreName) NOT LIKE '%test%' AND LOWER(c.CentreName) NOT LIKE '%delete%'
                AND pt.FirstName NOT LIKE '%test%' AND pt.LastName NOT LIKE '%test%'
                AND (@centreId IS NULL OR c.Id = @centreId)
              UNION ALL
              SELECT pgar.AllocatePatientId FROM goal_req_ts grt
              JOIN PatientGoalApprovalRequest pgar ON pgar.AllocatePatientId = grt.AllocatePatientId
              JOIN AllocatePatient ap ON ap.Id = pgar.AllocatePatientId
              JOIN Patient pt ON pt.Id = ap.PatientId
              JOIN Centre c   ON c.Id  = pt.CentreId
              WHERE NOT EXISTS (
                SELECT 1 FROM PatientGoalApprovalRequestGoal pgarg2
                WHERE pgarg2.PatientGoalApprovalRequestId = pgar.Id AND pgarg2.Status = 'Approved'
              )
                AND ap.Status NOT IN (${AP_NOT_TERMINAL_OV})
                AND DATEDIFF(day, grt.submittedAt, SYSDATETIMEOFFSET()) > 5
                AND LOWER(c.CentreName) NOT LIKE '%test%' AND LOWER(c.CentreName) NOT LIKE '%delete%'
                AND pt.FirstName NOT LIKE '%test%' AND pt.LastName NOT LIKE '%test%'
                AND (@centreId IS NULL OR c.Id = @centreId)
            ) _approvals
          ) AS approvalsNeeded,
          (
            SELECT COUNT(*)
            FROM pdf_gen_ts pg
            JOIN AllocatePatient ap ON ap.Id = pg.AllocatePatientId
            JOIN Patient pt ON pt.Id = ap.PatientId
            JOIN Centre c   ON c.Id  = pt.CentreId
            WHERE ap.Id NOT IN (SELECT AllocatePatientId FROM goal_req)
              AND NOT EXISTS (
                SELECT 1
                FROM PatientGoalApprovalRequest pgar2
                JOIN PatientGoalApprovalRequestGoal pgarg2
                  ON pgarg2.PatientGoalApprovalRequestId = pgar2.Id
                JOIN AllocatePatient ap2 ON ap2.Id = pgar2.AllocatePatientId
                WHERE ap2.PatientId = ap.PatientId
                  AND pgarg2.Status = 'Approved'
                  AND pgar2.CreatedDateTimeUtc >= pg.pdfGeneratedAt
              )
              AND ap.Assessment IN ('SPM','DP3','REELS','ISAA')
              AND ap.Status NOT IN (${AP_NOT_TERMINAL_OV})
              AND DATEDIFF(day, pg.pdfGeneratedAt, SYSDATETIMEOFFSET()) > 7
              AND LOWER(c.CentreName) NOT LIKE '%test%' AND LOWER(c.CentreName) NOT LIKE '%delete%'
              AND pt.FirstName NOT LIKE '%test%' AND pt.LastName NOT LIKE '%test%'
              AND (@centreId IS NULL OR c.Id = @centreId)
          ) AS goalsNotAdded,

          -- ── Total state counts (no threshold — for Period Summary cards) ──────────
          (
            SELECT COUNT(*)
            FROM AllocatePatient ap
            JOIN Patient pt ON pt.Id = ap.PatientId
            JOIN Centre c   ON c.Id  = pt.CentreId
            WHERE ap.Assessment IN ('SPM','DP3','REELS','ISAA')
              AND ap.Status NOT IN (${AP_NOT_TERMINAL_OV})
              AND ap.Id NOT IN (SELECT AllocatePatientId FROM result_gen)
              AND LOWER(c.CentreName) NOT LIKE '%test%' AND LOWER(c.CentreName) NOT LIKE '%delete%'
              AND pt.FirstName NOT LIKE '%test%' AND pt.LastName NOT LIKE '%test%'
              AND (@centreId IS NULL OR c.Id = @centreId)
          ) AS totalScoring,
          (
            SELECT COUNT(*)
            FROM result_gen_ts rg
            JOIN AllocatePatient ap ON ap.Id = rg.AllocatePatientId
            JOIN Patient pt ON pt.Id = ap.PatientId
            JOIN Centre c   ON c.Id  = pt.CentreId
            WHERE ap.Id NOT IN (SELECT AllocatePatientId FROM report_added)
              AND ap.Assessment IN ('SPM','DP3','REELS','ISAA')
              AND ap.Status NOT IN (${AP_NOT_TERMINAL_OV})
              AND LOWER(c.CentreName) NOT LIKE '%test%' AND LOWER(c.CentreName) NOT LIKE '%delete%'
              AND pt.FirstName NOT LIKE '%test%' AND pt.LastName NOT LIKE '%test%'
              AND (@centreId IS NULL OR c.Id = @centreId)
          ) AS totalReportNotDrafted,
          (
            SELECT COUNT(*) FROM (
              SELECT ap.Id FROM report_added_ts ra
              JOIN AllocatePatient ap ON ap.Id = ra.AllocatePatientId
              JOIN Patient pt ON pt.Id = ap.PatientId
              JOIN Centre c   ON c.Id  = pt.CentreId
              WHERE ap.Id NOT IN (SELECT AllocatePatientId FROM pdf_gen)
                AND ap.Assessment IN ('SPM','DP3','REELS','ISAA')
                AND ap.Status NOT IN (${AP_NOT_TERMINAL_OV})
                AND LOWER(c.CentreName) NOT LIKE '%test%' AND LOWER(c.CentreName) NOT LIKE '%delete%'
                AND pt.FirstName NOT LIKE '%test%' AND pt.LastName NOT LIKE '%test%'
                AND (@centreId IS NULL OR c.Id = @centreId)
              UNION ALL
              SELECT pgar.AllocatePatientId FROM PatientGoalApprovalRequest pgar
              JOIN AllocatePatient ap ON ap.Id = pgar.AllocatePatientId
              JOIN Patient pt ON pt.Id = ap.PatientId
              JOIN Centre c   ON c.Id  = pt.CentreId
              WHERE NOT EXISTS (
                SELECT 1 FROM PatientGoalApprovalRequestGoal pgarg2
                WHERE pgarg2.PatientGoalApprovalRequestId = pgar.Id AND pgarg2.Status = 'Approved'
              )
                AND ap.Status NOT IN (${AP_NOT_TERMINAL_OV})
                AND LOWER(c.CentreName) NOT LIKE '%test%' AND LOWER(c.CentreName) NOT LIKE '%delete%'
                AND pt.FirstName NOT LIKE '%test%' AND pt.LastName NOT LIKE '%test%'
                AND (@centreId IS NULL OR c.Id = @centreId)
            ) _totalApprovals
          ) AS totalAwaitingApproval,
          (
            SELECT COUNT(*)
            FROM pdf_gen_ts pg
            JOIN AllocatePatient ap ON ap.Id = pg.AllocatePatientId
            JOIN Patient pt ON pt.Id = ap.PatientId
            JOIN Centre c   ON c.Id  = pt.CentreId
            WHERE ap.Id NOT IN (SELECT AllocatePatientId FROM goal_req)
              AND NOT EXISTS (
                SELECT 1
                FROM PatientGoalApprovalRequest pgar3
                JOIN PatientGoalApprovalRequestGoal pgarg3
                  ON pgarg3.PatientGoalApprovalRequestId = pgar3.Id
                JOIN AllocatePatient ap3 ON ap3.Id = pgar3.AllocatePatientId
                WHERE ap3.PatientId = ap.PatientId
                  AND pgarg3.Status = 'Approved'
                  AND pgar3.CreatedDateTimeUtc >= pg.pdfGeneratedAt
              )
              AND ap.Assessment IN ('SPM','DP3','REELS','ISAA')
              AND ap.Status NOT IN (${AP_NOT_TERMINAL_OV})
              AND LOWER(c.CentreName) NOT LIKE '%test%' AND LOWER(c.CentreName) NOT LIKE '%delete%'
              AND pt.FirstName NOT LIKE '%test%' AND pt.LastName NOT LIKE '%test%'
              AND (@centreId IS NULL OR c.Id = @centreId)
          ) AS totalGoalsNotAdded
      `), 10_000),
    ]);

    // ── Build pipeline stages from metricsService (already cached, fast) ────────
    // Uses the same counts as the clinical-pipeline funnel endpoint.
    // pendingCount / stuckCount / avgDaysInStage are not available from this
    // source and are omitted (always 0/null) — acceptable since the cohort-based
    // CTE query that computed them was consistently timing out at 15+ seconds.
    const pl      = metrics.pipeline;
    const s1Base  = pl.registered  || 1;
    const s3Base  = pl.assigned    || 1;

    function pct(n, base) { return base > 0 ? Math.round((n / base) * 100) : 0; }

    const pipelineStages = [
      {
        id: 'stage-registered',
        label: 'Case registered',
        responsibleRole: 'Centre Admin (Ops) or Manager',
        count: pl.registered,
        percentOfBase: 100,
        pendingCount: 0,
        avgDaysInStage: null,
        stuckCount: 0,
        stuckThresholdDays: 2,
      },
      {
        id: 'stage-history',
        label: 'Case history',
        responsibleRole: 'Clinician or Manager',
        count: 0,
        percentOfBase: 0,
        pendingCount: 0,
        avgDaysInStage: null,
        stuckCount: 0,
        stuckThresholdDays: 7,
      },
      {
        id: 'stage-assigned',
        label: 'Assessment assigned',
        responsibleRole: 'Centre Admin (Ops) or Manager',
        count: pl.assigned,
        percentOfBase: pct(pl.assigned, s1Base),
        pendingCount: 0,
        avgDaysInStage: null,
        stuckCount: 0,
        stuckThresholdDays: 3,
      },
      {
        id: 'stage-scoring',
        label: 'Scoring complete',
        responsibleRole: 'Clinician',
        count: pl.scoringComplete,
        percentOfBase: pct(pl.scoringComplete, s3Base),
        pendingCount: 0,
        avgDaysInStage: null,
        stuckCount: 0,
        stuckThresholdDays: 14,
      },
      {
        id: 'stage-report-drafted',
        label: 'Report drafted',
        responsibleRole: 'Clinician',
        count: pl.reportDrafted,
        percentOfBase: pct(pl.reportDrafted, s3Base),
        pendingCount: 0,
        avgDaysInStage: null,
        stuckCount: 0,
        stuckThresholdDays: 7,
      },
      {
        id: 'stage-report-approved',
        label: 'Report approved',
        responsibleRole: 'Manager',
        count: pl.reportPdfCreated,
        percentOfBase: pct(pl.reportPdfCreated, s3Base),
        pendingCount: 0,
        avgDaysInStage: null,
        stuckCount: 0,
        stuckThresholdDays: 5,
      },
      {
        id: 'stage-goals-added',
        label: 'Goals added',
        responsibleRole: 'Clinician',
        count: pl.goalsAdded,
        percentOfBase: pct(pl.goalsAdded, s3Base),
        pendingCount: 0,
        avgDaysInStage: null,
        stuckCount: 0,
        stuckThresholdDays: 7,
      },
      {
        id: 'stage-goals-approved',
        label: 'Goals approved',
        responsibleRole: 'Manager',
        count: pl.goalsApproved,
        percentOfBase: pct(pl.goalsApproved, s3Base),
        pendingCount: 0,
        avgDaysInStage: null,
        stuckCount: 0,
        stuckThresholdDays: 7,
      },
    ];

    // ── Build upcoming bottlenecks ─────────────────────────────────────────────
    const upcomingItems = upcomingBottlenecksResult.recordset.map((r) => ({
      patientName:      (r.patientName    || '').trim() || null,
      patientDisplayId: r.patientDisplayId || null,
      assessmentType:   r.assessmentType  || 'Unknown',
      clinicianName:    (r.clinicianName  || '').trim() || null,
      clinicianId:      r.clinicianId     ?? 0,
      centreName:       r.centreName      || null,
      daysAssigned:     r.daysAssigned    ?? 0,
      daysUntilOverdue: r.daysUntilOverdue ?? 0,
    }));
    // Sort: most urgent (fewest days until overdue) first
    upcomingItems.sort((a, b) => a.daysUntilOverdue - b.daysUntilOverdue);

    const upcomingBottlenecks = {
      count: upcomingItems.length,
      items: upcomingItems,
    };

    // ── Derive totals from shared metrics (single source of truth) ────────────
    const { pipeline, cases, assessments, reports, goals, centres, users } = metrics;

    const totalCases         = cases.total;
    const totalCentresCount  = centres.total;
    const activeCentreCount  = centres.active;
    const idleCentreCount    = centres.idle;

    const multipleAssessmentCases = buildMultipleAssessmentCases(
      multiAssessmentResult.recordset,
      totalCases,
    );

    // Build idleCentreDetails from the service's centre activity data
    const idleCentreDetails = centres.idleCentreNames.map((name) => ({
      name: abbreviateCentre(name),
      lastActivityDate: null,
    }));

    // ── Previous period metrics ───────────────────────────────────────────────
    const previousPeriodMetrics = prevMetrics ? {
      totalCases:           prevMetrics.cases.total,
      totalAssessments:     prevMetrics.assessments.assigned,
      totalScored:          prevMetrics.pipeline?.scoringComplete ?? 0,
      totalReportsDrafted:  prevMetrics.reports.drafted,
      totalReportsApproved: prevMetrics.reports.approved,
      totalGoalsAdded:      prevMetrics.goals.added,
      totalGoalsApproved:   prevMetrics.goals.approved,
      activeUsers:          prevMetrics.users.active,
      activeCentres:        prevMetrics.centres.active,
      dateFrom:             prevDateFrom.toISOString().slice(0, 10),
      dateTo:               prevDateTo.toISOString().slice(0, 10),
    } : null;

    // ── Build byCentre — used by Period Summary drawers (Total Cases, Active Centres) ──
    // Snap fields (snapAssigned, snapScored, etc.) removed — they were only used
    // by the Centre Breakdown table which has been removed from Overview.
    const repMap = new Map(reports.byCentre.map((r) => [r.centreId, r]));
    const casesMap = new Map(cases.byCentre.map((r) => [r.centreId, r.count]));
    const byCentreData = assessments.byCentre.map((ac) => {
      const rep = repMap.get(ac.centreId) || {};
      return {
        centreId:        ac.centreId,
        centreName:      abbreviateCentre(ac.centreName),
        cases:           casesMap.get(ac.centreId) ?? 0,
        assessments:     ac.assigned,
        reportsDrafted:  rep.drafted  ?? 0,
        reportsApproved: rep.approved ?? 0,
      };
    });

    // ── Build needsAction counts ──────────────────────────────────────────────
    // Point-in-time pipeline health signal — not date-filtered.
    const naRow = needsActionResult?.recordset?.[0] ?? {};
    const needsAction = {
      // Threshold-filtered (for Needs Action banner — shows actionable items only)
      stuckInScoring:       naRow.stuckInScoring       ?? 0,
      reportsOverdue:       naRow.reportsOverdue       ?? 0,
      approvalsNeeded:      naRow.approvalsNeeded      ?? 0,
      goalsNotAdded:        naRow.goalsNotAdded        ?? 0,
      total: (naRow.stuckInScoring ?? 0) + (naRow.reportsOverdue ?? 0) +
             (naRow.approvalsNeeded ?? 0) + (naRow.goalsNotAdded ?? 0),
      // Total state counts (for Period Summary cards — all cases in state, no threshold)
      totalScoring:         naRow.totalScoring         ?? 0,
      totalReportNotDrafted: naRow.totalReportNotDrafted ?? 0,
      totalAwaitingApproval: naRow.totalAwaitingApproval ?? 0,
      totalGoalsNotAdded:   naRow.totalGoalsNotAdded   ?? 0,
    };

    res.json({
      // ── Core counts from shared service ──────────────────────────────────
      totalCases,
      totalAssessments:     pipeline.assigned,
      totalScoringComplete: pipeline.scoringComplete,
      totalResults:         pipeline.reportPdfCreated,
      totalTransfers:       0,
      totalStatusChanges:   0,
      // Single source of truth for active/idle centre counts
      totalCentresCount,
      activeCentreCount,
      idleCentreCount,
      idleCentreDetails,
      pipeline,
      multipleAssessmentCases,
      // ── Overview-specific ─────────────────────────────────────────────────
      needsAction,
      upcomingBottlenecks,
      previousPeriodMetrics,
      pipelineStages,
      // ── Per-centre breakdown: used by Period Summary Total Cases / Active Centres drawers ──
      byCentre: byCentreData,
      centres: centresResult.recordset.map((r) => ({
        id:   r.Id,
        name: abbreviateCentre(r.name),
      })),
      // ── Goal coverage — async, non-critical ──────────────────────────────────
      goalCoverage: await (async () => {
        try {
          return await getGoalCoverageForOverview(centreId);
        } catch (e) {
          console.warn('[overview] goalCoverage error', e.message);
          return null;
        }
      })(),
    });
  } catch (err) {
    next(err);
  }
});

function buildMultipleAssessmentCases(rows, totalCases) {
  const caseMap = new Map();

  for (const row of rows) {
    if (!caseMap.has(row.patientId)) {
      caseMap.set(row.patientId, {
        patientId: row.patientId,
        patientDisplayId: row.patientDisplayId ?? null,
        firstName: row.firstName ?? '',
        lastName: row.lastName ?? '',
        centreName: row.centreName ?? '',
        assessments: [],
        totalAssessments: 0,
      });
    }

    const entry = caseMap.get(row.patientId);
    entry.assessments.push({
      allocatePatientId: row.allocatePatientId,
      type: row.type ?? null,
      status: row.status ?? null,
      isResultGenerate: !!row.isResultGenerate,
      assignedDate: row.assignedDate ? new Date(row.assignedDate).toISOString() : null,
      clinicianName: (row.clinicianName ?? '').trim() || null,
    });
    entry.totalAssessments = entry.assessments.length;
  }

  const cases = Array.from(caseMap.values());
  const count = cases.length;
  const percentage = totalCases > 0
    ? Math.round((count / totalCases) * 1000) / 10
    : 0;

  return { count, percentage, cases };
}

/**
 * GET /api/overview/pipeline-cases
 * Returns the pending or stuck cases for a specific pipeline stage.
 * Query params: stage (required), type (pending|stuck), centreId, dateFrom, dateTo
 */
router.get('/pipeline-cases', async (req, res, next) => {
  try {
    const { stage, type } = req.query;
    const centreId = req.query.centreId ? parseInt(req.query.centreId, 10) : null;
    const dateFrom = parseDateParam(req.query.dateFrom);
    const dateTo   = parseDateParam(req.query.dateTo);

    const VALID_STAGES = ['stage-registered','stage-history','stage-assigned','stage-scoring','stage-report-drafted','stage-report-approved','stage-goals-added','stage-goals-approved'];
    if (!stage || !VALID_STAGES.includes(stage)) {
      return res.status(400).json({ error: 'Invalid or missing stage param' });
    }
    if (!type || !['pending','stuck'].includes(type)) {
      return res.status(400).json({ error: 'type must be pending or stuck' });
    }

    const pool = await poolPromise;
    const CE2 = FILTERS.centreExclusion();
    const CF2 = FILTERS.centreFilter();

    // Shared FP CTE (patients registered in period)
    const fpCte = `
      fp AS (
        SELECT DISTINCT pal.PatientId
        FROM PatientAuditLog pal
        JOIN Patient pt ON pt.Id = pal.PatientId
        JOIN Centre  c  ON c.Id  = pt.CentreId
        WHERE pal.Type = 'CaseRegistered'
          AND ${CF2} AND ${CE2}
          AND pt.FirstName NOT LIKE '%test%' AND pt.LastName NOT LIKE '%test%'
          AND (@dateFrom IS NULL OR pal.CreatedDateTime >= @dateFrom)
          AND (@dateTo   IS NULL OR pal.CreatedDateTime < DATEADD(day, 1, @dateTo))
      )`;

    // Threshold days per stage (for stuck filter)
    const thresholds = {
      'stage-registered': 2,
      'stage-history': 7,
      'stage-assigned': 3,
      'stage-scoring': 14,
      'stage-report-drafted': 7,
      'stage-report-approved': 5,
      'stage-goals-added': 7,
      'stage-goals-approved': 7,
    };
    const threshold = thresholds[stage];
    const stuckWhere = type === 'stuck' ? `AND DATEDIFF(day, ts, SYSDATETIMEOFFSET()) > ${threshold}` : '';

    let sql_query = '';

    if (stage === 'stage-registered') {
      sql_query = `WITH ${fpCte},
        s1 AS (SELECT pal.PatientId, MIN(pal.CreatedDateTime) AS ts FROM PatientAuditLog pal JOIN fp ON fp.PatientId=pal.PatientId WHERE pal.Type='CaseRegistered' GROUP BY pal.PatientId),
        s2 AS (SELECT pch.PatientId FROM PatientCaseHistory pch JOIN fp ON fp.PatientId=pch.PatientId GROUP BY pch.PatientId)
        SELECT TOP 50
          LTRIM(RTRIM(ISNULL(pt.FirstName,'')+' '+ISNULL(pt.LastName,''))) AS patientName,
          ISNULL(pt.PatientID,'') AS patientDisplayId, NULL AS assessmentType,
          NULL AS responsiblePersonName, NULL AS responsiblePersonId,
          c.CentreName AS centreName,
          DATEDIFF(day, s1.ts, SYSDATETIMEOFFSET()) AS daysWaiting
        FROM s1
        JOIN Patient pt ON pt.Id=s1.PatientId JOIN Centre c ON c.Id=pt.CentreId
        WHERE s1.PatientId NOT IN (SELECT PatientId FROM s2) ${stuckWhere}
        ORDER BY daysWaiting DESC`;
    } else if (stage === 'stage-history') {
      sql_query = `WITH ${fpCte},
        s2 AS (SELECT pch.PatientId, CAST(NULL AS datetimeoffset) AS ts FROM PatientCaseHistory pch JOIN fp ON fp.PatientId=pch.PatientId GROUP BY pch.PatientId),
        s3ids AS (SELECT DISTINCT ap.PatientId FROM AllocatePatient ap JOIN fp ON fp.PatientId=ap.PatientId WHERE ap.Status NOT IN ('Cancelled'))
        SELECT TOP 50
          LTRIM(RTRIM(ISNULL(pt.FirstName,'')+' '+ISNULL(pt.LastName,''))) AS patientName,
          ISNULL(pt.PatientID,'') AS patientDisplayId, NULL AS assessmentType,
          NULL AS responsiblePersonName, NULL AS responsiblePersonId,
          c.CentreName AS centreName,
          DATEDIFF(day, s2.ts, SYSDATETIMEOFFSET()) AS daysWaiting
        FROM s2
        JOIN Patient pt ON pt.Id=s2.PatientId JOIN Centre c ON c.Id=pt.CentreId
        WHERE s2.PatientId NOT IN (SELECT PatientId FROM s3ids) ${stuckWhere}
        ORDER BY daysWaiting DESC`;
    } else if (stage === 'stage-assigned') {
      sql_query = `WITH ${fpCte},
        s3 AS (SELECT ap.Id AS apId, ap.PatientId, ap.Assessment, ap.ClinicianUserId, ap.CreatedDateTimeUtc AS ts, ap.Status AS apStatus FROM AllocatePatient ap JOIN fp ON fp.PatientId=ap.PatientId WHERE ap.Status NOT IN ('Cancelled')),
        s4ids AS (SELECT DISTINCT pal.AllocatePatientId AS apId FROM PatientAuditLog pal JOIN s3 ON s3.apId=pal.AllocatePatientId WHERE pal.Type IN ('AssessmentResultGenerated','AssessmentStatusChanged'))
        SELECT TOP 50
          LTRIM(RTRIM(ISNULL(pt.FirstName,'')+' '+ISNULL(pt.LastName,''))) AS patientName,
          ISNULL(pt.PatientID,'') AS patientDisplayId, s3.Assessment AS assessmentType,
          LTRIM(RTRIM(ISNULL(au.FirstName,'')+' '+ISNULL(au.LastName,''))) AS responsiblePersonName,
          ISNULL(au.Id,0) AS responsiblePersonId,
          c.CentreName AS centreName,
          DATEDIFF(day, s3.ts, SYSDATETIMEOFFSET()) AS daysWaiting
        FROM s3
        JOIN Patient pt ON pt.Id=s3.PatientId JOIN Centre c ON c.Id=pt.CentreId
        LEFT JOIN AdminUser au ON au.Id=s3.ClinicianUserId
        WHERE s3.apId NOT IN (SELECT apId FROM s4ids) AND s3.apStatus NOT IN ('Completed') ${stuckWhere}
        ORDER BY daysWaiting DESC`;
    } else if (stage === 'stage-scoring') {
      sql_query = `WITH ${fpCte},
        s3 AS (SELECT ap.Id AS apId, ap.PatientId, ap.Assessment, ap.ClinicianUserId FROM AllocatePatient ap JOIN fp ON fp.PatientId=ap.PatientId WHERE ap.Status NOT IN ('Cancelled')),
        s4 AS (SELECT pal.AllocatePatientId AS apId, MIN(pal.CreatedDateTime) AS ts FROM PatientAuditLog pal JOIN s3 ON s3.apId=pal.AllocatePatientId WHERE pal.Type IN ('AssessmentResultGenerated','AssessmentStatusChanged') GROUP BY pal.AllocatePatientId),
        s5ids AS (SELECT DISTINCT pal.AllocatePatientId AS apId FROM PatientAuditLog pal JOIN s3 ON s3.apId=pal.AllocatePatientId WHERE pal.Type='ReportAdded')
        SELECT TOP 50
          LTRIM(RTRIM(ISNULL(pt.FirstName,'')+' '+ISNULL(pt.LastName,''))) AS patientName,
          ISNULL(pt.PatientID,'') AS patientDisplayId, s3.Assessment AS assessmentType,
          LTRIM(RTRIM(ISNULL(au.FirstName,'')+' '+ISNULL(au.LastName,''))) AS responsiblePersonName,
          ISNULL(au.Id,0) AS responsiblePersonId,
          c.CentreName AS centreName,
          DATEDIFF(day, s4.ts, SYSDATETIMEOFFSET()) AS daysWaiting
        FROM s4
        JOIN s3 ON s3.apId=s4.apId
        JOIN Patient pt ON pt.Id=s3.PatientId JOIN Centre c ON c.Id=pt.CentreId
        LEFT JOIN AdminUser au ON au.Id=s3.ClinicianUserId
        WHERE s4.apId NOT IN (SELECT apId FROM s5ids) ${stuckWhere}
        ORDER BY daysWaiting DESC`;
    } else if (stage === 'stage-report-drafted') {
      sql_query = `WITH ${fpCte},
        s3 AS (SELECT ap.Id AS apId, ap.PatientId, ap.Assessment, ap.ClinicianUserId FROM AllocatePatient ap JOIN fp ON fp.PatientId=ap.PatientId WHERE ap.Status NOT IN ('Cancelled')),
        s5 AS (SELECT pal.AllocatePatientId AS apId, MIN(pal.CreatedDateTime) AS ts FROM PatientAuditLog pal JOIN s3 ON s3.apId=pal.AllocatePatientId WHERE pal.Type='ReportAdded' GROUP BY pal.AllocatePatientId),
        s6ids AS (SELECT DISTINCT pal.AllocatePatientId AS apId FROM PatientAuditLog pal JOIN s3 ON s3.apId=pal.AllocatePatientId WHERE pal.Type='ReportPDFGenerated')
        SELECT TOP 50
          LTRIM(RTRIM(ISNULL(pt.FirstName,'')+' '+ISNULL(pt.LastName,''))) AS patientName,
          ISNULL(pt.PatientID,'') AS patientDisplayId, s3.Assessment AS assessmentType,
          LTRIM(RTRIM(ISNULL(au.FirstName,'')+' '+ISNULL(au.LastName,''))) AS responsiblePersonName,
          ISNULL(au.Id,0) AS responsiblePersonId,
          c.CentreName AS centreName,
          DATEDIFF(day, s5.ts, SYSDATETIMEOFFSET()) AS daysWaiting
        FROM s5
        JOIN s3 ON s3.apId=s5.apId
        JOIN Patient pt ON pt.Id=s3.PatientId JOIN Centre c ON c.Id=pt.CentreId
        LEFT JOIN AdminUser au ON au.Id=s3.ClinicianUserId
        WHERE s5.apId NOT IN (SELECT apId FROM s6ids) ${stuckWhere}
        ORDER BY daysWaiting DESC`;
    } else if (stage === 'stage-report-approved') {
      sql_query = `WITH ${fpCte},
        s3 AS (SELECT ap.Id AS apId, ap.PatientId, ap.Assessment, ap.ClinicianUserId FROM AllocatePatient ap JOIN fp ON fp.PatientId=ap.PatientId WHERE ap.Status NOT IN ('Cancelled')),
        s6 AS (SELECT pal.AllocatePatientId AS apId, MIN(pal.CreatedDateTime) AS ts FROM PatientAuditLog pal JOIN s3 ON s3.apId=pal.AllocatePatientId WHERE pal.Type='ReportPDFGenerated' GROUP BY pal.AllocatePatientId),
        s7ids AS (SELECT DISTINCT pal.PatientId FROM PatientAuditLog pal JOIN fp ON fp.PatientId=pal.PatientId WHERE pal.Type='GoalAdded')
        SELECT TOP 50
          LTRIM(RTRIM(ISNULL(pt.FirstName,'')+' '+ISNULL(pt.LastName,''))) AS patientName,
          ISNULL(pt.PatientID,'') AS patientDisplayId, s3.Assessment AS assessmentType,
          LTRIM(RTRIM(ISNULL(au.FirstName,'')+' '+ISNULL(au.LastName,''))) AS responsiblePersonName,
          ISNULL(au.Id,0) AS responsiblePersonId,
          c.CentreName AS centreName,
          DATEDIFF(day, s6.ts, SYSDATETIMEOFFSET()) AS daysWaiting
        FROM s6
        JOIN s3 ON s3.apId=s6.apId
        JOIN Patient pt ON pt.Id=s3.PatientId JOIN Centre c ON c.Id=pt.CentreId
        LEFT JOIN AdminUser au ON au.Id=s3.ClinicianUserId
        WHERE s3.PatientId NOT IN (SELECT PatientId FROM s7ids) ${stuckWhere}
        ORDER BY daysWaiting DESC`;
    } else if (stage === 'stage-goals-added') {
      sql_query = `WITH ${fpCte},
        s7 AS (SELECT pal.PatientId, MIN(pal.CreatedDateTime) AS ts FROM PatientAuditLog pal JOIN fp ON fp.PatientId=pal.PatientId WHERE pal.Type='GoalAdded' GROUP BY pal.PatientId),
        s8ids AS (
          SELECT DISTINCT ap2.PatientId FROM PatientGoalApprovalRequestGoal pgarg
          JOIN PatientGoalApprovalRequest pgar ON pgar.Id=pgarg.PatientGoalApprovalRequestId
          JOIN AllocatePatient ap2 ON ap2.Id=pgar.AllocatePatientId
          JOIN fp ON fp.PatientId=ap2.PatientId WHERE pgarg.Status='Approved'
        )
        SELECT TOP 50
          LTRIM(RTRIM(ISNULL(pt.FirstName,'')+' '+ISNULL(pt.LastName,''))) AS patientName,
          ISNULL(pt.PatientID,'') AS patientDisplayId, NULL AS assessmentType,
          NULL AS responsiblePersonName, NULL AS responsiblePersonId,
          c.CentreName AS centreName,
          DATEDIFF(day, s7.ts, SYSDATETIMEOFFSET()) AS daysWaiting
        FROM s7
        JOIN Patient pt ON pt.Id=s7.PatientId JOIN Centre c ON c.Id=pt.CentreId
        WHERE s7.PatientId NOT IN (SELECT PatientId FROM s8ids) ${stuckWhere}
        ORDER BY daysWaiting DESC`;
    } else {
      return res.json({ cases: [] });
    }

    const result = await pool.request()
      .input('centreId', sql.BigInt, centreId)
      .input('dateFrom', sql.DateTimeOffset, dateFrom)
      .input('dateTo',   sql.DateTimeOffset, dateTo)
      .query(sql_query);

    const cases = result.recordset.map((r) => ({
      patientName:           (r.patientName || '').trim() || null,
      patientDisplayId:      r.patientDisplayId || null,
      assessmentType:        r.assessmentType || null,
      responsiblePersonName: (r.responsiblePersonName || '').trim() || null,
      responsiblePersonId:   r.responsiblePersonId ?? 0,
      centreName:            r.centreName ? abbreviateCentre(r.centreName) : null,
      daysWaiting:           r.daysWaiting ?? 0,
    }));

    res.json({ cases });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/overview/report-pdfs
 * Query params: centreId (optional), dateFrom, dateTo (optional)
 *
 * Returns every ReportPDFGenerated event in the period, grouped by centre.
 * Each record includes: assessment type, clinician who performed it,
 * and the user who generated/approved the PDF.
 */
router.get('/report-pdfs', async (req, res, next) => {
  try {
    const centreId = req.query.centreId ? parseInt(req.query.centreId, 10) : null;
    const dateFrom = parseDateParam(req.query.dateFrom);
    const dateTo   = parseDateParam(req.query.dateTo);

    if (req.query.centreId && isNaN(centreId)) {
      return res.status(400).json({ error: 'centreId must be a number' });
    }

    const pool     = await poolPromise;
    const dateFilter     = buildDateFilter('pal.CreatedDateTime', '@dateFrom', '@dateTo');
    const centreFilter   = '(@centreId IS NULL OR c.Id = @centreId)';
    const centreExclusion = `LOWER(c.CentreName) NOT LIKE '%test%'
                         AND LOWER(c.CentreName) NOT LIKE '%delete%'`;
    const patientExclusion = buildPatientExclusion('pt');

    const result = await pool.request()
      .input('centreId', sql.BigInt, centreId)
      .input('dateFrom', sql.DateTimeOffset, dateFrom)
      .input('dateTo',   sql.DateTimeOffset, dateTo)
      .query(`
        SELECT
          c.Id   AS centreId,
          c.CentreName,
          pal.AllocatePatientId AS allocatePatientId,
          ISNULL(ap.Assessment, 'Unknown') AS assessmentType,
          ap.PatientId AS patientId,
          LTRIM(RTRIM(CONCAT(
            ISNULL(pt.FirstName, ''), ' ', ISNULL(pt.LastName, '')
          ))) AS patientName,
          LTRIM(RTRIM(CONCAT(
            ISNULL(au_clin.FirstName, ''), ' ', ISNULL(au_clin.LastName, '')
          ))) AS clinicianName,
          LTRIM(RTRIM(CONCAT(
            ISNULL(au_actor.FirstName, ''), ' ', ISNULL(au_actor.LastName, '')
          ))) AS actorName,
          pal.Type          AS eventType,
          pal.CreatedDateTime AS eventAt
        FROM PatientAuditLog pal
        JOIN AllocatePatient ap ON ap.Id = pal.AllocatePatientId
        JOIN Patient pt         ON pt.Id = ap.PatientId
        JOIN Centre c           ON c.Id  = pt.CentreId
        LEFT JOIN AdminUser au_clin  ON au_clin.Id  = ap.ClinicianUserId
        LEFT JOIN AdminUser au_actor ON au_actor.Id = pal.AdminUserId
        WHERE pal.Type IN ('ReportPDFGenerated', 'ReportAdded')
          AND pal.AllocatePatientId IS NOT NULL
          AND ${centreFilter}
          AND ${centreExclusion}
          AND ${patientExclusion}
          AND ${dateFilter}
        ORDER BY c.CentreName, pal.Type, pt.LastName, pt.FirstName, pal.CreatedDateTime DESC
      `);

    // Group records by centre, splitting into pdfs and drafts
    const centreMap = new Map();
    for (const row of result.recordset) {
      const key = row.centreId;
      if (!centreMap.has(key)) {
        centreMap.set(key, {
          centreId:   row.centreId,
          centreName: abbreviateCentre(row.CentreName),
          pdfs:   [],
          drafts: [],
        });
      }
      const entry = centreMap.get(key);
      const record = {
        allocatePatientId: row.allocatePatientId,
        assessmentType:    row.assessmentType || 'Unknown',
        patientId:         row.patientId,
        patientName:       row.patientName || null,
        clinicianName:     row.clinicianName || null,
        actorName:         row.actorName || null,
        eventAt:           row.eventAt ? new Date(row.eventAt).toISOString() : null,
      };
      if (row.eventType === 'ReportPDFGenerated') {
        entry.pdfs.push(record);
      } else {
        entry.drafts.push(record);
      }
    }

    // Sort records within each centre by patient name so multiple assessments per case appear together
    const byName = (a, b) => (a.patientName || '').localeCompare(b.patientName || '');
    for (const entry of centreMap.values()) {
      entry.pdfs.sort(byName);
      entry.drafts.sort(byName);
    }

    // Sort centres: most PDFs first, then by draft count
    const centres = Array.from(centreMap.values())
      .sort((a, b) => b.pdfs.length - a.pdfs.length || b.drafts.length - a.drafts.length);

    res.json(centres);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
