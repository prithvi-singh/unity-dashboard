'use client';

import { useState } from 'react';
import type { PipelineManagerRow } from '@/lib/types';
import ScrollRegion from '@/components/shared/ScrollRegion';

interface Props {
  rows: PipelineManagerRow[];
  loading: boolean;
}

function RateBadge({ rate }: { rate: number }) {
  const color =
    rate >= 90 ? 'bg-emerald-100 text-emerald-700' :
    rate >= 70 ? 'bg-amber-100 text-amber-700' :
                 'bg-rose-100 text-rose-700';
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-bold ${color}`}>
      {rate.toFixed(0)}%
    </span>
  );
}

function PendingBadge({ count }: { count: number }) {
  if (count === 0) return <span className="text-[12px] text-gray-400">—</span>;
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-rose-50 text-rose-600 rounded text-[11px] font-bold">
      <span className="w-1.5 h-1.5 rounded-full bg-rose-400 flex-shrink-0" />
      {count}
    </span>
  );
}

export default function PipelineManagerTable({ rows, loading }: Props) {
  const [hover, setHover] = useState<number | null>(null);

  if (loading && !rows.length) {
    return (
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
        <div className="h-4 w-48 bg-gray-100 rounded animate-pulse mb-5" />
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-10 bg-gray-50 rounded-lg animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (!rows.length) {
    return (
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
        <p className="text-sm text-gray-400 text-center py-8">No manager approval data for this period.</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-[0_1px_3px_rgba(0,0,0,0.06),0_6px_24px_rgba(0,0,0,0.04)] overflow-hidden">
      <div className="px-6 pt-5 pb-4">
        <h2 className="text-[15px] font-bold text-gray-900 tracking-[-0.01em]">Approval Rates by Manager</h2>
        <p className="text-[12px] text-gray-400 mt-0.5">
          Sorted by worst performers first — lowest approval rate at top
        </p>
      </div>

      <ScrollRegion maxHeightClass="max-h-[480px]" label="table">
        <table className="w-full text-sm" role="table" aria-label="Manager approval rates">
          <thead>
            <tr className="border-t border-gray-50">
              <th className="px-6 py-3 text-left text-[10px] font-bold text-gray-400 uppercase tracking-[0.07em]">Manager</th>
              <th className="px-4 py-3 text-left text-[10px] font-bold text-gray-400 uppercase tracking-[0.07em]">Centre</th>
              <th className="px-4 py-3 text-center text-[10px] font-bold text-gray-400 uppercase tracking-[0.07em]">Report Approval</th>
              <th className="px-4 py-3 text-center text-[10px] font-bold text-gray-400 uppercase tracking-[0.07em]">Report Pending</th>
              <th className="px-4 py-3 text-center text-[10px] font-bold text-gray-400 uppercase tracking-[0.07em]">Goal Approval</th>
              <th className="px-4 py-3 text-center text-[10px] font-bold text-gray-400 uppercase tracking-[0.07em]">Goal Pending</th>
              <th className="px-4 py-3 text-right text-[10px] font-bold text-gray-400 uppercase tracking-[0.07em]">Avg Turnaround</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const isHovered = hover === i;
              const hasAlert = row.reportApprovalRate < 70 || row.goalApprovalRate < 70;
              return (
                <tr
                  key={`${row.managerId}-${row.centreName}`}
                  onMouseEnter={() => setHover(i)}
                  onMouseLeave={() => setHover(null)}
                  className={[
                    'border-t border-gray-50 transition-colors duration-100',
                    isHovered ? 'bg-gray-50/80' : '',
                    hasAlert && !isHovered ? 'bg-rose-50/30' : '',
                  ].join(' ')}
                >
                  <td className="px-6 py-3.5">
                    <div className="flex items-center gap-2">
                      {hasAlert && (
                        <span className="w-1.5 h-1.5 rounded-full bg-rose-400 flex-shrink-0" aria-hidden />
                      )}
                      <span className="font-semibold text-gray-800 text-[13px]">
                        {row.firstName} {row.lastName}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3.5 text-[12px] text-gray-500">{row.centreName}</td>
                  <td className="px-4 py-3.5 text-center">
                    <RateBadge rate={row.reportApprovalRate} />
                  </td>
                  <td className="px-4 py-3.5 text-center">
                    <PendingBadge count={row.reportPending} />
                  </td>
                  <td className="px-4 py-3.5 text-center">
                    <RateBadge rate={row.goalApprovalRate} />
                  </td>
                  <td className="px-4 py-3.5 text-center">
                    <PendingBadge count={row.goalPending} />
                  </td>
                  <td className="px-4 py-3.5 text-right text-[12px] text-gray-500">
                    {row.avgApprovalHours != null
                      ? row.avgApprovalHours < 24
                        ? `${row.avgApprovalHours.toFixed(0)}h`
                        : `${(row.avgApprovalHours / 24).toFixed(1)}d`
                      : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </ScrollRegion>
    </div>
  );
}
