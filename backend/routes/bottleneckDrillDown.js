'use strict';

const { Router } = require('express');
const { sql, poolPromise } = require('../db');
const { parseDateParam, buildDateFilter } = require('../lib/queryHelpers');
const { labelAuditEvent } = require('../lib/auditEventLabels');
const {
  pipelineAuditDetailExpr,
  caseRegisteredDetailExpr,
  pipelineReportSharedDetailExpr,
  pipelineGoalsAddedDetailExpr,
  pipelineGoalsApprovedDetailExpr,
} = require('../lib/pipelineDetailExprs');

const router = Router();

const VALID_TYPES = new Set([
  'stuck-onboarding',
  'pending-goals',
  'incomplete-assessments',
  'all-actions',
  'slow-onboarding',
  'slow-goal-approval',
  'status-changes',
  'transfers',
  'funnel-registered',
  'funnel-assigned',
  'funnel-scoring',
  'funnel-report-pdf',
  'funnel-report-shared',
  'funnel-goals-added',
  'funnel-results',
  'funnel-goals-approved',
  'weekly-onboarding',
  'weekly-goal-approval',
  'centre-severity',
]);

const TYPE_LABELS = {
  'stuck-onboarding': 'Cases stuck in onboarding (>48h)',
  'pending-goals': 'Pending goal approvals',
  'incomplete-assessments': 'Incomplete assessments',
  'all-actions': 'All action items',
  'slow-onboarding': 'Slow onboarding (>24h to assign)',
  'slow-goal-approval': 'Slow or pending goal approvals (>48h)',
  'status-changes': 'Case status changes',
  'transfers': 'Case transfers',
  'funnel-registered': 'Cases registered',
  'funnel-assigned': 'Assessments assigned',
  'funnel-scoring': 'Scoring complete',
  'funnel-report-pdf': 'Report PDF created',
  'funnel-report-shared': 'Report shared with family',
  'funnel-goals-added': 'Goals added',
  'funnel-results': 'Report PDF created',
  'funnel-goals-approved': 'Goals approved',
  'weekly-onboarding': 'Onboarding cases this week',
  'weekly-goal-approval': 'Goal approvals this week',
  'centre-severity': 'Centre action items',
};

const MAX_ITEMS = 500;

function mapPatientRow(row) {
  return {
    category: row.category ?? null,
    patientId: row.patientId,
    patientCode: row.patientCode ?? null,
    patientName: (row.patientName ?? '').trim() || 'Unknown',
    centreId: row.centreId,
    centreName: row.centreName ?? '',
    eventAt: row.eventAt ? new Date(row.eventAt).toISOString() : null,
    waitingHours: row.waitingHours != null ? parseFloat(Number(row.waitingHours).toFixed(1)) : null,
    status: row.status ?? null,
    detail: row.detail ?? null,
  };
}

