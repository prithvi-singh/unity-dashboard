'use client';

import type { OnRoleDrillDown, ClinicalPipelineData } from '@/lib/roleDrillDown';
import { buildClinicalPipelineSteps } from '@/lib/clinicalPipelineSteps';
import { KPI } from '@/lib/kpiDefinitions';
import RoleFunnel from '@/components/shared/RoleFunnel';

interface Props {
  pipeline: ClinicalPipelineData | null | undefined;
  loading?: boolean;
  onDrillDown?: OnRoleDrillDown;
  title?: string;
  subtitle?: string;
  className?: string;
}

export default function ClinicalPipelineCard({
  pipeline,
  loading,
  onDrillDown,
  title = 'Clinical Pipeline',
  subtitle = 'Each step counts assessments — one child can have several (SPM, DP3, etc.)',
  className,
}: Props) {
  return (
    <div className={className}>
      <RoleFunnel
        title={title}
        subtitle={subtitle}
        tooltip={KPI.CLINICAL_PIPELINE}
        loading={loading}
        steps={buildClinicalPipelineSteps(pipeline)}
        onDrillDown={onDrillDown
          ? (req) => onDrillDown({
              type: req.type as Parameters<OnRoleDrillDown>[0]['type'],
              label: req.label,
            })
          : undefined}
      />
    </div>
  );
}
