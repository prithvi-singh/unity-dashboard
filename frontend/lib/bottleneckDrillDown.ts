import type { FilterParams } from './types';

export type BottleneckDrillDownType =
  | 'stuck-onboarding'
  | 'pending-goals'
  | 'incomplete-assessments'
  | 'all-actions'
  | 'slow-onboarding'
  | 'slow-goal-approval'
  | 'status-changes'
  | 'transfers'
  | 'funnel-registered'
  | 'funnel-assigned'
  | 'funnel-scoring'
  | 'funnel-report-pdf'
  | 'funnel-report-shared'
  | 'funnel-goals-added'
  | 'funnel-results'
  | 'funnel-goals-approved'
  | 'weekly-onboarding'
  | 'weekly-goal-approval'
  | 'centre-severity';

export type BottleneckSeverity = 'critical' | 'watch';

export interface BottleneckDrillDownParams extends FilterParams {
  type: BottleneckDrillDownType;
  drillCentreId?: number;
  weekStart?: string;
  weekEnd?: string;
  severity?: BottleneckSeverity;
}

export interface BottleneckDrillDownRequest {
  type: BottleneckDrillDownType;
  drillCentreId?: number;
  weekStart?: string;
  weekEnd?: string;
  severity?: BottleneckSeverity;
  label?: string;
}

export interface BottleneckDrillDownItem {
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

export interface BottleneckDrillDownResponse {
  type: BottleneckDrillDownType;
  title: string;
  count: number;
  truncated: boolean;
  items: BottleneckDrillDownItem[];
}

export type OnBottleneckDrillDown = (request: BottleneckDrillDownRequest) => void;

export const DRILL_DOWN_HINT = 'View details';

export function weekEndFromStart(weekStart: string): string {
  const d = new Date(`${weekStart}T12:00:00`);
  d.setDate(d.getDate() + 7);
  return d.toISOString().slice(0, 10);
}

export function formatWeekLabel(weekStart: string): string {
  const d = new Date(`${weekStart}T12:00:00`);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

export function formatWaitingHours(hours: number | null): string {
  if (hours === null) return '—';
  if (hours < 24) return `${hours.toFixed(1)}h`;
  const days = Math.floor(hours / 24);
  const rem = hours % 24;
  return rem >= 1 ? `${days}d ${rem.toFixed(0)}h` : `${days}d`;
}

export function formatEventAt(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
