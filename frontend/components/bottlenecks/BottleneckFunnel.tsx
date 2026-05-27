'use client';

import type { BottleneckData } from '@/lib/types';
import type { BottleneckDrillDownType, OnBottleneckDrillDown } from '@/lib/bottleneckDrillDown';
import RoleFunnel from '@/components/shared/RoleFunnel';

interface Props {
  data: BottleneckData | null;
  loading: boolean;
  onDrillDown?: OnBottleneckDrillDown;
}

const FUNNEL_STAGES: {
  key: keyof BottleneckData['funnel'];
  label: string;
  ownerHint?: string;
  barColor: string;
  type: BottleneckDrillDownType;
  drillLabel: string;
}[] = [
  { key: 'registered', label: 'Cases registered', barColor: 'bg-blue-500', type: 'funnel-registered', drillLabel: 'Cases registered' },
  { key: 'assigned', label: 'Assessments assigned', ownerHint: 'Manager or admin', barColor: 'bg-violet-500', type: 'funnel-assigned', drillLabel: 'Assessments assigned' },
  { key: 'scoringComplete', label: 'Scoring complete', ownerHint: 'Clinician', barColor: 'bg-teal-500', type: 'funnel-scoring', drillLabel: 'Scoring complete' },
  { key: 'reportPdfCreated', label: 'Report PDF created', ownerHint: 'Clinician', barColor: 'bg-emerald-500', type: 'funnel-report-pdf', drillLabel: 'Report PDF created' },
  { key: 'reportShared', label: 'Report shared', ownerHint: 'Manager', barColor: 'bg-indigo-500', type: 'funnel-report-shared', drillLabel: 'Report shared with family' },
  { key: 'goalsAdded', label: 'Cases with goals added', ownerHint: 'Clinician', barColor: 'bg-purple-500', type: 'funnel-goals-added', drillLabel: 'Cases with goals added' },
  { key: 'goalsApproved', label: 'Goals approved', ownerHint: 'Manager', barColor: 'bg-sky-500', type: 'funnel-goals-approved', drillLabel: 'Goals approved' },
];

export default function BottleneckFunnel({ data, loading, onDrillDown }: Props) {
  if (!data?.funnel && !loading) return null;

  const funnel = data?.funnel ?? {
    registered: 0,
    assigned: 0,
    scoringComplete: 0,
    reportPdfCreated: 0,
    reportShared: 0,
    goalsAdded: 0,
    goalsApproved: 0,
  };

  const opsFlags = (data?.statusChangeCount ?? 0) + (data?.transferCount ?? 0);

  return (
    <div className="flex flex-col gap-5">
      <RoleFunnel
        title="Pipeline SLA Funnel"
        subtitle="Where assessments drop off · click a stage to see details"
        loading={loading && !data}
        onDrillDown={onDrillDown
          ? (req) => onDrillDown({ type: req.type as BottleneckDrillDownType, label: req.label })
          : undefined}
        steps={FUNNEL_STAGES.map((stage) => {
          const value = Number(funnel[stage.key] ?? 0);
          const pctBase = stage.key === 'assigned' ? funnel.registered : funnel.assigned;
          const pct = pctBase > 0 ? Math.round((value / pctBase) * 100) : undefined;
          return {
            label: stage.label,
            value,
            barColor: stage.barColor,
            ownerHint: stage.ownerHint,
            pct,
            drillType: stage.type,
            drillLabel: stage.drillLabel,
          };
        })}
      />
      {data && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-[0_1px_3px_rgba(0,0,0,0.06),0_6px_24px_rgba(0,0,0,0.04)] px-5 py-4">
          {opsFlags > 0 ? (
            <div className="flex items-center gap-2.5 flex-wrap">
              <span className="text-[12px] font-medium text-gray-500 uppercase tracking-[0.03em] mr-1">Operational</span>
              {data.statusChangeCount > 0 && (
                <button
                  type="button"
                  onClick={() => onDrillDown?.({ type: 'status-changes', label: 'Case status changes' })}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-rose-50 rounded-lg hover:bg-rose-100 transition-colors cursor-pointer"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-rose-500 flex-shrink-0" />
                  <span className="text-xs font-semibold text-rose-700">{data.statusChangeCount} Status changes</span>
                </button>
              )}
              {data.transferCount > 0 && (
                <button
                  type="button"
                  onClick={() => onDrillDown?.({ type: 'transfers', label: 'Case transfers' })}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-amber-50 rounded-lg hover:bg-amber-100 transition-colors cursor-pointer"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500 flex-shrink-0" />
                  <span className="text-xs font-semibold text-amber-700">{data.transferCount} Transfers</span>
                </button>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 flex-shrink-0" />
              <span className="text-xs text-gray-400">No operational flags in this period</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
