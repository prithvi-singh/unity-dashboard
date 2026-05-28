'use strict';

const { Router } = require('express');
const { sql, poolPromise } = require('../db');
const { parseDateParam, buildDateFilter, buildCentreExclusion, buildPatientExclusion } = require('../lib/queryHelpers');
const { abbreviateCentre } = require('../lib/formatters');
const { activeCaseloadWhere } = require('../utils/queries');
const { terminalStatusExclusion } = require('../utils/assessmentState');
const {
  pipelineAuditDetailExpr,
  caseRegisteredDetailExpr,
  pipelineReportSharedDetailExpr,
  pipelineGoalsAddedDetailExpr,
  pipelineGoalsApprovedDetailExpr,
} = require('../lib/pipelineDetailExprs');

const router = Router();

const VALID_TYPES = new Set([
  'clinician-caseload',
  'clinician-stuck',
  'clinician-goals-to-add',
  'clinician-results',
  'clinician-inactive',
  'clinician-pipeline-assigned',
  'clinician-pipeline-scoring',
  'clinician-pipeline-report-drafted',
  'clinician-pipeline-report-pdf',
  'clinician-pipeline-report-shared',
  'clinician-pipeline-goals-added',
  'clinician-pipeline-goals-approved',
  'manager-registered',
  'manager-assigned',
  'manager-stuck-onboarding',
  'admin-registered',
  'admin-assigned',
  'admin-unassigned',
]);

const TYPE_LABELS = {
  'clinician-caseload': 'Active caseload',
  'clinician-stuck': 'Stuck cases (>14d, no result)',
  'clinician-goals-to-add': 'Goals to add (report approved, no goals yet)',
  'clinician-results': 'Results generated',
  'clinician-inactive': 'Idle clinicians (no activity today, open caseload)',
  'clinician-pipeline-assigned': 'Assessments assigned',
  'clinician-pipeline-scoring': 'Scoring complete',
  'clinician-pipeline-report-drafted': 'Reports drafted',
  'clinician-pipeline-report-pdf': 'Report PDF created',
  'clinician-pipeline-report-shared': 'Report shared with family',
  'clinician-pipeline-goals-added': 'Goals added',
  'clinician-pipeline-goals-approved': 'Goals approved',
  'manager-registered': 'Cases registered',
  'manager-assigned': 'Assessments assigned',
  'manager-stuck-onboarding': 'Stuck onboarding (>48h)',
  'admin-registered': 'Cases registered',
  'admin-assigned': 'Routed to clinical',
  'admin-unassigned': 'Awaiting clinical assignment',
};

const MAX_ITEMS = 500;

function mapPatientRow(row) {
  return {
    category: row.category ?? null,
    patientId: row.patientId,
    patientCode: row.patientCode ?? null,
    patientName: (row.patientName ?? '').trim() || 'Unknown',
    centreId: row.centreId,
    centreName: abbreviateCentre(row.centreName ?? '') ?? '',
    eventAt: row.eventAt ? new Date(row.eventAt).toISOString() : null,
    waitingHours: row.waitingHours != null ? parseFloat(Number(row.waitingHours).toFixed(1)) : null,
    status: row.status ?? null,
    detail: row.detail ?? null,
  };
}

function mapUserRow(row) {
  const firstName = row.FirstName ?? row.firstName ?? '';
  const lastName = row.LastName ?? row.lastName ?? '';
  const email = row.Email ?? row.email ?? null;

  return {
    category: row.category ?? null,
    patientId: row.userId,
    patientCode: null,
    patientName: `${firstName} ${lastName}`.trim() || 'Unknown',
    centreId: row.centreId ?? 0,
    centreName: row.centreName ?? '',
    eventAt: row.lastActivity ? new Date(row.lastActivity).toISOString() : null,
    waitingHours: row.daysSinceActivity != null ? row.daysSinceActivity * 24 : null,
    status: row.roleName ?? null,
    detail: email ? `Email: ${email}` : null,
  };
}

