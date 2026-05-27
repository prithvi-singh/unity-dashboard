import type { ClinicalPipelineData } from '@/lib/roleDrillDown';
import type { FunnelStep } from '@/components/shared/RoleFunnel';

const EMPTY: ClinicalPipelineData = {
  assigned: 0,
  scoringComplete: 0,
  reportPdfCreated: 0,
  reportShared: 0,
  goalsAdded: 0,
  goalsApproved: 0,
};

function pct(part: number, base: number): number | undefined {
  if (base <= 0) return undefined;
  return Math.round((part / base) * 100);
}

export function buildClinicalPipelineSteps(
  pipeline: ClinicalPipelineData | null | undefined,
): FunnelStep[] {
  const pipe = pipeline ?? EMPTY;
  const base = pipe.assigned;

  return [
    {
      label: 'Assigned',
      value: pipe.assigned,
      barColor: 'bg-emerald-500',
      ownerHint: 'Manager or admin',
      drillType: 'clinician-pipeline-assigned',
      drillLabel: 'Assessments assigned',
    },
    {
      label: 'Scoring complete',
      value: pipe.scoringComplete,
      barColor: 'bg-teal-500',
      ownerHint: 'Clinician',
      pct: pct(pipe.scoringComplete, base),
      drillType: 'clinician-pipeline-scoring',
      drillLabel: 'Scoring complete',
    },
    {
      label: 'Report PDF created',
      value: pipe.reportPdfCreated,
      barColor: 'bg-blue-500',
      ownerHint: 'Clinician',
      pct: pct(pipe.reportPdfCreated, base),
      drillType: 'clinician-pipeline-report-pdf',
      drillLabel: 'Report PDF created',
    },
    {
      label: 'Report shared',
      value: pipe.reportShared,
      barColor: 'bg-indigo-500',
      ownerHint: 'Manager',
      pct: pct(pipe.reportShared, base),
      drillType: 'clinician-pipeline-report-shared',
      drillLabel: 'Report shared with family',
    },
    {
      label: 'Cases with goals added',
      value: pipe.goalsAdded,
      barColor: 'bg-violet-500',
      ownerHint: 'Clinician',
      pct: pct(pipe.goalsAdded, base),
      drillType: 'clinician-pipeline-goals-added',
      drillLabel: 'Cases with goals added',
    },
    {
      label: 'Goals approved',
      value: pipe.goalsApproved,
      barColor: 'bg-purple-600',
      ownerHint: 'Manager',
      pct: pct(pipe.goalsApproved, base),
      drillType: 'clinician-pipeline-goals-approved',
      drillLabel: 'Goals approved',
    },
  ];
}
