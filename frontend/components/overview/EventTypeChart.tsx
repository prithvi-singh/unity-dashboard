'use client';

import type { OverviewData } from '@/lib/types';
import RoleFunnel, { pctOf } from '@/components/shared/RoleFunnel';

interface Props {
  data: OverviewData | null;
  loading: boolean;
}

export default function EventTypeChart({ data, loading }: Props) {
  if (!data && !loading) return null;

  const pipe = data?.pipeline ?? {
    registered: data?.totalCases ?? 0,
    assigned: data?.totalAssessments ?? 0,
    scoringComplete: data?.totalScoringComplete ?? 0,
    reportPdfCreated: data?.totalResults ?? 0,
    reportShared: 0,
    goalsAdded: 0,
    goalsApproved: 0,
  };

  const alerts = (data?.totalStatusChanges ?? 0) + (data?.totalTransfers ?? 0);

  return (
    <div className="flex flex-col gap-5">
      <RoleFunnel
        title="Care Pathway Throughput"
        subtitle="Each step counts assessments — one child can have several (SPM, DP3, etc.)"
        loading={loading && !data}
        steps={[
          {
            label: 'Cases registered',
            value: pipe.registered,
            barColor: 'bg-blue-500',
          },
          {
            label: 'Assessments assigned',
            value: pipe.assigned,
            barColor: 'bg-violet-500',
            ownerHint: 'Manager or admin',
            pctLabel: pipe.registered > 0
              ? `${Math.round((pipe.assigned / pipe.registered) * 100)}% of registered cases reached assignment`
              : undefined,
          },
          {
            label: 'Scoring complete',
            value: pipe.scoringComplete,
            barColor: 'bg-teal-500',
            ownerHint: 'Clinician',
            pctLabel: pctOf(pipe.scoringComplete, pipe.assigned),
          },
          {
            label: 'Report PDF created',
            value: pipe.reportPdfCreated,
            barColor: 'bg-emerald-500',
            ownerHint: 'Clinician',
            pctLabel: pctOf(pipe.reportPdfCreated, pipe.assigned),
          },
          {
            label: 'Report shared',
            value: pipe.reportShared,
            barColor: 'bg-indigo-500',
            ownerHint: 'Manager',
            pctLabel: pctOf(pipe.reportShared, pipe.assigned),
          },
          {
            label: 'Cases with goals added',
            value: pipe.goalsAdded,
            barColor: 'bg-purple-500',
            ownerHint: 'Clinician',
            pctLabel: pctOf(pipe.goalsAdded, pipe.assigned),
          },
          {
            label: 'Goals approved',
            value: pipe.goalsApproved,
            barColor: 'bg-sky-500',
            ownerHint: 'Manager',
            pctLabel: pctOf(pipe.goalsApproved, pipe.assigned),
          },
        ]}
      />
      {data && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-[0_1px_3px_rgba(0,0,0,0.06),0_6px_24px_rgba(0,0,0,0.04)] px-5 py-4">
          {alerts > 0 ? (
            <div className="flex items-center gap-2.5 flex-wrap">
              <span className="text-[12px] font-medium text-gray-500 uppercase tracking-[0.03em] mr-1">Operational</span>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-rose-50 rounded-lg">
                <span className="w-1.5 h-1.5 rounded-full bg-rose-500 flex-shrink-0" />
                <span className="text-xs font-semibold text-rose-700">{data.totalStatusChanges} Resets</span>
              </span>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-amber-50 rounded-lg">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500 flex-shrink-0" />
                <span className="text-xs font-semibold text-amber-700">{data.totalTransfers} Transfers</span>
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 flex-shrink-0" />
              <span className="text-[12px] text-gray-500">No operational flags in this period</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