function buildFilterContext(req) {
  const centreId = req.query.centreId ? parseInt(req.query.centreId, 10) : null;
  const dateFrom = parseDateParam(req.query.dateFrom);
  const dateTo = parseDateParam(req.query.dateTo);
  const drillCentreId = req.query.drillCentreId
    ? parseInt(req.query.drillCentreId, 10)
    : null;
  const drillUserId = req.query.drillUserId
    ? parseInt(req.query.drillUserId, 10)
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
  if (req.query.drillUserId && isNaN(drillUserId)) {
    const err = new Error('drillUserId must be a number');
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

  const effectiveCentreId = drillCentreId ?? centreId;
  const centreExclusion = buildCentreExclusion('c');
  const patientExclusion = buildPatientExclusion('pt');
  const dateFilterPal = buildDateFilter('pal.CreatedDateTime', '@dateFrom', '@dateTo');
  const patientNameExpr = `LTRIM(RTRIM(CONCAT(ISNULL(pt.FirstName, ''), ' ', ISNULL(pt.LastName, ''))))`;

  function bindAll(request) {
    return request
      .input('centreId', sql.BigInt, effectiveCentreId)
      .input('dateFrom', sql.DateTimeOffset, dateFrom)
      .input('dateTo', sql.DateTimeOffset, dateTo)
      .input('drillUserId', sql.BigInt, drillUserId);
  }

  const userFilter = '(@drillUserId IS NULL OR au.Id = @drillUserId)';
  const clinicianFilter = '(@drillUserId IS NULL OR ap.ClinicianUserId = @drillUserId)';
  const adminFilter = '(@drillUserId IS NULL OR pal.AdminUserId = @drillUserId)';
  const dateFilterPgargCreated = buildDateFilter('pgarg.CreatedDateTimeUtc', '@dateFrom', '@dateTo');
  const dateFilterPgargUpdated = buildDateFilter('pgarg.UpdatedDateTimeUtc', '@dateFrom', '@dateTo');
  const dateFilterApr = buildDateFilter('apr.CreatedDateTimeUtc', '@dateFrom', '@dateTo');

  return {
    effectiveCentreId,
    centreExclusion,
    patientExclusion,
    dateFilterPal,
    patientNameExpr,
    bindAll,
    userFilter,
    clinicianFilter,
    adminFilter,
    dateFilterPgargCreated,
    dateFilterPgargUpdated,
    dateFilterApr,
  };
}

async function queryPipelineAuditStage(ctx, auditType, categoryLabel, statusLabel, actionLabel = 'By') {
  const {
    bindAll, centreExclusion, patientExclusion, dateFilterPal, patientNameExpr, clinicianFilter,
  } = ctx;
  const detailExpr = pipelineAuditDetailExpr(auditType, actionLabel);
  const pool = await poolPromise;
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
      AND ${dateFilterPal}
      AND (@centreId IS NULL OR c.Id = @centreId)
      AND ${centreExclusion}
      AND ${patientExclusion}
      AND ${clinicianFilter}
    GROUP BY ap.Id, pt.Id, pt.PatientID, pt.FirstName, pt.LastName, c.Id, c.CentreName,
      ap.Assessment, clin.FirstName, clin.LastName
    ORDER BY eventAt DESC
  `);
  return result.recordset.map(mapPatientRow);
}

async function queryPipelineReportShared(ctx) {
  const {
    bindAll, centreExclusion, patientExclusion, dateFilterApr, patientNameExpr, clinicianFilter,
  } = ctx;
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
      AND ${patientExclusion}
      AND ${clinicianFilter}
    GROUP BY ap.Id, pt.Id, pt.PatientID, pt.FirstName, pt.LastName, c.Id, c.CentreName,
      ap.Assessment, clin.FirstName, clin.LastName, apr.CreatedBy
    ORDER BY eventAt DESC
  `);
  return result.recordset.map(mapPatientRow);
}

