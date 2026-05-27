'use client';

import { useState } from 'react';
import type { UserProfileRecentAction } from '@/lib/types';
import { shortCentreName } from '@/lib/centreNames';
import ScrollRegion from '@/components/shared/ScrollRegion';
import { formatActionDate, formatDateGroupLabel } from '@/lib/formatDate';

interface Props {
  actions: UserProfileRecentAction[];
  loading: boolean;
}

const PAGE_SIZE = 20;

/** Group consecutive actions by date (YYYY-MM-DD) */
function groupByDate(actions: UserProfileRecentAction[]): Array<{
  date: string;
  label: string;
  rows: UserProfileRecentAction[];
}> {
  const groups: Array<{ date: string; label: string; rows: UserProfileRecentAction[] }> = [];
  for (const a of actions) {
    const key = a.date ?? a.isoDateTime?.slice(0, 10) ?? 'unknown';
    const last = groups[groups.length - 1];
    if (last && last.date === key) {
      last.rows.push(a);
    } else {
      groups.push({ date: key, label: formatDateGroupLabel(key), rows: [a] });
    }
  }
  return groups;
}

function PatientCell({ action }: { action: UserProfileRecentAction }) {
  if (action.patientName) {
    return (
      <div>
        <div className="text-sm font-medium text-gray-800">{action.patientName}</div>
        {action.patientId && (
          <div className="text-[11px] text-gray-400 mt-0.5">#{action.patientId}</div>
        )}
      </div>
    );
  }
  if (action.patientId) {
    return <span className="text-xs text-gray-500 italic">Patient #{action.patientId}</span>;
  }
  return <span className="text-gray-300 text-xs">—</span>;
}

function ActionCell({ action }: { action: UserProfileRecentAction }) {
  return (
    <div>
      <span
        className={action.isCoreJob
          ? 'text-gray-800 font-semibold text-sm'
          : 'text-gray-500 text-sm'}
      >
        {action.eventType}
      </span>
      {action.assessmentType && (
        <span className="ml-1.5 text-[11px] text-gray-400 font-normal">
          · {action.assessmentType}
        </span>
      )}
    </div>
  );
}

export default function RecentActionsTable({ actions, loading }: Props) {
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const visible  = actions.slice(0, visibleCount);
  const hasMore  = visibleCount < actions.length;
  const groups   = groupByDate(visible);

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
        <div>
          <h2 className="text-[14px] font-medium text-gray-900">Recent Actions</h2>
          <p className="text-[12px] text-gray-500 mt-0.5">Audit log entries in the selected period</p>
        </div>
        {!loading && actions.length > 0 && (
          <span className="text-xs font-semibold text-gray-400 bg-gray-100 px-2.5 py-1 rounded-full">
            {actions.length}
          </span>
        )}
      </div>

      <ScrollRegion maxHeightClass="max-h-[600px]" label="table">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 text-[11px] font-medium text-gray-500 uppercase tracking-[0.04em] bg-gray-50/60">
              <th className="px-5 py-3 text-left w-[155px]">When</th>
              <th className="px-2 py-3 text-center w-6" title="Core job action">●</th>
              <th className="px-4 py-3 text-left">Action</th>
              <th className="px-4 py-3 text-left hidden md:table-cell">Centre</th>
              <th className="px-4 py-3 text-left">Patient</th>
            </tr>
          </thead>

          <tbody className="divide-y divide-gray-50">
            {loading ? (
              Array.from({ length: 8 }).map((_, i) => (
                <tr key={i} className="animate-pulse">
                  {Array.from({ length: 5 }).map((__, j) => (
                    <td key={j} className="px-4 py-3.5">
                      <div className="h-4 bg-gray-100 rounded w-20" />
                    </td>
                  ))}
                </tr>
              ))
            ) : actions.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-6 py-10 text-center text-gray-400 text-sm">
                  No actions for the selected period
                </td>
              </tr>
            ) : (
              groups.map((group) => (
                <>
                  {/* Date group divider */}
                  <tr key={`divider-${group.date}`} className="bg-gray-50/80">
                    <td
                      colSpan={5}
                      className="px-5 py-1.5 text-[11px] font-semibold text-gray-400 tracking-wide uppercase"
                    >
                      {group.label}
                    </td>
                  </tr>

                  {/* Action rows for this date */}
                  {group.rows.map((a, i) => (
                    <tr
                      key={`${group.date}-${i}`}
                      className="hover:bg-gray-50/70 transition-colors"
                    >
                      {/* When */}
                      <td className="px-5 py-3 text-gray-500 whitespace-nowrap">
                        <span className="text-xs font-mono">
                          {a.isoDateTime
                            ? formatActionDate(a.isoDateTime).split(', ').pop() ?? '—'
                            : a.time ?? '—'}
                        </span>
                      </td>

                      {/* Core job dot */}
                      <td className="px-2 py-3 text-center">
                        {a.isCoreJob && (
                          <span
                            title="Core job action"
                            className="inline-block w-2 h-2 rounded-full bg-emerald-500"
                          />
                        )}
                      </td>

                      {/* Action */}
                      <td className="px-4 py-3 max-w-[200px]">
                        <ActionCell action={a} />
                      </td>

                      {/* Centre */}
                      <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap hidden md:table-cell">
                        {a.centreName
                          ? shortCentreName(a.centreName)
                          : <span className="text-gray-300">—</span>}
                      </td>

                      {/* Patient */}
                      <td className="px-4 py-3">
                        <PatientCell action={a} />
                      </td>
                    </tr>
                  ))}
                </>
              ))
            )}
          </tbody>
        </table>
      </ScrollRegion>

      {/* Show more */}
      {!loading && hasMore && (
        <div className="px-6 py-3 border-t border-gray-100 flex items-center justify-between">
          <span className="text-xs text-gray-400">
            Showing {visibleCount} of {actions.length}
          </span>
          <button
            type="button"
            onClick={() => setVisibleCount((n) => Math.min(n + PAGE_SIZE, 100))}
            className="text-xs font-medium text-blue-600 hover:text-blue-700 transition-colors"
          >
            Show more
          </button>
        </div>
      )}
    </div>
  );
}
