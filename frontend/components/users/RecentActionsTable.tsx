'use client';

import type { UserProfileRecentAction } from '@/lib/types';
import { labelAuditEvent } from '@/lib/auditEventLabels';
import { shortCentreName } from '@/lib/centreNames';
import ScrollRegion from '@/components/shared/ScrollRegion';

interface Props {
  actions: UserProfileRecentAction[];
  loading: boolean;
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatType(type: string): string {
  return labelAuditEvent(type);
}

export default function RecentActionsTable({ actions, loading }: Props) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-[0_1px_3px_rgba(0,0,0,0.06)] overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-100">
        <h2 className="text-sm font-semibold text-gray-900">Recent Actions</h2>
        <p className="text-xs text-gray-400 mt-0.5">Latest audit log entries</p>
      </div>
      <ScrollRegion maxHeightClass="max-h-[480px]" label="table">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 text-[10px] font-bold text-gray-400 uppercase tracking-[0.08em]">
              <th className="px-6 py-3 text-left">When</th>
              <th className="px-5 py-3 text-left">Type</th>
              <th className="px-5 py-3 text-left">Description</th>
              <th className="px-5 py-3 text-left">Centre</th>
              <th className="px-5 py-3 text-right">Patient</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {loading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <tr key={i} className="animate-pulse">
                  {Array.from({ length: 5 }).map((__, j) => (
                    <td key={j} className="px-5 py-3.5">
                      <div className="h-4 bg-gray-100 rounded w-20" />
                    </td>
                  ))}
                </tr>
              ))
            ) : actions.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-6 py-10 text-center text-gray-400">
                  No recent actions for the selected period
                </td>
              </tr>
            ) : (
              actions.map((a, i) => (
                <tr key={i} className="hover:bg-gray-50/70 transition-colors">
                  <td className="px-6 py-3.5 text-gray-500 whitespace-nowrap text-xs">
                    {formatDateTime(a.time)}
                  </td>
                  <td className="px-5 py-3.5">
                    <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-700">
                      {formatType(a.type)}
                    </span>
                  </td>
                  <td className="px-5 py-3.5 text-gray-600 text-xs max-w-xs truncate" title={a.description ?? ''}>
                    {a.description || '—'}
                  </td>
                  <td className="px-5 py-3.5 text-gray-500 text-xs">
                    {shortCentreName(a.centreName)}
                  </td>
                  <td className="px-5 py-3.5 text-right tabular-nums text-gray-400 text-xs">
                    {a.patientId ?? '—'}
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
