'use client';

import type { UserProfileActiveCase } from '@/lib/types';
import { shortCentreName } from '@/lib/centreNames';
import ScrollRegion from '@/components/shared/ScrollRegion';

interface Props {
  cases: UserProfileActiveCase[];
  loading: boolean;
}

function stalenessClass(days: number): string {
  if (days <= 7) return 'text-green-600';
  if (days <= 14) return 'text-amber-500';
  return 'text-rose-500 font-medium';
}

export default function ActiveCaseloadTable({ cases, loading }: Props) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-[0_1px_3px_rgba(0,0,0,0.06)] overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">Active Caseload</h2>
          <p className="text-xs text-gray-400 mt-0.5">Cases in NotStarted, InProgress, or OnHold</p>
        </div>
        {!loading && (
          <span className="text-xs font-semibold text-gray-400 bg-gray-100 px-2.5 py-1 rounded-full">
            {cases.length} case{cases.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>
      <ScrollRegion maxHeightClass="max-h-[480px]" label="table">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 text-[10px] font-bold text-gray-400 uppercase tracking-[0.08em]">
              <th className="px-6 py-3 text-left">Patient</th>
              <th className="px-5 py-3 text-left">Status</th>
              <th className="px-5 py-3 text-left">Centre</th>
              <th className="px-5 py-3 text-right">Days Assigned</th>
              <th className="px-5 py-3 text-left">Last Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {loading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <tr key={i} className="animate-pulse">
                  {Array.from({ length: 5 }).map((__, j) => (
                    <td key={j} className="px-5 py-3.5">
                      <div className="h-4 bg-gray-100 rounded w-16" />
                    </td>
                  ))}
                </tr>
              ))
            ) : cases.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-6 py-10 text-center text-gray-400">
                  No active cases
                </td>
              </tr>
            ) : (
              cases.map((c) => (
                <tr key={c.patientId} className="hover:bg-gray-50/70 transition-colors">
                  <td className="px-6 py-3.5 font-medium text-gray-800 tabular-nums">
                    #{c.patientId}
                  </td>
                  <td className="px-5 py-3.5">
                    <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700">
                      {c.status}
                    </span>
                  </td>
                  <td className="px-5 py-3.5 text-gray-500 text-xs" title={c.centreName ?? ''}>
                    {shortCentreName(c.centreName)}
                  </td>
                  <td className={`px-5 py-3.5 text-right tabular-nums ${stalenessClass(c.daysSinceAssigned)}`}>
                    {c.daysSinceAssigned}d
                  </td>
                  <td className="px-5 py-3.5 text-gray-400 text-xs whitespace-nowrap">
                    {c.lastAction
                      ? new Date(c.lastAction).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
                      : '—'}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </ScrollRegion>
    </div>
  );
}
