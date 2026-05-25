import type { RoleCentreRow } from './roleDrillDown';

interface RoleCentreDatasetKey {
  label: string;
  metricKey: string;
  drillType: string;
}

/** Stable string key so Chart.js effects only re-run when values change, not array references. */
export function roleCentreChartKey(
  rows: RoleCentreRow[],
  datasets: RoleCentreDatasetKey[],
): string {
  const rowsKey = rows
    .map((r) => `${r.centreId}:${r.metric1}:${r.metric2}:${r.metric3}`)
    .join('|');
  const datasetsKey = datasets
    .map((d) => `${d.label}:${d.metricKey}:${d.drillType}`)
    .join(';');
  return `${datasetsKey}::${rowsKey}`;
}

export interface PersonChartSegmentKey {
  label: string;
  value: number;
}

export interface PersonChartRowKey {
  fullLabel: string;
  segments: PersonChartSegmentKey[];
}

export function personChartKey(rows: PersonChartRowKey[]): string {
  const total = (r: PersonChartRowKey) =>
    r.segments.reduce((sum, seg) => sum + seg.value, 0);

  return [...rows]
    .sort((a, b) => total(b) - total(a) || a.fullLabel.localeCompare(b.fullLabel))
    .slice(0, 8)
    .map((r) => `${r.fullLabel}:${r.segments.map((s) => `${s.label}=${s.value}`).join(',')}`)
    .join('|');
}

export interface BottleneckCentreRowKey {
  centreId: number;
  stuckOnboarding: number;
  pendingGoals: number;
  incompleteAssessments: number;
}

export function bottleneckCentreChartKey(rows: BottleneckCentreRowKey[]): string {
  return rows
    .map((r) => `${r.centreId}:${r.stuckOnboarding}:${r.pendingGoals}:${r.incompleteAssessments}`)
    .join('|');
}
