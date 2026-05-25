/** Plain-English labels for audit log event types — never show raw camelCase to staff. */
const AUDIT_EVENT_LABELS: Record<string, string> = {
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

export function labelAuditEvent(type: string | null | undefined): string {
  if (!type) return 'Unknown';
  return AUDIT_EVENT_LABELS[type] ?? type.replace(/([A-Z])/g, ' $1').trim();
}