async function queryPipelineGoalsAdded(ctx) {
  const {
    bindAll, centreExclusion, patientExclusion, dateFilterPgargCreated, patientNameExpr, clinicianFilter,
  } = ctx;
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
    JOIN PatientGoalApprovalRequest pgar ON pgar.Id = pgarg.PatientGoalApprovalRequestId
    JOIN AllocatePatient ap ON ap.Id = pgar.AllocatePatientId
    JOIN Patient pt ON pt.Id = ap.PatientId
    JOIN Centre c ON c.Id = pt.CentreId
    LEFT JOIN AdminUser clin ON clin.Id = ap.ClinicianUserId
    WHERE ${dateFilterPgargCreated}
      AND (@centreId IS NULL OR c.Id = @centreId)
      AND ${centreExclusion}
      AND ${patientExclusion}
      AND ${clinicianFilter}
    GROUP BY ap.Id, pt.Id, pt.PatientID, pt.FirstName, pt.LastName, c.Id, c.CentreName,
      ap.Assessment, clin.FirstName, clin.LastName, pgarg.CreatedBy
    ORDER BY eventAt DESC
  `);
  return result.recordset.map(mapPatientRow);
}

async function queryPipelineGoalsApproved(ctx) {
  const {
    bindAll, centreExclusion, patientExclusion, dateFilterPgargUpdated, patientNameExpr, clinicianFilter,
  } = ctx;
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
      MAX(pgarg.UpdatedDateTimeUtc) AS eventAt,
      CAST(DATEDIFF(minute, MIN(pgar.CreatedDateTimeUtc), MAX(pgarg.UpdatedDateTimeUtc)) AS FLOAT) / 60.0 AS waitingHours,
      'Approved' AS status,
      ${detailExpr} AS detail
    FROM PatientGoalApprovalRequestGoal pgarg
    JOIN PatientGoalApprovalRequest pgar ON pgar.Id = pgarg.PatientGoalApprovalRequestId
    JOIN AllocatePatient ap ON ap.Id = pgar.AllocatePatientId
    JOIN Patient pt ON pt.Id = ap.PatientId
    JOIN Centre c ON c.Id = pt.CentreId
    LEFT JOIN AdminUser clin ON clin.Id = ap.ClinicianUserId
    WHERE pgarg.Status = 'Approved'
      AND ${dateFilterPgargUpdated}
      AND (@centreId IS NULL OR c.Id = @centreId)
      AND ${centreExclusion}
      AND ${patientExclusion}
      AND ${clinicianFilter}
    GROUP BY ap.Id, pt.Id, pt.PatientID, pt.FirstName, pt.LastName, c.Id, c.CentreName,
      ap.Assessment, clin.FirstName, clin.LastName, pgarg.UpdatedBy
    ORDER BY eventAt DESC
  `);
  return result.recordset.map(mapPatientRow);
}

async function queryClinicianCaseload(ctx) {
  const { bindAll, patientNameExpr, clinicianFilter } = ctx;
  const pool = await poolPromise;
  // activeCaseloadWhere is the single source of truth shared with clinicians.js
  // so COUNT in the table always equals the number of rows here.
  const result = await bindAll(pool.request()).query(`
    SELECT TOP (${MAX_ITEMS})
      'Active case' AS category,
      pt.Id AS patientId,
      pt.PatientID AS patientCode,
      ${patientNameExpr} AS patientName,
      c.Id AS centreId,
      c.CentreName AS centreName,
      ap.CreatedDateTimeUtc AS eventAt,
      CAST(DATEDIFF(minute, ap.CreatedDateTimeUtc, SYSDATETIMEOFFSET()) AS FLOAT) / 60.0 AS waitingHours,
      ap.Status AS status,
      CONCAT('Clinician: ', ISNULL(au.FirstName, ''), ' ', ISNULL(au.LastName, '')) AS detail
    FROM AllocatePatient ap
    JOIN Patient pt ON pt.Id = ap.PatientId
    JOIN Centre c   ON c.Id  = pt.CentreId
    LEFT JOIN AdminUser au ON au.Id = ap.ClinicianUserId
    WHERE ${activeCaseloadWhere('ap', 'pt', 'c')}
      AND ${clinicianFilter}
    ORDER BY ap.CreatedDateTimeUtc ASC
  `);
  return result.recordset.map(mapPatientRow);
}

async function queryClinicianStuck(ctx) {
  const { bindAll, centreExclusion, patientExclusion, patientNameExpr, clinicianFilter } = ctx;
  const pool = await poolPromise;
  const result = await bindAll(pool.request()).query(`
    SELECT TOP (${MAX_ITEMS})
      'Stuck case' AS category,
      pt.Id AS patientId,
      pt.PatientID AS patientCode,
      ${patientNameExpr} AS patientName,
      c.Id AS centreId,
      c.CentreName AS centreName,
      ap.CreatedDateTimeUtc AS eventAt,
      CAST(DATEDIFF(minute, ap.CreatedDateTimeUtc, SYSDATETIMEOFFSET()) AS FLOAT) / 60.0 AS waitingHours,
      ap.Status AS status,
      'Assigned >14d with no result generated' AS detail
    FROM AllocatePatient ap
    JOIN Patient pt ON pt.Id = ap.PatientId
    JOIN Centre c ON c.Id = pt.CentreId
    WHERE ap.Status IN ('NotStarted', 'InProgress', 'OnHold')
      AND ap.CreatedDateTimeUtc < DATEADD(day, -14, SYSDATETIMEOFFSET())
      AND NOT EXISTS (
        SELECT 1 FROM PatientAuditLog pal3
        WHERE pal3.AllocatePatientId = ap.Id
          AND pal3.Type IN ('ReportPDFGenerated', 'AssessmentResultGenerated')
      )
      AND (@centreId IS NULL OR c.Id = @centreId)
      AND ${centreExclusion}
      AND ${patientExclusion}
      AND ${clinicianFilter}
    ORDER BY ap.CreatedDateTimeUtc ASC
  `);
  return result.recordset.map(mapPatientRow);
}

