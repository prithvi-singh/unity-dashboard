import type { FilterParams } from './types';

export type RoleDrillDownType =
  | 'clinician-caseload'
  | 'clinician-stuck'
  | 'clinician-results'
  | 'clinician-inactive'
  | 'clinician-pipeline-assigned'
  | 'clinician-pipeline-scoring'
  | 'clinician-pipeline-report-pdf'
  | 'clinician-pipeline-report-shared'
  | 'clinician-pipeline-goals-added'
  | 'clinician-pipeline-goals-approved'
  | 'manager-registered'
  | 'manager-assigned'
  | 'manager-stuck-onboarding'
  | 'admin-registered'
  | 'admin-assigned'
  | 'admin-unassigned';

export interface RoleDrillDownParams extends FilterParams {
  type: RoleDrillDownType;
  drillCentreId?: number;
  drillUserId?: number;
}

export interface RoleDrillDownItem {
  category: string | null;
  patientId: number;
  patientCode: string | null;
  patientName: string;
  centreId: number;
  centreName: string;
  eventAt: string | null;
  waitingHours: number | null;
  status: string | null;
  detail: string | null;
}

export interface RoleDrillDownResponse {
  type: RoleDrillDownType;
  title: string;
  count: number;
  truncated: boolean;
  items: RoleDrillDownItem[];
}

export interface RoleDrillDownRequest {
  type: RoleDrillDownType;
  drillCentreId?: number;
  drillUserId?: number;
  label?: string;
}

export type OnRoleDrillDown = (request: RoleDrillDownRequest) => void;

export const DRILL_DOWN_HINT = 'View details';

export { formatWaitingHours, formatEventAt } from './bottleneckDrillDown';

export type RoleKind = 'clinician' | 'manager' | 'admin';

export interface RoleSummary {
  role: RoleKind;
  stuckCases?: number;
  inactiveCount?: number;
  stuckOnboarding?: number;
  unassignedCases?: number;
}

export interface RoleCentreRow {
  centreId: number;
  centreName: string;
  metric1: number;
  metric2: number;
  metric3: number;
}

export interface ClinicalPipelineData {
  registered?: number;
  assigned: number;
  scoringComplete: number;
  reportPdfCreated: number;
  reportShared: number;
  goalsAdded: number;
  goalsApproved: number;
}

export function centreRowTotal(row: RoleCentreRow): number {
  return row.metric1 + row.metric2 + row.metric3;
}
