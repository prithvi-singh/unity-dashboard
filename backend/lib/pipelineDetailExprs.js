'use strict';

function staffName(alias) {
  return `ISNULL(LTRIM(RTRIM(CONCAT(ISNULL(${alias}.FirstName, ''), ' ', ISNULL(${alias}.LastName, '')))), 'Unknown')`;
}

/** Who logged this audit event on the assessment (from pal.AdminUserId via subquery). */
function auditActorNameExpr(auditType) {
  return `(
    SELECT TOP 1 LTRIM(RTRIM(CONCAT(ISNULL(a.FirstName, ''), ' ', ISNULL(a.LastName, ''))))
    FROM PatientAuditLog p2
    JOIN AdminUser a ON a.Id = p2.AdminUserId
    WHERE p2.AllocatePatientId = ap.Id
      AND p2.Type = '${auditType}'
    ORDER BY p2.CreatedDateTime ASC
  )`;
}

/** Assessment type, assigned clinician, and staff member who performed the audit action. */
function pipelineAuditDetailExpr(auditType, actionLabel = 'By') {
  return `CONCAT(
    ISNULL(ap.Assessment, 'Assessment'),
    ' · Clinician: ', ${staffName('clin')},
    ' · ${actionLabel}: ', ISNULL(${auditActorNameExpr(auditType)}, 'Unknown')
  )`;
}

/** Case registration — who registered the child. */
function caseRegisteredDetailExpr() {
  return `CONCAT(
    'Registered by: ',
    ISNULL((
      SELECT TOP 1 LTRIM(RTRIM(CONCAT(ISNULL(a.FirstName, ''), ' ', ISNULL(a.LastName, ''))))
      FROM PatientAuditLog p2
      JOIN AdminUser a ON a.Id = p2.AdminUserId
      WHERE p2.PatientId = pt.Id AND p2.Type = 'CaseRegistered'
      ORDER BY p2.CreatedDateTime ASC
    ), 'Unknown')
  )`;
}

function pipelineReportSharedDetailExpr() {
  return `CONCAT(
    ISNULL(ap.Assessment, 'Assessment'),
    ' · Clinician: ', ${staffName('clin')},
    ' · Shared by: ', ISNULL(NULLIF(LTRIM(RTRIM(apr.CreatedBy)), ''), 'Unknown')
  )`;
}

function pipelineGoalsAddedDetailExpr() {
  return `CONCAT(
    ISNULL(ap.Assessment, 'Assessment'),
    ' · Clinician: ', ${staffName('clin')},
    ' · Submitted by: ', ISNULL(NULLIF(LTRIM(RTRIM(pgarg.CreatedBy)), ''), 'Unknown')
  )`;
}

function pipelineGoalsApprovedDetailExpr() {
  return `CONCAT(
    ISNULL(ap.Assessment, 'Assessment'),
    ' · Clinician: ', ${staffName('clin')},
    ' · Approved by: ', ISNULL(NULLIF(LTRIM(RTRIM(pgarg.UpdatedBy)), ''), 'Unknown')
  )`;
}

module.exports = {
  staffName,
  pipelineAuditDetailExpr,
  caseRegisteredDetailExpr,
  pipelineReportSharedDetailExpr,
  pipelineGoalsAddedDetailExpr,
  pipelineGoalsApprovedDetailExpr,
};