async function queryClinicianGoalsToAdd(ctx) {
  const { bindAll, centreExclusion, patientExclusion, patientNameExpr, clinicianFilter } = ctx;
  const pool = await poolPromise;
  const apNotTerminal = terminalStatusExclusion('ap');
  const result = await bindAll(pool.request()).query(`
    WITH pdf_gen AS (
      SELECT AllocatePatientId, MIN(CreatedDateTime) AS pdfGeneratedAt
      FROM PatientAuditLog
      WHERE Type = 'ReportPDFGenerated' AND AllocatePatientId IS NOT NULL
      GROUP BY AllocatePatientId
    )
    SELECT TOP (${MAX_ITEMS})
      'Goals to add' AS category,
      pt.Id AS patientId,
      pt.PatientID AS patientCode,
      ${patientNameExpr} AS patientName,
      c.Id AS centreId,
      c.CentreName AS centreName,
      pg.pdfGeneratedAt AS eventAt,
      CAST(DATEDIFF(day, pg.pdfGeneratedAt, SYSDATETIMEOFFSET()) AS FLOAT) * 24.0 AS waitingHours,
      'Goals needed' AS status,
      CONCAT(ap.Assessment, ' · ', ISNULL(au.FirstName, ''), ' ', ISNULL(au.LastName, '')) AS detail
    FROM pdf_gen pg
    JOIN AllocatePatient ap ON ap.Id = pg.AllocatePatientId
    JOIN Patient pt ON pt.Id = ap.PatientId
    JOIN Centre c ON c.Id = pt.CentreId
    LEFT JOIN AdminUser au ON au.Id = ap.ClinicianUserId
    WHERE NOT EXISTS (
      SELECT 1 FROM PatientGoalApprovalRequest pgar
      WHERE pgar.AllocatePatientId = ap.Id
    )
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
      AND ${apNotTerminal}
      AND (@centreId IS NULL OR c.Id = @centreId)
      AND ${centreExclusion}
      AND ${patientExclusion}
      AND ${clinicianFilter}
    ORDER BY pg.pdfGeneratedAt ASC
  `);
  return result.recordset.map(mapPatientRow);
}

async function queryClinicianResults(ctx) {
  return queryPipelineAuditStage(ctx, 'ReportPDFGenerated', 'Report PDF created', 'PDF created');
}

const CASE_STATUS_LABELS = {
  NotStarted: 'Not started',
  InProgress: 'In progress',
  OnHold: 'On hold',
};

function mapInactiveClinicianRow(row) {
  const firstName = row.FirstName ?? row.firstName ?? '';
  const lastName = row.LastName ?? row.lastName ?? '';
  const email = row.Email ?? row.email ?? null;
  const caseName = row.caseName ?? null;
  const assessmentType = row.assessmentType ?? null;
  const rawStatus = row.caseStatus ?? null;
  const friendlyStatus = rawStatus ? (CASE_STATUS_LABELS[rawStatus] ?? rawStatus) : null;

  const detailParts = [];
  if (caseName) detailParts.push(`Case: ${caseName}`);
  if (assessmentType) detailParts.push(`Assessment: ${assessmentType}`);
  if (email) detailParts.push(`Email: ${email}`);

  return {
    category: row.category ?? null,
    patientId: row.userId,
    patientCode: null,
    patientName: `${firstName} ${lastName}`.trim() || 'Unknown',
    centreId: row.centreId ?? 0,
    centreName: row.centreName ?? '',
    eventAt: row.lastActivity ? new Date(row.lastActivity).toISOString() : null,
    waitingHours: row.daysSinceActivity != null ? row.daysSinceActivity * 24 : null,
    status: friendlyStatus,
    detail: detailParts.join(' · '),
  };
}

