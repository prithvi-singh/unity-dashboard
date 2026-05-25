import type { ClinicalPipelineData } from '@/lib/roleDrillDown';
import type { FunnelStep } from '@/components/shared/RoleFunnel';
import { pctOf } from '@/components/shared/RoleFunnel';

const EMPTY: ClinicalPipelineData = {
  assigned: 0,
  scoringComplete: 0,
  reportPdfCreated: 0,
  reportShared: 0,
  goalsAdded: 0,
  goalsApproved: 0,
};

export function buildClinicalPipelineSteps(
  pipeline: ClinicalPipelineData | null | undefined,
): FunnelStep[] {
  const pipe = pipeline ?? EMPTY;

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
      pctLabel: pctOf(pipe.scoringComplete, pipe.assigned),
      drillType: 'clinician-pipeline-scoring',
      drillLabel: 'Scoring complete',
    },
    {
      label: 'Report PDF created',
      value: pipe.reportPdfCreated,
      barColor: 'bg-blue-500',
      ownerHint: 'Clinician',
      pctLabel: pctOf(pipe.reportPdfCreated, pipe.assigned),
      drillType: 'clinician-pipeline-report-pdf',
      drillLabel: 'Report PDF created',
    },
    {
      label: 'Report shared',
      value: pipe.reportShared,
      barColor: 'bg-indigo-500',
      ownerHint: 'Manager',
      pctLabel: pctOf(pipe.reportShared, pipe.assigned),
      drillType: 'clinician-pipeline-report-shared',
      drillLabel: 'Report shared with family',
    },
    {
      label: 'Goals added',
      value: pipe.goalsAdded,
      barColor: 'bg-violet-500',
      ownerHint: 'Clinician',
      pctLabel: pctOf(pipe.goalsAdded, pipe.assigned),
      drillType: 'clinician-pipeline-goals-added',
      drillLabel: 'Goals added',
    },
    {
      label: 'Goals approved',
      value: pipe.goalsApproved,
      barColor: 'bg-purple-600',
      ownerHint: 'Manager',
      pctLabel: pctOf(pipe.goalsApproved, pipe.assigned),
      drillType: 'clinician-pipeline-goals-approved',
      drillLabel: 'Goals approved',
    },
  ];
}
