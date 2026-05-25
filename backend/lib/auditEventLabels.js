'use strict';

/** Plain-English labels for PatientAuditLog Type values — never show raw camelCase to staff. */
const AUDIT_EVENT_LABELS = {
  CaseRegistered: 'Case registered',
  CaseAssigned: 'Assessment assigned',
  AssessmentResultGenerated: 'Scoring complete',
  ReportPDFGenerated: 'Report PDF created',
  CaseTransfer: 'Case transferred',
  CaseStatusChanged: 'Case status changed',
  Login: 'Signed in',
  AssessmentAdd: 'Assessment added',
  BaselineAdded: 'Baseline added',
  BaselineUpdated: 'Baseline updated',
  GoalAdded: 'Goals added',
  GoalUpdated: 'Goals updated',
  ProgressAdded: 'Progress recorded',
  ReportAdded: 'Report added',
  UpdateReport: 'Report updated',
};

function labelAuditEvent(type) {
  if (!type) return 'Unknown';
  return AUDIT_EVENT_LABELS[type] ?? type.replace(/([A-Z])/g, ' $1').trim();
}

module.exports = { AUDIT_EVENT_LABELS, labelAuditEvent };