async function queryClinicianInactive(ctx) {
  const { bindAll, centreExclusion, userFilter } = ctx;
  const pool = await poolPromise;
  const result = await bindAll(pool.request()).query(`
    SELECT TOP (${MAX_ITEMS})
      'Idle clinician' AS category,
      ic.userId,
      ic.FirstName,
      ic.LastName,
      ic.Email,
      ic.roleName,
      ic.centreId,
      ic.centreName,
      ic.lastActivity,
      ic.daysSinceActivity,
      ap.Assessment AS assessmentType,
      LTRIM(RTRIM(CONCAT(ISNULL(pt.FirstName, ''), ' ', ISNULL(pt.LastName, '')))) AS caseName,
      ap.Status AS caseStatus
    FROM (
      SELECT
        au.Id AS userId,
        au.FirstName,
        au.LastName,
        au.Email,
        ar.Name AS roleName,
        c.Id AS centreId,
        c.CentreName AS centreName,
        MAX(pal.CreatedDateTime) AS lastActivity,
        DATEDIFF(day, MAX(pal.CreatedDateTime), SYSDATETIMEOFFSET()) AS daysSinceActivity
      FROM AdminUser au
      JOIN AdminUserRole aur ON aur.UserId = au.Id
      JOIN AdminRole ar ON ar.Id = aur.RoleId AND ar.Name = 'Clinician'
      JOIN AdminUserCentre auc ON auc.AdminUserId = au.Id
      JOIN Centre c ON c.Id = auc.CentreId
      LEFT JOIN PatientAuditLog pal ON pal.AdminUserId = au.Id
      WHERE (@centreId IS NULL OR c.Id = @centreId)
        AND ${centreExclusion}
        AND ${userFilter}
        AND LOWER(au.FirstName) NOT LIKE '%test%'
        AND LOWER(au.LastName) NOT LIKE '%test%'
        AND LOWER(au.Email) NOT LIKE '%@webority.com'
        AND EXISTS (
          SELECT 1 FROM AllocatePatient ap_ex
          JOIN Patient pt_ex ON pt_ex.Id = ap_ex.PatientId
          WHERE ap_ex.ClinicianUserId = au.Id
            AND ap_ex.Status IN ('NotStarted', 'InProgress', 'OnHold')
            AND (@centreId IS NULL OR pt_ex.CentreId = @centreId)
        )
      GROUP BY au.Id, au.FirstName, au.LastName, au.Email, ar.Name, c.Id, c.CentreName
      HAVING MAX(pal.CreatedDateTime) IS NULL
        OR CAST(MAX(pal.CreatedDateTime) AS DATE) < CAST(SYSDATETIMEOFFSET() AS DATE)
    ) ic
    JOIN AllocatePatient ap ON ap.ClinicianUserId = ic.userId
      AND ap.Status IN ('NotStarted', 'InProgress', 'OnHold')
    JOIN Patient pt ON pt.Id = ap.PatientId
      AND (@centreId IS NULL OR pt.CentreId = @centreId)
      AND pt.FirstName NOT LIKE '%test%'
      AND pt.LastName NOT LIKE '%test%'
    ORDER BY ic.daysSinceActivity DESC, ic.userId, pt.LastName, pt.FirstName
  `);
  return result.recordset.map(mapInactiveClinicianRow);
}

async function queryManagerRegistered(ctx) {
  const { bindAll, centreExclusion, patientExclusion, dateFilterPal, patientNameExpr, adminFilter } = ctx;
  const pool = await poolPromise;
  const result = await bindAll(pool.request()).query(`
    SELECT TOP (${MAX_ITEMS})
      'Case registered' AS category,
      pt.Id AS patientId,
      pt.PatientID AS patientCode,
      ${patientNameExpr} AS patientName,
      c.Id AS centreId,
      c.CentreName AS centreName,
      MIN(pal.CreatedDateTime) AS eventAt,
      NULL AS waitingHours,
      'Registered' AS status,
      CONCAT('By: ', ISNULL(au.FirstName, ''), ' ', ISNULL(au.LastName, '')) AS detail
    FROM PatientAuditLog pal
    JOIN Patient pt ON pt.Id = pal.PatientId
    JOIN Centre c ON c.Id = pt.CentreId
    JOIN AdminUser au ON au.Id = pal.AdminUserId
    JOIN AdminUserRole aur ON aur.UserId = au.Id
    JOIN AdminRole ar ON ar.Id = aur.RoleId AND ar.Name NOT IN ('Clinician', 'Super Admin')
    WHERE pal.Type = 'CaseRegistered'
      AND ${dateFilterPal}
      AND (@centreId IS NULL OR c.Id = @centreId)
      AND ${centreExclusion}
      AND ${patientExclusion}
      AND ${adminFilter}
      AND au.FirstName NOT LIKE '%(Ops)%'
      AND au.LastName NOT LIKE '%(Ops)%'
      AND au.Email NOT LIKE '%(Ops)%'
    GROUP BY pt.Id, pt.PatientID, pt.FirstName, pt.LastName, c.Id, c.CentreName, au.FirstName, au.LastName
    ORDER BY eventAt DESC
  `);
  return result.recordset.map(mapPatientRow);
}

