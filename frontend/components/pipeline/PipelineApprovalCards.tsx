'use client';

import type { PipelineManagerApprovalStats } from '@/lib/types';

interface Props {
  stats: PipelineManagerApprovalStats | null;
  loading: boolean;
}

function rateColor(rate: number): { ring: string; bg: string; text: string; label: string } {
  if (rate >= 90) return { ring: 'ring-emerald-200', bg: 'bg-emerald-50',  text: 'text-emerald-700', label: 'On track' };
  if (rate >= 70) return { ring: 'ring-amber-200',   bg: 'bg-amber-50',    text: 'text-amber-700',   label: 'Needs attention' };
  return          { ring: 'ring-rose-200',    bg: 'bg-rose-50',     text: 'text-rose-700',    label: 'Action needed' };
}

function RateCard({
  title,
  rate,
  avgHours,
  loading,
  description,
}: {
  title: string;
  rate: number;
  avgHours: number | null;
  loading: boolean;
  description: string;
}) {
  const color = rateColor(rate);

  if (loading) {
    return (
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-4 animate-pulse">
        <div className="h-4 w-32 bg-gray-100 rounded" />
        <div className="h-12 w-24 bg-gray-100 rounded" />
        <div className="h-3 w-48 bg-gray-50 rounded" />
      </div>
    );
  }

  return (
    <div className={`bg-white rounded-2xl border border-gray-100 shadow-[0_1px_3px_rgba(0,0,0,0.06),0_6px_24px_rgba(0,0,0,0.04)] p-6 ring-2 ${color.ring} transition-all`}>
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <h3 className="text-[12px] font-bold text-gray-400 uppercase tracking-[0.07em]">{title}</h3>
          <p className="text-[11px] text-gray-400 mt-0.5">{description}</p>
        </div>
        <span className={`text-[10px] font-bold px-2 py-1 rounded-full ${color.bg} ${color.text} whitespace-nowrap`}>
          {color.label}
        </span>
      </div>

      <div className="flex items-end gap-3">
        <span className={`text-5xl font-black tracking-tight leading-none ${color.text}`}>
          {rate.toFixed(0)}
          <span className="text-2xl font-bold">%</span>
        </span>
        {avgHours != null && (
          <div className="mb-1">
            <div className="text-[11px] text-gray-400 leading-tight">avg turnaround</div>
            <div className="text-[15px] font-bold text-gray-700 leading-tight">
              {avgHours < 24
                ? `${avgHours.toFixed(0)}h`
                : `${(avgHours / 24).toFixed(1)}d`}
            </div>
          </div>
        )}
      </div>

      {/* Progress bar */}
      <div className="mt-5 h-2 bg-gray-100 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-700 ${
            rate >= 90 ? 'bg-gradient-to-r from-emerald-400 to-emerald-500' :
            rate >= 70 ? 'bg-gradient-to-r from-amber-400 to-amber-500' :
                         'bg-gradient-to-r from-rose-400 to-rose-500'
          }`}
          style={{ width: `${Math.min(100, rate)}%` }}
        />
      </div>
      <div className="flex justify-between mt-1.5 text-[10px] text-gray-300">
        <span>0%</span>
        <span className="text-gray-400 font-semibold">Target: 90%</span>
        <span>100%</span>
      </div>
    </div>
  );
}

export default function PipelineApprovalCards({ stats, loading }: Props) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <RateCard
        title="Report Approval Rate"
        rate={stats?.reportApprovalRate ?? 0}
        avgHours={stats?.reportAvgApprovalHours ?? null}
        loading={loading && !stats}
        description="Reports shared with families vs total PDFs generated"
      />
      <RateCard
        title="Goal Approval Rate"
        rate={stats?.goalApprovalRate ?? 0}
        avgHours={stats?.goalAvgApprovalHours ?? null}
        loading={loading && !stats}
        description="Goal lines approved by managers vs total submitted"
      />
    </div>
  );
}
