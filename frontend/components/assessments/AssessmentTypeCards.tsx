'use client';

import type { AssessmentTypeSummary, AssessmentOverviewData } from '@/lib/types';
import { KpiTooltip } from '@/components/shared/KpiTooltip';

interface Props {
  data: AssessmentOverviewData | null;
  loading: boolean;
  error: string | null;
}

function rateColor(rate: number): { text: string; dot: string } {
  if (rate >= 80) return { text: 'text-emerald-700', dot: '#059669' };
  if (rate >= 50) return { text: 'text-amber-700', dot: '#D97706' };
  return { text: 'text-rose-700', dot: '#E11D48' };
}

const TYPE_META: Record<string, { label: string; desc: string; iconBg: string; iconFg: string }> = {
  SPM:   { label: 'SPM',   desc: 'Sensory Processing Measure',                    iconBg: 'bg-blue-50',   iconFg: 'text-blue-600'   },
  DP3:   { label: 'DP3',   desc: 'Developmental Profile 3',                        iconBg: 'bg-violet-50', iconFg: 'text-violet-600' },
  REELS: { label: 'REELS', desc: 'Receptive–Expressive Emergent Language Scale',   iconBg: 'bg-sky-50',    iconFg: 'text-sky-600'    },
  ISAA:  { label: 'ISAA',  desc: 'Indian Scale for Assessment of Autism',          iconBg: 'bg-indigo-50', iconFg: 'text-indigo-600' },
};

const TOOLTIPS = {
  completionRate: {
    title: 'Completion Rate',
    description: 'Assigned assessments with a result. Below 80% = stalled cases.',
  },
  total: {
    title: 'Total Assigned',
    description: 'All assignments of this type in the period. Managers assign; one child can have several.',
  },
  pending: {
    title: 'Pending',
    description: 'Assigned, no result yet. Clinician action. Follow up after 14 days.',
  },
  avgDays: {
    title: 'Avg Days to Result',
    description: 'Assignment to result for completed work. Rising average = overload signal.',
  },
  goalApproval: {
    title: 'Goals Pending',
    description: 'Awaiting manager approval. Blocks the clinician until cleared.',
  },
};

function rateTag(rate: number, total: number): { text: string; cls: string } | null {
  if (total === 0) return null;
  if (rate >= 80) return { text: 'On track', cls: 'text-emerald-600' };
  if (rate >= 50) return { text: 'Clinician to action', cls: 'text-amber-500' };
  return { text: 'Clinician + Manager', cls: 'text-rose-600' };
}

function AssessmentCard({ summary }: { summary: AssessmentTypeSummary }) {
  const meta = TYPE_META[summary.type] ?? { label: summary.type, desc: '', iconBg: 'bg-gray-50', iconFg: 'text-gray-500' };
  const c = rateColor(summary.completionRate);
  const tag = rateTag(summary.completionRate, summary.total);

  return (
    <div
      className="bg-white rounded-xl border border-gray-100 shadow-[0_1px_3px_rgba(0,0,0,0.06),0_4px_16px_rgba(0,0,0,0.03)] p-4 flex flex-col gap-3"
      role="listitem"
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <span className={`inline-flex px-2 py-0.5 rounded-md text-[11px] font-bold tracking-wide ${meta.iconBg} ${meta.iconFg}`}>
            {meta.label}
          </span>
          <p className="text-[10px] text-gray-400 mt-1 leading-snug truncate" title={meta.desc}>{meta.desc}</p>
        </div>
        {summary.goalApprovalPending > 0 && (
          <div className="flex items-center gap-1 shrink-0">
            <span className="text-[9.5px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-md whitespace-nowrap">
              {summary.goalApprovalPending} goal{summary.goalApprovalPending !== 1 ? 's' : ''} pending
            </span>
            <KpiTooltip {...TOOLTIPS.goalApproval} />
          </div>
        )}
      </div>

      {/* Completion rate + bar */}
      <div>
        <div className="flex items-baseline justify-between gap-2 mb-2">
          <div className="flex items-baseline gap-1">
            <span className={`text-[1.6rem] font-bold leading-none tabular-nums ${c.text}`}>
              {summary.completionRate.toFixed(1)}%
            </span>
            <KpiTooltip {...TOOLTIPS.completionRate} />
          </div>
          {tag && (
            <span className={`text-[9.5px] font-semibold shrink-0 ${tag.cls}`}>{tag.text}</span>
          )}
        </div>
        <div className="h-1 bg-gray-100 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full"
            style={{ width: `${Math.min(summary.completionRate, 100)}%`, background: c.dot, transition: 'width 0.7s ease' }}
          />
        </div>
      </div>

      {/* Stats row */}
      <div className="flex items-stretch divide-x divide-gray-100 pt-2 border-t border-gray-50">
        {[
          { label: 'Total',    tip: TOOLTIPS.total,   val: summary.total.toLocaleString(),    cls: 'text-gray-700' },
          { label: 'Pending',  tip: TOOLTIPS.pending, val: summary.pending.toLocaleString(),  cls: summary.pending > 0 ? 'text-amber-600' : 'text-gray-700' },
          { label: 'Avg Days', tip: TOOLTIPS.avgDays, val: summary.avgDaysToComplete !== null ? `${summary.avgDaysToComplete.toFixed(1)}d` : '—', cls: 'text-gray-700' },
        ].map(({ label, tip, val, cls }) => (
          <div key={label} className="flex-1 text-center px-1 first:pl-0 last:pr-0">
            <div className="flex items-center justify-center gap-0.5 mb-0.5">
              <span className="text-[9px] font-bold text-gray-400 uppercase tracking-wide">{label}</span>
              <KpiTooltip {...tip} />
            </div>
            <span className={`text-[13px] font-bold tabular-nums ${cls}`}>{val}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Skeleton() {
  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-[0_1px_3px_rgba(0,0,0,0.06)] p-4 animate-pulse flex flex-col gap-3">
      <div className="flex justify-between items-start">
        <div className="space-y-1.5">
          <div className="h-5 w-12 bg-gray-100 rounded-md" />
          <div className="h-2.5 w-28 bg-gray-100 rounded" />
        </div>
      </div>
      <div>
        <div className="h-7 w-16 bg-gray-100 rounded mb-2" />
        <div className="h-1 bg-gray-100 rounded-full" />
      </div>
      <div className="flex divide-x divide-gray-100 pt-2 border-t border-gray-50">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex-1 text-center px-1 space-y-1">
            <div className="h-2 w-8 bg-gray-100 rounded mx-auto" />
            <div className="h-3.5 w-6 bg-gray-100 rounded mx-auto" />
          </div>
        ))}
      </div>
    </div>
  );
}

export default function AssessmentTypeCards({ data, loading, error }: Props) {
  if (error) {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 flex items-center gap-2">
        <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
        Failed to load assessment data: {error}
      </div>
    );
  }

  if (loading || !data) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4" aria-busy="true">
        {[0, 1, 2, 3].map((i) => <Skeleton key={i} />)}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3" role="list" aria-label="Assessment type summaries">
      {data.byType.map((summary) => (
        <AssessmentCard key={summary.type} summary={summary} />
      ))}
    </div>
  );
}