function formatDateKey(value) {
  if (!value) return null;
  if (typeof value === 'string') return value.slice(0, 10);
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function buildFilterContext(req) {
  const centreId = req.query.centreId ? parseInt(req.query.centreId, 10) : null;
  const dateFrom = parseDateParam(req.query.dateFrom);
  const dateTo = parseDateParam(req.query.dateTo);
  const drillCentreId = req.query.drillCentreId
    ? parseInt(req.query.drillCentreId, 10)
    : null;
  const weekStart = parseDateParam(req.query.weekStart);
  const weekEnd = parseDateParam(req.query.weekEnd);
  const severity = req.query.severity === 'critical' || req.query.severity === 'watch'
    ? req.query.severity
    : null;

  if (req.query.centreId && isNaN(centreId)) {
    const err = new Error('centreId must be a number');
    err.status = 400;
    throw err;
  }
  if (req.query.drillCentreId && isNaN(drillCentreId)) {
    const err = new Error('drillCentreId must be a number');
    err.status = 400;
    throw err;
  }
  if (req.query.dateFrom && !dateFrom) {
    const err = new Error('dateFrom must be a valid ISO date');
    err.status = 400;
    throw err;
  }
  if (req.query.dateTo && !dateTo) {
    const err = new Error('dateTo must be a valid ISO date');
    err.status = 400;
    throw err;
  }
  if (req.query.weekStart && !weekStart) {
    const err = new Error('weekStart must be a valid ISO date');
    err.status = 400;
    throw err;
  }
  if (req.query.weekEnd && !weekEnd) {
    const err = new Error('weekEnd must be a valid ISO date');
    err.status = 400;
    throw err;
  }
  if (req.query.severity && !severity) {
    const err = new Error('severity must be critical or watch');
    err.status = 400;
    throw err;
  }

  const effectiveCentreId = drillCentreId ?? centreId;

  const centreJoin = `
    LEFT JOIN Patient pt ON pt.Id = pal.PatientId
    LEFT JOIN Centre c ON c.Id = pt.CentreId
  `;
  const centreFilter = '(@centreId IS NULL OR c.Id = @centreId)';
  const centreExclusion = `(@centreId IS NOT NULL OR (
    LOWER(c.CentreName) NOT LIKE '%test%'
    AND LOWER(c.CentreName) NOT LIKE '%delete%'
  ))`;
  const dateFilterPal = buildDateFilter('pal.CreatedDateTime', '@dateFrom', '@dateTo');

  const goalCentreJoin = `
    JOIN PatientGoalApprovalRequest pgar ON pgar.Id = pgarg.PatientGoalApprovalRequestId
    JOIN AllocatePatient ap ON ap.Id = pgar.AllocatePatientId
    JOIN Patient pt ON pt.Id = ap.PatientId
    JOIN Centre c ON c.Id = pt.CentreId
  `;
  const goalCentreFilter = '(@centreId IS NULL OR c.Id = @centreId)';
  const goalCentreExclusion = `(@centreId IS NOT NULL OR (
    LOWER(c.CentreName) NOT LIKE '%test%'
    AND LOWER(c.CentreName) NOT LIKE '%delete%'
  ))`;
  const goalDateFilter = buildDateFilter('pgarg.UpdatedDateTimeUtc', '@dateFrom', '@dateTo');

  function bindAll(request) {
    return request
      .input('centreId', sql.BigInt, effectiveCentreId)
      .input('dateFrom', sql.DateTimeOffset, dateFrom)
      .input('dateTo', sql.DateTimeOffset, dateTo)
      .input('weekStart', sql.DateTimeOffset, weekStart)
      .input('weekEnd', sql.DateTimeOffset, weekEnd);
  }

  const patientNameExpr = `LTRIM(RTRIM(CONCAT(ISNULL(pt.FirstName, ''), ' ', ISNULL(pt.LastName, ''))))`;

  return {
    effectiveCentreId,
    severity,
    weekStart,
    weekEnd,
    centreJoin,
    centreFilter,
    centreExclusion,
    dateFilterPal,
    goalCentreJoin,
    goalCentreFilter,
    goalCentreExclusion,
    goalDateFilter,
    bindAll,
    patientNameExpr,
  };
}

async function queryStuckOnboarding(ctx) {
  const { bindAll, centreJoin, centreFilter, centreExclusion, dateFilterPal, patientNameExpr } = ctx;
  const pool = await poolPromise;
  const result = await bindAll(pool.request()).query(`
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
    SELECT TOP (${MAX_ITEMS})
      'Stuck in onboarding' AS category,
      pt.Id AS patientId,
      pt.PatientID AS patientCode,
      ${patientNameExpr} AS patientName,
      c.Id AS centreId,
      c.CentreName AS centreName,
      reg.registeredAt AS eventAt,
      CAST(DATEDIFF(minute, reg.registeredAt, SYSDATETIMEOFFSET()) AS FLOAT) / 60.0 AS waitingHours,
      'Unassigned' AS status,
      'Registered but never assigned to a clinician' AS detail
    FROM reg
    JOIN Patient pt ON pt.Id = reg.PatientId
    JOIN Centre c ON c.Id = pt.CentreId
    WHERE reg.registeredAt < DATEADD(hour, -48, SYSDATETIMEOFFSET())
      AND NOT EXISTS (
        SELECT 1 FROM PatientAuditLog p2
        WHERE p2.PatientId = reg.PatientId AND p2.Type = 'CaseAssigned'
      )
    ORDER BY reg.registeredAt ASC
  `);
  return result.recordset.map(mapPatientRow);
}

async function queryPendingGoals(ctx) {
  const { bindAll, goalCentreJoin, goalCentreFilter, goalCentreExclusion, patientNameExpr } = ctx;
  const pool = await poolPromise;
  const result = await bindAll(pool.request()).query(`
    SELECT TOP (${MAX_ITEMS})
      'Pending goal approval' AS category,
      pt.Id AS patientId,
      pt.PatientID AS patientCode,
      ${patientNameExpr} AS patientName,
      c.Id AS centreId,
      c.CentreName AS centreName,
      pgar.CreatedDateTimeUtc AS eventAt,
      CAST(DATEDIFF(minute, pgar.CreatedDateTimeUtc, SYSDATETIMEOFFSET()) AS FLOAT) / 60.0 AS waitingHours,
      pgarg.Status AS status,
      pgar.RequestId AS detail
    FROM PatientGoalApprovalRequestGoal pgarg
    ${goalCentreJoin}
    WHERE pgarg.Status NOT IN ('Approved', 'Rejected')
      AND ${goalCentreFilter}
      AND ${goalCentreExclusion}
    ORDER BY pgar.CreatedDateTimeUtc ASC
  `);
  return result.recordset.map(mapPatientRow);
}

async function queryIncompleteAssessments(ctx) {
  const { bindAll, patientNameExpr } = ctx;
  const pool = await poolPromise;
  const result = await bindAll(pool.request()).query(`
    SELECT TOP (${MAX_ITEMS})
      'Incomplete assessment' AS category,
      pt.Id AS patientId,
      pt.PatientID AS patientCode,
      ${patientNameExpr} AS patientName,
      c.Id AS centreId,
      c.CentreName AS centreName,
      ap.CreatedDateTimeUtc AS eventAt,
      CAST(DATEDIFF(minute, ap.CreatedDateTimeUtc, SYSDATETIMEOFFSET()) AS FLOAT) / 60.0 AS waitingHours,
      ap.Status AS status,
      CONCAT(
        ISNULL(ap.Assessment, 'Assessment'),
        CASE
          WHEN au.FirstName IS NOT NULL
          THEN CONCAT(' · Clinician: ', au.FirstName, ' ', ISNULL(au.LastName, ''))
          ELSE ''
        END
      ) AS detail
    FROM AllocatePatient ap
    JOIN Patient pt ON pt.Id = ap.PatientId
    JOIN Centre c ON c.Id = pt.CentreId
    LEFT JOIN AdminUser au ON au.Id = ap.ClinicianUserId
    WHERE ap.IsResultGenerate = 0
      AND (@centreId IS NULL OR c.Id = @centreId)
      AND (@centreId IS NOT NULL OR (
        LOWER(c.CentreName) NOT LIKE '%test%'
        AND LOWER(c.CentreName) NOT LIKE '%delete%'
      ))
    ORDER BY ap.CreatedDateTimeUtc ASC
  `);
  return result.recordset.map(mapPatientRow);
}

async function querySlowOnboarding(ctx) {
  const { bindAll, centreJoin, centreFilter, centreExclusion, dateFilterPal, patientNameExpr } = ctx;
  const pool = await poolPromise;
  const result = await bindAll(pool.request()).query(`
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
    )
    SELECT TOP (${MAX_ITEMS})
      'Slow onboarding' AS category,
      pt.Id AS patientId,
      pt.PatientID AS patientCode,
      ${patientNameExpr} AS patientName,
      c.Id AS centreId,
      c.CentreName AS centreName,
      r.registeredAt AS eventAt,
      CAST(DATEDIFF(minute, r.registeredAt, a.assignedAt) AS FLOAT) / 60.0 AS waitingHours,
      'Assigned' AS status,
      'Registration to assignment exceeded 24h' AS detail
    FROM reg r
    JOIN asgn a ON a.PatientId = r.PatientId
    JOIN Patient pt ON pt.Id = r.PatientId
    JOIN Centre c ON c.Id = pt.CentreId
    WHERE a.assignedAt > r.registeredAt
      AND DATEDIFF(minute, r.registeredAt, a.assignedAt) > 1440
    ORDER BY waitingHours DESC
  `);
  return result.recordset.map(mapPatientRow);
}

async function querySlowGoalApproval(ctx) {
  const { bindAll, goalCentreJoin, goalCentreFilter, goalCentreExclusion, goalDateFilter, patientNameExpr } = ctx;
  const pool = await poolPromise;
  const result = await bindAll(pool.request()).query(`
    SELECT TOP (${MAX_ITEMS})
      CASE
        WHEN pgarg.Status = 'Approved' THEN 'Slow goal approval'
        ELSE 'Pending goal approval'
      END AS category,
      pt.Id AS patientId,
      pt.PatientID AS patientCode,
      ${patientNameExpr} AS patientName,
      c.Id AS centreId,
      c.CentreName AS centreName,
      pgar.CreatedDateTimeUtc AS eventAt,
      CAST(DATEDIFF(
        minute,
        pgar.CreatedDateTimeUtc,
        CASE WHEN pgarg.Status = 'Approved' THEN pgarg.UpdatedDateTimeUtc ELSE SYSDATETIMEOFFSET() END
      ) AS FLOAT) / 60.0 AS waitingHours,
      pgarg.Status AS status,
      pgar.RequestId AS detail
    FROM PatientGoalApprovalRequestGoal pgarg
    ${goalCentreJoin}
    WHERE ${goalCentreFilter}
      AND ${goalCentreExclusion}
      AND (
        (
          pgarg.Status = 'Approved'
          AND pgarg.UpdatedDateTimeUtc > pgar.CreatedDateTimeUtc
          AND DATEDIFF(minute, pgar.CreatedDateTimeUtc, pgarg.UpdatedDateTimeUtc) > 2880
          AND ${goalDateFilter}
        )
        OR (
          pgarg.Status NOT IN ('Approved', 'Rejected')
          AND DATEDIFF(minute, pgar.CreatedDateTimeUtc, SYSDATETIMEOFFSET()) > 2880
        )
      )
    ORDER BY waitingHours DESC
  `);
  return result.recordset.map(mapPatientRow);
}

async function queryAuditEvents(ctx, auditType, categoryLabel) {
  const { bindAll, centreJoin, centreFilter, centreExclusion, dateFilterPal, patientNameExpr } = ctx;
  const pool = await poolPromise;
  const result = await bindAll(pool.request()).query(`
    SELECT TOP (${MAX_ITEMS})
      '${categoryLabel}' AS category,
      pt.Id AS patientId,
      pt.PatientID AS patientCode,
      ${patientNameExpr} AS patientName,
      c.Id AS centreId,
      c.CentreName AS centreName,
      pal.CreatedDateTime AS eventAt,
      NULL AS waitingHours,
      pal.Type AS status,
      pal.Description AS detail
    FROM PatientAuditLog pal
    ${centreJoin}
    WHERE pal.Type = '${auditType}'
      AND ${centreFilter}
      AND ${centreExclusion}
      AND ${dateFilterPal}
    ORDER BY pal.CreatedDateTime DESC
  `);
  return result.recordset.map((row) => mapPatientRow({
    ...row,
    status: labelAuditEvent(row.status),
  }));
}

async function queryFunnelStage(ctx, auditType, categoryLabel, statusLabel) {
  const { bindAll, centreJoin, centreFilter, centreExclusion, dateFilterPal, patientNameExpr } = ctx;
  const pool = await poolPromise;

  if (auditType === 'CaseRegistered') {
    const result = await bindAll(pool.request()).query(`
      SELECT TOP (${MAX_ITEMS})
        '${categoryLabel}' AS category,
        pt.Id AS patientId,
        pt.PatientID AS patientCode,
        ${patientNameExpr} AS patientName,
        c.Id AS centreId,
        c.CentreName AS centreName,
        MIN(pal.CreatedDateTime) AS eventAt,
        NULL AS waitingHours,
        '${statusLabel}' AS status,
        ${caseRegisteredDetailExpr()} AS detail
      FROM PatientAuditLog pal
      ${centreJoin}
      WHERE pal.Type = '${auditType}'
        AND ${centreFilter}
        AND ${centreExclusion}
        AND ${dateFilterPal}
      GROUP BY pt.Id, pt.PatientID, pt.FirstName, pt.LastName, c.Id, c.CentreName
      ORDER BY eventAt DESC
    `);
    return result.recordset.map(mapPatientRow);
  }

  const actionLabels = {
    CaseAssigned: 'Assigned by',
    AssessmentResultGenerated: 'Scored by',
    ReportPDFGenerated: 'Approved by',
  };
  const actionLabel = actionLabels[auditType] || 'By';
  const detailExpr = pipelineAuditDetailExpr(auditType, actionLabel);
  const result = await bindAll(pool.request()).query(`
    SELECT TOP (${MAX_ITEMS})
      '${categoryLabel}' AS category,
      pt.Id AS patientId,
      pt.PatientID AS patientCode,
      ${patientNameExpr} AS patientName,
      c.Id AS centreId,
      c.CentreName AS centreName,
      MIN(pal.CreatedDateTime) AS eventAt,
      NULL AS waitingHours,
      '${statusLabel}' AS status,
      ${detailExpr} AS detail
    FROM PatientAuditLog pal
    JOIN AllocatePatient ap ON ap.Id = pal.AllocatePatientId
    JOIN Patient pt ON pt.Id = ap.PatientId
    JOIN Centre c ON c.Id = pt.CentreId
    LEFT JOIN AdminUser clin ON clin.Id = ap.ClinicianUserId
    WHERE pal.Type = '${auditType}'
      AND pal.AllocatePatientId IS NOT NULL
      AND ${centreFilter}
      AND ${centreExclusion}
      AND ${dateFilterPal}
    GROUP BY ap.Id, pt.Id, pt.PatientID, pt.FirstName, pt.LastName, c.Id, c.CentreName,
      ap.Assessment, clin.FirstName, clin.LastName
    ORDER BY eventAt DESC
  `);
  return result.recordset.map(mapPatientRow);
}

async function queryFunnelReportShared(ctx) {
  const { bindAll, centreExclusion, patientNameExpr } = ctx;
  const dateFilterApr = buildDateFilter('apr.CreatedDateTimeUtc', '@dateFrom', '@dateTo');
  const detailExpr = pipelineReportSharedDetailExpr();
  const pool = await poolPromise;
  const result = await bindAll(pool.request()).query(`
    SELECT TOP (${MAX_ITEMS})
      'Report shared with family' AS category,
      pt.Id AS patientId,
      pt.PatientID AS patientCode,
      ${patientNameExpr} AS patientName,
      c.Id AS centreId,
      c.CentreName AS centreName,
      MIN(apr.CreatedDateTimeUtc) AS eventAt,
      NULL AS waitingHours,
      'Shared' AS status,
      ${detailExpr} AS detail
    FROM AllocatePatientReport apr
    JOIN AllocatePatient ap ON ap.Id = apr.AllocatePatientId
    JOIN Patient pt ON pt.Id = ap.PatientId
    JOIN Centre c ON c.Id = pt.CentreId
    LEFT JOIN AdminUser clin ON clin.Id = ap.ClinicianUserId
    WHERE ${dateFilterApr}
      AND (@centreId IS NULL OR c.Id = @centreId)
      AND ${centreExclusion}
    GROUP BY ap.Id, pt.Id, pt.PatientID, pt.FirstName, pt.LastName, c.Id, c.CentreName,
      ap.Assessment, clin.FirstName, clin.LastName, apr.CreatedBy
    ORDER BY eventAt DESC
  `);
  return result.recordset.map(mapPatientRow);
}

async function queryFunnelGoalsAdded(ctx) {
  const { bindAll, goalCentreJoin, goalCentreFilter, goalCentreExclusion, patientNameExpr } = ctx;
  const dateFilterCreated = buildDateFilter('pgarg.CreatedDateTimeUtc', '@dateFrom', '@dateTo');
  const detailExpr = pipelineGoalsAddedDetailExpr();
  const pool = await poolPromise;
  const result = await bindAll(pool.request()).query(`
    SELECT TOP (${MAX_ITEMS})
      'Goals added' AS category,
      pt.Id AS patientId,
      pt.PatientID AS patientCode,
      ${patientNameExpr} AS patientName,
      c.Id AS centreId,
      c.CentreName AS centreName,
      MIN(pgarg.CreatedDateTimeUtc) AS eventAt,
      NULL AS waitingHours,
      'Submitted' AS status,
      ${detailExpr} AS detail
    FROM PatientGoalApprovalRequestGoal pgarg
    ${goalCentreJoin}
    LEFT JOIN AdminUser clin ON clin.Id = ap.ClinicianUserId
    WHERE ${goalCentreFilter}
      AND ${goalCentreExclusion}
      AND ${dateFilterCreated}
    GROUP BY ap.Id, pt.Id, pt.PatientID, pt.FirstName, pt.LastName, c.Id, c.CentreName,
      ap.Assessment, clin.FirstName, clin.LastName, pgarg.CreatedBy
    ORDER BY eventAt DESC
  `);
  return result.recordset.map(mapPatientRow);
}

async function queryFunnelGoalsApproved(ctx) {
  const { bindAll, goalCentreJoin, goalCentreFilter, goalCentreExclusion, goalDateFilter, patientNameExpr } = ctx;
  const detailExpr = pipelineGoalsApprovedDetailExpr();
  const pool = await poolPromise;
  const result = await bindAll(pool.request()).query(`
    SELECT TOP (${MAX_ITEMS})
      'Goals approved' AS category,
      pt.Id AS patientId,
      pt.PatientID AS patientCode,
      ${patientNameExpr} AS patientName,
      c.Id AS centreId,
      c.CentreName AS centreName,
      pgarg.UpdatedDateTimeUtc AS eventAt,
      CAST(DATEDIFF(minute, pgar.CreatedDateTimeUtc, pgarg.UpdatedDateTimeUtc) AS FLOAT) / 60.0 AS waitingHours,
      'Approved' AS status,
      ${detailExpr} AS detail
    FROM PatientGoalApprovalRequestGoal pgarg
    ${goalCentreJoin}
    LEFT JOIN AdminUser clin ON clin.Id = ap.ClinicianUserId
    WHERE pgarg.Status = 'Approved'
      AND ${goalCentreFilter}
      AND ${goalCentreExclusion}
      AND ${goalDateFilter}
    GROUP BY ap.Id, pt.Id, pt.PatientID, pt.FirstName, pt.LastName, c.Id, c.CentreName,
      ap.Assessment, clin.FirstName, clin.LastName, pgarg.UpdatedBy,
      pgarg.UpdatedDateTimeUtc, pgar.CreatedDateTimeUtc
    ORDER BY pgarg.UpdatedDateTimeUtc DESC
  `);
  return result.recordset.map(mapPatientRow);
}

async function queryAllActions(ctx) {
  const [stuck, goals, incomplete] = await Promise.all([
    queryStuckOnboarding(ctx),
    queryPendingGoals(ctx),
    queryIncompleteAssessments(ctx),
  ]);
  return [...stuck, ...goals, ...incomplete]
    .sort((a, b) => (b.waitingHours ?? 0) - (a.waitingHours ?? 0))
    .slice(0, MAX_ITEMS);
}

async function queryCentreSeverity(ctx) {
  if (ctx.severity === 'critical') {
    return queryAllActions(ctx);
  }
  const [goals, incomplete] = await Promise.all([
    queryPendingGoals(ctx),
    queryIncompleteAssessments(ctx),
  ]);
  return [...goals, ...incomplete]
    .sort((a, b) => (b.waitingHours ?? 0) - (a.waitingHours ?? 0))
    .slice(0, MAX_ITEMS);
}

async function queryWeeklyOnboarding(ctx) {
  const { bindAll, centreJoin, centreFilter, centreExclusion, dateFilterPal, patientNameExpr, weekStart, weekEnd } = ctx;
  if (!weekStart || !weekEnd) {
    const err = new Error('weekStart and weekEnd are required for weekly-onboarding');
    err.status = 400;
    throw err;
  }
  const pool = await poolPromise;
  const result = await bindAll(pool.request()).query(`
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
    )
    SELECT TOP (${MAX_ITEMS})
      'Weekly onboarding' AS category,
      pt.Id AS patientId,
      pt.PatientID AS patientCode,
      ${patientNameExpr} AS patientName,
      c.Id AS centreId,
      c.CentreName AS centreName,
      r.registeredAt AS eventAt,
      CAST(DATEDIFF(minute, r.registeredAt, a.assignedAt) AS FLOAT) / 60.0 AS waitingHours,
      'Assigned' AS status,
      'Registration to assignment in selected week' AS detail
    FROM reg r
    JOIN asgn a ON a.PatientId = r.PatientId
    JOIN Patient pt ON pt.Id = r.PatientId
    JOIN Centre c ON c.Id = pt.CentreId
    WHERE a.assignedAt > r.registeredAt
      AND r.registeredAt >= @weekStart
      AND r.registeredAt < @weekEnd
    ORDER BY CAST(DATEDIFF(minute, r.registeredAt, a.assignedAt) AS FLOAT) DESC
  `);
  return result.recordset.map(mapPatientRow);
}

async function queryWeeklyGoalApproval(ctx) {
  const { bindAll, goalCentreJoin, goalCentreFilter, goalCentreExclusion, patientNameExpr, weekStart, weekEnd } = ctx;
  if (!weekStart || !weekEnd) {
    const err = new Error('weekStart and weekEnd are required for weekly-goal-approval');
    err.status = 400;
    throw err;
  }
  const pool = await poolPromise;
  const result = await bindAll(pool.request()).query(`
    SELECT TOP (${MAX_ITEMS})
      'Weekly goal approval' AS category,
      pt.Id AS patientId,
      pt.PatientID AS patientCode,
      ${patientNameExpr} AS patientName,
      c.Id AS centreId,
      c.CentreName AS centreName,
      pgarg.UpdatedDateTimeUtc AS eventAt,
      CAST(DATEDIFF(minute, pgar.CreatedDateTimeUtc, pgarg.UpdatedDateTimeUtc) AS FLOAT) / 60.0 AS waitingHours,
      pgarg.Status AS status,
      pgar.RequestId AS detail
    FROM PatientGoalApprovalRequestGoal pgarg
    ${goalCentreJoin}
    WHERE pgarg.Status = 'Approved'
      AND pgarg.UpdatedDateTimeUtc > pgar.CreatedDateTimeUtc
      AND ${goalCentreFilter}
      AND ${goalCentreExclusion}
      AND pgarg.UpdatedDateTimeUtc >= @weekStart
      AND pgarg.UpdatedDateTimeUtc < @weekEnd
    ORDER BY pgarg.UpdatedDateTimeUtc DESC
  `);
  return result.recordset.map(mapPatientRow);
}

const QUERY_HANDLERS = {
  'stuck-onboarding': queryStuckOnboarding,
  'pending-goals': queryPendingGoals,
  'incomplete-assessments': queryIncompleteAssessments,
  'all-actions': queryAllActions,
  'slow-onboarding': querySlowOnboarding,
  'slow-goal-approval': querySlowGoalApproval,
  'status-changes': (ctx) => queryAuditEvents(ctx, 'CaseStatusChanged', 'Status change'),
  'transfers': (ctx) => queryAuditEvents(ctx, 'CaseTransfer', 'Transfer'),
  'funnel-registered': (ctx) => queryFunnelStage(ctx, 'CaseRegistered', 'Case registered', 'Registered'),
  'funnel-assigned': (ctx) => queryFunnelStage(ctx, 'CaseAssigned', 'Assessment assigned', 'Assigned'),
  'funnel-scoring': (ctx) => queryFunnelStage(ctx, 'AssessmentResultGenerated', 'Scoring complete', 'Scored'),
  'funnel-report-pdf': (ctx) => queryFunnelStage(ctx, 'ReportPDFGenerated', 'Report PDF created', 'PDF created'),
  'funnel-report-shared': queryFunnelReportShared,
  'funnel-goals-added': queryFunnelGoalsAdded,
  'funnel-results': (ctx) => queryFunnelStage(ctx, 'ReportPDFGenerated', 'Report PDF created', 'PDF created'),
  'funnel-goals-approved': queryFunnelGoalsApproved,
  'weekly-onboarding': queryWeeklyOnboarding,
  'weekly-goal-approval': queryWeeklyGoalApproval,
  'centre-severity': queryCentreSeverity,
};

/**
 * GET /api/bottlenecks/drill-down
 * Query params: type (required), centreId, drillCentreId, dateFrom, dateTo,
 *               weekStart, weekEnd, severity (critical|watch)
 */
router.get('/', async (req, res, next) => {
  try {
    const type = req.query.type;
    if (!type || !VALID_TYPES.has(type)) {
      return res.status(400).json({
        error: `type is required and must be one of: ${[...VALID_TYPES].join(', ')}`,
      });
    }

    const ctx = buildFilterContext(req);
    if (type === 'centre-severity') {
      if (!req.query.drillCentreId || !ctx.severity) {
        return res.status(400).json({ error: 'centre-severity requires drillCentreId and severity (critical|watch)' });
      }
    }
    if (type === 'weekly-onboarding' || type === 'weekly-goal-approval') {
      if (!req.query.weekStart || !req.query.weekEnd) {
        return res.status(400).json({ error: `${type} requires weekStart and weekEnd` });
      }
    }
    const handler = QUERY_HANDLERS[type];
    const items = await handler(ctx);

    const drillCentreId = req.query.drillCentreId
      ? parseInt(req.query.drillCentreId, 10)
      : null;
    let title = TYPE_LABELS[type];
    if (type === 'centre-severity' && ctx.severity) {
      title = `${ctx.severity === 'critical' ? 'Critical' : 'Watch'} · ${title}`;
    }
    if (req.query.weekStart) {
      title = `${title} · week of ${formatDateKey(req.query.weekStart)}`;
    }
    if (drillCentreId && items.length > 0) {
      title = `${title} · ${items[0].centreName}`;
    } else if (drillCentreId) {
      title = `${title} · Centre #${drillCentreId}`;
    }

    res.json({
      type,
      title,
      count: items.length,
      truncated: items.length >= MAX_ITEMS,
      items,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