async function queryManagerAssigned(ctx) {
  const { bindAll, centreExclusion, patientExclusion, dateFilterPal, patientNameExpr, adminFilter } = ctx;
  const pool = await poolPromise;
  // Group by ap.Id (AllocatePatientId) so each assessment assignment appears as a
  // separate row. A patient can have multiple assessment types assigned separately.
  const result = await bindAll(pool.request()).query(`
    SELECT TOP (${MAX_ITEMS})
      'Assessment assigned' AS category,
      pt.Id AS patientId,
      pt.PatientID AS patientCode,
      ${patientNameExpr} AS patientName,
      c.Id AS centreId,
      c.CentreName AS centreName,
      MIN(pal.CreatedDateTime) AS eventAt,
      NULL AS waitingHours,
      ISNULL(ap.Assessment, 'Assigned') AS status,
      CONCAT(
        ISNULL(ap.Assessment, 'Assessment'),
        ' · Assigned by: ', ISNULL(au.FirstName, ''), ' ', ISNULL(au.LastName, ''),
        ' · Clinician: ', ISNULL(clin.FirstName, ''), ' ', ISNULL(clin.LastName, '')
      ) AS detail
    FROM PatientAuditLog pal
    JOIN AllocatePatient ap ON ap.Id = pal.AllocatePatientId
    JOIN Patient pt ON pt.Id = pal.PatientId
    JOIN Centre c ON c.Id = pt.CentreId
    JOIN AdminUser au ON au.Id = pal.AdminUserId
    JOIN AdminUserRole aur ON aur.UserId = au.Id
    JOIN AdminRole ar ON ar.Id = aur.RoleId AND ar.Name NOT IN ('Clinician', 'Super Admin')
    LEFT JOIN AdminUser clin ON clin.Id = ap.ClinicianUserId
    WHERE pal.Type = 'CaseAssigned'
      AND pal.AllocatePatientId IS NOT NULL
      AND ${dateFilterPal}
      AND (@centreId IS NULL OR c.Id = @centreId)
      AND ${centreExclusion}
      AND ${patientExclusion}
      AND ${adminFilter}
      AND au.FirstName NOT LIKE '%(Ops)%'
      AND au.LastName NOT LIKE '%(Ops)%'
      AND au.Email NOT LIKE '%(Ops)%'
    GROUP BY ap.Id, ap.Assessment, pt.Id, pt.PatientID, pt.FirstName, pt.LastName,
             c.Id, c.CentreName, au.FirstName, au.LastName, clin.FirstName, clin.LastName
    ORDER BY eventAt DESC
  `);
  return result.recordset.map(mapPatientRow);
}

async function queryManagerStuckOnboarding(ctx) {
  const { bindAll, centreExclusion, patientExclusion, patientNameExpr, dateFilterPal } = ctx;
  const pool = await poolPromise;
  const result = await bindAll(pool.request()).query(`
    SELECT TOP (${MAX_ITEMS})
      'Stuck onboarding' AS category,
      pt.Id AS patientId,
      pt.PatientID AS patientCode,
      ${patientNameExpr} AS patientName,
      c.Id AS centreId,
      c.CentreName AS centreName,
      reg.registeredAt AS eventAt,
      CAST(DATEDIFF(minute, reg.registeredAt, SYSDATETIMEOFFSET()) AS FLOAT) / 60.0 AS waitingHours,
      'Unassigned' AS status,
      CONCAT('Registered by: ', ISNULL(au.FirstName, ''), ' ', ISNULL(au.LastName, '')) AS detail
    FROM (
      SELECT pal.PatientId, MIN(pal.CreatedDateTime) AS registeredAt, MIN(pal.AdminUserId) AS adminUserId
      FROM PatientAuditLog pal
      JOIN Patient pt2 ON pt2.Id = pal.PatientId
      JOIN Centre c2 ON c2.Id = pt2.CentreId
      JOIN AdminUser au2 ON au2.Id = pal.AdminUserId
      JOIN AdminUserRole aur2 ON aur2.UserId = au2.Id
      JOIN AdminRole ar2 ON ar2.Id = aur2.RoleId AND ar2.Name NOT IN ('Clinician', 'Super Admin')
      WHERE pal.Type = 'CaseRegistered'
        AND ${dateFilterPal}
        AND (@centreId IS NULL OR c2.Id = @centreId)
        AND ${centreExclusion.replace(/\bc\b/g, 'c2')}
        AND pt2.FirstName NOT LIKE '%test%'
        AND pt2.LastName NOT LIKE '%test%'
        AND (@drillUserId IS NULL OR au2.Id = @drillUserId)
        AND au2.FirstName NOT LIKE '%(Ops)%'
        AND au2.LastName NOT LIKE '%(Ops)%'
        AND au2.Email NOT LIKE '%(Ops)%'
      GROUP BY pal.PatientId
    ) reg
    JOIN Patient pt ON pt.Id = reg.PatientId
    JOIN Centre c ON c.Id = pt.CentreId
    JOIN AdminUser au ON au.Id = reg.adminUserId
    WHERE reg.registeredAt < DATEADD(hour, -48, SYSDATETIMEOFFSET())
      AND NOT EXISTS (
        SELECT 1 FROM PatientAuditLog p2
        WHERE p2.PatientId = reg.PatientId AND p2.Type = 'CaseAssigned'
      )
    ORDER BY reg.registeredAt ASC
  `);
  return result.recordset.map(mapPatientRow);
}

