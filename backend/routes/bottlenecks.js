'use strict';

const { Router } = require('express');
const { sql, poolPromise } = require('../db');
const { parseDateParam, buildDateFilter, buildCentreExclusion } = require('../lib/queryHelpers');
const { buildClinicalPipelineQuery, mapPipelineRow } = require('../lib/clinicalPipelineQueries');

const router = Router();

router.use('/drill-down', require('./bottleneckDrillDown'));

/**
 * GET /api/bottlenecks
 * Query params: centreId (optional), dateFrom (optional), dateTo (optional)
 *
 * Returns operational bottleneck metrics with per-centre breakdown and funnel stages.
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

    const centreJoin = `
      LEFT JOIN Patient pt  ON pt.Id = pal.PatientId
      LEFT JOIN Centre c    ON c.Id  = pt.CentreId
    `;
    const centreFilter = '(@centreId IS NULL OR c.Id = @centreId)';
    const centreExclusion = buildCentreExclusion('c');
    const dateFilterPal = buildDateFilter('pal.CreatedDateTime', '@dateFrom', '@dateTo');

    const goalCentreJoin = `
      JOIN PatientGoalApprovalRequest pgar ON pgar.Id = pgarg.PatientGoalApprovalRequestId
      JOIN AllocatePatient ap ON ap.Id = pgar.AllocatePatientId
      JOIN Patient pt ON pt.Id = ap.PatientId
      JOIN Centre c ON c.Id = pt.CentreId
    `;
    const goalCentreFilter = '(@centreId IS NULL OR c.Id = @centreId)';
    const goalCentreExclusion = buildCentreExclusion('c');
    const goalDateFilter = buildDateFilter('pgarg.UpdatedDateTimeUtc', '@dateFrom', '@dateTo');

    function bindAll(req) {
      return req
        .input('centreId', sql.BigInt, centreId)
        .input('dateFrom', sql.DateTimeOffset, dateFrom)
        .input('dateTo',   sql.DateTimeOffset, dateTo);
    }

    const [
      onboardingResult,
      stuckResult,
      pendingGoalsResult,
      goalApprovalResult,
      assessmentResult,
      resetTransferResult,
      pendingAssessmentsResult,
      funnelResult,
      byCentreResult,
      weeklyOnboardingResult,
      weeklyGoalResult,
    ] = await Promise.all([

      // Q1: avg onboarding turnaround (CaseRegistered → first CaseAssigned) in hours
      bindAll(pool.request()).query(`
        WITH reg AS (
          SELECT pal.PatientId, MIN(pal.CreatedDateTime) AS registeredAt
          FROM PatientAuditLog pal
          ${centreJoin}
          WHERE pal.Type = 'CaseRegistered'
            AND ${centreFilter}
            AND ${centreExclusion}
            AND ${dateFilterPal}
          GROUP BY pal.PatientId
        ),
        asgn AS (
          SELECT pal.PatientId, MIN(pal.CreatedDateTime) AS assignedAt
          FROM PatientAuditLog pal
          ${centreJoin}
          WHERE pal.Type = 'CaseAssigned'
            AND ${centreFilter}
            AND ${centreExclusion}
            AND ${dateFilterPal}
          GROUP BY pal.PatientId
        )
        SELECT AVG(CAST(DATEDIFF(minute, r.registeredAt, a.assignedAt) AS FLOAT) / 60.0) AS avgHours
        FROM reg r
        JOIN asgn a ON a.PatientId = r.PatientId
        WHERE a.assignedAt > r.registeredAt
      `),

      // Q2: cases stuck in onboarding (registered > 48 h ago, never assigned)
      bindAll(pool.request()).query(`
        WITH reg AS (
          SELECT pal.PatientId, MIN(pal.CreatedDateTime) AS registeredAt
          FROM PatientAuditLog pal
          ${centreJoin}
          WHERE pal.Type = 'CaseRegistered'
            AND ${centreFilter}
            AND ${centreExclusion}
            AND ${dateFilterPal}
          GROUP BY pal.PatientId
        )
        SELECT COUNT(*) AS stuckCount
        FROM reg
        WHERE registeredAt < DATEADD(hour, -48, SYSDATETIMEOFFSET())
          AND NOT EXISTS (
            SELECT 1
            FROM PatientAuditLog p2
            WHERE p2.PatientId = reg.PatientId
              AND p2.Type = 'CaseAssigned'
          )
      `),

      // Q3: pending goal approvals (not approved or rejected) — centre filter only
      bindAll(pool.request()).query(`
        SELECT COUNT(*) AS pendingCount
        FROM PatientGoalApprovalRequestGoal pgarg
        ${goalCentreJoin}
        WHERE pgarg.Status NOT IN ('Approved', 'Rejected')
          AND ${goalCentreFilter}
          AND ${goalCentreExclusion}
      `),

      // Q4: avg goal approval turnaround in hours (approved goals only)
      bindAll(pool.request()).query(`
        SELECT AVG(
          CAST(DATEDIFF(minute, pgar.CreatedDateTimeUtc, pgarg.UpdatedDateTimeUtc) AS FLOAT) / 60.0
        ) AS avgHours
        FROM PatientGoalApprovalRequestGoal pgarg
        ${goalCentreJoin}
        WHERE pgarg.Status = 'Approved'
          AND pgarg.UpdatedDateTimeUtc > pgar.CreatedDateTimeUtc
          AND ${goalCentreFilter}
          AND ${goalCentreExclusion}
          AND ${goalDateFilter}
      `),

      // Q5: assessment completion rate from AllocatePatient
      bindAll(pool.request()).query(`
        SELECT
          COUNT(*)                                                        AS total,
          SUM(CASE WHEN ap.IsResultGenerate = 1 THEN 1 ELSE 0 END)       AS completed
        FROM AllocatePatient ap
        LEFT JOIN Patient pt ON pt.Id = ap.PatientId
        LEFT JOIN Centre c   ON c.Id  = pt.CentreId
        WHERE (@centreId IS NULL OR c.Id = @centreId)
          AND (@centreId IS NOT NULL OR (
            LOWER(c.CentreName) NOT LIKE '%test%'
            AND LOWER(c.CentreName) NOT LIKE '%delete%'
          ))
          AND (
            @dateFrom IS NULL OR ap.CreatedDateTimeUtc >= @dateFrom
          )
          AND (
            @dateTo IS NULL OR ap.CreatedDateTimeUtc <= @dateTo
          )
      `),

      // Q6: transfer and status-change counts from PatientAuditLog
      bindAll(pool.request()).query(`
        SELECT pal.Type, COUNT(*) AS cnt
        FROM PatientAuditLog pal
        ${centreJoin}
        WHERE pal.Type IN ('CaseTransfer', 'CaseStatusChanged')
          AND ${centreFilter}
          AND ${centreExclusion}
          AND ${dateFilterPal}
        GROUP BY pal.Type
      `),

      // Q7: incomplete assessments (allocated but no result yet) — centre filter only
      bindAll(pool.request()).query(`
        SELECT COUNT(*) AS pendingCount
        FROM AllocatePatient ap
        JOIN Patient pt ON pt.Id = ap.PatientId
        JOIN Centre c   ON c.Id  = pt.CentreId
        WHERE ap.IsResultGenerate = 0
          AND (@centreId IS NULL OR c.Id = @centreId)
          AND (@centreId IS NOT NULL OR (
            LOWER(c.CentreName) NOT LIKE '%test%'
            AND LOWER(c.CentreName) NOT LIKE '%delete%'
          ))
      `),

      // Q8: assessment-level clinical pipeline funnel
      bindAll(pool.request()).query(buildClinicalPipelineQuery()),

      // Q9: per-centre bottleneck breakdown
      bindAll(pool.request()).query(`
        WITH centre_list AS (
          SELECT c.Id AS centreId, c.CentreName
          FROM Centre c
          WHERE LOWER(c.CentreName) NOT LIKE '%test%'
            AND LOWER(c.CentreName) NOT LIKE '%delete%'
            AND (@centreId IS NULL OR c.Id = @centreId)
        ),
        stuck AS (
          SELECT reg.centreId, COUNT(*) AS stuckOnboarding
          FROM (
            SELECT pal.PatientId, c.Id AS centreId, MIN(pal.CreatedDateTime) AS registeredAt
            FROM PatientAuditLog pal
            ${centreJoin}
            WHERE pal.Type = 'CaseRegistered'
              AND ${centreFilter}
              AND ${centreExclusion}
              AND ${dateFilterPal}
            GROUP BY pal.PatientId, c.Id
          ) reg
          WHERE reg.registeredAt < DATEADD(hour, -48, SYSDATETIMEOFFSET())
            AND NOT EXISTS (
              SELECT 1 FROM PatientAuditLog p2
              WHERE p2.PatientId = reg.PatientId AND p2.Type = 'CaseAssigned'
            )
          GROUP BY reg.centreId
        ),
        pending_goals AS (
          SELECT c.Id AS centreId, COUNT(*) AS pendingGoals
          FROM PatientGoalApprovalRequestGoal pgarg
          ${goalCentreJoin}
          WHERE pgarg.Status NOT IN ('Approved', 'Rejected')
            AND ${goalCentreFilter}
            AND ${goalCentreExclusion}
          GROUP BY c.Id
        ),
        incomplete AS (
          SELECT c.Id AS centreId, COUNT(*) AS incompleteAssessments
          FROM AllocatePatient ap
          JOIN Patient pt ON pt.Id = ap.PatientId
          JOIN Centre c ON c.Id = pt.CentreId
          WHERE ap.IsResultGenerate = 0
            AND (@centreId IS NULL OR c.Id = @centreId)
          GROUP BY c.Id
        )
        SELECT
          cl.centreId,
          cl.CentreName AS centreName,
          ISNULL(s.stuckOnboarding, 0)        AS stuckOnboarding,
          ISNULL(pg.pendingGoals, 0)          AS pendingGoals,
          ISNULL(ia.incompleteAssessments, 0) AS incompleteAssessments
        FROM centre_list cl
        LEFT JOIN stuck s ON s.centreId = cl.centreId
        LEFT JOIN pending_goals pg ON pg.centreId = cl.centreId
        LEFT JOIN incomplete ia ON ia.centreId = cl.centreId
        ORDER BY
          ISNULL(s.stuckOnboarding, 0) + ISNULL(pg.pendingGoals, 0) + ISNULL(ia.incompleteAssessments, 0) DESC,
          cl.CentreName
      `),

      // Q11: weekly onboarding turnaround trend
      bindAll(pool.request()).query(`
        WITH reg AS (
          SELECT pal.PatientId, MIN(pal.CreatedDateTime) AS registeredAt
          FROM PatientAuditLog pal
          ${centreJoin}
          WHERE pal.Type = 'CaseRegistered'
            AND ${centreFilter}
            AND ${centreExclusion}
            AND ${dateFilterPal}
          GROUP BY pal.PatientId
        ),
        asgn AS (
          SELECT pal.PatientId, MIN(pal.CreatedDateTime) AS assignedAt
          FROM PatientAuditLog pal
          ${centreJoin}
          WHERE pal.Type = 'CaseAssigned'
            AND ${centreFilter}
            AND ${centreExclusion}
          GROUP BY pal.PatientId
        ),
        pairs AS (
          SELECT
            r.registeredAt,
            CAST(DATEDIFF(minute, r.registeredAt, a.assignedAt) AS FLOAT) / 60.0 AS hours
          FROM reg r
          JOIN asgn a ON a.PatientId = r.PatientId
          WHERE a.assignedAt > r.registeredAt
        )
        SELECT
          MIN(CAST(registeredAt AS date)) AS weekStart,
          AVG(hours) AS avgHours,
          COUNT(*) AS cnt
        FROM pairs
        GROUP BY DATEPART(year, registeredAt), DATEPART(week, registeredAt)
        ORDER BY MIN(CAST(registeredAt AS date)) DESC
      `),

      // Q12: weekly goal approval turnaround trend
      bindAll(pool.request()).query(`
        SELECT
          MIN(CAST(pgarg.UpdatedDateTimeUtc AS date)) AS weekStart,
          AVG(
            CAST(DATEDIFF(minute, pgar.CreatedDateTimeUtc, pgarg.UpdatedDateTimeUtc) AS FLOAT) / 60.0
          ) AS avgHours,
          COUNT(*) AS cnt
        FROM PatientGoalApprovalRequestGoal pgarg
        ${goalCentreJoin}
        WHERE pgarg.Status = 'Approved'
          AND pgarg.UpdatedDateTimeUtc > pgar.CreatedDateTimeUtc
          AND ${goalCentreFilter}
          AND ${goalCentreExclusion}
          AND ${goalDateFilter}
        GROUP BY DATEPART(year, pgarg.UpdatedDateTimeUtc), DATEPART(week, pgarg.UpdatedDateTimeUtc)
        ORDER BY MIN(CAST(pgarg.UpdatedDateTimeUtc AS date)) DESC
      `),
    ]);

    const avgOnboardingHours = onboardingResult.recordset[0]?.avgHours ?? null;
    const casesStuckInOnboarding = stuckResult.recordset[0]?.stuckCount ?? 0;
    const pendingGoalApprovals = pendingGoalsResult.recordset[0]?.pendingCount ?? 0;
    const avgGoalApprovalHours = goalApprovalResult.recordset[0]?.avgHours ?? null;
    const pendingAssessments = pendingAssessmentsResult.recordset[0]?.pendingCount ?? 0;

    const { total = 0, completed = 0 } = assessmentResult.recordset[0] || {};
    const assessmentCompletionRate = total > 0
      ? parseFloat(((completed / total) * 100).toFixed(2))
      : 0;

    const rtMap = {};
    for (const row of resetTransferResult.recordset) {
      rtMap[row.Type] = row.cnt;
    }

    const pipeline = mapPipelineRow(funnelResult.recordset[0] || {});

    const weekMap = new Map();
    const formatWeekKey = (value) => {
      if (!value) return null;
      if (typeof value === 'string') return value.slice(0, 10);
      const d = new Date(value);
      return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
    };
    for (const row of weeklyOnboardingResult.recordset) {
      const key = formatWeekKey(row.weekStart);
      if (!key) continue;
      weekMap.set(key, {
        weekStart: key,
        avgOnboardingHours: row.avgHours != null ? parseFloat(Number(row.avgHours).toFixed(2)) : null,
        onboardingCount: row.cnt ?? 0,
        avgGoalApprovalHours: null,
        goalApprovalCount: 0,
      });
    }
    for (const row of weeklyGoalResult.recordset) {
      const key = formatWeekKey(row.weekStart);
      if (!key) continue;
      const existing = weekMap.get(key) ?? {
        weekStart: key,
        avgOnboardingHours: null,
        onboardingCount: 0,
        avgGoalApprovalHours: null,
        goalApprovalCount: 0,
      };
      existing.avgGoalApprovalHours = row.avgHours != null ? parseFloat(Number(row.avgHours).toFixed(2)) : null;
      existing.goalApprovalCount = row.cnt ?? 0;
      weekMap.set(key, existing);
    }
    const weeklyTrend = [...weekMap.values()]
      .sort((a, b) => a.weekStart.localeCompare(b.weekStart))
      .slice(-8);

    res.json({
      avgOnboardingHours: avgOnboardingHours !== null ? parseFloat(avgOnboardingHours.toFixed(2)) : null,
      avgGoalApprovalHours: avgGoalApprovalHours !== null ? parseFloat(avgGoalApprovalHours.toFixed(2)) : null,
      casesStuckInOnboarding,
      pendingGoalApprovals,
      pendingAssessments,
      assessmentCompletionRate,
      transferCount: rtMap['CaseTransfer'] || 0,
      statusChangeCount: rtMap['CaseStatusChanged'] || 0,
      funnel: {
        registered: pipeline.registered,
        assigned: pipeline.assigned,
        scoringComplete: pipeline.scoringComplete,
        reportPdfCreated: pipeline.reportPdfCreated,
        reportShared: pipeline.reportShared,
        goalsAdded: pipeline.goalsAdded,
        goalsApproved: pipeline.goalsApproved,
        // Legacy field — PDF reports created (assessment-level)
        results: pipeline.reportPdfCreated,
      },
      byCentre: byCentreResult.recordset.map((r) => ({
        centreId: r.centreId,
        centreName: r.centreName,
        stuckOnboarding: r.stuckOnboarding,
        pendingGoals: r.pendingGoals,
        incompleteAssessments: r.incompleteAssessments,
      })),
      weeklyTrend,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
