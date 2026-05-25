import type { BottleneckDrillDownRequest } from './bottleneckDrillDown';
import type { RoleDrillDownRequest } from './roleDrillDown';
import { IDLE_CLINICIAN_DRILL_TITLE } from './idleClinician';

export type ActionFocusId =
  | 'bottleneck-stuck-onboarding'
  | 'bottleneck-pending-goals'
  | 'bottleneck-incomplete-assessments'
  | 'bottleneck-action-table'
  | 'clinician-idle'
  | 'assess-overdue';

export type BottleneckActionSortCol = 'stuckOnboarding' | 'pendingGoals' | 'incompleteAssessments';

export interface ActionNavigationTarget {
  tab: number;
  focusId: ActionFocusId;
  bottleneckDrillDown?: BottleneckDrillDownRequest;
  roleDrillDown?: RoleDrillDownRequest;
  bottleneckSort?: BottleneckActionSortCol;
}

export type ActionSignalId =
  | 'stuck-onboarding'
  | 'pending-goals'
  | 'idle-clinicians'
  | 'incomplete-assessments'
  | 'overdue-assessments';

// Tab indices after consolidation:
//   0 = Overview   1 = Live (Monitoring)   2 = Team   3 = Issues
export const ACTION_SIGNAL_NAV: Record<
  ActionSignalId,
  ActionNavigationTarget & { cta: string }
> = {
  'stuck-onboarding': {
    tab: 3,
    focusId: 'bottleneck-stuck-onboarding',
    cta: 'Show stuck cases',
    bottleneckDrillDown: {
      type: 'stuck-onboarding',
      label: 'Cases stuck in onboarding (>48h)',
    },
  },
  'pending-goals': {
    tab: 3,
    focusId: 'bottleneck-action-table',
    cta: 'Open goal queue',
    bottleneckSort: 'pendingGoals',
    bottleneckDrillDown: {
      type: 'pending-goals',
      label: 'Pending goal approvals',
    },
  },
  'idle-clinicians': {
    tab: 2,
    focusId: 'clinician-idle',
    cta: 'Review idle staff',
    roleDrillDown: {
      type: 'clinician-inactive',
      label: IDLE_CLINICIAN_DRILL_TITLE,
    },
  },
  'incomplete-assessments': {
    tab: 3,
    focusId: 'bottleneck-incomplete-assessments',
    cta: 'Show incomplete',
    bottleneckDrillDown: {
      type: 'incomplete-assessments',
      label: 'Incomplete assessments',
    },
  },
  'overdue-assessments': {
    tab: 3,
    focusId: 'assess-overdue',
    cta: 'View overdue',
  },
};