async function queryAdminRegistered(ctx) {
  const { bindAll, centreExclusion, patientExclusion, dateFilterPal, patientNameExpr, adminFilter } = ctx;
  const pool = await poolPromise;
  const result = await bindAll(pool.request()).query(`
    SELECT TOP (${MAX_ITEMS})
      'Case registered' AS category,
      pt.Id AS patientId,
      pt.PatientID AS patientCode,
      ${patientNameExpr} AS patientName,
      c.Id AS centreId,
      c.CentreName AS centreName,
      MIN(pal.CreatedDateTime) AS eventAt,
      NULL AS waitingHours,
      'Registered' AS status,
      CONCAT('Ops: ', ISNULL(au.FirstName, ''), ' ', ISNULL(au.LastName, '')) AS detail
    FROM PatientAuditLog pal
    JOIN Patient pt ON pt.Id = pal.PatientId
    JOIN Centre c ON c.Id = pt.CentreId
    JOIN AdminUser au ON au.Id = pal.AdminUserId
    WHERE pal.Type = 'CaseRegistered'
      AND ${dateFilterPal}
      AND (@centreId IS NULL OR c.Id = @centreId)
      AND ${centreExclusion}
      AND ${patientExclusion}
      AND ${adminFilter}
      AND (au.FirstName LIKE '%(Ops)%' OR au.LastName LIKE '%(Ops)%' OR au.Email LIKE '%(Ops)%')
    GROUP BY pt.Id, pt.PatientID, pt.FirstName, pt.LastName, c.Id, c.CentreName, au.FirstName, au.LastName
    ORDER BY eventAt DESC
  `);
  return result.recordset.map(mapPatientRow);
}

async function queryAdminAssigned(ctx) {
  const { bindAll, centreExclusion, patientExclusion, dateFilterPal, patientNameExpr, adminFilter } = ctx;
  const pool = await poolPromise;
  const result = await bindAll(pool.request()).query(`
    SELECT TOP (${MAX_ITEMS})
      'Routed to clinical' AS category,
      pt.Id AS patientId,
      pt.PatientID AS patientCode,
      ${patientNameExpr} AS patientName,
      c.Id AS centreId,
      c.CentreName AS centreName,
      MIN(pal.CreatedDateTime) AS eventAt,
      NULL AS waitingHours,
      'Assigned' AS status,
      CONCAT('Ops: ', ISNULL(au.FirstName, ''), ' ', ISNULL(au.LastName, '')) AS detail
    FROM PatientAuditLog pal
    JOIN Patient pt ON pt.Id = pal.PatientId
    JOIN Centre c ON c.Id = pt.CentreId
    JOIN AdminUser au ON au.Id = pal.AdminUserId
    WHERE pal.Type = 'CaseAssigned'
      AND ${dateFilterPal}
      AND (@centreId IS NULL OR c.Id = @centreId)
      AND ${centreExclusion}
      AND ${patientExclusion}
      AND ${adminFilter}
      AND (au.FirstName LIKE '%(Ops)%' OR au.LastName LIKE '%(Ops)%' OR au.Email LIKE '%(Ops)%')
    GROUP BY pt.Id, pt.PatientID, pt.FirstName, pt.LastName, c.Id, c.CentreName, au.FirstName, au.LastName
    ORDER BY eventAt DESC
  `);
  return result.recordset.map(mapPatientRow);
}

