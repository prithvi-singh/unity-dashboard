/** Plain-English labels for audit log event types — never show raw camelCase to staff. */
const AUDIT_EVENT_LABELS: Record<string, string> = {
  AssessmentResultGenerated: 'Assessment scored',
  AssessmentStatusChanged:   'Assessment status updated',
  ReportAdded:               'Report drafted',
  UpdateReport:              'Report edited',
  ReportPDFGenerated:        'Report approved',
  GoalAdded:                 'Goal added',
  GoalUpdated:               'Goal updated',
  CaseRegistered:            'Case registered',
  CaseAssigned:              'Clinician assigned',
  CaseTransfer:              'Assessment transferred',
  BaselineAdded:             'Baseline added',
  BaselineUpdated:           'Baseline updated',
  ProgressAdded:             'Progress noted',
  ActivityAdded:             'Case history updated',
  AssessmentAdd:             'Assessment added',
  Login:                     'Signed in',
};

/** Core-job action types — used to colour-code entries in recent actions table. */
export const CORE_JOB_TYPES = new Set([
  'AssessmentResultGenerated',
  'ReportAdded',
  'UpdateReport',
  'GoalAdded',
  'ActivityAdded',
  'ReportPDFGenerated',
  'GoalUpdated',
  'CaseRegistered',
  'CaseAssigned',
]);

export function labelAuditEvent(type: string | null | undefined): string {
  if (!type) return 'Unknown';
  return AUDIT_EVENT_LABELS[type] ?? type.replace(/([A-Z])/g, ' $1').trim();
}
