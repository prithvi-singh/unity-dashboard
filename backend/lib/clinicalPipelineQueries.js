'use strict';

const { buildDateFilter, buildCentreExclusion } = require('./queryHelpers');

/** Count distinct assessments (AllocatePatient rows) for audit events in a period. */
function auditAssessmentCount(auditType) {
  const centreExclusion = buildCentreExclusion('c');
  const dateFilter = buildDateFilter('pal.CreatedDateTime', '@dateFrom', '@dateTo');
  return `
    (
      SELECT COUNT(DISTINCT pal.AllocatePatientId)
      FROM PatientAuditLog pal
      JOIN Patient pt ON pt.Id = pal.PatientId
      JOIN Centre c ON c.Id = pt.CentreId
      WHERE pal.Type = '${auditType}'
        AND pal.AllocatePatientId IS NOT NULL
        AND (@centreId IS NULL OR c.Id = @centreId)
        AND ${centreExclusion}
        AND ${dateFilter}
    )`;
}

function casesRegisteredCount() {
  const centreExclusion = buildCentreExclusion('c');
  const dateFilter = buildDateFilter('pal.CreatedDateTime', '@dateFrom', '@dateTo');
  return `
    (
      SELECT COUNT(DISTINCT pal.PatientId)
      FROM PatientAuditLog pal
      JOIN Patient pt ON pt.Id = pal.PatientId
      JOIN Centre c ON c.Id = pt.CentreId
      WHERE pal.Type = 'CaseRegistered'
        AND (@centreId IS NULL OR c.Id = @centreId)
        AND ${centreExclusion}
        AND ${dateFilter}
    )`;
}

function reportSharedCount() {
  const centreExclusion = buildCentreExclusion('c');
  const dateFilter = buildDateFilter('apr.CreatedDateTimeUtc', '@dateFrom', '@dateTo');
  return `
    (
      SELECT COUNT(DISTINCT apr.AllocatePatientId)
      FROM AllocatePatientReport apr
      JOIN AllocatePatient ap ON ap.Id = apr.AllocatePatientId
      JOIN Patient pt ON pt.Id = ap.PatientId
      JOIN Centre c ON c.Id = pt.CentreId
      WHERE (@centreId IS NULL OR c.Id = @centreId)
        AND ${centreExclusion}
        AND ${dateFilter}
    )`;
}

function goalsAddedCount() {
  const centreExclusion = buildCentreExclusion('c');
  const dateFilter = buildDateFilter('pgarg.CreatedDateTimeUtc', '@dateFrom', '@dateTo');
  return `
    (
      SELECT COUNT(DISTINCT pgar.AllocatePatientId)
      FROM PatientGoalApprovalRequestGoal pgarg
      JOIN PatientGoalApprovalRequest pgar ON pgar.Id = pgarg.PatientGoalApprovalRequestId
      JOIN AllocatePatient ap ON ap.Id = pgar.AllocatePatientId
      JOIN Patient pt ON pt.Id = ap.PatientId
      JOIN Centre c ON c.Id = pt.CentreId
      WHERE (@centreId IS NULL OR c.Id = @centreId)
        AND ${centreExclusion}
        AND ${dateFilter}
    )`;
}

function goalsApprovedCount() {
  const centreExclusion = buildCentreExclusion('c');
  const dateFilter = buildDateFilter('pgarg.UpdatedDateTimeUtc', '@dateFrom', '@dateTo');
  return `
    (
      SELECT COUNT(DISTINCT pgar.AllocatePatientId)
      FROM PatientGoalApprovalRequestGoal pgarg
      JOIN PatientGoalApprovalRequest pgar ON pgar.Id = pgarg.PatientGoalApprovalRequestId
      JOIN AllocatePatient ap ON ap.Id = pgar.AllocatePatientId
      JOIN Patient pt ON pt.Id = ap.PatientId
      JOIN Centre c ON c.Id = pt.CentreId
      WHERE pgarg.Status = 'Approved'
        AND (@centreId IS NULL OR c.Id = @centreId)
        AND ${centreExclusion}
        AND ${dateFilter}
    )`;
}

function buildClinicalPipelineQuery() {
  return `
    SELECT
      ${casesRegisteredCount()} AS registered,
      ${auditAssessmentCount('CaseAssigned')} AS assigned,
      ${auditAssessmentCount('AssessmentResultGenerated')} AS scoringComplete,
      ${auditAssessmentCount('ReportPDFGenerated')} AS reportPdfCreated,
      ${reportSharedCount()} AS reportShared,
      ${goalsAddedCount()} AS goalsAdded,
      ${goalsApprovedCount()} AS goalsApproved
  `;
}

function mapPipelineRow(row) {
  return {
    registered: row.registered ?? 0,
    assigned: row.assigned ?? 0,
    scoringComplete: row.scoringComplete ?? 0,
    reportPdfCreated: row.reportPdfCreated ?? 0,
    reportShared: row.reportShared ?? 0,
    goalsAdded: row.goalsAdded ?? 0,
    goalsApproved: row.goalsApproved ?? 0,
  };
}

module.exports = {
  buildClinicalPipelineQuery,
  mapPipelineRow,
  auditAssessmentCount,
  casesRegisteredCount,
  reportSharedCount,
  goalsAddedCount,
  goalsApprovedCount,
};