async function queryAdminUnassigned(ctx) {
  const { bindAll, centreExclusion, patientExclusion, patientNameExpr, adminFilter } = ctx;
  const pool = await poolPromise;
  const result = await bindAll(pool.request()).query(`
    SELECT TOP (${MAX_ITEMS})
      'Awaiting assignment' AS category,
      pt.Id AS patientId,
      pt.PatientID AS patientCode,
      ${patientNameExpr} AS patientName,
      c.Id AS centreId,
      c.CentreName AS centreName,
      reg.registeredAt AS eventAt,
      CAST(DATEDIFF(minute, reg.registeredAt, SYSDATETIMEOFFSET()) AS FLOAT) / 60.0 AS waitingHours,
      'Unassigned' AS status,
      CONCAT('Registered by: ', ISNULL(au.FirstName, ''), ' ', ISNULL(au.LastName, '')) AS detail
    FROM (
      SELECT pal.PatientId, MIN(pal.CreatedDateTime) AS registeredAt, MIN(pal.AdminUserId) AS adminUserId
      FROM PatientAuditLog pal
      JOIN Patient pt2 ON pt2.Id = pal.PatientId
      JOIN Centre c2 ON c2.Id = pt2.CentreId
      JOIN AdminUser au2 ON au2.Id = pal.AdminUserId
      WHERE pal.Type = 'CaseRegistered'
        AND (@centreId IS NULL OR c2.Id = @centreId)
        AND ${centreExclusion.replace(/\bc\b/g, 'c2')}
        AND pt2.FirstName NOT LIKE '%test%'
        AND pt2.LastName NOT LIKE '%test%'
        AND (@drillUserId IS NULL OR au2.Id = @drillUserId)
        AND (au2.FirstName LIKE '%(Ops)%' OR au2.LastName LIKE '%(Ops)%' OR au2.Email LIKE '%(Ops)%')
      GROUP BY pal.PatientId
    ) reg
    JOIN Patient pt ON pt.Id = reg.PatientId
    JOIN Centre c ON c.Id = pt.CentreId
    JOIN AdminUser au ON au.Id = reg.adminUserId
    WHERE NOT EXISTS (
      SELECT 1 FROM PatientAuditLog p2
      WHERE p2.PatientId = reg.PatientId AND p2.Type = 'CaseAssigned'
    )
      AND (@drillUserId IS NULL OR au.Id = @drillUserId)
    ORDER BY reg.registeredAt ASC
  `);
  return result.recordset.map(mapPatientRow);
}

const QUERY_HANDLERS = {
  'clinician-caseload': queryClinicianCaseload,
  'clinician-stuck': queryClinicianStuck,
  'clinician-goals-to-add': queryClinicianGoalsToAdd,
  'clinician-results': queryClinicianResults,
  'clinician-inactive': queryClinicianInactive,
  'clinician-pipeline-assigned': (ctx) => queryPipelineAuditStage(ctx, 'CaseAssigned', 'Assessment assigned', 'Assigned', 'Assigned by'),
  'clinician-pipeline-scoring': (ctx) => queryPipelineAuditStage(ctx, 'AssessmentResultGenerated', 'Scoring complete', 'Scored', 'Scored by'),
  'clinician-pipeline-report-drafted': (ctx) => queryPipelineAuditStage(ctx, 'ReportAdded', 'Reports drafted', 'Drafted', 'Drafted by'),
  'clinician-pipeline-report-pdf': (ctx) => queryPipelineAuditStage(ctx, 'ReportPDFGenerated', 'Report PDF created', 'PDF created', 'Created by'),
  'clinician-pipeline-report-shared': queryPipelineReportShared,
  'clinician-pipeline-goals-added': queryPipelineGoalsAdded,
  'clinician-pipeline-goals-approved': queryPipelineGoalsApproved,
  'manager-registered': queryManagerRegistered,
  'manager-assigned': queryManagerAssigned,
  'manager-stuck-onboarding': queryManagerStuckOnboarding,
  'admin-registered': queryAdminRegistered,
  'admin-assigned': queryAdminAssigned,
  'admin-unassigned': queryAdminUnassigned,
};

router.get('/', async (req, res, next) => {
  try {
    const type = req.query.type;
    if (!type || !VALID_TYPES.has(type)) {
      return res.status(400).json({ error: `type must be one of: ${[...VALID_TYPES].join(', ')}` });
    }

    const ctx = buildFilterContext(req);
    const handler = QUERY_HANDLERS[type];
    const items = await handler(ctx);

    res.json({
      type,
      title: TYPE_LABELS[type] ?? type,
      count: items.length,
      truncated: items.length >= MAX_ITEMS,
      items,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
